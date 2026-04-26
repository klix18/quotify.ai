"""
unified_parser_api.py
=====================
Single entry point for ALL insurance quote parsing.

Architecture (Design 2 — single-pass + prompt caching, 2026-04-21)
------------------------------------------------------------------
One endpoint  →  POST /api/parse-quote?insurance_type=<type>
One model     →  gemini-2.5-flash
One system prompt (CORE_SYSTEM_PROMPT + full SKILL.md) — cached once per
    (insurance_type, supplement_set, skill_version) tuple via Gemini's
    explicit context-cache API. The system instruction is stable and
    never changes per request; caching it eliminates the dominant prompt
    prefill cost on every parse.
Per-type skill (parse_<type>/SKILL.md) — describes WHAT to extract; all
    carrier-specific overrides are baked into each SKILL.md under a
    ``## Carrier-Specific Overrides`` section, so the LLM reads carrier
    quirks straight from its active skill — no separate carrier pass.

Flow
----
1. Load skill (+ optional wind/hail / bundle-separate supplement)
2. Upload PDF(s) to Gemini files API
3. Get-or-create the system-instruction cache for this
   (type, supplements, skill_version) tuple — TTL 1 hour
4. Single extraction pass on gemini-2.5-flash:
     cached_content  = system cache (CORE_SYSTEM_PROMPT + full SKILL.md)
     contents        = user prompt + PDF part(s) with boundary markers
     response_schema = type-specific JSON schema
     thinking_config = small thinking budget (~512 tokens) — kept non-zero
                       to preserve the accuracy of the "confidence" object
                       the model emits per field.
   → streams final_patch events to frontend
   → emits result with data + confidence + skill_version
5. Generate "Why Selected" bullets from final data (single Gemini call)

Removed vs legacy design (baseline-2026-04-20)
-----------------------------------------------
  • Pass 0 (vision-based carrier detection) — carrier overrides are now
    baked into each SKILL.md, so a separate detection call no longer
    changes prompt content. ``carrier_detector.py`` remains importable
    for future use but is not called on the hot path.
  • Pass 1 (fast key:value quick draft) — the cached system prompt and
    small thinking budget make the single strict-JSON pass fast enough
    that the progressive-draft stage was net negative on p50 latency.
  • Pass 3 (self-healing retry on low-confidence fields) — the response
    schema still emits confidence scores; they now drive the frontend
    "Double Check" pill but are not used to trigger a second LLM call.
  • Draft "Why Selected" — replaced by a single refine call against the
    final data.

Extending
---------
To add a new insurance type:
  1. Create parsers/skills/parse_<type>/SKILL.md with YAML frontmatter
     (name, description) and a `> VERSION:` line in the body.
  2. Add a registry entry in parsers/schema_registry.py.
  That's it — the loader + cache builder pick it up automatically.

To add carrier-specific hints:
  1. Append a `### <Carrier Name>` subsection under the base skill's
     `## Carrier-Specific Overrides` section in parse_<type>/SKILL.md.
  2. Bump the `> VERSION:` line on the skill so stale caches expire.

To swap the AI model:
  Change MODEL_EXTRACT below. All types instantly use the new model.
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
    DEFAULT_FALLBACKS,
    stream_with_fallback,
    upload_with_retry,
)
from parsers._openai_fallback import stream_openai_extraction
from parsers.skill_loader import (
    get_skill_version,
    load_skill,
)
from parsers.post_process import post_process
from parsers.schema_registry import get_registration, supported_types
from services.pdf_storage_helpers import store_uploaded_pdf
from services.why_selected_generator import generate_why_selected

load_dotenv()

router = APIRouter()

# ── Model configuration — change here to upgrade ALL types at once ──
MODEL_EXTRACT: str = "gemini-2.5-flash"   # single-pass strict-JSON extractor

# ── Thinking budget ──────────────────────────────────────────────────
# Kept intentionally non-zero so the confidence scores the model emits in
# the response schema remain well-calibrated. 512 tokens is small enough
# that the overhead is a few hundred ms, and large enough that the model
# has room to plan the extraction before committing to output.
THINKING_BUDGET: int = 512

# ── System-prompt cache config ───────────────────────────────────────
# The system instruction (CORE_SYSTEM_PROMPT + full SKILL.md +
# supplements) is stable across requests for a given (insurance_type,
# supplement_set, skill_version) tuple. We create a Gemini explicit
# context cache once per tuple and reuse it for the cache TTL window.
# If cache creation or lookup fails we fall back transparently to
# sending the system instruction inline on each call.
SYSTEM_CACHE_TTL_SECONDS: int = 3600           # 1 hour
SYSTEM_CACHE_TTL: str = f"{SYSTEM_CACHE_TTL_SECONDS}s"

# Process-local registry of cache names, keyed by the tuple described
# above. Entries are names returned by ``client.caches.create(...).name``
# (of the form ``cachedContents/<id>``) and are cheap to invalidate when
# the cache expires server-side.
_SYSTEM_CACHE_REGISTRY: dict[str, str] = {}


# ── System prompt — strict structured JSON (cached) ────────────────
#
# This prompt is stable; the only per-request variation is the active
# SKILL.md content which is appended below and then cached together with
# the core prompt. The model outputs a JSON object matching the per-type
# response schema, including a `confidence` object that mirrors the
# data structure with a 0.0-1.0 score for every leaf field.
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


# ── System-prompt cache helpers ────────────────────────────────────

def _system_cache_key(
    insurance_type: str,
    skill_version: str,
    has_wind: bool,
    has_separate: bool,
) -> str:
    """Build a stable key for the system-prompt cache registry.

    Distinct cache entries are required whenever the system instruction
    text differs, which is whenever ANY of the following change:
      - insurance type (different SKILL.md)
      - skill version (edits to a SKILL.md invalidate the cache)
      - whether the wind/hail supplement is appended
      - whether the bundle-separate supplement is appended
    """
    parts = [insurance_type, f"v{skill_version or 'unknown'}"]
    if has_wind:
        parts.append("wind")
    if has_separate:
        parts.append("separate")
    return "|".join(parts)


def _get_or_create_system_cache(
    client: genai.Client,
    key: str,
    model: str,
    system_instruction: str,
) -> str | None:
    """Return the cache name for ``key`` (cachedContents/...), creating
    it on first use and re-creating it transparently if the previously
    stored name has expired server-side.

    Returns None on any failure — the caller MUST fall back to sending
    the system instruction inline. A failed cache must never block a
    parse from completing.
    """
    cached_name = _SYSTEM_CACHE_REGISTRY.get(key)
    if cached_name:
        # Verify the cache still exists on the Gemini side. If get() fails
        # we assume it was evicted (TTL or admin action) and recreate.
        try:
            client.caches.get(name=cached_name)
            return cached_name
        except Exception:
            _SYSTEM_CACHE_REGISTRY.pop(key, None)

    try:
        cache = client.caches.create(
            model=f"models/{model}",
            config=types.CreateCachedContentConfig(
                display_name=f"quotify-{key}"[:120],
                system_instruction=system_instruction,
                ttl=SYSTEM_CACHE_TTL,
            ),
        )
        _SYSTEM_CACHE_REGISTRY[key] = cache.name
        print(
            f"[system-cache] CREATED key={key} name={cache.name} "
            f"ttl={SYSTEM_CACHE_TTL}",
            flush=True,
        )
        return cache.name
    except Exception as exc:
        # Common failure modes: quota, minimum-token-count not met on a
        # tiny skill, model-doesn't-support-caching, transient 5xx.
        # All are non-fatal — we just skip caching for this request.
        print(
            f"[system-cache] create FAILED key={key} err={str(exc)[:160]} "
            f"(falling back to inline system_instruction)",
            flush=True,
        )
        return None


# ── Core streaming pipeline ────────────────────────────────────────

def stream_unified_quote(
    pdf_path: Path,
    insurance_type: str,
    model_extract: str = MODEL_EXTRACT,
    model_fallbacks=DEFAULT_FALLBACKS,
    wind_pdf_path: Path | None = None,
    secondary_pdf_path: Path | None = None,
) -> Iterator[str]:
    """
    Single-pass extraction pipeline for any insurance type (Design 2).

    The stable system instruction (CORE_SYSTEM_PROMPT + full SKILL.md,
    including any wind/hail or bundle-separate supplement) is cached via
    Gemini's explicit context-cache API on first use per
    (insurance_type, supplement_set, skill_version) tuple and reused for
    subsequent requests. If caching is unavailable for any reason we fall
    back transparently to sending the system instruction inline.

    Yields ndjson strings:
      {"type": "status",        "message": "..."}
      {"type": "skill_loaded",  "skill_type": "...", "version": "..."}
      {"type": "final_patch",   "data": {...}}
      {"type": "result",        "data": {...}, "confidence": {...},
                                "skill_version": "..."}
      {"type": "error",         "error": "..."}
    """
    client = _get_client()
    uploaded_file = None
    uploaded_wind_file = None
    uploaded_secondary_file = None

    try:
        # ── Load base skill and registry ────────────────────────
        try:
            skill_content = load_skill(insurance_type)
            skill_version = get_skill_version(insurance_type)
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

        # Append any supplements to the skill content BEFORE building the
        # system-prompt cache. The cache key includes which supplements
        # are active, so (type=homeowners, wind=True) hits a different
        # cache entry than (type=homeowners, wind=False).
        if wind_skill_content:
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

        if bundle_separate_skill_content:
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

        registration = get_registration(insurance_type)
        schema = registration["schema"]
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

        # Count of PDFs actually attached so the prompt can say "TWO PDFs"
        # instead of "this PDF" when we're in wind/hail or bundle-separate
        # mode. Singular wording demonstrably leads Gemini to ignore the
        # second attachment.
        pdf_count = 1 + (1 if uploaded_wind_file is not None else 0) + (1 if uploaded_secondary_file is not None else 0)
        pdf_phrase = "this PDF" if pdf_count == 1 else f"these {pdf_count} PDFs"

        # Shared PDF label list — identifies which policy each attached PDF
        # represents. Used by both the Gemini ``_build_contents`` helper
        # (below) and the OpenAI fallback lambda (``pdf_labels=`` kw-arg).
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

        # ────────────────────────────────────────────────────────
        # EXTRACTION — single-pass, strict structured JSON
        # System: CORE_SYSTEM_PROMPT + full skill (carrier overrides
        #         baked into SKILL.md, supplements pre-appended above).
        #         Cached via explicit context cache so the stable prefix
        #         only incurs prefill cost on first use per
        #         (type, supplements, skill_version) tuple.
        # User:   "Extract all … fields" with multi-PDF boundaries.
        # response_schema: type-specific JSON schema with confidence.
        # thinking_config: small non-zero budget — keeps the model's
        #                  confidence scores well-calibrated without
        #                  adding meaningful latency.
        # ────────────────────────────────────────────────────────
        yield json.dumps({"type": "status", "message": status_msg}) + "\n"

        system_with_skill = (
            CORE_SYSTEM_PROMPT
            + "\n\n═══ ACTIVE SKILL: "
            + insurance_type.upper()
            + " ═══════════════════════\n\n"
            + skill_content
        )

        # Try to reuse (or build) the explicit system-prompt cache for
        # this (type, supplements, skill_version) tuple. Never blocks the
        # parse — a None return falls through to inline system_instruction.
        cache_key = _system_cache_key(
            insurance_type=insurance_type,
            skill_version=skill_version,
            has_wind=uploaded_wind_file is not None,
            has_separate=uploaded_secondary_file is not None,
        )
        cached_name = _get_or_create_system_cache(
            client, cache_key, model_extract, system_with_skill
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

        # Interleaved labels + files — keep boundaries visible so Gemini
        # reads BOTH PDFs and doesn't stop after the first.
        final_contents = _build_contents(final_user_prompt)

        # ``cached_content`` and ``system_instruction`` are mutually
        # exclusive in the Gemini SDK — pass whichever one is available.
        # When the cache exists we omit system_instruction; the cached
        # prefix IS the system prompt on the server side.
        if cached_name:
            gen_config = types.GenerateContentConfig(
                cached_content=cached_name,
                temperature=0,
                response_mime_type="application/json",
                response_schema=schema,
                thinking_config=types.ThinkingConfig(thinking_budget=THINKING_BUDGET),
            )
        else:
            gen_config = types.GenerateContentConfig(
                system_instruction=system_with_skill,
                temperature=0,
                response_mime_type="application/json",
                response_schema=schema,
                thinking_config=types.ThinkingConfig(thinking_budget=THINKING_BUDGET),
            )

        full_text = ""
        sent_final: dict = {}
        final_stream = stream_with_fallback(
            client,
            model_extract,
            model_fallbacks,
            contents=final_contents,
            config=gen_config,
            # OpenAI fallback can't use Gemini's cache, so we pass the
            # system instruction inline. Accuracy stays the same; only
            # latency regresses — and this path only fires when every
            # Gemini model in the chain has already failed.
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

        # ── Post-process extraction result ────────────────────
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

        # ── Generate Why Selected ──────────────────────────────
        # One short Gemini call against the final verified data produces
        # the 3-4 "why this plan was selected" bullets shown in the UI.
        yield json.dumps({"type": "status", "message": "Generating plan summary..."}) + "\n"
        data["why_selected"] = generate_why_selected(data, why_type)

        yield json.dumps({
            "type": "result",
            "data": data,
            "confidence": confidence,
            "skill_version": skill_version,
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
      skill_loaded — skill file loaded and version confirmed
      status       — human-readable progress messages
      final_patch  — progressive field updates as the JSON is streamed
      result       — final extracted data with confidence scores
      error        — non-recoverable error
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
