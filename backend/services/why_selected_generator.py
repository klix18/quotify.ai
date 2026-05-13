# why_selected_generator.py
# Generates "Why This Plan Was Selected" bullets using Gemini Flash, with
# an OpenAI cross-provider fallback for Gemini outages.
#
# Called once at the end of extraction, after the single-pass parser has
# produced the final verified data. There is no longer a separate draft
# pass — the legacy draft/refine split was a hangover from the old 3-pass
# pipeline (Design 1) and only the "generate fresh from final data" branch
# was ever exercised in production. Design 2 simplified the flow.
#
# Failure handling: every branch logs to stderr with a [why_selected] prefix
# so a transient Gemini 503 or malformed model response is visible in
# Railway logs instead of silently returning "" (the old behavior). When
# the entire Gemini chain fails the openai_fallback closure runs the same
# bullet-generation prompt through gpt-4o-mini → gpt-4o so the panel
# populates even during a broad Google outage.
#
# Tone: professional insurance advisor — confident, clear, reassuring.

import json
import os
import re
import sys

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
# stderr with a stable prefix so the failure mode is grep-able in
# Railway logs. Replaces a silent ``except: pass`` that turned every
# transient Gemini hiccup into a blank panel in the UI.


def _log(level: str, msg: str) -> None:
    print(f"[why_selected] {level} {msg}", flush=True, file=sys.stderr)


# Module-load marker so deploys are verifiable.
print("[why_selected] module loaded (with openai fallback)", flush=True, file=sys.stderr)


# ── Response shim ───────────────────────────────────────────────
# ``generate_with_fallback`` returns whatever the openai_fallback
# closure returns — and our caller expects ``response.text``. The
# OpenAI helper returns a bare string, so wrap it.


class _TextResp:
    __slots__ = ("text",)

    def __init__(self, text: str):
        self.text = text


# Strip ```json … ``` and bare ``` fences that OpenAI sometimes emits
# even on temperature=0 when no response_format is enforced.
_CODE_FENCE_RE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$", re.IGNORECASE | re.MULTILINE)


def _strip_fences(s: str) -> str:
    return _CODE_FENCE_RE.sub("", s).strip()


def _get_client() -> genai.Client:
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise ValueError("GEMINI_API_KEY is not set.")
    return genai.Client(api_key=api_key)


# ── Prompt ──────────────────────────────────────────────────────

_PROMPT = """\
You are a 20-year veteran insurance advisor. This plan was selected from
multiple competing quotes. Write 3-4 bullet points explaining why THIS
plan stands out as the best choice for the client.

Frame each bullet as a reason this plan WINS over alternatives — strong
coverage, competitive positioning, smart balance of protection vs cost.

GOOD examples:
- "Protects the full cost to rebuild your home after a covered loss."
- "Provides meaningful liability protection for your assets and future income."
- "Keeps deductibles at a level that is realistic if a loss occurs."
- "Positions your home and auto together for the strongest overall value."
- "Offers strong uninsured motorist protection in a high-risk area."

BAD examples (never do these):
- "Protect your finances with $300,000 liability coverage."
- "Safeguard your Jeep with $500 deductibles."
- "Gain mobility with $50 daily rental reimbursement."

ABSOLUTE RULE — NO NUMBERS: Never include dollar amounts, percentages,
or any specific numbers. Instead use relative language like "strong",
"meaningful", "competitive", "realistic", "comprehensive", "robust".

Rules:
- Return ONLY a JSON array of 3-4 strings. No other text.
- Each bullet is one confident sentence, max 75 characters.
- ZERO dollar amounts, ZERO numbers, ZERO percentages.
- Explain WHY this plan is the best choice, not just what it contains.
- Vary sentence openers — never start two bullets the same way.
- No passive voice. No "is included" / "is provided".
"""


def generate_why_selected(
    final_data: dict,
    insurance_type: str,
    model: str = "gemini-2.5-flash-lite",
) -> str:
    """Generate the "Why this plan was selected" bullets.

    Called once, with the final post-processed data. Returns a newline-
    separated, bullet-prefixed string (e.g. ``• foo\\n• bar``) or an empty
    string if generation fails. Callers should assign this directly to
    ``data["why_selected"]``.

    Uses the shared Gemini fallback helper for the primary call. If
    the whole Gemini chain fails, falls through to OpenAI
    (gpt-4o-mini → gpt-4o) running the same prompt text-only — no PDF
    upload, this generator never sees the PDF. Every failure path logs
    to stderr so an empty result is grep-able in Railway logs instead
    of silently disappearing.
    """
    data_str = json.dumps(final_data, indent=2)
    content = (
        f"Here is the verified quote data for a {insurance_type} policy:\n\n"
        f"{data_str}"
    )

    # OpenAI text-only fallback. Returns a ``_TextResp`` so the caller's
    # ``response.text`` access works whether Gemini or OpenAI handled it.
    def _openai_bullets_fallback() -> _TextResp:
        text = generate_openai_extraction(
            pdf_path=None,
            system_instruction=_PROMPT,
            user_prompt=content,
        )
        return _TextResp(text)

    try:
        client = _get_client()
    except Exception as exc:
        _log("FAIL", f"client init: {exc}")
        return ""

    try:
        response = generate_with_fallback(
            client,
            model,
            DEFAULT_FALLBACKS,
            contents=[content],
            config=types.GenerateContentConfig(
                system_instruction=_PROMPT,
                temperature=0.3,
                response_mime_type="application/json",
            ),
            openai_fallback=_openai_bullets_fallback,
        )
    except Exception as exc:
        _log("FAIL", f"generate: {type(exc).__name__}: {str(exc)[:200]}")
        return ""

    raw = (getattr(response, "text", None) or "").strip()
    if not raw:
        _log("WARN", "empty response.text")
        return ""

    try:
        bullets = json.loads(_strip_fences(raw))
    except Exception as exc:
        _log("WARN", f"json parse: {exc}  raw={raw[:160]!r}")
        return ""

    if not isinstance(bullets, list) or len(bullets) < 2:
        _log("WARN", f"shape invalid: {type(bullets).__name__} len={len(bullets) if hasattr(bullets, '__len__') else '?'}")
        return ""

    cleaned = [b.strip() for b in bullets[:4] if isinstance(b, str) and b.strip()]
    if not cleaned:
        _log("WARN", "all entries empty/non-str")
        return ""

    _log("OK", f"bullets={len(cleaned)}")
    return "\n".join(f"• {b}" for b in cleaned)
