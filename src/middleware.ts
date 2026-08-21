import { NextResponse, type NextRequest } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";
import { frontDoorPath } from "./lib/front-door";
import { crossOriginRedirect } from "./lib/origin";

/**
 * Three jobs: the front door, the cross-origin 301s, then locale detection.
 *
 * ── WHAT THE LIBRARY'S MIDDLEWARE DID THAT THIS ONE DOES NOT ────────────────────────────────────
 *
 * The combined site's middleware ran six. Four belonged to the library and none can exist here,
 * which is the clearest single measure of what this repository gave up by becoming backend-free:
 *
 *   · **The docs host.** `docs.bedready.io` serves the library's API contract — a versioned surface
 *     over the design library. It moved to MakerRun with the API it documents.
 *   · **The planned-downtime gate.** It existed to keep requests away from Supabase during a
 *     hand-applied migration. There is no database here to protect.
 *   · **Creator storefronts** (`/@handle`). A library concept.
 *   · **The Supabase session refresh.** Converting requires no account, by decision.
 *
 * ── THE CROSS-ORIGIN 301s ARE NOW HERE, AND THEY WERE NOT ───────────────────────────────────────
 *
 * This file used to say they were absent on purpose: "this deployment only answers for converter
 * routes, so a library path reaches a 404 rather than a redirect. That rule belongs to the host that
 * still serves both."
 *
 * The cutover is what falsified that. `bedready.io` is served from here now, and it serves nothing
 * but the converter — so there is no longer a host that serves both, and no longer anything to
 * forward `bedready.io/designs` to MakerRun. The library lived at that hostname until the day of the
 * split, so every link, bookmark and indexed URL pointing at it is pre-split and would land on a
 * 404. See `origin.ts` for the rule itself and why it is a 301.
 *
 * ── ORDER: THE FRONT DOOR COMES FIRST ───────────────────────────────────────────────────────────
 *
 * `/` has no page in this repository — the homepage went to MakerRun with the library. Left to the
 * intl middleware it resolves to `/en` and 404s, which is what a fresh clone did until this was
 * added, and what Playwright's `webServer` health check tripped over.
 *
 * It must also run BEFORE the cross-origin rule, which owns `/` (a library path) and would send the
 * converter's own front page to MakerRun. That is not hypothetical: it is defect #209, which is what
 * the first cutover actually did.
 */
const intlMiddleware = createMiddleware(routing);

/**
 * Route handlers, which must leave the middleware untouched.
 *
 * There are none in this repository — the converter is backend-free — but `/api/*` on this host is
 * not idle. Two different things arrive there and both are proxied to MakerRun by a rewrite in
 * `next.config.mjs`:
 *
 *   · **`/api/v1/*`** — the documented compatibility alias for MakerRun\'s public API
 *     (`docs/API.md`). Khayt still calls it, and it returns 200 on `bedready.io` today.
 *   · **The converter\'s own four calls** — `/api/convert-count`, `/api/report-conversion`,
 *     `/api/convert` and `/api/waitlist`. `convert-api.ts` emits them as BARE SAME-ORIGIN PATHS
 *     unless `NEXT_PUBLIC_CONVERT_API_ORIGIN` is set, so they land here too.
 *
 * Hence a bare `NextResponse.next()` rather than a skip of the redirect alone. Falling through to
 * the intl middleware would rewrite `/api/v1/designs` to `/en/api/v1/designs` before the rewrite in
 * `next.config.mjs` ever sees it, and its `/api/:path*` source would then match nothing. The proxy
 * would fail for a reason visible nowhere near the file that configures it.
 *
 * A redirect is the wrong shim for either caller: a 301 makes a client re-issue a POST as a bodiless
 * GET — `/api/convert` uploads a file and `docs/API.md` documents POST upload endpoints — and
 * `Authorization` is stripped across origins. A rewrite is server-side, so method, body and headers
 * all survive, and the browser still sees a same-origin response, which is what keeps `connect-src
 * \'self\'` sufficient and the CSP untouched.
 */
function isRouteHandler(pathname: string): boolean {
  return pathname.startsWith("/api/") || pathname === "/api" || pathname.startsWith("/auth/");
}

export default function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // First, and before the intl middleware can touch the path — see `isRouteHandler`.
  if (isRouteHandler(pathname)) return NextResponse.next();

  const target = frontDoorPath(pathname);
  if (target) {
    // 301: this is where the front page lives, not a temporary detour. The query string is carried
    // across so a tagged link — which is what distribution attaches to everything it posts — does
    // not lose its attribution on the first hop.
    return NextResponse.redirect(new URL(target + request.nextUrl.search, request.url), 301);
  }

  const redirectOrigin = crossOriginRedirect(request.headers.get("host"), pathname);
  if (redirectOrigin) {
    // Only the origin changes; the path and query survive. 301 rather than the default 307, because
    // a temporary redirect tells Google to keep indexing the old host — and consolidating the
    // pre-split ranking signal onto MakerRun is most of the point.
    return NextResponse.redirect(new URL(pathname + request.nextUrl.search, redirectOrigin), 301);
  }

  return intlMiddleware(request);
}

export const config = {
  // Every path except Next internals and files with an extension. `/` must be included — it is the
  // one this file exists for — so the pattern cannot exclude an empty path segment.
  matcher: ["/((?!_next|_vercel|.*\\..*).*)"],
};
