"""skill_updater-local fitz helper.

Why a duplicate of backend/parsers/_fitz_fastpath.py?
-----------------------------------------------------
The skill_updater package is intentionally decoupled from `backend/` (no
cross-tree imports — it only loads SKILL.md files via filesystem paths).
Keeping a small fitz helper here preserves that isolation, and means the
analyzer's input matches what the backend's parser sees today (same fitz
version pinned in both requirements files).

Differences from the backend helper
-----------------------------------
- Operates on `bytes` rather than `Path`. The skill_updater fetches PDFs
  out of the `pdf_documents` table (BYTEA column), so we never have a
  filesystem path to point fitz at.
- No multi-PDF formatter — skill_updater analyzes one (original,
  generated) pair per event, no boundary labels needed.
- Same adequacy thresholds as the backend (200 chars / 0.30 alphanumeric
  ratio) so a PDF the backend treats as text-adequate is also treated
  as text-adequate here.
"""

from __future__ import annotations

import io
from typing import Optional

import fitz  # PyMuPDF


# Same thresholds as backend/parsers/_fitz_fastpath.py — keep in sync.
MIN_ADEQUATE_CHARS: int = 200
MIN_ALPHANUM_RATIO: float = 0.30


def extract_pdf_text(pdf_bytes: Optional[bytes]) -> str:
    """Extract all pages' text from PDF bytes, joined with form-feeds.

    Returns "" on any failure (corrupt PDF, no input). Callers should
    treat "" as inadequate via :func:`is_text_adequate` rather than
    special-casing here.
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
                # Skip an unreadable page rather than aborting; the
                # remaining pages may still be enough to analyze.
                pages.append("")
        return "\f".join(pages)
    finally:
        try:
            doc.close()
        except Exception:
            pass


def is_text_adequate(text: str) -> bool:
    """Return True if ``text`` looks like a usable text layer.

    Same checks as the backend helper:
      1. ``len(stripped) >= MIN_ADEQUATE_CHARS`` — rejects image-only PDFs.
      2. alphanumeric ratio ≥ ``MIN_ALPHANUM_RATIO`` — rejects junk OCR
         layers (random Unicode boxes / punctuation soup).
    """
    if not text:
        return False
    stripped = text.strip()
    if len(stripped) < MIN_ADEQUATE_CHARS:
        return False
    alnum = sum(1 for ch in stripped if ch.isalnum())
    return (alnum / len(stripped)) >= MIN_ALPHANUM_RATIO


def describe_text(text: str) -> str:
    """Return a one-line summary used for logging/debugging only."""
    if not text:
        return "0 chars  (empty)"
    stripped = text.strip()
    alnum = sum(1 for ch in stripped if ch.isalnum())
    ratio = (alnum / len(stripped)) if stripped else 0.0
    pages = text.count("\f") + 1
    return f"{len(stripped)} chars  alnum={ratio:.2f}  pages={pages}"
