import React from "react";
import {
  SignedIn,
  SignedOut,
  SignInButton,
  UserButton,
  useUser,
} from "@clerk/clerk-react";
import { Routes, Route, useNavigate, useLocation } from "react-router-dom";
import COLORS from "./colors";
import QuotifyHome from "./QuotifyHome";
import AdminDashboard from "./AdminDashboard";
import ChatMemoryPage from "./ChatMemoryPage";

function SignInPage() {
  const mainRef = React.useRef(null);
  const orbPrimaryRef = React.useRef(null);
  const orbCyanRef = React.useRef(null);
  const orbTrailRef = React.useRef(null);
  const mouseTarget = React.useRef({ x: 0, y: 0 });
  const orbPrimary = React.useRef({ x: 0, y: 0 });
  const orbCyan = React.useRef({ x: 0, y: 0 });
  const orbTrail = React.useRef({ x: 0, y: 0 });
  const velocity = React.useRef({ x: 0, y: 0 });
  const prevSmooth = React.useRef({ x: 0, y: 0 });
  const rafId = React.useRef(null);
  const mouseInside = React.useRef(false);
  const [isHovered, setIsHovered] = React.useState(false);

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
      velocity.current.x = lerp(velocity.current.x, vx, 0.15);
      velocity.current.y = lerp(velocity.current.y, vy, 0.15);
      prevSmooth.current.x = orbPrimary.current.x;
      prevSmooth.current.y = orbPrimary.current.y;

      const speed = Math.sqrt(velocity.current.x ** 2 + velocity.current.y ** 2);
      const angle = Math.atan2(velocity.current.y, velocity.current.x) * (180 / Math.PI);
      const stretchAmt = clamp(1 + speed * 0.06, 1, 2.0);
      const squishAmt = clamp(1 - speed * 0.015, 0.7, 1);
      const opacity = mouseInside.current ? 1 : 0;

      if (orbPrimaryRef.current) {
        orbPrimaryRef.current.style.transform = `translate(${orbPrimary.current.x - 200}px, ${orbPrimary.current.y - 200}px) rotate(${angle}deg) scale(${stretchAmt}, ${squishAmt})`;
        orbPrimaryRef.current.style.opacity = opacity;
      }
      if (orbCyanRef.current) {
        orbCyanRef.current.style.transform = `translate(${orbCyan.current.x - 250}px, ${orbCyan.current.y - 250}px)`;
        orbCyanRef.current.style.opacity = opacity;
      }
      if (orbTrailRef.current) {
        orbTrailRef.current.style.transform = `translate(${orbTrail.current.x - 350}px, ${orbTrail.current.y - 350}px)`;
        orbTrailRef.current.style.opacity = opacity;
      }

      rafId.current = requestAnimationFrame(tick);
    };

    rafId.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId.current);
  }, []);

  const handleMouseMove = (e) => {
    mouseTarget.current = { x: e.clientX, y: e.clientY };
    mouseInside.current = true;
  };

  const handleMouseLeave = () => {
    mouseInside.current = false;
  };

  return (
    <div
      ref={mainRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{
        height: "100vh",
        overflow: "hidden",
        background: "#EFF2F7",
        fontFamily: "Poppins, sans-serif",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        position: "relative",
      }}
    >
      {/* Large background graphic — right side, cropped off edge */}
      <div
        style={{
          position: "absolute",
          right: -300,
          top: "50%",
          transform: "translateY(-50%)",
          height: "90vh",
          overflow: "hidden",
          pointerEvents: "none",
          zIndex: 0,
        }}
      >
        <img
          src="/snapshot-logo-graphic2.svg"
          alt=""
          style={{
            height: "100%",
            opacity: 0.5,
          }}
        />
      </div>

      {/* Orbs */}
      <div ref={orbPrimaryRef} style={{ position: "absolute", top: 0, left: 0, width: 400, height: 400, borderRadius: "50%", background: "rgba(23,101,212,0.14)", filter: "blur(80px)", pointerEvents: "none", zIndex: 0, willChange: "transform, opacity", opacity: 0, transition: "opacity 0.4s ease" }} />
      <div ref={orbCyanRef} style={{ position: "absolute", top: 0, left: 0, width: 500, height: 500, borderRadius: "50%", background: "rgba(201,242,255,0.22)", filter: "blur(100px)", pointerEvents: "none", zIndex: 0, willChange: "transform, opacity", opacity: 0, transition: "opacity 0.6s ease" }} />
      <div ref={orbTrailRef} style={{ position: "absolute", top: 0, left: 0, width: 700, height: 700, borderRadius: "50%", background: "rgba(11,145,230,0.08)", filter: "blur(120px)", pointerEvents: "none", zIndex: 0, willChange: "transform, opacity", opacity: 0, transition: "opacity 1s ease" }} />

      {/* Glass card */}
      <div
        style={{
          position: "relative",
          borderRadius: 24,
          overflow: "hidden",
          border: "none",
          zIndex: 1,
          width: 400,
        }}
      >
        {/* Glass base */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(255,255,255,0.70)",
            backdropFilter: "blur(48px) saturate(2.0) brightness(1.05)",
            WebkitBackdropFilter: "blur(48px) saturate(2.0) brightness(1.05)",
            zIndex: 0,
          }}
        />
        {/* Refraction highlights */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 24,
            boxShadow:
              "inset 0 2px 0 0 rgba(255,255,255,1), inset 0 -1px 0 0 rgba(255,255,255,0.2), inset 1px 0 0 0 rgba(255,255,255,0.4), inset -1px 0 0 0 rgba(255,255,255,0.4)",
            zIndex: 3,
            pointerEvents: "none",
          }}
        />
        {/* Rainbow refraction shimmer */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: "10%",
            right: "10%",
            height: 1,
            background: "linear-gradient(90deg, transparent, rgba(255,100,100,0.15), rgba(255,255,100,0.1), rgba(100,200,255,0.15), transparent)",
            zIndex: 4,
            pointerEvents: "none",
          }}
        />

        {/* Content */}
        <div
          style={{
            position: "relative",
            zIndex: 5,
            padding: "48px 40px 44px 40px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 0,
          }}
        >
          {/* Logo */}
          <img
            src="/snapshot-logo-1.png"
            alt="The Sizemore Snapshot"
            style={{ height: 48, marginBottom: 24 }}
          />

          {/* Title */}
          <div
            style={{
              fontFamily: "SentientCustom, Georgia, serif",
              fontSize: 38,
              fontWeight: 700,
              lineHeight: 1.0,
              letterSpacing: "-0.06em",
              color: COLORS.black,
              textAlign: "center",
              marginBottom: 8,
            }}
          >
            The Sizemore Snapshot
          </div>

          {/* Description */}
          <div
            style={{
              fontSize: 13,
              color: COLORS.mutedText,
              lineHeight: 1.45,
              textAlign: "center",
              marginBottom: 32,
            }}
          >
            AI quote intake, extraction, review, and download in one workspace.
          </div>

          {/* Sign In Button — matches Create Quote */}
          <SignInButton mode="modal">
            <button
              type="button"
              onMouseEnter={() => setIsHovered(true)}
              onMouseLeave={() => setIsHovered(false)}
              style={{
                background: COLORS.blue,
                color: COLORS.white,
                border: `1px solid ${COLORS.blue}`,
                borderRadius: 14,
                height: 48,
                width: 180,
                padding: 0,
                fontSize: 14,
                fontWeight: 600,
                fontFamily: "Poppins, sans-serif",
                cursor: "pointer",
                transition: "all 200ms ease",
                boxShadow: isHovered
                  ? `0 0 28px ${COLORS.hoverShadow}`
                  : "0 0 0 rgba(0,0,0,0)",
              }}
            >
              Sign In
            </button>
          </SignInButton>
        </div>
      </div>
    </div>
  );
}

/* ── Shared Top Nav ────────────────────────────────────────────── */
function TopNav({ isAdmin }) {
  const navigate = useNavigate();
  const location = useLocation();
  const isSnapshot = location.pathname === "/";
  const isDashboard = location.pathname.startsWith("/dashboard");

  const tabRef0 = React.useRef(null);
  const tabRef1 = React.useRef(null);
  const containerRef = React.useRef(null);
  const [indicator, setIndicator] = React.useState({ left: 0, width: 0 });

  React.useEffect(() => {
    const activeRef = isDashboard ? tabRef1 : tabRef0;
    const tab = activeRef.current;
    const container = containerRef.current;
    if (tab && container) {
      const tRect = tab.getBoundingClientRect();
      const cRect = container.getBoundingClientRect();
      setIndicator({ left: tRect.left - cRect.left, width: tRect.width });
    }
  }, [isSnapshot, isDashboard]);

  const tabStyle = (active) => ({
    background: "none",
    border: "none",
    borderBottom: "2.5px solid transparent",
    padding: "14px 18px 12px 18px",
    fontSize: 14,
    fontWeight: 500,
    color: active ? COLORS.blue : COLORS.mutedText,
    cursor: "pointer",
    fontFamily: "Poppins, sans-serif",
    transition: "color 150ms ease",
  });

  return (
    <nav style={{
      position: "fixed", top: 0, left: 0, right: 0, zIndex: 100,
      height: 48,
      display: "flex", alignItems: "stretch", justifyContent: "center",
      background: "rgba(255,255,255,0.85)",
      borderBottom: "1px solid rgba(180,200,230,0.25)",
      fontFamily: "Poppins, sans-serif",
    }}>
      {/* Logo — left */}
      <div style={{ position: "absolute", left: 18, top: 0, bottom: 0, display: "flex", alignItems: "center" }}>
        <img src="/snapshot-logo-1.png" alt="Sizemore" style={{ height: 24 }} />
      </div>
      {/* Tabs — center */}
      <div ref={containerRef} style={{ display: "flex", alignItems: "stretch", gap: 4, position: "relative" }}>
        <button ref={tabRef0} onClick={() => navigate("/")} style={tabStyle(isSnapshot)}>Snapshot</button>
        <button ref={tabRef1} onClick={() => navigate("/dashboard")} style={tabStyle(isDashboard)}>Dashboard</button>
        {/* Sliding indicator */}
        <div style={{
          position: "absolute",
          bottom: 0,
          left: indicator.left,
          width: indicator.width,
          height: 2.5,
          borderRadius: 2,
          background: COLORS.blue,
          transition: "left 300ms cubic-bezier(0.4, 0, 0.2, 1), width 300ms cubic-bezier(0.4, 0, 0.2, 1)",
          pointerEvents: "none",
        }} />
      </div>
      {/* Role badge + profile — right */}
      <div style={{ position: "absolute", right: 18, top: 0, bottom: 0, display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{
          fontSize: 11, fontWeight: 600, textTransform: "capitalize",
          color: COLORS.blue, background: COLORS.blueSoft,
          padding: "4px 12px", borderRadius: 8,
          border: `1px solid ${COLORS.blueBorder}`,
        }}>
          {isAdmin ? "Admin" : "Advisor"}
        </span>
        <UserButton
          appearance={{
            elements: {
              avatarBox: { width: 30, height: 30 },
            },
          }}
        />
      </div>
    </nav>
  );
}

function AuthenticatedApp() {
  const { user } = useUser();
  const navigate = useNavigate();
  const isAdmin = user?.publicMetadata?.role === "admin";
  const userName = user?.fullName || user?.primaryEmailAddress?.emailAddress || "";
  const userEmail = user?.primaryEmailAddress?.emailAddress || "";
  const userImageUrl = user?.imageUrl || "";

  return (
    <>
      <TopNav isAdmin={isAdmin} />
      <div style={{ paddingTop: 48 }}>
        <Routes>
          <Route
            path="/"
            element={
              <QuotifyHome
                isAdmin={isAdmin}
              />
            }
          />
          <Route
            path="/dashboard"
            element={
              <AdminDashboard
                isAdmin={isAdmin}
                currentUserName={userName}
                currentUserEmail={userEmail}
                currentUserImageUrl={userImageUrl}
              />
            }
          />
          <Route
            path="/dashboard/memory"
            element={
              <ChatMemoryPage onBack={() => navigate("/dashboard")} />
            }
          />
        </Routes>
      </div>
    </>
  );
}

/* ── Mobile Blocker ────────────────────────────────────────────
 * The Snapshot app is hover-heavy and laid out for landscape laptop
 * screens. Below ~750px (phones + narrow portrait tablets) nothing
 * fits, so we show a full-screen "please use desktop" message instead.
 */
const MOBILE_BLOCK_BREAKPOINT = 750;

function MobileBlocker() {
  const [winW, setWinW] = React.useState(
    typeof window !== "undefined" ? window.innerWidth : 1920
  );
  React.useEffect(() => {
    const onResize = () => setWinW(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  if (winW >= MOBILE_BLOCK_BREAKPOINT) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        background: "#EFF2F7",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px 24px",
        fontFamily: "Poppins, sans-serif",
        // Block scroll and any interaction with the app behind us.
        overflow: "hidden",
        touchAction: "none",
      }}
    >
      {/* Subtle background orbs to match the rest of the app */}
      <div style={{
        position: "absolute", top: "-10%", left: "-10%",
        width: 360, height: 360, borderRadius: "50%",
        background: "rgba(23,101,212,0.14)", filter: "blur(80px)",
        pointerEvents: "none",
      }} />
      <div style={{
        position: "absolute", bottom: "-15%", right: "-15%",
        width: 420, height: 420, borderRadius: "50%",
        background: "rgba(201,242,255,0.22)", filter: "blur(100px)",
        pointerEvents: "none",
      }} />

      {/* Glass card */}
      <div
        style={{
          position: "relative",
          borderRadius: 22,
          overflow: "hidden",
          maxWidth: 380,
          width: "100%",
        }}
      >
        {/* Glass base */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(255,255,255,0.72)",
            backdropFilter: "blur(40px) saturate(2.0) brightness(1.05)",
            WebkitBackdropFilter: "blur(40px) saturate(2.0) brightness(1.05)",
            zIndex: 0,
          }}
        />
        {/* Inset highlight */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 22,
            boxShadow:
              "inset 0 2px 0 0 rgba(255,255,255,1), inset 0 -1px 0 0 rgba(255,255,255,0.2), inset 1px 0 0 0 rgba(255,255,255,0.4), inset -1px 0 0 0 rgba(255,255,255,0.4)",
            zIndex: 3,
            pointerEvents: "none",
          }}
        />

        {/* Content */}
        <div
          style={{
            position: "relative",
            zIndex: 5,
            padding: "36px 28px 32px 28px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
          }}
        >
          <img
            src="/snapshot-logo-1.png"
            alt="The Sizemore Snapshot"
            style={{ height: 38, marginBottom: 22 }}
          />

          <div
            style={{
              fontFamily: "SentientCustom, Georgia, serif",
              fontSize: 28,
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: "-0.04em",
              color: COLORS.black,
              marginBottom: 12,
            }}
          >
            Please use this app on desktop
          </div>

          <div
            style={{
              fontSize: 13,
              color: COLORS.mutedText,
              lineHeight: 1.5,
              marginBottom: 4,
            }}
          >
            The Sizemore Snapshot is built for a larger screen. Open this page
            on a laptop or desktop browser to sign in and start generating quotes.
          </div>
        </div>
      </div>
    </div>
  );
}

function App() {
  return (
    <>
      <MobileBlocker />
      <SignedOut>
        <SignInPage />
      </SignedOut>
      <SignedIn>
        <AuthenticatedApp />
      </SignedIn>
    </>
  );
}

export default App;
