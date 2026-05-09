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
import diff_review
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
        by_design = run_async(db.count_unanalyzed_by_design())
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

    # Design breakdown — shows which analyzer path each event will take.
    # Events with empty `system_design` are SKIPPED (they're old rows
    # written before the column existed; we can't safely guess the
    # analyzer path).
    if by_design:
        design_lines: list[str] = []
        skipped_unknown = 0
        for design, n in by_design.items():
            if not design:
                skipped_unknown = n
                continue
            if design == pipeline.DESIGN_3_FITZ:
                label = f"Design 3 (fitz text-vs-text) — {design}"
            else:
                label = f"Design 2 (vision) — {design}"
            design_lines.append(f"  · {n} × {label}")
        if design_lines:
            st.caption("**Will analyze:**\n" + "\n".join(design_lines))
        if skipped_unknown:
            st.warning(
                f"⚠️ {skipped_unknown} event(s) have no `system_design` recorded "
                "(pre-migration rows or stale frontend writes). They will be "
                "**skipped** with `outcome='design_unknown'` so the run doesn't "
                "guess the analyzer path. Re-analyze them manually later if needed."
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


def _render_hunk_review(p: Any) -> None:
    """Inline diff review with per-line checkboxes AND editable ``+`` lines.

    For each ``-`` line: a checkbox (default checked = remove).
    For each ``+`` line: a checkbox (default checked = add) AND an inline
    text input pre-filled with the proposed text. If you edit the text,
    your edited version is what gets written.

    Click "Apply" at the bottom and only the changes you kept (with any
    edits you made) get written to the SKILL.md."""
    diff_lines = diff_review.compute_diff_lines(p.current_skill_md, p.proposed_skill_md)
    s = diff_review.stats(diff_lines)
    if s["minus"] == 0 and s["plus"] == 0:
        st.info("No changes to review — proposed content matches current SKILL.md.")
        return

    st.caption(
        f"{s['plus']} line(s) to add · {s['minus']} line(s) to remove · "
        f"{s['context']} unchanged context line(s). "
        "Every change defaults to **accepted**. Uncheck to skip, or edit a "
        "green line directly to change what gets written. Click Apply at the bottom."
    )

    decisions: dict[str, dict] = {}
    for ln in diff_lines:
        if ln.kind == "context":
            st.markdown(
                f"<div style='font-family:monospace;color:#666;padding:2px 0;"
                f"font-size:13px;'>&nbsp;&nbsp;{_html_escape(ln.text)}</div>",
                unsafe_allow_html=True,
            )
            continue

        # Layout: [checkbox] [+/- sign] [editable text or read-only text]
        col_check, col_sign, col_text = st.columns([1, 1, 18])
        widget_key = f"line_{p.id}_{ln.key}"

        with col_check:
            accepted = st.checkbox(
                "✓",
                value=st.session_state.get(widget_key, True),
                key=widget_key,
                label_visibility="collapsed",
                help=("Add this line (default on)" if ln.kind == "plus"
                      else "Remove this line (default on)"),
            )

        with col_sign:
            sign = "+" if ln.kind == "plus" else "−"
            color = "#0a7d2e" if ln.kind == "plus" else "#a32424"
            opacity = "1.0" if accepted else "0.35"
            st.markdown(
                f"<div style='font-family:monospace;color:{color};font-size:14px;"
                f"font-weight:600;padding:6px 0;opacity:{opacity};'>"
                f"{sign}</div>",
                unsafe_allow_html=True,
            )

        with col_text:
            if ln.kind == "plus":
                # Editable + line — user can rewrite the proposed text inline.
                # Use a unique key per line so Streamlit preserves edits across reruns.
                edit_key = f"plus_text_{p.id}_{ln.key}"
                # Pull either the user's edited value (if they've typed) or the
                # default proposed text. We use session_state directly so we can
                # read the LATEST value during the render pass (Streamlit returns
                # the typed value at the moment of widget render).
                edited_text = st.text_input(
                    "edit this line",
                    value=st.session_state.get(edit_key, ln.text),
                    key=edit_key,
                    label_visibility="collapsed",
                    disabled=not accepted,
                )
                decisions[ln.key] = {"accept": accepted, "text": edited_text}
            else:
                # Minus lines — read-only display, struck through if accepted (i.e. will be removed).
                bg = "#fce8e6"
                strike = "line-through" if accepted else "none"
                opacity = "1.0" if accepted else "0.35"
                st.markdown(
                    f"<div style='font-family:monospace;color:#a32424;background:{bg};"
                    f"padding:6px 8px;border-radius:3px;text-decoration:{strike};"
                    f"opacity:{opacity};font-size:13px;'>{_html_escape(ln.text)}</div>",
                    unsafe_allow_html=True,
                )
                decisions[ln.key] = {"accept": accepted}

    # Apply button
    n_accepted = sum(1 for v in decisions.values() if v.get("accept"))
    n_total = len(decisions)
    edited_count = sum(
        1 for k, v in decisions.items()
        if v.get("text") is not None and v.get("text") != _proposed_text_for_key(diff_lines, k)
    )
    label = f"Apply {n_accepted}/{n_total} accepted line changes"
    if edited_count:
        label += f" ({edited_count} edited)"
    if st.button(
        label,
        key=f"apply_lines_{p.id}",
        type="primary",
        disabled=n_total == 0,
    ):
        try:
            ok = run_async(pipeline.apply_with_line_decisions(p.id, decisions))
            if ok:
                st.success(
                    f"Applied {n_accepted}/{n_total} line changes to "
                    f"parse_{p.insurance_type}/SKILL.md"
                )
                st.rerun()
            else:
                st.error("Apply failed — see logs.")
        except Exception as e:
            st.exception(e)


def _proposed_text_for_key(diff_lines, key: str) -> str:
    for ln in diff_lines:
        if ln.key == key:
            return ln.text
    return ""


def _html_escape(s: str) -> str:
    """Minimal HTML escape for line text rendered via unsafe_allow_html."""
    return (
        s.replace("&", "&amp;")
         .replace("<", "&lt;")
         .replace(">", "&gt;")
         .replace(" ", "&nbsp;")
    )


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

                # Single inline panel — diff with per-line checkboxes, plus
                # editable text on every "+" line. Apply / Decline below it.
                _render_hunk_review(p)
                if st.button("Decline this proposal", key=f"decline_{p.id}"):
                    try:
                        run_async(db.update_proposal_status(p.id, "declined"))
                        st.info("Declined.")
                        st.rerun()
                    except Exception as e:
                        st.exception(e)


# ── Section 3 — compare two skill versions ────────────────────────────


def _extract_version(skill_md: str) -> str:
    """Pull the ``> VERSION: X.Y`` value out of a SKILL.md body."""
    import re as _re
    m = _re.search(r"(?m)^>\s*VERSION:\s*(\S+)", skill_md or "")
    return m.group(1) if m else "?"


def section_compare() -> None:
    """Side-by-side comparison of two SKILL.md versions for an insurance
    type. Use this to see what changed between two history snapshots, or
    between a snapshot and the current on-disk SKILL.md."""
    st.header("Compare versions")
    available_types = skill_io.available_insurance_types()
    if not available_types:
        st.caption("No SKILL.md files found.")
        return

    itype = st.selectbox(
        "Insurance type",
        options=available_types,
        key="compare_itype",
    )

    try:
        type_history = run_async(db.list_history(insurance_type=itype, limit=50))
    except Exception as e:
        st.error(f"Failed to load history for {itype}: {e}")
        return

    # Build the list of pickable versions: current on-disk + every snapshot.
    try:
        current_text = skill_io.read_skill(itype)
    except FileNotFoundError:
        current_text = ""

    # Each option: a label string + the underlying body. Order: current first,
    # then snapshots newest-first.
    options: list[dict] = []
    if current_text:
        options.append({
            "label": f"current on-disk · v{_extract_version(current_text)}",
            "text": current_text,
        })
    for h in type_history:
        options.append({
            "label": (
                f"{h['captured_at']:%Y-%m-%d %H:%M} · v{_extract_version(h['skill_md'])} · "
                f"{h['reason']} · #{h['id']}"
            ),
            "text": h["skill_md"] or "",
        })

    if len(options) < 2:
        st.caption("Need at least two versions to compare. Apply a proposal to start building history.")
        return

    labels = [o["label"] for o in options]
    col_a, col_b = st.columns(2)
    with col_a:
        a_idx = st.selectbox(
            "Version A (older / baseline)",
            options=list(range(len(labels))),
            format_func=lambda i: labels[i],
            index=min(1, len(labels) - 1),
            key="compare_a",
        )
    with col_b:
        b_idx = st.selectbox(
            "Version B (newer / candidate)",
            options=list(range(len(labels))),
            format_func=lambda i: labels[i],
            index=0,
            key="compare_b",
        )

    if a_idx == b_idx:
        st.info("Pick two different versions to see a diff.")
        return

    a_text = options[a_idx]["text"]
    b_text = options[b_idx]["text"]

    st.caption(f"Showing **{labels[a_idx]}** → **{labels[b_idx]}**")
    _render_diff(a_text, b_text, label="version-compare")


# ── Section 4 — history ───────────────────────────────────────────────


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
        version_str = _extract_version(h["skill_md"])
        with st.expander(
            f"{h['captured_at']:%Y-%m-%d %H:%M}  ·  {h['insurance_type']}  ·  "
            f"v{version_str}  ·  reason={h['reason']}  ·  proposal_id={h['proposal_id']}"
        ):
            st.code(h["skill_md"], language="markdown")
            # Rollback writes the historical content back with a freshly
            # bumped VERSION (see pipeline.restore_history) so the cache
            # invalidates and history stays monotonic.
            if st.button(f"Rollback to this version", key=f"restore_{h['id']}"):
                try:
                    run_async(
                        pipeline.restore_history(h["insurance_type"], h["skill_md"])
                    )
                    st.success(
                        f"Restored parse_{h['insurance_type']}/SKILL.md to this content "
                        f"(VERSION auto-bumped from current)."
                    )
                    st.rerun()
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
section_compare()
st.divider()
section_history()
