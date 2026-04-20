"""
post_process.py
===============
Generic post-processor for parsed insurance quote data.

Replaces all per-type normalizer files. Works for ANY insurance type by
walking the JSON schema from schema_registry to fill defaults and ensure
the frontend always gets a consistent shape.

What it does
------------
1. Pops the ``confidence`` key from the parsed dict
2. Walks the schema and fills missing fields with type-appropriate defaults:
   - string  → ""
   - number  → 0
   - array   → []
   - object  → recursively filled from schema
3. Replaces any ``None`` values with ""
4. Flattens the confidence dict to dot-path keys for the frontend
5. Returns (data, flat_confidence)

What it does NOT do
-------------------
Value normalization (e.g. "DP-3" → "DP3", "Rental" → "Tenant Occupied").
Those rules live in the skill .md files where they belong — the model is
instructed to output the correct normalized values directly.
"""

from __future__ import annotations

import re


# ─────────────────────────────────────────────────────────────────
# Name normalization
# ─────────────────────────────────────────────────────────────────
# Fields holding a person's name across any insurance type.
# Values should always render as "First Last" (Title Case), never
# "FIRST LAST" or "first last".
_NAME_FIELDS = {
    "client_name",
    "named_insured",
    "driver_name",
    "agent_name",
}

# Suffixes + particles that shouldn't be title-cased naively.
# (e.g. "McDonald" should stay "McDonald", "III" should stay "III",
# "O'Brien" keeps the apostrophe casing.)
_NAME_SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}
_NAME_PARTICLES = {"de", "del", "la", "le", "van", "von", "da", "di", "du", "of"}


def _title_case_token(token: str) -> str:
    """Title-case a single name token, preserving suffixes, Mc/Mac
    prefixes, hyphenated parts, and apostrophes."""
    if not token:
        return token

    low = token.lower()

    # Roman numeral / generational suffixes stay upper-case.
    if low.rstrip(".,") in _NAME_SUFFIXES:
        return low.upper() if low.rstrip(".,") in {"ii", "iii", "iv", "v"} else low.capitalize()

    # Hyphenated names: "mary-jane" -> "Mary-Jane"
    if "-" in token:
        return "-".join(_title_case_token(part) for part in token.split("-"))

    # Apostrophe names: "o'brien" -> "O'Brien", "d'angelo" -> "D'Angelo"
    if "'" in token:
        parts = token.split("'")
        return "'".join(_title_case_token(p) for p in parts)

    # "mcdonald" -> "McDonald". We deliberately DON'T auto-title-case "Mac"
    # prefixes because many surnames (Machado, Macias, Mackey) break the rule.
    if len(low) > 2 and low.startswith("mc"):
        return "Mc" + low[2:].capitalize()

    return low.capitalize()


def _titlecase_name(value: str) -> str:
    """Convert a full name string to "First Last" Title Case.

    Handles ALL-CAPS, all-lowercase, mixed-case, extra whitespace,
    hyphenated names, apostrophes, Mc/Mac prefixes, and common suffixes.
    Non-string / empty input is returned unchanged.
    """
    if not isinstance(value, str):
        return value
    stripped = value.strip()
    if not stripped:
        return value

    # Collapse internal whitespace so "KEVIN   LI" -> "Kevin Li".
    tokens = re.split(r"\s+", stripped)
    return " ".join(_title_case_token(t) for t in tokens)


def _normalize_names(obj):
    """Recursively walk a data structure and Title-Case any value whose
    key matches a known name field."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k in _NAME_FIELDS and isinstance(v, str):
                obj[k] = _titlecase_name(v)
            else:
                _normalize_names(v)
    elif isinstance(obj, list):
        for item in obj:
            _normalize_names(item)
    return obj


def flatten_confidence(conf: dict, prefix: str = "") -> dict[str, float]:
    """Flatten a nested confidence dict into {dotted.key: score} pairs."""
    result: dict[str, float] = {}
    if not isinstance(conf, dict):
        return result
    for k, v in conf.items():
        path = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            result.update(flatten_confidence(v, path))
        elif isinstance(v, list):
            for i, item in enumerate(v):
                if isinstance(item, dict):
                    result.update(flatten_confidence(item, f"{path}.{i}"))
                elif isinstance(item, (int, float)):
                    result[f"{path}.{i}"] = float(item)
        elif isinstance(v, (int, float)):
            result[path] = float(v)
    return result


def _default_for_type(type_str: str):
    """Return the default value for a JSON schema type."""
    if type_str == "string":
        return ""
    if type_str == "number":
        return 0
    if type_str == "array":
        return []
    if type_str == "object":
        return {}
    return ""


def _fill_defaults_from_schema(data: dict, schema: dict) -> dict:
    """
    Walk a JSON schema and ensure every defined property exists in data
    with a type-appropriate default. Handles nested objects and arrays.
    """
    props = schema.get("properties", {})

    for key, prop_def in props.items():
        if key == "confidence":
            continue  # handled separately

        prop_type = prop_def.get("type", "string")
        current = data.get(key)

        if prop_type == "object":
            if current is None or not isinstance(current, dict):
                current = {}
            data[key] = _fill_defaults_from_schema(current, prop_def)

        elif prop_type == "array":
            if current is None or not isinstance(current, list):
                data[key] = []
            else:
                # Fill defaults within each array item if items schema exists
                items_schema = prop_def.get("items", {})
                if items_schema.get("type") == "object":
                    for i, item in enumerate(current):
                        if isinstance(item, dict):
                            current[i] = _fill_defaults_from_schema(item, items_schema)
                data[key] = current

        else:
            # Scalar — fill if missing or None
            if current is None:
                data[key] = _default_for_type(prop_type)
            elif prop_type == "string" and current is None:
                data[key] = ""

    return data


def _replace_none(obj):
    """Recursively replace None values with "" throughout a data structure."""
    if isinstance(obj, dict):
        return {k: _replace_none(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_replace_none(item) for item in obj]
    if obj is None:
        return ""
    return obj


def post_process(parsed: dict, schema: dict) -> tuple[dict, dict[str, float]]:
    """
    Generic post-processor for any insurance type.

    Args:
        parsed: Raw dict from Gemini's JSON response (includes "confidence" key)
        schema: The JSON schema from schema_registry for this insurance type

    Returns:
        (data_dict, flat_confidence_dict)
    """
    # 1. Pop confidence
    raw_confidence = parsed.pop("confidence", {})

    # 2. Fill defaults from schema
    data = _fill_defaults_from_schema(parsed, schema)

    # 3. Replace any remaining None values
    data = _replace_none(data)

    # 4. Normalize all person-name fields to "First Last" Title Case.
    #    Applies to client_name, named_insured, driver_name, agent_name
    #    everywhere they appear (flat, inside arrays, nested objects).
    _normalize_names(data)

    # 5. Flatten confidence
    flat_confidence = flatten_confidence(raw_confidence)

    return data, flat_confidence
