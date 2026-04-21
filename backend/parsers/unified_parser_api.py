"""
unified_parser_api.py
=====================
Single entry point for ALL insurance quote parsing.

Architecture
------------
One endpoint  →  POST /api/parse-quote?insurance_type=<type>
One model set →  gemini-2.5-flash-lite (Pass 1) + gemini-2.5-flash (Pass 2)
One system prompt (CORE_SYSTEM_PROMPT) — describes HOW to extract
Per-type skill  (parse_<type>/SKILL.md) — describes WHAT to extract;
    all carrier-specific overrides are baked into each SKILL.md under
    a `## Carrier-Specific Overrides` section.

Flow
----
0. Carrier detection (Pass 0) — LEGACY:
     Vision call → identify carrier logo → normalize to carrier key.
     Since the v2 skills library, carrier overrides live inside each
     base SKILL.md, so `load_skill_with_carrier` no longer merges a
     separate patch. The carrier key is still emitted as a telemetry
     event but does not change prompt content.
   Emits: carrier_detected event

1. Skill load + PDF upload

2. Pass 1 (quick draft):
     system = CORE_SYSTEM_PROMPT
     user   = quick_user_prompt + skill (with carrier overrides baked in) + quick-pass field list
   → streams draft_patch events to frontend

3. Pass 2 (strict JSON):
     system = CORE_SYSTEM_PROMPT + full skill (with carrier overrides baked in)
     user   = strict extract prompt
     response_schema = type-specific JSON schema
   → streams final_patch + result events to frontend

4. Self-Healing Retry (Pass 3):
     Inspect confidence scores from Pass 2.
     If any extractable field has confidence < HEALING_THRESHOLD, fire a
     targeted Pass 3 asking ONLY for those specific low-confidence fields,
     providing their current (uncertain) values as context.
     Merge improvements back into data.
   Emits: healing_patch events for each improved field

5. Generic post-process (fill defaults from schema, flatten confidence)

Extending
---------
To add a new insurance type:
  1. Create parsers/skills/parse_<type>/SKILL.md with YAML frontmatter
     (name, description) and a `> VERSION:` line in the body.
  2. Add a registry entry in parsers/schema_registry.py
  That's it.

To add carrier-specific hints:
  1. Append a `### <Carrier Name>` subsection under the base skill's
     `## Carrier-Specific Overrides` section in parse_<type>/SKILL.md.
  2. Add the carrier name to CARRIER_ALIASES in carrier_detector.py (if new)
     — currently only used for telemetry.
  No other changes needed.

To swap the AI model:
  Change MODEL_QUICK / MODEL_FINAL constants below.
  All types instantly use the new model.
"""

from __future__ import annotations

import json
import os
import re
import tempfile
from pathlib import Path
from typing import Iterator

from dotenv import load_dotenv
from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from google import genai
from google.genai import types

from parsers._model_fallback import (
    DEFAULT_FINAL_FALLBACKS,
    DEFAULT_QUICK_FALLBACKS,
    generate_with_fallback,
    stream_with_fallback,
    upload_with_retry,
)
from parsers._openai_fallback import stream_openai_extraction
from parsers.carrier_detector import detect_carrier
from parsers.skill_loader import (
    get_quick_pass_fields,
    get_skill_version,
    load_skill,
    load_skill_with_carrier,
)
from parsers.post_process import post_process
from parsers.schema_registry import get_registration, supported_types
from pdf_storage_helpers import store_uploaded_pdf

load_dotenv()

router = APIRouter()

# ── Model configuration — change here to upgrade ALL types at once ──
MODEL_QUICK: str = "gemini-2.5-flash-lite"   # Pass 0 + Pass 1: fast draft
MODEL_FINAL: str = "gemini-2.5-flash"        # Pass 2: strict JSON
MODEL_HEAL:  str = "gemini-2.5-flash"        # Pass 3: targeted self-healing

# ── Self-Healing configuration ──────────────────────────────────────
# Fields with confidence < this threshold are retried in Pass 3.
HEALING_THRESHOLD: float = 0.45
# Maximum number of low-confidence fields to retry in a single Pass 3.
# Keeps the healing prompt focused and fast.
HEALING_MAX_FIELDS: int = 8


# ── Pass 1 system prompt — key:value quick draft ───────────────────
#
# Intentionally simple. The model MUST output "field_key: value" lines.
# Using CORE_SYSTEM_PROMPT here would conflict ("Return ONLY JSON")
# and cause the model to output JSON instead of key:value lines,
# breaking _parse_quick_pass_lines and killing streaming.
#
QUICK_PASS_SYSTEM_PROMPT = """\
You are a fast insurance document field extractor.
Your ONLY job is to scan the PDF and output field values as quickly as possible.

Output ONLY lines in this exact format (one per line, nothing else):
field_key: value

Rules:
- One field per line, no blank lines between fields
- Skip fields you cannot identify — do NOT guess
- Do NOT output JSON, markdown, explanations, or any other format
- Prefer speed over perfection — Pass 2 will clean up
"""

# ── Pass 2 system prompt — strict structured JSON ──────────────────
#
# Used for Pass 2 (strict JSON with response_schema) and Pass 3 (healing).
# The WHAT is injected per-call from the skill .md file.
#
CORE_SYSTEM_PROMPT = """\
You are an expert insurance document data extractor.
You receive insurance quote PDFs and extract structured data precisely following
your active skill (provided in the user message).

═══ EXTRACTION METHODOLOGY ════════════════════════════════════════════

ACCURACY RULES
• Return ONLY the JSON object. No commentary, no markdown code fences.
• If a field cannot be found, return "" for strings, [] for arrays.
• NEVER fabricate, guess, or hallucinate values. Missing data ("") is
  always better than a wrong value. Wrong data causes real harm.
• Read EVERY page of the document before extracting. Critical fields
  often appear on the last page or in underwriting/rating sections.
• Preserve money formatting with a leading $:  "$1,015.00", "$153,814".
• Split limits must use the " / " separator:  "$100,000 / $300,000".
• Format all dates as MM/DD/YYYY when possible.

CONFIDENCE SCORING
For EVERY extracted field, provide a confidence score (0.0 – 1.0) in the
"confidence" object. The confidence object must mirror the exact structure
of the data.

  0.95–1.0  = value clearly printed / unambiguous on the document
  0.85–0.94 = high confidence, minor ambiguity (slightly blurry, etc.)
  0.60–0.84 = moderate confidence, inferred or partially visible
  0.30–0.59 = low confidence, best guess from context
  0.0–0.29  = very uncertain; field may not exist in the document

For fields set to "" (not found), rate how certain you are the field is
genuinely ABSENT:
  0.90+      = thoroughly searched; field is definitely not present
  0.50–0.89  = searched but may have missed it
  <0.50      = uncertain whether the document contains this field

═══ ACTIVE SKILL ═══════════════════════════════════════════════════════
The user message contains the active skill for this extraction.
Follow its field definitions, aliases, carrier hints, and rules exactly.
"""


# ── Gemini client (shared singleton) ───────────────────────────────

def _get_client() -> genai.Client:
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise ValueError("GEMINI_API_KEY is not set.")
    return genai.Client(api_key=api_key)


# ── Quick-pass line parser (type-aware) ────────────────────────────

def _parse_quick_pass_lines(text: str, all_keys: list[str]) -> dict:
    """
    Parse key:value lines from Pass 1 into a dict.
    Accepts any key that is either in all_keys or contains '_' (for numbered
    fields like driver_1_name, vehicle_2_vin used by auto/dwelling parsers).
    """
    found = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or ":" not in line:
            continue
        key, _, value = line.partition(":")
        key = key.strip()
        value = value.strip()
        if value and (key in all_keys or re.match(r"[a-z][a-z0-9]*_\d+_", key)):
            found[key] = value
    return found


def _try_parse_json(text: str) -> dict:
    """
    Attempt to parse complete or partial JSON from streaming text.

    Tries progressively more aggressive recovery strategies so one misplaced
    byte from the LLM doesn't nuke the entire parse:
      1. Straight json.loads (the happy path — almost always hits this).
      2. Strip ``` code fences a model sometimes wraps output in.
      3. Substring between first '{' and last '}' — handles a preamble
         or trailing prose accidentally emitted by the model.
      4. Balanced-brace truncation — scans forward from the first '{',
         tracking brace/string state, and parses the longest valid
         prefix that closes cleanly. This saves us when the stream was
         cut off mid-object (auto schema is large and occasionally hits
         max output tokens).
    Returns {} only if every strategy fails; the caller can fall back
    to schema defaults in that case.
    """
    # 1. Happy path
    try:
        return json.loads(text, strict=False)
    except Exception:
        pass

    # 2. Strip markdown fences
    stripped = text.strip()
    if stripped.startswith("```"):
        # Remove leading ```json or ```
        stripped = re.sub(r"^```(?:json)?\s*", "", stripped)
        stripped = re.sub(r"\s*```\s*$", "", stripped)
        try:
            return json.loads(stripped, strict=False)
        except Exception:
            pass

    # 3. Slice to the outermost { ... }
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end > start:
        try:
            return json.loads(text[start:end + 1], strict=False)
        except Exception:
            pass

    # 4. Balanced-brace truncation — walk forward from the first '{'
    #    and remember the last position at which depth returned to 0
    #    (i.e. the last cleanly-closed top-level object). Parse up to
    #    that point. This recovers gracefully from mid-object truncation.
    if start != -1:
        depth = 0
        in_string = False
        escape = False
        last_complete = -1
        for i in range(start, len(text)):
            ch = text[i]
            if escape:
                escape = False
                continue
            if ch == "\\" and in_string:
                escape = True
                continue
            if ch == '"':
                in_string = not in_string
                continue
            if in_string:
                continue
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    last_complete = i
        if last_complete > start:
            try:
                return json.loads(text[start:last_complete + 1], strict=False)
            except Exception:
                pass

    return {}


# ── Self-healing helpers ───────────────────────────────────────────

def _flatten_confidence(conf: dict, prefix: str = "") -> dict[str, float]:
    """
    Flatten a nested confidence dict into {dotted.key: score} pairs.
    Only includes leaf values that are floats/ints.
    """
    flat = {}
    for k, v in conf.items():
        full_key = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            flat.update(_flatten_confidence(v, full_key))
        elif isinstance(v, list):
            for i, item in enumerate(v):
                if isinstance(item, dict):
                    flat.update(_flatten_confidence(item, f"{full_key}[{i}]"))
                elif isinstance(item, (int, float)):
                    flat[f"{full_key}[{i}]"] = float(item)
        elif isinstance(v, (int, float)):
            flat[full_key] = float(v)
    return flat


def _get_nested(d: dict, dotted_key: str):
    """Retrieve a value from a nested dict using a dotted key path."""
    keys = re.split(r"[.\[\]]", dotted_key)
    val = d
    for k in keys:
        if not k:
            continue
        try:
            val = val[int(k)] if isinstance(val, list) else val[k]
        except (KeyError, IndexError, TypeError):
            return None
    return val


def _find_low_confidence_fields(
    data: dict,
    confidence: dict,
    threshold: float,
    max_fields: int,
) -> list[dict]:
    """
    Find fields where confidence < threshold.

    Returns a list of dicts:
      [{"key": "dwelling", "current": "$0", "confidence": 0.3}, ...]

    Only returns top-level string fields for simplicity — nested arrays
    like drivers/vehicles are excluded from healing (too complex to merge).
    Skips fields that are already empty-string with high absence confidence.
    """
    flat_conf = _flatten_confidence(confidence)
    candidates = []

    for dotted_key, score in flat_conf.items():
        # Skip array-nested fields (contain brackets)
        if "[" in dotted_key:
            continue
        # Skip if already confident it's absent
        current_val = _get_nested(data, dotted_key)
        if current_val in ("", None) and score >= 0.85:
            continue
        if score < threshold:
            candidates.append({
                "key": dotted_key,
                "current": str(current_val) if current_val is not None else "",
                "confidence": round(score, 3),
            })

    # Sort by lowest confidence first, take top N
    candidates.sort(key=lambda x: x["confidence"])
    return candidates[:max_fields]


def _build_healing_prompt(
    insurance_type: str,
    low_conf_fields: list[dict],
    skill_content: str,
    pdf_count: int = 1,
) -> str:
    """Build the Pass 3 targeted re-extraction prompt."""
    field_lines = "\n".join(
        f"  {f['key']}: (current value: {f['current']!r}, confidence: {f['confidence']})"
        for f in low_conf_fields
    )
    doc_phrase = "this PDF" if pdf_count == 1 else f"these {pdf_count} PDFs"
    multi_doc_hint = (
        " (read BOTH documents — the active skill tells you which fields "
        "come from which PDF)"
        if pdf_count > 1 else ""
    )
    return (
        f"ACTIVE SKILL: {insurance_type.upper()} INSURANCE\n\n"
        f"{skill_content}\n\n"
        "---\n"
        f"The following fields from {doc_phrase}{multi_doc_hint} were extracted "
        "with LOW CONFIDENCE and need a second look:\n\n"
        f"{field_lines}\n\n"
        "Please re-examine the document carefully and return ONLY a JSON object "
        "with these specific keys. Use the exact key names listed above.\n"
        "Rules:\n"
        '• If you find a better value, return it.\n'
        '• If the current value was correct, return it unchanged.\n'
        '• If the field genuinely does not exist, return "" for that key.\n'
        "• Return ONLY the JSON object, no prose, no markdown."
    )


# ── Core streaming pipeline ────────────────────────────────────────

def stream_unified_quote(
    pdf_path: Path,
    insurance_type: str,
    model_quick: str = MODEL_QUICK,
    model_final: str = MODEL_FINAL,
    model_quick_fallbacks=DEFAULT_QUICK_FALLBACKS,
    model_final_fallbacks=DEFAULT_FINAL_FALLBACKS,
    wind_pdf_path: Path | None = None,
    secondary_pdf_path: Path | None = None,
) -> Iterator[str]:
    """
    3-pass extraction pipeline for any insurance type.

    Yields ndjson strings:
      {"type": "status",           "message": "..."}
      {"type": "skill_loaded",     "skill_type": "...", "version": "..."}
      {"type": "carrier_detected", "carrier_key": "...", "raw": "...", "hint_loaded": bool}
      {"type": "draft_patch",      "data": {...}}
      {"type": "final_patch",      "data": {...}}
      {"type": "healing_patch",    "data": {...}, "fields_healed": [...]}
      {"type": "result",           "data": {...}, "confidence": {...},
                                   "skill_version": "...", "carrier_key": "..."}
      {"type": "error",            "error": "..."}
    """
    client = _get_client()
    uploaded_file = None
    uploaded_wind_file = None
    uploaded_secondary_file = None

    try:
        # ── Load base skill and registry ────────────────────────
        try:
            base_skill_content = load_skill(insurance_type)
            skill_version = get_skill_version(insurance_type)
            quick_fields = get_quick_pass_fields(insurance_type)
        except FileNotFoundError as e:
            yield json.dumps({"type": "error", "error": str(e)}) + "\n"
            return

        # ── Load wind/hail supplemental skill (separate-mode only) ──
        wind_skill_content = ""
        if wind_pdf_path is not None:
            try:
                wind_skill_content = load_skill("wind_hail")
            except FileNotFoundError:
                # Non-fatal: if the wind skill file is missing, fall back
                # to a minimal inline instruction so the extraction still
                # runs. Skill file should normally exist in skills/.
                wind_skill_content = (
                    "## Wind/Hail Supplement\n"
                    "A second PDF is attached containing a standalone wind/hail "
                    "quote. Extract its wind/hail deductible into the primary "
                    "quote's wind_hail_deductible field, and ADD its total "
                    "premium to the primary quote's total_premium."
                )

        # ── Load bundle-separate supplemental skill (bundle separate mode) ──
        # When the user uploads TWO separate PDFs for a bundle (one
        # homeowners quote + one auto quote), the base parse_bundle skill
        # alone isn't enough — the model needs explicit guidance that
        # PDF #1 is homeowners and PDF #2 is auto, otherwise it treats
        # both as one combined document and under-extracts auto fields.
        bundle_separate_skill_content = ""
        if insurance_type == "bundle" and secondary_pdf_path is not None:
            try:
                bundle_separate_skill_content = load_skill("bundle_separate")
            except FileNotFoundError:
                # Non-fatal fallback — keep the parse working even if the
                # supplement file is missing from the skills/ folder.
                bundle_separate_skill_content = (
                    "## Bundle Separate-Mode Supplement\n"
                    "TWO PDFs are attached. PDF #1 is the HOMEOWNERS quote — "
                    "apply homeowners rules to extract all home fields from it. "
                    "PDF #2 is the AUTO quote — apply auto rules to extract all "
                    "vehicle/driver/coverage fields from it. Do NOT expect auto "
                    "fields in PDF #1 or home fields in PDF #2."
                )

        registration = get_registration(insurance_type)
        schema = registration["schema"]
        all_keys = registration["all_keys"]
        status_msg = registration["status_msg"]
        why_type = registration["why_selected_type"]

        yield json.dumps({
            "type": "skill_loaded",
            "skill_type": insurance_type,
            "version": skill_version,
        }) + "\n"

        # ── Upload PDF ──────────────────────────────────────────
        yield json.dumps({"type": "status", "message": f"Reading {insurance_type} quote..."}) + "\n"

        uploaded_file = upload_with_retry(
            client,
            file=str(pdf_path),
            config={"mime_type": "application/pdf"},
        )

        # ── Upload optional wind/hail PDF (separate-mode only) ──
        if wind_pdf_path is not None:
            yield json.dumps({"type": "status", "message": "Reading wind/hail quote..."}) + "\n"
            uploaded_wind_file = upload_with_retry(
                client,
                file=str(wind_pdf_path),
                config={"mime_type": "application/pdf"},
            )

        # ── Upload optional generic second PDF (bundle separate mode) ──
        if secondary_pdf_path is not None:
            yield json.dumps({"type": "status", "message": "Reading secondary quote..."}) + "\n"
            uploaded_secondary_file = upload_with_retry(
                client,
                file=str(secondary_pdf_path),
                config={"mime_type": "application/pdf"},
            )

        # ────────────────────────────────────────────────────────
        # PASS 0 — Carrier Detection (vision-based, LEGACY)
        # Fast, non-blocking: identifies the carrier logo on page 1.
        # Since the v2 skills library (2026-04-20), carrier overrides
        # are baked into parse_<type>/SKILL.md, so this step no longer
        # swaps in a per-carrier patch. The carrier key is still
        # emitted as a telemetry event.
        # ────────────────────────────────────────────────────────
        yield json.dumps({"type": "status", "message": "Identifying carrier..."}) + "\n"

        detection = detect_carrier(uploaded_file, client)
        carrier_key = detection["carrier_key"]

        # Load skill (carrier overrides are baked into the base SKILL.md).
        # load_skill_with_carrier() returns (base_skill, False) in v2 but
        # is kept here for API stability with the legacy signature.
        skill_content, patch_loaded = load_skill_with_carrier(insurance_type, carrier_key)

        # Append the wind/hail supplemental skill when a second PDF is
        # present. The wind skill's instructions tell the model how to
        # merge the wind/hail deductible and sum the premium.
        if uploaded_wind_file is not None and wind_skill_content:
            skill_content = (
                skill_content
                + "\n\n"
                + "━" * 60 + "\n"
                + "## WIND / HAIL SUPPLEMENT — SECOND PDF ATTACHED\n"
                + "A standalone wind/hail quote has been provided as a SECOND PDF.\n"
                + "Follow the rules below to merge its values into the primary quote.\n"
                + "━" * 60 + "\n\n"
                + wind_skill_content
            )

        # Append the bundle-separate supplement when the user uploaded
        # two separate PDFs (one homeowners, one auto) for a bundle.
        # Without this, the model treats both PDFs as a single combined
        # document and under-extracts auto fields.
        if uploaded_secondary_file is not None and bundle_separate_skill_content:
            skill_content = (
                skill_content
                + "\n\n"
                + "━" * 60 + "\n"
                + "## BUNDLE SEPARATE-MODE SUPPLEMENT — TWO PDFS ATTACHED\n"
                + "PDF #1 = HOMEOWNERS quote. PDF #2 = AUTO quote.\n"
                + "Apply homeowners rules to PDF #1 fields, auto rules to PDF #2 fields.\n"
                + "━" * 60 + "\n\n"
                + bundle_separate_skill_content
            )

        yield json.dumps({
            "type": "carrier_detected",
            "carrier_key": carrier_key,
            "raw": detection["raw"],
            "hint_loaded": patch_loaded,
        }) + "\n"

        # ────────────────────────────────────────────────────────
        # PASS 1 — Quick draft (fast, key:value lines)
        # System: CORE_SYSTEM_PROMPT (methodology only)
        # User:   quick extract request + merged skill + quick-pass field list
        # ────────────────────────────────────────────────────────
        # Count of PDFs actually attached so the prompt can say "TWO PDFs"
        # instead of "this PDF" when we're in wind/hail or bundle-separate
        # mode. Singular wording demonstrably leads Gemini to ignore the
        # second attachment.
        pdf_count = 1 + (1 if uploaded_wind_file is not None else 0) + (1 if uploaded_secondary_file is not None else 0)
        pdf_phrase = "this PDF" if pdf_count == 1 else f"these {pdf_count} PDFs"

        fields_list = "\n".join(f"  {f}" for f in quick_fields) if quick_fields else "  (see skill for fields)"
        quick_user_prompt = (
            f"ACTIVE SKILL: {insurance_type.upper()} INSURANCE"
            + (f" — {carrier_key.replace('_', ' ').title()}" if carrier_key != "unknown" else "")
            + f"\n\n{skill_content}\n\n"
            "---\n"
            f"Quickly extract likely fields from {pdf_phrase} "
            + ("(read BOTH documents in order — PDF #1 first, PDF #2 second). " if pdf_count > 1 else "")
            + f"This is a {insurance_type} quote.\n"
            "Output ONLY lines in this exact format (one per line):\n"
            "field_key: value\n\n"
            "Priority fields:\n"
            f"{fields_list}\n\n"
            "Skip fields you cannot identify. Do not explain anything. Prefer speed over perfection."
        )

        # Shared PDF label list — identifies which policy each attached PDF
        # represents. Used by both the Gemini ``_build_contents`` helper
        # (below) and the OpenAI fallback lambdas (``pdf_labels=`` kw-arg).
        # Keep these in sync so the model sees the SAME boundary markers
        # regardless of which provider handles the pass.
        pdf_labels: list[str] = []
        if pdf_count == 1:
            pdf_labels = []  # single-PDF case: no markers
        else:
            if insurance_type == "bundle" and uploaded_secondary_file is not None:
                pdf_labels.append("── PDF #1 of 2 (HOMEOWNERS QUOTE) ──")
            elif uploaded_wind_file is not None:
                pdf_labels.append(f"── PDF #1 of 2 ({insurance_type.upper()} QUOTE) ──")
            else:
                pdf_labels.append("── PDF #1 ──")
            if uploaded_wind_file is not None:
                pdf_labels.append("── PDF #2 of 2 (WIND / HAIL QUOTE) ──")
            if uploaded_secondary_file is not None:
                pdf_labels.append(
                    "── PDF #2 of 2 (AUTO QUOTE) ──"
                    if insurance_type == "bundle"
                    else "── PDF #2 of 2 ──"
                )

        # Matching extra-PDFs list for the OpenAI fallback: primary is always
        # ``pdf_path``, and anything else we attached on the Gemini side we
        # also need to attach on the OpenAI side or the fallback will silently
        # drop the secondary PDF and regress to only-PDF-#1 extraction.
        extra_pdf_paths: list[Path] = []
        if wind_pdf_path is not None:
            extra_pdf_paths.append(wind_pdf_path)
        if secondary_pdf_path is not None:
            extra_pdf_paths.append(secondary_pdf_path)

        # Build a contents-list builder that interleaves text markers
        # between the file parts so the Gemini model has unambiguous
        # boundaries. Without these markers, Gemini frequently treats both
        # PDFs as one document and under-extracts from the second attachment.
        def _build_contents(prompt: str) -> list:
            parts: list = [prompt]
            if pdf_count == 1:
                parts.append(uploaded_file)
                return parts
            # Interleave labels with files. pdf_labels order matches the
            # file attachment order: [primary, wind?, secondary?].
            files_in_order: list = [uploaded_file]
            if uploaded_wind_file is not None:
                files_in_order.append(uploaded_wind_file)
            if uploaded_secondary_file is not None:
                files_in_order.append(uploaded_secondary_file)
            for label, f in zip(pdf_labels, files_in_order):
                parts.append(f"\n{label}\n")
                parts.append(f)
            return parts

        quick_contents = _build_contents(quick_user_prompt)

        quick_text = ""
        sent_draft: dict = {}
        quick_stream = stream_with_fallback(
            client,
            model_quick,
            model_quick_fallbacks,
            contents=quick_contents,
            config=types.GenerateContentConfig(
                system_instruction=QUICK_PASS_SYSTEM_PROMPT,
                temperature=0,
            ),
            openai_fallback=lambda: stream_openai_extraction(
                pdf_path,
                system_instruction=QUICK_PASS_SYSTEM_PROMPT,
                user_prompt=quick_user_prompt,
                extra_pdf_paths=extra_pdf_paths,
                pdf_labels=pdf_labels,
            ),
        )

        for chunk in quick_stream:
            text = chunk.text or ""
            if not text:
                continue
            quick_text += text
            found = _parse_quick_pass_lines(quick_text, all_keys)
            patch = {k: v for k, v in found.items() if sent_draft.get(k) != v}
            if patch:
                sent_draft.update(patch)
                yield json.dumps({"type": "draft_patch", "data": patch}) + "\n"

        # Draft "Why Selected" after Pass 1
        from why_selected_generator import generate_why_selected_draft, generate_why_selected_refine
        draft_bullets = generate_why_selected_draft(dict(sent_draft), why_type)
        if draft_bullets:
            yield json.dumps({"type": "draft_patch", "data": {"why_selected": draft_bullets}}) + "\n"

        # ────────────────────────────────────────────────────────
        # PASS 2 — Strict structured JSON
        # System: CORE_SYSTEM_PROMPT + full skill (carrier overrides baked in)
        # User:   strict extract request
        # response_schema: type-specific JSON schema
        # ────────────────────────────────────────────────────────
        yield json.dumps({"type": "status", "message": status_msg}) + "\n"

        system_with_skill = (
            CORE_SYSTEM_PROMPT
            + "\n\n═══ ACTIVE SKILL: "
            + insurance_type.upper()
            + (f" — {carrier_key.replace('_', ' ').title()}" if carrier_key != "unknown" else "")
            + " ═══════════════════════\n\n"
            + skill_content
        )

        if pdf_count > 1:
            final_user_prompt = (
                f"Extract all {insurance_type} insurance quote fields from {pdf_phrase}. "
                "Read BOTH documents — do NOT stop after the first one. "
                "PDF #1 is attached first; PDF #2 is attached second. "
                "Apply the active skill (including any separate-mode supplement) "
                "to determine which fields come from which PDF."
            )
        else:
            final_user_prompt = f"Extract all {insurance_type} insurance quote fields from this PDF."

        # Same labeled-interleave pattern as Pass 1 — keep the boundaries
        # visible so Gemini reads BOTH PDFs and doesn't stop after the first.
        final_contents = _build_contents(final_user_prompt)

        full_text = ""
        sent_final: dict = {}
        final_stream = stream_with_fallback(
            client,
            model_final,
            model_final_fallbacks,
            contents=final_contents,
            config=types.GenerateContentConfig(
                system_instruction=system_with_skill,
                temperature=0,
                response_mime_type="application/json",
                response_schema=schema,
            ),
            openai_fallback=lambda: stream_openai_extraction(
                pdf_path,
                system_instruction=system_with_skill,
                user_prompt=(
                    final_user_prompt
                    + " Return ONLY a valid JSON object matching the schema "
                    "described in the system prompt. No prose, no markdown "
                    "code fences — just the JSON object."
                ),
                json_schema=schema,
                extra_pdf_paths=extra_pdf_paths,
                pdf_labels=pdf_labels,
            ),
        )

        for chunk in final_stream:
            text = chunk.text or ""
            if not text:
                continue
            full_text += text
            partial = _try_parse_json(full_text)
            if partial:
                partial.pop("confidence", None)
                partial_json = json.dumps(partial, sort_keys=True)
                if partial_json != json.dumps(sent_final, sort_keys=True):
                    sent_final = dict(partial)
                    yield json.dumps({"type": "final_patch", "data": partial}) + "\n"

        # ── Post-process Pass 2 result ─────────────────────────
        # Use the lenient _try_parse_json helper (code-fence strip,
        # substring-between-braces, balanced-brace truncation) so one
        # dropped byte from the LLM doesn't kill the whole parse. If
        # every recovery strategy fails we still raise — but with a
        # user-friendly message rather than json.JSONDecodeError's
        # "Expecting ':' delimiter: line X column Y (char Z)".
        parsed = _try_parse_json(full_text)
        if not parsed:
            raise ValueError(
                "The AI returned malformed JSON that couldn't be recovered. "
                "This is usually a transient LLM issue — please try again."
            )
        data, confidence = post_process(parsed, schema)

        # ────────────────────────────────────────────────────────
        # PASS 3 — Self-Healing Retry
        # Find fields where Pass 2 confidence < HEALING_THRESHOLD
        # and fire a targeted re-extraction for only those fields.
        # ────────────────────────────────────────────────────────
        low_conf_fields = _find_low_confidence_fields(
            data, confidence, HEALING_THRESHOLD, HEALING_MAX_FIELDS
        )

        if low_conf_fields:
            yield json.dumps({
                "type": "status",
                "message": f"Re-checking {len(low_conf_fields)} uncertain field(s)...",
            }) + "\n"

            healing_prompt = _build_healing_prompt(
                insurance_type, low_conf_fields, skill_content, pdf_count=pdf_count
            )

            heal_contents = _build_contents(healing_prompt)

            try:
                heal_resp = generate_with_fallback(
                    client,
                    MODEL_HEAL,
                    DEFAULT_FINAL_FALLBACKS,
                    contents=heal_contents,
                    config=types.GenerateContentConfig(
                        system_instruction=CORE_SYSTEM_PROMPT,
                        temperature=0,
                    ),
                )
                heal_text = (heal_resp.text or "").strip()
                healed = _try_parse_json(heal_text)

                if healed:
                    # Only accept improvements — don't overwrite confident values
                    # with empty strings from a confused healing pass
                    improved_fields = []
                    for field_info in low_conf_fields:
                        key = field_info["key"]
                        if key in healed:
                            new_val = healed[key]
                            old_val = data.get(key, "")
                            # Accept the new value if:
                            #  1. It's non-empty (healing found something), OR
                            #  2. The old value was also empty (confirming absence)
                            if new_val or not old_val:
                                data[key] = new_val
                                improved_fields.append(key)

                    if improved_fields:
                        heal_patch = {k: data[k] for k in improved_fields}
                        yield json.dumps({
                            "type": "healing_patch",
                            "data": heal_patch,
                            "fields_healed": improved_fields,
                        }) + "\n"

            except Exception as heal_exc:
                # Self-healing failure is non-fatal — result still has Pass 2 data
                yield json.dumps({
                    "type": "status",
                    "message": f"Self-healing skipped: {heal_exc}",
                }) + "\n"

        # ── Finalize Why Selected ───────────────────────────────
        yield json.dumps({"type": "status", "message": "Generating plan summary..."}) + "\n"
        data["why_selected"] = generate_why_selected_refine(data, draft_bullets, why_type)

        yield json.dumps({
            "type": "result",
            "data": data,
            "confidence": confidence,
            "skill_version": skill_version,
            "carrier_key": carrier_key,
        }) + "\n"

    except Exception as exc:
        yield json.dumps({"type": "error", "error": str(exc)}) + "\n"

    finally:
        if uploaded_file is not None:
            try:
                client.files.delete(name=uploaded_file.name)
            except Exception:
                pass
        if uploaded_wind_file is not None:
            try:
                client.files.delete(name=uploaded_wind_file.name)
            except Exception:
                pass
        if uploaded_secondary_file is not None:
            try:
                client.files.delete(name=uploaded_secondary_file.name)
            except Exception:
                pass
        # Remove the local temp PDF the route wrote to disk. Without this
        # every parse leaks a file into the OS temp dir — harmless per
        # request but fills the disk under sustained load.
        try:
            pdf_path.unlink(missing_ok=True)
        except Exception:
            pass
        if wind_pdf_path is not None:
            try:
                wind_pdf_path.unlink(missing_ok=True)
            except Exception:
                pass
        if secondary_pdf_path is not None:
            try:
                secondary_pdf_path.unlink(missing_ok=True)
            except Exception:
                pass


# ── FastAPI endpoint ────────────────────────────────────────────────

@router.post("/api/parse-quote")
async def parse_quote(
    insurance_type: str = Query(
        ...,
        description=f"Insurance type. Supported: {supported_types()}",
    ),
    file: UploadFile = File(...),
    wind_file: UploadFile | None = File(None),
    secondary_file: UploadFile | None = File(None),
):
    """
    Unified insurance quote parser.

    Accepts any insurance type via the `insurance_type` query parameter
    and uses the matching skill + schema for extraction.

    Optional `wind_file` — a standalone wind/hail quote PDF that supplements
    the primary homeowners or dwelling quote. When provided, the extractor
    merges its wind/hail deductible into the primary quote and sums its
    total premium into the primary quote's total_premium.

    Optional `secondary_file` — a generic second PDF attached alongside the
    primary one. Used for the bundle "separate" mode where the homeowners
    and auto portions arrive as two distinct PDFs. The parser hands both
    files to the model and lets the bundle skill extract from both. Unlike
    `wind_file`, the wind/hail skill supplement is NOT injected.

    Stream events (ndjson):
      skill_loaded     — skill file loaded and version confirmed
      carrier_detected — carrier identified from document logo
      draft_patch      — progressive field updates from Pass 1
      final_patch      — progressive field updates from Pass 2
      healing_patch    — field corrections from Pass 3 self-healing
      result           — final extracted data with confidence scores
      error            — non-recoverable error
    """
    try:
        get_registration(insurance_type)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    try:
        load_skill(insurance_type)
    except FileNotFoundError as e:
        raise HTTPException(status_code=400, detail=str(e))

    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
        content = await file.read()
        tmp.write(content)
        pdf_path = Path(tmp.name)

    # Persist the uploaded PDF so it shows up in the snapshot history.
    # Best-effort: a DB hiccup must not fail the extraction request
    # (same pattern used for generated PDFs in fillers/*_filler_api.py).
    try:
        await store_uploaded_pdf(
            file_data=content,
            file_name=file.filename or "upload.pdf",
            insurance_type=insurance_type,
        )
    except Exception:
        pass

    # Save the optional wind/hail PDF to a temp file as well. The parser
    # will read it, extract the wind values, and merge into the primary
    # quote. If the field is not provided, wind_pdf_path stays None and
    # the parser behaves exactly as before.
    wind_pdf_path: Path | None = None
    if wind_file is not None and getattr(wind_file, "filename", None):
        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as wtmp:
            wind_content = await wind_file.read()
            wtmp.write(wind_content)
            wind_pdf_path = Path(wtmp.name)

        # Also persist the wind PDF to snapshot history.
        try:
            await store_uploaded_pdf(
                file_data=wind_content,
                file_name=wind_file.filename or "wind.pdf",
                insurance_type=insurance_type,
            )
        except Exception:
            pass

    # Save the optional generic second PDF (bundle separate mode). Like
    # wind_file, we persist it to snapshot history and attach it as a second
    # part to the model — but without the wind/hail skill supplement.
    secondary_pdf_path: Path | None = None
    if secondary_file is not None and getattr(secondary_file, "filename", None):
        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as stmp:
            secondary_content = await secondary_file.read()
            stmp.write(secondary_content)
            secondary_pdf_path = Path(stmp.name)

        try:
            await store_uploaded_pdf(
                file_data=secondary_content,
                file_name=secondary_file.filename or "secondary.pdf",
                insurance_type=insurance_type,
            )
        except Exception:
            pass

    return StreamingResponse(
        stream_unified_quote(
            pdf_path,
            insurance_type,
            wind_pdf_path=wind_pdf_path,
            secondary_pdf_path=secondary_pdf_path,
        ),
        media_type="application/x-ndjson",
        headers={"X-Skill-Type": insurance_type},
    )
