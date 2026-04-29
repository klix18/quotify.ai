"""End-to-end orchestrator.

Two top-level functions exposed:
- ``run_analysis`` — fan out per-event analyzer calls for all unanalyzed events
- ``synthesize_run`` — fan out per-insurance-type synthesizer calls and write
  proposals to the DB

Both write per-event findings to ``findings/<event_id>.json`` for inspection.
"""

from __future__ import annotations

import asyncio
import json
import traceback
from pathlib import Path
from typing import Awaitable, Callable, Optional
from uuid import UUID

import db
import skill_io
from analyzer import analyze_event
from models import EventRow, Finding
from synthesizer import synthesize_proposal


FINDINGS_DIR = Path(__file__).resolve().parent / "findings"
FINDINGS_DIR.mkdir(parents=True, exist_ok=True)


# ── Run: per-event analysis ───────────────────────────────────────────


async def run_analysis(
    insurance_types: Optional[list[str]] = None,
    limit: int = 200,
    progress: Optional[Callable[[int, int, str], Awaitable[None] | None]] = None,
) -> tuple[UUID, int, int]:
    """Pull unanalyzed events and run the analyzer on each.

    Returns ``(run_id, processed, skipped)``.

    ``progress`` is an optional callback ``(done_so_far, total, message)``;
    awaited if it returns an awaitable, otherwise called sync. Lets the
    Streamlit UI update a progress bar without coupling the pipeline to it.
    """
    events: list[EventRow] = await db.list_unanalyzed_events(insurance_types, limit=limit)
    total = len(events)
    if total == 0:
        run_id = await db.create_run()
        await db.finalize_run(run_id, 0, 0)
        return run_id, 0, 0

    run_id = await db.create_run()
    processed = 0
    skipped = 0

    for i, event in enumerate(events):
        if progress:
            r = progress(i, total, f"analyzing event {event.id} ({event.insurance_type})")
            if asyncio.iscoroutine(r):
                await r
        try:
            pdfs = await db.fetch_event_pdfs(event)
            if not pdfs["original"] or not pdfs["generated"]:
                await db.record_analysis(
                    run_id, event.id, event.insurance_type,
                    outcome="no_pdfs",
                    error_message="missing original or generated PDF in pdf_documents",
                )
                skipped += 1
                continue

            code_names = event.changed_code_names
            # Run the (sync, blocking) Gemini calls in a worker thread so the
            # asyncpg event loop isn't blocked while the model thinks.
            finding: Finding = await asyncio.to_thread(
                analyze_event,
                event.id,
                event.insurance_type,
                code_names,
                pdfs["original"],
                pdfs["generated"],
            )

            # Cache JSON for human inspection (also useful when iterating prompts)
            (FINDINGS_DIR / f"{event.id}.json").write_text(
                finding.model_dump_json(indent=2), encoding="utf-8",
            )

            await db.record_analysis(
                run_id, event.id, event.insurance_type,
                outcome="analyzed", finding=finding,
            )
            processed += 1
        except Exception as exc:
            tb = traceback.format_exc()
            err = f"{type(exc).__name__}: {exc}\n{tb}"
            try:
                await db.record_analysis(
                    run_id, event.id, event.insurance_type,
                    outcome="error", error_message=err[:4000],
                )
            except Exception:
                pass
            skipped += 1

    if progress:
        r = progress(total, total, "analysis complete")
        if asyncio.iscoroutine(r):
            await r

    await db.finalize_run(run_id, processed, skipped)
    return run_id, processed, skipped


# ── Synthesize per-insurance-type proposals for a run ─────────────────


async def synthesize_run(
    run_id: UUID,
    progress: Optional[Callable[[int, int, str], Awaitable[None] | None]] = None,
) -> list[int]:
    """For each insurance_type seen in this run with at least one
    parser-miss finding, call the synthesizer and save a proposal.

    Returns the list of proposal IDs created."""
    types_in_run = await db.insurance_types_in_run(run_id)
    proposal_ids: list[int] = []

    for i, itype in enumerate(types_in_run):
        if progress:
            r = progress(i, len(types_in_run), f"synthesizing proposal for {itype}")
            if asyncio.iscoroutine(r):
                await r
        try:
            findings = await db.list_findings_for_run(run_id, itype)
            # Only consider findings that contained at least one parser miss
            findings_with_misses = [f for f in findings if f.parser_misses]
            if not findings_with_misses:
                continue

            try:
                current_skill = skill_io.read_skill(itype)
            except FileNotFoundError:
                # Skip unknown insurance types (e.g. variations not yet mapped)
                continue

            proposal = await asyncio.to_thread(
                synthesize_proposal,
                itype, current_skill, findings_with_misses,
            )
            if proposal is None:
                continue

            pid = await db.save_proposal(
                run_id=run_id,
                insurance_type=itype,
                supporting_event_ids=proposal.supporting_event_ids,
                current_skill_md=current_skill,
                proposed_skill_md=proposal.proposed_skill_md,
                rationale=proposal.rationale,
            )
            proposal_ids.append(pid)
        except Exception:
            # Don't fail the whole synthesis pass if one insurance type errors.
            traceback.print_exc()
            continue

    if progress:
        r = progress(len(types_in_run), len(types_in_run), "synthesis complete")
        if asyncio.iscoroutine(r):
            await r

    return proposal_ids


# ── Apply an approved proposal ────────────────────────────────────────


async def apply_proposal(proposal_id: int) -> bool:
    """Snapshot current SKILL.md, then write the proposed content. Marks
    the proposal as applied. Returns True on success."""
    p = await db.get_proposal(proposal_id)
    if p is None:
        return False
    if p.status not in ("approved", "modified"):
        # Don't apply pending or declined.
        return False
    current = skill_io.read_skill(p.insurance_type)
    await db.snapshot_skill(p.insurance_type, current, reason="pre_apply", proposal_id=p.id)
    skill_io.write_skill(p.insurance_type, p.proposed_skill_md)
    await db.mark_proposal_applied(p.id)
    return True


# ── UI handlers (combine multiple DB ops into one coroutine) ──────────
# Streamlit creates a fresh event loop per interaction, so anything that
# does multiple DB calls per user click must live behind a single
# coroutine — otherwise the second `asyncio.run` rebuilds the pool and
# we waste connections.


async def approve_and_apply(proposal_id: int, proposed_skill_md: str, was_edited: bool) -> bool:
    """Mark approved (or modified if edited) and apply in one shot."""
    if was_edited:
        await db.update_proposal_status(proposal_id, "modified", proposed_skill_md)
    else:
        await db.update_proposal_status(proposal_id, "approved")
    return await apply_proposal(proposal_id)


async def restore_history(insurance_type: str, skill_md: str) -> None:
    """Write a historical SKILL.md back, then snapshot the restore."""
    skill_io.write_skill(insurance_type, skill_md)
    await db.snapshot_skill(insurance_type, skill_md, reason="manual_snapshot")


# ── Convenience: run the whole loop in one call ───────────────────────


async def full_run(
    insurance_types: Optional[list[str]] = None,
    limit: int = 200,
    progress: Optional[Callable[[int, int, str], Awaitable[None] | None]] = None,
) -> tuple[UUID, int, int, list[int]]:
    """Run analysis + synthesis sequentially. Returns
    ``(run_id, processed, skipped, proposal_ids)``."""
    run_id, processed, skipped = await run_analysis(insurance_types, limit, progress)
    proposal_ids = await synthesize_run(run_id, progress) if processed > 0 else []
    return run_id, processed, skipped, proposal_ids
