"""
skill_loader.py
===============
Loads and caches insurance extraction skill files from
``parsers/skills/parse_<type>/SKILL.md``.

Each skill file is a Markdown document with a YAML frontmatter block,
followed by body sections describing:
  - Fields to extract (with aliases and mapping rules)
  - Type-specific rules
  - Carrier-specific overrides (baked directly into the base skill)

Folder layout:

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

Carrier overrides are baked directly into each base SKILL.md under a
``## Carrier-Specific Overrides`` section, so there is no separate
carrier-patch merge step.
"""

from __future__ import annotations

import re
from pathlib import Path

SKILLS_DIR = Path(__file__).parent / "skills"

# ── Cache ─────────────────────────────────────────────────────────────────────
# Keyed by insurance_type. Carrier overrides are baked into the base skill,
# so no carrier-level caching is needed.

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


def get_skill_version(insurance_type: str) -> str:
    """Return the VERSION string from a skill file, or 'unknown'."""
    try:
        skill = load_skill(insurance_type)
        m = re.search(r"^>\s*VERSION:\s*(.+)$", skill, re.MULTILINE)
        return m.group(1).strip() if m else "unknown"
    except FileNotFoundError:
        return "unknown"


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
