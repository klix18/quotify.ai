"""
API endpoints for app-level settings (auto-clear schedule, etc.).
"""

from fastapi import APIRouter, Depends

from core.auth import get_current_user, require_admin
from core.database import get_setting, set_setting

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
