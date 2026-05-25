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
        "protection_summary": "Protection that helps safeguard the home and property after a covered loss.",
        "financial_exposure": "Structured to help reduce financial exposure from unexpected events.",
        "deductible_position": "Deductible options selected to help keep claim costs manageable.",
        "premium_position": "A strong overall balance between coverage, flexibility, and premium.",
    },
    "auto": {
        "protection_summary": "Protection that covers both everyday driving risks and unexpected accidents.",
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
        "protection_summary": "Protection that keeps both home and auto coverage aligned under one carrier.",
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
        "protection_summary": "Protection that safeguards both the rider and motorcycle from unexpected losses.",
        "financial_exposure": "Reduces financial exposure tied to accidents, damage, or liability risks.",
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
proposal for THIS specific plan.

Your job: fill four fixed slots with short, outcome-focused statements
that describe what THIS plan does for the client, drawn from the
parsed quote data provided in the user message below. Each sentence
must be FRESH — written for this client and this plan, never copied
from any reference text. The proposal renders each slot under its
own heading; you do not choose which slots to include or omit.

CRITICAL: Two different plans (different carriers, different coverage
levels, different deductibles, different premium positioning) MUST
produce different sentences for each slot. If your output for this
plan would read identically to what you would write for a different
plan of the same type, you are failing the task. Personalize.

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
- One sentence per slot, *65 characters max*.

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
        f'  STYLE for "{k}":\n    "{anchor[k]}"' for k in _TAG_KEYS
    )
    instruction = (
        f"{_PROMPT_RULES}\n"
        "── STYLE REFERENCE FOR THIS PROPOSAL TYPE ─────────────────────\n"
        f"This is a {insurance_type} proposal. The sentences below are\n"
        "STYLE REFERENCES — they show the right tone, sentence shape,\n"
        "and level of generality for this proposal type. They are NOT\n"
        "your answer. Returning any of these sentences verbatim as your\n"
        "output is failing the task.\n"
        "\n"
        "Match the style reference's:\n"
        "  - Level of generality (no numbers, no unprompted coverage names).\n"
        "  - Sentence shape (one calm declarative sentence per slot).\n"
        "  - Outcome-focused framing (what the plan does FOR the client).\n"
        "\n"
        "PERSONALIZE by drawing on what the parsed quote data shows for\n"
        "THIS specific plan. Useful signals to lean on:\n"
        "  - Carrier name (you may reference it directly).\n"
        "  - Whether coverage feels broad/comprehensive vs targeted.\n"
        "  - Whether deductibles sit low, standard, or higher relative\n"
        "    to typical for this proposal type (mention positioning,\n"
        "    NEVER the actual numbers).\n"
        "  - Whether the plan reads as value, balanced, or premium tier.\n"
        "  - Property / vehicle / risk-profile notes the data exposes\n"
        "    (older home, multi-vehicle, coastal, high-mileage, etc.).\n"
        "\n"
        "Two plans from different carriers MUST produce different\n"
        "sentences, even when both fall under the same proposal type.\n"
        "\n"
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


# ── Length budget ───────────────────────────────────────────────
# Hard per-slot caps. The proposal layout overflows past these, so
# we enforce them after generation with a targeted rework call.
# The system prompt also states the limit, but at temp=0.6 the
# model can still drift long — this is the belt to the prompt's
# suspenders.
_MAX_CHARS = 75
_MAX_WORDS = 11
_MAX_REWORK_RETRIES = 2


def _check_lengths(sections: dict[str, str]) -> dict[str, str]:
    """Return ``{key: reason}`` for slots over the char/word budget.

    Empty dict means every slot passes. The reason string is a short
    diagnostic like ``"82 chars / 12 words"`` for logs.
    """
    failing: dict[str, str] = {}
    for key in _TAG_KEYS:
        value = (sections.get(key) or "").strip()
        char_count = len(value)
        word_count = len(value.split())
        if char_count > _MAX_CHARS or word_count > _MAX_WORDS:
            failing[key] = (
                f"{char_count} chars / {word_count} words "
                f"(max {_MAX_CHARS} / {_MAX_WORDS})"
            )
    return failing


def _rework_long_sections(
    client: genai.Client,
    model: str,
    base_instruction: str,
    current: dict[str, str],
    failing_keys: list[str],
) -> Optional[dict[str, str]]:
    """Ask the model to shorten only the over-budget slots.

    Returns the full four-key dict the model produced, or ``None`` if
    the call/parse/shape check failed. The caller decides which keys
    to actually swap in — we do not trust the model to leave passing
    slots untouched.

    Runs through the same Gemini → OpenAI fallback chain as the main
    generation call, but at lower temperature (0.2) since we want
    compliance with the length rule, not creativity.
    """
    rework_instruction = (
        f"{base_instruction}\n"
        "── REWORK PASS ────────────────────────────────────────────\n"
        f"Your previous output was over budget on: "
        f"{', '.join(failing_keys)}.\n"
        f"HARD LIMIT: each sentence must be ≤ {_MAX_CHARS} characters "
        f"AND ≤ {_MAX_WORDS} words, including spaces and punctuation. "
        "This is non-negotiable — going over breaks the proposal "
        "layout.\n"
        "Rewrite ONLY the over-budget slots to fit. Preserve meaning, "
        "tone, and the no-numbers / no-invented-coverages rules. Keep "
        "passing slots identical to your previous output. Return the "
        "full four-key JSON object with all four keys present.\n"
    )
    prior = json.dumps(current, indent=2)
    rework_content = (
        "Your previous output:\n\n"
        f"{prior}\n\n"
        f"Rewrite the over-budget slots ({', '.join(failing_keys)}) "
        f"to ≤ {_MAX_CHARS} chars and ≤ {_MAX_WORDS} words each. "
        "Return the full four-key JSON object."
    )

    def _openai_rework_fallback() -> _TextResp:
        text = generate_openai_extraction(
            pdf_path=None,
            system_instruction=rework_instruction,
            user_prompt=rework_content,
            json_schema=_OUTPUT_SCHEMA,
        )
        return _TextResp(text)

    try:
        response = generate_with_fallback(
            client,
            model,
            DEFAULT_FALLBACKS,
            contents=[rework_content],
            config=types.GenerateContentConfig(
                system_instruction=rework_instruction,
                temperature=0.2,
                response_mime_type="application/json",
            ),
            openai_fallback=_openai_rework_fallback,
        )
    except Exception as exc:
        _log(
            "FAIL",
            f"rework generate: {type(exc).__name__}: {str(exc)[:200]}",
        )
        return None

    raw = (getattr(response, "text", None) or "").strip()
    if not raw:
        _log("WARN", "rework empty response.text")
        return None

    try:
        parsed = json.loads(_strip_fences(raw))
    except Exception as exc:
        _log("WARN", f"rework json parse: {exc}  raw={raw[:160]!r}")
        return None

    if not _is_valid_sections(parsed):
        shape = type(parsed).__name__
        keys = list(parsed.keys()) if isinstance(parsed, dict) else None
        _log("WARN", f"rework shape invalid: type={shape} keys={keys}")
        return None

    return {key: parsed[key].strip() for key in _TAG_KEYS}


def _enforce_length_budget(
    client: genai.Client,
    model: str,
    instruction: str,
    sections: dict[str, str],
    anchor: Optional[dict[str, str]],
) -> dict[str, str]:
    """Enforce per-slot length caps via targeted rework + anchor fallback.

    Runs up to ``_MAX_REWORK_RETRIES`` rework calls for any slot that
    exceeds the char/word budget, merging in only the failing-slot
    values so passing slots are preserved as-written. Any slot still
    over budget after all retries is swapped for the anchor copy when
    the proposal type has one; otherwise we log and leave it.
    """
    failing = _check_lengths(sections)
    if not failing:
        return sections

    for attempt in range(1, _MAX_REWORK_RETRIES + 1):
        _log(
            "WARN",
            f"length retry {attempt}/{_MAX_REWORK_RETRIES}: {failing}",
        )
        reworked = _rework_long_sections(
            client,
            model,
            instruction,
            sections,
            list(failing.keys()),
        )
        if reworked is not None:
            for key in failing:
                sections[key] = reworked[key]
        failing = _check_lengths(sections)
        if not failing:
            _log("OK", f"length retry {attempt} cleared all slots")
            return sections

    if anchor:
        for key, reason in failing.items():
            _log("WARN", f"retries exhausted, anchor swap {key}: {reason}")
            sections[key] = anchor[key]
    else:
        for key, reason in failing.items():
            _log("WARN", f"retries exhausted, no anchor {key}: {reason}")

    return sections


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
                # 0.6 (was 0.3): at low temps the model latches onto the
                # style-reference wording and outputs it verbatim. 0.6 gives
                # enough variation to actually personalize per plan while
                # still respecting the JSON shape (which is enforced by
                # response_mime_type, not temperature). OpenAI fallback
                # runs at temp=0 in the shared helper — the prompt is
                # written to be forceful enough to work at that temp too.
                temperature=0.6,
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

    sections = {key: parsed[key].strip() for key in _TAG_KEYS}
    sections = _enforce_length_budget(
        client, model, instruction, sections, anchor,
    )

    _log(
        "OK",
        f"insurance_type={insurance_type} "
        f"anchor={'yes' if anchor else 'no'}",
    )
    return sections


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
