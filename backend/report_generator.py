"""
Automated report generation and email delivery for admin analytics.
Generates periodic reports (weekly, monthly) and sends via Resend.
Can be triggered by a scheduled endpoint or external cron.
"""

import os
import json
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from fastapi import APIRouter, Depends
from google import genai
from google.genai import types

from auth import require_admin
from database import get_pool
from parsers._model_fallback import (
    DEFAULT_FINAL_FALLBACKS,
    generate_with_fallback,
)

load_dotenv()

router = APIRouter(prefix="/api/reports", tags=["reports"])

RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
RESEND_FROM_EMAIL = os.getenv("RESEND_FROM_EMAIL", "Snapshot AI <reports@quotify.ai>")


def _get_gemini_client() -> genai.Client:
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise ValueError("GEMINI_API_KEY is not set.")
    return genai.Client(api_key=api_key)


def _period_cutoff(report_type: str) -> tuple[datetime, str]:
    """Return (cutoff_datetime, human_label) for a report type."""
    now = datetime.now(timezone.utc)
    match report_type:
        case "weekly":
            return now - timedelta(weeks=1), "This Week"
        case "monthly":
            return now - timedelta(days=30), "This Month"
        case "quarterly":
            return now - timedelta(days=91), "This Quarter"
        case _:
            return now - timedelta(days=30), "This Month"


async def _gather_report_data(cutoff: datetime) -> dict:
    """Gather all analytics data needed for a report."""
    pool = await get_pool()

    async with pool.acquire() as conn:
        # Totals
        totals = await conn.fetchrow("""
            SELECT
                COUNT(*) AS total_events,
                COUNT(*) FILTER (WHERE created_quote = TRUE) AS total_quotes,
                COUNT(*) FILTER (WHERE uploaded_pdf != '') AS total_pdfs
            FROM analytics_events
            WHERE created_at >= $1
        """, cutoff)

        # User rankings
        user_rows = await conn.fetch("""
            SELECT
                user_name,
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE created_quote = TRUE) AS quotes,
                COUNT(*) FILTER (WHERE uploaded_pdf != '') AS uploads,
                COUNT(DISTINCT DATE(created_at AT TIME ZONE 'America/New_York')) AS days_active
            FROM analytics_events
            WHERE created_at >= $1
            GROUP BY user_name
            ORDER BY total DESC
        """, cutoff)

        # Insurance breakdown
        type_rows = await conn.fetch("""
            SELECT insurance_type, COUNT(*) AS count
            FROM analytics_events
            WHERE created_at >= $1
            GROUP BY insurance_type
            ORDER BY count DESC
        """, cutoff)

        # Manual changes
        mc_rows = await conn.fetch("""
            SELECT manually_changed_fields, insurance_type
            FROM analytics_events
            WHERE created_at >= $1 AND manually_changed_fields != ''
        """, cutoff)

        # Previous period for growth comparison
        prev_cutoff = cutoff - (datetime.now(timezone.utc) - cutoff)
        prev_user_rows = await conn.fetch("""
            SELECT user_name, COUNT(*) AS total
            FROM analytics_events
            WHERE created_at >= $1 AND created_at < $2
            GROUP BY user_name
        """, prev_cutoff, cutoff)

        prev_type_rows = await conn.fetch("""
            SELECT insurance_type, COUNT(*) AS count
            FROM analytics_events
            WHERE created_at >= $1 AND created_at < $2
            GROUP BY insurance_type
        """, prev_cutoff, cutoff)

    # Parse manual changes
    mc_counts: dict[tuple[str, str], int] = {}
    for row in mc_rows:
        for field in row["manually_changed_fields"].split(","):
            field = field.strip()
            if field:
                key = (field, row["insurance_type"])
                mc_counts[key] = mc_counts.get(key, 0) + 1

    mc_sorted = sorted(mc_counts.items(), key=lambda x: x[1], reverse=True)[:10]

    # Growth calculation
    prev_totals = {r["user_name"]: r["total"] for r in prev_user_rows}
    growth = []
    for row in user_rows:
        prev = prev_totals.get(row["user_name"], 0)
        if prev > 0:
            pct = round((row["total"] - prev) / prev * 100, 1)
        elif row["total"] > 0:
            pct = 100.0
        else:
            pct = 0.0
        growth.append({"user_name": row["user_name"], "current": row["total"], "previous": prev, "growth_pct": pct})
    growth.sort(key=lambda x: x["growth_pct"], reverse=True)

    # Insurance type changes
    prev_type_totals = {r["insurance_type"]: r["count"] for r in prev_type_rows}
    type_changes = []
    for row in type_rows:
        prev = prev_type_totals.get(row["insurance_type"], 0)
        diff = row["count"] - prev
        type_changes.append({
            "insurance_type": row["insurance_type"],
            "current": row["count"],
            "previous": prev,
            "change": diff,
        })

    return {
        "totals": dict(totals) if totals else {},
        "users": [dict(r) for r in user_rows],
        "insurance_types": [dict(r) for r in type_rows],
        "manual_changes": [{"field": k[0], "type": k[1], "count": v} for k, v in mc_sorted],
        "growth": growth[:5],
        "type_changes": type_changes,
    }


async def _generate_report_html(data: dict, period_label: str) -> str:
    """Use Gemini to generate an HTML email report from analytics data."""
    client = _get_gemini_client()

    data_str = json.dumps(data, indent=2, default=str)

    response = generate_with_fallback(
        client,
        "gemini-2.5-flash",
        DEFAULT_FINAL_FALLBACKS,
        contents=types.Content(
            role="user",
            parts=[types.Part(text=f"""Generate a professional HTML email report for the Sizemore Insurance analytics dashboard.
Period: {period_label}

Data:
{data_str}

Requirements:
- Clean, modern email-safe HTML (inline CSS only, no external stylesheets)
- Professional color scheme: navy headers, white background, green for positive, red for negative
- Sections: Executive Summary, Top 3 Performers, Top 3 Growth Leaders, Insurance Type Distribution (with period-over-period changes), Fields Requiring Most Manual Fixes
- Use tables for data, keep it scannable
- Include Sizemore Insurance branding at the top
- Include a brief AI-generated insight paragraph at the top summarizing the key takeaway
- Footer: "Generated by Snapshot AI — Quotify Analytics"
- Keep total HTML under 5000 characters

Respond with ONLY the HTML, no markdown code blocks or explanation.""")]
        ),
        config=types.GenerateContentConfig(
            temperature=0.3,
            max_output_tokens=4000,
        ),
    )

    html = response.text.strip()
    # Strip markdown code blocks if present
    if html.startswith("```"):
        html = html.split("\n", 1)[1].rsplit("```", 1)[0].strip()
    return html


async def _send_email(to_emails: list[str], subject: str, html_body: str) -> dict:
    """Send an email via Resend API."""
    if not RESEND_API_KEY:
        return {"error": "RESEND_API_KEY not configured"}

    import httpx
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            "https://api.resend.com/emails",
            headers={
                "Authorization": f"Bearer {RESEND_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "from": RESEND_FROM_EMAIL,
                "to": to_emails,
                "subject": subject,
                "html": html_body,
            },
        )
        return resp.json()


async def _get_admin_emails() -> list[str]:
    """Fetch all admin email addresses from Clerk."""
    api_base = os.getenv("CLERK_API_BASE", "https://api.clerk.com/v1")
    secret_key = os.getenv("CLERK_SECRET_KEY", "")
    if not secret_key:
        return []

    import httpx
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{api_base}/users?limit=100",
            headers={"Authorization": f"Bearer {secret_key}"},
        )
        if resp.status_code != 200:
            return []
        users = resp.json()

    emails = []
    for user in users:
        meta = user.get("public_metadata", {})
        if meta.get("role") == "admin":
            # Get primary email
            primary_id = user.get("primary_email_address_id", "")
            for ea in user.get("email_addresses", []):
                if ea.get("id") == primary_id:
                    emails.append(ea["email_address"])
                    break
    return emails


# ── Endpoints ────────────────────────────────────────────────────────

@router.post("/generate")
async def generate_report(
    admin: dict = Depends(require_admin),
    report_type: str = "weekly",
):
    """Manually trigger a report generation + email to all admins."""
    cutoff, period_label = _period_cutoff(report_type)
    data = await _gather_report_data(cutoff)
    html = await _generate_report_html(data, period_label)

    admin_emails = await _get_admin_emails()
    if not admin_emails:
        return {"status": "no_admins", "html_preview": html}

    now_str = datetime.now(timezone.utc).strftime("%B %d, %Y")
    subject = f"Sizemore Insurance — {period_label} Analytics Report ({now_str})"

    result = await _send_email(admin_emails, subject, html)
    return {
        "status": "sent",
        "recipients": admin_emails,
        "resend_response": result,
    }


@router.get("/preview")
async def preview_report(
    report_type: str = "weekly",
    admin: dict = Depends(require_admin),
):
    """Preview a report without sending email."""
    cutoff, period_label = _period_cutoff(report_type)
    data = await _gather_report_data(cutoff)
    html = await _generate_report_html(data, period_label)
    return {"html": html, "data": data, "period": period_label}
