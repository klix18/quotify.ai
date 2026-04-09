import React, { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@clerk/clerk-react";
import COLORS from "./colors";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

/* ── Rich Text Parser ────────────────────────────────────────────── */

function parseRichText(text) {
  if (!text) return [{ type: "text", content: text || "" }];

  const tokens = [];
  const regex = /(\*\*(.+?)\*\*|_(.+?)_|\{(green|red|blue|orange|dim)\}([\s\S]*?)\{\/\4\})/g;

  let lastIndex = 0;
  let match;
  regex.lastIndex = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: "text", content: text.slice(lastIndex, match.index) });
    }
    if (match[2] !== undefined) {
      tokens.push({ type: "bold", content: match[2] });
    } else if (match[3] !== undefined) {
      tokens.push({ type: "italic", content: match[3] });
    } else if (match[4] && match[5] !== undefined) {
      tokens.push({ type: match[4], content: match[5] });
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    tokens.push({ type: "text", content: text.slice(lastIndex) });
  }

  if (tokens.length === 0) tokens.push({ type: "text", content: text });
  return tokens;
}

const COLOR_MAP = {
  green: "#1F9D55",
  red: "#D92D20",
  blue: "#1765D4",
  orange: "#E67E22",
  dim: "#98A6B8",
};

function RichText({ text }) {
  const tokens = parseRichText(text || "");
  return (
    <>
      {tokens.map((tok, i) => {
        if (tok.type === "text") return <span key={i}>{tok.content}</span>;
        if (tok.type === "bold") {
          const inner = parseRichText(tok.content);
          return (
            <strong key={i} style={{ fontWeight: 700 }}>
              {inner.map((t, j) =>
                t.type === "text" ? (
                  <span key={j}>{t.content}</span>
                ) : t.type === "italic" ? (
                  <em key={j} style={{ fontStyle: "italic" }}>{t.content}</em>
                ) : (
                  <span key={j} style={{ color: COLOR_MAP[t.type] || "inherit", fontWeight: t.type === "bold" ? 700 : "inherit" }}>
                    {t.content}
                  </span>
                )
              )}
            </strong>
          );
        }
        if (tok.type === "italic") {
          const inner = parseRichText(tok.content);
          return (
            <em key={i} style={{ fontStyle: "italic" }}>
              {inner.map((t, j) =>
                t.type === "text" ? (
                  <span key={j}>{t.content}</span>
                ) : t.type === "bold" ? (
                  <strong key={j} style={{ fontWeight: 700 }}>{t.content}</strong>
                ) : (
                  <span key={j} style={{ color: COLOR_MAP[t.type] || "inherit" }}>{t.content}</span>
                )
              )}
            </em>
          );
        }
        const inner = parseRichText(tok.content);
        return (
          <span key={i} style={{ color: COLOR_MAP[tok.type] || "inherit" }}>
            {inner.map((t, j) =>
              t.type === "text" ? (
                <span key={j}>{t.content}</span>
              ) : t.type === "bold" ? (
                <strong key={j} style={{ fontWeight: 700 }}>{t.content}</strong>
              ) : t.type === "italic" ? (
                <em key={j} style={{ fontStyle: "italic" }}>{t.content}</em>
              ) : (
                <span key={j} style={{ color: COLOR_MAP[t.type] || "inherit" }}>{t.content}</span>
              )
            )}
          </span>
        );
      })}
    </>
  );
}

/* ── Chat Message Bubble ─────────────────────────────────────────── */

function ChatMessage({ role, content, isStreaming }) {
  const isUser = role === "user";
  return (
    <div style={{
      display: "flex",
      justifyContent: isUser ? "flex-end" : "flex-start",
      marginBottom: 12,
      paddingLeft: isUser ? 48 : 0,
      paddingRight: isUser ? 0 : 48,
    }}>
      <div style={{
        maxWidth: "85%",
        padding: "10px 16px",
        borderRadius: isUser ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
        background: isUser
          ? "linear-gradient(135deg, #1765D4, #0F4EAA)"
          : "rgba(255,255,255,0.85)",
        color: isUser ? "#fff" : COLORS.text,
        fontSize: 14,
        lineHeight: 1.6,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        boxShadow: isUser
          ? "0 2px 8px rgba(23,101,212,0.18)"
          : "0 1px 4px rgba(0,0,0,0.06)",
      }}>
        {isUser ? content : <RichText text={content} />}
        {isStreaming && (
          <span style={{
            display: "inline-block",
            width: 6, height: 14, marginLeft: 2,
            background: COLORS.blue, borderRadius: 1,
            animation: "chatBlink 1s steps(2) infinite",
          }} />
        )}
      </div>
    </div>
  );
}

/* ── Rainbow Border Wrapper ──────────────────────────────────────── */

function RainbowBorder({ children, borderRadius = 20, borderWidth = 2 }) {
  return (
    <div style={{
      position: "relative",
      borderRadius: borderRadius + borderWidth,
      padding: borderWidth,
      background:
        "conic-gradient(from 0deg, #ff6b6b, #ffa500, #ffd93d, #6bcb77, #4d96ff, #9b59b6, #ff6b6b)",
      backgroundSize: "200% 200%",
      animation: "chatRainbow 4s linear infinite",
    }}>
      <div style={{
        borderRadius,
        overflow: "hidden",
        background: "rgba(250, 252, 255, 0.97)",
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
      }}>
        {children}
      </div>
    </div>
  );
}

/* ── Main ChatPanel ──────────────────────────────────────────────── */

export default function ChatPanel({ period, userName }) {
  const { getToken } = useAuth();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [sessionId] = useState(() => crypto.randomUUID());
  const [greeting, setGreeting] = useState(null);
  const [isOpen, setIsOpen] = useState(true);
  const [animState, setAnimState] = useState("open"); // "open" | "closing" | "closed" | "opening"
  const scrollAreaRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(null);
  const sessionStartedRef = useRef(false);

  // Scroll only the chat area — never the page
  const scrollChatToBottom = useCallback(() => {
    const el = scrollAreaRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    scrollChatToBottom();
  }, [messages, greeting, scrollChatToBottom]);

  // Fetch greeting on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch(
          `${API_BASE_URL}/api/chat/greeting?period=${period}&user_name=${encodeURIComponent(userName || "")}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!cancelled && res.ok) {
          const data = await res.json();
          setGreeting(data.greeting);
        }
      } catch (e) {
        if (!cancelled) {
          setGreeting(
            "Hey! I'm **Snappy**, your analytics assistant. Ask me about team performance, insurance breakdowns, or manual change patterns."
          );
        }
      }
    })();
    return () => { cancelled = true; };
  }, [getToken, period]);

  // Start session on mount
  useEffect(() => {
    if (sessionStartedRef.current) return;
    sessionStartedRef.current = true;
    (async () => {
      try {
        const token = await getToken();
        await fetch(`${API_BASE_URL}/api/chat/session/start`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: sessionId, user_name: userName }),
        });
      } catch (e) { /* best effort */ }
    })();

    return () => {
      (async () => {
        try {
          const token = await getToken();
          await fetch(`${API_BASE_URL}/api/chat/session/end`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ session_id: sessionId }),
          });
        } catch (e) { /* best effort */ }
      })();
    };
  }, [sessionId, getToken, userName]);

  // Send message with full error handling
  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    setInput("");
    setMessages((prev) => [
      ...prev,
      { role: "user", content: text },
      { role: "assistant", content: "", streaming: true },
    ]);
    setIsStreaming(true);

    try {
      const token = await getToken();
      const controller = new AbortController();
      abortRef.current = controller;

      const res = await fetch(`${API_BASE_URL}/api/chat/message`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, message: text, period, user_name: userName }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "Unknown error");
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === "assistant") {
            updated[updated.length - 1] = { ...last, content: `{red}Server error (${res.status}). Please try again.{/red}`, streaming: false };
          }
          return updated;
        });
        setIsStreaming(false);
        return;
      }

      if (!res.body) {
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === "assistant") {
            updated[updated.length - 1] = { ...last, content: "{red}No response body received.{/red}", streaming: false };
          }
          return updated;
        });
        setIsStreaming(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === "token") {
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.role === "assistant") {
                  updated[updated.length - 1] = { ...last, content: last.content + event.content };
                }
                return updated;
              });
            } else if (event.type === "done") {
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.role === "assistant") {
                  updated[updated.length - 1] = { ...last, streaming: false };
                }
                return updated;
              });
            } else if (event.type === "error") {
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.role === "assistant") {
                  updated[updated.length - 1] = { ...last, content: "{red}Something went wrong. Please try again.{/red}", streaming: false };
                }
                return updated;
              });
            }
          } catch { /* skip malformed SSE lines */ }
        }
      }

      // Ensure streaming flag is cleared
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === "assistant" && last.streaming) {
          updated[updated.length - 1] = { ...last, streaming: false };
        }
        return updated;
      });

    } catch (e) {
      if (e.name !== "AbortError") {
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === "assistant") {
            updated[updated.length - 1] = { ...last, content: "{red}Connection lost. Please try again.{/red}", streaming: false };
          }
          return updated;
        });
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [input, isStreaming, getToken, sessionId, period, userName]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  /* ── Zoom animation handlers ─── */
  const handleClose = () => {
    setAnimState("closing");
    setTimeout(() => {
      setIsOpen(false);
      setAnimState("closed");
    }, 250);
  };
  const handleOpen = () => {
    setIsOpen(true);
    setAnimState("opening");
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setAnimState("open"));
    });
  };

  /* ── Collapsed state ─────────── */
  if (!isOpen) {
    return (
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
        <button
          onClick={handleOpen}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "10px 24px", borderRadius: 50,
            border: "2px solid transparent",
            backgroundImage:
              "linear-gradient(rgba(250,252,255,0.97), rgba(250,252,255,0.97)), conic-gradient(from 0deg, #ff6b6b, #ffa500, #ffd93d, #6bcb77, #4d96ff, #9b59b6, #ff6b6b)",
            backgroundOrigin: "border-box",
            backgroundClip: "padding-box, border-box",
            cursor: "pointer", fontSize: 14, fontWeight: 600, color: COLORS.text,
            boxShadow: "0 2px 12px rgba(0,0,0,0.06)", transition: "box-shadow 0.2s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.boxShadow = "0 4px 20px rgba(23,101,212,0.15)")}
          onMouseLeave={(e) => (e.currentTarget.style.boxShadow = "0 2px 12px rgba(0,0,0,0.06)")}
        >
          <span style={{ fontSize: 18 }}>✦</span>
          Snappy
        </button>
      </div>
    );
  }

  /* ── Expanded state ──────────── */
  const zoomScale = animState === "opening" ? 0.92 : animState === "closing" ? 0.92 : 1;
  const zoomOpacity = (animState === "opening" || animState === "closing") ? 0 : 1;

  return (
    <div style={{
      display: "flex", justifyContent: "center", width: "100%", marginBottom: 24,
      transform: `scale(${zoomScale})`,
      opacity: zoomOpacity,
      transition: "transform 0.25s cubic-bezier(0.4,0,0.2,1), opacity 0.25s cubic-bezier(0.4,0,0.2,1)",
      transformOrigin: "center center",
    }}>
      {/* Keyframes — scoped names to avoid collisions */}
      <style>{`
        @keyframes chatRainbow {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        @keyframes chatBlink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>
      {/* Scrollbar styles scoped via parent class */}
      <style>{`
        .chatScrollArea::-webkit-scrollbar { width: 10px; height: 10px; }
        .chatScrollArea::-webkit-scrollbar-thumb { background: #D4E2F4; border-radius: 999px; }
        .chatScrollArea::-webkit-scrollbar-track { background: transparent; }
      `}</style>

      <div style={{ maxWidth: "52vw", width: "100%" }}>
        <RainbowBorder>
          {/* Header */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "14px 20px",
            borderBottom: `1px solid ${COLORS.borderGrey}`,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{
                fontSize: 20,
                background: "conic-gradient(from 0deg, #ff6b6b, #ffa500, #ffd93d, #6bcb77, #4d96ff, #9b59b6, #ff6b6b)",
                WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
              }}>✦</span>
              <span style={{ fontWeight: 700, fontSize: 16, color: COLORS.text }}>Snappy</span>
              <span style={{
                fontSize: 11, fontWeight: 600, color: COLORS.blue,
                background: COLORS.blueSoft, padding: "2px 8px", borderRadius: 10,
              }}>Admin</span>
            </div>
            <button
              onClick={handleClose}
              style={{
                background: "none", border: "none", cursor: "pointer",
                fontSize: 18, color: COLORS.mutedText, padding: "4px 8px",
                borderRadius: 6, transition: "background 0.15s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = COLORS.lightGrey)}
              onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
              title="Minimize"
            >✕</button>
          </div>

          {/* Messages area — contained scroll */}
          <div style={{ position: "relative" }}>
            <div
              ref={scrollAreaRef}
              className="chatScrollArea"
              style={{
                height: 320,
                overflowY: "auto",
                padding: "16px 20px 72px 20px",
              }}
            >
              {greeting && <ChatMessage role="assistant" content={greeting} isStreaming={false} />}
              {messages.map((msg, i) => (
                <ChatMessage key={i} role={msg.role} content={msg.content} isStreaming={msg.streaming} />
              ))}
            </div>

            {/* Floating input bar — pinned to bottom of messages area */}
            <div style={{
              position: "absolute",
              bottom: 12,
              left: 16,
              right: 16,
              display: "flex",
              gap: 10,
              alignItems: "center",
            }}>
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about your analytics..."
                style={{
                  flex: 1,
                  border: "none",
                  borderRadius: 50,
                  padding: "12px 20px",
                  fontSize: 14,
                  fontFamily: "inherit",
                  lineHeight: 1.5,
                  outline: "none",
                  background: "#FFFFFF",
                  color: COLORS.text,
                  border: `1.5px solid ${COLORS.borderGrey}`,
                  boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
                  transition: "border-color 0.2s, box-shadow 0.2s",
                }}
                onFocus={(e) => { e.target.style.borderColor = COLORS.blue; e.target.style.boxShadow = `0 2px 16px rgba(23,101,212,0.10)`; }}
                onBlur={(e) => { e.target.style.borderColor = COLORS.borderGrey; e.target.style.boxShadow = "0 2px 12px rgba(0,0,0,0.06)"; }}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || isStreaming}
                style={{
                  width: 42, height: 42,
                  borderRadius: "50%",
                  border: "none",
                  background: !input.trim() || isStreaming
                    ? COLORS.disabledBg
                    : "linear-gradient(135deg, #1765D4, #0F4EAA)",
                  color: !input.trim() || isStreaming ? COLORS.disabledText : "#fff",
                  cursor: !input.trim() || isStreaming ? "default" : "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 18,
                  boxShadow: !input.trim() || isStreaming
                    ? "none"
                    : "0 2px 12px rgba(23,101,212,0.25)",
                  transition: "all 0.2s",
                  flexShrink: 0,
                }}
                title="Send"
              >↑</button>
            </div>
          </div>
        </RainbowBorder>
      </div>
    </div>
  );
}
