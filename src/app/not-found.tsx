import { CONVERTER_ORIGIN, LIBRARY_ORIGIN } from "@/lib/origin";

/**
 * The 404 for a URL that resolves to no route at all.
 *
 * ── WHY THE `[locale]` ONE IS NOT ENOUGH ────────────────────────────────────────────────────────
 *
 * `[locale]/not-found.tsx` cannot render until the `[locale]` segment resolves. A URL matching
 * nothing never gets that far, so Next falls back to its own built-in page — "This page could not be
 * found", no header, no footer, no branding, no dark mode. Measured on the live sites: that stock
 * page is still what a mistyped URL reaches today, on both hosts, which is why this file exists.
 *
 * ── AND WHY IT LOOKS NOTHING LIKE THE OTHER TWO ─────────────────────────────────────────────────
 *
 * It renders ABOVE the locale layout, so it has no next-intl provider, no theme script and no
 * `globals.css` tokens. The first attempt reused the shared `NotFoundBody`, and the build caught it:
 * `useTranslations` threw while prerendering `/_not-found`, because there is no request locale to
 * resolve. That failure is the whole reason this page is hand-inlined.
 *
 * `global-error.tsx` sits at the same level and made the same trade for the same reason; this
 * deliberately matches its approach — inline styles, English only, the light default theme, and the
 * spectrum sweep so it still reads as BedReady.
 */
export default function NotFound() {
  return (
    <>
      {/* This page had NO title at all — the tab showed the bare URL. It renders above the locale
          layout, so there is no metadata to inherit and no next-intl to translate with; the rest of
          the file is hand-inlined English for the same reason. A <title> in the tree is hoisted into
          <head>, which is the only mechanism available here: metadata exports are ignored in
          not-found.tsx (probed) and a page reached this way never had a generateMetadata to run. */}
      <title>Page not found</title>
    <main
      style={{
        maxWidth: 520,
        margin: "0 auto",
        padding: "96px 24px",
        textAlign: "center",
        fontFamily: "system-ui, sans-serif",
        color: "#0f172a",
      }}
    >
      <p style={{ fontSize: 44, fontWeight: 800, margin: 0, color: "#7c3aed", letterSpacing: "-0.02em" }}>404</p>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: "12px 0 0" }}>Page not found</h1>
      <p style={{ color: "#334155", margin: "8px 0 0", lineHeight: 1.6 }}>
        That file or page doesn’t exist — it may have been moved or removed.
      </p>
      <div style={{ marginTop: 28, display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
        <a
          href={`${CONVERTER_ORIGIN}/convert`}
          style={{
            backgroundImage: "linear-gradient(100deg, #6d28d9, #155e75 55%, #3f6212)",
            color: "#fff",
            fontWeight: 600,
            padding: "10px 20px",
            borderRadius: 8,
            textDecoration: "none",
          }}
        >
          Convert a file
        </a>
        <a
          href={`${LIBRARY_ORIGIN}/verified`}
          style={{
            border: "1px solid #e2e8f0",
            color: "#0f172a",
            fontWeight: 600,
            padding: "10px 20px",
            borderRadius: 8,
            textDecoration: "none",
          }}
        >
          Visit MakerRun ↗
        </a>
      </div>
      <p style={{ marginTop: 40, fontSize: 13, color: "#475569", lineHeight: 1.6 }}>
        BedReady converts the file. MakerRun is its sister site, where the verified files live.
      </p>
    </main>
    </>
  );
}
