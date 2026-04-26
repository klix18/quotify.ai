"""
Consolidates historical analytics_events and pdf_documents rows onto stable
Clerk user_ids. Legacy rows were written before the user_id column existed
(user_id defaults to ''), so a single person can appear split across a
user_id-keyed row and a user_name-keyed row in the leaderboard.

This module fetches the canonical Clerk user list, builds every plausible
alias (full name, first, last, email, email-local-part — matching the
frontend's trackEvent user_name derivation in QuotifyHome.jsx), and bulk
UPDATEs any row whose user_id is blank AND whose user_name matches.

Runs automatically on backend startup (via main.py lifespan) and is also
exposed as an admin endpoint for manual re-runs.

Design rules (per product requirement):
  - Clerk user_id is the ONE stable identifier. user_name is display-only.
  - analytics_events is the ONE source of truth. pdf_documents mirrors it
    for attribution, but analytics questions (counts, leaderboards) derive
    from analytics_events.
  - Aliases here MUST mirror the alias set used by AdminDashboard.jsx's
    clerkUsers lookup map so that frontend and backend agree on who is who.
"""

from __future__ import annotations

import os
from typing import Any

import httpx


CLERK_API_BASE = "https://api.clerk.com/v1"


def _alias_candidates(clerk_user: dict[str, Any]) -> list[str]:
    """Every user_name value analytics_events might contain for this person.

    Mirror of the lookup keys built in AdminDashboard.jsx (fetchAnalytics) so
    the backfill matches whatever the frontend recorded at the time:
        fullName, first, last, email, email-local-part
    plus the exact display name derivation used by trackEvent:
        user?.fullName || `${firstName} ${lastName}` || email || "Unknown"
    """
    first = (clerk_user.get("first_name") or "").strip()
    last = (clerk_user.get("last_name") or "").strip()
    email = ""
    email_list = clerk_user.get("email_addresses") or []
    if email_list:
        email = (email_list[0].get("email_address") or "").strip()

    full = f"{first} {last}".strip()
    email_local = email.split("@")[0] if email else ""

    # Preserve the exact forms AND lowercased forms — older rows may have
    # been recorded with casing that differs from Clerk's canonical form.
    raw = [full, first, last, email, email_local]
    seen: set[str] = set()
    out: list[str] = []
    for candidate in raw:
        c = (candidate or "").strip()
        if not c or c in seen:
            continue
        seen.add(c)
        out.append(c)
    return out


async def _fetch_all_clerk_users() -> list[dict[str, Any]]:
    secret = os.getenv("CLERK_SECRET_KEY", "")
    if not secret:
        return []
    headers = {"Authorization": f"Bearer {secret}", "Content-Type": "application/json"}
    users: list[dict[str, Any]] = []
    offset = 0
    limit = 100
    async with httpx.AsyncClient(timeout=30.0) as client:
        while True:
            resp = await client.get(
                f"{CLERK_API_BASE}/users",
                headers=headers,
                params={"limit": limit, "offset": offset, "order_by": "-created_at"},
            )
            if resp.status_code != 200:
                break
            batch = resp.json()
            if not batch:
                break
            users.extend(batch)
            if len(batch) < limit:
                break
            offset += limit
    return users


async def backfill_user_ids_from_clerk() -> dict[str, Any]:
    """Consolidate rows with user_id='' onto canonical Clerk user_ids.

    Returns a summary dict with per-user counts and totals so callers can
    log or display the reconciliation result.
    """
    from core.database import get_pool  # local import to avoid circular startup order

    clerk_users = await _fetch_all_clerk_users()
    if not clerk_users:
        return {"status": "skipped", "reason": "no_clerk_users", "users": [], "events_updated": 0, "pdfs_updated": 0}

    pool = await get_pool()
    per_user_report: list[dict[str, Any]] = []
    total_events_updated = 0
    total_pdfs_updated = 0

    async with pool.acquire() as conn:
        for cu in clerk_users:
            clerk_id = cu.get("id") or ""
            aliases = _alias_candidates(cu)
            if not clerk_id or not aliases:
                continue

            # analytics_events — the source of truth for the dashboard.
            # Only touch rows with a blank user_id so we never overwrite a
            # different user's stable id (which would be a catastrophic
            # attribution bug).
            ae_result = await conn.execute(
                """
                UPDATE analytics_events
                SET user_id = $1
                WHERE (user_id IS NULL OR user_id = '')
                  AND user_name = ANY($2::text[])
                """,
                clerk_id, aliases,
            )
            ae_updated = int(ae_result.split()[-1]) if ae_result else 0

            # Also case-insensitive fallback for rows whose user_name differs
            # only in casing from the Clerk aliases. Run as a separate query
            # so we can bound it with the same safety check (user_id blank).
            ae_ci_result = await conn.execute(
                """
                UPDATE analytics_events
                SET user_id = $1
                WHERE (user_id IS NULL OR user_id = '')
                  AND LOWER(user_name) = ANY($2::text[])
                """,
                clerk_id, [a.lower() for a in aliases],
            )
            ae_updated += int(ae_ci_result.split()[-1]) if ae_ci_result else 0

            # pdf_documents — mirror the same attribution so Snapshot History
            # link-outs work when filtered by user.
            pdf_result = await conn.execute(
                """
                UPDATE pdf_documents
                SET user_id = $1
                WHERE (user_id IS NULL OR user_id = '')
                  AND user_name = ANY($2::text[])
                """,
                clerk_id, aliases,
            )
            pdf_updated = int(pdf_result.split()[-1]) if pdf_result else 0

            pdf_ci_result = await conn.execute(
                """
                UPDATE pdf_documents
                SET user_id = $1
                WHERE (user_id IS NULL OR user_id = '')
                  AND LOWER(user_name) = ANY($2::text[])
                """,
                clerk_id, [a.lower() for a in aliases],
            )
            pdf_updated += int(pdf_ci_result.split()[-1]) if pdf_ci_result else 0

            if ae_updated or pdf_updated:
                per_user_report.append({
                    "clerk_id": clerk_id,
                    "aliases": aliases,
                    "events_updated": ae_updated,
                    "pdfs_updated": pdf_updated,
                })
            total_events_updated += ae_updated
            total_pdfs_updated += pdf_updated

    return {
        "status": "ok",
        "users": per_user_report,
        "events_updated": total_events_updated,
        "pdfs_updated": total_pdfs_updated,
        "clerk_users_considered": len(clerk_users),
    }


async def run_startup_backfill() -> None:
    """Fire-and-forget wrapper used by main.py lifespan. Never raises —
    a backfill failure must not block the server from starting."""
    try:
        report = await backfill_user_ids_from_clerk()
        # Simple stdout log so Railway captures it. Keep single-line so it
        # reads cleanly in the Railway logs viewer.
        if report.get("events_updated") or report.get("pdfs_updated"):
            print(
                f"[user_id_backfill] consolidated "
                f"{report.get('events_updated', 0)} analytics rows and "
                f"{report.get('pdfs_updated', 0)} pdf rows across "
                f"{len(report.get('users') or [])} Clerk users",
                flush=True,
            )
        else:
            print(
                f"[user_id_backfill] no rows needed backfill "
                f"(considered {report.get('clerk_users_considered', 0)} Clerk users)",
                flush=True,
            )
    except Exception as exc:
        print(f"[user_id_backfill] skipped due to error: {exc}", flush=True)
