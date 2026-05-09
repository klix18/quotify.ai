# why_selected_generator.py
# Generates "Why This Plan Was Selected" bullets using Gemini Flash.
#
# Called once at the end of extraction, after the single-pass parser has
# produced the final verified data. There is no longer a separate draft
# pass — the legacy draft/refine split was a hangover from the old 3-pass
# pipeline (Design 1) and only the "generate fresh from final data" branch
# was ever exercised in production. Design 2 simplified the flow.
#
# Tone: professional insurance advisor — confident, clear, reassuring.
#
# Failure handling
# ----------------
# Every failure mode (Gemini overload, malformed JSON, markdown-fenced
# output, too-few bullets, empty response) emits a stderr log line with
# a stable ``[why_selected]`` prefix so production failures are visible
# in Railway logs. The function still returns "" on failure so the
# parse-quote stream completes cleanly — the regenerate endpoint at
# ``/api/regenerate-why-selected`` lets advisors retry without
# re-uploading the PDF.

from __future__ import annotations

import json
import os
import re
import sys

from dotenv import load_dotenv
from fastapi import APIRouter, Depends, HTTPException
from google import genai
from google.genai import types
from pydantic import BaseModel

from core.auth import get_current_user
from parsers._model_fallback import (
    DEFAULT_FALLBACKS,
    generate_with_fallback,
)
from parsers.schema_registry import get_registration

load_dotenv()


# ── Diagnostic logging ────────────────────────────────────────────
# Mirrors the [fallback:v2-chain] convention in _model_fallback.py so
# all LLM-side breadcrumbs share a stderr namespace and are easy to
# grep in Railway logs (`grep -E '\[why_selected|fallback:'`).

def _log(msg: str) -> None:
    print(f"[why_selected] {msg}", flush=True, file=sys.stderr)


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


# ── JSON parsing helpers ──────────────────────────────────────────

# Models occasionally wrap output in ```json\n...\n``` even when
# response_mime_type=application/json is set. Strip those before parsing.
_MARKDOWN_FENCE_RE = re.compile(r"^\s*```(?:json)?\s*\n?(.*?)\n?\s*```\s*$", re.DOTALL)


def _strip_markdown_fences(text: str) -> str:
    """Remove a wrapping ```json\\n...\\n``` fence if present."""
    if not text:
        return text
    m = _MARKDOWN_FENCE_RE.match(text.strip())
    return m.group(1).strip() if m else text.strip()


def _parse_bullets(raw_text: str) -> list[str]:
    """Parse a Gemini response into a list of bullet strings.

    Handles three shapes:
      - bare JSON array: ``["a", "b", "c"]``
      - markdown-fenced array: ``\\n```json\\n["a", "b"]\\n```\\n``
      - JSON object with a ``bullets`` / ``why_selected`` / ``items`` key

    Raises :class:`ValueError` with a specific reason on every failure
    mode so callers can log what went wrong.
    """
    if raw_text is None:
        raise ValueError("response.text is None")

    cleaned = _strip_markdown_fences(raw_text)
    if not cleaned:
        raise ValueError("response.text is empty after fence-stripping")

    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        raise ValueError(f"json.loads failed: {exc.msg} at pos {exc.pos}") from exc

    # Direct array — the happy path.
    if isinstance(parsed, list):
        bullets = parsed
    # Object wrapper — Gemini sometimes returns {"bullets":[...]}.
    elif isinstance(parsed, dict):
        for key in ("bullets", "why_selected", "items", "result"):
            if isinstance(parsed.get(key), list):
                bullets = parsed[key]
                break
        else:
            raise ValueError(
                f"response is an object but has no list-valued key "
                f"(keys: {list(parsed.keys())[:5]})"
            )
    else:
        raise ValueError(f"response is {type(parsed).__name__}, not list/dict")

    # Filter to non-empty STRING entries only. A None / number / nested
    # object would otherwise leak into the rendered PDF — `str(None)`
    # would render as the literal text "None" beside a bullet.
    cleaned_bullets = [b.strip() for b in bullets if isinstance(b, str) and b.strip()]
    if not cleaned_bullets:
        raise ValueError("no non-empty string bullets after cleaning")

    # If we dropped any non-string entries, surface that to logs so it
    # shows up in Railway and can be tracked over time. Most commonly
    # caused by the model returning `null` or numbers in the array.
    if len(cleaned_bullets) < len(bullets):
        _log(
            f"WARN parse: filtered {len(bullets) - len(cleaned_bullets)} "
            f"non-string entries from response array"
        )

    return cleaned_bullets[:4]


# ── Public API ────────────────────────────────────────────────────

def generate_why_selected(
    final_data: dict,
    insurance_type: str,
    model: str = "gemini-2.5-flash-lite",
) -> str:
    """Generate the "Why this plan was selected" bullets.

    Returns a newline-separated, bullet-prefixed string (e.g.
    ``• foo\\n• bar``) on success, or an empty string on failure. Every
    failure emits a stderr log line with a ``[why_selected]`` prefix so
    Railway logs make the cause visible.

    Floor relaxed to ``>= 1`` bullet (was ``>= 2``) — one bullet beats
    none, and Gemini Flash Lite occasionally short-changes at temperature
    0.3 even when the prompt asks for 3-4. Truncates at 4 if more.
    """
    data_str = json.dumps(final_data, indent=2)
    content = (
        f"Here is the verified quote data for a {insurance_type} policy:\n\n"
        f"{data_str}"
    )

    try:
        client = _get_client()
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
        )
    except Exception as exc:
        _log(f"FAIL gemini_call ({type(exc).__name__}): {str(exc)[:300]}")
        return ""

    raw_text = getattr(response, "text", None)

    try:
        bullets = _parse_bullets(raw_text)
    except ValueError as exc:
        # Surface the actual response we got so future failures are
        # diagnosable from logs alone.
        _log(
            f"FAIL parse: {exc}  raw_text={(raw_text or '')[:200]!r}"
        )
        return ""

    _log(f"OK type={insurance_type} bullets={len(bullets)} model={model}")
    return "\n".join(f"• {b}" for b in bullets)


# ── Regenerate endpoint ───────────────────────────────────────────
# Lets advisors retry the why-selected generation without re-uploading
# the PDF. Takes the current form payload (same shape as the generate
# endpoints) and returns just the bullets so the frontend can splice
# them into form state.

router = APIRouter(tags=["why-selected"])


class RegenerateWhySelectedRequest(BaseModel):
    insurance_type: str
    data: dict


class RegenerateWhySelectedResponse(BaseModel):
    why_selected: str
    error: str = ""


@router.post(
    "/api/regenerate-why-selected",
    response_model=RegenerateWhySelectedResponse,
)
async def regenerate_why_selected(
    payload: RegenerateWhySelectedRequest,
    user: dict = Depends(get_current_user),
) -> RegenerateWhySelectedResponse:
    """Regenerate the why-selected bullets for a quote without re-parsing.

    Returns ``{"why_selected": "..."}`` on success or
    ``{"why_selected": "", "error": "..."}`` if generation fails so the
    UI can surface a toast / inline error rather than silently doing
    nothing.
    """
    try:
        registration = get_registration(payload.insurance_type)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    why_type = registration.get("why_selected_type", payload.insurance_type)

    bullets = generate_why_selected(payload.data, why_type)
    if bullets:
        return RegenerateWhySelectedResponse(why_selected=bullets)

    # Empty result — generate_why_selected already logged the cause.
    # Return a generic error string for the UI; the diagnostic detail
    # lives in Railway logs.
    return RegenerateWhySelectedResponse(
        why_selected="",
        error="Generation returned no bullets. See server logs for details.",
    )
