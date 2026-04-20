"""
Developer-only parse/accuracy metrics API.

Two endpoints:
  POST /api/dev-metrics/log   — OPEN (no auth). Accepts a single event from
                                 the live frontend whenever a parse starts/
                                 ends, or whenever a quote is generated.
                                 Must stay open so unauthenticated testers
                                 on the production Vercel site can contribute
                                 latency/accuracy data without needing the
                                 dev-only API key.
  GET  /api/dev-metrics/data  — GATED by the X-Dev-Metrics-Key header, which
                                 must match the DEV_METRICS_API_KEY env var
                                 set on Railway. Returns newest-first rows
                                 for the standalone viewer (dev_metrics/
                                 viewer.html) to render.

The `parse_metrics` table is created by database.init_db(); see that file for
the full column definition.

Why a shared API key instead of Clerk JWT for GET?
  The viewer is a standalone HTML file (dev_metrics/viewer.html) that runs
  locally on the developer's machine — there is no Clerk session to pull a
  JWT from. A shared secret header is the simplest way to gate the read
  endpoint while letting the viewer fetch from the live Railway instance.
"""

from __future__ import annotations

import json
import os
from typing import Any, Optional

from fastapi import APIRouter, Header, HTTPException, status
from pydantic import BaseModel, Field

from database import get_pool

router = APIRouter(tags=["dev-metrics"])


# ── Request/response models ──────────────────────────────────────────


class ManualChange(BaseModel):
    """Single field edit recorded during quote review."""

    field: str = ""
    value: str = ""


class DevMetricEvent(BaseModel):
    """
    One event in the parse_metrics table.

    Two shapes share this model:
      event="parse"  — fires when LLM parsing finishes. Carries latency_ms,
                       pdf_count, insurance_type, system_design.
      event="quote"  — fires when a quote PDF is generated (or when the user
                       starts a new parse without committing the previous
                       session, so we don't lose the edit counts). Carries
                       manual_changes_all_count, manual_changes_non_client_count,
                       and the manual_changes list (field -> current value).

    parse_id ties the two rows together so the viewer can join them back
    into a single session.
    """

    event: str
    parse_id: str
    insurance_type: str = ""
    pdf_count: int = 0
    latency_ms: int = 0
    manual_changes_all_count: int = 0
    manual_changes_non_client_count: int = 0
    manual_changes: list[ManualChange] = Field(default_factory=list)
    system_design: str = ""


# ── POST /api/dev-metrics/log (open) ─────────────────────────────────


@router.post("/api/dev-metrics/log")
async def log_dev_metric(payload: DevMetricEvent):
    """Insert a single parse/quote metric row. No auth — intentional."""
    # Validate the event shape at the edge so a malformed payload from a stale
    # frontend doesn't poison the table with garbage rows that the viewer then
    # has to filter around.
    if payload.event not in ("parse", "quote"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"event must be 'parse' or 'quote', got {payload.event!r}",
        )
    if not payload.parse_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="parse_id is required",
        )

    manual_changes_json = json.dumps(
        [mc.model_dump() for mc in payload.manual_changes]
    )

    pool = await get_pool()
    async with pool.acquire() as conn:
        try:
            await conn.execute(
                """
                INSERT INTO parse_metrics
                    (event, parse_id, insurance_type, pdf_count, latency_ms,
                     manual_changes_all_count, manual_changes_non_client_count,
                     manual_changes, system_design)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
                """,
                payload.event,
                payload.parse_id,
                payload.insurance_type,
                payload.pdf_count,
                payload.latency_ms,
                payload.manual_changes_all_count,
                payload.manual_changes_non_client_count,
                manual_changes_json,
                payload.system_design,
            )
        except Exception as err:  # noqa: BLE001 — we want any DB error surfaced
            # Don't let dev-metrics failures break anything else downstream.
            # Return 500 with the error so the browser console shows what
            # happened, but the frontend wrapper also swallows this so the
            # parse UX is unaffected.
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"parse_metrics insert failed: {err}",
            )
    return {"status": "ok"}


# ── GET /api/dev-metrics/data (dev-only) ─────────────────────────────


def _check_dev_key(provided: Optional[str]) -> None:
    """Validate the X-Dev-Metrics-Key header against the env var."""
    expected = os.getenv("DEV_METRICS_API_KEY", "").strip()
    if not expected:
        # If the env var isn't set at all, fail closed. Better to surface a
        # configuration error than quietly expose every parse row.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="DEV_METRICS_API_KEY is not configured on the server",
        )
    if not provided or provided.strip() != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid or missing X-Dev-Metrics-Key header",
        )


@router.get("/api/dev-metrics/data")
async def get_dev_metrics(
    x_dev_metrics_key: Optional[str] = Header(None, alias="X-Dev-Metrics-Key"),
    limit: int = 5000,
):
    """Return newest-first parse_metrics rows for the viewer to render."""
    _check_dev_key(x_dev_metrics_key)

    # Cap limit to something sane so a misbehaving client can't ask for the
    # entire table at once.
    if limit <= 0 or limit > 20000:
        limit = 5000

    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, created_at, event, parse_id, insurance_type, pdf_count,
                   latency_ms, manual_changes_all_count,
                   manual_changes_non_client_count, manual_changes,
                   system_design
            FROM parse_metrics
            ORDER BY created_at DESC
            LIMIT $1
            """,
            limit,
        )

    out: list[dict[str, Any]] = []
    for r in rows:
        d = dict(r)
        # asyncpg returns UUID and datetime objects — serialize them so the
        # viewer (which reads JSON over fetch) doesn't have to care.
        d["parse_id"] = str(d["parse_id"])
        d["created_at"] = d["created_at"].isoformat()
        # JSONB column: asyncpg returns it as a string in some versions and
        # as a parsed list in others. Normalize to a Python list here.
        mc = d.get("manual_changes")
        if isinstance(mc, str):
            try:
                d["manual_changes"] = json.loads(mc)
            except json.JSONDecodeError:
                d["manual_changes"] = []
        elif mc is None:
            d["manual_changes"] = []
        out.append(d)

    return {"rows": out, "count": len(out)}
