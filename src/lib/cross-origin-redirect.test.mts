// The 301s that move a path to the host that owns it.
// Run: `npm test`.
//
// ── HOW THIS DIFFERS FROM MAKERRUN'S COPY, WHICH IS THE WHOLE POINT ─────────────────────────────
//
// MakerRun ships the same rule with both origins defaulting to the SAME string, so there it is inert
// until the day of the cutover and its first test asserts that inertness.
//
// Here the origins differ by default — `bedready.io` and `makerrun.com` — so the rule is live the
// moment it deploys. That inverts the most important test in the file. The thing worth pinning on
// this side is not "it stays quiet" but "it actually fires", because a silent no-op is exactly what
// this port would look like if `LIBRARY_ORIGIN` were ever set back to the converter's own origin:
// every library path would 404 again, quietly, and the 404 is indistinguishable from the state this
// change was made to fix.
//
// The single-origin case is still pinned, as an ordinary call rather than as the default. A rule
// handed one origin twice must answer "nothing to redirect" — answering otherwise is a 301 from a
// host to itself, on every page, which is a total outage.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { crossOriginRedirect, redirectTargetFor, CONVERTER_ORIGIN, LIBRARY_ORIGIN } from "./origin.ts";
import nextConfig from "../../next.config.mjs";

const CONV = "https://bedready.io";
const LIB = "https://makerrun.com";

/** The rule, with the origins passed in. */
const split = (host: string | null, path: string) => redirectTargetFor(host, path, CONV, LIB);

test("THIS REPO'S DEFAULT IS THE SPLIT, and the rule really fires under it", () => {
  assert.notEqual(
    CONVERTER_ORIGIN,
    LIBRARY_ORIGIN,
    "the two origins collapsed to one string — the cross-origin rule is now inert, and every " +
      "library path on bedready.io goes back to being a 404",
  );
  assert.equal(
    crossOriginRedirect("bedready.io", "/designs"),
    LIBRARY_ORIGIN,
    "bedready.io/designs did not redirect to the library under the shipped configuration — this " +
      "is the exact regression the port exists to prevent",
  );
});

test("SINGLE ORIGIN: one origin passed twice never redirects", () => {
  // The outage case. Without the equality check this 301s a host to itself, on every page.
  for (const p of ["/designs", "/convert", "/", "/de/convert", "/account"]) {
    assert.equal(redirectTargetFor("bedready.io", p, CONV, CONV), null, p);
  }
});

test("a library path on the converter host goes to the library", () => {
  assert.equal(split("bedready.io", "/designs"), LIB);
  assert.equal(split("bedready.io", "/designs/desk-hook-a1b2c3"), LIB);
  assert.equal(split("bedready.io", "/verified"), LIB);
  assert.equal(split("bedready.io", "/account"), LIB);
  assert.equal(split("bedready.io", "/upload"), LIB);
});

test("a converter path on the library host goes to the converter", () => {
  // Unreachable in production here — makerrun.com does not route to this deployment — but the rule
  // is shared with MakerRun and a half-copy is the thing that drifts.
  assert.equal(split("makerrun.com", "/convert"), CONV);
  assert.equal(split("makerrun.com", "/guides/x"), CONV);
});

test("the locale prefix does not change the owner", () => {
  // Without this, six locales' worth of URLs bounce to the wrong host.
  assert.equal(split("bedready.io", "/de/designs"), LIB);
  assert.equal(split("makerrun.com", "/de/convert"), CONV);
  assert.equal(split("bedready.io", "/de/convert"), null);
});

test("a path already on its own host is served, not redirected", () => {
  assert.equal(split("bedready.io", "/convert"), null);
  assert.equal(split("bedready.io", "/calibrate"), null);
  assert.equal(split("makerrun.com", "/designs"), null);
});

test("an unrecognised host is never redirected", () => {
  // localhost has no match and every preview deployment has a generated hostname. This is also why
  // the rule cannot be smoke-tested by visiting the deployment's own .vercel.app URL.
  for (const h of ["bedready-converter.vercel.app", "bedready-converter-git-main-x.vercel.app", "localhost", "docs.bedready.io"]) {
    assert.equal(split(h, "/designs"), null, h);
    assert.equal(split(h, "/convert"), null, h);
  }
});

test("legal pages redirect rather than 404, because this repo has none of them", () => {
  // MakerRun exempts these four from the rule: it serves them, and redirecting a page a host
  // already has is a pointless hop. Copying that exemption here was the worst of both — the rule
  // declined to redirect and there was no page to serve, so all four 404\'d on a host where they
  // return 200 today.
  for (const p of ["/privacy", "/terms", "/licenses", "/age", "/de/privacy"]) {
    assert.equal(split("bedready.io", p), LIB, p);
  }
});

test("a port on the host header does not defeat the match", () => {
  assert.equal(split("bedready.io:443", "/designs"), LIB);
  assert.equal(split("BedReady.IO", "/designs"), LIB);
});

test("the front door is decided before the cross-origin rule", () => {
  // `/` is a library path, so the cross-origin rule wants to send it to MakerRun. Running it before
  // the front door leaves the converter's own domain with no homepage — defect #209, which is what
  // the first cutover actually shipped.
  assert.equal(split("bedready.io", "/"), LIB, "assumption changed: / is no longer library-owned");
  const src = readFileSync("src/middleware.ts", "utf8");
  const frontDoor = src.indexOf("frontDoorPath(pathname)");
  const redirect = src.indexOf("crossOriginRedirect(");
  assert.ok(frontDoor !== -1 && redirect !== -1, "middleware no longer has both rules");
  assert.ok(frontDoor < redirect, "the cross-origin redirect moved above the front door — / now 301s to MakerRun");
});

test("route handlers leave the middleware before intl or any redirect touches them", () => {
  // `/api/*` carries two live callers — MakerRun\'s public API under its old address, and this
  // app\'s own four backend calls, which convert-api.ts emits as bare same-origin paths. Both are
  // proxied by the rewrite in next.config.mjs.
  //
  // The guard has to come first, not merely before the redirect. Falling through to next-intl
  // rewrites /api/v1/designs to /en/api/v1/designs, and the rewrite\'s /api/:path* source then
  // matches nothing — a proxy that fails for a reason visible nowhere near its configuration.
  const src = readFileSync("src/middleware.ts", "utf8");
  const guard = src.indexOf("if (isRouteHandler(pathname)) return NextResponse.next();");
  const frontDoor = src.indexOf("frontDoorPath(pathname)");
  const redirect = src.indexOf("crossOriginRedirect(");
  const intl = src.indexOf("return intlMiddleware(request);");
  assert.ok(guard !== -1, "the route-handler early return is gone from the middleware");
  assert.ok(
    guard < frontDoor && guard < redirect && guard < intl,
    "a middleware rule moved above the route-handler early return — /api is no longer reaching " +
      "the rewrite untouched",
  );
});

test("/api is proxied to the library, at the same origin the redirect rule sends paths to", async () => {
  const rules = await nextConfig.rewrites();
  const api = (Array.isArray(rules) ? rules : (rules.afterFiles ?? [])).find((r) => r.source === "/api/:path*");
  assert.ok(api, "the /api rewrite is gone — Khayt 404s and the converter\'s own four calls die silently");
  assert.equal(
    api.destination,
    `${LIBRARY_ORIGIN}/api/:path*`,
    "the proxy and the 301s disagree about where MakerRun is",
  );
});
