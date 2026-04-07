"""
Clerk JWT verification middleware for FastAPI.
Verifies tokens from Clerk using JWKS (JSON Web Key Set).
"""

import os
import time
from typing import Optional

import httpx
import jwt as pyjwt
from dotenv import load_dotenv
from fastapi import Depends, HTTPException, Request, status

load_dotenv()

# Cache for JWKS keys
_jwks_cache: dict = {}
_jwks_fetched_at: float = 0
_JWKS_CACHE_TTL = 3600  # 1 hour


def _get_clerk_config():
    """Get Clerk configuration from environment."""
    secret_key = os.getenv("CLERK_SECRET_KEY", "")
    publishable_key = os.getenv("CLERK_PUBLISHABLE_KEY", "")

    # Extract the Clerk frontend API domain from the publishable key
    # pk_test_xxxx or pk_live_xxxx -> the base64 part decodes to the domain
    import base64
    try:
        encoded = publishable_key.split("_")[-1]
        # Add padding if needed
        padding = 4 - len(encoded) % 4
        if padding != 4:
            encoded += "=" * padding
        frontend_api = base64.b64decode(encoded).decode("utf-8").rstrip("$")
    except Exception:
        frontend_api = ""

    return {
        "secret_key": secret_key,
        "frontend_api": frontend_api,
        "jwks_url": f"https://{frontend_api}/.well-known/jwks.json" if frontend_api else "",
    }


async def _fetch_jwks(jwks_url: str) -> dict:
    """Fetch JWKS from Clerk, with caching."""
    global _jwks_cache, _jwks_fetched_at

    if _jwks_cache and (time.time() - _jwks_fetched_at) < _JWKS_CACHE_TTL:
        return _jwks_cache

    async with httpx.AsyncClient() as client:
        resp = await client.get(jwks_url)
        resp.raise_for_status()
        _jwks_cache = resp.json()
        _jwks_fetched_at = time.time()
        return _jwks_cache


async def _get_public_key(token: str, jwks_url: str):
    """Extract the public key matching the token's kid from JWKS."""
    jwks = await _fetch_jwks(jwks_url)

    # Get the kid from the token header
    unverified_header = pyjwt.get_unverified_header(token)
    kid = unverified_header.get("kid")

    for key_data in jwks.get("keys", []):
        if key_data.get("kid") == kid:
            return pyjwt.algorithms.RSAAlgorithm.from_jwk(key_data)

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Unable to find matching key in JWKS",
    )


async def verify_clerk_token(request: Request) -> dict:
    """
    Verify the Clerk JWT from the Authorization header.
    Returns the decoded token payload with user info.
    """
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid Authorization header",
        )

    token = auth_header.split("Bearer ", 1)[1]
    config = _get_clerk_config()

    if not config["jwks_url"]:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Clerk is not configured on the backend",
        )

    try:
        public_key = await _get_public_key(token, config["jwks_url"])
        payload = pyjwt.decode(
            token,
            public_key,
            algorithms=["RS256"],
            options={"verify_aud": False},
        )
        return payload
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired",
        )
    except pyjwt.InvalidTokenError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {str(e)}",
        )


async def get_current_user(request: Request) -> dict:
    """
    Dependency that extracts and verifies the Clerk user.
    Returns dict with user_id and email.
    """
    payload = await verify_clerk_token(request)
    return {
        "user_id": payload.get("sub", ""),
        "email": payload.get("email", payload.get("primary_email", "")),
        "metadata": payload.get("public_metadata", {}),
    }


async def get_optional_user(request: Request) -> Optional[dict]:
    """
    Dependency that optionally extracts user info.
    Returns None if no valid auth token is present (backward compatibility).
    """
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None
    try:
        return await get_current_user(request)
    except HTTPException:
        return None


async def require_admin(request: Request) -> dict:
    """
    Dependency that requires the user to have admin role.
    Checks Clerk publicMetadata.role === 'admin'.
    """
    user = await get_current_user(request)
    metadata = user.get("metadata", {})
    if metadata.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return user
