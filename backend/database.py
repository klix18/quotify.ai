"""
PostgreSQL database connection and table setup for analytics tracking
and PDF document storage.
Uses asyncpg for async operations with FastAPI.
"""

import os
from typing import Optional
from uuid import uuid4

import asyncpg
from dotenv import load_dotenv

load_dotenv()

_pool: asyncpg.Pool | None = None


async def get_pool() -> asyncpg.Pool:
    """Return the global connection pool, creating it on first call."""
    global _pool
    if _pool is None:
        database_url = os.getenv("DATABASE_URL") or os.getenv("DATABASE_PUBLIC_URL")
        if not database_url:
            raise RuntimeError("DATABASE_URL or DATABASE_PUBLIC_URL is not set. Add a PostgreSQL database on Railway.")
        _pool = await asyncpg.create_pool(database_url, min_size=2, max_size=10)
    return _pool


async def close_pool():
    """Gracefully close the connection pool."""
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


async def init_db():
    """Create tables if they don't exist."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS analytics_events (
                id                      BIGSERIAL PRIMARY KEY,
                created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                user_id                 TEXT NOT NULL DEFAULT '',
                user_name               TEXT NOT NULL,
                insurance_type          TEXT NOT NULL,
                advisor                 TEXT NOT NULL DEFAULT '',
                uploaded_pdf            TEXT NOT NULL DEFAULT '',
                manually_changed_fields TEXT NOT NULL DEFAULT '',
                created_quote           BOOLEAN NOT NULL DEFAULT FALSE,
                generated_pdf           TEXT NOT NULL DEFAULT '',
                client_name             TEXT NOT NULL DEFAULT '',
                skill_version           TEXT NOT NULL DEFAULT ''
            );

            -- Ensure client_name, user_id, and skill_version exist on pre-existing databases
            ALTER TABLE analytics_events
                ADD COLUMN IF NOT EXISTS client_name TEXT NOT NULL DEFAULT '';
            ALTER TABLE analytics_events
                ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT '';
            ALTER TABLE analytics_events
                ADD COLUMN IF NOT EXISTS skill_version TEXT NOT NULL DEFAULT '';

            CREATE INDEX IF NOT EXISTS idx_events_created_at ON analytics_events (created_at);
            CREATE INDEX IF NOT EXISTS idx_events_user_name ON analytics_events (user_name);
            CREATE INDEX IF NOT EXISTS idx_events_user_id ON analytics_events (user_id);
            CREATE INDEX IF NOT EXISTS idx_events_insurance_type ON analytics_events (insurance_type);

            -- PDF document storage
            CREATE TABLE IF NOT EXISTS pdf_documents (
                id              UUID PRIMARY KEY,
                created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                user_id         TEXT NOT NULL DEFAULT '',
                user_name       TEXT NOT NULL DEFAULT '',
                insurance_type  TEXT NOT NULL,
                doc_type        TEXT NOT NULL,
                client_name     TEXT NOT NULL DEFAULT '',
                file_name       TEXT NOT NULL,
                file_size       INTEGER NOT NULL DEFAULT 0,
                file_data       BYTEA NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_pdf_created_at ON pdf_documents (created_at);
            CREATE INDEX IF NOT EXISTS idx_pdf_user_id ON pdf_documents (user_id);
            CREATE INDEX IF NOT EXISTS idx_pdf_insurance_type ON pdf_documents (insurance_type);
            CREATE INDEX IF NOT EXISTS idx_pdf_doc_type ON pdf_documents (doc_type);
        """)

        # Chat tables (separate execute to avoid multi-statement issues)
        # App settings (key-value store for auto-clear, etc.)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS app_settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL DEFAULT ''
            );
        """)

        # API usage log — tracks tokens & estimated cost per AI call
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS api_usage_log (
                id              BIGSERIAL PRIMARY KEY,
                created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                provider        TEXT NOT NULL,
                model           TEXT NOT NULL,
                input_tokens    INTEGER NOT NULL DEFAULT 0,
                output_tokens   INTEGER NOT NULL DEFAULT 0,
                estimated_cost  DOUBLE PRECISION NOT NULL DEFAULT 0,
                call_type       TEXT NOT NULL DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS idx_api_usage_created_at
                ON api_usage_log (created_at);
            CREATE INDEX IF NOT EXISTS idx_api_usage_provider
                ON api_usage_log (provider);
        """)

        await conn.execute("""
            CREATE TABLE IF NOT EXISTS chat_session_memories (
                id              TEXT PRIMARY KEY,
                user_id         TEXT NOT NULL,
                user_role       TEXT NOT NULL DEFAULT 'admin',
                started_at      TEXT NOT NULL DEFAULT '',
                ended_at        TEXT,
                summary         TEXT,
                key_topics      TEXT[] DEFAULT ARRAY[]::TEXT[],
                message_count   INTEGER DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_chat_session_memories_user
                ON chat_session_memories (user_id);
        """)

        await conn.execute("""
            CREATE TABLE IF NOT EXISTS chat_insight_memories (
                id              TEXT PRIMARY KEY,
                user_id         TEXT NOT NULL,
                memory_type     TEXT NOT NULL DEFAULT 'insight',
                content         TEXT NOT NULL,
                context         TEXT DEFAULT '',
                created_at      TIMESTAMPTZ DEFAULT NOW(),
                last_accessed   TIMESTAMPTZ DEFAULT NOW(),
                access_count    INTEGER DEFAULT 0,
                relevance_score FLOAT DEFAULT 1.0,
                is_active       BOOLEAN DEFAULT TRUE
            );
            CREATE INDEX IF NOT EXISTS idx_chat_insight_memories_user
                ON chat_insight_memories (user_id, is_active);
        """)


# ── PDF document storage ──────────────────────────────────────────


async def store_pdf(
    file_data: bytes,
    file_name: str,
    insurance_type: str,
    doc_type: str,
    user_id: str = "",
    user_name: str = "",
    client_name: str = "",
) -> str:
    """Store a PDF in the database. Returns the document UUID."""
    doc_id = str(uuid4())
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO pdf_documents
                (id, user_id, user_name, insurance_type, doc_type, client_name, file_name, file_size, file_data)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            """,
            doc_id,
            user_id,
            user_name,
            insurance_type,
            doc_type,
            client_name,
            file_name,
            len(file_data),
            file_data,
        )
    return doc_id


async def get_pdf(doc_id: str) -> Optional[dict]:
    """Retrieve a single PDF document by ID (including file bytes)."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT id, created_at, user_id, user_name, insurance_type,
                   doc_type, client_name, file_name, file_size, file_data
            FROM pdf_documents WHERE id = $1
            """,
            doc_id,
        )
    if row is None:
        return None
    return dict(row)


async def list_pdfs(
    user_id: str = "",
    insurance_type: str = "",
    doc_type: str = "",
    limit: int = 50,
    offset: int = 0,
) -> list[dict]:
    """List PDF metadata (no file_data) with optional filters."""
    pool = await get_pool()
    conditions = []
    params = []
    idx = 1

    if user_id:
        conditions.append(f"user_id = ${idx}")
        params.append(user_id)
        idx += 1
    if insurance_type:
        conditions.append(f"insurance_type = ${idx}")
        params.append(insurance_type)
        idx += 1
    if doc_type:
        conditions.append(f"doc_type = ${idx}")
        params.append(doc_type)
        idx += 1

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    params.append(limit)
    params.append(offset)

    query = f"""
        SELECT id, created_at, user_id, user_name, insurance_type,
               doc_type, client_name, file_name, file_size
        FROM pdf_documents
        {where}
        ORDER BY created_at DESC
        LIMIT ${idx} OFFSET ${idx + 1}
    """

    async with pool.acquire() as conn:
        rows = await conn.fetch(query, *params)
    return [dict(r) for r in rows]


async def delete_pdf(doc_id: str) -> bool:
    """Delete a PDF document. Returns True if a row was deleted."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        result = await conn.execute(
            "DELETE FROM pdf_documents WHERE id = $1", doc_id
        )
    return result == "DELETE 1"


# ── Analytics event logging ───────────────────────────────────────


async def log_event(
    user_name: str,
    insurance_type: str,
    user_id: str = "",
    advisor: str = "",
    uploaded_pdf: str = "",
    manually_changed_fields: str = "",
    created_quote: bool = False,
    generated_pdf: str = "",
    client_name: str = "",
    skill_version: str = "",
):
    """Insert an analytics event row."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO analytics_events
                (user_id, user_name, insurance_type, advisor, uploaded_pdf,
                 manually_changed_fields, created_quote, generated_pdf,
                 client_name, skill_version)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            """,
            user_id,
            user_name,
            insurance_type,
            advisor,
            uploaded_pdf,
            manually_changed_fields,
            created_quote,
            generated_pdf,
            client_name,
            skill_version,
        )


# ── App settings ────────────────────────────────────────────────────


async def get_setting(key: str, default: str = "") -> str:
    """Read a setting value by key."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT value FROM app_settings WHERE key = $1", key
        )
    return row["value"] if row else default


async def set_setting(key: str, value: str) -> None:
    """Upsert a setting value."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO app_settings (key, value) VALUES ($1, $2)
            ON CONFLICT (key) DO UPDATE SET value = $2
            """,
            key, value,
        )


# ── PDF bulk operations ─────────────────────────────────────────────


async def delete_all_pdfs() -> int:
    """Delete all PDF documents. Returns count of deleted rows."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        result = await conn.execute("DELETE FROM pdf_documents")
    # result looks like "DELETE 42"
    return int(result.split()[-1])


async def get_pdf_filenames() -> set[str]:
    """Return a set of all stored PDF file_name values (lightweight check)."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT file_name FROM pdf_documents")
    return {r["file_name"] for r in rows}


# ── API usage tracking ──────────────────────────────────────────────


async def log_api_usage(
    provider: str,
    model: str,
    input_tokens: int,
    output_tokens: int,
    estimated_cost: float,
    call_type: str = "",
) -> None:
    """Log a single AI API call with token counts and cost estimate."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO api_usage_log
                (provider, model, input_tokens, output_tokens, estimated_cost, call_type)
            VALUES ($1, $2, $3, $4, $5, $6)
            """,
            provider, model, input_tokens, output_tokens, estimated_cost, call_type,
        )


async def get_api_usage(period: str = "month") -> list[dict]:
    """Return daily API usage aggregated by provider for the given period."""
    cutoff_sql = {
        "week": "NOW() - INTERVAL '7 days'",
        "month": "NOW() - INTERVAL '30 days'",
        "6months": "NOW() - INTERVAL '180 days'",
        "year": "NOW() - INTERVAL '365 days'",
        "all": "'1970-01-01'::timestamptz",
    }.get(period, "NOW() - INTERVAL '30 days'")

    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(f"""
            SELECT
                DATE(created_at) AS date,
                provider,
                SUM(input_tokens)   AS input_tokens,
                SUM(output_tokens)  AS output_tokens,
                SUM(estimated_cost) AS cost
            FROM api_usage_log
            WHERE created_at >= {cutoff_sql}
            GROUP BY DATE(created_at), provider
            ORDER BY date ASC
        """)
    return [dict(r) for r in rows]
