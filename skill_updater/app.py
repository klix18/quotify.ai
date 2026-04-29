"""Streamlit UI for skill_updater.

Three sections:
  1. Run analysis  — kick off the pipeline, show progress
  2. Pending proposals — review/edit/approve/decline grouped by insurance type
  3. History — past applies, with skill content snapshots

Run with:
    streamlit run app.py
"""

from __future__ import annotations

import asyncio
import difflib
from typing import Any

import streamlit as st

import db
import pipeline
import skill_io


# ── Async helpers ─────────────────────────────────────────────────────
# Streamlit reruns the script top-to-bottom on each interaction, which makes
# managing a long-lived event loop awkward. Easiest workable pattern: spin
# up a fresh loop per call. asyncpg's pool is module-global so it survives
# reruns until the Streamlit process exits.


def run_async(coro: Any) -> Any:
    try:
        return asyncio.run(coro)
    except RuntimeError as e:
        # If a loop is already running (rare in Streamlit but possible if
        # nested), fall back to a manual loop.
        if "already running" not in str(e):
            raise
        loop = asyncio.new_event_loop()
        try:
            return loop.run_until_complete(coro)
        finally:
            loop.close()


# ── Page config ───────────────────────────────────────────────────────

st.set_page_config(page_title="Skill Updater", page_icon="🛠", layout="wide")
st.title("Skill Updater")
st.caption(
    "Analyzes manual corrections to find parser misses, proposes SKILL.md edits "
    "for review."
)


# ── Section 1 — run analysis ──────────────────────────────────────────


def section_run() -> None:
    st.header("Run analysis")

    # Quick stats
    try:
        total_unanalyzed = run_async(db.count_unanalyzed_events())
    except Exception as e:
        st.error(f"Could not connect to Postgres: {e}")
        st.info("Set DATABASE_URL in skill_updater/.env or copy backend/.env in.")
        return

    available_types = skill_io.available_insurance_types()
    col1, col2 = st.columns([2, 1])
    with col1:
        st.metric("Unanalyzed events", total_unanalyzed)
    with col2:
        selected_types = st.multiselect(
            "Limit to insurance types (empty = all)",
            options=available_types,
            default=[],
        )

    limit = st.slider("Max events this run", 1, 200, 50)

    if st.button("Run full analysis + synthesis", type="primary", disabled=total_unanalyzed == 0):
        progress_bar = st.progress(0.0)
        status_text = st.empty()

        def _progress(done: int, total: int, message: str) -> None:
            ratio = (done / total) if total else 1.0
            progress_bar.progress(min(max(ratio, 0.0), 1.0))
            status_text.text(f"{message} ({done}/{total})")

        with st.spinner("Running pipeline... see progress below"):
            try:
                run_id, processed, skipped, proposal_ids = run_async(
                    pipeline.full_run(
                        insurance_types=selected_types or None,
                        limit=limit,
                        progress=_progress,
                    )
                )
                st.success(
                    f"Run {run_id} complete. Analyzed {processed}, skipped {skipped}, "
                    f"created {len(proposal_ids)} proposal(s)."
                )
            except Exception as e:
                st.exception(e)


# ── Section 2 — pending proposals ─────────────────────────────────────


def _render_diff(old: str, new: str, label: str = "diff") -> None:
    """Compact unified diff shown in a code block."""
    diff = difflib.unified_diff(
        old.splitlines(keepends=False),
        new.splitlines(keepends=False),
        fromfile="current SKILL.md",
        tofile="proposed SKILL.md",
        lineterm="",
        n=3,
    )
    body = "\n".join(diff)
    if not body.strip():
        st.info("No diff — proposed content is identical to current.")
        return
    st.code(body, language="diff")


def section_proposals() -> None:
    st.header("Pending & saved-edit proposals")
    # Pending = synthesizer just created it.
    # Modified = you clicked Save edits but haven't applied yet.
    # Both should appear here — they're "awaiting application".
    try:
        pending = run_async(db.list_proposals(status="pending"))
        modified = run_async(db.list_proposals(status="modified"))
        # Filter modified to only those NOT yet applied
        modified = [p for p in modified if p.applied_at is None]
        all_open = pending + modified
    except Exception as e:
        st.error(f"Failed to load proposals: {e}")
        return

    if not all_open:
        st.info("No open proposals. Run an analysis above to generate some.")
        return

    # Group by insurance_type for the grouped review experience
    by_type: dict[str, list[Any]] = {}
    for p in all_open:
        by_type.setdefault(p.insurance_type, []).append(p)

    for itype, proposals in sorted(by_type.items()):
        with st.expander(f"{itype} — {len(proposals)} proposal(s)", expanded=True):
            for p in proposals:
                status_badge = "✏️ edited" if p.status == "modified" else "🆕 pending"
                st.markdown(f"**Proposal #{p.id}** · {status_badge} · supporting events: "
                            f"`{', '.join(str(x) for x in p.supporting_event_ids)}`")
                if p.rationale:
                    st.markdown(f"_Rationale:_ {p.rationale}")

                tabs = st.tabs(["Diff", "Edit proposed SKILL.md", "Current", "Proposed"])
                with tabs[0]:
                    _render_diff(p.current_skill_md, p.proposed_skill_md)
                with tabs[1]:
                    edited = st.text_area(
                        "Edit before approving",
                        value=p.proposed_skill_md,
                        height=400,
                        key=f"edit_{p.id}",
                    )
                with tabs[2]:
                    st.code(p.current_skill_md, language="markdown")
                with tabs[3]:
                    st.code(p.proposed_skill_md, language="markdown")

                c1, c2, c3, _ = st.columns([1, 1, 1, 3])
                with c1:
                    if st.button("Approve & apply", key=f"approve_{p.id}", type="primary"):
                        try:
                            was_edited = edited != p.proposed_skill_md
                            ok = run_async(
                                pipeline.approve_and_apply(p.id, edited, was_edited)
                            )
                            if ok:
                                st.success(f"Applied proposal #{p.id} to parse_{itype}/SKILL.md")
                                st.rerun()
                            else:
                                st.error("Apply failed — see logs.")
                        except Exception as e:
                            st.exception(e)
                with c2:
                    if st.button("Save edits (don't apply)", key=f"save_{p.id}"):
                        try:
                            run_async(db.update_proposal_status(p.id, "modified", edited))
                            st.success("Saved edits.")
                            st.rerun()
                        except Exception as e:
                            st.exception(e)
                with c3:
                    if st.button("Decline", key=f"decline_{p.id}"):
                        try:
                            run_async(db.update_proposal_status(p.id, "declined"))
                            st.info("Declined.")
                            st.rerun()
                        except Exception as e:
                            st.exception(e)


# ── Section 3 — history ───────────────────────────────────────────────


def section_history() -> None:
    st.header("History")
    try:
        hist = run_async(db.list_history(limit=20))
    except Exception as e:
        st.error(f"Failed to load history: {e}")
        return

    if not hist:
        st.caption("No applies yet.")
        return

    for h in hist:
        with st.expander(
            f"{h['captured_at']:%Y-%m-%d %H:%M}  ·  {h['insurance_type']}  ·  "
            f"reason={h['reason']}  ·  proposal_id={h['proposal_id']}"
        ):
            st.code(h["skill_md"], language="markdown")
            if st.button(f"Restore this version", key=f"restore_{h['id']}"):
                try:
                    run_async(
                        pipeline.restore_history(h["insurance_type"], h["skill_md"])
                    )
                    st.success(f"Restored parse_{h['insurance_type']}/SKILL.md to this version.")
                except Exception as e:
                    st.exception(e)


# ── Layout ────────────────────────────────────────────────────────────

with st.sidebar:
    st.subheader("Setup")
    if st.button("Initialize / migrate DB schema"):
        try:
            run_async(db.init_schema())
            st.success("Schema applied.")
        except Exception as e:
            st.exception(e)
    st.caption(
        "Runs `migrations/001_skill_updater.sql`. Idempotent — safe to re-click."
    )

section_run()
st.divider()
section_proposals()
st.divider()
section_history()
