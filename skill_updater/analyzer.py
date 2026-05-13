"""Per-event analysis — Design 2 (vision-vision) and Design 3 (vision + fitz placement).

Two public entry points share a ``Finding`` shape so the pipeline can
dispatch between them based on the operator's selected design:

- :func:`analyze_event` (Design 2) — both calls use Gemini vision on
  the inline PDFs. This is the right analyzer when the parser that
  produced the event also used vision.
- :func:`analyze_event_design3` (Design 3) — Call A still runs Gemini
  vision on the generated PDF, but Call B switches to a placement-aware
  fitz extraction (page + bbox per block) handed to Gemini as text.
  Use this when the parser was on the fitz fast-path: it tests against
  the same input the parser actually saw, so "parser miss" attribution
  doesn't get blurred by the model's own OCR being more capable than
  fitz on a given carrier.

Both produce :class:`Finding` with the same ``OriginalFieldLocation``
schema. Design 3 encodes placement into ``surrounding_text`` as a
structured prefix (``page=2  region=top-right  bbox=[...]  …``) so the
schema stays stable and the synthesizer transparently picks up the
extra signal via the existing ``_findings_summary`` summary.
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

# ── Models ────────────────────────────────────────────────────────────
ANALYZER_MODEL = "gemini-2.5-flash"

# Gemini sometimes hiccups with 503 / overloaded under load. Keep retries
# small and conservative — this is an offline batch, not user-facing.
_RETRIES = 3
_RETRY_BACKOFF_SEC = 4.0


# ── Client ────────────────────────────────────────────────────────────


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


# ── Generation helpers ────────────────────────────────────────────────


def _generate_json(client: genai.Client, system_prompt: str, user_text: str, pdf_bytes: bytes) -> dict:
    """One Gemini call with strict JSON output. Inline PDF as a Part."""
    pdf_part = types.Part.from_bytes(data=pdf_bytes, mime_type="application/pdf")
    contents = [pdf_part, user_text]

    last_exc: Optional[Exception] = None
    for attempt in range(_RETRIES):
        try:
            resp = client.models.generate_content(
                model=ANALYZER_MODEL,
                contents=contents,
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


def analyze_event(
    event_id: int,
    insurance_type: str,
    code_names: list[str],
    original_pdf: Optional[bytes],
    generated_pdf: Optional[bytes],
) -> Finding:
    """Run both vision calls and return a Finding.

    Skips gracefully when PDFs are missing — caller should treat that as
    `outcome='no_pdfs'` rather than 'analyzed'."""
    if not code_names:
        # Nothing to analyze; record an empty finding.
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

    client = _get_client()

    # ── Step 1 — read generated PDF ───────────────────────────────────
    gen_prompt = _load_prompt("analyzer_generated.md")
    gen_user = (
        "code_names to read:\n"
        + json.dumps(code_names, indent=2)
        + "\n\nReturn the JSON object specified by your instructions."
    )
    gen_raw = _generate_json(client, gen_prompt, gen_user, generated_pdf)
    reads_data = gen_raw.get("reads", [])
    generated_reads = [GeneratedFieldRead(**r) for r in reads_data]

    # ── Step 2 — search original PDF ──────────────────────────────────
    targets = [
        {"code_name": r.code_name, "display_label": r.display_label, "value": r.value}
        for r in generated_reads
        if r.present and r.value
    ]
    original_locations: list[OriginalFieldLocation] = []
    if targets:
        orig_prompt = _load_prompt("analyzer_original.md")
        orig_user = (
            "targets:\n"
            + json.dumps(targets, indent=2)
            + "\n\nReturn the JSON object specified by your instructions."
        )
        orig_raw = _generate_json(client, orig_prompt, orig_user, original_pdf)
        loc_data = orig_raw.get("locations", [])
        original_locations = [OriginalFieldLocation(**l) for l in loc_data]

    # Compute convenience lists
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


# ── Design 3 — vision Call A + fitz placement Call B ──────────────────


class InadequateTextError(RuntimeError):
    """Raised when fitz couldn't extract usable text/placement from the
    original PDF. Design 3 callers should surface this so the operator
    sees clearly which events were unanalyzable (rather than silently
    falling back to vision and mixing methodologies in one run)."""


def _generate_json_text_only(client: genai.Client, system_prompt: str, user_text: str) -> dict:
    """Same retry/timeout shape as :func:`_generate_json` but no inline
    PDF part — the user_text already contains the rendered fitz blocks.
    """
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


def _annotate_with_placement(
    loc: OriginalFieldLocation,
    pages: list[_fitz_fastpath.PagePlacement],
) -> OriginalFieldLocation:
    """If the model returned a page number, prepend a region tag to
    ``surrounding_text`` derived from the page dimensions. This is the
    one bit of placement signal that the model can't reliably compute
    on its own — we have authoritative page sizes from fitz, so do the
    region bucketing ourselves and trust the model's bbox/page numbers.

    The model's prompt already asks it to format ``surrounding_text``
    with a ``page=… region=… bbox=…`` header. This function is a
    safety net for cases where the model omitted the region line — it
    splits ``surrounding_text`` looking for an explicit ``bbox=[…]``
    line and, if found, computes the region label and inserts it.
    """
    if not loc.found_in_original or not loc.surrounding_text:
        return loc
    # If a region line is already present, trust the model.
    if "region=" in loc.surrounding_text:
        return loc
    # Try to find an explicit bbox=[x0,y0,x1,y1] anywhere in the text.
    import re as _re
    m = _re.search(r"bbox=\[(-?\d+),(-?\d+),(-?\d+),(-?\d+)\]", loc.surrounding_text)
    if not m:
        return loc
    bbox = (int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4)))
    page_dim = next((p for p in pages if p["page"] == loc.page), None)
    if not page_dim:
        return loc
    region = _fitz_fastpath.page_region(bbox, page_dim["width"], page_dim["height"])
    # Prepend a region annotation line so the synthesizer summary sees it.
    new_text = f"region={region}\n{loc.surrounding_text}"
    return loc.model_copy(update={"surrounding_text": new_text})


def analyze_event_design3(
    event_id: int,
    insurance_type: str,
    code_names: list[str],
    original_pdf: Optional[bytes],
    generated_pdf: Optional[bytes],
) -> Finding:
    """Design 3 analyzer: keep Gemini vision on the generated PDF; use
    fitz placement blocks (page, bbox, text) on the original PDF, fed
    to Gemini as text.

    Output schema is identical to :func:`analyze_event` so downstream
    code (DB, synthesizer, UI) is design-agnostic. Placement information
    flows through ``OriginalFieldLocation.surrounding_text`` as a
    structured prefix the synthesizer already reads via the existing
    summary helper.

    Raises :class:`InadequateTextError` if fitz can't pull usable
    placement data from the original PDF (image-only PDF, garbled OCR
    layer, etc.). The pipeline records ``outcome='no_fitz_text'`` and
    moves on — Design 2 is the right tool for those events.
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

    # ── Extract placement from the original PDF locally — no network. ─
    pages = _fitz_fastpath.extract_blocks_with_placement(original_pdf)
    if not pages:
        flat = _fitz_fastpath.extract_pdf_text(original_pdf)
        raise InadequateTextError(
            f"event {event_id}: fitz returned no usable blocks from the "
            f"original PDF ({_fitz_fastpath.describe_text(flat)}). "
            "This event is image-only or has a mangled text layer — "
            "re-run it under Design 2 (vision) for a useful result."
        )

    client = _get_client()

    # ── Step 1 — read generated PDF (vision, same as Design 2) ────────
    gen_prompt = _load_prompt("analyzer_generated.md")
    gen_user = (
        "code_names to read:\n"
        + json.dumps(code_names, indent=2)
        + "\n\nReturn the JSON object specified by your instructions."
    )
    gen_raw = _generate_json(client, gen_prompt, gen_user, generated_pdf)
    reads_data = gen_raw.get("reads", [])
    generated_reads = [GeneratedFieldRead(**r) for r in reads_data]

    # ── Step 2 — search ORIGINAL via fitz blocks (placement-aware) ────
    targets = [
        {"code_name": r.code_name, "display_label": r.display_label, "value": r.value}
        for r in generated_reads
        if r.present and r.value
    ]
    original_locations: list[OriginalFieldLocation] = []
    if targets:
        orig_prompt = _load_prompt("analyzer_original_fitz.md")
        blocks_text = _fitz_fastpath.render_blocks_for_prompt(pages)
        orig_user = (
            "targets:\n"
            + json.dumps(targets, indent=2)
            + "\n\n=== ORIGINAL BLOCKS ===\n"
            + blocks_text
            + "\n=== END ORIGINAL BLOCKS ===\n\n"
            "Return the JSON object specified by your instructions."
        )
        orig_raw = _generate_json_text_only(client, orig_prompt, orig_user)
        loc_data = orig_raw.get("locations", [])
        original_locations = [OriginalFieldLocation(**l) for l in loc_data]
        # Annotate any locations missing an explicit `region=` line so the
        # synthesizer always sees a consistent placement vocabulary.
        original_locations = [_annotate_with_placement(l, pages) for l in original_locations]

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
