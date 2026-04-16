"""
AI Analytics Chatbot API.
Provides SSE-streamed responses grounded in analytics data.
Supports admin view with skills, rich text, memory, and guardrails.
"""

import json
import os
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import httpx
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from usage_tracker import track_openai_usage
from openai import AsyncOpenAI

from auth import get_current_user
from database import get_pool
from skills import build_skills_prompt
from chat_memory import (
    get_session,
    create_session,
    add_message,
    get_conversation_history,
    get_recent_summaries,
    get_active_memories,
    end_session,
)

load_dotenv()

router = APIRouter(prefix="/api/chat", tags=["chat"])


# ── Helpers ──────────────────────────────────────────────────────────

def _get_client() -> AsyncOpenAI:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise ValueError("OPENAI_API_KEY is not set.")
    return AsyncOpenAI(api_key=api_key)


def _period_start(period: str) -> datetime:
    """Convert a period string to a UTC datetime cutoff."""
    now = datetime.now(timezone.utc)
    match period:
        case "week":
            return now - timedelta(weeks=1)
        case "month":
            return now - timedelta(days=30)
        case "6months":
            return now - timedelta(days=182)
        case "year":
            return now - timedelta(days=365)
        case "all":
            return datetime(2000, 1, 1, tzinfo=timezone.utc)
        case _:
            return now - timedelta(days=30)


_PERIOD_LABELS = {
    "week": "the past week",
    "month": "the past month",
    "6months": "the past 6 months",
    "year": "the past year",
    "all": "all time",
}


# ── Insurance type knowledge ─────────────────────────────────────────

INSURANCE_TYPE_KNOWLEDGE = """
--- Insurance Type Directory ---
ACTIVE (fully built, in production):
  • Homeowners — Full quote extraction & generation. Production-ready.
  • Auto — Full quote extraction & generation. Production-ready.

BETA (built but still being refined):
  • Bundle (Homeowners + Auto combined) — Functional but in beta testing.
  • Dwelling (DP1/DP2/DP3 forms) — Functional but in beta testing.
  • Commercial (property, GL, workers comp, cyber, wind, excess) — Functional but in beta testing.

NOT YET BUILT (planned, coming soon):
  • Motorcycle — Not yet available. Coming soon.
  • Boat — Not yet available. Coming soon.
  • Renters — Not yet available. Coming soon.
  • RV — Not yet available. Coming soon.
  • Umbrella — Not yet available. Coming soon.
  • Flood — Not yet available. Coming soon.
"""


# ── Clerk user fetching ──────────────────────────────────────────────

async def _fetch_clerk_users() -> list[dict]:
    """Fetch all registered users from Clerk."""
    secret = os.getenv("CLERK_SECRET_KEY", "")
    if not secret:
        return []
    headers = {"Authorization": f"Bearer {secret}", "Content-Type": "application/json"}
    users = []
    offset = 0
    limit = 100
    try:
        async with httpx.AsyncClient() as client:
            while True:
                resp = await client.get(
                    "https://api.clerk.com/v1/users",
                    headers=headers,
                    params={"limit": limit, "offset": offset, "order_by": "-created_at"},
                )
                if resp.status_code != 200:
                    break
                data = resp.json()
                if not data:
                    break
                for u in data:
                    meta = u.get("public_metadata") or {}
                    first = u.get("first_name") or ""
                    last = u.get("last_name") or ""
                    full_name = f"{first} {last}".strip() or "Unknown"
                    email = ""
                    if u.get("email_addresses"):
                        email = u["email_addresses"][0].get("email_address", "")
                    users.append({
                        "name": full_name,
                        "email": email,
                        "role": meta.get("role", "advisor"),
                    })
                if len(data) < limit:
                    break
                offset += limit
    except Exception:
        pass
    return users


# ── Data fetching (skills) ───────────────────────────────────────────

async def _fetch_full_context(period: str) -> str:
    """Fetch comprehensive analytics data for the given period."""
    pool = await get_pool()
    cutoff = _period_start(period)
    period_label = _PERIOD_LABELS.get(period, period)

    async with pool.acquire() as conn:
        # Total counts
        totals = await conn.fetchrow("""
            SELECT
                COUNT(*) AS total_events,
                COUNT(*) FILTER (WHERE created_quote = TRUE) AS total_quotes_created,
                COUNT(*) FILTER (WHERE uploaded_pdf != '') AS total_pdfs_uploaded
            FROM analytics_events
            WHERE created_at >= $1
        """, cutoff)

        # Usage by insurance type
        type_rows = await conn.fetch("""
            SELECT insurance_type, COUNT(*) AS count
            FROM analytics_events
            WHERE created_at >= $1
            GROUP BY insurance_type
            ORDER BY count DESC
        """, cutoff)

        # Usage by user — GROUP BY stable user_id so renames don't split history
        user_rows = await conn.fetch("""
            SELECT
                (ARRAY_AGG(user_name ORDER BY created_at DESC))[1] AS user_name,
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE created_quote = TRUE) AS quotes_created,
                COUNT(*) FILTER (WHERE uploaded_pdf != '') AS pdfs_uploaded,
                COUNT(DISTINCT DATE(created_at AT TIME ZONE 'America/New_York')) AS days_active
            FROM analytics_events
            WHERE created_at >= $1
            GROUP BY COALESCE(NULLIF(user_id, ''), user_name)
            ORDER BY total DESC
        """, cutoff)

        # Insurance type per user
        user_type_rows = await conn.fetch("""
            SELECT
                (ARRAY_AGG(user_name ORDER BY created_at DESC))[1] AS user_name,
                insurance_type,
                COUNT(*) AS count
            FROM analytics_events
            WHERE created_at >= $1
            GROUP BY COALESCE(NULLIF(user_id, ''), user_name), insurance_type
            ORDER BY count DESC
        """, cutoff)

        # Manual changes breakdown
        mc_rows = await conn.fetch("""
            SELECT manually_changed_fields, insurance_type
            FROM analytics_events
            WHERE created_at >= $1 AND manually_changed_fields != ''
        """, cutoff)

        # Recent events (last 20)
        recent_rows = await conn.fetch("""
            SELECT created_at, user_name, insurance_type, advisor,
                   uploaded_pdf, manually_changed_fields, created_quote, generated_pdf
            FROM analytics_events
            WHERE created_at >= $1
            ORDER BY created_at DESC
            LIMIT 20
        """, cutoff)

    # Parse manual changes
    mc_counts: dict[tuple[str, str], int] = {}
    for row in mc_rows:
        ins_type = row["insurance_type"]
        for field in row["manually_changed_fields"].split(","):
            field = field.strip()
            if field:
                key = (field, ins_type)
                mc_counts[key] = mc_counts.get(key, 0) + 1
    mc_sorted = sorted(mc_counts.items(), key=lambda x: x[1], reverse=True)[:15]

    # Build user type breakdown
    user_type_map: dict[str, list] = {}
    for row in user_type_rows:
        user_type_map.setdefault(row["user_name"], []).append(
            f"{row['insurance_type']}: {row['count']}"
        )

    # Format context block
    lines = [
        f"=== ANALYTICS DATA (Period: {period_label}) ===",
        f"Total Events: {totals['total_events']}",
        f"Quotes Created: {totals['total_quotes_created']}",
        f"PDFs Uploaded: {totals['total_pdfs_uploaded']}",
        "",
        "--- Team Performance (ranked by total events) ---",
    ]

    for i, row in enumerate(user_rows, 1):
        types_detail = ", ".join(user_type_map.get(row["user_name"], []))
        lines.append(
            f"{i}. {row['user_name']} — {row['total']} events, "
            f"{row['quotes_created']} quotes, {row['pdfs_uploaded']} uploads, "
            f"{row['days_active']} days active | Breakdown: {types_detail}"
        )

    total_events = totals["total_events"] or 1
    lines.append("")
    lines.append("--- Insurance Type Distribution ---")
    for row in type_rows:
        pct = round(row["count"] / total_events * 100, 1)
        lines.append(f"  {row['insurance_type']}: {row['count']} ({pct}%)")

    lines.append("")
    lines.append("--- Most Manually Changed Fields (fields requiring human correction) ---")
    for (field, ins_type), count in mc_sorted:
        lines.append(f"  {field} ({ins_type}) — {count}x")

    if not mc_sorted:
        lines.append("  (none)")

    lines.append("")
    lines.append("--- Recent Activity (latest 20 events) ---")
    for row in recent_rows:
        ts = row["created_at"].strftime("%Y-%m-%d %H:%M")
        mc = row["manually_changed_fields"] or "none"
        lines.append(
            f"  {ts} | {row['user_name']} | {row['insurance_type']} | "
            f"advisor: {row['advisor']} | manual changes: {mc} | "
            f"quote: {'Yes' if row['created_quote'] else 'No'}"
        )

    # ── Registered users from Clerk ──
    clerk_users = await _fetch_clerk_users()
    # Build a set of user names that have analytics activity
    active_names = {row["user_name"] for row in user_rows}

    lines.append("")
    lines.append("--- All Registered Team Members (from Clerk) ---")
    admins = [u for u in clerk_users if u["role"] == "admin"]
    advisors = [u for u in clerk_users if u["role"] != "admin"]

    lines.append(f"  Admins ({len(admins)}):")
    for u in admins:
        status = "has activity" if u["name"] in active_names else "NO activity in this period"
        lines.append(f"    • {u['name']} ({u['email']}) — {status}")

    lines.append(f"  Advisors ({len(advisors)}):")
    for u in advisors:
        status = "has activity" if u["name"] in active_names else "NO activity in this period"
        lines.append(f"    • {u['name']} ({u['email']}) — {status}")

    inactive_advisors = [u for u in advisors if u["name"] not in active_names]
    if inactive_advisors:
        lines.append(f"  ⚠ {len(inactive_advisors)} advisor(s) with ZERO activity: "
                      + ", ".join(u["name"] for u in inactive_advisors))

    # ── Insurance type knowledge ──
    lines.append("")
    lines.append(INSURANCE_TYPE_KNOWLEDGE)

    lines.append("=== END DATA ===")
    return "\n".join(lines)


# ── System prompt ────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are the AI analytics assistant for the Quotify AI dashboard at Sizemore Insurance. Your name is Snappy.

## CURRENT USER
You are currently speaking with **{user_display_name}** ({user_email}). Their role is **{user_role}**.
IMPORTANT: This is the person you are talking to RIGHT NOW. Do NOT confuse them with other people who appear in the analytics data below. When the user says "I" or "me" or "my", they mean {user_display_name} — not anyone else in the data.

## YOUR ROLE
You help users understand their team's performance, insurance quote generation patterns, and areas that need attention. All your answers must be grounded in the analytics data provided below — never make up numbers or statistics.

## WHAT YOU CAN ANSWER
- **The user's own identity** — If they ask "who am I", "what's my name", or "what's my role", ALWAYS answer using the CURRENT USER info above. Example: "You're **{user_display_name}**! You're logged in as a **{user_role}**." This is NOT off-topic — you are expected to know and share this.
- **The user's own activity** — Look up their name ({user_display_name}) in the analytics data and summarize their performance.
- Team member performance and rankings (who's processing the most quotes, who's most active)
- All registered team members — including advisors who have NOT taken any action yet (pulled from Clerk)
- Insurance type distribution and trends (which types are most popular, breakdowns)
- Insurance type status — which types are active/production, which are in beta, and which are not yet built
- Manual field change patterns (which fields need human correction most often after AI extraction)
- Activity trends and recent events
- Specific user deep-dives
- Comparisons between team members

## UNDERSTANDING USERS vs ADVISORS
In the analytics data, each quote event has two key fields: **user_name** (the logged-in user who performed the action) and **advisor** (the advisor selected from the advisor dropdown for that quote).

Critical context:
- Every logged-in user IS an advisor. They appear in both the user list and the advisor list.
- Most of the time, the user selects THEMSELVES as the advisor. When user_name and advisor match (e.g., user_name="Kevin Li", advisor="Kevin Li"), this is the same person — they created the quote for themselves.
- Occasionally, a user creates a quote ON BEHALF of a different advisor. When user_name and advisor differ (e.g., user_name="Kevin Li", advisor="Ashlyn Magee"), Kevin Li processed the quote but it belongs to Ashlyn Magee's book of business.
- When discussing a person's activity, consider BOTH their actions as a logged-in user AND quotes attributed to them as an advisor.
- If asked "how many quotes did Kevin Li do?", consider both quotes where Kevin Li was the user AND quotes where Kevin Li was the advisor (they mostly overlap, but not always).

## WHAT YOU CANNOT ANSWER
- Anything unrelated to the analytics data AND unrelated to the user's identity (general knowledge, coding, etc.)
- Identity questions ("who am I", "what's my name") are NEVER off-topic — always answer those.
- If asked something truly off-topic, respond warmly: "I'm focused on your analytics data! Try asking about team performance, insurance breakdowns, or which fields need the most manual fixes."

## RESPONSE FORMAT — RICH TEXT
Use these markup tags to make responses scannable and visually clear:
- **bold text** for emphasis, key numbers, and user names
- _italic text_ for secondary labels, descriptions, and supporting context
- {{green}}text{{/green}} for positive metrics, improvements, good performance, and DWELLING insurance
- {{red}}text{{/red}} for areas needing attention, declines, high manual change frequency
- {{blue}}text{{/blue}} for HOMEOWNERS insurance and general highlights
- {{orange}}text{{/orange}} for COMMERCIAL insurance and moderate concerns/warnings

IMPORTANT — Insurance type colors must be consistent:
- Homeowners → always {{blue}}
- Dwelling → always {{green}}
- Commercial → always {{orange}}
- Auto, Bundle, Wind → use **bold** only (no color tag)

{skills_prompt}

## RESPONSE STYLE
- Be concise and direct. Lead with the answer, then provide supporting detail.
- Use short paragraphs, not long walls of text.
- When listing rankings, use numbered format with bold names and colored metrics.
- Always reference the time period of the data when relevant.
- Be confident when the data clearly supports an answer.
- If data is insufficient to answer, say so honestly.

## MEMORY CONTEXT
{memory_context}

## PREVIOUS CONVERSATIONS
{session_summaries}

## CURRENT DATA
{data_context}
"""


def _build_system_prompt(
    data_context: str,
    memories: list[dict],
    summaries: list[dict],
    user_display_name: str = "User",
    user_email: str = "",
    user_role: str = "advisor",
) -> str:
    """Assemble the full system prompt with all context."""
    # Format memories
    if memories:
        mem_lines = []
        for m in memories:
            mem_lines.append(f"- [{m['memory_type']}] {m['content']}")
        memory_context = "What I know about this user (their identity, preferences, and behavior):\n" + "\n".join(mem_lines)
    else:
        memory_context = "No prior knowledge about this user yet."

    # Format summaries
    if summaries:
        sum_lines = []
        for s in summaries:
            date = s.get("started_at", "")
            if hasattr(date, "strftime"):
                date = date.strftime("%Y-%m-%d")
            sum_lines.append(f"- [{date}] {s['summary']}")
        session_summaries = "Recent conversation summaries:\n" + "\n".join(sum_lines)
    else:
        session_summaries = "No previous conversations."

    # Load skills from markdown files
    skills_prompt = build_skills_prompt("admin")

    return SYSTEM_PROMPT.format(
        skills_prompt=skills_prompt,
        memory_context=memory_context,
        session_summaries=session_summaries,
        data_context=data_context,
        user_display_name=user_display_name,
        user_email=user_email or "unknown",
        user_role=user_role,
    )


# ── Greeting ─────────────────────────────────────────────────────────

@router.get("/greeting")
async def get_greeting(
    period: str = Query("month", regex="^(week|month|6months|year|all)$"),
    user_name: str = Query(""),
    user: dict = Depends(get_current_user),
):
    """Get the auto-greeting for the admin chatbot (no LLM call)."""
    pool = await get_pool()
    cutoff = _period_start(period)
    period_label = _PERIOD_LABELS.get(period, period)

    # Extract first name for the greeting
    first_name = user_name.split()[0] if user_name.strip() else ""

    async with pool.acquire() as conn:
        totals = await conn.fetchrow("""
            SELECT
                COUNT(*) AS total_events,
                COUNT(*) FILTER (WHERE created_quote = TRUE) AS total_quotes,
                COUNT(*) FILTER (WHERE uploaded_pdf != '') AS total_pdfs
            FROM analytics_events
            WHERE created_at >= $1
        """, cutoff)

        top_user = await conn.fetchrow("""
            SELECT
                (ARRAY_AGG(user_name ORDER BY created_at DESC))[1] AS user_name,
                COUNT(*) AS total
            FROM analytics_events
            WHERE created_at >= $1
            GROUP BY COALESCE(NULLIF(user_id, ''), user_name)
            ORDER BY total DESC
            LIMIT 1
        """, cutoff)

        top_type = await conn.fetchrow("""
            SELECT insurance_type, COUNT(*) AS count
            FROM analytics_events
            WHERE created_at >= $1
            GROUP BY insurance_type
            ORDER BY count DESC
            LIMIT 1
        """, cutoff)

    events = totals["total_events"] if totals else 0
    quotes = totals["total_quotes"] if totals else 0

    name_part = f" {first_name}" if first_name else ""
    greeting = (
        f"Hey{name_part}! Here's your **{period_label}** snapshot:\n\n"
        f"**{events}** total events · "
        f"{{green}}**{quotes}**{{/green}} quotes generated"
    )

    if top_user:
        greeting += f"\n\nTop performer: **{top_user['user_name']}** with {{green}}**{top_user['total']}**{{/green}} events"

    if top_type:
        greeting += f"\nMost quoted: **{top_type['insurance_type'].title()}** insurance ({top_type['count']} quotes)"

    greeting += (
        '\n\n_Try asking:_'
        '\n· "How does this month compare to last month?"'
        '\n· "Which advisor is getting the most quotes?"'
        '\n· "What fields need the most manual fixes?"'
    )

    return {"greeting": greeting}


# ── Session management ───────────────────────────────────────────────

@router.post("/session/start")
async def start_session(
    request: Request,
    user: dict = Depends(get_current_user),
):
    """Start a new chat session."""
    body = await request.json()
    session_id = body.get("session_id", str(uuid4()))
    user_name = body.get("user_name", "").strip() or "User"
    user_metadata = user.get("metadata", {})
    user_role = user_metadata.get("role", "advisor")

    session = create_session(session_id, user["user_id"], user_name, user_role)
    return {"session_id": session["session_id"], "status": "created"}


@router.post("/session/end")
async def end_session_endpoint(
    request: Request,
    user: dict = Depends(get_current_user),
):
    """End a chat session (triggers summarization + memory extraction)."""
    body = await request.json()
    session_id = body.get("session_id", "")
    if session_id:
        await end_session(session_id)
    return {"status": "ended"}


# ── Memory & session history endpoints ──────────────────────────────

@router.get("/memory/sessions")
async def list_sessions(
    user: dict = Depends(get_current_user),
):
    """List all saved chat session summaries for the current user."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT id, user_role, started_at, ended_at, summary, key_topics, message_count
            FROM chat_session_memories
            WHERE user_id = $1 AND summary IS NOT NULL AND summary != ''
            ORDER BY started_at DESC
        """, user["user_id"])
    return [dict(r) for r in rows]


@router.delete("/memory/sessions/{session_id}")
async def delete_session(
    session_id: str,
    user: dict = Depends(get_current_user),
):
    """Delete a saved chat session summary."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        result = await conn.execute("""
            DELETE FROM chat_session_memories WHERE id = $1 AND user_id = $2
        """, session_id, user["user_id"])
    return {"deleted": result == "DELETE 1"}


@router.get("/memory/memories")
async def list_memories(
    user: dict = Depends(get_current_user),
):
    """List all long-term memories for the current user."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT id, memory_type, content, context, created_at, last_accessed, access_count, relevance_score, is_active
            FROM chat_insight_memories
            WHERE user_id = $1
            ORDER BY created_at DESC
        """, user["user_id"])
    return [dict(r) for r in rows]


@router.delete("/memory/memories/{memory_id}")
async def delete_memory(
    memory_id: str,
    user: dict = Depends(get_current_user),
):
    """Delete a long-term memory."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        result = await conn.execute("""
            DELETE FROM chat_insight_memories WHERE id = $1 AND user_id = $2
        """, memory_id, user["user_id"])
    return {"deleted": result == "DELETE 1"}


# ── Chat message (SSE streaming) ─────────────────────────────────────

@router.post("/message")
async def chat_message(
    request: Request,
    user: dict = Depends(get_current_user),
):
    """
    Send a message to the chatbot. Returns SSE stream of tokens.
    Body: { session_id, message, period }
    """
    body = await request.json()
    session_id = body.get("session_id", "")
    message = body.get("message", "").strip()
    period = body.get("period", "month")

    if not message:
        return {"error": "Empty message"}

    # Resolve user identity
    user_name = body.get("user_name", "").strip() or "User"
    user_email = user.get("email", "")
    user_metadata = user.get("metadata", {})
    user_role = user_metadata.get("role", "advisor")

    # Ensure session exists
    session = get_session(session_id)
    if session is None:
        session = create_session(session_id, user["user_id"], user_name, user_role)

    # Add user message to session
    add_message(session_id, "user", message)

    # Fetch all context in parallel
    data_context = await _fetch_full_context(period)
    memories = await get_active_memories(user["user_id"])
    summaries = await get_recent_summaries(user["user_id"])

    # Build system prompt with current user identity
    system_prompt = _build_system_prompt(
        data_context, memories, summaries,
        user_display_name=user_name,
        user_email=user_email,
        user_role=user_role,
    )

    # Build conversation messages for the LLM (OpenAI format)
    history = get_conversation_history(session_id)
    llm_messages = [{"role": "system", "content": system_prompt}]
    for msg in history:
        role = "user" if msg["role"] == "user" else "assistant"
        llm_messages.append({"role": role, "content": msg["content"]})

    async def stream_response():
        """Async generator that yields SSE events token-by-token."""
        full_response = ""
        try:
            client = _get_client()
            response = await client.chat.completions.create(
                model="gpt-4o",
                messages=llm_messages,
                temperature=0.4,
                max_tokens=1500,
                stream=True,
                stream_options={"include_usage": True},
            )

            async for chunk in response:
                # Final chunk with usage stats (no choices)
                if hasattr(chunk, "usage") and chunk.usage:
                    track_openai_usage(
                        model="gpt-4o",
                        input_tokens=chunk.usage.prompt_tokens or 0,
                        output_tokens=chunk.usage.completion_tokens or 0,
                        call_type="chat",
                    )
                    continue
                delta = chunk.choices[0].delta if chunk.choices else None
                if delta and delta.content:
                    full_response += delta.content
                    event_data = json.dumps({"type": "token", "content": delta.content})
                    yield f"data: {event_data}\n\n"

            # Send done event
            done_data = json.dumps({"type": "done", "full_response": full_response})
            yield f"data: {done_data}\n\n"

            # Store assistant response in session
            add_message(session_id, "assistant", full_response)

        except Exception as e:
            error_data = json.dumps({"type": "error", "content": str(e)})
            yield f"data: {error_data}\n\n"

    return StreamingResponse(
        stream_response(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
