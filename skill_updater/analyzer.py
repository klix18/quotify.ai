"""Per-event vision analysis.

Two LLM calls, both with vision:
  1. Read the generated PDF for the manually-changed code names → values.
  2. Search the original PDF for those values → found/not, label, context.

Returns a single ``Finding`` model that gets persisted to skill_event_analysis.
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
