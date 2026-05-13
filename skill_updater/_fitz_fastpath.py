"""skill_updater-local fitz helper.

Why a separate copy of backend/parsers/_fitz_fastpath.py?
---------------------------------------------------------
The skill_updater package is intentionally decoupled from ``backend/``
(no cross-tree imports). Keeping a small fitz helper here preserves
that isolation. Same adequacy thresholds as the backend helper so a
PDF the parser treats as text-adequate is also treated as text-adequate
here — analyzer attribution matches the input the parser actually saw.

Differences vs the backend helper
---------------------------------
- Operates on ``bytes`` rather than ``Path``. PDFs are read out of the
  ``pdf_documents`` BYTEA column, so there's no filesystem path.
- Adds ``extract_blocks_with_placement`` — returns per-page block
  records with bbox coordinates so the Design 3 analyzer can reason
  about where on the page each chunk of text appeared. The backend
  parser doesn't need bboxes (it sends raw text to Gemini); the
  analyzer does, because placement is one of the most useful signals
  the synthesizer can encode into a SKILL.md rule.
"""

from __future__ import annotations

import io
from typing import Optional, TypedDict

import fitz  # PyMuPDF


# Mirror backend/parsers/_fitz_fastpath.py thresholds — keep in sync.
MIN_ADEQUATE_CHARS: int = 200
MIN_ALPHANUM_RATIO: float = 0.30


# ── Block record shape (placement-aware) ──────────────────────────────


class BlockRecord(TypedDict):
    """One fitz text block with its bounding box.

    bbox order is fitz-native ``(x0, y0, x1, y1)`` with the origin at
    the top-left of the page in PDF points (1 pt = 1/72 inch). Values
    are rounded to integers — sub-pixel precision is irrelevant for
    "where on the page" reasoning and full-precision floats blow up
    the prompt token count.
    """

    bbox: tuple[int, int, int, int]
    text: str


class PagePlacement(TypedDict):
    """Placement-aware extraction for one PDF page."""

    page: int                    # 1-indexed
    width: int                   # page width in PDF points
    height: int                  # page height in PDF points
    blocks: list[BlockRecord]


# ── Extraction helpers ────────────────────────────────────────────────


def extract_pdf_text(pdf_bytes: Optional[bytes]) -> str:
    """Extract every page's text from PDF bytes, joined with form-feeds.

    Returns ``""`` on any failure. Callers should gate usability via
    :func:`is_text_adequate` rather than special-casing empty here.
    """
    if not pdf_bytes:
        return ""
    try:
        doc = fitz.open(stream=io.BytesIO(pdf_bytes), filetype="pdf")
    except Exception:
        return ""
    try:
        pages: list[str] = []
        for page in doc:
            try:
                pages.append(page.get_text("text"))
            except Exception:
                pages.append("")
        return "\f".join(pages)
    finally:
        try:
            doc.close()
        except Exception:
            pass


def extract_blocks_with_placement(pdf_bytes: Optional[bytes]) -> list[PagePlacement]:
    """Return per-page text blocks with bounding boxes.

    fitz's ``page.get_text("blocks")`` returns
    ``(x0, y0, x1, y1, text, block_no, block_type)`` tuples. We keep
    only text blocks (block_type == 0) and round coordinates to
    integers for prompt readability.

    Empty list on any failure — callers treat an empty list as
    "fitz couldn't extract usable placement data".
    """
    if not pdf_bytes:
        return []
    try:
        doc = fitz.open(stream=io.BytesIO(pdf_bytes), filetype="pdf")
    except Exception:
        return []
    try:
        out: list[PagePlacement] = []
        for page_index, page in enumerate(doc):
            try:
                raw_blocks = page.get_text("blocks")
            except Exception:
                continue
            blocks: list[BlockRecord] = []
            for tup in raw_blocks:
                if len(tup) < 5:
                    continue
                x0, y0, x1, y1, text = tup[0], tup[1], tup[2], tup[3], tup[4]
                # block_type at index 6 in modern fitz; default 0 (text)
                # if absent. Skip image blocks (type 1) — they have no
                # text payload useful to the analyzer.
                block_type = tup[6] if len(tup) > 6 else 0
                if block_type != 0:
                    continue
                stripped = (text or "").strip()
                if not stripped:
                    continue
                blocks.append({
                    "bbox": (int(x0), int(y0), int(x1), int(y1)),
                    "text": stripped,
                })
            if not blocks:
                continue
            out.append({
                "page": page_index + 1,
                "width": int(page.rect.width),
                "height": int(page.rect.height),
                "blocks": blocks,
            })
        return out
    finally:
        try:
            doc.close()
        except Exception:
            pass


# ── Adequacy / diagnostics ────────────────────────────────────────────


def is_text_adequate(text: str) -> bool:
    """Return True if ``text`` looks like a usable text layer.

    Same heuristics as the backend's fastpath: a minimum character
    count and a minimum alphanumeric ratio. The two thresholds
    together reject (a) image-only PDFs that fitz returns near-empty
    and (b) PDFs with a garbage OCR layer of random punctuation.
    """
    if not text:
        return False
    stripped = text.strip()
    if len(stripped) < MIN_ADEQUATE_CHARS:
        return False
    alnum = sum(1 for ch in stripped if ch.isalnum())
    return (alnum / len(stripped)) >= MIN_ALPHANUM_RATIO


def describe_text(text: str) -> str:
    """One-line summary for logging."""
    if not text:
        return "0 chars (empty)"
    stripped = text.strip()
    alnum = sum(1 for ch in stripped if ch.isalnum())
    ratio = (alnum / len(stripped)) if stripped else 0.0
    pages = text.count("\f") + 1
    return f"{len(stripped)} chars  alnum={ratio:.2f}  pages={pages}"


# ── Prompt rendering ──────────────────────────────────────────────────


def render_blocks_for_prompt(pages: list[PagePlacement], *, max_chars: int = 60000) -> str:
    """Format placement records into a compact JSON-ish text block the
    LLM can scan linearly. Keeps blocks in page-then-reading order
    (fitz returns blocks top-down, left-right within a page).

    Truncates to ``max_chars`` to keep token usage bounded on very
    long carrier PDFs — the synthesizer only needs enough context to
    write a rule, not the full document. A trailing
    ``[truncated …N more pages]`` marker tells the model what was cut.
    """
    if not pages:
        return "(no fitz blocks extracted)"
    lines: list[str] = []
    pages_emitted = 0
    for p in pages:
        header = f"--- PAGE {p['page']} (page_size={p['width']}x{p['height']}) ---"
        lines.append(header)
        for b in p["blocks"]:
            x0, y0, x1, y1 = b["bbox"]
            # Inline the text right after the bbox so the model
            # naturally associates them as one record.
            text_one_line = " ".join(b["text"].split())
            lines.append(f"  bbox=[{x0},{y0},{x1},{y1}]  text={text_one_line!r}")
        pages_emitted += 1
        rendered = "\n".join(lines)
        if len(rendered) >= max_chars:
            remaining = len(pages) - pages_emitted
            if remaining > 0:
                lines.append(f"[truncated — {remaining} more page(s) omitted to keep prompt under {max_chars} chars]")
            break
    return "\n".join(lines)


def page_region(bbox: tuple[int, int, int, int], page_width: int, page_height: int) -> str:
    """Translate a bbox into a coarse human-readable region label.

    The synthesizer doesn't need pixel-precise placement — it needs
    "top of page" vs "table at the bottom" vs "right-side sidebar".
    Buckets:

    - vertical:   top / middle / bottom (page thirds)
    - horizontal: left / center / right (page thirds)
    """
    if page_width <= 0 or page_height <= 0:
        return "unknown-region"
    x_center = (bbox[0] + bbox[2]) / 2
    y_center = (bbox[1] + bbox[3]) / 2
    horiz_third = page_width / 3.0
    vert_third = page_height / 3.0
    if x_center < horiz_third:
        h = "left"
    elif x_center < 2 * horiz_third:
        h = "center"
    else:
        h = "right"
    if y_center < vert_third:
        v = "top"
    elif y_center < 2 * vert_third:
        v = "middle"
    else:
        v = "bottom"
    return f"{v}-{h}"
