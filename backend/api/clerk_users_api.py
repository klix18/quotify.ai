"""
API endpoints for managing Clerk users and their roles.
Uses the Clerk Backend API to read/update user metadata.
"""

import os

import httpx
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core.auth import get_current_user, require_admin

load_dotenv()

# `router` keeps the historical /api/admin/users path. `directory_router` is a
# parallel, non-admin path (/api/users/directory) that the dashboard uses for
# the *read-only* user list. Both share the same handler. The split exists so
# advisors can reliably load the user-with-roles directory used to identify
# admins in the Team Leaderboard — any path-based "/api/admin/*" gating in the
# deploy chain (proxies, edge auth, future middleware) cannot accidentally
# strip role data for non-admins on this read path.
router = APIRouter(prefix="/api/admin/users", tags=["clerk-users"])
directory_router = APIRouter(prefix="/api/users", tags=["clerk-users-directory"])

CLERK_API_BASE = "https://api.clerk.com/v1"


def _clerk_headers() -> dict:
    secret = os.getenv("CLERK_SECRET_KEY", "")
    if not secret:
        raise HTTPException(status_code=500, detail="CLERK_SECRET_KEY not configured")
    return {"Authorization": f"Bearer {secret}", "Content-Type": "application/json"}


async def _fetch_clerk_users() -> list[dict]:
    """Page through Clerk and return a flat list of users with role info.

    Shared by the admin-pathed and directory-pathed routes so role data stays
    identical regardless of which endpoint the caller uses.
    """
    headers = _clerk_headers()
    users: list[dict] = []
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

    return users


@router.get("")
async def list_clerk_users(
    _user: dict = Depends(get_current_user),
):
    """List all Clerk users with their roles (admin-pathed)."""
    return {"users": await _fetch_clerk_users()}


@directory_router.get("/directory")
async def list_user_directory(
    _user: dict = Depends(get_current_user),
):
    """Read-only user directory with roles. Available to any authenticated user
    so non-admins can render an Admin badge next to admins in the dashboard."""
    return {"users": await _fetch_clerk_users()}


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
