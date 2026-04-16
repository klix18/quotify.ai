"""
Analytics API endpoints for the admin dashboard.
Provides usage stats with time period filtering and reset capability.
"""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Body, Depends, Query
from pydantic import BaseModel

from auth import get_current_user, require_admin
from database import get_pool

router = APIRouter(prefix="/api/admin/analytics", tags=["analytics"])
self_router = APIRouter(prefix="/api/analytics", tags=["analytics-self"])


# ── Helpers ──────────────────────────────────────────────────────────

def _period_start(period: str) -> datetime:
    """Convert a period string to a UTC datetime cutoff."""
    now = datetime.now(timezone.utc)
    match period:
        case "week":
            return now - timedelta(weeks=1)
        case "month":
            return now - timedelta(days=30)
        case "6months":
            return now - timedelta(days=182)
        case "year":
            return now - timedelta(days=365)
        case "all":
            return datetime(2000, 1, 1, tzinfo=timezone.utc)
        case _:
            return now - timedelta(days=30)


# ── Endpoints ────────────────────────────────────────────────────────

@router.get("/summary")
async def get_analytics_summary(
    period: str = Query("month", regex="^(week|month|6months|year|all)$"),
    _user: dict = Depends(get_current_user),
):
    """Get aggregated analytics for the given time period."""
    pool = await get_pool()
    cutoff = _period_start(period)

    async with pool.acquire() as conn:
        # Total counts
        totals = await conn.fetchrow("""
            SELECT
                COUNT(*) AS total_events,
                COUNT(*) FILTER (WHERE created_quote = TRUE) AS total_quotes_created,
                COUNT(*) FILTER (WHERE uploaded_pdf != '') AS total_pdfs_uploaded
            FROM analytics_events
            WHERE created_at >= $1
        """, cutoff)

        # Usage by insurance type
        type_rows = await conn.fetch("""
            SELECT insurance_type, COUNT(*) AS count
            FROM analytics_events
            WHERE created_at >= $1
            GROUP BY insurance_type
            ORDER BY count DESC
        """, cutoff)

        # Usage by user (includes days active).
        # GROUP BY the stable user_id so renames don't split a user's history.
        # Use the most-recent user_name for display purposes.
        user_rows = await conn.fetch("""
            SELECT
                COALESCE(NULLIF(user_id, ''), user_name) AS user_key,
                (ARRAY_AGG(user_name ORDER BY created_at DESC))[1] AS user_name,
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE created_quote = TRUE) AS quotes_created,
                COUNT(*) FILTER (WHERE uploaded_pdf != '') AS pdfs_uploaded,
                COUNT(DISTINCT DATE(created_at AT TIME ZONE 'America/New_York')) AS days_active
            FROM analytics_events
            WHERE created_at >= $1
            GROUP BY COALESCE(NULLIF(user_id, ''), user_name)
            ORDER BY total DESC
        """, cutoff)

        # Insurance type by user
        user_type_rows = await conn.fetch("""
            SELECT
                COALESCE(NULLIF(user_id, ''), user_name) AS user_key,
                (ARRAY_AGG(user_name ORDER BY created_at DESC))[1] AS user_name,
                insurance_type,
                COUNT(*) AS count
            FROM analytics_events
            WHERE created_at >= $1
            GROUP BY COALESCE(NULLIF(user_id, ''), user_name), insurance_type
            ORDER BY user_key, count DESC
        """, cutoff)

        # Recent events (detailed log)
        recent_rows = await conn.fetch("""
            SELECT
                id, created_at, user_name, insurance_type, advisor,
                uploaded_pdf, manually_changed_fields, created_quote, generated_pdf,
                client_name
            FROM analytics_events
            WHERE created_at >= $1
            ORDER BY created_at DESC
            LIMIT 100
        """, cutoff)

        # Timeline — quotes per bucket, broken down by insurance type.
        # Bucket granularity depends on period.
        if period == "year":
            bucket_sql = "DATE_TRUNC('month', created_at AT TIME ZONE 'America/New_York')"
        elif period == "all":
            bucket_sql = "DATE_TRUNC('year', created_at AT TIME ZONE 'America/New_York')"
        elif period == "6months":
            bucket_sql = "DATE_TRUNC('week', created_at AT TIME ZONE 'America/New_York')"
        else:
            bucket_sql = "DATE_TRUNC('day', created_at AT TIME ZONE 'America/New_York')"
        timeline_rows = await conn.fetch(f"""
            SELECT
                {bucket_sql} AS bucket,
                insurance_type,
                COUNT(*) FILTER (WHERE created_quote = TRUE) AS quotes_created
            FROM analytics_events
            WHERE created_at >= $1
            GROUP BY bucket, insurance_type
            ORDER BY bucket ASC
        """, cutoff)

    return {
        "period": period,
        "total_events": totals["total_events"],
        "total_quotes_created": totals["total_quotes_created"],
        "total_pdfs_uploaded": totals["total_pdfs_uploaded"],
        "usage_by_insurance_type": {row["insurance_type"]: row["count"] for row in type_rows},
        "usage_by_user": [
            {
                "user_id": row["user_key"],
                "user_name": row["user_name"],
                "total": row["total"],
                "quotes_created": row["quotes_created"],
                "pdfs_uploaded": row["pdfs_uploaded"],
                "days_active": row["days_active"],
            }
            for row in user_rows
        ],
        "insurance_type_by_user": [
            {
                "user_id": row["user_key"],
                "user_name": row["user_name"],
                "insurance_type": row["insurance_type"],
                "count": row["count"],
            }
            for row in user_type_rows
        ],
        "recent_events": [
            {
                "id": row["id"],
                "created_at": row["created_at"].isoformat(),
                "user_name": row["user_name"],
                "insurance_type": row["insurance_type"],
                "advisor": row["advisor"],
                "uploaded_pdf": row["uploaded_pdf"],
                "manually_changed_fields": row["manually_changed_fields"],
                "created_quote": row["created_quote"],
                "generated_pdf": row["generated_pdf"],
                "client_name": row["client_name"] or "",
            }
            for row in recent_rows
        ],
        "timeline": [
            {
                "bucket": row["bucket"].isoformat() if row["bucket"] else None,
                "insurance_type": row["insurance_type"],
                "quotes_created": row["quotes_created"],
            }
            for row in timeline_rows
        ],
    }


@router.get("/manual-changes")
async def get_manual_changes_leaderboard(
    period: str = Query("month", regex="^(week|month|6months|year|all)$"),
    _user: dict = Depends(get_current_user),
):
    """Get leaderboard of manually changed fields across all events."""
    pool = await get_pool()
    cutoff = _period_start(period)

    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT manually_changed_fields, insurance_type
            FROM analytics_events
            WHERE created_at >= $1 AND manually_changed_fields != ''
        """, cutoff)

    # Parse comma-separated fields and count occurrences per (field, insurance_type)
    counts: dict[tuple[str, str], int] = {}
    for row in rows:
        ins_type = row["insurance_type"]
        for field in row["manually_changed_fields"].split(","):
            field = field.strip()
            if field:
                key = (field, ins_type)
                counts[key] = counts.get(key, 0) + 1

    leaderboard = sorted(
        [{"field": k[0], "insurance_type": k[1], "count": v} for k, v in counts.items()],
        key=lambda x: x["count"],
        reverse=True,
    )
    return {"leaderboard": leaderboard}


@router.get("/user/{user_id}")
async def get_user_detail(
    user_id: str,
    period: str = Query("month", regex="^(week|month|6months|year|all)$"),
    _user: dict = Depends(get_current_user),
):
    """Get detailed analytics for a specific user (matched by stable user_id, or by user_name for legacy rows)."""
    pool = await get_pool()
    cutoff = _period_start(period)

    # Match on user_id if populated, otherwise fall back to user_name (legacy rows
    # pre-dating the user_id column will have user_id = '').
    user_filter = "COALESCE(NULLIF(user_id, ''), user_name) = $2"

    async with pool.acquire() as conn:
        # Resolve display name (most recent)
        name_row = await conn.fetchrow(f"""
            SELECT user_name FROM analytics_events
            WHERE created_at >= $1 AND {user_filter}
            ORDER BY created_at DESC LIMIT 1
        """, cutoff, user_id)
        display_name = name_row["user_name"] if name_row else user_id

        totals = await conn.fetchrow(f"""
            SELECT
                COUNT(*) AS total_events,
                COUNT(*) FILTER (WHERE created_quote = TRUE) AS quotes_created,
                COUNT(*) FILTER (WHERE uploaded_pdf != '') AS pdfs_uploaded
            FROM analytics_events
            WHERE created_at >= $1 AND {user_filter}
        """, cutoff, user_id)

        type_rows = await conn.fetch(f"""
            SELECT insurance_type, COUNT(*) AS count
            FROM analytics_events
            WHERE created_at >= $1 AND {user_filter}
            GROUP BY insurance_type
            ORDER BY count DESC
        """, cutoff, user_id)

        recent_rows = await conn.fetch(f"""
            SELECT
                id, created_at, insurance_type, advisor,
                uploaded_pdf, manually_changed_fields, created_quote, generated_pdf,
                client_name
            FROM analytics_events
            WHERE created_at >= $1 AND {user_filter}
            ORDER BY created_at DESC
            LIMIT 50
        """, cutoff, user_id)

        # Distinct active days (one per calendar date)
        active_day_rows = await conn.fetch(f"""
            SELECT DISTINCT DATE(created_at AT TIME ZONE 'America/New_York') AS active_date
            FROM analytics_events
            WHERE created_at >= $1 AND {user_filter}
            ORDER BY active_date DESC
        """, cutoff, user_id)

        # Timeline — quotes per bucket, broken down by insurance type (user-scoped).
        if period == "year":
            bucket_sql = "DATE_TRUNC('month', created_at AT TIME ZONE 'America/New_York')"
        elif period == "all":
            bucket_sql = "DATE_TRUNC('year', created_at AT TIME ZONE 'America/New_York')"
        else:
            bucket_sql = "DATE_TRUNC('day', created_at AT TIME ZONE 'America/New_York')"
        timeline_rows = await conn.fetch(f"""
            SELECT
                {bucket_sql} AS bucket,
                insurance_type,
                COUNT(*) FILTER (WHERE created_quote = TRUE) AS quotes_created
            FROM analytics_events
            WHERE created_at >= $1 AND {user_filter}
            GROUP BY bucket, insurance_type
            ORDER BY bucket ASC
        """, cutoff, user_id)

    return {
        "user_id": user_id,
        "user_name": display_name,
        "period": period,
        "total_events": totals["total_events"],
        "quotes_created": totals["quotes_created"],
        "pdfs_uploaded": totals["pdfs_uploaded"],
        "days_active": len(active_day_rows),
        "active_dates": [row["active_date"].isoformat() for row in active_day_rows],
        "by_insurance_type": {row["insurance_type"]: row["count"] for row in type_rows},
        "recent_events": [
            {
                "id": row["id"],
                "created_at": row["created_at"].isoformat(),
                "insurance_type": row["insurance_type"],
                "advisor": row["advisor"],
                "uploaded_pdf": row["uploaded_pdf"],
                "manually_changed_fields": row["manually_changed_fields"],
                "created_quote": row["created_quote"],
                "generated_pdf": row["generated_pdf"],
                "client_name": row["client_name"] or "",
            }
            for row in recent_rows
        ],
        "timeline": [
            {
                "bucket": row["bucket"].isoformat() if row["bucket"] else None,
                "insurance_type": row["insurance_type"],
                "quotes_created": row["quotes_created"],
            }
            for row in timeline_rows
        ],
    }


class BackfillUserIdRequest(BaseModel):
    user_id: str
    user_names: list[str]


@router.post("/backfill-user-id")
async def backfill_user_id(
    payload: BackfillUserIdRequest,
    _admin: dict = Depends(require_admin),
):
    """
    Assign a stable user_id to all historical rows that match any of the given
    user_name aliases. Use this to consolidate a person whose name changed or
    who was logged under multiple identifiers (e.g. "J J" and "jj@example.com").
    """
    from fastapi import HTTPException
    user_id = (payload.user_id or "").strip()
    user_names = [n for n in payload.user_names if n and n.strip()]

    if not user_id:
        raise HTTPException(status_code=422, detail="user_id is required")
    if not user_names:
        raise HTTPException(status_code=422, detail="user_names list is required")

    pool = await get_pool()
    async with pool.acquire() as conn:
        result = await conn.execute(
            "UPDATE analytics_events SET user_id = $1 WHERE user_name = ANY($2::text[])",
            user_id, user_names,
        )

    updated = int(result.split()[-1])
    return {"status": "ok", "user_id": user_id, "aliases": user_names, "rows_updated": updated}


@router.delete("/event/{event_id}")
async def delete_single_event(
    event_id: int,
    _admin: dict = Depends(require_admin),
):
    """Delete a single analytics event by ID."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        result = await conn.execute(
            "DELETE FROM analytics_events WHERE id = $1", event_id
        )
    deleted = result == "DELETE 1"
    if not deleted:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Event not found")
    return {"status": "deleted", "id": event_id}


@router.delete("/reset")
async def reset_analytics(
    period: str = Query("all", regex="^(week|month|6months|year|all)$"),
    _admin: dict = Depends(require_admin),
):
    """Delete analytics events for the given period. Use with caution."""
    pool = await get_pool()
    cutoff = _period_start(period)

    async with pool.acquire() as conn:
        result = await conn.execute("""
            DELETE FROM analytics_events WHERE created_at >= $1
        """, cutoff)

    deleted_count = int(result.split(" ")[-1])
    return {"deleted": deleted_count, "period": period}


# ── Self-service endpoint (any authenticated user) ─────────────────

@self_router.get("/me")
async def get_my_stats(
    user_name: str = Query(..., description="Display name of the current user (used for legacy fallback only)"),
    period: str = Query("month", regex="^(week|month|6months|year|all)$"),
    user: dict = Depends(get_current_user),
):
    """Get analytics for the currently authenticated user (no admin required)."""
    pool = await get_pool()
    cutoff = _period_start(period)

    # Use the stable Clerk user_id from the JWT. Fall back to user_name for any
    # legacy rows written before the user_id column was added.
    user_key = user["user_id"] or user_name
    user_filter = "COALESCE(NULLIF(user_id, ''), user_name) = $2"

    async with pool.acquire() as conn:
        totals = await conn.fetchrow(f"""
            SELECT
                COUNT(*) AS total_events,
                COUNT(*) FILTER (WHERE created_quote = TRUE) AS quotes_created,
                COUNT(*) FILTER (WHERE uploaded_pdf != '') AS pdfs_uploaded
            FROM analytics_events
            WHERE created_at >= $1 AND {user_filter}
        """, cutoff, user_key)

        type_rows = await conn.fetch(f"""
            SELECT insurance_type, COUNT(*) AS count
            FROM analytics_events
            WHERE created_at >= $1 AND {user_filter}
            GROUP BY insurance_type
            ORDER BY count DESC
        """, cutoff, user_key)

        recent_rows = await conn.fetch(f"""
            SELECT
                id, created_at, insurance_type, advisor,
                uploaded_pdf, manually_changed_fields, created_quote, generated_pdf,
                client_name
            FROM analytics_events
            WHERE created_at >= $1 AND {user_filter}
            ORDER BY created_at DESC
            LIMIT 50
        """, cutoff, user_key)

        active_day_rows = await conn.fetch(f"""
            SELECT DISTINCT DATE(created_at AT TIME ZONE 'America/New_York') AS active_date
            FROM analytics_events
            WHERE created_at >= $1 AND {user_filter}
            ORDER BY active_date DESC
        """, cutoff, user_key)

    return {
        "user_name": user_name,
        "period": period,
        "total_events": totals["total_events"],
        "quotes_created": totals["quotes_created"],
        "pdfs_uploaded": totals["pdfs_uploaded"],
        "days_active": len(active_day_rows),
        "active_dates": [row["active_date"].isoformat() for row in active_day_rows],
        "by_insurance_type": {row["insurance_type"]: row["count"] for row in type_rows},
        "recent_events": [
            {
                "id": row["id"],
                "created_at": row["created_at"].isoformat(),
                "insurance_type": row["insurance_type"],
                "advisor": row["advisor"],
                "uploaded_pdf": row["uploaded_pdf"],
                "manually_changed_fields": row["manually_changed_fields"],
                "created_quote": row["created_quote"],
                "generated_pdf": row["generated_pdf"],
                "client_name": row["client_name"] or "",
            }
            for row in recent_rows
        ],
    }
