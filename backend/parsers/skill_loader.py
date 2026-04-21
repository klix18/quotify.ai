"""
skill_loader.py
===============
Loads and caches insurance extraction skill files from
``parsers/skills/parse_<type>/SKILL.md``.

Each skill file is a Markdown document with a YAML frontmatter block,
followed by body sections describing:
  - Fields to extract (with aliases and mapping rules)
  - Type-specific rules
  - A quick-pass field list for streaming
  - Carrier-specific overrides (concatenated into the base skill)

Folder layout (v2):

    parsers/skills/
      parse_homeowners/SKILL.md       ← base + all homeowners carrier overrides
      parse_auto/SKILL.md             ← base + all auto carrier overrides
      parse_dwelling/SKILL.md         ← base + all dwelling carrier overrides
      parse_commercial/SKILL.md       ← base only (no carrier patches)
      parse_bundle/SKILL.md           ← uses @include to pull in home + auto
      parse_bundle_separate/SKILL.md  ← supplement for two-PDF bundle mode
      parse_wind_hail/SKILL.md        ← supplement for wind/hail second PDF

Every file begins with a YAML frontmatter block:

    ---
    name: parse_<type>
    description: Use this skill when parsing a <type> insurance quote PDF
    ---

The frontmatter is parsed for metadata and then STRIPPED before the skill
body is returned to callers — the LLM only ever sees the body.

The @include directive (used by parse_bundle) is resolved at load time so
composite skills contain the complete text of their dependencies.

Carrier patches used to live as separate .md files under a per-type
directory; they are now baked directly into each base SKILL.md under a
``## Carrier-Specific Overrides`` section. `load_skill_with_carrier()` is
preserved for backwards compatibility with `unified_parser_api.py` but
simply returns the base skill (carrier context is already baked in).
"""

from __future__ import annotations

import re
from pathlib import Path

SKILLS_DIR = Path(__file__).parent / "skills"

# ── Cache ─────────────────────────────────────────────────────────────────────
# Keyed by "{insurance_type}" for base skills.
# (Carrier keys are no longer cache-relevant since patches are baked in,
# but we keep the dict dual-purpose so reload_skills() works for everything.)

_skill_cache: dict[str, str] = {}


# ── Internal helpers ──────────────────────────────────────────────────────────

_FRONTMATTER_RE = re.compile(r"^---\s*\n.*?\n---\s*\n?", re.DOTALL)


def _strip_frontmatter(text: str) -> str:
    """Remove a leading YAML frontmatter block (``---...---``) if present."""
    return _FRONTMATTER_RE.sub("", text, count=1)


def _skill_path(insurance_type: str) -> Path:
    """Return the canonical path for a given insurance type's SKILL.md."""
    key = insurance_type.lower().strip()
    return SKILLS_DIR / f"parse_{key}" / "SKILL.md"


# ── Public API ────────────────────────────────────────────────────────────────

def load_skill(insurance_type: str) -> str:
    """
    Return the skill body for *insurance_type* (frontmatter stripped).

    Resolves ``@include <type>`` directives so composite skills (e.g.
    parse_bundle) contain the complete text of their dependencies.

    Raises FileNotFoundError if the skill file does not exist.
    """
    key = insurance_type.lower().strip()
    if key in _skill_cache:
        return _skill_cache[key]

    path = _skill_path(key)
    if not path.exists():
        raise FileNotFoundError(
            f"No skill file found for insurance type '{key}'. "
            f"Expected: {path}"
        )

    raw = path.read_text(encoding="utf-8")
    body = _strip_frontmatter(raw)
    resolved = _resolve_includes(body)
    _skill_cache[key] = resolved
    return resolved


def load_skill_with_carrier(insurance_type: str, carrier_key: str) -> tuple[str, bool]:
    """
    Return (skill_text, carrier_patch_loaded).

    In the v2 skills library, carrier-specific guidance lives inside each
    base SKILL.md under a ``## Carrier-Specific Overrides`` section. There
    are no longer separate carrier patch files to merge at load time.

    This function is kept for backwards compatibility with callers that
    still pass a carrier_key; it always returns ``(load_skill(type), False)``.

    Parameters
    ----------
    insurance_type : e.g. "homeowners", "dwelling"
    carrier_key    : accepted but ignored — retained for API stability.

    Returns
    -------
    (skill_text, patch_loaded)
      skill_text   — the base skill (which already contains all carrier overrides)
      patch_loaded — always False (no external patch is merged)
    """
    _ = carrier_key  # accepted for backwards compat; carriers are baked in
    return load_skill(insurance_type), False


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
    """
    Return a list of all available insurance type names.

    Looks for directories matching ``parse_*/SKILL.md`` and strips the
    ``parse_`` prefix. For example a directory ``parse_homeowners`` with
    a ``SKILL.md`` file yields the type name ``"homeowners"``.
    """
    types: list[str] = []
    for p in sorted(SKILLS_DIR.glob("parse_*/SKILL.md")):
        folder = p.parent.name  # e.g. "parse_homeowners"
        if folder.startswith("parse_"):
            types.append(folder[len("parse_") :])
    return types


def list_carrier_patches(insurance_type: str) -> list[str]:
    """
    Return the list of carrier keys that have dedicated patches for
    *insurance_type*.

    In the v2 skills library, carrier overrides are baked into each base
    SKILL.md and there are no external patch files. This function always
    returns an empty list, kept for API-stability with earlier callers.
    """
    _ = insurance_type
    return []


def reload_skills() -> None:
    """Clear the skill cache, forcing files to be re-read on next access."""
    _skill_cache.clear()


# ── Internal ──────────────────────────────────────────────────────────────────

def _resolve_includes(text: str) -> str:
    """
    Resolve ``> @include <type>`` directives in the skill text.

    Included content is inserted inline with its own frontmatter and
    ``> VERSION:`` / ``> TYPE:`` header lines stripped to avoid duplicate
    metadata when the composite skill is sent to the model.
    """
    def _replacer(m: re.Match) -> str:
        included_type = m.group(1).strip().lower()
        included_path = _skill_path(included_type)
        try:
            included_raw = included_path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return f"<!-- @include {included_type}: FILE NOT FOUND -->"

        body = _strip_frontmatter(included_raw)
        # Strip any remaining '>' metadata lines (VERSION/TYPE/@include) from
        # the included content so we don't duplicate headers in the merged output.
        body_lines = [l for l in body.splitlines() if not l.strip().startswith(">")]
        return "\n".join(body_lines)

    return re.sub(r"^>\s*@include\s+(\S+)\s*$", _replacer, text, flags=re.MULTILINE)
