"""Async Postgres layer for skill_updater.

Self-contained — does NOT import anything from backend/. Reads DATABASE_URL
from .env (or environment). Manages its own asyncpg pool.
"""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import Any, Optional
from uuid import UUID, uuid4

import asyncpg
from dotenv import dotenv_values

from models import EventRow, Finding, ProposalRow

# ── Connection ────────────────────────────────────────────────────────
# The pool's connections are bound to the asyncio loop that created them.
# Streamlit calls ``asyncio.run()`` per interaction, which creates a new
# loop each time — so we track the loop the pool was built on and
# transparently recreate it if the loop has changed.

_POOL: Optional[asyncpg.Pool] = None
_POOL_LOOP_ID: Optional[int] = None


def _load_database_url() -> str:
    """Pull DATABASE_URL from .env file in this folder, or the environment.

    Falls back to ../backend/.env so a single .env can serve both folders."""
    here = Path(__file__).resolve().parent
    for env_path in (here / ".env", here.parent / "backend" / ".env"):
        if env_path.exists():
            vals = dotenv_values(env_path)
            url = vals.get("DATABASE_URL") or os.environ.get("DATABASE_URL")
            if url:
                return url
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError(
            "DATABASE_URL not found. Add it to skill_updater/.env or "
            "copy backend/.env into this folder."
        )
    return url


async def _setup_connection(conn: asyncpg.Connection) -> None:
    """Register codecs on every new pool connection. Without this, JSONB
    columns come back as raw strings and INSERTs reject Python dicts."""
    await conn.set_type_codec(
        "jsonb",
        encoder=json.dumps,
        decoder=json.loads,
        schema="pg_catalog",
    )


async def get_pool() -> asyncpg.Pool:
    """Return a pool bound to the currently running event loop.

    If the loop has changed since the last call (Streamlit creates a fresh
    one per `asyncio.run`), drop and rebuild — the old pool's connections
    are useless attached to a closed loop."""
    global _POOL, _POOL_LOOP_ID
    current_loop_id = id(asyncio.get_running_loop())
    if _POOL is not None and _POOL_LOOP_ID != current_loop_id:
        # Loop changed. Don't await the old pool's close — its loop is gone.
        # We just abandon it; Python's GC will clean up the references and
        # asyncpg's connections will time out server-side.
        _POOL = None
        _POOL_LOOP_ID = None
    if _POOL is None:
        _POOL = await asyncpg.create_pool(
            _load_database_url(),
            min_size=1,
            max_size=4,
            command_timeout=30,
            init=_setup_connection,
        )
        _POOL_LOOP_ID = current_loop_id
    return _POOL


async def close_pool() -> None:
    global _POOL, _POOL_LOOP_ID
    if _POOL is not None:
        try:
            await _POOL.close()
        except Exception:
            pass
        _POOL = None
        _POOL_LOOP_ID = None


# ── Schema setup ──────────────────────────────────────────────────────


async def init_schema() -> None:
    """Apply every file in ``migrations/*.sql`` in lexical order.

    Each migration is idempotent (``CREATE … IF NOT EXISTS`` /
    ``ADD COLUMN IF NOT EXISTS``) so re-running is safe — the
    Initialize button in the UI is wired to this function and can be
    pressed any time without breaking existing state.
    """
    pool = await get_pool()
    migrations_dir = Path(__file__).resolve().parent / "migrations"
    files = sorted(migrations_dir.glob("*.sql"))
    if not files:
        return
    async with pool.acquire() as conn:
        for sql_path in files:
            sql = sql_path.read_text()
            await conn.execute(sql)


# ── Read: events to analyze ───────────────────────────────────────────


def _system_design_predicate(system_design: Optional[str], param_index: int) -> tuple[str, list[Any]]:
    """Build the ``WHERE`` fragment for the design filter.

    - ``system_design = 'fitz-fastpath-2026-04-30'`` (Design 3) returns
      rows tagged with exactly that value.
    - ``system_design = ''`` (Design 2 / pre-migration) returns rows
      with no tag — the orchestration in place when those events were
      captured was the legacy vision parser.
    - ``None`` returns no filter, matching every row.
    """
    if system_design is None:
        return "", []
    return f"COALESCE(e.system_design, '') = ${param_index}", [system_design]


async def list_unanalyzed_events(
    insurance_types: Optional[list[str]] = None,
    limit: int = 200,
    system_design: Optional[str] = None,
) -> list[EventRow]:
    """Return analytics_events rows that:
       - have manually_changed_fields set
       - resulted in a created quote
       - are NOT yet in skill_event_analysis (the cursor)
       - optionally filtered by insurance_type
       - optionally filtered by parser orchestration version
         (``system_design`` — pass ``''`` for Design 2 / pre-migration
         rows, the Design-3 tag for fitz events, or ``None`` for any).

    Ordered oldest-first so processing is reproducible."""
    pool = await get_pool()
    where = ["e.manually_changed_fields <> ''", "e.created_quote = TRUE"]
    params: list[Any] = []
    if insurance_types:
        where.append(f"e.insurance_type = ANY(${len(params) + 1})")
        params.append(insurance_types)
    sd_pred, sd_params = _system_design_predicate(system_design, len(params) + 1)
    if sd_pred:
        where.append(sd_pred)
        params.extend(sd_params)
    where_sql = " AND ".join(where)
    params.append(limit)
    query = f"""
        SELECT e.id, e.created_at, e.insurance_type, e.manually_changed_fields,
               e.uploaded_pdf, e.generated_pdf, e.client_name, e.skill_version,
               COALESCE(e.system_design, '') AS system_design
        FROM analytics_events e
        LEFT JOIN skill_event_analysis sea ON sea.event_id = e.id
        WHERE {where_sql}
          AND sea.event_id IS NULL
        ORDER BY e.created_at ASC
        LIMIT ${len(params)}
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(query, *params)
    return [EventRow(**dict(r)) for r in rows]


async def count_unanalyzed_events(
    insurance_types: Optional[list[str]] = None,
    system_design: Optional[str] = None,
) -> int:
    """Count unanalyzed events. Same design filter as :func:`list_unanalyzed_events`."""
    pool = await get_pool()
    where = ["e.manually_changed_fields <> ''", "e.created_quote = TRUE"]
    params: list[Any] = []
    if insurance_types:
        where.append(f"e.insurance_type = ANY(${len(params) + 1})")
        params.append(insurance_types)
    sd_pred, sd_params = _system_design_predicate(system_design, len(params) + 1)
    if sd_pred:
        where.append(sd_pred)
        params.extend(sd_params)
    where_sql = " AND ".join(where)
    query = f"""
        SELECT COUNT(*) FROM analytics_events e
        LEFT JOIN skill_event_analysis sea ON sea.event_id = e.id
        WHERE {where_sql} AND sea.event_id IS NULL
    """
    async with pool.acquire() as conn:
        return await conn.fetchval(query, *params)


# ── Read: PDFs by filename ────────────────────────────────────────────


async def fetch_pdf_bytes(file_name: str) -> Optional[bytes]:
    """analytics_events.uploaded_pdf / generated_pdf are filename strings.
    Look them up in pdf_documents.file_name and return file_data."""
    if not file_name:
        return None
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT file_data FROM pdf_documents WHERE file_name = $1 ORDER BY created_at DESC LIMIT 1",
            file_name,
        )
    return row["file_data"] if row else None


async def fetch_event_pdfs(event: EventRow) -> dict[str, Optional[bytes]]:
    """Resolve the uploaded + generated PDF bytes for an event.

    `uploaded_pdf` may be comma-separated (e.g. bundle has two uploads). We
    fetch the first one that resolves; if you want all of them, tweak this.
    Returns dict {original: bytes|None, generated: bytes|None}."""
    uploaded_names = [s.strip() for s in event.uploaded_pdf.split(",") if s.strip()]
    original_bytes: Optional[bytes] = None
    for name in uploaded_names:
        original_bytes = await fetch_pdf_bytes(name)
        if original_bytes:
            break
    generated_bytes = await fetch_pdf_bytes(event.generated_pdf) if event.generated_pdf else None
    return {"original": original_bytes, "generated": generated_bytes}


# ── Write: runs + analyses ────────────────────────────────────────────


async def create_run() -> UUID:
    pool = await get_pool()
    run_id = uuid4()
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO skill_runs (id) VALUES ($1)", run_id,
        )
    return run_id


async def finalize_run(run_id: UUID, events_processed: int, events_skipped: int, status: str = "completed") -> None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """UPDATE skill_runs
               SET finished_at = NOW(),
                   events_processed = $1,
                   events_skipped = $2,
                   status = $3
               WHERE id = $4""",
            events_processed, events_skipped, status, run_id,
        )


async def record_analysis(
    run_id: UUID,
    event_id: int,
    insurance_type: str,
    outcome: str,
    finding: Optional[Finding] = None,
    error_message: Optional[str] = None,
) -> None:
    """Mark an event as analyzed (the cursor write)."""
    pool = await get_pool()
    finding_json = finding.model_dump() if finding else None
    async with pool.acquire() as conn:
        await conn.execute(
            """INSERT INTO skill_event_analysis
                   (event_id, run_id, insurance_type, outcome, finding, error_message)
               VALUES ($1, $2, $3, $4, $5, $6)
               ON CONFLICT (event_id) DO UPDATE
                   SET run_id = EXCLUDED.run_id,
                       outcome = EXCLUDED.outcome,
                       finding = EXCLUDED.finding,
                       error_message = EXCLUDED.error_message,
                       analyzed_at = NOW()""",
            event_id, run_id, insurance_type, outcome, finding_json, error_message,
        )


async def list_findings_for_run(run_id: UUID, insurance_type: str) -> list[Finding]:
    """Pull all successful analyses for a given (run, insurance_type) — input to the synthesizer."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT finding FROM skill_event_analysis
               WHERE run_id = $1 AND insurance_type = $2 AND outcome = 'analyzed'
                     AND finding IS NOT NULL""",
            run_id, insurance_type,
        )
    return [Finding(**r["finding"]) for r in rows]


async def insurance_types_in_run(run_id: UUID) -> list[str]:
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT DISTINCT insurance_type FROM skill_event_analysis
               WHERE run_id = $1 AND outcome = 'analyzed'""",
            run_id,
        )
    return [r["insurance_type"] for r in rows]


# ── Write: proposals ──────────────────────────────────────────────────


async def save_proposal(
    run_id: UUID,
    insurance_type: str,
    supporting_event_ids: list[int],
    current_skill_md: str,
    proposed_skill_md: str,
    rationale: str,
) -> int:
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """INSERT INTO skill_proposals
                   (run_id, insurance_type, supporting_event_ids,
                    current_skill_md, proposed_skill_md, rationale)
               VALUES ($1, $2, $3, $4, $5, $6)
               RETURNING id""",
            run_id, insurance_type, supporting_event_ids,
            current_skill_md, proposed_skill_md, rationale,
        )
    return row["id"]


async def list_proposals(status: Optional[str] = None) -> list[ProposalRow]:
    pool = await get_pool()
    if status:
        query = "SELECT * FROM skill_proposals WHERE status = $1 ORDER BY created_at DESC"
        async with pool.acquire() as conn:
            rows = await conn.fetch(query, status)
    else:
        async with pool.acquire() as conn:
            rows = await conn.fetch("SELECT * FROM skill_proposals ORDER BY created_at DESC")
    return [ProposalRow(**dict(r)) for r in rows]


async def get_proposal(proposal_id: int) -> Optional[ProposalRow]:
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM skill_proposals WHERE id = $1", proposal_id)
    return ProposalRow(**dict(row)) if row else None


async def update_proposal_status(proposal_id: int, status: str, proposed_skill_md: Optional[str] = None) -> None:
    """Mark approved/declined/modified. If proposed_skill_md is given (modified flow), update it."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        if proposed_skill_md is not None:
            await conn.execute(
                """UPDATE skill_proposals
                   SET status = $1, proposed_skill_md = $2, decided_at = NOW()
                   WHERE id = $3""",
                status, proposed_skill_md, proposal_id,
            )
        else:
            await conn.execute(
                """UPDATE skill_proposals SET status = $1, decided_at = NOW() WHERE id = $2""",
                status, proposal_id,
            )


async def mark_proposal_applied(proposal_id: int) -> None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE skill_proposals SET applied_at = NOW() WHERE id = $1",
            proposal_id,
        )


# ── Write: history snapshots ──────────────────────────────────────────


async def snapshot_skill(insurance_type: str, skill_md: str, reason: str, proposal_id: Optional[int] = None) -> int:
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """INSERT INTO skill_history (insurance_type, skill_md, reason, proposal_id)
               VALUES ($1, $2, $3, $4) RETURNING id""",
            insurance_type, skill_md, reason, proposal_id,
        )
    return row["id"]


async def list_history(insurance_type: Optional[str] = None, limit: int = 50) -> list[dict]:
    pool = await get_pool()
    if insurance_type:
        query = "SELECT * FROM skill_history WHERE insurance_type = $1 ORDER BY captured_at DESC LIMIT $2"
        async with pool.acquire() as conn:
            rows = await conn.fetch(query, insurance_type, limit)
    else:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT * FROM skill_history ORDER BY captured_at DESC LIMIT $1", limit,
            )
    return [dict(r) for r in rows]
