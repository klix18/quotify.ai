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

NOTE (v2 skills library, 2026-04-20):
  Carrier-specific overrides are now **baked directly** into each base
  SKILL.md under a ``## Carrier-Specific Overrides`` section. There are
  no longer separate carrier patch files to merge at load time. Pass 0
  (this module) is retained for observability — we still record which
  carrier was detected in parse_metrics — but the detected carrier_key
  no longer changes what prompt content is sent to the model.

Skills library layout (v2):

    parsers/skills/
      parse_homeowners/SKILL.md   ← base + all homeowners carrier overrides
      parse_auto/SKILL.md         ← base + all auto carrier overrides
      parse_dwelling/SKILL.md     ← base + all dwelling carrier overrides
      parse_commercial/SKILL.md   ← base only (no carrier-specific quirks)
      parse_bundle/SKILL.md       ← composite, @include home + auto
      parse_bundle_separate/SKILL.md  ← supplement for two-PDF bundle mode
      parse_wind_hail/SKILL.md        ← supplement for wind/hail second PDF

Each SKILL.md starts with YAML frontmatter (``name``/``description``),
which skill_loader.py strips before handing the body to the model.

Extending
---------
To add or update a carrier hint:
  1. Edit the relevant ``parsers/skills/parse_<insurance_type>/SKILL.md``
     and add or update a subsection under ``## Carrier-Specific Overrides``.
  2. Add carrier name aliases to CARRIER_ALIASES below (if new carrier).
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
# In the v2 skills library the key is used for observability / telemetry
# (logged into parse_metrics) and must match the subsection anchor used
# inside ``## Carrier-Specific Overrides`` in each base SKILL.md.
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

    Note: in the v2 skills library carrier overrides are baked into each
    base SKILL.md, so the returned ``carrier_key`` is recorded for
    observability (parse_metrics) but no longer changes what prompt
    content is sent to the model. This module stays focused on just the
    detection step.
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
