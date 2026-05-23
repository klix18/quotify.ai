# why_selected_generator.py
# Generates the "Why This Plan Was Selected" section using Gemini Flash,
# with an OpenAI cross-provider fallback for Gemini outages.
#
# Output shape — four hidden tag slots, not free-form bullets:
#   - protection_summary
#   - financial_exposure
#   - deductible_position
#   - premium_position
# The downstream renderer (PDF filler / proposal template) maps each
# value into a fixed heading on the proposal. The proposal still renders
# natural language; the tags are an internal contract that makes the
# output modular for AI parsing and consistent across proposal types.
#
# Per-type ANCHOR COPY (approved baseline wording for each proposal type)
# lives in `_ANCHORS` below. At call time, ONLY the anchor matching the
# active insurance_type is injected into the system prompt — the model
# never sees copy for the other proposal types, which prevents tone
# bleed (auto-flavored phrasing in a home proposal, etc.). The anchors
# are also the source of truth for the failure-mode fallback: if
# generation fails completely, we return the anchor copy verbatim so
# the proposal never renders an empty section.
#
# Failure handling: every branch logs to stderr with a [why_selected]
# prefix so transient Gemini 503s or malformed model responses are
# visible in Railway logs instead of silently producing a blank panel.
# When the entire Gemini chain fails the openai_fallback closure runs
# the same prompt through gpt-4o-mini → gpt-4o so the panel populates
# even during a broad Google outage.
#
# OpenAI fallback is clean: passes `_OUTPUT_SCHEMA` so OpenAI's
# Responses API enforces `json_object` mode — same shape guarantee
# Gemini gets via `response_mime_type="application/json"`. No
# fence-stripping or scraping needed; the defensive `_strip_fences`
# helper is belt-and-suspenders only.
#
# Tone: professional insurance advisor — confident, clear, reassuring.
# No numbers, no jargon, no invented coverages.

import json
import os
import re
import sys
from typing import Optional

from dotenv import load_dotenv
from google import genai
from google.genai import types

from parsers._model_fallback import (
    DEFAULT_FALLBACKS,
    generate_with_fallback,
)
from parsers._openai_fallback import generate_openai_extraction

load_dotenv()


# ── Logging ─────────────────────────────────────────────────────
# stderr with a stable prefix so failure modes are grep-able in
# Railway logs. Replaces a silent ``except: pass`` that turned every
# transient Gemini hiccup into a blank panel in the UI.


def _log(level: str, msg: str) -> None:
    print(f"[why_selected] {level} {msg}", flush=True, file=sys.stderr)


# Module-load marker so deploys are verifiable from the logs.
print(
    "[why_selected] module loaded (tagged sections + openai fallback)",
    flush=True,
    file=sys.stderr,
)


# ── Schema / tag contract ───────────────────────────────────────
# Order matters: render_bullets() iterates this tuple to produce a
# stable bullet ordering, and the system prompt enumerates the keys in
# this order so the model's output is deterministic.
_TAG_KEYS = (
    "protection_summary",
    "financial_exposure",
    "deductible_position",
    "premium_position",
)

# JSON Schema passed to the OpenAI fallback to enable `json_object`
# response format and force the four-key shape. The Gemini side enforces
# the same shape via explicit prompt + `response_mime_type="application/json"`.
_OUTPUT_SCHEMA: dict = {
    "type": "object",
    "properties": {k: {"type": "string"} for k in _TAG_KEYS},
    "required": list(_TAG_KEYS),
    "additionalProperties": False,
}


# ── Response shim ───────────────────────────────────────────────
# ``generate_with_fallback`` returns whatever the openai_fallback
# closure returns, and our caller expects ``response.text``. The
# OpenAI helper returns a bare string, so wrap it.


class _TextResp:
    __slots__ = ("text",)

    def __init__(self, text: str):
        self.text = text


# Belt-and-suspenders fence stripper. Both Gemini
# (response_mime_type="application/json") and OpenAI (json_object mode
# via _OUTPUT_SCHEMA) enforce valid JSON output, so fences shouldn't
# appear — but they're cheap to strip if a future model regresses.
_CODE_FENCE_RE = re.compile(
    r"^\s*```(?:json)?\s*|\s*```\s*$",
    re.IGNORECASE | re.MULTILINE,
)


def _strip_fences(s: str) -> str:
    return _CODE_FENCE_RE.sub("", s).strip()


def _get_client() -> genai.Client:
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise ValueError("GEMINI_API_KEY is not set.")
    return genai.Client(api_key=api_key)


# ── Anchor copy ────────────────────────────────────────────────
# Approved baseline wording per insurance type. Keys here MUST match
# the `why_selected_type` values produced by
# parsers/schema_registry.py:_REGISTRY (homeowners, auto, dwelling,
# bundle, commercial). The motorcycle/rv/boat/flood entries are
# pre-approved copy for proposal types not yet wired through the
# registry — they're inert until those types ship, but keeping the
# anchors here means the prompt is ready on day one.
#
# These strings flow into the system prompt verbatim AND are returned
# as the parse-failure fallback so the proposal NEVER renders an empty
# "Why Selected" block when the model is unavailable.
_ANCHORS: dict[str, dict[str, str]] = {
    "homeowners": {  # ⇄ HOME
        "protection_summary": "Protection designed to help safeguard the home and property after a covered loss.",
        "financial_exposure": "Structured to help reduce financial exposure from unexpected events.",
        "deductible_position": "Deductible options selected to help keep claim costs manageable.",
        "premium_position": "A strong overall balance between coverage, flexibility, and premium.",
    },
    "auto": {
        "protection_summary": "Protection designed to help address both everyday driving risks and unexpected accidents.",
        "financial_exposure": "Structured to help reduce financial exposure after an accident or claim.",
        "deductible_position": "Deductible options selected to help keep out of pocket costs manageable.",
        "premium_position": "A strong overall balance between protection, affordability, and flexibility.",
    },
    "dwelling": {
        "protection_summary": "Protection designed to help safeguard the property after a covered loss.",
        "financial_exposure": "Structured to help reduce financial exposure tied to property ownership.",
        "deductible_position": "Deductible options selected to help balance premium savings and claim exposure.",
        "premium_position": "A strong overall balance between landlord protection and overall value.",
    },
    "bundle": {  # ⇄ BUNDLED HOME + AUTO
        "protection_summary": "Protection designed to help keep both home and auto coverage aligned under one carrier.",
        "financial_exposure": "Structured to help simplify coverage management, billing, and claims handling.",
        "deductible_position": "Deductible options selected to help keep costs manageable across multiple policies.",
        "premium_position": "A strong overall balance between protection, convenience, and premium value.",
    },
    "commercial": {
        # Not in the original approved anchor set — placeholder copy
        # written in the same style so commercial proposals still get
        # consistent output. Revisit when commercial copy is signed off.
        "protection_summary": "Protection designed to help safeguard business operations after a covered loss.",
        "financial_exposure": "Structured to help reduce financial exposure tied to day to day business risks.",
        "deductible_position": "Deductible options selected to help keep claim costs manageable for the business.",
        "premium_position": "A strong overall balance between business protection, flexibility, and premium.",
    },
    # Not currently wired through schema_registry; ready for when they are.
    "motorcycle": {
        "protection_summary": "Protection designed to help safeguard both the rider and motorcycle from unexpected losses.",
        "financial_exposure": "Structured to help reduce financial exposure tied to accidents, damage, or liability risks.",
        "deductible_position": "Deductible options selected to help keep claim costs manageable.",
        "premium_position": "A strong overall balance between protection, flexibility, and premium.",
    },
    "rv": {
        "protection_summary": "Protection designed to help safeguard the RV and travel related exposure after a covered loss.",
        "financial_exposure": "Structured to help reduce financial exposure both on and off the road.",
        "deductible_position": "Deductible options selected to help balance premium and out of pocket costs.",
        "premium_position": "A strong overall balance between protection, flexibility, and overall value.",
    },
    "boat": {
        "protection_summary": "Protection designed to help safeguard the boat and related watercraft exposure after a covered loss.",
        "financial_exposure": "Structured to help reduce financial exposure tied to ownership and on water risks.",
        "deductible_position": "Deductible options selected to help keep claim costs more manageable.",
        "premium_position": "A strong overall balance between protection, usability, and premium.",
    },
    "flood": {
        "protection_summary": "Protection designed to help safeguard the property from costly flood related damage.",
        "financial_exposure": "Structured to help reduce financial exposure tied to rising water and flood events.",
        "deductible_position": "Deductible options selected to help balance premium and claim affordability.",
        "premium_position": "A strong overall balance between flood protection and long term value.",
    },
}


# ── Prompt ──────────────────────────────────────────────────────
# Static rules block — never changes per call. The per-type anchor is
# appended by `_build_system_instruction` so the LLM only ever sees the
# anchor for the active insurance type, never the others.
#
# Key rules driving this prompt (per product spec):
#   * Cleaner client-facing language, less insurance jargon.
#   * NO ASSUMPTIONS about coverages: don't name a specific coverage
#     unless that exact coverage is a confirmed field in the parsed
#     data. The anchor sets the right level of generality — match it.
#   * NO NUMBERS: relative language only.
#   * Modular for AI parsing: output is a JSON object with four fixed
#     string keys, so the renderer can drop content into hidden tags
#     consistently.
#   * Consistent structure across all proposal types via the anchors.
_PROMPT_RULES = """\
You are a 20-year veteran insurance advisor writing the
"Why This Plan Was Selected" section of a client-facing insurance
proposal.

Your job: fill four fixed slots with short, outcome-focused statements
that describe what the plan does for the client in plain English. The
proposal renders each slot under its own heading — you do not choose
which slots to include or omit, and you do not invent new slots.

ABSOLUTE RULE — NO NUMBERS: Never include dollar amounts, percentages,
limits, deductibles, premiums, or any specific numeric values. Use
relative language only: "strong", "meaningful", "competitive",
"realistic", "comprehensive", "robust", "manageable", "flexible".

ABSOLUTE RULE — DO NOT INVENT COVERAGES: Do not name a specific
coverage line item unless that exact coverage is already a confirmed,
non-empty field in the parsed quote data below. NEVER pitch
unprompted: liability, comp/collision, replacement cost, endorsements,
water backup, rental reimbursement, uninsured motorist, fair rental
value, ordinance or law, medical payments, loss of use, scheduled
property, etc. The anchor copy below sets the right level of
generality — match it. Describe outcomes ("help safeguard the home",
"reduce financial exposure"), not product features.

TONE:
- Confident, clear, reassuring — an experienced advisor talking to a
  client, not pitching a product.
- Conversational, not templated or robotic.
- No passive voice. No "is included" / "is provided".
- One sentence per slot, ~120 characters max.

GOOD examples (outcome-focused, jargon-free):
- "Protection designed to help safeguard the home and property after a covered loss."
- "Structured to help reduce financial exposure from unexpected events."
- "Deductible options selected to help keep claim costs manageable."
- "A strong overall balance between coverage, flexibility, and premium."

BAD examples (never do these):
- "Protect your finances with $300,000 liability coverage."   ← numbers + named coverage
- "Safeguard your Jeep with $500 deductibles."                ← numbers + brand
- "Gain mobility with $50 daily rental reimbursement."        ← numbers + named coverage
- "Includes uninsured motorist protection."                   ← unprompted named coverage

OUTPUT FORMAT:
Return ONLY a single JSON object with exactly these four string keys,
in this order:
  "protection_summary"
  "financial_exposure"
  "deductible_position"
  "premium_position"

Each value is exactly one sentence. No markdown, no code fences, no
prose before or after the JSON object.
"""


def _build_system_instruction(
    insurance_type: str,
) -> tuple[str, Optional[dict[str, str]]]:
    """Return ``(system_instruction, anchor_or_None)`` for a given type.

    The anchor block is appended to the static rules so the model sees
    only the approved copy for the active proposal type. The same
    anchor is returned to the caller so it can serve as the parse-
    failure fallback in ``generate_why_selected`` — that way the
    proposal never renders an empty section even on total outage.
    """
    anchor = _ANCHORS.get((insurance_type or "").strip().lower())
    if not anchor:
        # Unknown insurance type — fall back to rules-only. The model
        # will still produce reasonable output from the parsed data
        # alone; it just won't have anchor copy to lean on.
        return _PROMPT_RULES, None

    anchor_block = "\n".join(
        f'  "{k}": "{anchor[k]}"' for k in _TAG_KEYS
    )
    instruction = (
        f"{_PROMPT_RULES}\n"
        "── APPROVED ANCHOR COPY FOR THIS PROPOSAL TYPE ────────────────\n"
        f"This is a {insurance_type} proposal. The approved anchor copy\n"
        "for each slot is below. Use it as the baseline and personalize\n"
        "LIGHTLY only where the parsed quote data clearly supports a\n"
        "more specific phrasing. If you have nothing distinctive to add\n"
        "for a slot, return the anchor copy for that slot verbatim.\n"
        "Match the anchor's level of generality — do not introduce\n"
        "named coverages beyond what the anchor already uses.\n\n"
        f"{anchor_block}\n"
    )
    return instruction, anchor


def _is_valid_sections(parsed: object) -> bool:
    """Validate the four-key dict shape with non-empty string values."""
    if not isinstance(parsed, dict):
        return False
    for key in _TAG_KEYS:
        value = parsed.get(key)
        if not isinstance(value, str) or not value.strip():
            return False
    return True


def generate_why_selected(
    final_data: dict,
    insurance_type: str,
    model: str = "gemini-2.5-flash-lite",
) -> dict[str, str]:
    """Generate the four tagged "Why this plan was selected" sections.

    Returns a dict keyed by the four ``_TAG_KEYS`` (protection_summary,
    financial_exposure, deductible_position, premium_position), with
    one short sentence per key. On any failure — Gemini chain
    exhausted AND OpenAI fallback failed, or output failed validation —
    falls back to the approved anchor copy for the insurance type so
    the proposal still renders meaningful content. Returns ``{}`` only
    if there is no anchor for the given type AND generation failed.

    Renderers:
      * ``data["why_selected_sections"]`` (this dict) drives tagged
        layouts where each slot has its own heading.
      * ``data["why_selected"]`` (the legacy single-string shape) is
        produced by :func:`render_bullets` for PDF fillers that still
        expect a bullet-joined string.

    Uses the shared Gemini fallback helper with an OpenAI cross-provider
    safety net (see ``parsers/_openai_fallback.py``) so a demand spike
    on the primary model transparently walks down the fallback chain
    rather than dropping the section. Every failure path logs to
    stderr with a [why_selected] prefix.
    """
    instruction, anchor = _build_system_instruction(insurance_type)
    data_str = json.dumps(final_data, indent=2)
    content = (
        f"Here is the verified quote data for a {insurance_type} policy:\n\n"
        f"{data_str}"
    )

    # OpenAI cross-provider fallback. Passes _OUTPUT_SCHEMA so the
    # Responses API enables `json_object` mode — that gives us the same
    # shape guarantee Gemini provides via response_mime_type. Returns
    # a _TextResp so the caller's ``response.text`` access works
    # whether Gemini or OpenAI handled the request.
    def _openai_sections_fallback() -> _TextResp:
        text = generate_openai_extraction(
            pdf_path=None,
            system_instruction=instruction,
            user_prompt=content,
            json_schema=_OUTPUT_SCHEMA,
        )
        return _TextResp(text)

    try:
        client = _get_client()
    except Exception as exc:
        _log("FAIL", f"client init: {exc}")
        return dict(anchor) if anchor else {}

    try:
        response = generate_with_fallback(
            client,
            model,
            DEFAULT_FALLBACKS,
            contents=[content],
            config=types.GenerateContentConfig(
                system_instruction=instruction,
                temperature=0.3,
                response_mime_type="application/json",
            ),
            openai_fallback=_openai_sections_fallback,
        )
    except Exception as exc:
        _log("FAIL", f"generate: {type(exc).__name__}: {str(exc)[:200]}")
        return dict(anchor) if anchor else {}

    raw = (getattr(response, "text", None) or "").strip()
    if not raw:
        _log("WARN", "empty response.text")
        return dict(anchor) if anchor else {}

    try:
        parsed = json.loads(_strip_fences(raw))
    except Exception as exc:
        _log("WARN", f"json parse: {exc}  raw={raw[:160]!r}")
        return dict(anchor) if anchor else {}

    if not _is_valid_sections(parsed):
        shape = type(parsed).__name__
        keys = list(parsed.keys()) if isinstance(parsed, dict) else None
        _log("WARN", f"shape invalid: type={shape} keys={keys}")
        return dict(anchor) if anchor else {}

    _log(
        "OK",
        f"insurance_type={insurance_type} "
        f"anchor={'yes' if anchor else 'no'}",
    )
    return {key: parsed[key].strip() for key in _TAG_KEYS}


def render_bullets(sections: dict[str, str]) -> str:
    """Render the tagged sections as a legacy bullet-joined string.

    Existing PDF fillers (homeowners, auto, dwelling, commercial,
    bundle) read ``data["why_selected"]`` as a single string and pass
    it into their PDF template context. Until those templates are
    upgraded to consume the tagged dict directly, the call site in
    ``parsers/unified_parser_api.py`` stores both shapes — this
    helper produces the legacy string.

    Order matches ``_TAG_KEYS`` so the bullet order is stable across
    runs. Returns ``""`` for an empty dict so the filler context
    doesn't end up with stringified ``{}``.
    """
    if not sections:
        return ""
    return "\n".join(
        f"• {sections[key]}"
        for key in _TAG_KEYS
        if sections.get(key)
    )
