"""Per-insurance-type proposal synthesis.

Reads N findings (each from one event) for a single insurance_type, plus the
current SKILL.md, and proposes a fully-revised SKILL.md.

Uses OpenAI GPT-5. Structured output is enforced via the Chat Completions
strict JSON-schema mode (``response_format={"type":"json_schema",...}``),
which guarantees the response parses to {rationale, proposed_skill_md}.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Optional

from dotenv import dotenv_values
from openai import OpenAI

from models import Finding, Proposal

# Strongest available reasoning model for prompt-engineering tasks.
SYNTHESIZER_MODEL = "gpt-5"

_RETRIES = 3
_RETRY_BACKOFF_SEC = 6.0
_MAX_OUTPUT_TOKENS = 16000

PROMPTS_DIR = Path(__file__).resolve().parent / "prompts"


# ── JSON schema (forces structured output) ────────────────────────────
# OpenAI's strict mode requires every property to be marked required and
# additionalProperties to be false. Both fields are required for our use
# case anyway — empty proposals are caught by the empty-check below.

PROPOSAL_SCHEMA = {
    "name": "skill_edit_proposal",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {
            "rationale": {
                "type": "string",
                "description": (
                    "Short paragraph explaining what changed and why. "
                    "Reference specific findings or patterns where possible."
                ),
            },
            "proposed_skill_md": {
                "type": "string",
                "description": (
                    "The COMPLETE revised SKILL.md content, ready to write to "
                    "disk. Include YAML frontmatter, all section headings, and "
                    "all body text — even the parts that didn't change."
                ),
            },
        },
        "required": ["rationale", "proposed_skill_md"],
        "additionalProperties": False,
    },
}


def _api_key() -> str:
    here = Path(__file__).resolve().parent
    for env_path in (here / ".env", here.parent / "backend" / ".env"):
        if env_path.exists():
            v = dotenv_values(env_path).get("OPENAI_API_KEY")
            if v:
                return v
    v = os.environ.get("OPENAI_API_KEY")
    if not v:
        raise RuntimeError(
            "OPENAI_API_KEY missing — set it in skill_updater/.env "
            "(or backend/.env, which we also read)."
        )
    return v


def _get_client() -> OpenAI:
    return OpenAI(api_key=_api_key())


def _findings_summary(findings: list[Finding]) -> list[dict]:
    """Compact, model-friendly summary. Strip noise (long surrounding_text bodies)
    but keep enough signal for the synthesizer."""
    out: list[dict] = []
    for f in findings:
        loc_by_code = {l.code_name: l for l in f.original_locations}
        read_by_code = {r.code_name: r for r in f.generated_reads}
        misses: list[dict] = []
        for code in f.parser_misses:
            loc = loc_by_code.get(code)
            read = read_by_code.get(code)
            if not loc or not read:
                continue
            misses.append({
                "code_name": code,
                "display_label_in_quote": read.display_label,
                "final_value": read.value,
                "actual_label_in_original": loc.actual_label_in_original,
                "surrounding_text": (loc.surrounding_text or "")[:400],
                "page": loc.page,
                "confidence": loc.confidence,
            })
        if misses:
            out.append({
                "event_id": f.event_id,
                "parser_misses": misses,
            })
    return out


def synthesize_proposal(insurance_type: str, current_skill_md: str, findings: list[Finding]) -> Optional[Proposal]:
    """Run the synthesizer call. Returns None if there's nothing to propose
    (e.g. all findings had only advisor_additions, no parser_misses)."""
    summaries = _findings_summary(findings)
    if not summaries:
        return None

    client = _get_client()
    system_prompt = (PROMPTS_DIR / "synthesizer.md").read_text(encoding="utf-8")
    user_text = (
        f"insurance_type: {insurance_type}\n\n"
        f"## Current SKILL.md\n```\n{current_skill_md}\n```\n\n"
        f"## Findings ({len(summaries)} events with parser misses)\n"
        f"```json\n{json.dumps(summaries, indent=2)}\n```\n\n"
        "Return your proposal in the structured format specified."
    )

    last_exc: Optional[Exception] = None
    for attempt in range(_RETRIES):
        try:
            resp = client.chat.completions.create(
                model=SYNTHESIZER_MODEL,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_text},
                ],
                response_format={"type": "json_schema", "json_schema": PROPOSAL_SCHEMA},
                max_completion_tokens=_MAX_OUTPUT_TOKENS,
            )
            choice = resp.choices[0]
            # GPT-5 may refuse via the `refusal` field instead of returning content.
            if getattr(choice.message, "refusal", None):
                raise RuntimeError(f"Model refused: {choice.message.refusal}")
            content = (choice.message.content or "").strip()
            if not content:
                raise RuntimeError("Empty response from synthesizer")
            data = json.loads(content)
            proposed = (data.get("proposed_skill_md") or "").strip()
            if not proposed:
                raise RuntimeError("Synthesizer returned empty proposed_skill_md")
            return Proposal(
                insurance_type=insurance_type,
                rationale=data.get("rationale", ""),
                proposed_skill_md=proposed,
                supporting_event_ids=[s["event_id"] for s in summaries],
            )
        except Exception as exc:
            last_exc = exc
            if attempt + 1 < _RETRIES:
                time.sleep(_RETRY_BACKOFF_SEC * (attempt + 1))
                continue
            raise
    if last_exc:
        raise last_exc
    return None
