"""
Skill loader for the AI analytics chatbot.
Reads markdown skill files from this directory and builds
prompt context for the LLM.
"""

from pathlib import Path

SKILLS_DIR = Path(__file__).resolve().parent


def _parse_frontmatter(content: str) -> tuple[dict, str]:
    """Parse YAML-like frontmatter from a markdown file."""
    if not content.startswith("---"):
        return {}, content

    parts = content.split("---", 2)
    if len(parts) < 3:
        return {}, content

    frontmatter_str = parts[1].strip()
    body = parts[2].strip()

    # Simple YAML-like parsing (no pyyaml dependency needed)
    meta = {}
    current_key = None
    current_list = None

    for line in frontmatter_str.split("\n"):
        line = line.strip()
        if not line:
            continue

        if line.startswith("- ") and current_key:
            # List item
            if current_list is None:
                current_list = []
            current_list.append(line[2:].strip())
            meta[current_key] = current_list
        elif ":" in line:
            # Save previous list if any
            current_list = None
            key, _, value = line.partition(":")
            key = key.strip()
            value = value.strip()
            current_key = key
            if value:
                meta[key] = value
            # If no value, might be start of a list
        # else: continuation line, ignore

    return meta, body


def load_skills(scope: str = "admin") -> list[dict]:
    """
    Load all skill files for the given scope.
    Returns a list of dicts with: name, description, triggers, body, scope.
    """
    skills = []

    for file in sorted(SKILLS_DIR.glob("*.md")):
        content = file.read_text(encoding="utf-8")
        meta, body = _parse_frontmatter(content)

        skill_scope = meta.get("scope", "admin")
        if skill_scope != scope and skill_scope != "all":
            continue

        skills.append({
            "name": meta.get("name", file.stem.replace("_", " ").title()),
            "description": meta.get("description", ""),
            "triggers": meta.get("triggers", []),
            "body": body,
            "scope": skill_scope,
            "file": file.name,
        })

    return skills


def build_skills_prompt(scope: str = "admin") -> str:
    """
    Build the skills section of the system prompt by reading all
    skill markdown files for the given scope.
    """
    skills = load_skills(scope)

    if not skills:
        return "No skills loaded."

    lines = [
        "## SKILLS YOU HAVE",
        "You can reason about all the data provided to answer any analytics question. "
        "Think step by step about what data is relevant before answering. "
        "You have the following analytical skills:\n",
    ]

    for i, skill in enumerate(skills, 1):
        lines.append(f"### Skill {i}: {skill['name']}")
        lines.append(f"_{skill['description']}_\n")
        lines.append(skill["body"])
        lines.append("")  # blank line between skills

    return "\n".join(lines)


def list_skill_names(scope: str = "admin") -> list[str]:
    """Return just the names of available skills."""
    return [s["name"] for s in load_skills(scope)]
