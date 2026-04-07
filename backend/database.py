"""
PostgreSQL database connection and table setup for analytics tracking.
Uses asyncpg for async operations with FastAPI.
"""

import os

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
        """)


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
