"""
_fitz_fastpath.py
=================
Local PyMuPDF (fitz) text-extraction pre-pass for the unified parser.

Why this exists
---------------
Design 2 (`single-pass-cached-2026-04-21`) sends every PDF to Gemini 2.5
Flash with vision — the model OCRs and extracts in one shot. That works
on every shape of input, but burns image tokens (~10× the input cost of a
text-only call) on the ~80% of quotes that have a perfectly clean text
layer.

This module does a fitz pre-pass on the local PDF(s). When fitz returns
adequate text, the caller can skip the file upload entirely and send the
extracted text inline to Gemini — same model, same cached system
instruction, same response_schema, no image tokens. When fitz fails
(image-only PDFs, garbled OCR layers, etc.) the caller falls through to
the existing vision path so behavior is preserved on hard inputs.

Public surface
--------------
- ``extract_pdf_text(path: Path) -> str``:
      Pull every page's text out of a single PDF, joined with form-feeds.
      Returns "" on error (so callers can treat it as inadequate).

- ``is_text_adequate(text: str) -> bool``:
      Heuristic check that the extracted text is usable. Catches the
      image-only-PDF case (≈0 chars after strip) and the "OCR layer
      under the image is junk" case (very low alphanumeric ratio).

- ``build_text_payload(primary_text, primary_label=None, ...)`` ->
  ``str | None``:
      Format extracted text from one or more PDFs into a single string
      ready to drop into the user prompt. Multi-PDF inputs are wrapped
      with the SAME boundary labels the existing vision code uses
      (``── PDF #1 of 2 (HOMEOWNERS QUOTE) ──``) so the model sees the
      same vocabulary regardless of input shape. Returns None if ANY
      attached PDF's text is inadequate — the caller must then fall
      through to the vision path for the entire request, since it's
      not safe to mix one fitz page and one vision page.

Design notes
------------
- The adequacy threshold is intentionally lenient. False negatives (we
  decide fitz "failed" on a perfectly readable PDF and burn vision
  tokens) are cheap; false positives (we send junk text to the LLM and
  return wrong data) are expensive. ``MIN_ADEQUATE_CHARS=200`` and
  ``MIN_ALPHANUM_RATIO=0.3`` together caught all known good text-layer
  PDFs in the eval corpus and rejected the one image-only PDF (PRG).
- We don't try to be clever about partial extraction — if any PDF in a
  multi-PDF request is inadequate, the whole request goes through
  vision. Mixing modes per-PDF would mean uploading just one file while
  inlining text for the other, which complicates ``_build_contents``
  for marginal gain.
- ``extract_pdf_text`` swallows all exceptions and returns "" so a
  corrupt PDF never crashes the parser — the request just falls
  through to vision.

This module has no side effects, makes no network calls, and is safe
to call from a streaming generator. fitz parses pure-Python and
finishes in tens of milliseconds for typical insurance quotes.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Optional

import fitz


# Tuned against the Quotify eval corpus (13 homeowners + 5 auto PDFs).
# - 200 chars rejects empty/image-only PDFs (PRG returned 0).
# - 0.3 alphanumeric ratio rejects PDFs with a junk OCR layer that fitz
#   reads as random punctuation.
# Raise either threshold cautiously: missing text-layer PDFs is cheaper
# than passing junk text to the LLM.
MIN_ADEQUATE_CHARS: int = 200
MIN_ALPHANUM_RATIO: float = 0.3


def extract_pdf_text(pdf_path: Path) -> str:
    """Extract all pages' text from a PDF, joined with form-feeds.

    Returns "" on any failure (corrupt PDF, missing file, fitz parse
    error). Callers should treat "" as inadequate via ``is_text_adequate``
    rather than special-casing this here.
    """
    try:
        doc = fitz.open(str(pdf_path))
    except Exception:
        return ""
    try:
        pages: list[str] = []
        for page in doc:
            try:
                pages.append(page.get_text("text"))
            except Exception:
                # Skip an unreadable page rather than aborting; the
                # remaining pages may still be enough to parse.
                pages.append("")
        return "\f".join(pages)
    finally:
        try:
            doc.close()
        except Exception:
            pass


def is_text_adequate(text: str) -> bool:
    """Return True if ``text`` looks like a usable text layer.

    Two checks:
      1. ``len(stripped) >= MIN_ADEQUATE_CHARS`` — rejects image-only PDFs
         that fitz returns near-empty.
      2. alphanumeric ratio ≥ ``MIN_ALPHANUM_RATIO`` — rejects PDFs with a
         garbage OCR layer (random Unicode boxes / punctuation soup).
    """
    if not text:
        return False
    stripped = text.strip()
    if len(stripped) < MIN_ADEQUATE_CHARS:
        return False
    alnum = sum(1 for ch in stripped if ch.isalnum())
    return (alnum / len(stripped)) >= MIN_ALPHANUM_RATIO


def build_text_payload(
    primary_text: str,
    *,
    primary_label: Optional[str] = None,
    extras: Optional[list[tuple[str, str]]] = None,
) -> Optional[str]:
    """Format one or more extracted-PDF texts into a single user-prompt
    string with the same boundary labels the vision path uses.

    Args:
        primary_text: fitz output for the primary PDF.
        primary_label: optional label (e.g. ``── PDF #1 of 2 (HOMEOWNERS
            QUOTE) ──``). When None, the primary text is returned as-is
            without a header — used for single-PDF requests.
        extras: optional list of (label, text) pairs for additional PDFs
            (wind/hail supplement, bundle-separate auto). Labels MUST
            mirror the ones built in unified_parser_api.py's
            ``pdf_labels`` so the skill / supplement vocabulary lines up.

    Returns:
        A single string ready to splice into the user prompt, OR None
        if any attached PDF's text is inadequate (caller falls through
        to vision for the entire request).

    Format:
        <primary_label>\\n<primary_text>\\n\\n<extra1_label>\\n<extra1_text> …
    """
    if not is_text_adequate(primary_text):
        return None
    extras = extras or []
    for _, txt in extras:
        if not is_text_adequate(txt):
            return None

    parts: list[str] = []
    if primary_label:
        parts.append(primary_label)
    parts.append(primary_text.strip())
    for label, txt in extras:
        parts.append("")  # blank line between PDFs for readability
        parts.append(label)
        parts.append(txt.strip())
    return "\n".join(parts)


# ── Diagnostic helper (used by the parser logs) ───────────────────────


def describe_text(text: str) -> str:
    """Return a one-line summary used for logging/debugging only.

    Example: ``2912 chars  alnum=0.71  pages=2``.
    """
    if not text:
        return "0 chars  (empty)"
    stripped = text.strip()
    alnum = sum(1 for ch in stripped if ch.isalnum())
    ratio = (alnum / len(stripped)) if stripped else 0.0
    pages = text.count("\f") + 1
    return f"{len(stripped)} chars  alnum={ratio:.2f}  pages={pages}"
