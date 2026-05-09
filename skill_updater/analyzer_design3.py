"""Per-event analyzer for Design 3 (`fitz-fastpath-2026-04-30`).

Why a separate module from analyzer.py?
---------------------------------------
Under Design 3 the parser does NOT see the original PDF as an image —
it runs PyMuPDF (`fitz`) locally, hands the extracted TEXT to Gemini,
and only falls through to vision if the text is inadequate. To
correctly attribute a "parser miss" we have to analyze with the same
input the parser actually saw: fitz text, not the rendered PDF.

This module mirrors :mod:`analyzer` (same `Finding` shape, same retry
policy, same Gemini model) but feeds extracted text to both prompts
instead of inline PDF parts. The Design 2 vision analyzer remains the
default for older events — see :func:`pipeline._pick_analyzer`.

If we ever revert production back to Design 2, this module stops
being called automatically (the dispatcher routes Design 2 events to
:mod:`analyzer`). Deleting this file later only requires a one-line
change to :func:`pipeline._pick_analyzer`.

Public surface
--------------
``analyze_event_design3(event_id, insurance_type, code_names,
original_pdf, generated_pdf) -> Finding`` — same signature as
``analyzer.analyze_event``, drop-in compatible. Raises
``InadequateTextError`` when fitz can't extract usable text from
either PDF; the pipeline catches it and falls back to the vision
analyzer for that one event.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Optional

from dotenv import dotenv_values
from google import genai
from google.genai import types

import _fitz_fastpath
from models import Finding, GeneratedFieldRead, OriginalFieldLocation


# ── Models / retry policy (mirrors analyzer.py for parity) ────────────
ANALYZER_MODEL = "gemini-2.5-flash"
_RETRIES = 3
_RETRY_BACKOFF_SEC = 4.0


# ── Errors ────────────────────────────────────────────────────────────


class InadequateTextError(RuntimeError):
    """Raised when fitz couldn't extract usable text from a PDF.

    The pipeline catches this and falls back to the Design 2 vision
    analyzer for the offending event so a single bad text-layer doesn't
    block the run.
    """


# ── Client (duplicates analyzer.py — same env path) ───────────────────


def _api_key() -> str:
    here = Path(__file__).resolve().parent
    for env_path in (here / ".env", here.parent / "backend" / ".env"):
        if env_path.exists():
            v = dotenv_values(env_path).get("GEMINI_API_KEY")
            if v:
                return v
    v = os.environ.get("GEMINI_API_KEY")
    if not v:
        raise RuntimeError("GEMINI_API_KEY missing — set it in skill_updater/.env")
    return v


def _get_client() -> genai.Client:
    return genai.Client(api_key=_api_key())


# ── Prompts ───────────────────────────────────────────────────────────


PROMPTS_DIR = Path(__file__).resolve().parent / "prompts"


def _load_prompt(name: str) -> str:
    return (PROMPTS_DIR / name).read_text(encoding="utf-8")


# ── Generation helper (text-only — no inline PDF parts) ───────────────


def _generate_json(client: genai.Client, system_prompt: str, user_text: str) -> dict:
    """One Gemini call with strict JSON output, all-text input."""
    last_exc: Optional[Exception] = None
    for attempt in range(_RETRIES):
        try:
            resp = client.models.generate_content(
                model=ANALYZER_MODEL,
                contents=[user_text],
                config=types.GenerateContentConfig(
                    system_instruction=system_prompt,
                    response_mime_type="application/json",
                    temperature=0.1,
                    max_output_tokens=4000,
                ),
            )
            text = (resp.text or "").strip()
            if not text:
                raise RuntimeError("Empty response from Gemini")
            return json.loads(text)
        except Exception as exc:
            last_exc = exc
            if attempt + 1 < _RETRIES:
                time.sleep(_RETRY_BACKOFF_SEC * (attempt + 1))
                continue
            raise
    if last_exc:
        raise last_exc
    return {}


# ── Public API ────────────────────────────────────────────────────────


def analyze_event_design3(
    event_id: int,
    insurance_type: str,
    code_names: list[str],
    original_pdf: Optional[bytes],
    generated_pdf: Optional[bytes],
) -> Finding:
    """Run two text-vs-text Gemini calls and return a :class:`Finding`.

    Same shape as :func:`analyzer.analyze_event`, so the pipeline can
    swap them transparently. Raises :class:`InadequateTextError` if
    either PDF's fitz extraction is below the adequacy threshold —
    callers should catch this and retry with the vision analyzer.
    """
    if not code_names:
        return Finding(
            event_id=event_id,
            insurance_type=insurance_type,
            code_names_changed=[],
            generated_reads=[],
            original_locations=[],
        )

    if not generated_pdf:
        raise ValueError(f"event {event_id}: generated PDF bytes missing")
    if not original_pdf:
        raise ValueError(f"event {event_id}: original PDF bytes missing")

    # ── Extract text from BOTH PDFs locally — no network calls. ───────
    generated_text = _fitz_fastpath.extract_pdf_text(generated_pdf)
    if not _fitz_fastpath.is_text_adequate(generated_text):
        raise InadequateTextError(
            f"event {event_id}: generated PDF text inadequate "
            f"({_fitz_fastpath.describe_text(generated_text)})"
        )

    original_text = _fitz_fastpath.extract_pdf_text(original_pdf)
    if not _fitz_fastpath.is_text_adequate(original_text):
        # The original is more often image-only than the generated —
        # fall back to vision for THIS event so the analysis still runs.
        raise InadequateTextError(
            f"event {event_id}: original PDF text inadequate "
            f"({_fitz_fastpath.describe_text(original_text)})"
        )

    client = _get_client()

    # ── Step 1 — read generated PDF text ─────────────────────────────
    gen_prompt = _load_prompt("analyzer_design3_generated.md")
    gen_user = (
        "code_names to read:\n"
        + json.dumps(code_names, indent=2)
        + "\n\n=== GENERATED PDF TEXT ===\n"
        + generated_text
        + "\n=== END GENERATED PDF TEXT ===\n\n"
        + "Return the JSON object specified by your instructions."
    )
    gen_raw = _generate_json(client, gen_prompt, gen_user)
    reads_data = gen_raw.get("reads", [])
    generated_reads = [GeneratedFieldRead(**r) for r in reads_data]

    # ── Step 2 — search original PDF text ────────────────────────────
    targets = [
        {"code_name": r.code_name, "display_label": r.display_label, "value": r.value}
        for r in generated_reads
        if r.present and r.value
    ]
    original_locations: list[OriginalFieldLocation] = []
    if targets:
        orig_prompt = _load_prompt("analyzer_design3_original.md")
        orig_user = (
            "targets:\n"
            + json.dumps(targets, indent=2)
            + "\n\n=== ORIGINAL PDF TEXT ===\n"
            + original_text
            + "\n=== END ORIGINAL PDF TEXT ===\n\n"
            + "Return the JSON object specified by your instructions."
        )
        orig_raw = _generate_json(client, orig_prompt, orig_user)
        loc_data = orig_raw.get("locations", [])
        original_locations = [OriginalFieldLocation(**l) for l in loc_data]

    # Convenience lists — same logic as analyzer.py for parity.
    found_set = {l.code_name for l in original_locations if l.found_in_original}
    changed_set = set(code_names)
    parser_misses = sorted(found_set & changed_set)
    advisor_additions = sorted(
        {l.code_name for l in original_locations if not l.found_in_original} & changed_set
    )

    return Finding(
        event_id=event_id,
        insurance_type=insurance_type,
        code_names_changed=code_names,
        generated_reads=generated_reads,
        original_locations=original_locations,
        parser_misses=parser_misses,
        advisor_additions=advisor_additions,
    )
