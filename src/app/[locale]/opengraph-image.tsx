import { ImageResponse } from "next/og";

// Social share card (also used as the Twitter image). Generated at build/request time —
// no binary asset to maintain.
//
// Under [locale], not app/: a file-based image applies to its own segment and the ones below it, and
// at app/ that is only "/", which redirects. Every real page lives under [locale], so the card was
// never on any of them — shared links went out with no og:image at all (Nov 2026 review).
export const alt = "BedReady — make any 3MF ready for the Snapmaker U1";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          background: "linear-gradient(135deg, #0b1120 0%, #131a2c 100%)",
          padding: "80px",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "16px",
            color: "#fdba74",
            fontSize: 30,
            fontWeight: 600,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          <div style={{ width: 14, height: 14, borderRadius: 999, background: "#f97316" }} />
          for Snapmaker U1
        </div>

        <div style={{ display: "flex", color: "white", fontSize: 88, fontWeight: 800, marginTop: 28 }}>
          Bed<span style={{ color: "#f97316" }}>Ready</span>
        </div>

        <div style={{ color: "#cbd5e1", fontSize: 40, marginTop: 12, maxWidth: 900 }}>
          Bambu, Prusa, Orca &amp; MakerWorld 3MF files, converted in your browser.
        </div>

        <div style={{ color: "#64748b", fontSize: 28, marginTop: 40 }}>bedready.io</div>
      </div>
    ),
    { ...size },
  );
}
