"""
skill_loader.py
===============
Loads and caches insurance extraction skill files from parsers/skills/*.md.

Each skill file is a Markdown document describing:
  - Fields to extract (with aliases and mapping rules)
  - Type-specific rules
  - A quick-pass field list for Pass 1 streaming

Carrier-specific patches live alongside the base skill in a subdirectory:

    parsers/skills/
      homeowners.md             ← base skill (all carriers)
      homeowners/               ← carrier patches (only the quirks)
        tower_hill.md
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

When a carrier is detected, `load_skill_with_carrier()` merges:
  base skill content + "── CARRIER PATCH ──" + carrier patch content

The base skill covers ~95% of fields. The carrier patch only documents
what's different for that specific carrier: renamed columns, unusual
layouts, non-standard field formats, known edge cases.

The @include directive (used by bundle.md) is resolved at load time so
composite skills contain the complete text of their dependencies.
"""

from __future__ import annotations

import re
from pathlib import Path

SKILLS_DIR = Path(__file__).parent / "skills"

# ── Cache ─────────────────────────────────────────────────────────────────────
# Keyed by "{insurance_type}" for base skills
# and "{insurance_type}::{carrier_key}" for merged skills

_skill_cache: dict[str, str] = {}


# ── Public API ────────────────────────────────────────────────────────────────

def load_skill(insurance_type: str) -> str:
    """
    Return the base skill text for *insurance_type* (no carrier patch).

    Resolves ``@include <type>`` directives so composite skills (e.g. bundle)
    contain the complete text of their dependencies.

    Raises FileNotFoundError if the skill file does not exist.
    """
    key = insurance_type.lower().strip()
    if key in _skill_cache:
        return _skill_cache[key]

    path = SKILLS_DIR / f"{key}.md"
    if not path.exists():
        raise FileNotFoundError(
            f"No skill file found for insurance type '{key}'. "
            f"Expected: {path}"
        )

    raw = path.read_text(encoding="utf-8")
    resolved = _resolve_includes(raw)
    _skill_cache[key] = resolved
    return resolved


def load_skill_with_carrier(insurance_type: str, carrier_key: str) -> tuple[str, bool]:
    """
    Return (merged_skill_text, carrier_patch_loaded).

    If a carrier patch exists at skills/{insurance_type}/{carrier_key}.md,
    the result is the base skill + a clearly marked carrier section appended.
    Otherwise returns (base_skill, False).

    The merged result is cached separately from the base skill so that
    different carriers for the same type are independently cached.

    Parameters
    ----------
    insurance_type : e.g. "homeowners", "dwelling"
    carrier_key    : normalized key from carrier_detector, e.g. "tower_hill"
                     Use "" or "unknown" to get just the base skill.

    Returns
    -------
    (skill_text, patch_loaded)
      skill_text   — base skill (+ carrier patch if found)
      patch_loaded — True if a carrier-specific patch was appended
    """
    base = load_skill(insurance_type)

    if not carrier_key or carrier_key == "unknown":
        return base, False

    cache_key = f"{insurance_type}::{carrier_key}"
    if cache_key in _skill_cache:
        return _skill_cache[cache_key], True

    patch_path = SKILLS_DIR / insurance_type / f"{carrier_key}.md"
    if not patch_path.exists():
        return base, False

    patch_text = patch_path.read_text(encoding="utf-8")
    # Progressive disclosure (Anthropic best practice):
    #   Level 2 = base skill (above) — universal fields, rules, methodology
    #   Level 3 = carrier patch (below) — only what DIFFERS for this carrier
    # Carrier overrides take precedence over any conflicting base guidance.
    merged = (
        base
        + "\n\n"
        + "━" * 60 + "\n"
        + f"## CARRIER OVERRIDES — {carrier_key.replace('_', ' ').title()}\n"
        + "The following overrides extend the base skill above.\n"
        + "Where they conflict with the base, these overrides win.\n"
        + "━" * 60 + "\n\n"
        + patch_text
    )
    _skill_cache[cache_key] = merged
    return merged, True


def get_skill_version(insurance_type: str) -> str:
    """Return the VERSION string from a skill file, or 'unknown'."""
    try:
        skill = load_skill(insurance_type)
        m = re.search(r"^>\s*VERSION:\s*(.+)$", skill, re.MULTILINE)
        return m.group(1).strip() if m else "unknown"
    except FileNotFoundError:
        return "unknown"


def get_quick_pass_fields(insurance_type: str) -> list[str]:
    """
    Parse the '## Quick Pass Fields' section and return field names as a list.
    Used to build the Pass 1 quick-extract user prompt.
    """
    try:
        skill = load_skill(insurance_type)
    except FileNotFoundError:
        return []

    m = re.search(
        r"##\s*Quick Pass Fields\s*\n(.*?)(?=^##|\Z)",
        skill,
        re.DOTALL | re.MULTILINE,
    )
    if not m:
        return []

    section = m.group(1)
    fields = []
    for line in section.splitlines():
        stripped = line.strip().lstrip("-").strip()
        if re.match(r"^[a-z][a-z0-9_]*$", stripped):
            fields.append(stripped)
    return fields


def list_available_skills() -> list[str]:
    """Return a list of all available insurance type names (base skills only)."""
    return [p.stem for p in sorted(SKILLS_DIR.glob("*.md"))]


def list_carrier_patches(insurance_type: str) -> list[str]:
    """
    Return a list of carrier keys that have patches for the given insurance type.
    E.g. list_carrier_patches("dwelling") → ["american_modern", "jj", "tower_hill"]
    """
    patch_dir = SKILLS_DIR / insurance_type
    if not patch_dir.exists():
        return []
    return sorted(p.stem for p in patch_dir.glob("*.md"))


def reload_skills() -> None:
    """Clear the skill cache, forcing files to be re-read on next access."""
    _skill_cache.clear()


# ── Internal ──────────────────────────────────────────────────────────────────

def _resolve_includes(text: str) -> str:
    """
    Resolve ``@include <type>`` directives in the skill text.
    Included content is inserted inline (without its own VERSION/TYPE headers)
    to avoid duplicate metadata.
    """
    def _replacer(m: re.Match) -> str:
        included_type = m.group(1).strip().lower()
        try:
            included_path = SKILLS_DIR / f"{included_type}.md"
            included_raw = included_path.read_text(encoding="utf-8")
            # Strip the frontmatter (lines starting with >) from included file
            lines = included_raw.splitlines()
            body_lines = [l for l in lines if not l.strip().startswith(">")]
            return "\n".join(body_lines)
        except FileNotFoundError:
            return f"<!-- @include {included_type}: FILE NOT FOUND -->"

    return re.sub(r"^>\s*@include\s+(\S+)\s*$", _replacer, text, flags=re.MULTILINE)
