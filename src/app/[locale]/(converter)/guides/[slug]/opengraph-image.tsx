import { ImageResponse } from "next/og";
import { GUIDES, guideBySlug } from "@/lib/guides";

// Prerender the card for every known guide — fully static, no runtime CPU.
export function generateStaticParams() {
  return GUIDES.map((g) => ({ slug: g.slug }));
}

// Per-guide social share card. Guide title over the BedReady brand gradient.
export const alt = "A BedReady guide for the Snapmaker U1";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
// Guide content is static; cache the generated card for a day to avoid re-rendering per crawler hit.
export const revalidate = 86400;

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const guide = guideBySlug(slug);
  const title = guide?.title ?? "BedReady guide";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "linear-gradient(135deg, #0b1120 0%, #131a2c 100%)",
          padding: "80px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ width: 14, height: 14, borderRadius: 999, background: "#f97316" }} />
          {/* display:flex is not cosmetic here. satori throws on any element with more than one child
              node and no explicit display, and this div has two ("Bed" and the span). Without it the
              whole route 500s — see src/app/opengraph-image.tsx, which has always carried it. */}
          <div style={{ display: "flex", color: "white", fontSize: 34, fontWeight: 800 }}>
            Bed<span style={{ color: "#f97316" }}>Ready</span>
          </div>
          <div style={{ display: "flex", marginLeft: 12, background: "rgba(249,115,22,0.15)", color: "#fdba74", fontSize: 22, fontWeight: 700, padding: "6px 16px", borderRadius: 999 }}>
            Guide
          </div>
        </div>

        <div style={{ display: "flex", color: "white", fontSize: 64, fontWeight: 800, lineHeight: 1.08, maxWidth: 1040 }}>
          {title.length > 100 ? title.slice(0, 97) + "…" : title}
        </div>

        <div style={{ color: "#94a3b8", fontSize: 30 }}>Multicolor on the Snapmaker U1 · bedready.io</div>
      </div>
    ),
    { ...size },
  );
}
