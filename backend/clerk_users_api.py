"""
API endpoints for managing Clerk users and their roles.
Uses the Clerk Backend API to read/update user metadata.
"""

import os

import httpx
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import require_admin

load_dotenv()

router = APIRouter(prefix="/api/admin/users", tags=["clerk-users"])

CLERK_API_BASE = "https://api.clerk.com/v1"


def _clerk_headers() -> dict:
    secret = os.getenv("CLERK_SECRET_KEY", "")
    if not secret:
        raise HTTPException(status_code=500, detail="CLERK_SECRET_KEY not configured")
    return {"Authorization": f"Bearer {secret}", "Content-Type": "application/json"}


@router.get("")
async def list_clerk_users(
    _admin: dict = Depends(require_admin),
):
    """List all Clerk users with their roles."""
    headers = _clerk_headers()
    users = []
    offset = 0
    limit = 100

    async with httpx.AsyncClient() as client:
        while True:
            resp = await client.get(
                f"{CLERK_API_BASE}/users",
                headers=headers,
                params={"limit": limit, "offset": offset, "order_by": "-created_at"},
            )
            if resp.status_code != 200:
                raise HTTPException(status_code=resp.status_code, detail="Failed to fetch users from Clerk")
            data = resp.json()
            if not data:
                break
            for u in data:
                meta = u.get("public_metadata") or {}
                users.append({
                    "id": u["id"],
                    "first_name": u.get("first_name") or "",
                    "last_name": u.get("last_name") or "",
                    "email": (u.get("email_addresses") or [{}])[0].get("email_address", "") if u.get("email_addresses") else "",
                    "role": meta.get("role", "advisor"),
                    "image_url": u.get("image_url") or "",
                })
            if len(data) < limit:
                break
            offset += limit

    return {"users": users}


class UpdateRoleRequest(BaseModel):
    role: str  # "admin" or "advisor"


@router.patch("/{user_id}/role")
async def update_user_role(
    user_id: str,
    payload: UpdateRoleRequest,
    _admin: dict = Depends(require_admin),
):
    """Update a Clerk user's role in publicMetadata."""
    if payload.role not in ("admin", "advisor"):
        raise HTTPException(status_code=400, detail="Role must be 'admin' or 'advisor'")

    headers = _clerk_headers()

    async with httpx.AsyncClient() as client:
        # First get current public_metadata to merge
        get_resp = await client.get(f"{CLERK_API_BASE}/users/{user_id}", headers=headers)
        if get_resp.status_code != 200:
            raise HTTPException(status_code=404, detail="User not found in Clerk")

        current_meta = get_resp.json().get("public_metadata") or {}
        current_meta["role"] = payload.role

        # Update the user's public_metadata
        update_resp = await client.patch(
            f"{CLERK_API_BASE}/users/{user_id}",
            headers=headers,
            json={"public_metadata": current_meta},
        )
        if update_resp.status_code != 200:
            raise HTTPException(status_code=500, detail="Failed to update user role in Clerk")

    return {"status": "updated", "user_id": user_id, "role": payload.role}
