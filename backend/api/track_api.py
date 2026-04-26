"""
Lightweight event tracking endpoint.
Called by the frontend after each quote workflow.
Requires a valid Clerk JWT (any authenticated user).
"""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from core.auth import get_current_user
from core.database import log_event

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
    skill_version: str = ""            # from parse result, e.g. "1.2"


@router.post("/api/track-event")
async def track_event(
    payload: TrackEventRequest,
    user: dict = Depends(get_current_user),
):
    """Log an analytics event for the current authenticated user."""
    # Always use the stable Clerk user_id from the verified JWT — never trust
    # the user_name from the request body for identity, since display names can
    # change and would otherwise fragment a user's history across multiple rows.
    #
    # Reject writes without a user_id. Historically the JWT always contains a
    # sub claim, but we want to fail LOUDLY rather than silently drop a row
    # into the user_id='' legacy bucket again — that bucket is exactly what
    # caused the Kevin Li fragmentation bug.
    user_id = user.get("user_id") or ""
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="JWT missing sub claim — cannot attribute event to a user",
        )

    await log_event(
        user_id=user_id,
        user_name=payload.user_name,
        insurance_type=payload.insurance_type,
        advisor=payload.advisor,
        uploaded_pdf=payload.uploaded_pdf,
        manually_changed_fields=payload.manually_changed_fields,
        created_quote=payload.created_quote,
        generated_pdf=payload.generated_pdf,
        client_name=payload.client_name,
        skill_version=payload.skill_version,
    )
    return {"status": "ok", "user_id": user_id}
