import React from "react";
import { useAuth } from "@clerk/clerk-react";
import { useNavigate } from "react-router-dom";
import COLORS, { INSURANCE_COLORS } from "./colors";
import ChatPanel from "./ChatPanel";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

const PERIODS = [
  { value: "week", label: "Last Week" },
  { value: "month", label: "Last Month" },
  { value: "6months", label: "Last 6 Months" },
  { value: "year", label: "Last Year" },
  { value: "all", label: "All Time" },
];

/* ── Glass Panel (matches right panel from QuotifyHome) ──────── */
/* Replaced runtime backdropFilter: blur(48px) with a static frosted-glass
   background. The old blur was re-computed every scroll frame because
   fixed-position animated orbs behind the panels kept changing the
   backdrop content, causing content inside cards to flash/reload.    */
function GlassPanel({ children, borderRadius = 24, style = {} }) {
  return (
    <div style={{
      position: "relative", borderRadius, overflow: "hidden", border: "none",
      background: "rgba(255,255,255,0.88)",
      boxShadow: "0 1px 3px rgba(0,0,0,0.04), 0 4px 24px rgba(23,101,212,0.04)",
      ...style,
    }}>
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
/* ── Blur Aura — frosted halo behind fixed header items ──────── */
/* Single backdrop-filter layer with a soft radial mask that fades
   outward. Safe to use real blur here because the nav is position:
   fixed — its backdrop only recomputes on orb movement (mouse),
   not on scroll like the GlassPanels were.                        */
function BlurAura({ children, spread = 60, blur = 22, style = {} }) {
  const mask = `radial-gradient(ellipse at center, black 40%, transparent 72%)`;
  return (
    <div style={{ position: "relative", ...style }}>
      <div style={{
        position: "absolute",
        top: -spread, left: -spread, right: -spread, bottom: -spread,
        borderRadius: 14 + spread,
        backdropFilter: `blur(${blur}px)`,
        WebkitBackdropFilter: `blur(${blur}px)`,
        maskImage: mask,
        WebkitMaskImage: mask,
        pointerEvents: "none",
        zIndex: 0,
      }} />
      <div style={{ position: "relative", zIndex: 1 }}>{children}</div>
    </div>
  );
}

function HoverButton({ children, onClick, disabled, variant = "primary", style: extraStyle }) {
  const [hovered, setHovered] = React.useState(false);
  const base = {
    borderRadius: 14, height: 48, padding: "0 24px", fontSize: 14, fontWeight: 600,
    fontFamily: "Poppins, sans-serif", cursor: disabled ? "not-allowed" : "pointer",
    transition: "all 200ms ease", border: "none", ...extraStyle,
  };
  const variants = {
    primary: {
      background: disabled ? COLORS.disabledBg : COLORS.blue, color: disabled ? COLORS.disabledText : COLORS.white,
      border: `1px solid ${disabled ? COLORS.disabledBg : COLORS.blue}`,
      boxShadow: hovered && !disabled ? `0 0 28px ${COLORS.hoverShadow}` : "0 0 0 rgba(0,0,0,0)",
    },
    outline: {
      background: "rgba(255,255,255,0.5)", color: COLORS.black,
      border: `1px solid ${hovered ? COLORS.blue : "rgba(220,230,245,0.6)"}`,
      boxShadow: hovered ? `0 0 24px ${COLORS.hoverShadow}` : "none",
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
function ConfirmModal({ message, onConfirm, onCancel, confirming, confirmLabel = "Delete", confirmingLabel = "Deleting...", confirmVariant = "dangerConfirm" }) {
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
            <HoverButton variant={confirmVariant} onClick={onConfirm} disabled={confirming} style={{ height: 40, padding: "0 20px" }}>
              {confirming ? confirmingLabel : confirmLabel}
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
function Section({ title, children, action = null, expandable = false, defaultExpanded = false }) {
  const [expanded, setExpanded] = React.useState(defaultExpanded);
  return (
    <GlassPanel>
      <div style={{ padding: "24px 28px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, marginBottom: 18 }}>
          <div style={{ fontFamily: "SentientCustom, Georgia, serif", fontSize: 20, lineHeight: 1, letterSpacing: "-0.02em", color: COLORS.black }}>{title}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {action}
            {expandable && (
              <button
                onClick={() => setExpanded(!expanded)}
                style={{
                  background: "none", border: `1px solid ${COLORS.borderGrey}`, borderRadius: "50%",
                  width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 14, color: COLORS.mutedText,
                  cursor: "pointer", transition: "all 200ms ease",
                  padding: 0, lineHeight: 1,
                  transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = COLORS.blue; e.currentTarget.style.color = COLORS.blue; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = COLORS.borderGrey; e.currentTarget.style.color = COLORS.mutedText; }}
                title={expanded ? "Show less" : "Show more"}
              >
                &#9662;
              </button>
            )}
          </div>
        </div>
        {typeof children === "function" ? children(expanded) : children}
      </div>
    </GlassPanel>
  );
}

/* ── Insurance type bar chart ────────────────────────────────── */
function InsuranceBreakdown({ data, limit = 15 }) {
  if (!data || Object.keys(data).length === 0) return <div style={{ color: COLORS.mutedText, fontSize: 13 }}>No data yet</div>;
  const total = Object.values(data).reduce((a, b) => a + b, 0);
  const typeColors = INSURANCE_COLORS;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {Object.entries(data).sort(([, a], [, b]) => b - a).slice(0, limit).map(([type, count]) => {
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
function ManualChangesLeaderboard({ data, limit = 15 }) {
  if (!data || data.length === 0) return <div style={{ color: COLORS.mutedText, fontSize: 13 }}>No manual changes recorded</div>;
  const typeColors = INSURANCE_COLORS;
  const maxCount = data[0]?.count || 1;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {data.slice(0, limit).map((item, i) => (
        <div key={`${item.field}-${item.insurance_type}`}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
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
          <div style={{ height: 8, borderRadius: 4, background: "rgba(0,0,0,0.04)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${(item.count / maxCount) * 100}%`, borderRadius: 4, background: typeColors[item.insurance_type] || COLORS.blue, transition: "width 0.4s ease" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Clickable User Row ──────────────────────────────────────── */
function RoleBadge({ role }) {
  const isAdmin = role === "admin";
  return (
    <span style={{
      display: "inline-block", padding: "3px 10px", borderRadius: 8, fontSize: 11, fontWeight: 600,
      textTransform: "capitalize",
      background: isAdmin ? "rgba(23,101,212,0.08)" : "rgba(31,157,85,0.08)",
      color: isAdmin ? COLORS.blue : COLORS.green,
      border: `1px solid ${isAdmin ? "rgba(23,101,212,0.15)" : "rgba(31,157,85,0.15)"}`,
    }}>{role || "advisor"}</span>
  );
}

const RANK_COLORS = {
  1: "linear-gradient(135deg, #8B6914, #D4AF37, #7A5521, #E0C252, #6B4A1A)",
  2: "linear-gradient(135deg, #5A5A5A, #B8B8B8, #4A4A4A, #C4C4C4, #3D3D3D)",
  3: "linear-gradient(135deg, #7A4B1A, #CD8D42, #6A3D12, #D4994A, #5C3D18)",
};

function UserRow({ user, role, onClick, rank, imageUrl }) {
  const [hovered, setHovered] = React.useState(false);
  const rankGradient = RANK_COLORS[rank];
  const nameColor = rankGradient
    ? { backgroundImage: rankGradient, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }
    : { color: COLORS.black };

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
      <td style={{ padding: "12px 14px", fontWeight: 600 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {imageUrl ? (
            <img src={imageUrl} alt="" style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
          ) : (
            <div style={{
              width: 32, height: 32, borderRadius: "50%",
              background: `linear-gradient(135deg, ${COLORS.blue}, #0B91E6)`,
              display: "flex", alignItems: "center", justifyContent: "center",
              color: COLORS.white, fontSize: 13, fontWeight: 700, flexShrink: 0,
            }}>
              {user.user_name.charAt(0).toUpperCase()}
            </div>
          )}
          <span style={{ fontWeight: 700, ...nameColor }}>{user.user_name}</span>
        </div>
      </td>
      <td style={{ padding: "12px 14px", textAlign: "center" }}><RoleBadge role={role} /></td>
      <td style={{ padding: "12px 14px", textAlign: "right", fontWeight: 700, color: COLORS.black }}>{user.total}</td>
      <td style={{ padding: "12px 14px", textAlign: "right" }}>{user.quotes_created}</td>
      <td style={{ padding: "12px 14px", textAlign: "right" }}>{user.pdfs_uploaded}</td>
      <td style={{ padding: "12px 14px", textAlign: "right", fontWeight: 600, color: "#0B91E6" }}>{user.days_active || 0}</td>
      <td style={{ padding: "12px 14px", textAlign: "right", color: COLORS.mutedText }}>
        <span style={{ fontSize: 16 }}>&#8250;</span>
      </td>
    </tr>
  );
}

function UserTable({ users, clerkUsers, onSelectUser, limit = 15 }) {
  // Merge analytics users with all Clerk users so everyone appears
  const analyticsMap = {};
  for (const u of (users || [])) {
    analyticsMap[u.user_name] = u;
  }
  // Build a deduplicated set of Clerk display names (skip first-name-only fallback keys)
  const clerkDisplayNames = new Set();
  for (const [name, info] of Object.entries(clerkUsers)) {
    // Only include keys that look like full names (have a space) or match exactly a clerk user with that single name
    if (name.includes(" ") || !Object.keys(clerkUsers).some((k) => k !== name && k.startsWith(name + " "))) {
      clerkDisplayNames.add(name);
    }
  }
  // Add any Clerk user not already in analytics
  for (const name of clerkDisplayNames) {
    if (!analyticsMap[name]) {
      analyticsMap[name] = { user_name: name, total: 0, quotes_created: 0, pdfs_uploaded: 0, days_active: 0 };
    }
  }
  const allUsers = Object.values(analyticsMap).sort((a, b) => b.total - a.total);

  const th = { padding: "10px 14px", color: COLORS.mutedText, fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" };
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, fontFamily: "Poppins, sans-serif" }}>
        <thead>
          <tr style={{ borderBottom: `2px solid rgba(180,200,230,0.3)` }}>
            <th style={{ ...th, textAlign: "left" }}>User</th>
            <th style={{ ...th, textAlign: "center" }}>Role</th>
            <th style={{ ...th, textAlign: "right" }}>Total</th>
            <th style={{ ...th, textAlign: "right" }}>Quotes</th>
            <th style={{ ...th, textAlign: "right" }}>Uploads</th>
            <th style={{ ...th, textAlign: "right" }}>Days Active</th>
            <th style={{ ...th, textAlign: "right", width: 30 }}></th>
          </tr>
        </thead>
        <tbody>
          {allUsers.slice(0, limit).map((u, idx) => (
            <UserRow
              key={u.user_name}
              user={u}
              role={clerkUsers[u.user_name]?.role || "advisor"}
              onClick={() => onSelectUser(u.user_name)}
              rank={idx + 1}
              imageUrl={clerkUsers[u.user_name]?.image_url}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── User Detail View ────────────────────────────────────────── */
function DaysActiveCard({ daysActive, activeDates }) {
  const [expanded, setExpanded] = React.useState(false);
  const [hovered, setHovered] = React.useState(false);
  return (
    <GlassPanel borderRadius={18} style={{ flex: "1 1 200px", minWidth: 170, transition: "all 200ms ease", boxShadow: hovered ? `0 8px 32px rgba(23,101,212,0.10)` : "none" }}>
      <div
        style={{ padding: "24px 28px", cursor: "pointer" }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => setExpanded(!expanded)}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 11, color: COLORS.mutedText, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>
              Days Active
            </div>
            <div style={{ fontSize: 32, fontWeight: 700, color: "#0B91E6", lineHeight: 1.1 }}>{daysActive}</div>
          </div>
          <div style={{ fontSize: 18, color: COLORS.mutedText, transition: "transform 200ms ease", transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}>
            &#9662;
          </div>
        </div>
        {expanded && activeDates && activeDates.length > 0 && (
          <div style={{ marginTop: 14, borderTop: `1px solid rgba(180,200,230,0.3)`, paddingTop: 12, display: "flex", flexWrap: "wrap", gap: 6 }}>
            {activeDates.map((date) => {
              const d = new Date(date + "T00:00:00");
              return (
                <span key={date} style={{
                  fontSize: 11, fontWeight: 500, padding: "4px 10px", borderRadius: 8,
                  background: "rgba(23,101,212,0.06)", color: COLORS.blue,
                  border: "1px solid rgba(23,101,212,0.12)",
                }}>
                  {d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </GlassPanel>
  );
}

function RoleToggle({ clerkUserId, currentRole, getToken, onRoleChanged }) {
  const [role, setRole] = React.useState(currentRole || "advisor");
  const [saving, setSaving] = React.useState(false);
  const [confirmTarget, setConfirmTarget] = React.useState(null);

  const handleChange = (newRole) => {
    if (newRole === role) return;
    setConfirmTarget(newRole);
  };

  const confirmChange = async () => {
    if (!confirmTarget || !clerkUserId) return;
    setSaving(true);
    try {
      const token = await getToken();
      const resp = await fetch(`${API_BASE_URL}/api/admin/users/${clerkUserId}/role`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ role: confirmTarget }),
      });
      if (resp.ok) {
        setRole(confirmTarget);
        if (onRoleChanged) onRoleChanged(confirmTarget);
      }
    } catch {}
    setSaving(false);
    setConfirmTarget(null);
  };

  return (
    <>
      {confirmTarget && (
        <ConfirmModal
          message={`Change this user's role to "${confirmTarget}"? They will ${confirmTarget === "admin" ? "gain" : "lose"} admin access.`}
          onConfirm={confirmChange}
          onCancel={() => setConfirmTarget(null)}
          confirming={saving}
          confirmLabel="Confirm"
          confirmingLabel="Saving..."
          confirmVariant="primary"
        />
      )}
      <div style={{ display: "flex", gap: 6 }}>
        {["advisor", "admin"].map((r) => {
          const active = role === r;
          return (
            <button
              key={r}
              onClick={() => handleChange(r)}
              disabled={saving}
              style={{
                padding: "6px 16px", borderRadius: 10, fontSize: 13, fontWeight: 600,
                textTransform: "capitalize", cursor: saving ? "not-allowed" : "pointer",
                transition: "all 200ms ease", border: "none",
                background: active ? (r === "admin" ? COLORS.blue : COLORS.green) : "rgba(0,0,0,0.04)",
                color: active ? COLORS.white : COLORS.mutedText,
              }}
            >{r}</button>
          );
        })}
      </div>
    </>
  );
}

function UserDetailView({ userName, period, getToken, onBack, clerkUsers, onRefresh, isAdmin }) {
  const [data, setData] = React.useState(null);
  const [loading, setLoading] = React.useState(true);

  const clerkUser = clerkUsers[userName] || null;

  React.useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const token = await getToken();
        // Admins use the admin endpoint; advisors use the self-service endpoint
        const url = isAdmin
          ? `${API_BASE_URL}/api/admin/analytics/user/${encodeURIComponent(userName)}?period=${period}`
          : `${API_BASE_URL}/api/analytics/me?user_name=${encodeURIComponent(userName)}&period=${period}`;
        const resp = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (resp.ok) setData(await resp.json());
      } catch {}
      setLoading(false);
    })();
  }, [userName, period, getToken, isAdmin]);

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: COLORS.mutedText, fontSize: 13 }}>Loading user data...</div>;
  if (!data) return <div style={{ padding: 40, textAlign: "center", color: COLORS.mutedText, fontSize: 13 }}>Failed to load user data.</div>;

  const typeColors = INSURANCE_COLORS;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Profile header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {clerkUser?.image_url ? (
          <img src={clerkUser.image_url} alt="" style={{ width: 40, height: 40, borderRadius: "50%", objectFit: "cover" }} />
        ) : (
          <div style={{
            width: 40, height: 40, borderRadius: "50%",
            background: `linear-gradient(135deg, ${COLORS.blue}, #0B91E6)`,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: COLORS.white, fontSize: 16, fontWeight: 700,
          }}>
            {userName.charAt(0).toUpperCase()}
          </div>
        )}
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: COLORS.black }}>{userName}</div>
          {clerkUser?.email && <div style={{ fontSize: 12, color: COLORS.mutedText }}>{clerkUser.email}</div>}
        </div>
      </div>

      {/* Role toggle for admins, static badge for advisors */}
      {isAdmin && clerkUser?.id ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <RoleToggle
            clerkUserId={clerkUser.id}
            currentRole={clerkUser.role}
            getToken={getToken}
            onRoleChanged={() => onRefresh()}
          />
        </div>
      ) : !isAdmin && (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <RoleBadge role="advisor" />
        </div>
      )}

      {/* User stat cards */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        <StatCard label="Total Events" value={data.total_events} color={COLORS.blue} />
        <StatCard label="Quotes Created" value={data.quotes_created} color={COLORS.green} />
        <StatCard label="PDFs Uploaded" value={data.pdfs_uploaded} />
        <DaysActiveCard daysActive={data.days_active || 0} activeDates={data.active_dates || []} />
      </div>

      {/* Insurance breakdown */}
      <Section title="Insurance Type Breakdown">
        <InsuranceBreakdown data={data.by_insurance_type} />
      </Section>

      {/* User snapshot history */}
      <Section title="Snapshot History">
        <UserSnapshotHistory events={data.recent_events} getToken={getToken} />
      </Section>
    </div>
  );
}

/* ── User Snapshot History (detail view — with filters + PDF downloads, no delete) ── */
function UserSnapshotHistory({ events, getToken }) {
  const [filterInsurance, setFilterInsurance] = React.useState("");
  const [filterDate, setFilterDate] = React.useState("");

  const handlePdfDownload = async (fileName, type) => {
    if (!fileName || fileName === "—") return;
    try {
      const token = await getToken();
      const listResp = await fetch(`${API_BASE_URL}/api/pdfs?doc_type=${type}&limit=200`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!listResp.ok) return;
      const listData = await listResp.json();
      const doc = listData.documents?.find((d) =>
        d.file_name === fileName || fileName.startsWith(d.file_name?.split(".pdf")[0])
      );
      if (!doc) return;
      const pdfResp = await fetch(`${API_BASE_URL}/api/pdfs/${doc.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!pdfResp.ok) return;
      const blob = await pdfResp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.file_name || fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {}
  };

  if (!events || events.length === 0) return <div style={{ color: COLORS.mutedText, fontSize: 13 }}>No events yet</div>;

  const uniqueInsurance = [...new Set(events.map((e) => e.insurance_type).filter(Boolean))].sort();
  const uniqueDates = [...new Set(events.map((e) => new Date(e.created_at).toLocaleDateString()))];

  const filtered = events.filter((e) => {
    if (filterInsurance && e.insurance_type !== filterInsurance) return false;
    if (filterDate && new Date(e.created_at).toLocaleDateString() !== filterDate) return false;
    return true;
  });

  const filterSelect = {
    padding: "4px 10px", height: 32, borderRadius: 8,
    border: `1px solid ${COLORS.borderGrey}`,
    background: "rgba(255,255,255,0.88)",
    fontSize: 11, fontFamily: "Poppins, sans-serif", fontWeight: 500,
    color: COLORS.black, cursor: "pointer",
  };
  const th = { padding: "8px 10px", color: COLORS.mutedText, fontWeight: 600, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em", textAlign: "left", whiteSpace: "nowrap" };
  const td = { padding: "8px 10px", fontSize: 12, maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
  const typeColors = INSURANCE_COLORS;

  return (
    <>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginBottom: 12, flexWrap: "wrap" }}>
        <select value={filterInsurance} onChange={(e) => setFilterInsurance(e.target.value)} style={filterSelect}>
          <option value="">All Insurance</option>
          {uniqueInsurance.map((t) => <option key={t} value={t} style={{ textTransform: "capitalize" }}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
        </select>
        <select value={filterDate} onChange={(e) => setFilterDate(e.target.value)} style={filterSelect}>
          <option value="">All Dates</option>
          {uniqueDates.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: "Poppins, sans-serif" }}>
          <thead>
            <tr style={{ borderBottom: `2px solid rgba(180,200,230,0.3)` }}>
              {["Date", "Insurance", "Advisor", "Uploaded PDF", "Manual Changes", "Quote", "Generated PDF"].map((h) => (
                <th key={h} style={th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: 20, textAlign: "center", color: COLORS.mutedText, fontSize: 12 }}>No events match the selected filters</td></tr>
            ) : filtered.map((e) => (
              <HoverRow key={e.id}>
                <td style={td}>{new Date(e.created_at).toLocaleString()}</td>
                <td style={td}>
                  <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 10, fontWeight: 600, textTransform: "capitalize", background: `${typeColors[e.insurance_type] || COLORS.blue}15`, color: typeColors[e.insurance_type] || COLORS.blue }}>{e.insurance_type}</span>
                </td>
                <td style={td}>{e.advisor || "—"}</td>
                <td style={td} title={e.uploaded_pdf}>
                  {e.uploaded_pdf ? (
                    <span onClick={() => handlePdfDownload(e.uploaded_pdf, "uploaded")} style={{ color: COLORS.blue, cursor: "pointer", textDecoration: "underline", textDecorationColor: "rgba(23,101,212,0.3)" }}>{e.uploaded_pdf}</span>
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
                    <span onClick={() => handlePdfDownload(e.generated_pdf, "generated")} style={{ color: COLORS.blue, cursor: "pointer", textDecoration: "underline", textDecorationColor: "rgba(23,101,212,0.3)" }}>{e.generated_pdf}</span>
                  ) : "—"}
                </td>
              </HoverRow>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ── Snapshot History (Event Log with delete) ────────────────── */
function SnapshotHistory({ events, getToken, onRefresh, limit = 30 }) {
  const [deleteTarget, setDeleteTarget] = React.useState(null);
  const [deleting, setDeleting] = React.useState(false);
  const [filterUser, setFilterUser] = React.useState("");
  const [filterInsurance, setFilterInsurance] = React.useState("");
  const [filterDate, setFilterDate] = React.useState("");

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
      const listResp = await fetch(`${API_BASE_URL}/api/pdfs?doc_type=${type}&limit=200`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!listResp.ok) return;
      const listData = await listResp.json();
      const doc = listData.documents?.find((d) =>
        d.file_name === fileName || fileName.startsWith(d.file_name?.split(".pdf")[0])
      );
      if (!doc) return;
      const pdfResp = await fetch(`${API_BASE_URL}/api/pdfs/${doc.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!pdfResp.ok) return;
      const blob = await pdfResp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.file_name || fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {}
  };

  if (!events || events.length === 0) return <div style={{ color: COLORS.mutedText, fontSize: 13 }}>No events yet</div>;

  // Derive unique values for filter dropdowns
  const uniqueUsers = [...new Set(events.map((e) => e.user_name).filter(Boolean))].sort();
  const uniqueInsurance = [...new Set(events.map((e) => e.insurance_type).filter(Boolean))].sort();
  const uniqueDates = [...new Set(events.map((e) => new Date(e.created_at).toLocaleDateString()))];

  // Apply filters and limit
  const filtered = events.filter((e) => {
    if (filterUser && e.user_name !== filterUser) return false;
    if (filterInsurance && e.insurance_type !== filterInsurance) return false;
    if (filterDate && new Date(e.created_at).toLocaleDateString() !== filterDate) return false;
    return true;
  });

  const filterSelect = {
    padding: "4px 10px", height: 32, borderRadius: 8,
    border: `1px solid ${COLORS.borderGrey}`,
    background: "rgba(255,255,255,0.88)",
    fontSize: 11, fontFamily: "Poppins, sans-serif", fontWeight: 500,
    color: COLORS.black, cursor: "pointer",
  };

  const th = { padding: "10px 14px", color: COLORS.mutedText, fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap", textAlign: "left" };
  const td = { padding: "12px 14px", fontSize: 13, fontWeight: 400, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
  const typeColors = INSURANCE_COLORS;

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

      {/* Sub-filters row */}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginBottom: 12, flexWrap: "wrap" }}>
        <select value={filterUser} onChange={(e) => setFilterUser(e.target.value)} style={filterSelect}>
          <option value="">All Users</option>
          {uniqueUsers.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
        <select value={filterInsurance} onChange={(e) => setFilterInsurance(e.target.value)} style={filterSelect}>
          <option value="">All Insurance</option>
          {uniqueInsurance.map((t) => <option key={t} value={t} style={{ textTransform: "capitalize" }}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
        </select>
        <select value={filterDate} onChange={(e) => setFilterDate(e.target.value)} style={filterSelect}>
          <option value="">All Dates</option>
          {uniqueDates.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

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
            {filtered.length === 0 ? (
              <tr><td colSpan={9} style={{ padding: 20, textAlign: "center", color: COLORS.mutedText, fontSize: 12 }}>No events match the selected filters</td></tr>
            ) : filtered.slice(0, limit).map((e) => (
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
export default function AdminDashboard({ onBack, isAdmin, currentUserName, currentUserEmail, currentUserImageUrl }) {
  const { getToken } = useAuth();
  const [period, setPeriod] = React.useState("month");
  const [data, setData] = React.useState(null);
  const [manualChanges, setManualChanges] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [resetConfirm, setResetConfirm] = React.useState(false);
  const [resetting, setResetting] = React.useState(false);
  // Advisors go directly to their own page; admins start at the dashboard
  const [selectedUser, setSelectedUser] = React.useState(isAdmin ? null : currentUserName);
  const [clerkUsers, setClerkUsers] = React.useState({});  // keyed by display name -> { id, role }
  const navigate = useNavigate();

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

  // Lock body scroll while dashboard is mounted
  React.useEffect(() => {
    const prev = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.documentElement.style.height = "100%";
    document.body.style.overflow = "hidden";
    document.body.style.height = "100%";
    return () => {
      document.documentElement.style.overflow = "";
      document.documentElement.style.height = "";
      document.body.style.overflow = prev;
      document.body.style.height = "";
    };
  }, []);

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

      if (isAdmin) {
        // Admin: fetch full dashboard data
        const [summaryResp, changesResp, usersResp] = await Promise.all([
          fetch(`${API_BASE_URL}/api/admin/analytics/summary?period=${period}`, { headers: { Authorization: `Bearer ${token}` } }),
          fetch(`${API_BASE_URL}/api/admin/analytics/manual-changes?period=${period}`, { headers: { Authorization: `Bearer ${token}` } }),
          fetch(`${API_BASE_URL}/api/admin/users`, { headers: { Authorization: `Bearer ${token}` } }),
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
        if (usersResp.ok) {
          const usersData = await usersResp.json();
          const map = {};
          for (const u of usersData.users || []) {
            const displayName = `${u.first_name} ${u.last_name}`.trim();
            map[displayName] = { id: u.id, role: u.role, email: u.email, image_url: u.image_url || "" };
            if (u.first_name) map[u.first_name] = { id: u.id, role: u.role, email: u.email, image_url: u.image_url || "" };
          }
          setClerkUsers(map);
        }
      } else {
        // Advisor: just set a minimal data object so the page renders
        setData({ _advisorMode: true });
        // Populate clerkUsers with the advisor's own info so UserDetailView can display it
        if (currentUserName) {
          setClerkUsers((prev) => ({
            ...prev,
            [currentUserName]: {
              id: null,
              role: "advisor",
              email: currentUserEmail || "",
              image_url: currentUserImageUrl || "",
            },
          }));
        }
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [period, getToken, isAdmin]);

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
      className="dashScrollArea"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{
        height: "100vh",
        background: `linear-gradient(160deg, rgba(230,240,255,0.7) 0%, ${COLORS.pageBg} 30%, rgba(220,235,255,0.5) 60%, ${COLORS.pageBg} 80%, rgba(200,225,255,0.4) 100%)`,
        fontFamily: "Poppins, sans-serif",
        position: "relative",
        overflow: "auto",
      }}
    >
      {/* Animated orbs */}
      <div ref={orbPrimaryRef} style={{ position: "fixed", width: 400, height: 400, borderRadius: "50%", background: "rgba(23,101,212,0.14)", filter: "blur(80px)", pointerEvents: "none", zIndex: 0, willChange: "transform, opacity", opacity: 0, transition: "opacity 0.4s ease" }} />
      <div ref={orbCyanRef} style={{ position: "fixed", width: 500, height: 500, borderRadius: "50%", background: "rgba(201,242,255,0.22)", filter: "blur(100px)", pointerEvents: "none", zIndex: 0, willChange: "transform, opacity", opacity: 0, transition: "opacity 0.6s ease" }} />
      <div ref={orbTrailRef} style={{ position: "fixed", width: 700, height: 700, borderRadius: "50%", background: "rgba(11,145,230,0.08)", filter: "blur(120px)", pointerEvents: "none", zIndex: 0, willChange: "transform, opacity", opacity: 0, transition: "opacity 1s ease" }} />

      {/* Reset Confirmation Modal */}
      {resetConfirm && (
        <ConfirmModal
          message={`Are you sure you want to delete all "${periodLabel}" data? This action cannot be undone.`}
          onConfirm={handleReset}
          onCancel={() => setResetConfirm(false)}
          confirming={resetting}
        />
      )}

      {/* Fixed header — overlaps scrollable content so BlurAura can blur it */}
      <div style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 20,
        padding: "18px 28px 14px 28px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        flexWrap: "wrap", gap: 12,
        pointerEvents: "none",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, pointerEvents: "auto" }}>
          <BlurAura>
            <HoverButton
              variant="outline"
              onClick={isAdmin && selectedUser ? () => setSelectedUser(null) : onBack}
              style={{ height: 44, padding: "0 22px" }}
            >
              {isAdmin && selectedUser ? "Back" : "Close"}
            </HoverButton>
          </BlurAura>
          <BlurAura>
            <div style={{ padding: "4px 8px" }}>
              <div style={{ fontFamily: "SentientCustom, Georgia, serif", fontSize: 20, fontWeight: 600, lineHeight: 1.2, color: COLORS.black, marginBottom: 2 }}>
                {isAdmin ? "Analytics Dashboard" : "My Activity"}
              </div>
              <div style={{ fontSize: 12, color: COLORS.mutedText, fontWeight: 400, lineHeight: 1.35 }}>
                Showing data for: {periodLabel}
              </div>
            </div>
          </BlurAura>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", pointerEvents: "auto" }}>
          <BlurAura>
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              style={{
                padding: "0 14px", height: 44, borderRadius: 14,
                border: `1px solid rgba(220,230,245,0.6)`,
                background: "rgba(255,255,255,0.5)",
                boxShadow: "none",
                fontSize: 13, fontFamily: "Poppins, sans-serif", fontWeight: 500,
                color: COLORS.black, cursor: "pointer", transition: "all 200ms ease",
              }}
            >
              {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </BlurAura>
          {isAdmin && (
            <BlurAura>
              <HoverButton variant="primary" onClick={fetchAnalytics} disabled={loading} style={{ height: 44 }}>
                {loading ? "Loading..." : "Refresh"}
              </HoverButton>
            </BlurAura>
          )}
          {isAdmin && (
            <BlurAura>
              <HoverButton variant="danger" onClick={() => setResetConfirm(true)} style={{ height: 44 }}>
                Clear Data
              </HoverButton>
            </BlurAura>
          )}
        </div>
      </div>

      {/* Content area — padded at top to sit below the fixed header */}
      <div style={{ position: "relative", zIndex: 1, padding: "100px 28px 24px 28px" }}>

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

            {/* AI Chatbot */}
            <ChatPanel period={period} userName={currentUserName} onOpenMemory={() => navigate("/dashboard/memory")} />

            {/* Stat cards */}
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <StatCard label="Total Events" value={data.total_events} sub="All tracked workflows" color={COLORS.blue} />
              <StatCard label="Quotes Created" value={data.total_quotes_created} sub="Generated PDFs" color={COLORS.green} />
              <StatCard label="PDFs Uploaded" value={data.total_pdfs_uploaded} sub="Parsed uploads" />
            </div>

            {/* User Leaderboard — full width, prominent */}
            <Section title="Team Leaderboard" expandable action={
              <div style={{ fontSize: 12, color: COLORS.mutedText }}>Click a user for details</div>
            }>
              {(expanded) => <UserTable users={data.usage_by_user} clerkUsers={clerkUsers} onSelectUser={setSelectedUser} limit={expanded ? 15 : 5} />}
            </Section>

            {/* Two-column: insurance breakdown + manual changes */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
              <Section title="Insurance Type Leaderboard" expandable>
                {(expanded) => <InsuranceBreakdown data={data.usage_by_insurance_type} limit={expanded ? 15 : 5} />}
              </Section>
              <Section title="Manual Changes Leaderboard" expandable>
                {(expanded) => <ManualChangesLeaderboard data={manualChanges?.leaderboard} limit={expanded ? 15 : 5} />}
              </Section>
            </div>

            {/* Snapshot History */}
            <Section title="Snapshot History" expandable>
              {(expanded) => <SnapshotHistory events={data.recent_events} getToken={getToken} onRefresh={fetchAnalytics} limit={expanded ? 30 : 5} />}
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
            clerkUsers={clerkUsers}
            onRefresh={fetchAnalytics}
            isAdmin={isAdmin}
          />
        )}
      </div>
    </div>
  );
}
