import React from "react";
import { useAuth } from "@clerk/clerk-react";
import COLORS from "./colors";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

const PERIODS = [
  { value: "week", label: "Last Week" },
  { value: "month", label: "Last Month" },
  { value: "6months", label: "Last 6 Months" },
  { value: "year", label: "Last Year" },
  { value: "all", label: "All Time" },
];

/* ── Glass Panel (matches right panel from QuotifyHome) ──────── */
function GlassPanel({ children, borderRadius = 24, style = {} }) {
  return (
    <div style={{ position: "relative", borderRadius, overflow: "hidden", border: "none", ...style }}>
      <div style={{
        position: "absolute", inset: 0,
        background: "rgba(255,255,255,0.70)",
        backdropFilter: "blur(48px) saturate(2.0) brightness(1.05)",
        WebkitBackdropFilter: "blur(48px) saturate(2.0) brightness(1.05)",
        zIndex: 0,
      }} />
      <div style={{
        position: "absolute", inset: 0, borderRadius,
        boxShadow: "inset 0 2px 0 0 rgba(255,255,255,1), inset 0 -1px 0 0 rgba(255,255,255,0.2), inset 1px 0 0 0 rgba(255,255,255,0.4), inset -1px 0 0 0 rgba(255,255,255,0.4)",
        zIndex: 3, pointerEvents: "none",
      }} />
      <div style={{
        position: "absolute", top: 0, left: "10%", right: "10%", height: 1,
        background: "linear-gradient(90deg, transparent, rgba(255,100,100,0.15), rgba(255,255,100,0.1), rgba(100,200,255,0.15), transparent)",
        zIndex: 4, pointerEvents: "none",
      }} />
      <div style={{ position: "relative", zIndex: 5 }}>{children}</div>
    </div>
  );
}

/* ── Hover Button ────────────────────────────────────────────── */
function HoverButton({ children, onClick, disabled, variant = "primary", style: extraStyle }) {
  const [hovered, setHovered] = React.useState(false);
  const base = {
    borderRadius: 14, height: 48, padding: "0 24px", fontSize: 14, fontWeight: 600,
    fontFamily: "Poppins, sans-serif", cursor: disabled ? "not-allowed" : "pointer",
    transition: "all 200ms ease", border: "none", ...extraStyle,
  };
  const variants = {
    primary: {
      background: disabled ? "#DFE3E8" : COLORS.blue, color: disabled ? "#B0B7C3" : COLORS.white,
      border: `1px solid ${disabled ? "#DFE3E8" : COLORS.blue}`,
      boxShadow: hovered && !disabled ? `0 0 28px ${COLORS.hoverShadow}` : "0 0 0 rgba(0,0,0,0)",
    },
    outline: {
      background: "rgba(255,255,255,0.6)", color: COLORS.black,
      border: `1px solid ${COLORS.borderGrey}`,
      backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
      boxShadow: hovered ? `0 0 24px ${COLORS.hoverShadow}` : "0 0 0 rgba(0,0,0,0)",
    },
    danger: {
      background: COLORS.dangerSoft, color: COLORS.danger,
      border: `1px solid ${COLORS.dangerBorder}`,
      boxShadow: hovered ? `0 0 20px rgba(217,45,32,0.12)` : "0 0 0 rgba(0,0,0,0)",
    },
    dangerConfirm: {
      background: COLORS.danger, color: COLORS.white,
      border: `1px solid ${COLORS.danger}`,
      boxShadow: hovered ? `0 0 20px rgba(217,45,32,0.2)` : "0 0 0 rgba(0,0,0,0)",
    },
    ghost: {
      background: COLORS.lightGrey, color: COLORS.mutedText,
      border: `1px solid ${COLORS.lightGrey}`,
      boxShadow: hovered ? `0 0 16px ${COLORS.hoverShadow}` : "0 0 0 rgba(0,0,0,0)",
    },
    dangerSmall: {
      background: "transparent", color: COLORS.danger,
      border: `1px solid ${COLORS.dangerBorder}`,
      boxShadow: hovered ? `0 0 14px rgba(217,45,32,0.10)` : "0 0 0 rgba(0,0,0,0)",
    },
  };
  return (
    <button
      onClick={onClick} disabled={disabled}
      onMouseEnter={() => { if (!disabled) setHovered(true); }}
      onMouseLeave={() => setHovered(false)}
      style={{ ...base, ...variants[variant] }}
    >{children}</button>
  );
}

/* ── Confirmation Modal ──────────────────────────────────────── */
function ConfirmModal({ message, onConfirm, onCancel, confirming }) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,0,0.25)", backdropFilter: "blur(6px)",
    }}>
      <GlassPanel borderRadius={20} style={{ maxWidth: 400, width: "90%" }}>
        <div style={{ padding: "28px 32px", textAlign: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 500, color: COLORS.black, marginBottom: 24, lineHeight: 1.5 }}>
            {message}
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            <HoverButton variant="ghost" onClick={onCancel} style={{ height: 40, padding: "0 20px" }}>Cancel</HoverButton>
            <HoverButton variant="dangerConfirm" onClick={onConfirm} disabled={confirming} style={{ height: 40, padding: "0 20px" }}>
              {confirming ? "Deleting..." : "Delete"}
            </HoverButton>
          </div>
        </div>
      </GlassPanel>
    </div>
  );
}

/* ── Stat Card ───────────────────────────────────────────────── */
function StatCard({ label, value, sub, color }) {
  const [hovered, setHovered] = React.useState(false);
  return (
    <GlassPanel borderRadius={18} style={{ flex: "1 1 200px", minWidth: 170, transition: "all 200ms ease", boxShadow: hovered ? `0 8px 32px rgba(23,101,212,0.10)` : "none" }}>
      <div
        style={{ padding: "24px 28px" }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div style={{ fontSize: 11, color: COLORS.mutedText, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>
          {label}
        </div>
        <div style={{ fontSize: 32, fontWeight: 700, color: color || COLORS.black, lineHeight: 1.1 }}>{value}</div>
        {sub && <div style={{ fontSize: 13, color: COLORS.mutedText, fontWeight: 400, marginTop: 6 }}>{sub}</div>}
      </div>
    </GlassPanel>
  );
}

/* ── Section wrapper with glass ──────────────────────────────── */
function Section({ title, children, action = null }) {
  return (
    <GlassPanel>
      <div style={{ padding: "24px 28px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, marginBottom: 18 }}>
          <div style={{ fontFamily: "SentientCustom, Georgia, serif", fontSize: 20, lineHeight: 1, letterSpacing: "-0.02em", color: COLORS.black }}>{title}</div>
          {action}
        </div>
        {children}
      </div>
    </GlassPanel>
  );
}

/* ── Insurance type bar chart ────────────────────────────────── */
function InsuranceBreakdown({ data }) {
  if (!data || Object.keys(data).length === 0) return <div style={{ color: COLORS.mutedText, fontSize: 13 }}>No data yet</div>;
  const total = Object.values(data).reduce((a, b) => a + b, 0);
  const typeColors = { homeowners: "#1765D4", auto: "#0B91E6", dwelling: "#1F9D55", commercial: "#E6850B", bundle: "#9B59B6", wind: "#6F7D90" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {Object.entries(data).sort(([, a], [, b]) => b - a).map(([type, count]) => {
        const pct = total > 0 ? (count / total) * 100 : 0;
        return (
          <div key={type}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.black, textTransform: "capitalize" }}>{type}</span>
              <span style={{ fontSize: 13, fontWeight: 400, color: COLORS.mutedText }}>{count} ({pct.toFixed(1)}%)</span>
            </div>
            <div style={{ height: 8, borderRadius: 4, background: "rgba(0,0,0,0.04)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${pct}%`, borderRadius: 4, background: typeColors[type] || COLORS.blue, transition: "width 0.4s ease" }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Manual Changes Leaderboard ──────────────────────────────── */
function ManualChangesLeaderboard({ data }) {
  if (!data || data.length === 0) return <div style={{ color: COLORS.mutedText, fontSize: 13 }}>No manual changes recorded</div>;
  const typeColors = { homeowners: "#1765D4", auto: "#0B91E6", dwelling: "#1F9D55", commercial: "#E6850B", bundle: "#9B59B6", wind: "#6F7D90" };
  const maxCount = data[0]?.count || 1;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {data.slice(0, 15).map((item, i) => (
        <div key={`${item.field}-${item.insurance_type}`}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.black, fontFamily: "monospace" }}>{item.field}</span>
              <span style={{
                fontSize: 10, fontWeight: 600, textTransform: "uppercase", padding: "2px 8px", borderRadius: 6,
                background: typeColors[item.insurance_type] ? `${typeColors[item.insurance_type]}15` : COLORS.lightGrey,
                color: typeColors[item.insurance_type] || COLORS.mutedText,
              }}>{item.insurance_type}</span>
            </div>
            <span style={{ fontSize: 13, fontWeight: 700, color: COLORS.blue }}>{item.count}x</span>
          </div>
          <div style={{ height: 5, borderRadius: 3, background: "rgba(0,0,0,0.04)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${(item.count / maxCount) * 100}%`, borderRadius: 3, background: typeColors[item.insurance_type] || COLORS.blue, transition: "width 0.4s ease" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Clickable User Row ──────────────────────────────────────── */
function UserRow({ user, onClick }) {
  const [hovered, setHovered] = React.useState(false);
  return (
    <tr
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        borderBottom: `1px solid rgba(180,200,230,0.2)`,
        cursor: "pointer",
        transition: "all 150ms ease",
        background: hovered ? "rgba(23,101,212,0.04)" : "transparent",
      }}
    >
      <td style={{ padding: "12px 14px", fontWeight: 600, color: COLORS.blue }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            width: 32, height: 32, borderRadius: "50%",
            background: `linear-gradient(135deg, ${COLORS.blue}, #0B91E6)`,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: COLORS.white, fontSize: 13, fontWeight: 700, flexShrink: 0,
          }}>
            {user.user_name.charAt(0).toUpperCase()}
          </div>
          {user.user_name}
        </div>
      </td>
      <td style={{ padding: "12px 14px", textAlign: "right", fontWeight: 700, color: COLORS.black }}>{user.total}</td>
      <td style={{ padding: "12px 14px", textAlign: "right" }}>{user.quotes_created}</td>
      <td style={{ padding: "12px 14px", textAlign: "right" }}>{user.pdfs_uploaded}</td>
      <td style={{ padding: "12px 14px", textAlign: "right", color: COLORS.mutedText }}>
        <span style={{ fontSize: 16 }}>&#8250;</span>
      </td>
    </tr>
  );
}

function UserTable({ users, onSelectUser }) {
  if (!users || users.length === 0) return <div style={{ color: COLORS.mutedText, fontSize: 13 }}>No user activity yet</div>;
  const th = { padding: "10px 14px", color: COLORS.mutedText, fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" };
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, fontFamily: "Poppins, sans-serif" }}>
        <thead>
          <tr style={{ borderBottom: `2px solid rgba(180,200,230,0.3)` }}>
            <th style={{ ...th, textAlign: "left" }}>User</th>
            <th style={{ ...th, textAlign: "right" }}>Total</th>
            <th style={{ ...th, textAlign: "right" }}>Quotes</th>
            <th style={{ ...th, textAlign: "right" }}>Uploads</th>
            <th style={{ ...th, textAlign: "right", width: 30 }}></th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <UserRow key={u.user_name} user={u} onClick={() => onSelectUser(u.user_name)} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── User Detail View ────────────────────────────────────────── */
function UserDetailView({ userName, period, getToken, onBack }) {
  const [data, setData] = React.useState(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const token = await getToken();
        const resp = await fetch(`${API_BASE_URL}/api/admin/analytics/user/${encodeURIComponent(userName)}?period=${period}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (resp.ok) setData(await resp.json());
      } catch {}
      setLoading(false);
    })();
  }, [userName, period, getToken]);

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: COLORS.mutedText, fontSize: 13 }}>Loading user data...</div>;
  if (!data) return <div style={{ padding: 40, textAlign: "center", color: COLORS.mutedText, fontSize: 13 }}>Failed to load user data.</div>;

  const typeColors = { homeowners: "#1765D4", auto: "#0B91E6", dwelling: "#1F9D55", commercial: "#E6850B", bundle: "#9B59B6", wind: "#6F7D90" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <HoverButton variant="outline" onClick={onBack} style={{ height: 40, padding: "0 18px" }}>
          &#8249; Users
        </HoverButton>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 40, height: 40, borderRadius: "50%",
            background: `linear-gradient(135deg, ${COLORS.blue}, #0B91E6)`,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: COLORS.white, fontSize: 16, fontWeight: 700,
          }}>
            {userName.charAt(0).toUpperCase()}
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: COLORS.black }}>{userName}</div>
        </div>
      </div>

      {/* User stat cards */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        <StatCard label="Total Events" value={data.total_events} color={COLORS.blue} />
        <StatCard label="Quotes Created" value={data.quotes_created} color={COLORS.green} />
        <StatCard label="PDFs Uploaded" value={data.pdfs_uploaded} />
      </div>

      {/* Insurance breakdown */}
      <Section title="Insurance Type Breakdown">
        <InsuranceBreakdown data={data.by_insurance_type} />
      </Section>

      {/* User recent events */}
      <Section title="Recent Activity">
        {data.recent_events && data.recent_events.length > 0 ? (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: "Poppins, sans-serif" }}>
              <thead>
                <tr style={{ borderBottom: `2px solid rgba(180,200,230,0.3)` }}>
                  {["Date", "Insurance", "Advisor", "Uploaded PDF", "Manual Changes", "Quote", "Generated PDF"].map((h) => (
                    <th key={h} style={{ padding: "8px 10px", color: COLORS.mutedText, fontWeight: 600, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em", textAlign: "left", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.recent_events.map((e) => (
                  <tr key={e.id} style={{ borderBottom: `1px solid rgba(180,200,230,0.15)` }}>
                    <td style={{ padding: "8px 10px", fontSize: 12 }}>{new Date(e.created_at).toLocaleString()}</td>
                    <td style={{ padding: "8px 10px", textTransform: "capitalize" }}>
                      <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 10, fontWeight: 600, background: `${typeColors[e.insurance_type] || COLORS.blue}15`, color: typeColors[e.insurance_type] || COLORS.blue }}>{e.insurance_type}</span>
                    </td>
                    <td style={{ padding: "8px 10px" }}>{e.advisor || "—"}</td>
                    <td style={{ padding: "8px 10px", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.uploaded_pdf || "—"}</td>
                    <td style={{ padding: "8px 10px", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.manually_changed_fields || "—"}</td>
                    <td style={{ padding: "8px 10px", textAlign: "center" }}>
                      <span style={{
                        display: "inline-block", padding: "2px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600,
                        background: e.created_quote ? COLORS.greenSoft : COLORS.dangerSoft,
                        color: e.created_quote ? COLORS.green : COLORS.danger,
                      }}>{e.created_quote ? "Yes" : "No"}</span>
                    </td>
                    <td style={{ padding: "8px 10px", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.generated_pdf || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ color: COLORS.mutedText, fontSize: 13 }}>No events yet</div>
        )}
      </Section>
    </div>
  );
}

/* ── Snapshot History (Event Log with delete) ────────────────── */
function SnapshotHistory({ events, getToken, onRefresh }) {
  const [deleteTarget, setDeleteTarget] = React.useState(null);
  const [deleting, setDeleting] = React.useState(false);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const token = await getToken();
      const resp = await fetch(`${API_BASE_URL}/api/admin/analytics/event/${deleteTarget}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (resp.ok) {
        setDeleteTarget(null);
        onRefresh();
      }
    } catch {}
    setDeleting(false);
  };

  const handlePdfDownload = async (fileName, type) => {
    if (!fileName || fileName === "—") return;
    try {
      const token = await getToken();
      const resp = await fetch(`${API_BASE_URL}/api/pdfs?doc_type=${type}&limit=200`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) return;
      const data = await resp.json();
      // Find matching document by file_name
      const doc = data.documents?.find((d) =>
        d.file_name === fileName || fileName.startsWith(d.file_name?.split(".pdf")[0])
      );
      if (doc) {
        window.open(`${API_BASE_URL}/api/pdfs/${doc.id}`, "_blank");
      }
    } catch {}
  };

  if (!events || events.length === 0) return <div style={{ color: COLORS.mutedText, fontSize: 13 }}>No events yet</div>;

  const th = { padding: "8px 10px", color: COLORS.mutedText, fontWeight: 600, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap", textAlign: "left" };
  const td = { padding: "8px 10px", fontSize: 12, fontWeight: 400, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
  const typeColors = { homeowners: "#1765D4", auto: "#0B91E6", dwelling: "#1F9D55", commercial: "#E6850B", bundle: "#9B59B6", wind: "#6F7D90" };

  return (
    <>
      {deleteTarget && (
        <ConfirmModal
          message="Are you sure you want to delete this event? This action cannot be undone."
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
          confirming={deleting}
        />
      )}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "Poppins, sans-serif" }}>
          <thead>
            <tr style={{ borderBottom: `2px solid rgba(180,200,230,0.3)` }}>
              <th style={th}>Date</th>
              <th style={th}>User</th>
              <th style={th}>Insurance</th>
              <th style={th}>Advisor</th>
              <th style={th}>Uploaded PDF</th>
              <th style={th}>Manual Changes</th>
              <th style={{ ...th, textAlign: "center" }}>Quote</th>
              <th style={th}>Generated PDF</th>
              <th style={{ ...th, textAlign: "center", width: 50 }}></th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <HoverRow key={e.id}>
                <td style={td}>{new Date(e.created_at).toLocaleString()}</td>
                <td style={{ ...td, fontWeight: 500 }}>{e.user_name}</td>
                <td style={td}>
                  <span style={{
                    padding: "2px 8px", borderRadius: 6, fontSize: 10, fontWeight: 600, textTransform: "capitalize",
                    background: `${typeColors[e.insurance_type] || COLORS.blue}15`,
                    color: typeColors[e.insurance_type] || COLORS.blue,
                  }}>{e.insurance_type}</span>
                </td>
                <td style={td}>{e.advisor || "—"}</td>
                <td style={td} title={e.uploaded_pdf}>
                  {e.uploaded_pdf ? (
                    <span
                      onClick={() => handlePdfDownload(e.uploaded_pdf, "uploaded")}
                      style={{ color: COLORS.blue, cursor: "pointer", textDecoration: "underline", textDecorationColor: "rgba(23,101,212,0.3)" }}
                    >{e.uploaded_pdf}</span>
                  ) : "—"}
                </td>
                <td style={td} title={e.manually_changed_fields}>{e.manually_changed_fields || "—"}</td>
                <td style={{ ...td, textAlign: "center" }}>
                  <span style={{
                    display: "inline-block", padding: "2px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600,
                    background: e.created_quote ? COLORS.greenSoft : COLORS.dangerSoft,
                    color: e.created_quote ? COLORS.green : COLORS.danger,
                    border: `1px solid ${e.created_quote ? COLORS.greenBorder : COLORS.dangerBorder}`,
                  }}>{e.created_quote ? "Yes" : "No"}</span>
                </td>
                <td style={td} title={e.generated_pdf}>
                  {e.generated_pdf ? (
                    <span
                      onClick={() => handlePdfDownload(e.generated_pdf, "generated")}
                      style={{ color: COLORS.blue, cursor: "pointer", textDecoration: "underline", textDecorationColor: "rgba(23,101,212,0.3)" }}
                    >{e.generated_pdf}</span>
                  ) : "—"}
                </td>
                <td style={{ ...td, textAlign: "center" }}>
                  <HoverButton
                    variant="dangerSmall"
                    onClick={() => setDeleteTarget(e.id)}
                    style={{ height: 28, padding: "0 10px", fontSize: 11, borderRadius: 8 }}
                  >Delete</HoverButton>
                </td>
              </HoverRow>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ── Hoverable table row ─────────────────────────────────────── */
function HoverRow({ children }) {
  const [hovered, setHovered] = React.useState(false);
  return (
    <tr
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        borderBottom: `1px solid rgba(180,200,230,0.15)`,
        transition: "background 150ms ease",
        background: hovered ? "rgba(23,101,212,0.03)" : "transparent",
      }}
    >{children}</tr>
  );
}

/* ── Main Dashboard ──────────────────────────────────────────── */
export default function AdminDashboard({ onBack }) {
  const { getToken } = useAuth();
  const [period, setPeriod] = React.useState("month");
  const [data, setData] = React.useState(null);
  const [manualChanges, setManualChanges] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [resetConfirm, setResetConfirm] = React.useState(false);
  const [resetting, setResetting] = React.useState(false);
  const [selectedUser, setSelectedUser] = React.useState(null);

  // Mouse-tracking orbs
  const containerRef = React.useRef(null);
  const orbPrimaryRef = React.useRef(null);
  const orbCyanRef = React.useRef(null);
  const orbTrailRef = React.useRef(null);
  const mouseTarget = React.useRef({ x: 0, y: 0 });
  const orbPrimary = React.useRef({ x: 0, y: 0 });
  const orbCyan = React.useRef({ x: 0, y: 0 });
  const orbTrail = React.useRef({ x: 0, y: 0 });
  const velocityRef = React.useRef({ x: 0, y: 0 });
  const prevSmooth = React.useRef({ x: 0, y: 0 });
  const rafId = React.useRef(null);
  const mouseInside = React.useRef(false);

  React.useEffect(() => {
    const lerp = (a, b, t) => a + (b - a) * t;
    const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
    const tick = () => {
      orbPrimary.current.x = lerp(orbPrimary.current.x, mouseTarget.current.x, 0.04);
      orbPrimary.current.y = lerp(orbPrimary.current.y, mouseTarget.current.y, 0.04);
      orbCyan.current.x = lerp(orbCyan.current.x, mouseTarget.current.x, 0.018);
      orbCyan.current.y = lerp(orbCyan.current.y, mouseTarget.current.y, 0.018);
      orbTrail.current.x = lerp(orbTrail.current.x, mouseTarget.current.x, 0.007);
      orbTrail.current.y = lerp(orbTrail.current.y, mouseTarget.current.y, 0.007);
      const vx = orbPrimary.current.x - prevSmooth.current.x;
      const vy = orbPrimary.current.y - prevSmooth.current.y;
      velocityRef.current.x = lerp(velocityRef.current.x, vx, 0.15);
      velocityRef.current.y = lerp(velocityRef.current.y, vy, 0.15);
      prevSmooth.current.x = orbPrimary.current.x;
      prevSmooth.current.y = orbPrimary.current.y;
      const speed = Math.sqrt(velocityRef.current.x ** 2 + velocityRef.current.y ** 2);
      const angle = Math.atan2(velocityRef.current.y, velocityRef.current.x) * (180 / Math.PI);
      const stretchAmt = clamp(1 + speed * 0.06, 1, 2.0);
      const squishAmt = clamp(1 - speed * 0.015, 0.7, 1);
      const opacity = mouseInside.current ? 1 : 0;
      if (orbPrimaryRef.current) {
        orbPrimaryRef.current.style.transform = `translate(${orbPrimary.current.x}px, ${orbPrimary.current.y}px) translate(-50%, -50%) rotate(${angle}deg) scale(${stretchAmt}, ${squishAmt})`;
        orbPrimaryRef.current.style.opacity = opacity;
      }
      if (orbCyanRef.current) {
        const cStretch = clamp(1 + speed * 0.04, 1, 1.6);
        const cSquish = clamp(1 - speed * 0.01, 0.8, 1);
        orbCyanRef.current.style.transform = `translate(${orbCyan.current.x}px, ${orbCyan.current.y}px) translate(-50%, -50%) rotate(${angle}deg) scale(${cStretch}, ${cSquish})`;
        orbCyanRef.current.style.opacity = opacity;
      }
      if (orbTrailRef.current) {
        orbTrailRef.current.style.transform = `translate(${orbTrail.current.x}px, ${orbTrail.current.y}px) translate(-50%, -50%)`;
        orbTrailRef.current.style.opacity = opacity;
      }
      rafId.current = requestAnimationFrame(tick);
    };
    rafId.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId.current);
  }, []);

  const handleMouseMove = React.useCallback((e) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    mouseTarget.current.x = e.clientX - rect.left;
    mouseTarget.current.y = e.clientY - rect.top;
    if (!mouseInside.current) mouseInside.current = true;
  }, []);

  const handleMouseLeave = React.useCallback(() => { mouseInside.current = false; }, []);

  const fetchAnalytics = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const token = await getToken();
      const [summaryResp, changesResp] = await Promise.all([
        fetch(`${API_BASE_URL}/api/admin/analytics/summary?period=${period}`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_BASE_URL}/api/admin/analytics/manual-changes?period=${period}`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (summaryResp.status === 403) {
        setError("You don't have admin access. Set role: 'admin' in your Clerk user's public metadata.");
        return;
      }
      if (!summaryResp.ok) {
        const detail = await summaryResp.json().catch(() => ({}));
        throw new Error(detail?.detail || `HTTP ${summaryResp.status}`);
      }
      setData(await summaryResp.json());
      if (changesResp.ok) setManualChanges(await changesResp.json());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [period, getToken]);

  React.useEffect(() => { fetchAnalytics(); }, [fetchAnalytics]);

  const handleReset = async () => {
    setResetting(true);
    try {
      const token = await getToken();
      const resp = await fetch(`${API_BASE_URL}/api/admin/analytics/reset?period=${period}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) throw new Error("Reset failed");
      setResetConfirm(false);
      await fetchAnalytics();
    } catch (e) {
      setError(e.message);
    } finally {
      setResetting(false);
    }
  };

  const periodLabel = PERIODS.find((p) => p.value === period)?.label || period;

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{
        minHeight: "100vh",
        background: COLORS.pageBg,
        fontFamily: "Poppins, sans-serif",
        padding: "32px 40px",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Animated orbs */}
      <div ref={orbPrimaryRef} style={{ position: "absolute", width: 400, height: 400, borderRadius: "50%", background: "rgba(23,101,212,0.14)", filter: "blur(80px)", pointerEvents: "none", zIndex: 0, willChange: "transform, opacity", opacity: 0, transition: "opacity 0.4s ease" }} />
      <div ref={orbCyanRef} style={{ position: "absolute", width: 500, height: 500, borderRadius: "50%", background: "rgba(201,242,255,0.22)", filter: "blur(100px)", pointerEvents: "none", zIndex: 0, willChange: "transform, opacity", opacity: 0, transition: "opacity 0.6s ease" }} />
      <div ref={orbTrailRef} style={{ position: "absolute", width: 700, height: 700, borderRadius: "50%", background: "rgba(11,145,230,0.08)", filter: "blur(120px)", pointerEvents: "none", zIndex: 0, willChange: "transform, opacity", opacity: 0, transition: "opacity 1s ease" }} />

      {/* Content wrapper above orbs */}
      <div style={{ position: "relative", zIndex: 1 }}>

        {/* Reset Confirmation Modal */}
        {resetConfirm && (
          <ConfirmModal
            message={`Are you sure you want to delete all "${periodLabel}" data? This action cannot be undone.`}
            onConfirm={handleReset}
            onCancel={() => setResetConfirm(false)}
            confirming={resetting}
          />
        )}

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 32, flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <HoverButton variant="outline" onClick={onBack} style={{ height: 48, padding: "0 24px" }}>
              Back
            </HoverButton>
            <div>
              <div style={{ fontFamily: "SentientCustom, Georgia, serif", fontSize: 22, fontWeight: 600, lineHeight: 1.2, color: COLORS.black, marginBottom: 4 }}>
                Analytics Dashboard
              </div>
              <div style={{ fontSize: 13, color: COLORS.mutedText, fontWeight: 400, lineHeight: 1.35 }}>
                Showing data for: {periodLabel}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              style={{
                padding: "0 14px", height: 48, borderRadius: 14,
                border: `1px solid ${COLORS.borderGrey}`,
                background: "rgba(255,255,255,0.6)", backdropFilter: "blur(12px)",
                fontSize: 14, fontFamily: "Poppins, sans-serif", fontWeight: 500,
                color: COLORS.black, cursor: "pointer", transition: "all 200ms ease",
              }}
            >
              {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
            <HoverButton variant="primary" onClick={fetchAnalytics} disabled={loading}>
              {loading ? "Loading..." : "Refresh"}
            </HoverButton>
            <HoverButton variant="danger" onClick={() => setResetConfirm(true)}>
              Reset Data
            </HoverButton>
          </div>
        </div>

        {/* Error */}
        {error && (
          <GlassPanel borderRadius={12} style={{ marginBottom: 24 }}>
            <div style={{ padding: "14px 20px", color: COLORS.danger, fontSize: 13, fontWeight: 500, background: "rgba(217,45,32,0.06)" }}>
              {error}
            </div>
          </GlassPanel>
        )}

        {/* Loading */}
        {loading && !data && (
          <div style={{ textAlign: "center", padding: 60, color: COLORS.mutedText, fontSize: 13 }}>Loading analytics...</div>
        )}

        {/* Data */}
        {data && !selectedUser && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

            {/* Stat cards */}
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <StatCard label="Total Events" value={data.total_events} sub="All tracked workflows" color={COLORS.blue} />
              <StatCard label="Quotes Created" value={data.total_quotes_created} sub="Generated PDFs" color={COLORS.green} />
              <StatCard label="PDFs Uploaded" value={data.total_pdfs_uploaded} sub="Parsed uploads" />
            </div>

            {/* User Leaderboard — full width, prominent */}
            <Section title="Team Leaderboard" action={
              <div style={{ fontSize: 12, color: COLORS.mutedText }}>Click a user for details</div>
            }>
              <UserTable users={data.usage_by_user} onSelectUser={setSelectedUser} />
            </Section>

            {/* Two-column: insurance breakdown + manual changes */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
              <Section title="Usage by Insurance Type">
                <InsuranceBreakdown data={data.usage_by_insurance_type} />
              </Section>
              <Section title="Manual Changes Leaderboard">
                <ManualChangesLeaderboard data={manualChanges?.leaderboard} />
              </Section>
            </div>

            {/* Snapshot History */}
            <Section title="Snapshot History">
              <SnapshotHistory events={data.recent_events} getToken={getToken} onRefresh={fetchAnalytics} />
            </Section>
          </div>
        )}

        {/* User Detail View */}
        {data && selectedUser && (
          <UserDetailView
            userName={selectedUser}
            period={period}
            getToken={getToken}
            onBack={() => setSelectedUser(null)}
          />
        )}
      </div>
    </div>
  );
}
