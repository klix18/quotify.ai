import React, { useState, useEffect } from "react";
import { useAuth } from "@clerk/clerk-react";
import COLORS from "./colors";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

export default function ChatMemoryPage({ onBack }) {
  const { getToken } = useAuth();
  const [sessions, setSessions] = useState([]);
  const [memories, setMemories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("sessions"); // "sessions" | "memories"

  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        const headers = { Authorization: `Bearer ${token}` };
        const [sessRes, memRes] = await Promise.all([
          fetch(`${API_BASE_URL}/api/chat/memory/sessions`, { headers }),
          fetch(`${API_BASE_URL}/api/chat/memory/memories`, { headers }),
        ]);
        if (sessRes.ok) setSessions(await sessRes.json());
        if (memRes.ok) setMemories(await memRes.json());
      } catch (e) {
        console.error("Failed to load memory data:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, [getToken]);

  const deleteSession = async (id) => {
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/api/chat/memory/sessions/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setSessions((prev) => prev.filter((s) => s.id !== id));
    } catch (e) {
      console.error("Failed to delete session:", e);
    }
  };

  const deleteMemory = async (id) => {
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/api/chat/memory/memories/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setMemories((prev) => prev.filter((m) => m.id !== id));
    } catch (e) {
      console.error("Failed to delete memory:", e);
    }
  };

  const formatDate = (val) => {
    if (!val) return "—";
    try {
      const d = new Date(val);
      if (isNaN(d.getTime())) return String(val);
      return d.toLocaleString("en-US", {
        month: "short", day: "numeric", year: "numeric",
        hour: "numeric", minute: "2-digit",
      });
    } catch {
      return String(val);
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: COLORS.pageBg,
      fontFamily: "Poppins, sans-serif",
      padding: "32px 48px",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 28 }}>
        <button
          onClick={onBack}
          style={{
            background: "none", border: `1px solid ${COLORS.borderGrey}`,
            borderRadius: 10, padding: "6px 14px", cursor: "pointer",
            fontSize: 13, fontFamily: "inherit", color: COLORS.mutedText,
          }}
        >
          ← Back
        </button>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: COLORS.text, margin: 0 }}>
          Snappy Memory
        </h1>
        <span style={{ fontSize: 12, color: COLORS.mutedText }}>
          Conversation summaries & long-term memories stored by the AI
        </span>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 0, marginBottom: 24 }}>
        {[
          { key: "sessions", label: "Past Conversations", count: sessions.length },
          { key: "memories", label: "What Snappy Knows", count: memories.length },
        ].map(({ key, label, count }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              padding: "10px 24px",
              fontSize: 13,
              fontWeight: tab === key ? 600 : 400,
              fontFamily: "inherit",
              color: tab === key ? COLORS.blue : COLORS.mutedText,
              background: tab === key ? COLORS.white : "transparent",
              border: `1px solid ${tab === key ? COLORS.borderGrey : "transparent"}`,
              borderBottom: tab === key ? `2px solid ${COLORS.blue}` : `1px solid ${COLORS.borderGrey}`,
              borderRadius: tab === key ? "10px 10px 0 0" : 0,
              cursor: "pointer",
            }}
          >
            {label} ({count})
          </button>
        ))}
        <div style={{ flex: 1, borderBottom: `1px solid ${COLORS.borderGrey}` }} />
      </div>

      {loading && (
        <div style={{ color: COLORS.mutedText, fontSize: 14, padding: 24 }}>Loading...</div>
      )}

      {/* Session Summaries Tab */}
      {!loading && tab === "sessions" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {sessions.length === 0 && (
            <div style={{ color: COLORS.mutedText, fontSize: 14, padding: 24 }}>
              No saved sessions yet. Chat with Snappy and close the panel to generate a summary.
            </div>
          )}
          {sessions.map((s) => (
            <div key={s.id} style={{
              background: COLORS.white,
              border: `1px solid ${COLORS.borderGrey}`,
              borderRadius: 14,
              padding: "16px 20px",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                <div>
                  <span style={{ fontSize: 12, color: COLORS.mutedText }}>
                    {formatDate(s.started_at)}
                  </span>
                  <span style={{
                    marginLeft: 12, fontSize: 11, color: COLORS.blue,
                    background: COLORS.blueSoft, padding: "2px 8px", borderRadius: 8,
                  }}>
                    {s.message_count} messages
                  </span>
                </div>
                <button
                  onClick={() => deleteSession(s.id)}
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    fontSize: 12, color: COLORS.danger, padding: "2px 8px",
                    borderRadius: 6, fontFamily: "inherit",
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = COLORS.dangerSoft}
                  onMouseLeave={(e) => e.currentTarget.style.background = "none"}
                >
                  Delete
                </button>
              </div>
              <div style={{ fontSize: 14, color: COLORS.text, lineHeight: 1.6, marginBottom: 8 }}>
                {s.summary}
              </div>
              {s.key_topics && s.key_topics.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {s.key_topics.map((topic, i) => (
                    <span key={i} style={{
                      fontSize: 11, color: COLORS.mutedText,
                      background: COLORS.lightGrey, padding: "2px 10px",
                      borderRadius: 20, border: `1px solid ${COLORS.borderGrey}`,
                    }}>
                      {topic}
                    </span>
                  ))}
                </div>
              )}
              <div style={{ fontSize: 11, color: COLORS.subtextGrey, marginTop: 8 }}>
                ID: {s.id}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Long-Term Memories Tab */}
      {!loading && tab === "memories" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {memories.length === 0 && (
            <div style={{ color: COLORS.mutedText, fontSize: 14, padding: 24 }}>
              No long-term memories yet. Snappy extracts durable insights from your conversations over time.
            </div>
          )}
          {memories.map((m) => (
            <div key={m.id} style={{
              background: COLORS.white,
              border: `1px solid ${COLORS.borderGrey}`,
              borderRadius: 14,
              padding: "16px 20px",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{
                    fontSize: 11, fontWeight: 600, textTransform: "uppercase",
                    color: m.memory_type === "preference" ? COLORS.blue
                         : m.memory_type === "pattern" ? COLORS.green
                         : "#E67E22",
                    background: m.memory_type === "preference" ? COLORS.blueSoft
                              : m.memory_type === "pattern" ? COLORS.greenSoft
                              : "#FEF3E2",
                    padding: "2px 10px", borderRadius: 8,
                  }}>
                    {m.memory_type}
                  </span>
                  <span style={{ fontSize: 12, color: COLORS.mutedText }}>
                    {formatDate(m.created_at)}
                  </span>
                  {!m.is_active && (
                    <span style={{
                      fontSize: 11, color: COLORS.danger,
                      background: COLORS.dangerSoft, padding: "2px 8px", borderRadius: 8,
                    }}>
                      inactive
                    </span>
                  )}
                </div>
                <button
                  onClick={() => deleteMemory(m.id)}
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    fontSize: 12, color: COLORS.danger, padding: "2px 8px",
                    borderRadius: 6, fontFamily: "inherit",
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = COLORS.dangerSoft}
                  onMouseLeave={(e) => e.currentTarget.style.background = "none"}
                >
                  Delete
                </button>
              </div>
              <div style={{ fontSize: 14, color: COLORS.text, lineHeight: 1.6 }}>
                {m.content}
              </div>
              {m.context && (
                <div style={{ fontSize: 12, color: COLORS.mutedText, marginTop: 6, fontStyle: "italic" }}>
                  Context: {m.context}
                </div>
              )}
              <div style={{
                display: "flex", gap: 16, marginTop: 8,
                fontSize: 11, color: COLORS.subtextGrey,
              }}>
                <span>Relevance: {m.relevance_score?.toFixed(2) ?? "—"}</span>
                <span>Accessed: {m.access_count}x</span>
                <span>Last accessed: {formatDate(m.last_accessed)}</span>
                <span>ID: {m.id}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
