"""
carrier_detector.py
===================
Pass 0 — Vision-based carrier detection.

Uses Gemini's multimodal vision to look at the first page of a quote PDF
and identify the insurance carrier logo. No text parsing; the model sees
the rendered page just like a human would.

Carrier logos are almost always:
  • Top-left corner (most common)
  • Top-center
  • Top-right

The normalized carrier key (e.g. "tower_hill") is returned to the caller.
The actual hint file loading is handled by skill_loader.py, which knows
how to merge the base skill + carrier patch into one combined prompt.

Carrier hints live alongside the base skill they extend:

    parsers/skills/
      homeowners.md           ← base skill (all homeowners fields)
      homeowners/             ← carrier-specific patches for homeowners
        tower_hill.md         ← only the quirks that differ for Tower Hill
        sagesure.md
        american_modern.md
      dwelling.md
      dwelling/
        tower_hill.md
        jj.md
        american_modern.md
      auto.md
      auto/
        progressive.md

The base skill handles ~95% of fields. The carrier patch only documents
what's different: renamed columns, non-standard layouts, known edge cases.

Extending
---------
To add a new carrier hint:
  1. Create parsers/skills/<insurance_type>/<carrier_key>.md
  2. Add carrier name aliases to CARRIER_ALIASES below (if new carrier)
  No other code changes needed.
"""

from __future__ import annotations

from google import genai
from google.genai import types

from parsers._model_fallback import DEFAULT_QUICK_FALLBACKS, generate_with_fallback

# ── Model for Pass 0 — fast, vision-capable ──────────────────────────────────
MODEL_DETECT: str = "gemini-2.5-flash-lite"

# ── Carrier name → normalized key ────────────────────────────────────────────
# Maps any string the model might return to a canonical carrier key.
# Keys must match the .md filenames inside parsers/skills/{insurance_type}/.
CARRIER_ALIASES: dict[str, str] = {
    # Tower Hill
    "tower hill": "tower_hill",
    "tower hill insurance": "tower_hill",
    "tower hill preferred": "tower_hill",
    "tower hill prime": "tower_hill",
    "tower hill signature": "tower_hill",
    "thi": "tower_hill",

    # American Modern
    "american modern": "american_modern",
    "american modern insurance": "american_modern",
    "american modern home": "american_modern",
    "amig": "american_modern",

    # SageSure
    "sagesure": "sagesure",
    "sage sure": "sagesure",
    "sagesure insurance managers": "sagesure",

    # Slide Insurance
    "slide": "slide",
    "slide insurance": "slide",

    # Citizens
    "citizens": "citizens",
    "citizens property": "citizens",
    "citizens property insurance": "citizens",
    "citizens property insurance corporation": "citizens",

    # Universal P&C
    "universal property": "universal",
    "universal property & casualty": "universal",
    "universal p&c": "universal",
    "upcic": "universal",

    # Federated National
    "federated national": "federated_national",
    "fednat": "federated_national",

    # Security First
    "security first": "security_first",
    "security first financial": "security_first",
    "security first insurance": "security_first",

    # Heritage
    "heritage": "heritage",
    "heritage insurance": "heritage",
    "heritage property & casualty": "heritage",

    # Openly
    "openly": "openly",
    "openly insurance": "openly",

    # Kin
    "kin": "kin",
    "kin insurance": "kin",

    # Hippo
    "hippo": "hippo",
    "hippo insurance": "hippo",

    # J&J / Great Lakes (MGA, often for dwelling)
    "j&j": "jj",
    "j & j": "jj",
    "great lakes": "jj",
    "great lakes mutual": "jj",
    "great lakes insurance": "jj",

    # Markel
    "markel": "markel",
    "markel insurance": "markel",
    "markel specialty": "markel",

    # NCJUA / FAIR Plan
    "ncjua": "ncjua",
    "nc joint underwriting": "ncjua",
    "north carolina joint underwriting": "ncjua",
    "fair plan": "ncjua",

    # Progressive
    "progressive": "progressive",
    "progressive insurance": "progressive",

    # Allstate
    "allstate": "allstate",
    "allstate insurance": "allstate",

    # State Farm
    "state farm": "state_farm",
    "state farm insurance": "state_farm",

    # Nationwide
    "nationwide": "nationwide",
    "nationwide insurance": "nationwide",

    # Travelers
    "travelers": "travelers",
    "the travelers": "travelers",
    "travelers insurance": "travelers",

    # Liberty Mutual
    "liberty mutual": "liberty_mutual",
    "liberty mutual insurance": "liberty_mutual",

    # Hartford
    "hartford": "hartford",
    "the hartford": "hartford",
    "hartford insurance": "hartford",
}

_DETECT_PROMPT = """\
Look at the top of the first page of this insurance document.
Identify the insurance company or carrier whose logo or name appears.

Return ONLY the carrier name — nothing else. No explanation, no punctuation, no quotes.

Examples of valid responses:
Tower Hill
SageSure
American Modern
Progressive

If you cannot identify a carrier from the document header, return: unknown
"""


def normalize_carrier(raw: str) -> str:
    """
    Map a raw model response to a normalized carrier key.
    Returns 'unknown' if no mapping is found.
    """
    clean = raw.strip().lower()
    # Direct lookup first
    if clean in CARRIER_ALIASES:
        return CARRIER_ALIASES[clean]
    # Substring match — handles "Tower Hill Insurance Group" → "tower_hill"
    for alias, key in CARRIER_ALIASES.items():
        if alias in clean:
            return key
    return "unknown"


def detect_carrier(
    uploaded_file: any,
    client: genai.Client,
) -> dict:
    """
    Run Pass 0: vision-based carrier detection.

    Parameters
    ----------
    uploaded_file  : Gemini File object (already uploaded via Files API)
    client         : genai.Client instance

    Returns
    -------
    {
        "raw":         str,   # exactly what the model returned
        "carrier_key": str,   # e.g. "tower_hill" or "unknown"
    }

    Note: hint loading is intentionally NOT done here — skill_loader.py
    handles merging the base skill + carrier patch, keeping this module
    focused on just the detection step.
    """
    try:
        resp = generate_with_fallback(
            client,
            MODEL_DETECT,
            DEFAULT_QUICK_FALLBACKS,
            contents=[_DETECT_PROMPT, uploaded_file],
            config=types.GenerateContentConfig(temperature=0),
        )
        raw = (resp.text or "").strip()
    except Exception as exc:
        # Pass 0 failure is non-fatal — extraction continues without hints
        return {
            "raw": f"[detection error: {exc}]",
            "carrier_key": "unknown",
        }

    return {
        "raw": raw,
        "carrier_key": normalize_carrier(raw),
    }
