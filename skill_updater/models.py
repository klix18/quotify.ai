"""Pydantic models — the structured outputs that flow between LLM calls,
DB rows, and the UI. Keep these tight; the prompts return JSON shaped
exactly like these models."""

from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field


# ── Analyzer outputs ──────────────────────────────────────────────────


class GeneratedFieldRead(BaseModel):
    """One field as observed in the generated PDF."""
    code_name: str
    display_label: str = ""
    value: str = ""
    present: bool = False  # False if field is empty / not rendered


class OriginalFieldLocation(BaseModel):
    """Where (if anywhere) a value was found in the original PDF."""
    code_name: str
    value_searched: str
    found_in_original: bool
    actual_label_in_original: str = ""
    surrounding_text: str = ""
    page: int = 0
    confidence: Literal["low", "medium", "high"] = "low"


class Finding(BaseModel):
    """The full per-event analyzer output: one event's worth of insight.

    Stored as JSONB in skill_event_analysis.finding."""
    event_id: int
    insurance_type: str
    code_names_changed: list[str]
    generated_reads: list[GeneratedFieldRead]
    original_locations: list[OriginalFieldLocation]
    # Convenience: code_names where parser MISSED a value that exists in original
    parser_misses: list[str] = Field(default_factory=list)
    # Convenience: code_names where the value isn't in original (advisor added)
    advisor_additions: list[str] = Field(default_factory=list)


# ── Synthesizer output ────────────────────────────────────────────────


class Proposal(BaseModel):
    """A single proposed SKILL.md edit covering N events for one insurance type."""
    insurance_type: str
    rationale: str
    proposed_skill_md: str
    supporting_event_ids: list[int]


# ── DB row mirrors ────────────────────────────────────────────────────


class EventRow(BaseModel):
    """Subset of analytics_events we care about."""
    id: int
    created_at: datetime
    insurance_type: str
    manually_changed_fields: str
    uploaded_pdf: str
    generated_pdf: str
    client_name: str
    skill_version: str = ""

    @property
    def changed_code_names(self) -> list[str]:
        """Parse the comma-separated field list. Strips whitespace + empties."""
        return [s.strip() for s in self.manually_changed_fields.split(",") if s.strip()]


class ProposalRow(BaseModel):
    id: int
    run_id: UUID
    insurance_type: str
    supporting_event_ids: list[int]
    current_skill_md: str
    proposed_skill_md: str
    rationale: str
    status: Literal["pending", "approved", "declined", "modified"]
    created_at: datetime
    decided_at: Optional[datetime] = None
    applied_at: Optional[datetime] = None
