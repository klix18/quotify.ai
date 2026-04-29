"""Line-level diff review — pick which `+` lines to add and which `-`
lines to actually remove, then reconstruct the final file from those
per-line decisions.

Used by the Streamlit UI so users can cherry-pick individual line changes
inside the diff panel instead of approving the whole proposal as one block.
"""

from __future__ import annotations

import difflib
from dataclasses import dataclass
from typing import Literal


LineKind = Literal["context", "minus", "plus"]


@dataclass
class DiffLine:
    """One line in the rendered diff with the metadata the UI needs.

    For ``context`` lines, ``index`` and ``text`` describe a line that exists
    in both files unchanged. For ``minus`` lines, the line exists in the
    OLD file and the proposal wants it gone. For ``plus`` lines, the line
    exists in the NEW file and the proposal wants it added.
    """
    kind: LineKind
    text: str
    # Unique stable id for use as a Streamlit widget key
    key: str


def compute_diff_lines(old_text: str, new_text: str) -> list[DiffLine]:
    """Walk the diff between two strings and return every line in display
    order, tagged as context / minus / plus."""
    old_lines = old_text.splitlines()
    new_lines = new_text.splitlines()
    sm = difflib.SequenceMatcher(None, old_lines, new_lines, autojunk=False)

    out: list[DiffLine] = []
    for op, i1, i2, j1, j2 in sm.get_opcodes():
        if op == "equal":
            for k in range(i1, i2):
                out.append(DiffLine(kind="context", text=old_lines[k], key=f"c_{k}"))
        else:
            # A "replace" emits both minus then plus; "delete" only minus;
            # "insert" only plus. SequenceMatcher already encodes that —
            # we just walk the slices.
            for k in range(i1, i2):
                out.append(DiffLine(kind="minus", text=old_lines[k], key=f"m_{k}"))
            for k in range(j1, j2):
                out.append(DiffLine(kind="plus", text=new_lines[k], key=f"p_{k}"))
    return out


def reconstruct(diff_lines: list[DiffLine], decisions: dict[str, dict]) -> str:
    """Rebuild the final file given per-line decisions.

    ``decisions[line.key]`` is a dict with optional keys:
      - ``"accept"`` (bool, default True): whether to apply this change
      - ``"text"`` (str, only for ``plus`` lines): user-edited replacement text

    Behavior:
      - ``minus`` line + accept=True  → line is removed (default).
      - ``minus`` line + accept=False → original line is kept.
      - ``plus``  line + accept=True  → line is added; uses ``text`` if given,
                                        else the LLM's proposed text.
      - ``plus``  line + accept=False → addition is skipped.

    Missing keys default to ``{"accept": True}``, i.e. apply the proposal as-is.
    Context lines are always kept verbatim.
    """
    out: list[str] = []
    for ln in diff_lines:
        if ln.kind == "context":
            out.append(ln.text)
            continue

        d = decisions.get(ln.key, {})
        accept = d.get("accept", True)

        if ln.kind == "minus":
            if not accept:
                out.append(ln.text)  # user said keep — re-include original
        elif ln.kind == "plus":
            if accept:
                # Honor an edited text if the UI provided one
                out.append(d.get("text", ln.text))

    result = "\n".join(out)
    if not result.endswith("\n"):
        result += "\n"
    return result


def stats(diff_lines: list[DiffLine]) -> dict[str, int]:
    return {
        "context": sum(1 for l in diff_lines if l.kind == "context"),
        "minus": sum(1 for l in diff_lines if l.kind == "minus"),
        "plus": sum(1 for l in diff_lines if l.kind == "plus"),
    }
