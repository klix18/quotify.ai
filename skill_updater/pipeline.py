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
import re
import traceback
from pathlib import Path
from typing import Awaitable, Callable, Literal, Optional
from uuid import UUID

import db
import skill_io
from analyzer import InadequateTextError, analyze_event, analyze_event_design3
from models import EventRow, Finding
from synthesizer import synthesize_proposal


FINDINGS_DIR = Path(__file__).resolve().parent / "findings"
FINDINGS_DIR.mkdir(parents=True, exist_ok=True)


# ── Design selector ───────────────────────────────────────────────────
# The operator picks the analyzer design in the Streamlit UI; the
# pipeline filters events to that exact ``system_design`` tag so a
# Design 3 run doesn't waste budget on Design 2 events (or vice-versa).
# The tag itself is the SYSTEM_DESIGN_VERSION constant that the
# frontend stamps on every event via /api/track-event.

DESIGN_3_TAG = "fitz-fastpath-2026-04-30"
DESIGN_2_TAG = ""  # pre-fitz events have no tag; treat empty as Design 2

DesignChoice = Literal["design2", "design3"]


def _design_tag(design: DesignChoice) -> str:
    """Translate the operator's UI choice into the literal
    ``system_design`` value to filter on."""
    return DESIGN_3_TAG if design == "design3" else DESIGN_2_TAG


# ── SKILL.md VERSION auto-bump ────────────────────────────────────────
# Every SKILL.md carries a ``> VERSION: X.Y`` line that
# backend's ``get_skill_version`` reads. That value is part of the
# Gemini system-prompt cache key, so bumping the version is what
# actually invalidates the cache and lets the new SKILL.md content
# take effect on the next parse. Auto-bumping on apply / restore
# means content changes and cache invalidation always advance in
# lockstep — easy to forget by hand.

_VERSION_LINE_RE = re.compile(r"(?m)^>\s*VERSION:\s*(\d+)\.(\d+)\s*$")


def _bump_version(skill_md: str) -> str:
    """Increment the minor digit of ``> VERSION: X.Y``.

    No-op if the line is missing — we don't invent a version where one
    wasn't declared. If multiple VERSION lines exist (shouldn't, but be
    defensive) only the first is bumped.
    """
    match = _VERSION_LINE_RE.search(skill_md)
    if not match:
        return skill_md
    major, minor = int(match.group(1)), int(match.group(2))
    new_line = f"> VERSION: {major}.{minor + 1}"
    return skill_md[: match.start()] + new_line + skill_md[match.end():]


# ── Run: per-event analysis ───────────────────────────────────────────


async def run_analysis(
    insurance_types: Optional[list[str]] = None,
    limit: int = 200,
    progress: Optional[Callable[[int, int, str], Awaitable[None] | None]] = None,
    design: DesignChoice = "design3",
) -> tuple[UUID, int, int]:
    """Pull unanalyzed events for the selected design and analyze each.

    The ``design`` parameter is the operator's UI choice. It filters
    ``analytics_events`` to the matching ``system_design`` tag — so
    a Design 3 run only sees events the parser produced on the fitz
    fast-path, and a Design 2 run only sees pre-fitz events. Mixing
    is intentionally disallowed: the analyzer has to mirror the
    parser's input to attribute "parser miss" correctly.

    Returns ``(run_id, processed, skipped)``.
    """
    tag = _design_tag(design)
    events: list[EventRow] = await db.list_unanalyzed_events(
        insurance_types, limit=limit, system_design=tag,
    )
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

            # Dispatch to the analyzer that matches the operator's design
            # choice. Design 3 may raise InadequateTextError when fitz
            # can't extract usable blocks from the original — we record
            # that explicitly rather than silently falling back to vision,
            # because the operator picked the design and probably wants
            # to see which events were unanalyzable under it.
            try:
                if design == "design3":
                    finding = await asyncio.to_thread(
                        analyze_event_design3,
                        event.id,
                        event.insurance_type,
                        code_names,
                        pdfs["original"],
                        pdfs["generated"],
                    )
                else:
                    finding = await asyncio.to_thread(
                        analyze_event,
                        event.id,
                        event.insurance_type,
                        code_names,
                        pdfs["original"],
                        pdfs["generated"],
                    )
            except InadequateTextError as text_exc:
                await db.record_analysis(
                    run_id, event.id, event.insurance_type,
                    outcome="no_fitz_text", error_message=str(text_exc)[:4000],
                )
                skipped += 1
                continue

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
    """Snapshot current SKILL.md, then write the proposed content with
    an auto-bumped ``> VERSION:`` line. Marks the proposal as applied.

    Bumping VERSION on apply guarantees that the Gemini system-prompt
    cache key advances every time SKILL.md content changes, so the new
    prompt actually takes effect on the next parse instead of waiting
    for the cache TTL to expire.
    """
    p = await db.get_proposal(proposal_id)
    if p is None:
        return False
    if p.status not in ("approved", "modified"):
        # Don't apply pending or declined.
        return False
    current = skill_io.read_skill(p.insurance_type)
    await db.snapshot_skill(p.insurance_type, current, reason="pre_apply", proposal_id=p.id)
    new_content = _bump_version(p.proposed_skill_md)
    skill_io.write_skill(p.insurance_type, new_content)
    # Persist the bumped content back to the proposal so the History tab
    # shows exactly what landed on disk.
    if new_content != p.proposed_skill_md:
        await db.update_proposal_status(p.id, p.status, new_content)
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


async def apply_with_line_decisions(proposal_id: int, decisions: dict[str, dict]) -> bool:
    """Reconstruct the final SKILL.md from per-line decisions and apply.

    ``decisions`` maps each diff-line key (``m_<n>`` for minus lines,
    ``p_<n>`` for plus lines) to a dict like
    ``{"accept": bool, "text": str?}``. The reconstructed text is saved
    to the proposal as 'modified' before applying so the snapshot
    history records exactly what was written."""
    import diff_review  # local import keeps top-level imports tidy
    p = await db.get_proposal(proposal_id)
    if p is None:
        return False
    diff_lines = diff_review.compute_diff_lines(p.current_skill_md, p.proposed_skill_md)
    final_content = diff_review.reconstruct(diff_lines, decisions)
    await db.update_proposal_status(proposal_id, "modified", final_content)
    return await apply_proposal(proposal_id)


async def restore_history(insurance_type: str, skill_md: str) -> None:
    """Restore a historical SKILL.md.

    Versioning is monotonic: a rollback writes the old content with a
    NEW (bumped-from-live) VERSION number rather than reverting to the
    historical version string. The Gemini cache key still advances and
    the timeline of versions on disk stays strictly increasing — easier
    to reason about than zig-zagging back through old numbers.
    """
    try:
        current_live = skill_io.read_skill(insurance_type)
    except FileNotFoundError:
        current_live = ""
    bumped_from_live = _bump_version(current_live) if current_live else ""
    live_version_match = _VERSION_LINE_RE.search(bumped_from_live)
    if live_version_match:
        new_content = _VERSION_LINE_RE.sub(
            live_version_match.group(0), skill_md, count=1
        )
    else:
        new_content = skill_md
    skill_io.write_skill(insurance_type, new_content)
    await db.snapshot_skill(insurance_type, new_content, reason="rollback_restore")


# ── Convenience: run the whole loop in one call ───────────────────────


async def full_run(
    insurance_types: Optional[list[str]] = None,
    limit: int = 200,
    progress: Optional[Callable[[int, int, str], Awaitable[None] | None]] = None,
    design: DesignChoice = "design3",
) -> tuple[UUID, int, int, list[int]]:
    """Run analysis + synthesis sequentially. Returns
    ``(run_id, processed, skipped, proposal_ids)``.

    The ``design`` choice picks which analyzer runs and which subset of
    events is in scope — see :func:`run_analysis`.
    """
    run_id, processed, skipped = await run_analysis(
        insurance_types, limit, progress, design=design,
    )
    proposal_ids = await synthesize_run(run_id, progress) if processed > 0 else []
    return run_id, processed, skipped, proposal_ids
