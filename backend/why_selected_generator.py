# why_selected_generator.py
# Generates "Why This Plan Was Selected" bullets using Gemini Flash.
# 2-pass approach:
#   Pass 1 (draft): quick generation from partial data after draft extraction
#   Pass 2 (refine): polish/correct using final verified data
#
# Tone: professional insurance advisor — confident, clear, reassuring.

import json
import os

from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv()


def _get_client() -> genai.Client:
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise ValueError("GEMINI_API_KEY is not set.")
    return genai.Client(api_key=api_key)


# ── Prompts ─────────────────────────────────────────────────────

_DRAFT_PROMPT = """\
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

_REFINE_PROMPT = """\
You are a 20-year veteran insurance advisor. You wrote a draft plan
summary earlier. Now you have the final verified quote data.

This plan was selected from multiple competing quotes. Each bullet
should explain why THIS plan is the best choice for the client.

Review your draft against the final data. Fix inaccuracies and
strengthen weak bullets. Keep what already works.

ABSOLUTE RULE — NO NUMBERS: If any bullet contains a dollar amount,
percentage, or specific number, REWRITE it using relative language
like "strong", "meaningful", "competitive", "realistic", "robust".

Quality check — every bullet must:
- Explain why this plan wins, not just describe what it contains.
- Use active voice (never "is included" / "is provided").
- Contain ZERO numbers of any kind.

If the draft already meets all standards, return it unchanged.

Rules:
- Return ONLY a JSON array of 3-4 strings. No other text.
- Each bullet max 75 characters.
- ZERO dollar amounts, ZERO numbers, ZERO percentages.
- Vary sentence openers.
"""


def _call_gemini(prompt: str, content: str, model: str) -> list:
    """Call Gemini and return parsed bullet list, or empty list on failure."""
    try:
        client = _get_client()
        response = client.models.generate_content(
            model=model,
            contents=[content],
            config=types.GenerateContentConfig(
                system_instruction=prompt,
                temperature=0.3,
                response_mime_type="application/json",
            ),
        )
        bullets = json.loads(response.text.strip())
        if isinstance(bullets, list) and len(bullets) >= 2:
            return [b.strip() for b in bullets[:4] if b.strip()]
    except Exception:
        pass
    return []


def _format_bullets(bullets: list) -> str:
    """Format bullet list as newline-separated string with • prefix."""
    if not bullets:
        return ""
    return "\n".join(f"• {b}" for b in bullets)


def generate_why_selected_draft(
    partial_data: dict,
    insurance_type: str,
    model: str = "gemini-2.5-flash-lite",
) -> str:
    """Pass 1: Generate draft bullets from partial/draft data.

    Called after the quick extraction pass completes.
    Returns formatted bullet string or empty string.
    """
    data_str = json.dumps(partial_data, indent=2)
    content = f"Here is the draft quote data for a {insurance_type} policy:\n\n{data_str}"
    bullets = _call_gemini(_DRAFT_PROMPT, content, model)
    return _format_bullets(bullets)


def generate_why_selected_refine(
    final_data: dict,
    draft_bullets: str,
    insurance_type: str,
    model: str = "gemini-2.5-flash-lite",
) -> str:
    """Pass 2: Refine draft bullets using final verified data.

    Called after the structured extraction pass completes.
    Only makes changes if the draft needs correction.
    Returns formatted bullet string, or falls back to draft.
    """
    if not draft_bullets:
        # No draft to refine — generate fresh from final data
        data_str = json.dumps(final_data, indent=2)
        content = f"Here is the verified quote data for a {insurance_type} policy:\n\n{data_str}"
        bullets = _call_gemini(_DRAFT_PROMPT, content, model)
        return _format_bullets(bullets)

    data_str = json.dumps(final_data, indent=2)
    content = (
        f"Here is the final verified quote data for a {insurance_type} policy:\n\n{data_str}\n\n"
        f"Here is the draft summary you wrote earlier:\n{draft_bullets}\n\n"
        f"Refine if needed, or return unchanged if accurate."
    )
    bullets = _call_gemini(_REFINE_PROMPT, content, model)
    return _format_bullets(bullets) if bullets else draft_bullets


# Legacy single-call API (kept for backwards compatibility)
def generate_why_selected(
    parsed_data: dict,
    insurance_type: str,
    model: str = "gemini-2.5-flash-lite",
) -> str:
    """Single-pass generation. Use generate_why_selected_draft + _refine instead."""
    return generate_why_selected_draft(parsed_data, insurance_type, model)
