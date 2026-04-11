"""
Lightweight event tracking endpoint.
Called by the frontend after each quote workflow.
Requires a valid Clerk JWT (any authenticated user).
"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from auth import get_current_user
from database import log_event

router = APIRouter(tags=["tracking"])


class TrackEventRequest(BaseModel):
    user_name: str
    insurance_type: str
    advisor: str = ""
    uploaded_pdf: str = ""
    manually_changed_fields: str = ""  # comma-separated field names
    created_quote: bool = False
    generated_pdf: str = ""
    client_name: str = ""


@router.post("/api/track-event")
async def track_event(
    payload: TrackEventRequest,
    user: dict = Depends(get_current_user),
):
    """Log an analytics event for the current authenticated user."""
    await log_event(
        user_name=payload.user_name,
        insurance_type=payload.insurance_type,
        advisor=payload.advisor,
        uploaded_pdf=payload.uploaded_pdf,
        manually_changed_fields=payload.manually_changed_fields,
        created_quote=payload.created_quote,
        generated_pdf=payload.generated_pdf,
        client_name=payload.client_name,
    )
    return {"status": "ok"}
