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
function GlassPanel({ children, borderRadius = 24, style = {}, allowOverflow = false }) {
  return (
    <div style={{
      position: "relative", borderRadius, overflow: allowOverflow ? "visible" : "hidden", border: "none",
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
    borderRadius: 14, height: 48, padding: "0 24px", fontSize: 14, fontWeight: 500,
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
      background: disabled ? "rgba(0,0,0,0.04)" : COLORS.dangerSoft,
      color: disabled ? COLORS.mutedText : COLORS.danger,
      border: `1px solid ${disabled ? "rgba(0,0,0,0.08)" : COLORS.dangerBorder}`,
      boxShadow: hovered && !disabled ? `0 0 20px rgba(217,45,32,0.12)` : "0 0 0 rgba(0,0,0,0)",
      opacity: disabled ? 0.6 : 1,
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
      background: "transparent",
      color: disabled ? COLORS.mutedText : COLORS.danger,
      border: `1px solid ${disabled ? "rgba(0,0,0,0.08)" : COLORS.dangerBorder}`,
      boxShadow: hovered && !disabled ? `0 0 14px rgba(217,45,32,0.10)` : "0 0 0 rgba(0,0,0,0)",
      opacity: disabled ? 0.55 : 1,
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
function StatCard({ label, value, sub, color, style = {} }) {
  const [hovered, setHovered] = React.useState(false);
  return (
    <GlassPanel borderRadius={18} style={{ flex: "1 1 200px", minWidth: 170, transition: "all 200ms ease", boxShadow: hovered ? `0 8px 32px rgba(23,101,212,0.10)` : "none", ...style }}>
      <div
        style={{ padding: "24px 28px", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center" }}
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
function Section({ title, children, action = null, expandable = false, defaultExpanded = false, allowOverflow = false, tightHeader = false }) {
  const [expanded, setExpanded] = React.useState(defaultExpanded);
  return (
    <GlassPanel allowOverflow={allowOverflow}>
      <div style={{ padding: "24px 28px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, marginBottom: tightHeader ? 6 : 18 }}>
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

/* ── Insurance type pie chart ────────────────────────────────── */
function InsuranceBreakdown({ data, limit = 15 }) {
  const [hovered, setHovered] = React.useState(null); // hovered slice type
  const [tooltipPos, setTooltipPos] = React.useState({ x: 0, y: 0 });
  const containerRef = React.useRef(null);

  if (!data || Object.keys(data).length === 0) return <div style={{ color: COLORS.mutedText, fontSize: 13 }}>No data yet</div>;
  const total = Object.values(data).reduce((a, b) => a + b, 0);
  const typeColors = INSURANCE_COLORS;
  const entries = Object.entries(data)
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit);

  // SVG donut geometry — bigger
  const size = 240;
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = 108;
  const rInner = 68;

  const polar = (r, angle) => {
    const rad = (angle - 90) * (Math.PI / 180);
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  };

  const arcPath = (startAngle, endAngle) => {
    // Handle full-circle case (single slice at 100%) by drawing two halves
    if (endAngle - startAngle >= 360) {
      const [x1, y1] = polar(rOuter, 0);
      const [x2, y2] = polar(rOuter, 180);
      const [x3, y3] = polar(rInner, 180);
      const [x4, y4] = polar(rInner, 0);
      return [
        `M ${x1} ${y1}`,
        `A ${rOuter} ${rOuter} 0 0 1 ${x2} ${y2}`,
        `A ${rOuter} ${rOuter} 0 0 1 ${x1} ${y1}`,
        `M ${x4} ${y4}`,
        `A ${rInner} ${rInner} 0 0 0 ${x3} ${y3}`,
        `A ${rInner} ${rInner} 0 0 0 ${x4} ${y4}`,
        "Z",
      ].join(" ");
    }
    const largeArc = endAngle - startAngle > 180 ? 1 : 0;
    const [sxO, syO] = polar(rOuter, startAngle);
    const [exO, eyO] = polar(rOuter, endAngle);
    const [sxI, syI] = polar(rInner, endAngle);
    const [exI, eyI] = polar(rInner, startAngle);
    return [
      `M ${sxO} ${syO}`,
      `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${exO} ${eyO}`,
      `L ${sxI} ${syI}`,
      `A ${rInner} ${rInner} 0 ${largeArc} 0 ${exI} ${eyI}`,
      "Z",
    ].join(" ");
  };

  // Build slices
  let cursor = 0;
  const slices = entries.map(([type, count]) => {
    const pct = total > 0 ? count / total : 0;
    const sweep = pct * 360;
    const start = cursor;
    const end = cursor + sweep;
    cursor = end;
    return {
      type,
      count,
      pct,
      startAngle: start,
      endAngle: Math.min(end, start + 359.999),
      d: arcPath(start, Math.min(end, start + 359.999)),
      color: typeColors[type] || COLORS.blue,
    };
  });

  const hoveredSlice = hovered ? slices.find((s) => s.type === hovered) : null;

  const handleSliceMove = (type, e) => {
    setHovered(type);
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setTooltipPos({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    }
  };

  return (
    <div
      ref={containerRef}
      style={{ display: "flex", alignItems: "center", gap: 28, flexWrap: "wrap", position: "relative" }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0, overflow: "visible" }}>
        {slices.map((s) => {
          const isHovered = hovered === s.type;
          const isDimmed = hovered && !isHovered;
          // Slight outward "explode" on hover
          const midAngle = (s.startAngle + s.endAngle) / 2;
          const rad = (midAngle - 90) * (Math.PI / 180);
          const dx = isHovered ? Math.cos(rad) * 6 : 0;
          const dy = isHovered ? Math.sin(rad) * 6 : 0;
          return (
            <path
              key={s.type}
              d={s.d}
              fill={s.color}
              stroke="#fff"
              strokeWidth="1.5"
              style={{
                transform: `translate(${dx}px, ${dy}px)`,
                transformOrigin: `${cx}px ${cy}px`,
                opacity: isDimmed ? 0.45 : 1,
                transition: "transform 180ms ease, opacity 180ms ease",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => handleSliceMove(s.type, e)}
              onMouseMove={(e) => handleSliceMove(s.type, e)}
              onMouseLeave={() => setHovered(null)}
            />
          );
        })}
        <text
          x={cx}
          y={cy - 4}
          textAnchor="middle"
          style={{ fontSize: 28, fontWeight: 700, fontFamily: "Poppins, sans-serif", fill: COLORS.black, pointerEvents: "none" }}
        >
          {hoveredSlice ? hoveredSlice.count : total}
        </text>
        <text
          x={cx}
          y={cy + 18}
          textAnchor="middle"
          style={{ fontSize: 11, fontWeight: 500, fontFamily: "Poppins, sans-serif", fill: COLORS.mutedText, textTransform: "uppercase", letterSpacing: "0.06em", pointerEvents: "none" }}
        >
          {hoveredSlice ? hoveredSlice.type : "Total"}
        </text>
      </svg>

      <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 180, alignItems: "flex-start" }}>
        {slices.map((s) => {
          const isHovered = hovered === s.type;
          const isDimmed = hovered && !isHovered;
          return (
            <div
              key={s.type}
              onMouseEnter={() => setHovered(s.type)}
              onMouseLeave={() => setHovered(null)}
              style={{
                display: "grid",
                gridTemplateColumns: "12px minmax(90px, auto) auto auto",
                alignItems: "center",
                columnGap: 8,
                padding: "3px 6px",
                borderRadius: 6,
                opacity: isDimmed ? 0.45 : 1,
                background: isHovered ? "rgba(23,101,212,0.06)" : "transparent",
                transition: "opacity 180ms ease, background 180ms ease",
                cursor: "default",
              }}
            >
              <span style={{
                display: "inline-block", width: 10, height: 10, borderRadius: 3,
                background: s.color,
              }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.black, textTransform: "capitalize", whiteSpace: "nowrap" }}>
                {s.type}
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, color: COLORS.black, fontVariantNumeric: "tabular-nums", textAlign: "right", paddingLeft: 16 }}>
                {s.count}
              </span>
              <span style={{ fontSize: 12, fontWeight: 500, color: COLORS.mutedText, fontVariantNumeric: "tabular-nums", textAlign: "right", minWidth: 46 }}>
                {(s.pct * 100).toFixed(1)}%
              </span>
            </div>
          );
        })}
      </div>

      {/* Floating hover tooltip — matches the timeline style */}
      {hoveredSlice && (
        <div
          style={{
            position: "absolute",
            left: tooltipPos.x + 14,
            top: tooltipPos.y - 14,
            background: "rgba(15,23,42,0.96)",
            color: "#fff",
            padding: "10px 14px",
            borderRadius: 10,
            fontSize: 12,
            fontFamily: "Poppins, sans-serif",
            whiteSpace: "nowrap",
            pointerEvents: "none",
            boxShadow: "0 12px 32px rgba(0,0,0,0.25)",
            zIndex: 50,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{
              display: "inline-block", width: 9, height: 9, borderRadius: 2,
              background: hoveredSlice.color,
            }} />
            <span style={{ fontWeight: 600, textTransform: "capitalize" }}>{hoveredSlice.type}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 18, fontVariantNumeric: "tabular-nums" }}>
            <span style={{ opacity: 0.7 }}>Count</span>
            <span style={{ fontWeight: 700 }}>{hoveredSlice.count}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 18, fontVariantNumeric: "tabular-nums" }}>
            <span style={{ opacity: 0.7 }}>Share</span>
            <span style={{ fontWeight: 700 }}>{(hoveredSlice.pct * 100).toFixed(1)}%</span>
          </div>
        </div>
      )}
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

/* ── Quotes Timeline — stacked bar chart ─────────────────────── */
/* Derives everything from the same `events` array that powers Snapshot
   History, so the chart and the table are guaranteed to stay in sync. */
function QuotesTimeline({ events, period }) {
  const [hoveredIdx, setHoveredIdx] = React.useState(null);
  const containerRef = React.useRef(null);

  // Bucket size depends on period.
  const bucketKind = period === "year" ? "month"
    : period === "all" ? "year"
    : period === "6months" ? "week"
    : "day";

  // Build a dense sequence of buckets covering the whole period so we
  // always show a full timeline even on days with zero activity.
  const buckets = React.useMemo(() => {
    const now = new Date();
    const mkDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const mkWeek = (d) => {
      const x = mkDay(d);
      const dow = x.getDay(); // 0=Sun
      x.setDate(x.getDate() - dow); // start on Sunday
      return x;
    };
    const mkMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
    const mkYear = (d) => new Date(d.getFullYear(), 0, 1);

    const list = [];
    if (bucketKind === "day") {
      const count = period === "week" ? 7 : 30;
      const end = mkDay(now);
      const start = new Date(end);
      start.setDate(start.getDate() - (count - 1));
      for (let i = 0; i < count; i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        list.push(d);
      }
    } else if (bucketKind === "week") {
      const end = mkWeek(now);
      const count = 26;
      const start = new Date(end);
      start.setDate(start.getDate() - (count - 1) * 7);
      for (let i = 0; i < count; i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + i * 7);
        list.push(d);
      }
    } else if (bucketKind === "month") {
      const end = mkMonth(now);
      const count = 12;
      const start = new Date(end);
      start.setMonth(start.getMonth() - (count - 1));
      for (let i = 0; i < count; i++) {
        const d = new Date(start);
        d.setMonth(start.getMonth() + i);
        list.push(d);
      }
    } else {
      // year — derive span from events, fallback to current year only
      const years = new Set(
        (events || []).map((e) => e.created_at ? new Date(e.created_at).getFullYear() : null).filter(Boolean)
      );
      years.add(now.getFullYear());
      const min = Math.min(...years);
      const max = Math.max(...years);
      for (let y = min; y <= max; y++) list.push(new Date(y, 0, 1));
    }
    return list;
  }, [bucketKind, period, events]);

  // Key each bucket by its normalized timestamp for quick lookup.
  const bucketKey = React.useCallback((d) => {
    if (bucketKind === "day") return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (bucketKind === "week") {
      const x = new Date(d);
      const dow = x.getDay();
      x.setDate(x.getDate() - dow);
      return `W${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
    }
    if (bucketKind === "month") return `${d.getFullYear()}-${d.getMonth()}`;
    return `Y${d.getFullYear()}`;
  }, [bucketKind]);

  // Collapse events into { bucketKey: { type: count, ... } }
  // Uses the exact same `events` array that powers Snapshot History,
  // filtering for created_quote === true so counts match the leaderboard.
  const byBucket = React.useMemo(() => {
    const map = {};
    for (const e of events || []) {
      if (!e.created_quote || !e.created_at) continue;
      const d = new Date(e.created_at);
      const key = bucketKey(d);
      if (!map[key]) map[key] = {};
      const t = e.insurance_type || "other";
      map[key][t] = (map[key][t] || 0) + 1;
    }
    return map;
  }, [events, bucketKey]);

  // Build the series rendered as stacks.
  const series = buckets.map((d) => {
    const key = bucketKey(d);
    const counts = byBucket[key] || {};
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    return { date: d, counts, total };
  });

  const maxTotal = Math.max(1, ...series.map((s) => s.total));
  const totalQuotes = series.reduce((a, s) => a + s.total, 0);

  // Axis label formatter.
  const fmtLabel = (d) => {
    if (bucketKind === "day") {
      if (period === "week") return d.toLocaleDateString("en-US", { weekday: "short" });
      return d.toLocaleDateString("en-US", { month: "numeric", day: "numeric" });
    }
    if (bucketKind === "week") return d.toLocaleDateString("en-US", { month: "numeric", day: "numeric" });
    if (bucketKind === "month") return d.toLocaleDateString("en-US", { month: "short" });
    return String(d.getFullYear());
  };
  const fmtFullLabel = (d) => {
    if (bucketKind === "day") return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
    if (bucketKind === "week") {
      const end = new Date(d); end.setDate(end.getDate() + 6);
      return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${end.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
    }
    if (bucketKind === "month") return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    return String(d.getFullYear());
  };

  if (!totalQuotes) {
    return <div style={{ color: COLORS.mutedText, fontSize: 13, padding: "20px 0" }}>No quotes generated in this period</div>;
  }

  const typeColors = INSURANCE_COLORS;
  // Keep stacking order stable across bars.
  const typeOrder = ["homeowners", "auto", "dwelling", "commercial", "bundle", "wind"];

  // How many x-labels to actually render — avoid crowding.
  const labelEvery = Math.max(1, Math.ceil(series.length / 15));

  const chartHeight = 220;
  // Thicker bars when there are fewer (week) so they feel chunky.
  const barGap = series.length <= 10 ? 10 : series.length <= 16 ? 8 : 6;

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%" }}>
      {/* Summary header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          {typeOrder.filter((t) => series.some((s) => s.counts[t])).map((t) => (
            <div key={t} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: typeColors[t] || COLORS.blue, display: "inline-block" }} />
              <span style={{ fontSize: 11, color: COLORS.mutedText, fontWeight: 500, textTransform: "capitalize" }}>{t}</span>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 12, color: COLORS.mutedText }}>
          <span style={{ fontWeight: 700, color: COLORS.black }}>{totalQuotes}</span> quotes in period
        </div>
      </div>

      {/* Chart area */}
      <div style={{
        position: "relative",
        display: "flex",
        alignItems: "flex-end",
        gap: barGap,
        height: chartHeight,
        padding: "18px 4px 4px 4px",
        borderBottom: `1px solid rgba(180,200,230,0.35)`,
      }}>
        {series.map((s, i) => {
          const hovered = hoveredIdx === i;
          const pct = (s.total / maxTotal) * 100;
          const heightPx = Math.max(s.total > 0 ? 2 : 0, (pct / 100) * (chartHeight - 30));
          const stacks = typeOrder
            .filter((t) => s.counts[t])
            .map((t) => ({ type: t, count: s.counts[t] }));
          return (
            <div
              key={i}
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
              style={{
                flex: "1 1 0",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "flex-end",
                position: "relative",
                minWidth: 0,
                cursor: "default",
              }}
            >
              {/* Auto-displayed total number above the bar */}
              {s.total > 0 && (
                <div style={{
                  position: "absolute",
                  top: -2,
                  fontSize: 10,
                  fontWeight: 700,
                  color: hovered ? COLORS.blue : COLORS.black,
                  transition: "color 150ms ease",
                  pointerEvents: "none",
                  whiteSpace: "nowrap",
                }}>{s.total}</div>
              )}

              {/* Stacked bar */}
              <div style={{
                width: "100%",
                height: heightPx,
                display: "flex",
                flexDirection: "column-reverse",
                borderRadius: 6,
                overflow: "hidden",
                boxShadow: hovered ? `0 0 14px rgba(23,101,212,0.18)` : "0 1px 2px rgba(0,0,0,0.04)",
                transition: "box-shadow 160ms ease, transform 160ms ease",
                transform: hovered ? "translateY(-2px)" : "translateY(0)",
                background: "rgba(0,0,0,0.03)",
              }}>
                {stacks.map((seg, j) => {
                  const segPct = s.total > 0 ? (seg.count / s.total) * 100 : 0;
                  return (
                    <div
                      key={seg.type}
                      style={{
                        height: `${segPct}%`,
                        background: typeColors[seg.type] || COLORS.blue,
                        borderTop: j < stacks.length - 1 ? "1px solid rgba(255,255,255,0.5)" : "none",
                      }}
                    />
                  );
                })}
              </div>

              {/* Tooltip — absolutely positioned above the bar on hover */}
              {hovered && s.total > 0 && (
                <div style={{
                  position: "absolute",
                  bottom: `calc(100% + 8px)`,
                  left: "50%",
                  transform: "translateX(-50%)",
                  background: "rgba(32, 39, 45, 0.96)",
                  color: COLORS.white,
                  padding: "10px 12px",
                  borderRadius: 10,
                  fontSize: 11,
                  fontFamily: "Poppins, sans-serif",
                  whiteSpace: "nowrap",
                  pointerEvents: "none",
                  boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
                  zIndex: 50,
                }}>
                  <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 11 }}>{fmtFullLabel(s.date)}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    {stacks.slice().reverse().map((seg) => (
                      <div key={seg.type} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: typeColors[seg.type] || COLORS.blue }} />
                        <span style={{ textTransform: "capitalize", opacity: 0.85 }}>{seg.type}</span>
                        <span style={{ marginLeft: "auto", fontWeight: 700 }}>{seg.count}</span>
                      </div>
                    ))}
                    <div style={{ marginTop: 4, paddingTop: 4, borderTop: "1px solid rgba(255,255,255,0.2)", display: "flex", justifyContent: "space-between", gap: 12 }}>
                      <span style={{ opacity: 0.75 }}>Total</span>
                      <span style={{ fontWeight: 700 }}>{s.total}</span>
                    </div>
                  </div>
                  {/* Little tail */}
                  <div style={{
                    position: "absolute",
                    top: "100%",
                    left: "50%",
                    transform: "translateX(-50%)",
                    width: 0, height: 0,
                    borderLeft: "5px solid transparent",
                    borderRight: "5px solid transparent",
                    borderTop: "6px solid rgba(32, 39, 45, 0.96)",
                  }} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* X-axis labels */}
      <div style={{ display: "flex", gap: barGap, marginTop: 6, padding: "0 4px" }}>
        {series.map((s, i) => (
          <div key={i} style={{
            flex: "1 1 0",
            textAlign: "center",
            fontSize: 10,
            color: COLORS.mutedText,
            fontWeight: 500,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}>
            {i % labelEvery === 0 ? fmtLabel(s.date) : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Clickable User Row ──────────────────────────────────────── */
function RoleBadge({ role }) {
  const isAdmin = (role || "advisor") === "admin";
  return (
    <span style={{
      display: "inline-block", padding: "3px 10px", borderRadius: 8, fontSize: 11, fontWeight: 600,
      textTransform: "capitalize",
      background: isAdmin ? COLORS.blue : "rgba(23,101,212,0.08)",
      color: isAdmin ? "#fff" : COLORS.blue,
      border: isAdmin ? "none" : `1px solid rgba(23,101,212,0.15)`,
    }}>{role || "advisor"}</span>
  );
}

// Brushed-metal gradients: diagonal 135deg with alternating highlight and
// midtone stops to mimic the banding you get on polished metal.
const RANK_COLORS = {
  // Gold
  1: "linear-gradient(135deg, #C89B2E, #F5D76E, #B8891E, #F0CB5A, #A67C1A)",
  // Silver
  2: "linear-gradient(135deg, #929292, #E3E3E3, #7E7E7E, #E8E8E8, #707070)",
  // Bronze
  3: "linear-gradient(135deg, #A66A28, #E5A568, #8B5A1E, #DB9A5C, #7C4A1C)",
};

function UserRow({ user, role, onClick, rank, imageUrl }) {
  const [hovered, setHovered] = React.useState(false);
  const rankGradient = RANK_COLORS[rank];
  const nameColor = rankGradient
    ? {
        backgroundImage: rankGradient,
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent",
        backgroundClip: "text",
      }
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
      <td style={{ padding: "12px 14px", textAlign: "right", fontWeight: 600, color: "#0B91E6" }}>{user.days_active || 0}</td>
      <td style={{ padding: "12px 14px", textAlign: "right", color: COLORS.mutedText }}>
        <span style={{ fontSize: 16 }}>&#8250;</span>
      </td>
    </tr>
  );
}

function UserTable({ users, clerkUsers, clerkUsersList, onSelectUser, limit = 15 }) {
  // Merge analytics users with all Clerk users so everyone appears.
  //
  // CRITICAL invariant: the Clerk user_id is the ONE stable identifier.
  // Keying by user_name would collide whenever the backend returns two rows
  // for the same person (e.g. legacy user_id='' row joined via the COALESCE
  // fallback + a newer user_id-keyed row), causing one of them to silently
  // overwrite the other. This is what caused Kevin Li's count to read as 1
  // even though multiple events existed.
  //
  // We SUM counts across all analytics rows that resolve to the same Clerk
  // user_id, so a person is represented exactly once no matter how their
  // history is distributed across legacy/backfilled rows.
  const byClerkId = {};         // clerk_id -> aggregated user row
  const unmatchedByUserKey = {}; // analytics rows with no matching Clerk user (by the row's own stable user_id / user_name alias)

  const addToAgg = (target, src) => {
    target.total = (target.total || 0) + (src.total || 0);
    target.quotes_created = (target.quotes_created || 0) + (src.quotes_created || 0);
    target.pdfs_uploaded = (target.pdfs_uploaded || 0) + (src.pdfs_uploaded || 0);
    // days_active is a COUNT(DISTINCT date) per row — approximating by max
    // across the fragments is usually close enough once the backfill runs
    // (post-backfill the backend returns a single row per user, so this
    // branch collapses to a direct copy).
    target.days_active = Math.max(target.days_active || 0, src.days_active || 0);
    return target;
  };

  const resolveClerkId = (analyticsRow) => {
    // Prefer the stable user_id the backend returned (Clerk sub claim after
    // backfill). Fall back to alias lookup for the rare legacy row whose
    // user_id is still blank. Case-insensitive so single-name users still
    // resolve.
    if (analyticsRow.user_id) {
      // Backend may have emitted the raw user_id OR (for pre-backfill rows)
      // the user_name as the COALESCE fallback. Trust it if it looks like a
      // Clerk id (user_xxx), otherwise try to resolve via alias map.
      if (analyticsRow.user_id.startsWith("user_")) return analyticsRow.user_id;
      const lookup = clerkUsers[analyticsRow.user_id]
        || clerkUsers[(analyticsRow.user_id || "").toLowerCase()];
      if (lookup?.id) return lookup.id;
    }
    const nameKey = analyticsRow.user_name || "";
    const lookup = clerkUsers[nameKey] || clerkUsers[nameKey.toLowerCase()];
    return lookup?.id || null;
  };

  for (const row of (users || [])) {
    const clerkId = resolveClerkId(row);
    if (clerkId) {
      if (!byClerkId[clerkId]) {
        // Seed the aggregate with the canonical Clerk display name so renames
        // don't fragment the leaderboard.
        const canonical = (clerkUsersList || []).find((c) => c.id === clerkId);
        byClerkId[clerkId] = {
          user_id: clerkId,
          user_name: canonical?.displayName || row.user_name,
          total: 0, quotes_created: 0, pdfs_uploaded: 0, days_active: 0,
        };
      }
      addToAgg(byClerkId[clerkId], row);
    } else {
      // Truly orphan row (Clerk account deleted). Key by whatever stable
      // identifier we have so we don't collide on user_name. Keep these
      // VISIBLE rather than silently dropping — per the "one source of
      // truth" rule, if analytics_events shows activity, the dashboard
      // must show it. Admin can delete via the event-level delete flow.
      const key = row.user_id || `name:${row.user_name}`;
      if (!unmatchedByUserKey[key]) {
        unmatchedByUserKey[key] = {
          user_id: row.user_id || row.user_name,
          user_name: row.user_name,
          total: 0, quotes_created: 0, pdfs_uploaded: 0, days_active: 0,
        };
      }
      addToAgg(unmatchedByUserKey[key], row);
    }
  }

  // Ensure every Clerk user appears, even with zero activity.
  for (const cu of (clerkUsersList || [])) {
    if (!cu.id) continue;
    if (!byClerkId[cu.id]) {
      byClerkId[cu.id] = {
        user_id: cu.id,
        user_name: cu.displayName || "Unknown",
        total: 0, quotes_created: 0, pdfs_uploaded: 0, days_active: 0,
      };
    }
  }

  const allUsers = [...Object.values(byClerkId), ...Object.values(unmatchedByUserKey)]
    .sort((a, b) => b.total - a.total);

  const th = { padding: "10px 14px", color: COLORS.mutedText, fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" };
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, fontFamily: "Poppins, sans-serif" }}>
        <thead>
          <tr style={{ borderBottom: `2px solid rgba(180,200,230,0.3)` }}>
            <th style={{ ...th, textAlign: "left" }}>User</th>
            <th style={{ ...th, textAlign: "center" }}>Role</th>
            <th style={{ ...th, textAlign: "right" }}>PDFs Generated</th>
            <th style={{ ...th, textAlign: "right" }}>Days Active</th>
            <th style={{ ...th, textAlign: "right", width: 30 }}></th>
          </tr>
        </thead>
        <tbody>
          {allUsers.slice(0, limit).map((u, idx) => {
            // Look up Clerk metadata (role, avatar) by the stable Clerk id
            // whenever possible. Fall back to name-based alias lookup for
            // orphan rows so roles still render.
            const cu =
              clerkUsers[u.user_id] ||
              clerkUsers[u.user_name] ||
              clerkUsers[(u.user_name || "").toLowerCase()] ||
              null;
            return (
              <UserRow
                key={u.user_id}
                user={u}
                role={cu?.role || "advisor"}
                onClick={() => onSelectUser(u.user_id)}
                rank={idx + 1}
                imageUrl={cu?.image_url}
              />
            );
          })}
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
                // Both advisor and admin use the brand blue when selected.
                background: active ? COLORS.blue : "rgba(0,0,0,0.04)",
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

  // `userName` is now the stable Clerk user_id (e.g. "user_2abc...").
  // The API returns the current display name in data.user_name, so use that
  // for display and for the clerkUsers lookup keyed by display name.
  const displayName = data?.user_name || userName;

  // Look the user up by exact key first, then a case-insensitive fallback
  // so single-name users (e.g. "jj") still get a Clerk record + role toggle.
  const clerkUser =
    clerkUsers[displayName] ||
    clerkUsers[(displayName || "").toLowerCase()] ||
    null;

  React.useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const token = await getToken();
        // userName is the stable user_id — used as the URL path param so renames
        // don't break the link or fragment the user's history.
        const url = `${API_BASE_URL}/api/admin/analytics/user/${encodeURIComponent(userName)}?period=${period}`;
        const resp = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (resp.ok) setData(await resp.json());
      } catch {}
      setLoading(false);
    })();
  }, [userName, period, getToken]);

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
            {displayName.charAt(0).toUpperCase()}
          </div>
        )}
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: COLORS.black }}>{displayName}</div>
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
          {/* Show the VIEWED user's actual role, not a hardcoded "advisor".
              An advisor peeking at another user's dashboard still needs to
              see whether that user is an admin or advisor. */}
          <RoleBadge role={clerkUser?.role || "advisor"} />
        </div>
      )}

      {/* Top row: stacked stats (PDFs Generated + Days Active) | Insurance Type Breakdown */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, alignItems: "stretch" }}>
        <div style={{ display: "grid", gridTemplateRows: "1fr 1fr", gap: 20 }}>
          <Section title="PDFs Generated" tightHeader>
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "flex-start",
              justifyContent: "space-between", height: "100%", minHeight: 140,
            }}>
              <div style={{ fontSize: 13, color: COLORS.mutedText, fontWeight: 400 }}>
                All tracked workflows
              </div>
              <div style={{
                fontSize: 90, fontWeight: 700, color: COLORS.blue,
                lineHeight: 0.82, fontFamily: "Poppins, sans-serif",
                letterSpacing: "-0.04em", marginTop: "auto",
              }}>
                {data.total_events}
              </div>
            </div>
          </Section>
          <Section title="Days Active" tightHeader>
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "flex-start",
              justifyContent: "space-between", height: "100%", minHeight: 140,
            }}>
              <div style={{ fontSize: 13, color: COLORS.mutedText, fontWeight: 400 }}>
                Distinct days with activity
              </div>
              <div style={{
                fontSize: 90, fontWeight: 700, color: "#0B91E6",
                lineHeight: 0.82, fontFamily: "Poppins, sans-serif",
                letterSpacing: "-0.04em", marginTop: "auto",
              }}>
                {data.days_active || 0}
              </div>
            </div>
          </Section>
        </div>
        <Section title="Insurance Type Breakdown" allowOverflow>
          <InsuranceBreakdown data={data.by_insurance_type} />
        </Section>
      </div>

      {/* Quotes Timeline — personal stacked bar chart */}
      <Section title="Quotes Generated" allowOverflow tightHeader>
        <QuotesTimeline events={data.recent_events} period={period} />
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
  const [clientQuery, setClientQuery] = React.useState("");

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

  const q = clientQuery.trim().toLowerCase();
  const filtered = events.filter((e) => {
    if (filterInsurance && e.insurance_type !== filterInsurance) return false;
    if (filterDate && new Date(e.created_at).toLocaleDateString() !== filterDate) return false;
    if (q && !(e.client_name || "").toLowerCase().includes(q)) return false;
    return true;
  });

  const filterSelect = {
    padding: "4px 10px", height: 32, width: 150, borderRadius: 8,
    border: `1px solid ${COLORS.borderGrey}`,
    background: "rgba(255,255,255,0.88)",
    fontSize: 11, lineHeight: "22px", fontFamily: "Poppins, sans-serif", fontWeight: 500,
    color: COLORS.black, cursor: "pointer",
    boxSizing: "border-box",
    margin: 0,
    outline: "none",
  };
  const th = { padding: "8px 10px", color: COLORS.mutedText, fontWeight: 600, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em", textAlign: "left", whiteSpace: "nowrap" };
  const td = { padding: "8px 10px", fontSize: 12, maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
  const typeColors = INSURANCE_COLORS;

  return (
    <>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginBottom: 12, flexWrap: "wrap" }}>
        <input
          type="text"
          value={clientQuery}
          onChange={(e) => setClientQuery(e.target.value)}
          placeholder="Search client…"
          style={{ ...filterSelect, cursor: "text" }}
        />
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
              {["Date", "Client", "Insurance", "Advisor", "Uploaded PDF", "Manual Changes", "Quote", "Generated PDF"].map((h) => (
                <th key={h} style={th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={8} style={{ padding: 20, textAlign: "center", color: COLORS.mutedText, fontSize: 12 }}>No events match the selected filters</td></tr>
            ) : filtered.map((e) => (
              <HoverRow key={e.id}>
                <td style={td}>{new Date(e.created_at).toLocaleString()}</td>
                <td style={{ ...td, fontWeight: 500 }} title={e.client_name}>{e.client_name || "—"}</td>
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
function SnapshotHistory({ events, getToken, onRefresh, limit = 30, isAdmin = false, pdfFilenames = new Set() }) {
  const [deleteTarget, setDeleteTarget] = React.useState(null);
  const [deleting, setDeleting] = React.useState(false);
  const [filterUser, setFilterUser] = React.useState("");
  const [filterInsurance, setFilterInsurance] = React.useState("");
  const [filterDate, setFilterDate] = React.useState("");
  const [clientQuery, setClientQuery] = React.useState("");

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
  const q = clientQuery.trim().toLowerCase();
  const filtered = events.filter((e) => {
    if (filterUser && e.user_name !== filterUser) return false;
    if (filterInsurance && e.insurance_type !== filterInsurance) return false;
    if (filterDate && new Date(e.created_at).toLocaleDateString() !== filterDate) return false;
    if (q && !(e.client_name || "").toLowerCase().includes(q)) return false;
    return true;
  });

  const filterSelect = {
    padding: "4px 10px", height: 32, width: 150, borderRadius: 8,
    border: `1px solid ${COLORS.borderGrey}`,
    background: "rgba(255,255,255,0.88)",
    fontSize: 11, lineHeight: "22px", fontFamily: "Poppins, sans-serif", fontWeight: 500,
    color: COLORS.black, cursor: "pointer",
    boxSizing: "border-box",
    margin: 0,
    outline: "none",
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
        <input
          type="text"
          value={clientQuery}
          onChange={(e) => setClientQuery(e.target.value)}
          placeholder="Search client…"
          style={{
            ...filterSelect,
            cursor: "text",
          }}
        />
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
              <th style={th}>Client</th>
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
              <tr><td colSpan={10} style={{ padding: 20, textAlign: "center", color: COLORS.mutedText, fontSize: 12 }}>No events match the selected filters</td></tr>
            ) : filtered.slice(0, limit).map((e) => (
              <HoverRow key={e.id}>
                <td style={td}>{new Date(e.created_at).toLocaleString()}</td>
                <td style={{ ...td, fontWeight: 500 }}>{e.user_name}</td>
                <td style={{ ...td, fontWeight: 500 }} title={e.client_name}>{e.client_name || "—"}</td>
                <td style={td}>
                  <span style={{
                    padding: "2px 8px", borderRadius: 6, fontSize: 10, fontWeight: 600, textTransform: "capitalize",
                    background: `${typeColors[e.insurance_type] || COLORS.blue}15`,
                    color: typeColors[e.insurance_type] || COLORS.blue,
                  }}>{e.insurance_type}</span>
                </td>
                <td style={td}>{e.advisor || "—"}</td>
                <td style={td} title={e.uploaded_pdf}>
                  {e.uploaded_pdf ? (() => {
                    const exists = pdfFilenames.has(e.uploaded_pdf) || [...pdfFilenames].some(fn => e.uploaded_pdf.startsWith(fn.split(".pdf")[0]));
                    return exists ? (
                      <span
                        onClick={() => handlePdfDownload(e.uploaded_pdf, "uploaded")}
                        style={{ color: COLORS.blue, cursor: "pointer", textDecoration: "underline", textDecorationColor: "rgba(23,101,212,0.3)" }}
                      >{e.uploaded_pdf}</span>
                    ) : (
                      <span style={{ color: COLORS.mutedText }}>{e.uploaded_pdf}</span>
                    );
                  })() : "—"}
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
                  {e.generated_pdf ? (() => {
                    const exists = pdfFilenames.has(e.generated_pdf) || [...pdfFilenames].some(fn => e.generated_pdf.startsWith(fn.split(".pdf")[0]));
                    return exists ? (
                      <span
                        onClick={() => handlePdfDownload(e.generated_pdf, "generated")}
                        style={{ color: COLORS.blue, cursor: "pointer", textDecoration: "underline", textDecorationColor: "rgba(23,101,212,0.3)" }}
                      >{e.generated_pdf}</span>
                    ) : (
                      <span style={{ color: COLORS.mutedText }}>{e.generated_pdf}</span>
                    );
                  })() : "—"}
                </td>
                <td style={{ ...td, textAlign: "center" }}>
                  <HoverButton
                    variant="dangerSmall"
                    onClick={() => { if (isAdmin) setDeleteTarget(e.id); }}
                    disabled={!isAdmin}
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

/* ── PDF Storage Management ─────────────────────────────────── */
function PdfStorageTable({ docs, th, td, typeColors, formatSize, handleDownload, isAdmin, setDeleteTarget }) {
  const INITIAL_SHOW = 5;
  const [expanded, setExpanded] = React.useState(false);
  const visible = expanded ? docs : docs.slice(0, INITIAL_SHOW);
  const hasMore = docs.length > INITIAL_SHOW;

  return (
    <>
      <div style={{ overflowX: "auto", maxHeight: expanded ? 400 : undefined, overflowY: expanded ? "auto" : undefined }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "Poppins, sans-serif" }}>
          <thead>
            <tr style={{ borderBottom: `2px solid rgba(180,200,230,0.3)`, position: "sticky", top: 0, background: "rgba(255,255,255,0.95)", zIndex: 1 }}>
              <th style={th}>Date</th>
              <th style={th}>File Name</th>
              <th style={th}>Type</th>
              <th style={th}>Insurance</th>
              <th style={th}>Client</th>
              <th style={th}>Size</th>
              <th style={{ ...th, textAlign: "center", width: 100 }}></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((doc) => (
              <HoverRow key={doc.id}>
                <td style={td}>{new Date(doc.created_at).toLocaleDateString()}</td>
                <td style={td}>
                  <span onClick={() => handleDownload(doc)} style={{ color: COLORS.blue, cursor: "pointer", textDecoration: "underline", textDecorationColor: "rgba(23,101,212,0.3)" }}>
                    {doc.file_name}
                  </span>
                </td>
                <td style={td}>
                  <span style={{
                    padding: "2px 8px", borderRadius: 6, fontSize: 10, fontWeight: 600, textTransform: "capitalize",
                    background: doc.doc_type === "generated" ? COLORS.blueSoft : COLORS.greenSoft,
                    color: doc.doc_type === "generated" ? COLORS.blue : COLORS.green,
                  }}>{doc.doc_type}</span>
                </td>
                <td style={td}>
                  <span style={{
                    padding: "2px 8px", borderRadius: 6, fontSize: 10, fontWeight: 600, textTransform: "capitalize",
                    background: `${typeColors[doc.insurance_type] || COLORS.blue}15`,
                    color: typeColors[doc.insurance_type] || COLORS.blue,
                  }}>{doc.insurance_type}</span>
                </td>
                <td style={td}>{doc.client_name || "—"}</td>
                <td style={td}>{formatSize(doc.file_size || 0)}</td>
                <td style={{ ...td, textAlign: "center" }}>
                  <HoverButton
                    variant="dangerSmall"
                    onClick={() => { if (isAdmin) setDeleteTarget(doc.id); }}
                    disabled={!isAdmin}
                    style={{ height: 26, padding: "0 10px", fontSize: 10, borderRadius: 8 }}
                  >Delete</HoverButton>
                </td>
              </HoverRow>
            ))}
          </tbody>
        </table>
      </div>
      {hasMore && (
        <div style={{ textAlign: "center", marginTop: 10 }}>
          <button
            onClick={() => setExpanded((prev) => !prev)}
            style={{
              background: "none", border: "none", color: COLORS.blue,
              fontSize: 12, fontWeight: 600, fontFamily: "Poppins, sans-serif",
              cursor: "pointer", padding: "6px 16px", borderRadius: 8,
              transition: "background 150ms ease",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = COLORS.blueSoft; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
          >
            {expanded ? "Show Less" : `Show All (${docs.length})`}
          </button>
        </div>
      )}
    </>
  );
}

function PdfStorageManager({ getToken, isAdmin, onRefresh }) {
  const [docs, setDocs] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [deleteTarget, setDeleteTarget] = React.useState(null);
  const [deleting, setDeleting] = React.useState(false);
  const [clearConfirm, setClearConfirm] = React.useState(false);
  const [clearing, setClearing] = React.useState(false);
  const [autoClear, setAutoClear] = React.useState("never");
  const [savingAuto, setSavingAuto] = React.useState(false);

  const fetchDocs = React.useCallback(async () => {
    setLoading(true);
    try {
      const token = await getToken();
      const resp = await fetch(`${API_BASE_URL}/api/pdfs?limit=200`, { headers: { Authorization: `Bearer ${token}` } });
      if (resp.ok) { const d = await resp.json(); setDocs(d.documents || []); }
    } catch {}
    setLoading(false);
  }, [getToken]);

  const fetchAutoClear = React.useCallback(async () => {
    try {
      const token = await getToken();
      const resp = await fetch(`${API_BASE_URL}/api/admin/settings/auto-clear`, { headers: { Authorization: `Bearer ${token}` } });
      if (resp.ok) { const d = await resp.json(); setAutoClear(d.value || "never"); }
    } catch {}
  }, [getToken]);

  React.useEffect(() => { fetchDocs(); fetchAutoClear(); }, [fetchDocs, fetchAutoClear]);

  const handleDeleteOne = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const token = await getToken();
      const resp = await fetch(`${API_BASE_URL}/api/pdfs/${deleteTarget}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      if (resp.ok) { setDeleteTarget(null); fetchDocs(); if (onRefresh) onRefresh(); }
    } catch {}
    setDeleting(false);
  };

  const handleClearAll = async () => {
    setClearing(true);
    try {
      const token = await getToken();
      const resp = await fetch(`${API_BASE_URL}/api/pdfs/all`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      if (resp.ok) { setClearConfirm(false); fetchDocs(); if (onRefresh) onRefresh(); }
    } catch {}
    setClearing(false);
  };

  const handleAutoClearChange = async (value) => {
    setSavingAuto(true);
    setAutoClear(value);
    try {
      const token = await getToken();
      await fetch(`${API_BASE_URL}/api/admin/settings/auto-clear`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      });
    } catch {}
    setSavingAuto(false);
  };

  const handleDownload = async (doc) => {
    try {
      const token = await getToken();
      const resp = await fetch(`${API_BASE_URL}/api/pdfs/${doc.id}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!resp.ok) return;
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = doc.file_name; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    } catch {}
  };

  const th = { padding: "10px 14px", color: COLORS.mutedText, fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap", textAlign: "left" };
  const td = { padding: "10px 14px", fontSize: 12, fontWeight: 400, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
  const typeColors = INSURANCE_COLORS;

  const totalSize = docs.reduce((sum, d) => sum + (d.file_size || 0), 0);
  const formatSize = (b) => b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`;

  return (
    <>
      {deleteTarget && (
        <ConfirmModal message="Delete this PDF from storage?" onConfirm={handleDeleteOne} onCancel={() => setDeleteTarget(null)} confirming={deleting} />
      )}
      {clearConfirm && (
        <ConfirmModal message={`Delete ALL ${docs.length} stored PDFs? This cannot be undone.`} onConfirm={handleClearAll} onCancel={() => setClearConfirm(false)} confirming={clearing} confirmLabel="Clear All" confirmingLabel="Clearing..." />
      )}

      {/* Header row with stats + actions */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <div style={{ fontSize: 13, color: COLORS.mutedText }}>
            <strong style={{ color: COLORS.black }}>{docs.length}</strong> PDFs stored
            <span style={{ margin: "0 6px", color: COLORS.borderGrey }}>·</span>
            {formatSize(totalSize)} total
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 11, color: COLORS.mutedText, fontWeight: 500 }}>Auto-clear:</span>
            <select
              value={autoClear}
              onChange={(e) => { if (isAdmin) handleAutoClearChange(e.target.value); }}
              disabled={!isAdmin || savingAuto}
              style={{
                padding: "4px 10px", height: 30, borderRadius: 8,
                border: `1px solid ${COLORS.borderGrey}`, background: "rgba(255,255,255,0.88)",
                fontSize: 11, fontFamily: "Poppins, sans-serif", fontWeight: 500,
                color: COLORS.black, cursor: isAdmin ? "pointer" : "not-allowed",
              }}
            >
              <option value="never">Never</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="6months">6 Months</option>
              <option value="yearly">Yearly</option>
            </select>
          </div>
          <HoverButton
            variant="danger"
            onClick={() => { if (isAdmin && docs.length > 0) setClearConfirm(true); }}
            disabled={!isAdmin || docs.length === 0}
            style={{ height: 32, padding: "0 14px", fontSize: 11, borderRadius: 10 }}
          >Clear All</HoverButton>
        </div>
      </div>

      {loading ? (
        <div style={{ color: COLORS.mutedText, fontSize: 13, textAlign: "center", padding: 24 }}>Loading PDFs...</div>
      ) : docs.length === 0 ? (
        <div style={{ color: COLORS.mutedText, fontSize: 13, textAlign: "center", padding: 24 }}>No PDFs stored</div>
      ) : (
        <PdfStorageTable docs={docs} th={th} td={td} typeColors={typeColors} formatSize={formatSize} handleDownload={handleDownload} isAdmin={isAdmin} setDeleteTarget={setDeleteTarget} />
      )}
    </>
  );
}


/* ── API Usage Line Graph ──────────────────────────────────────── */
function ApiUsageGraph({ period, getToken }) {
  const [usage, setUsage] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [metric, setMetric] = React.useState("tokens"); // "tokens" | "cost"
  const [hovered, setHovered] = React.useState(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const token = await getToken();
        const resp = await fetch(`${API_BASE_URL}/api/admin/api-usage?period=${period}`, { headers: { Authorization: `Bearer ${token}` } });
        if (resp.ok && !cancelled) {
          const d = await resp.json();
          setUsage(d.usage || []);
        }
      } catch {}
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [period, getToken]);

  if (loading) return <div style={{ color: COLORS.mutedText, fontSize: 13, textAlign: "center", padding: 40 }}>Loading API usage...</div>;
  if (usage.length === 0) return <div style={{ color: COLORS.mutedText, fontSize: 13, textAlign: "center", padding: 40 }}>No API usage data yet. Usage will appear here as quotes are generated.</div>;

  // Group by date, then by provider
  const dateMap = {};
  for (const row of usage) {
    if (!dateMap[row.date]) dateMap[row.date] = {};
    const entry = dateMap[row.date];
    if (!entry[row.provider]) entry[row.provider] = { input_tokens: 0, output_tokens: 0, cost: 0 };
    entry[row.provider].input_tokens += row.input_tokens || 0;
    entry[row.provider].output_tokens += row.output_tokens || 0;
    entry[row.provider].cost += row.cost || 0;
  }

  const dates = Object.keys(dateMap).sort();
  const providers = [...new Set(usage.map((r) => r.provider))].sort();

  const providerColors = {
    openai: "#10A37F",   // OpenAI green
    gemini: "#4285F4",   // Google blue
  };

  // Get values for the chart
  const getValue = (date, provider) => {
    const d = dateMap[date]?.[provider];
    if (!d) return 0;
    return metric === "tokens" ? d.input_tokens + d.output_tokens : d.cost;
  };

  const allValues = dates.flatMap((d) => providers.map((p) => getValue(d, p)));
  const maxVal = Math.max(...allValues, 1);

  // SVG dimensions
  const W = 700, H = 220, padL = 60, padR = 20, padT = 16, padB = 40;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  const xScale = (i) => padL + (dates.length === 1 ? chartW / 2 : (i / (dates.length - 1)) * chartW);
  const yScale = (v) => padT + chartH - (v / maxVal) * chartH;

  const buildPath = (provider) => {
    const points = dates.map((d, i) => ({ x: xScale(i), y: yScale(getValue(d, provider)) }));
    if (points.length === 0) return "";
    if (points.length === 1) return "";
    return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  };

  // Y-axis ticks
  const yTicks = 4;
  const yTickValues = Array.from({ length: yTicks + 1 }, (_, i) => (maxVal / yTicks) * i);
  const formatYTick = (v) => {
    if (metric === "cost") return `$${v < 1 ? v.toFixed(3) : v.toFixed(2)}`;
    if (v >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
    if (v >= 1000) return `${(v / 1000).toFixed(0)}K`;
    return v.toFixed(0);
  };

  // Hover detection
  const handleSvgMove = (e) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * W;
    if (dates.length === 0) return;
    let closestIdx = 0;
    let closestDist = Infinity;
    dates.forEach((_, i) => {
      const dist = Math.abs(xScale(i) - mx);
      if (dist < closestDist) { closestDist = dist; closestIdx = i; }
    });
    if (closestDist < 40) setHovered(closestIdx);
    else setHovered(null);
  };

  const filterSelect = {
    padding: "4px 10px", height: 30, borderRadius: 8,
    border: `1px solid ${COLORS.borderGrey}`, background: "rgba(255,255,255,0.88)",
    fontSize: 11, fontFamily: "Poppins, sans-serif", fontWeight: 500,
    color: COLORS.black, cursor: "pointer",
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          {providers.map((p) => (
            <div key={p} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: providerColors[p] || COLORS.blue }} />
              <span style={{ fontSize: 12, fontWeight: 500, color: COLORS.black, textTransform: "capitalize" }}>{p === "openai" ? "OpenAI" : p === "gemini" ? "Google Gemini" : p}</span>
            </div>
          ))}
        </div>
        <select value={metric} onChange={(e) => setMetric(e.target.value)} style={filterSelect}>
          <option value="tokens">Tokens</option>
          <option value="cost">Estimated Cost</option>
        </select>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }} onMouseMove={handleSvgMove} onMouseLeave={() => setHovered(null)}>
        {/* Grid lines */}
        {yTickValues.map((v, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={yScale(v)} y2={yScale(v)} stroke="rgba(180,200,230,0.25)" strokeWidth={1} />
            <text x={padL - 8} y={yScale(v) + 4} textAnchor="end" fontSize={10} fill={COLORS.mutedText} fontFamily="Poppins">{formatYTick(v)}</text>
          </g>
        ))}

        {/* X-axis labels */}
        {dates.map((d, i) => {
          // Show max ~10 labels
          if (dates.length > 12 && i % Math.ceil(dates.length / 10) !== 0 && i !== dates.length - 1) return null;
          const label = new Date(d + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
          return <text key={d} x={xScale(i)} y={H - 8} textAnchor="middle" fontSize={10} fill={COLORS.mutedText} fontFamily="Poppins">{label}</text>;
        })}

        {/* Lines */}
        {providers.map((p) => (
          <path key={p} d={buildPath(p)} fill="none" stroke={providerColors[p] || COLORS.blue} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
        ))}

        {/* Dots */}
        {providers.map((p) => dates.map((d, i) => {
          const v = getValue(d, p);
          if (v === 0) return null;
          return <circle key={`${p}-${i}`} cx={xScale(i)} cy={yScale(v)} r={hovered === i ? 5 : 3} fill={providerColors[p] || COLORS.blue} stroke="#fff" strokeWidth={1.5} style={{ transition: "r 150ms ease" }} />;
        }))}

        {/* Hover line + tooltip */}
        {hovered !== null && (
          <>
            <line x1={xScale(hovered)} x2={xScale(hovered)} y1={padT} y2={padT + chartH} stroke="rgba(23,101,212,0.2)" strokeWidth={1} strokeDasharray="4 3" />
          </>
        )}
      </svg>

      {/* Tooltip below chart */}
      {hovered !== null && dates[hovered] && (
        <div style={{ display: "flex", justifyContent: "center", gap: 20, marginTop: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: COLORS.black }}>
            {new Date(dates[hovered] + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
          </span>
          {providers.map((p) => {
            const v = getValue(dates[hovered], p);
            return (
              <span key={p} style={{ fontSize: 11, color: providerColors[p] || COLORS.blue, fontWeight: 500 }}>
                {p === "openai" ? "OpenAI" : "Gemini"}: {metric === "cost" ? `$${v.toFixed(4)}` : v.toLocaleString() + " tokens"}
              </span>
            );
          })}
        </div>
      )}
    </div>
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
export default function AdminDashboard({ isAdmin, currentUserName, currentUserEmail, currentUserImageUrl }) {
  const { getToken } = useAuth();
  const [period, setPeriod] = React.useState("month");
  const [data, setData] = React.useState(null);
  const [manualChanges, setManualChanges] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [resetConfirm, setResetConfirm] = React.useState(false);
  const [resetting, setResetting] = React.useState(false);
  // Both admins and advisors start at the main dashboard
  const [selectedUser, setSelectedUser] = React.useState(null);
  const [clerkUsers, setClerkUsers] = React.useState({});  // lookup map (includes alias keys) -> { id, role, email, image_url }
  const [clerkUsersList, setClerkUsersList] = React.useState([]); // canonical one-entry-per-Clerk-user list: [{ id, role, email, image_url, displayName }]
  const [pdfFilenames, setPdfFilenames] = React.useState(new Set()); // set of stored PDF filenames for smart links
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

      // Both admins and advisors fetch the same dashboard data
      const [summaryResp, changesResp, usersResp, fnResp] = await Promise.all([
        fetch(`${API_BASE_URL}/api/admin/analytics/summary?period=${period}`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_BASE_URL}/api/admin/analytics/manual-changes?period=${period}`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_BASE_URL}/api/admin/users`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_BASE_URL}/api/pdfs/filenames`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (!summaryResp.ok) {
        const detail = await summaryResp.json().catch(() => ({}));
        throw new Error(detail?.detail || `HTTP ${summaryResp.status}`);
      }
      setData(await summaryResp.json());
      if (changesResp.ok) setManualChanges(await changesResp.json());
      if (usersResp.ok) {
        const usersData = await usersResp.json();
        const map = {};        // alias lookup map — many keys point to the same info
        const canonical = [];  // one entry per Clerk user, in canonical display-name form
        for (const u of usersData.users || []) {
          const info = { id: u.id, role: u.role, email: u.email, image_url: u.image_url || "" };
          const first = (u.first_name || "").trim();
          const last = (u.last_name || "").trim();
          // Canonical display name — must mirror what trackEvent records as
          // user_name in analytics_events (see QuotifyHome.jsx):
          //   fullName || `${firstName} ${lastName}` || email
          const fullName = `${first} ${last}`.trim();
          const displayName = fullName || u.email || "Unknown";
          canonical.push({ ...info, displayName });

          // Build every plausible ALIAS key the analytics_events.user_name might
          // contain so the role-toggle lookup never silently misses a user
          // (e.g. jj has only a first name and was missing his role toggle).
          // These aliases are lookup-only — they must NOT leak into the
          // user list rendered by UserTable (that uses `canonical`).
          const candidateKeys = [
            fullName,
            first,
            last,
            u.email,
            (u.email || "").split("@")[0],
          ].filter(Boolean);
          for (const key of candidateKeys) {
            if (!map[key]) map[key] = info;
            const lower = key.toLowerCase();
            if (!map[lower]) map[lower] = info;
          }
          // Also index by the stable Clerk id so UserTable / UserDetail can
          // resolve Clerk metadata (role, avatar) directly from user_id
          // without a name fallback. This is the ONE stable identifier
          // across analytics_events and Clerk — user_name is display-only.
          if (u.id) map[u.id] = info;
        }
        setClerkUsers(map);
        setClerkUsersList(canonical);
      }
      if (fnResp.ok) {
        const fnData = await fnResp.json();
        setPdfFilenames(new Set(fnData.filenames || []));
      }
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
      className="dashScrollArea"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{
        height: "calc(100vh - 48px)",
        background: `linear-gradient(160deg, rgba(230,240,255,0.7) 0%, ${COLORS.pageBg} 30%, rgba(220,235,255,0.5) 60%, ${COLORS.pageBg} 80%, rgba(200,225,255,0.4) 100%)`,
        fontFamily: "Poppins, sans-serif",
        position: "relative",
        overflowY: "auto",
        overflowX: "hidden",
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
        position: "sticky", top: 0, left: 0, right: 0, zIndex: 20,
        padding: "18px 28px 14px 28px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        flexWrap: "wrap", gap: 12,
        pointerEvents: "none",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, pointerEvents: "auto" }}>
          {/* Back button — shown when viewing a specific user's page (admin or advisor) */}
          {selectedUser && (
            <BlurAura>
              <HoverButton
                variant="outline"
                onClick={() => setSelectedUser(null)}
                style={{ height: 48, padding: "0 22px" }}
              >
                Back
              </HoverButton>
            </BlurAura>
          )}
          {!selectedUser && (
          <BlurAura>
            <div style={{ padding: "4px 8px" }}>
              <div style={{ fontFamily: "SentientCustom, Georgia, serif", fontSize: 20, fontWeight: 600, lineHeight: 1.2, color: COLORS.black, marginBottom: 2 }}>
                Analytics Dashboard
              </div>
              <div style={{ fontSize: 12, color: COLORS.mutedText, fontWeight: 400, lineHeight: 1.35 }}>
                Showing data for: {periodLabel}
              </div>
            </div>
          </BlurAura>
          )}
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", pointerEvents: "auto" }}>
          <BlurAura>
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              style={{
                padding: "0 14px", height: 48, borderRadius: 14,
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
          <BlurAura>
            <HoverButton variant="outline" onClick={fetchAnalytics} disabled={loading} style={{ height: 48 }}>
              {loading ? "Loading..." : "Refresh"}
            </HoverButton>
          </BlurAura>
          <BlurAura>
            <HoverButton
              variant="danger"
              onClick={() => { if (isAdmin) setResetConfirm(true); }}
              disabled={!isAdmin}
              style={{ height: 48 }}
              title={!isAdmin ? "Only admins can clear data" : undefined}
            >
              Clear Data
            </HoverButton>
          </BlurAura>
        </div>
      </div>

      {/* Content area — padded at top to sit below the fixed header */}
      <div style={{ position: "relative", zIndex: 1, padding: "16px 28px 24px 28px" }}>

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

            {/* PDFs Generated + Insurance Type Leaderboard — 50/50 */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, alignItems: "stretch" }}>
              <Section title="PDFs Generated" tightHeader>
                <div style={{
                  display: "flex", flexDirection: "column", alignItems: "flex-start",
                  justifyContent: "space-between", minHeight: 240, height: "100%",
                }}>
                  <div style={{ fontSize: 13, color: COLORS.mutedText, fontWeight: 400 }}>
                    All tracked workflows
                  </div>
                  <div style={{
                    fontSize: 220, fontWeight: 700, color: COLORS.blue,
                    lineHeight: 0.82, fontFamily: "Poppins, sans-serif",
                    letterSpacing: "-0.04em", marginTop: "auto",
                  }}>
                    {data.total_events}
                  </div>
                </div>
              </Section>
              <Section title="Insurance Type Leaderboard" expandable allowOverflow>
                {(expanded) => <InsuranceBreakdown data={data.usage_by_insurance_type} limit={expanded ? 15 : 5} />}
              </Section>
            </div>

            {/* Quotes Timeline — stacked bar chart by insurance type */}
            <Section title="Quotes Generated" allowOverflow tightHeader>
              <QuotesTimeline events={data.recent_events} period={period} />
            </Section>

            {/* Team Leaderboard + Manual Changes — side by side */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, alignItems: "stretch" }}>
              <Section title="Team Leaderboard" expandable action={
                <div style={{ fontSize: 12, color: COLORS.mutedText }}>Click a user for details</div>
              }>
                {(expanded) => <UserTable users={data.usage_by_user} clerkUsers={clerkUsers} clerkUsersList={clerkUsersList} onSelectUser={setSelectedUser} limit={expanded ? 15 : 5} />}
              </Section>
              <Section title="Manual Changes Leaderboard" expandable>
                {/* Closed-state limit is 9 (not 5) because the sibling Team
                    Leaderboard on the left — a full <table> with a thead and
                    56px avatar rows — runs ~150px taller than 5 manual-change
                    rows would. Matching the visual weight of the left card
                    keeps the side-by-side grid from looking lopsided. */}
                {(expanded) => <ManualChangesLeaderboard data={manualChanges?.leaderboard} limit={expanded ? 15 : 9} />}
              </Section>
            </div>

            {/* Snapshot History */}
            <Section title="Snapshot History" expandable>
              {(expanded) => <SnapshotHistory events={data.recent_events} getToken={getToken} onRefresh={fetchAnalytics} limit={expanded ? 30 : 5} isAdmin={isAdmin} pdfFilenames={pdfFilenames} />}
            </Section>

            {/* PDF Storage Management */}
            <Section title="PDF Storage" expandable>
              {(expanded) => expanded ? <PdfStorageManager getToken={getToken} isAdmin={isAdmin} onRefresh={fetchAnalytics} /> : (
                <div style={{ color: COLORS.mutedText, fontSize: 13 }}>Expand to manage stored PDFs, set auto-clear schedule, or clear storage.</div>
              )}
            </Section>

            {/* API Usage */}
            <Section title="API Usage" expandable defaultExpanded>
              {(expanded) => expanded ? <ApiUsageGraph period={period} getToken={getToken} /> : (
                <div style={{ color: COLORS.mutedText, fontSize: 13 }}>Expand to view OpenAI and Gemini token usage and cost over time.</div>
              )}
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
