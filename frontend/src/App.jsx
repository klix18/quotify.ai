import React from "react";
import {
  SignedIn,
  SignedOut,
  SignInButton,
  useUser,
} from "@clerk/clerk-react";
import COLORS from "./colors";
import QuotifyHome from "./QuotifyHome";
import AdminDashboard from "./AdminDashboard";

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

function AuthenticatedApp() {
  const { user } = useUser();
  const [showActivity, setShowActivity] = React.useState(false);
  const isAdmin = user?.publicMetadata?.role === "admin";
  const userName = user?.fullName || user?.primaryEmailAddress?.emailAddress || "";

  if (showActivity) {
    return (
      <AdminDashboard
        onBack={() => setShowActivity(false)}
        isAdmin={isAdmin}
        currentUserName={userName}
      />
    );
  }

  return (
    <QuotifyHome
      isAdmin={isAdmin}
      onOpenActivity={() => setShowActivity(true)}
    />
  );
}

function App() {
  return (
    <>
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
