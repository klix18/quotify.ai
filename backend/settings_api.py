"""
API endpoints for app-level settings (auto-clear schedule, etc.)
and API usage tracking data.
"""

from fastapi import APIRouter, Depends, Query

from auth import get_current_user, require_admin
from database import get_setting, set_setting, get_api_usage

router = APIRouter(prefix="/api/admin/settings", tags=["settings"])


VALID_AUTO_CLEAR = {"never", "weekly", "monthly", "6months", "yearly"}


@router.get("/auto-clear")
async def get_auto_clear(
    _user: dict = Depends(get_current_user),
):
    """Return the current PDF auto-clear schedule."""
    value = await get_setting("pdf_auto_clear", "never")
    return {"value": value}


@router.put("/auto-clear")
async def set_auto_clear(
    payload: dict,
    _admin: dict = Depends(require_admin),
):
    """Set the PDF auto-clear schedule (admin only)."""
    value = payload.get("value", "never")
    if value not in VALID_AUTO_CLEAR:
        value = "never"
    await set_setting("pdf_auto_clear", value)
    return {"status": "ok", "value": value}


# ── API Usage ────────────────────────────────────────────────────────

usage_router = APIRouter(prefix="/api/admin/api-usage", tags=["api-usage"])


@usage_router.get("")
async def get_usage(
    period: str = Query("month"),
    _user: dict = Depends(get_current_user),
):
    """Return daily API usage data grouped by provider for charting."""
    rows = await get_api_usage(period)
    # Serialize dates
    for r in rows:
        if r.get("date"):
            r["date"] = r["date"].isoformat()
    return {"usage": rows}
