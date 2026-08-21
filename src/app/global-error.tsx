"use client";

import { useEffect } from "react";

// Root error boundary — catches failures above the locale layout (where the localized error.tsx can't
// run). Must render its own <html>/<body>. Reports to the lightweight client-error sink.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
    try {
      navigator.sendBeacon?.(
        "/api/client-error",
        JSON.stringify({ message: error.message, stack: error.stack, digest: error.digest, url: location.href }),
      );
    } catch {
      /* ignore */
    }
  }, [error]);

  return (
    // This boundary renders ABOVE the locale layout, so it can't use globals.css tokens, the theme
    // script or next-intl. Everything is inlined — but it must still look like BedReady: Spectrum
    // gradient (violet → cyan → lime) on the light default theme, matching the rest of the site.
    <html lang="en">
      <body style={{ background: "#ffffff", color: "#0f172a", fontFamily: "system-ui, sans-serif", margin: 0 }}>
        <main style={{ maxWidth: 480, margin: "0 auto", padding: "96px 24px", textAlign: "center" }}>
          
          <h1 style={{ fontSize: 24, fontWeight: 700, marginTop: 16 }}>Something went wrong</h1>
          <p style={{ color: "#334155", marginTop: 8 }}>An unexpected error occurred. Try again, or head back home.</p>
          <div style={{ marginTop: 28, display: "flex", gap: 12, justifyContent: "center" }}>
            <button
              onClick={reset}
              style={{
                backgroundImage: "linear-gradient(100deg, #7c3aed, #06b6d4 55%, #84cc16)",
                color: "#fff", fontWeight: 600, padding: "10px 20px", borderRadius: 12, border: 0, cursor: "pointer",
              }}
            >
              Try again
            </button>
            <a
              href="/"
              style={{ border: "1px solid #e2e8f0", color: "#0f172a", fontWeight: 600, padding: "10px 20px", borderRadius: 12, textDecoration: "none" }}
            >
              Home
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
