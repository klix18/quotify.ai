"""
PostgreSQL database connection and table setup for analytics tracking
and PDF document storage.
Uses asyncpg for async operations with FastAPI.
"""

import os
from datetime import datetime
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
        database_url = os.getenv("DATABASE_URL")
        if not database_url:
            raise RuntimeError("DATABASE_URL is not set. Add a PostgreSQL database on Railway.")
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
                user_name               TEXT NOT NULL,
                insurance_type          TEXT NOT NULL,
                advisor                 TEXT NOT NULL DEFAULT '',
                uploaded_pdf            TEXT NOT NULL DEFAULT '',
                manually_changed_fields TEXT NOT NULL DEFAULT '',
                created_quote           BOOLEAN NOT NULL DEFAULT FALSE,
                generated_pdf           TEXT NOT NULL DEFAULT ''
            );

            CREATE INDEX IF NOT EXISTS idx_events_created_at ON analytics_events (created_at);
            CREATE INDEX IF NOT EXISTS idx_events_user_name ON analytics_events (user_name);
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
    advisor: str = "",
    uploaded_pdf: str = "",
    manually_changed_fields: str = "",
    created_quote: bool = False,
    generated_pdf: str = "",
):
    """Insert an analytics event row."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO analytics_events
                (user_name, insurance_type, advisor, uploaded_pdf, manually_changed_fields, created_quote, generated_pdf)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            """,
            user_name,
            insurance_type,
            advisor,
            uploaded_pdf,
            manually_changed_fields,
            created_quote,
            generated_pdf,
        )
