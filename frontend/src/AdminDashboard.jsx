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

/* ── Hover Button (matches app button style) ─────────────────── */
function HoverButton({ children, onClick, disabled, variant = "primary", style: extraStyle }) {
  const [hovered, setHovered] = React.useState(false);

  const base = {
    borderRadius: 14,
    height: 48,
    padding: "0 24px",
    fontSize: 14,
    fontWeight: 600,
    fontFamily: "Poppins, sans-serif",
    cursor: disabled ? "not-allowed" : "pointer",
    transition: "all 200ms ease",
    border: "none",
    ...extraStyle,
  };

  const variants = {
    primary: {
      background: disabled ? "#DFE3E8" : COLORS.blue,
      color: disabled ? "#B0B7C3" : COLORS.white,
      border: `1px solid ${disabled ? "#DFE3E8" : COLORS.blue}`,
      boxShadow: hovered && !disabled ? `0 0 28px ${COLORS.hoverShadow}` : "0 0 0 rgba(0,0,0,0)",
    },
    outline: {
      background: COLORS.white,
      color: COLORS.black,
      border: `1px solid ${COLORS.borderGrey}`,
      boxShadow: hovered ? `0 0 24px ${COLORS.hoverShadow}` : "0 0 0 rgba(0,0,0,0)",
    },
    danger: {
      background: COLORS.dangerSoft,
      color: COLORS.danger,
      border: `1px solid ${COLORS.dangerBorder}`,
      boxShadow: hovered ? `0 0 20px rgba(217,45,32,0.12)` : "0 0 0 rgba(0,0,0,0)",
    },
    dangerConfirm: {
      background: COLORS.danger,
      color: COLORS.white,
      border: `1px solid ${COLORS.danger}`,
      boxShadow: hovered ? `0 0 20px rgba(217,45,32,0.2)` : "0 0 0 rgba(0,0,0,0)",
    },
    ghost: {
      background: COLORS.lightGrey,
      color: COLORS.mutedText,
      border: `1px solid ${COLORS.lightGrey}`,
      boxShadow: hovered ? `0 0 16px ${COLORS.hoverShadow}` : "0 0 0 rgba(0,0,0,0)",
    },
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => { if (!disabled) setHovered(true); }}
      onMouseLeave={() => setHovered(false)}
      style={{ ...base, ...variants[variant] }}
    >
      {children}
    </button>
  );
}

/* ── Stat Card ───────────────────────────────────────────────── */
function StatCard({ label, value, sub, color }) {
  return (
    <div style={{
      background: COLORS.white, borderRadius: 16, padding: "24px 28px",
      border: `1px solid ${COLORS.borderGrey}`, flex: "1 1 200px", minWidth: 170,
    }}>
      <div style={{ fontSize: 11, color: COLORS.mutedText, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 32, fontWeight: 700, color: color || COLORS.black, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 13, color: COLORS.mutedText, fontWeight: 400, marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

/* ── Insurance type bar chart ────────────────────────────────── */
function InsuranceBreakdown({ data }) {
  if (!data || Object.keys(data).length === 0) return <div style={{ color: COLORS.mutedText, fontSize: 13, fontWeight: 400 }}>No data yet</div>;
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
            <div style={{ height: 8, borderRadius: 4, background: COLORS.lightGrey, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${pct}%`, borderRadius: 4, background: typeColors[type] || COLORS.blue, transition: "width 0.4s ease" }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Per-user summary table ──────────────────────────────────── */
function UserTable({ users }) {
  if (!users || users.length === 0) return <div style={{ color: COLORS.mutedText, fontSize: 13, fontWeight: 400 }}>No user activity yet</div>;
  const th = { padding: "10px 12px", color: COLORS.mutedText, fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" };
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, fontFamily: "Poppins, sans-serif" }}>
        <thead>
          <tr style={{ borderBottom: `2px solid ${COLORS.borderGrey}` }}>
            <th style={{ ...th, textAlign: "left" }}>User</th>
            <th style={{ ...th, textAlign: "right" }}>Total Events</th>
            <th style={{ ...th, textAlign: "right" }}>Quotes Created</th>
            <th style={{ ...th, textAlign: "right" }}>PDFs Uploaded</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u, i) => (
            <tr key={u.user_name} style={{ borderBottom: `1px solid ${COLORS.lightGrey}`, background: i % 2 === 0 ? "transparent" : COLORS.lightGrey }}>
              <td style={{ padding: "10px 12px", fontWeight: 500 }}>{u.user_name}</td>
              <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700, color: COLORS.blue }}>{u.total}</td>
              <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 400 }}>{u.quotes_created}</td>
              <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 400 }}>{u.pdfs_uploaded}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Recent events log (detailed) ────────────────────────────── */
function EventLog({ events }) {
  if (!events || events.length === 0) return <div style={{ color: COLORS.mutedText, fontSize: 13, fontWeight: 400 }}>No events yet</div>;
  const th = { padding: "8px 10px", color: COLORS.mutedText, fontWeight: 600, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap" };
  const td = { padding: "8px 10px", fontSize: 12, fontWeight: 400, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "Poppins, sans-serif" }}>
        <thead>
          <tr style={{ borderBottom: `2px solid ${COLORS.borderGrey}` }}>
            <th style={{ ...th, textAlign: "left" }}>Date</th>
            <th style={{ ...th, textAlign: "left" }}>User</th>
            <th style={{ ...th, textAlign: "left" }}>Insurance</th>
            <th style={{ ...th, textAlign: "left" }}>Advisor</th>
            <th style={{ ...th, textAlign: "left" }}>Uploaded PDF</th>
            <th style={{ ...th, textAlign: "left" }}>Manual Changes</th>
            <th style={{ ...th, textAlign: "center" }}>Quote Created</th>
            <th style={{ ...th, textAlign: "left" }}>Generated PDF</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e, i) => (
            <tr key={e.id} style={{ borderBottom: `1px solid ${COLORS.lightGrey}`, background: i % 2 === 0 ? "transparent" : COLORS.lightGrey }}>
              <td style={td}>{new Date(e.created_at).toLocaleString()}</td>
              <td style={{ ...td, fontWeight: 500 }}>{e.user_name}</td>
              <td style={{ ...td, textTransform: "capitalize" }}>{e.insurance_type}</td>
              <td style={td}>{e.advisor || "—"}</td>
              <td style={td} title={e.uploaded_pdf}>{e.uploaded_pdf || "—"}</td>
              <td style={td} title={e.manually_changed_fields}>{e.manually_changed_fields || "—"}</td>
              <td style={{ ...td, textAlign: "center" }}>
                <span style={{
                  display: "inline-block", padding: "2px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600,
                  background: e.created_quote ? COLORS.greenSoft : COLORS.dangerSoft,
                  color: e.created_quote ? COLORS.green : COLORS.danger,
                  border: `1px solid ${e.created_quote ? COLORS.greenBorder : COLORS.dangerBorder}`,
                }}>
                  {e.created_quote ? "Yes" : "No"}
                </span>
              </td>
              <td style={td} title={e.generated_pdf}>{e.generated_pdf || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Main Dashboard ──────────────────────────────────────────── */
export default function AdminDashboard({ onBack }) {
  const { getToken } = useAuth();
  const [period, setPeriod] = React.useState("month");
  const [data, setData] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [resetConfirm, setResetConfirm] = React.useState(false);
  const [resetting, setResetting] = React.useState(false);

  const fetchAnalytics = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const token = await getToken();
      const resp = await fetch(`${API_BASE_URL}/api/admin/analytics/summary?period=${period}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (resp.status === 403) {
        setError("You don't have admin access. Set role: 'admin' in your Clerk user's public metadata.");
        return;
      }
      if (!resp.ok) {
        const detail = await resp.json().catch(() => ({}));
        throw new Error(detail?.detail || `HTTP ${resp.status}`);
      }
      setData(await resp.json());
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
    <div style={{ minHeight: "100vh", background: COLORS.pageBg, fontFamily: "Poppins, sans-serif", padding: "32px 40px" }}>

      {/* ── Header ─────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 32, flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <HoverButton variant="outline" onClick={onBack} style={{ height: 40, padding: "0 18px" }}>
            Back
          </HoverButton>
          <div>
            <div style={{
              fontFamily: "Poppins, sans-serif",
              fontSize: 20,
              fontWeight: 600,
              lineHeight: 1.2,
              letterSpacing: "0",
              color: COLORS.black,
              marginBottom: 4,
            }}>
              Analytics Dashboard
            </div>
            <div style={{ fontSize: 13, color: COLORS.mutedText, fontWeight: 400, lineHeight: 1.35 }}>
              Showing data for: {periodLabel}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {/* Period selector */}
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            style={{
              padding: "0 14px",
              height: 48,
              borderRadius: 14,
              border: `1px solid ${COLORS.borderGrey}`,
              background: COLORS.white,
              fontSize: 14,
              fontFamily: "Poppins, sans-serif",
              fontWeight: 500,
              color: COLORS.black,
              cursor: "pointer",
              transition: "all 200ms ease",
            }}
          >
            {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>

          <HoverButton variant="primary" onClick={fetchAnalytics} disabled={loading}>
            {loading ? "Loading..." : "Refresh"}
          </HoverButton>

          {!resetConfirm ? (
            <HoverButton variant="danger" onClick={() => setResetConfirm(true)}>
              Reset Data
            </HoverButton>
          ) : (
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 13, color: COLORS.danger, fontWeight: 600 }}>
                Delete {periodLabel} data?
              </span>
              <HoverButton variant="dangerConfirm" onClick={handleReset} disabled={resetting} style={{ height: 40, padding: "0 16px" }}>
                {resetting ? "..." : "Confirm"}
              </HoverButton>
              <HoverButton variant="ghost" onClick={() => setResetConfirm(false)} style={{ height: 40, padding: "0 16px" }}>
                Cancel
              </HoverButton>
            </div>
          )}
        </div>
      </div>

      {/* ── Error ──────────────────────────────────────────── */}
      {error && (
        <div style={{
          background: COLORS.dangerSoft, border: `1px solid ${COLORS.dangerBorder}`, borderRadius: 12,
          padding: "14px 20px", color: COLORS.danger, fontSize: 13, fontWeight: 500, marginBottom: 24,
        }}>{error}</div>
      )}

      {/* ── Loading ────────────────────────────────────────── */}
      {loading && !data && (
        <div style={{ textAlign: "center", padding: 60, color: COLORS.mutedText, fontSize: 13, fontWeight: 400 }}>Loading analytics...</div>
      )}

      {/* ── Data ───────────────────────────────────────────── */}
      {data && (
        <>
          {/* Stat cards */}
          <div style={{ display: "flex", gap: 16, marginBottom: 28, flexWrap: "wrap" }}>
            <StatCard label="Total Events" value={data.total_events} sub="All tracked workflows" color={COLORS.blue} />
            <StatCard label="Quotes Created" value={data.total_quotes_created} sub="Generated PDFs" color={COLORS.green} />
            <StatCard label="PDFs Uploaded" value={data.total_pdfs_uploaded} sub="Parsed uploads" />
          </div>

          {/* Two-column: insurance breakdown + user table */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 28 }}>
            <div style={{ background: COLORS.white, borderRadius: 16, padding: "24px 28px", border: `1px solid ${COLORS.borderGrey}` }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.black, marginBottom: 18 }}>Usage by Insurance Type</div>
              <InsuranceBreakdown data={data.usage_by_insurance_type} />
            </div>
            <div style={{ background: COLORS.white, borderRadius: 16, padding: "24px 28px", border: `1px solid ${COLORS.borderGrey}` }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.black, marginBottom: 18 }}>Usage by User</div>
              <UserTable users={data.usage_by_user} />
            </div>
          </div>

          {/* Full-width event log */}
          <div style={{ background: COLORS.white, borderRadius: 16, padding: "24px 28px", border: `1px solid ${COLORS.borderGrey}` }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.black, marginBottom: 18 }}>
              Recent Events (Last 100)
            </div>
            <EventLog events={data.recent_events} />
          </div>
        </>
      )}
    </div>
  );
}
