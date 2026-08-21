import createNextIntlPlugin from "next-intl/plugin";

// Full CSP, now ENFORCED. It shipped report-only on 2026-07-04 so violations could be observed
// without breaking anything; promoted 2026-07-25 after walking every route (home, /convert,
// /designs, /orca-filaments + locale variants, /app, /extension, /mixer, /features, /stickers,
// /help, /guides, /changelog, /compare-multicolor-printers, the source→U1 landing pages, /licenses,
// /privacy, /feedback, /login, /age) with no report-only violations logged.
//
// Sources reflect the app's real dependencies: Supabase (data + public image bucket + realtime),
// Vercel Analytics, Cloudflare Turnstile, and cover images hotlinked from arbitrary https hosts.
// Inline scripts (the no-flash theme script, analytics) keep 'unsafe-inline' because nonces would
// force every page dynamic and break the ISR caching the app relies on; the policy still restricts
// script/connect ORIGINS, which is the meaningful defense given the stored-XSS sinks are escaped.
//
// TO ROLL BACK: rename the `Content-Security-Policy` header below to
// `Content-Security-Policy-Report-Only`. That reverts to observe-only in one line with no other
// change. Do that first if anything breaks, then diagnose from the console.

/**
 * The ONE cross-origin the converter talks to, named exactly.
 *
 * ── WHAT THIS REPLACED ────────────────────────────────────────────────────────────────────────
 *
 * In the combined repository this function named the Supabase origin, because every page carried a
 * Supabase client. This build has none — the converter is anonymous and backend-free, which is what
 * lets this repository be public. What it does still call is four small endpoints that stayed with
 * MakerRun: the conversion counter, the opt-in failure report, the optional server-side conversion
 * fallback, and the capture panel's notify box. See `src/lib/convert-api.ts`.
 *
 * ── AND THIS IS THE PART THAT FAILS SILENTLY IF IT IS WRONG ───────────────────────────────────
 *
 * Those calls are SAME-ORIGIN while one deployment serves both sites, and CROSS-ORIGIN the moment
 * the converter moves here. A `connect-src` that does not name the API origin refuses them in the
 * browser, with nothing on the server to show for it: no request arrives, no log line is written,
 * and the only evidence is a console error on someone else's machine. The counter would simply
 * stop, and a failed conversion would never be reported.
 *
 * So the origin is read from the same variable the client is compiled against
 * (`NEXT_PUBLIC_CONVERT_API_ORIGIN`), which makes the policy self-maintaining: no build can allow
 * an origin it does not already call, and none can call one it has not allowed. Empty means
 * same-origin, which needs no entry and is the correct answer before the split.
 */
function convertApiCspSources() {
  const raw = (process.env.NEXT_PUBLIC_CONVERT_API_ORIGIN || "").trim().replace(/\/+$/, "");
  if (!raw) return []; // same-origin: `connect-src 'self'` already covers it
  try {
    return [new URL(raw).origin];
  } catch {
    console.warn(
      "[csp] NEXT_PUBLIC_CONVERT_API_ORIGIN is set but is not a URL — the policy will not name it, " +
        "so the counter and failure-report calls will be refused in the browser with no server-side trace.",
    );
    return [];
  }
}

const convertApi = convertApiCspSources();

const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  // Only ever submit forms back to us (the /api/unsubscribe confirmation page posts to itself).
  "form-action 'self'",
  "img-src 'self' https: data: blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://va.vercel-scripts.com",
  [
    "connect-src 'self'",
    ...convertApi,
    "https://va.vercel-scripts.com https://*.vercel-insights.com https://challenges.cloudflare.com",
  ].join(" "),
  "frame-src https://challenges.cloudflare.com",
  "worker-src 'self' blob:",
].join("; ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the workspace root to this folder. Without this, Next gets confused by an
  // unrelated package-lock.json that already exists in the home directory.
  outputFileTracingRoot: import.meta.dirname,
  // The published API contract is rendered from docs/API.md, which keeps that file the single source
  // (see src/lib/api-doc.ts). Tracing cannot see through `join(process.cwd(), …)` to work out that the
  // file is a dependency, so it is pinned here. Both routes are `force-static` and read it at build,
  // but if either ever renders at request time an untraced file is an ENOENT — on the one pair of
  // routes that stay up while the maintenance gate is closed.
  outputFileTracingIncludes: {
    "/docs": ["./docs/API.md"],
    "/docs/api.md": ["./docs/API.md"],
  },
  // three.js ships ESM example modules (loaders/controls); transpile to be safe.
  transpilePackages: ["three"],
  // Baseline security headers on every response. The CSP is enforced (see the note on `CSP`).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "X-DNS-Prefetch-Control", value: "on" },
          { key: "Content-Security-Policy", value: CSP },
        ],
      },
    ];
  },
};

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");
export default withNextIntl(nextConfig);
