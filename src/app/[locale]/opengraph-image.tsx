import { ImageResponse } from "next/og";
import { getTranslations } from "next-intl/server";
import { CardLine, cardFonts, CARD_FONT_FAMILY } from "@/lib/og-card";

// Social share card (also used as the Twitter image). Generated at build/request time —
// no binary asset to maintain.
//
// Under [locale], not app/: a file-based image applies to its own segment and the ones below it, and
// at app/ that is only "/", which redirects. Every real page lives under [locale], so the card was
// never on any of them — shared links went out with no og:image at all (Nov 2026 review).
//
// In the page's language. satori neither shapes nor reorders Arabic, so the card text goes through
// og-card.tsx / card-text.ts (copied from makerrun, where they were built for the same renderer) with
// the bundled Noto fonts; Japanese and Chinese glyphs still come from next/og's own font fallback.
export const alt = "BedReady — make any 3MF ready for the Snapmaker U1";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta" });
  const dir = locale === "ar" ? "rtl" : "ltr";
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: dir === "rtl" ? "flex-end" : "flex-start",
          background: "linear-gradient(135deg, #0b1120 0%, #131a2c 100%)",
          padding: "80px",
          fontFamily: CARD_FONT_FAMILY,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: dir === "rtl" ? "row-reverse" : "row",
            alignItems: "center",
            gap: "16px",
          }}
        >
          <div style={{ width: 14, height: 14, borderRadius: 999, background: "#f97316" }} />
          <CardLine
            text={t("ogCardKicker")}
            dir={dir}
            style={{ color: "#fdba74", fontSize: 30, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase" }}
          />
        </div>

        {/* The wordmark is the brand, the same in every language. */}
        <div style={{ display: "flex", color: "white", fontSize: 88, fontWeight: 800, marginTop: 28 }}>
          Bed<span style={{ color: "#f97316" }}>Ready</span>
        </div>

        <CardLine
          text={t("ogCardTagline")}
          dir={dir}
          // No `undefined` style values: satori trims every one and throws on them.
          style={{ color: "#cbd5e1", fontSize: 40, marginTop: 12, maxWidth: 900 }}
        />

        <div style={{ color: "#64748b", fontSize: 28, marginTop: 40 }}>bedready.io</div>
      </div>
    ),
    { ...size, fonts: await cardFonts() },
  );
}
