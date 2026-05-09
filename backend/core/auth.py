"""
Clerk JWT verification middleware for FastAPI.
Verifies tokens from Clerk using JWKS (JSON Web Key Set).

Works for both Clerk development (``pk_test_...`` / ``sk_test_...``)
and production (``pk_live_...`` / ``sk_live_...``) instances. Switching
between them is purely an env-var change — no code change needed:

  CLERK_PUBLISHABLE_KEY   determines the Frontend API domain (and thus
                          the JWT issuer + JWKS URL we trust)
  CLERK_SECRET_KEY        used by clerk_users_api / chat_api / reports
                          to call the Clerk Backend API at
                          api.clerk.com (same URL for dev + prod)

The frontend's ``VITE_CLERK_PUBLISHABLE_KEY`` must match the backend's
``CLERK_PUBLISHABLE_KEY`` so the JWT's ``iss`` claim matches what the
backend expects. Mismatches reject every authenticated request with a
401 ("Token issuer does not match this app").
"""

import asyncio
import base64
import os
import re
import time
from typing import Optional

import httpx
import jwt as pyjwt
from dotenv import load_dotenv
from fastapi import HTTPException, Request, status

load_dotenv()

# Clerk publishable keys look like ``pk_test_<base64>`` or ``pk_live_<base64>``.
# We anchor on the prefix so a future format change (e.g. ``pk_live_v2_xxx``)
# raises a parse miss instead of silently grabbing the wrong segment.
_PUBLISHABLE_KEY_RE = re.compile(r"^pk_(test|live)_([A-Za-z0-9_=\-+/]+)$")

# Cache for JWKS keys. Guarded by _jwks_lock so a cold-cache burst can't
# spawn N parallel fetches against Clerk during an outage.
_jwks_cache: dict = {}
_jwks_fetched_at: float = 0
_JWKS_CACHE_TTL = 3600  # 1 hour
_JWKS_FETCH_TIMEOUT = 5.0  # hard ceiling on a single Clerk call
_jwks_lock = asyncio.Lock()

# Origins allowed to issue Clerk tokens for this backend. Mirrors the CORS
# allowlist in main.py — keep them in sync. Verified against the JWT's
# `azp` (authorized party) claim.
_ALLOWED_AZP_ORIGINS = {
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:8080",
    "http://127.0.0.1:8080",
    "https://the-sizemore-snapshot.vercel.app",
    "https://sizemoresnapshot.ai",
    "https://www.sizemoresnapshot.ai",
}

# When True, JWTs missing `azp` (older Clerk session formats) are still
# accepted as long as `iss` matches our Clerk frontend API. Set to False
# to require `azp` once you've confirmed every client emits it.
_ALLOW_MISSING_AZP = True


def _decode_frontend_api(publishable_key: str) -> tuple[str, str]:
    """Extract the Frontend API domain + environment tag from a Clerk key.

    Returns ``(frontend_api, env)`` where ``env`` is ``"test"`` (dev) or
    ``"live"`` (prod). Both tuple slots are ``""`` if the key is missing
    or in an unrecognized format.

    Examples (illustrative, not real keys):
      ``pk_test_Y2xlcmsuZXhhbXBsZS5haSQ`` →
          ("clerk.example.ai", "test")
      ``pk_live_Y2xlcmsuc2l6ZW1vcmVzbmFwc2hvdC5haSQ`` →
          ("clerk.sizemoresnapshot.ai", "live")
    """
    if not publishable_key:
        return "", ""
    match = _PUBLISHABLE_KEY_RE.match(publishable_key)
    if not match:
        return "", ""

    env = match.group(1)
    encoded = match.group(2)
    # Pad to a multiple of 4 — Clerk's keys use unpadded base64.
    padding = (-len(encoded)) % 4
    if padding:
        encoded += "=" * padding
    try:
        # Try standard base64 first, then URL-safe as a fallback so
        # future variants with `-` / `_` in the domain segment still parse.
        try:
            raw = base64.b64decode(encoded)
        except Exception:
            raw = base64.urlsafe_b64decode(encoded)
        # Clerk encodes the domain with a trailing "$" sentinel.
        return raw.decode("utf-8").rstrip("$"), env
    except Exception:
        return "", env


# Memoized config — parsed once at first request and cached. The env
# vars don't change at runtime in either Railway or local dev, so
# re-decoding the publishable key every request is wasteful. Bypass with
# `_get_clerk_config(_force=True)` if you ever need to refresh (e.g. tests).
_clerk_config_cache: Optional[dict] = None


def _get_clerk_config(*, _force: bool = False) -> dict:
    """Get Clerk configuration from environment (memoized).

    Derives the Frontend API domain from ``CLERK_PUBLISHABLE_KEY`` so the
    same code path serves both dev (``pk_test_...``) and prod
    (``pk_live_...``) — switching is just an env-var update + restart.
    """
    global _clerk_config_cache
    if _clerk_config_cache is not None and not _force:
        return _clerk_config_cache

    secret_key = os.getenv("CLERK_SECRET_KEY", "")
    publishable_key = os.getenv("CLERK_PUBLISHABLE_KEY", "")
    frontend_api, env = _decode_frontend_api(publishable_key)

    cfg = {
        "secret_key": secret_key,
        "publishable_key": publishable_key,
        "env": env,  # "test" | "live" | ""
        "frontend_api": frontend_api,
        "issuer": f"https://{frontend_api}" if frontend_api else "",
        "jwks_url": f"https://{frontend_api}/.well-known/jwks.json" if frontend_api else "",
    }

    # One-line startup banner so deploys are easy to verify in Railway logs:
    #   [clerk] live mode  api=clerk.sizemoresnapshot.ai  iss=https://clerk.sizemoresnapshot.ai
    # Misconfiguration (missing or unparseable key) shows up as a loud
    # warning so you don't have to wait for an authenticated request
    # to discover the env is wrong.
    if env and frontend_api:
        print(
            f"[clerk] {env} mode  api={frontend_api}  iss={cfg['issuer']}",
            flush=True,
        )
    elif publishable_key:
        print(
            f"[clerk] WARN unable to parse CLERK_PUBLISHABLE_KEY "
            f"(prefix={publishable_key[:8]!r}) — auth WILL fail",
            flush=True,
        )
    else:
        print(
            "[clerk] WARN CLERK_PUBLISHABLE_KEY is unset — auth WILL fail",
            flush=True,
        )

    _clerk_config_cache = cfg
    return cfg


def _reset_clerk_config_cache() -> None:
    """Test hook — clear the memoized config so a re-read picks up env changes."""
    global _clerk_config_cache
    _clerk_config_cache = None


async def _fetch_jwks(jwks_url: str) -> dict:
    """Fetch JWKS from Clerk, with caching.

    Cache + fetch are guarded by an asyncio.Lock with a double-check so a
    cold-cache burst doesn't fan out N parallel Clerk calls. The outbound
    request has an explicit 5s timeout so a slow Clerk doesn't pin every
    authenticated request indefinitely.
    """
    global _jwks_cache, _jwks_fetched_at

    # Fast path — cache hit, no lock needed.
    if _jwks_cache and (time.time() - _jwks_fetched_at) < _JWKS_CACHE_TTL:
        return _jwks_cache

    async with _jwks_lock:
        # Re-check inside the lock — another coroutine may have just refilled it.
        if _jwks_cache and (time.time() - _jwks_fetched_at) < _JWKS_CACHE_TTL:
            return _jwks_cache

        async with httpx.AsyncClient(timeout=_JWKS_FETCH_TIMEOUT) as client:
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
            # Clerk tokens don't always set `aud` unless you configure a
            # custom session-token claim, so we don't require it here.
            # Instead we explicitly verify `iss` and `azp` below.
            options={"verify_aud": False},
        )
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

    # Issuer pin — must be OUR Clerk frontend API, not just any Clerk app.
    expected_iss = config.get("issuer", "")
    if expected_iss:
        token_iss = payload.get("iss", "")
        if token_iss != expected_iss:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token issuer does not match this app",
            )

    # Authorized-party pin — the page that requested the token must be one
    # of our known origins (mirrors the CORS allowlist).
    azp = payload.get("azp", "")
    if azp:
        if azp not in _ALLOWED_AZP_ORIGINS:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token authorized party not allowed",
            )
    elif not _ALLOW_MISSING_AZP:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing azp claim",
        )

    return payload


async def get_current_user(request: Request) -> dict:
    """
    Dependency that extracts and verifies the Clerk user.
    Returns dict with user_id, email, display_name, and metadata.
    """
    payload = await verify_clerk_token(request)

    # Build a best-effort display name. Clerk session tokens may include
    # `name`, `first_name`/`last_name`, or `email` — fall back through them
    # so callers always have something to write into analytics rows.
    name = (
        payload.get("name")
        or payload.get("full_name")
        or " ".join(
            x for x in (payload.get("first_name", ""), payload.get("last_name", "")) if x
        ).strip()
        or payload.get("email")
        or payload.get("primary_email")
        or ""
    )

    return {
        "user_id": payload.get("sub", ""),
        "email": payload.get("email", payload.get("primary_email", "")),
        "display_name": name,
        "metadata": payload.get("public_metadata", {}),
    }


def user_name_for_attribution(user: dict) -> str:
    """Return the best display name to write into analytics_events / pdf_documents.

    Used by endpoints (parse, generate) that need to attribute work to the
    authenticated user. Falls back through display_name → email → user_id
    so the field is never blank for an authenticated request.
    """
    return user.get("display_name") or user.get("email") or user.get("user_id") or ""


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
