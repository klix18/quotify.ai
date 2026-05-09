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

import json
import os

from dotenv import load_dotenv
from google import genai
from google.genai import types

from parsers._model_fallback import (
    DEFAULT_FALLBACKS,
    generate_with_fallback,
)

load_dotenv()


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

    Uses the shared Gemini fallback helper so a demand spike on the primary
    model transparently walks the fallback chain instead of silently
    dropping the bullets.
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
        bullets = json.loads(response.text.strip())
        if isinstance(bullets, list) and len(bullets) >= 2:
            cleaned = [b.strip() for b in bullets[:4] if b.strip()]
            if cleaned:
                return "\n".join(f"• {b}" for b in cleaned)
    except Exception:
        pass
    return ""
