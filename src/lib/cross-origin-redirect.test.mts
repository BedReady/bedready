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

test("shared legal pages are served on both hosts", () => {
  for (const p of ["/privacy", "/terms", "/licenses", "/age", "/de/privacy"]) {
    assert.equal(split("bedready.io", p), null, p);
    assert.equal(split("makerrun.com", p), null, p);
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

test("the middleware excludes /api and /auth from redirects", () => {
  // Structural, not behavioural: those paths never reach the rule. `bedready.io/api/v1` is a
  // documented, live compatibility alias for MakerRun's API. A 301 makes a client re-issue a POST
  // as a bodiless GET and strips Authorization across origins, so the alias needs a rewrite rather
  // than a redirect. Until that decision is taken, /api must 404 rather than half-work.
  const src = readFileSync("src/middleware.ts", "utf8");
  const guard = src.indexOf("if (!isRouteHandler(pathname)) {");
  const redirect = src.indexOf("const redirectOrigin = crossOriginRedirect(");
  assert.ok(guard !== -1, "the /api and /auth guard is gone from the middleware");
  assert.ok(redirect !== -1, "the cross-origin redirect is gone from the middleware");
  assert.ok(
    guard < redirect,
    "the cross-origin redirect escaped the /api and /auth guard. That 301s API calls on the " +
      "compatibility alias, and a 301 on a POST drops the body.",
  );
});
