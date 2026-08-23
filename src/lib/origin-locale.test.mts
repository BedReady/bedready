// `/en/…` is a real URL shape, and it used to leave the site.
//
// English is unprefixed in the links this site writes, so `en` was left out of the locale list that
// origin.ts strips before deciding which site owns a path. But Next EMITS `/en/…` on its own: an
// opengraph-image route resolves with the active locale segment, so every social-preview image on
// the converter is `/en/guides/<slug>/opengraph-image-…`.
//
// Measured against production before the fix:
//
//   bedready.io/en/convert         301 -> makerrun.com/en/convert
//   bedready.io/en/guides          301 -> makerrun.com/en/guides
//   bedready.io/en/orca-filaments  301 -> makerrun.com/en/orca-filaments
//   bedready.io/de/convert         200
//
// So every og:image on the converter redirected to the sister domain — and still returned a PNG,
// because the other site serves the same route, which is exactly why it went unnoticed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { originFor, CONVERTER_ORIGIN, LIBRARY_ORIGIN, crossOriginRedirect } from "./origin.ts";

const CONVERTER_PATHS = ["/convert", "/guides", "/orca-filaments", "/extension", "/image", "/features"];
const LOCALES = ["en", "de", "es", "fr", "zh", "ja", "ar"];

test("a converter path belongs to the converter under EVERY locale prefix, en included", () => {
  for (const p of CONVERTER_PATHS) {
    assert.equal(originFor(p), CONVERTER_ORIGIN, p);
    for (const l of LOCALES) {
      assert.equal(originFor(`/${l}${p}`), CONVERTER_ORIGIN, `/${l}${p} must stay on the converter`);
    }
  }
});

test("the og:image shape Next emits does not leave the site", () => {
  // The literal path from a live page, which was 301ing to makerrun.com.
  const img = "/en/guides/makerworld-multicolor-on-snapmaker-u1/opengraph-image-669uu";
  assert.equal(originFor(img), CONVERTER_ORIGIN);
  assert.equal(crossOriginRedirect("bedready.io", img), null, "no cross-origin redirect for our own image");
});

test("library paths still leave, under every prefix", () => {
  for (const p of ["/designs", "/verified", "/upload", "/app"]) {
    assert.equal(originFor(p), LIBRARY_ORIGIN, p);
    for (const l of LOCALES) assert.equal(originFor(`/${l}${p}`), LIBRARY_ORIGIN, `/${l}${p}`);
  }
  // It returns the target ORIGIN; middleware carries the path across unchanged.
  assert.equal(crossOriginRedirect("bedready.io", "/en/designs"), LIBRARY_ORIGIN);
});

test("a two-letter segment that is not a locale is not stripped", () => {
  // Guard against the fix over-reaching: /it/ and /xx/ are not locales, so they must not be peeled
  // off and accidentally resolve to a converter route.
  assert.notEqual(originFor("/it/convert"), CONVERTER_ORIGIN, "'it' is not a supported locale");
  assert.notEqual(originFor("/xx/convert"), CONVERTER_ORIGIN);
});

// ── A typo on this domain is this domain's 404 ──────────────────────────────────────────────────
// bedready.io/no-such-page 301'd to makerrun.com/no-such-page, so someone who mistyped OUR URL met
// a different brand's error page. The library repo fixed the mirror of this and wrote down why;
// only its half shipped. "Unknown" must mean "nobody's", not "theirs".
test("a path neither site owns is answered here, not redirected to the other brand", () => {
  for (const p of ["/no-such-page", "/typo", "/de/no-such-page", "/en/nonsense"]) {
    assert.equal(crossOriginRedirect("bedready.io", p), null, `${p} must 404 on the host that was typed`);
  }
});

test("real library paths still redirect, including the ones that cannot be enumerated", () => {
  for (const p of ["/designs", "/verified", "/upload", "/help", "/privacy", "/terms", "/account"]) {
    assert.equal(crossOriginRedirect("bedready.io", p), LIBRARY_ORIGIN, p);
  }
  // A storefront is a rewrite, not a directory — it can never appear in a route list.
  assert.equal(crossOriginRedirect("bedready.io", "/@turki"), LIBRARY_ORIGIN);
  assert.equal(crossOriginRedirect("bedready.io", "/de/@turki"), LIBRARY_ORIGIN);
  // A design's own page is under /designs, so the long tail travels with its parent.
  assert.equal(crossOriginRedirect("bedready.io", "/designs/some-slug-abc123"), LIBRARY_ORIGIN);
});

test("converter paths are never redirected away from the converter", () => {
  for (const p of ["/convert", "/guides", "/orca-filaments", "/image", "/mixer", "/en/convert"]) {
    assert.equal(crossOriginRedirect("bedready.io", p), null, p);
  }
});

test("the paths this function must never be asked about are short-circuited upstream", () => {
  // Three shapes never reach crossOriginRedirect, and asserting its return value for them would pin
  // something that is not its contract — I tried, and all three failures were the test's fault:
  //   /        middleware's front door 301s it to /convert first
  //   /api/*   isRouteHandler returns next() first: a 301 would re-issue an upload POST as a GET
  //   /auth/*  the same guard
  // So pin the guards where they live, not this function's answer.
  const mw = readFileSync("src/middleware.ts", "utf8");
  const guardLine = mw.indexOf("isRouteHandler(pathname)");
  const frontDoorLine = mw.indexOf("frontDoorPath(pathname)");
  const crossLine = mw.indexOf("crossOriginRedirect(");
  assert.ok(guardLine > 0 && frontDoorLine > 0 && crossLine > 0, "middleware still has all three steps");
  assert.ok(guardLine < crossLine, "route handlers must be answered before any cross-origin 301");
  assert.ok(frontDoorLine < crossLine, "the front door must run before any cross-origin 301");
});
