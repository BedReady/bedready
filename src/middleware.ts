import { NextResponse, type NextRequest } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";
import { frontDoorPath } from "./lib/front-door";

/**
 * Two jobs: the front door, then locale detection.
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
 * The cross-origin 301s are absent too. They send a library path arriving on the wrong host to
 * MakerRun — but this deployment only answers for converter routes, so a library path reaches a 404
 * rather than a redirect. That rule belongs to the host that still serves both.
 *
 * ── ORDER: THE FRONT DOOR COMES FIRST ───────────────────────────────────────────────────────────
 *
 * `/` has no page in this repository — the homepage went to MakerRun with the library. Left to the
 * intl middleware it resolves to `/en` and 404s, which is what a fresh clone did until this was
 * added, and what Playwright's `webServer` health check tripped over.
 */
const intlMiddleware = createMiddleware(routing);

export default function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const target = frontDoorPath(pathname);
  if (target) {
    // 301: this is where the front page lives, not a temporary detour. The query string is carried
    // across so a tagged link — which is what distribution attaches to everything it posts — does
    // not lose its attribution on the first hop.
    return NextResponse.redirect(new URL(target + request.nextUrl.search, request.url), 301);
  }

  return intlMiddleware(request);
}

export const config = {
  // Every path except Next internals and files with an extension. `/` must be included — it is the
  // one this file exists for — so the pattern cannot exclude an empty path segment.
  matcher: ["/((?!_next|_vercel|.*\\..*).*)"],
};
