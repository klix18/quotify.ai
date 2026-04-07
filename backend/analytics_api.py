"""
Analytics API endpoints for the admin dashboard.
Provides usage stats with time period filtering and reset capability.
"""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query

from auth import require_admin
from database import get_pool

router = APIRouter(prefix="/api/admin/analytics", tags=["analytics"])


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
    _admin: dict = Depends(require_admin),
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

        # Usage by user (includes days active)
        user_rows = await conn.fetch("""
            SELECT
                user_name,
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE created_quote = TRUE) AS quotes_created,
                COUNT(*) FILTER (WHERE uploaded_pdf != '') AS pdfs_uploaded,
                COUNT(DISTINCT DATE(created_at AT TIME ZONE 'UTC')) AS days_active
            FROM analytics_events
            WHERE created_at >= $1
            GROUP BY user_name
            ORDER BY total DESC
        """, cutoff)

        # Insurance type by user
        user_type_rows = await conn.fetch("""
            SELECT
                user_name,
                insurance_type,
                COUNT(*) AS count
            FROM analytics_events
            WHERE created_at >= $1
            GROUP BY user_name, insurance_type
            ORDER BY user_name, count DESC
        """, cutoff)

        # Recent events (detailed log)
        recent_rows = await conn.fetch("""
            SELECT
                id, created_at, user_name, insurance_type, advisor,
                uploaded_pdf, manually_changed_fields, created_quote, generated_pdf
            FROM analytics_events
            WHERE created_at >= $1
            ORDER BY created_at DESC
            LIMIT 100
        """, cutoff)

    return {
        "period": period,
        "total_events": totals["total_events"],
        "total_quotes_created": totals["total_quotes_created"],
        "total_pdfs_uploaded": totals["total_pdfs_uploaded"],
        "usage_by_insurance_type": {row["insurance_type"]: row["count"] for row in type_rows},
        "usage_by_user": [
            {
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
            }
            for row in recent_rows
        ],
    }


@router.get("/manual-changes")
async def get_manual_changes_leaderboard(
    period: str = Query("month", regex="^(week|month|6months|year|all)$"),
    _admin: dict = Depends(require_admin),
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


@router.get("/user/{user_name}")
async def get_user_detail(
    user_name: str,
    period: str = Query("month", regex="^(week|month|6months|year|all)$"),
    _admin: dict = Depends(require_admin),
):
    """Get detailed analytics for a specific user."""
    pool = await get_pool()
    cutoff = _period_start(period)

    async with pool.acquire() as conn:
        totals = await conn.fetchrow("""
            SELECT
                COUNT(*) AS total_events,
                COUNT(*) FILTER (WHERE created_quote = TRUE) AS quotes_created,
                COUNT(*) FILTER (WHERE uploaded_pdf != '') AS pdfs_uploaded
            FROM analytics_events
            WHERE created_at >= $1 AND user_name = $2
        """, cutoff, user_name)

        type_rows = await conn.fetch("""
            SELECT insurance_type, COUNT(*) AS count
            FROM analytics_events
            WHERE created_at >= $1 AND user_name = $2
            GROUP BY insurance_type
            ORDER BY count DESC
        """, cutoff, user_name)

        recent_rows = await conn.fetch("""
            SELECT
                id, created_at, insurance_type, advisor,
                uploaded_pdf, manually_changed_fields, created_quote, generated_pdf
            FROM analytics_events
            WHERE created_at >= $1 AND user_name = $2
            ORDER BY created_at DESC
            LIMIT 50
        """, cutoff, user_name)

        # Distinct active days (one per calendar date)
        active_day_rows = await conn.fetch("""
            SELECT DISTINCT DATE(created_at AT TIME ZONE 'UTC') AS active_date
            FROM analytics_events
            WHERE created_at >= $1 AND user_name = $2
            ORDER BY active_date DESC
        """, cutoff, user_name)

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
            }
            for row in recent_rows
        ],
    }


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
