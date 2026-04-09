"""
AI Analytics Chatbot API.
Provides SSE-streamed responses grounded in analytics data.
Supports admin view with skills, rich text, memory, and guardrails.
"""

import json
import os
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from dotenv import load_dotenv
from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from google import genai
from google.genai import types

from auth import require_admin
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

def _get_client() -> genai.Client:
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise ValueError("GEMINI_API_KEY is not set.")
    return genai.Client(api_key=api_key)


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

        # Usage by user
        user_rows = await conn.fetch("""
            SELECT
                user_name,
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE created_quote = TRUE) AS quotes_created,
                COUNT(*) FILTER (WHERE uploaded_pdf != '') AS pdfs_uploaded,
                COUNT(DISTINCT DATE(created_at AT TIME ZONE 'UTC')) AS days_active
            FROM analytics_events
            WHERE created_at >= $1
            GROUP BY user_name
            ORDER BY total DESC
        """, cutoff)

        # Insurance type per user
        user_type_rows = await conn.fetch("""
            SELECT user_name, insurance_type, COUNT(*) AS count
            FROM analytics_events
            WHERE created_at >= $1
            GROUP BY user_name, insurance_type
            ORDER BY user_name, count DESC
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

    lines.append("=== END DATA ===")
    return "\n".join(lines)


# ── System prompt ────────────────────────────────────────────────────

ADMIN_SYSTEM_PROMPT = """You are the AI analytics assistant for the Quotify AI admin dashboard at Sizemore Insurance. Your name is Snappy.

## YOUR ROLE
You help admins understand their team's performance, insurance quote generation patterns, and areas that need attention. All your answers must be grounded in the analytics data provided below — never make up numbers or statistics.

## WHAT YOU CAN ANSWER
- Team member performance and rankings (who's processing the most quotes, who's most active)
- Insurance type distribution and trends (which types are most popular, breakdowns)
- Manual field change patterns (which fields need human correction most often after AI extraction)
- Activity trends and recent events
- Specific user deep-dives
- Comparisons between team members

## WHAT YOU CANNOT ANSWER
- Anything unrelated to the analytics data (general knowledge, coding, personal topics, etc.)
- If asked something off-topic, respond warmly: "I'm focused on your analytics data! Try asking about team performance, insurance breakdowns, or which fields need the most manual fixes."

## RESPONSE FORMAT — RICH TEXT
Use these markup tags to make responses scannable and visually clear:
- **bold text** for emphasis, key numbers, and user names
- _italic text_ for secondary labels, descriptions, and supporting context
- {{green}}text{{/green}} for positive metrics, improvements, good performance
- {{red}}text{{/red}} for areas needing attention, declines, high manual change frequency
- {{blue}}text{{/blue}} for neutral highlights, insurance types, general labels
- {{orange}}text{{/orange}} for moderate concerns, warnings
- {{dim}}text{{/dim}} for secondary/supporting information

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
) -> str:
    """Assemble the full system prompt with all context."""
    # Format memories
    if memories:
        mem_lines = []
        for m in memories:
            mem_lines.append(f"- [{m['memory_type']}] {m['content']}")
        memory_context = "Things I remember about this admin:\n" + "\n".join(mem_lines)
    else:
        memory_context = "No prior memories about this admin."

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

    return ADMIN_SYSTEM_PROMPT.format(
        skills_prompt=skills_prompt,
        memory_context=memory_context,
        session_summaries=session_summaries,
        data_context=data_context,
    )


# ── Greeting ─────────────────────────────────────────────────────────

@router.get("/greeting")
async def get_greeting(
    period: str = Query("month", regex="^(week|month|6months|year|all)$"),
    user_name: str = Query(""),
    admin: dict = Depends(require_admin),
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
            SELECT user_name, COUNT(*) AS total
            FROM analytics_events
            WHERE created_at >= $1
            GROUP BY user_name
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
        '\n· "Who\'s the top performer?"'
        '\n· "Which insurance type gets the most quotes?"'
        '\n· "What fields need the most manual fixes?"'
    )

    return {"greeting": greeting}


# ── Session management ───────────────────────────────────────────────

@router.post("/session/start")
async def start_session(
    request: Request,
    admin: dict = Depends(require_admin),
):
    """Start a new chat session."""
    body = await request.json()
    session_id = body.get("session_id", str(uuid4()))
    user_name = body.get("user_name", "Admin")

    session = create_session(session_id, admin["user_id"], user_name)
    return {"session_id": session["session_id"], "status": "created"}


@router.post("/session/end")
async def end_session_endpoint(
    request: Request,
    admin: dict = Depends(require_admin),
):
    """End a chat session (triggers summarization + memory extraction)."""
    body = await request.json()
    session_id = body.get("session_id", "")
    if session_id:
        await end_session(session_id)
    return {"status": "ended"}


# ── Chat message (SSE streaming) ─────────────────────────────────────

@router.post("/message")
async def chat_message(
    request: Request,
    admin: dict = Depends(require_admin),
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

    # Ensure session exists
    session = get_session(session_id)
    if session is None:
        session = create_session(session_id, admin["user_id"], body.get("user_name", "Admin"))

    # Add user message to session
    add_message(session_id, "user", message)

    # Fetch all context in parallel
    data_context = await _fetch_full_context(period)
    memories = await get_active_memories(admin["user_id"])
    summaries = await get_recent_summaries(admin["user_id"])

    # Build system prompt
    system_prompt = _build_system_prompt(data_context, memories, summaries)

    # Build conversation messages for the LLM
    history = get_conversation_history(session_id)
    llm_messages = []
    for msg in history:
        role = "user" if msg["role"] == "user" else "model"
        llm_messages.append(types.Content(
            role=role,
            parts=[types.Part(text=msg["content"])],
        ))

    async def stream_response():
        """Generator that yields SSE events."""
        full_response = ""
        try:
            client = _get_client()
            response = client.models.generate_content_stream(
                model="gemini-2.5-flash",
                contents=llm_messages,
                config=types.GenerateContentConfig(
                    system_instruction=system_prompt,
                    temperature=0.4,
                    max_output_tokens=1500,
                ),
            )

            for chunk in response:
                if chunk.text:
                    full_response += chunk.text
                    # SSE format: data: {json}\n\n
                    event_data = json.dumps({"type": "token", "content": chunk.text})
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
