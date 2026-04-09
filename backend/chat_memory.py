"""
Chat memory system for the AI analytics chatbot.
Handles session memory, long-term conversational memory,
and LLM-powered summarization/deduplication.
"""

import os
import json
import logging
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from dotenv import load_dotenv
from openai import AsyncOpenAI

from database import get_pool

load_dotenv()

logger = logging.getLogger(__name__)


def _get_client() -> AsyncOpenAI:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise ValueError("OPENAI_API_KEY is not set.")
    return AsyncOpenAI(api_key=api_key)


# ── In-memory session store ──────────────────────────────────────────

_sessions: dict[str, dict] = {}
_SESSION_TTL = 1800  # 30 minutes
_MAX_MESSAGES = 50


def get_session(session_id: str) -> dict | None:
    """Get a session from the in-memory store."""
    session = _sessions.get(session_id)
    if session is None:
        return None
    # Check TTL
    elapsed = (datetime.now(timezone.utc) - session["last_active"]).total_seconds()
    if elapsed > _SESSION_TTL:
        _sessions.pop(session_id, None)
        return None
    return session


def create_session(session_id: str, user_id: str, user_name: str) -> dict:
    """Create a new in-memory session."""
    session = {
        "session_id": session_id,
        "user_id": user_id,
        "user_name": user_name,
        "messages": [],
        "created_at": datetime.now(timezone.utc),
        "last_active": datetime.now(timezone.utc),
    }
    _sessions[session_id] = session
    return session


def add_message(session_id: str, role: str, content: str):
    """Add a message to the session buffer."""
    session = _sessions.get(session_id)
    if session is None:
        return
    session["messages"].append({
        "role": role,
        "content": content,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    session["last_active"] = datetime.now(timezone.utc)

    # Trim if exceeding max: keep summary of older + last 20
    if len(session["messages"]) > _MAX_MESSAGES:
        session["messages"] = session["messages"][-30:]


def get_conversation_history(session_id: str) -> list[dict]:
    """Get the conversation history for a session."""
    session = _sessions.get(session_id)
    if session is None:
        return []
    return session["messages"]


# ── Database: session summaries ──────────────────────────────────────

async def save_session_summary(
    session_id: str,
    user_id: str,
    user_role: str,
    messages: list[dict],
):
    """Summarize a session via LLM and store in database."""
    if not messages or len(messages) < 2:
        return

    # Build conversation text for summarization
    convo_text = "\n".join(
        f"{m['role'].upper()}: {m['content']}" for m in messages
    )

    summary = ""
    key_topics = []

    try:
        client = _get_client()
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": f"""Summarize this analytics dashboard conversation in 2-3 concise sentences.
Extract the key topics discussed as a JSON array of short strings.

Conversation:
{convo_text}

Respond in this exact JSON format:
{{"summary": "...", "key_topics": ["topic1", "topic2"]}}"""}],
            temperature=0.2,
            max_tokens=300,
        )

        text = response.choices[0].message.content.strip()
        # Parse JSON from response (handle markdown code blocks)
        if text.startswith("```"):
            text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        parsed = json.loads(text)
        summary = parsed.get("summary", "")
        key_topics = parsed.get("key_topics", [])
        logger.info(f"[chat_memory] Summarized session {session_id}: {summary[:80]}...")

    except Exception as e:
        logger.error(f"[chat_memory] Failed to summarize session {session_id}: {e}")
        summary = f"Conversation with {len(messages)} messages."
        key_topics = []

    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO chat_session_memories (id, user_id, user_role, started_at, ended_at, summary, key_topics, message_count)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        """,
            session_id,
            user_id,
            user_role,
            messages[0].get("timestamp", datetime.now(timezone.utc).isoformat()),
            datetime.now(timezone.utc).isoformat(),
            summary,
            key_topics,
            len(messages),
        )

    # Also extract long-term memories from this session
    await _extract_memories(user_id, convo_text)


async def get_recent_summaries(user_id: str, limit: int = 5) -> list[dict]:
    """Get recent session summaries for a user."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT summary, key_topics, started_at, message_count
            FROM chat_session_memories
            WHERE user_id = $1 AND summary IS NOT NULL AND summary != ''
            ORDER BY started_at DESC
            LIMIT $2
        """, user_id, limit)
    return [dict(r) for r in rows]


# ── Database: long-term memories ─────────────────────────────────────

async def _extract_memories(user_id: str, convo_text: str):
    """Use LLM to extract durable memories from a conversation."""
    try:
        client = _get_client()
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": f"""Based on this analytics dashboard conversation, extract any lasting preferences, insights, or patterns worth remembering for future conversations.

Only extract truly durable information — NOT ephemeral queries like "who's the top performer this week".
Good examples: "Admin prefers seeing percentages over raw counts", "Admin is particularly interested in homeowners insurance trends", "Admin noticed NationWide quotes always need client_phone fixed".

If there's nothing durable to remember, respond with an empty array.

Conversation:
{convo_text}

Respond in this exact JSON format:
[{{"type": "preference|insight|pattern", "content": "...", "context": "..."}}]"""}],
            temperature=0.2,
            max_tokens=500,
        )

        text = response.choices[0].message.content.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        memories = json.loads(text)

        if not memories or not isinstance(memories, list):
            logger.info(f"[chat_memory] No durable memories extracted for user {user_id}")
            return

        logger.info(f"[chat_memory] Extracted {len(memories)} memories for user {user_id}")

        pool = await get_pool()
        async with pool.acquire() as conn:
            for mem in memories:
                # Check for duplicates before inserting
                existing = await conn.fetch("""
                    SELECT id, content FROM chat_insight_memories
                    WHERE user_id = $1 AND is_active = TRUE
                """, user_id)

                is_duplicate = False
                for ex in existing:
                    # Simple content similarity check
                    if _content_similar(mem.get("content", ""), ex["content"]):
                        # Update access time instead of duplicating
                        await conn.execute("""
                            UPDATE chat_insight_memories
                            SET last_accessed = NOW(), access_count = access_count + 1
                            WHERE id = $1
                        """, ex["id"])
                        is_duplicate = True
                        break

                if not is_duplicate and mem.get("content"):
                    await conn.execute("""
                        INSERT INTO chat_insight_memories (id, user_id, memory_type, content, context)
                        VALUES ($1, $2, $3, $4, $5)
                    """,
                        str(uuid4()),
                        user_id,
                        mem.get("type", "insight"),
                        mem["content"],
                        mem.get("context", ""),
                    )

    except Exception as e:
        logger.error(f"[chat_memory] Failed to extract memories for user {user_id}: {e}")


def _content_similar(a: str, b: str) -> bool:
    """Simple word-overlap similarity check."""
    words_a = set(a.lower().split())
    words_b = set(b.lower().split())
    if not words_a or not words_b:
        return False
    overlap = len(words_a & words_b)
    smaller = min(len(words_a), len(words_b))
    return (overlap / smaller) > 0.7 if smaller > 0 else False


async def get_active_memories(user_id: str, limit: int = 10) -> list[dict]:
    """Get the most relevant active memories for a user."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT id, memory_type, content, context, created_at, last_accessed, access_count
            FROM chat_insight_memories
            WHERE user_id = $1 AND is_active = TRUE
            ORDER BY
                relevance_score * (1.0 / (1.0 + EXTRACT(EPOCH FROM (NOW() - last_accessed)) / 86400.0 / 30.0)) DESC
            LIMIT $2
        """, user_id, limit)

        # Update access timestamps
        for row in rows:
            await conn.execute("""
                UPDATE chat_insight_memories
                SET last_accessed = NOW(), access_count = access_count + 1
                WHERE id = $1
            """, row["id"])

    return [dict(r) for r in rows]


async def decay_old_memories():
    """Decay relevance of memories not accessed in 90+ days. Run periodically."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute("""
            UPDATE chat_insight_memories
            SET relevance_score = GREATEST(0.1, relevance_score - 0.1)
            WHERE is_active = TRUE
              AND last_accessed < NOW() - INTERVAL '90 days'
        """)


# ── End session ──────────────────────────────────────────────────────

async def end_session(session_id: str):
    """End a session: summarize, extract memories, clean up."""
    session = _sessions.pop(session_id, None)
    if session and session["messages"]:
        await save_session_summary(
            session_id=session_id,
            user_id=session["user_id"],
            user_role="admin",
            messages=session["messages"],
        )
