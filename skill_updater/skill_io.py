"""Read/write SKILL.md files in the main backend.

Path convention: backend/parsers/skills/parse_<insurance_type>/SKILL.md.
This is the only place skill_updater touches the main backend's tree.
"""

from __future__ import annotations

from pathlib import Path

# Resolve to the sibling backend folder regardless of where Python is invoked.
ROOT = Path(__file__).resolve().parent.parent
SKILLS_ROOT = ROOT / "backend" / "parsers" / "skills"


# Most insurance_type values map directly. A few aliases handle the
# bundle/bundle_separate split — bundle events parse a single bundle document,
# bundle_separate handles two PDFs. By default we improve the matching skill.
_TYPE_ALIASES = {
    # Add overrides here if an insurance_type uses a non-default skill folder
}


def skill_path(insurance_type: str) -> Path:
    folder = _TYPE_ALIASES.get(insurance_type, f"parse_{insurance_type}")
    return SKILLS_ROOT / folder / "SKILL.md"


def read_skill(insurance_type: str) -> str:
    path = skill_path(insurance_type)
    if not path.exists():
        raise FileNotFoundError(
            f"SKILL.md not found for insurance_type={insurance_type!r} at {path}"
        )
    return path.read_text(encoding="utf-8")


def write_skill(insurance_type: str, new_content: str) -> Path:
    """Overwrite the SKILL.md atomically. Returns the path written."""
    path = skill_path(insurance_type)
    if not path.exists():
        raise FileNotFoundError(f"Cannot write — SKILL.md missing at {path}")
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(new_content, encoding="utf-8")
    tmp.replace(path)
    return path


def available_insurance_types() -> list[str]:
    """List the insurance types we have skill files for."""
    if not SKILLS_ROOT.exists():
        return []
    out: list[str] = []
    for p in SKILLS_ROOT.iterdir():
        if p.is_dir() and p.name.startswith("parse_") and (p / "SKILL.md").exists():
            out.append(p.name[len("parse_"):])
    return sorted(out)
