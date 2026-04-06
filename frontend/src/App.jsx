import {
  SignedIn,
  SignedOut,
  SignInButton,
  UserButton,
} from "@clerk/clerk-react";
import QuotifyHome from "./QuotifyHome";

function App() {
  return (
    <>
      <SignedOut>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            height: "100vh",
            flexDirection: "column",
            gap: "1rem",
          }}
        >
          <h1>The Sizemore Snapshot</h1>
          <p>Sign in to continue</p>
          <SignInButton mode="modal">
            <button
              style={{
                padding: "0.75rem 2rem",
                fontSize: "1rem",
                borderRadius: "8px",
                border: "none",
                background: "#6C47FF",
                color: "white",
                cursor: "pointer",
              }}
            >
              Sign In
            </button>
          </SignInButton>
        </div>
      </SignedOut>
      <SignedIn>
        <div style={{ position: "fixed", top: "1rem", right: "1rem", zIndex: 1000 }}>
          <UserButton />
        </div>
        <QuotifyHome />
      </SignedIn>
    </>
  );
}

export default App;