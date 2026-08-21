// `/` must reach the converter.
// Run: `npm test`.
//
// ── WHY THIS IS NOT A COPY OF MAKERRUN'S TEST ───────────────────────────────────────────────────
//
// The combined repository's rule is guarded on the two origins differing and on the request being
// on the converter's host, because one deployment serves both sites there. Neither guard can be
// carried across: the origin comparison is false here by construction, and the host check is false
// on `localhost`, so a copied rule would 404 the front page in development while production worked.
//
// This version is unconditional, so what needs testing is different — that it fires for the front
// doors and for nothing else.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { frontDoorPath } from "./front-door.ts";

test("`/` reaches the converter", () => {
  assert.equal(frontDoorPath("/"), "/convert");
});

test("every locale root is a front door, not just the English one", () => {
  // `/de` is where the language switcher lands. Left out, English is fixed and six locales still
  // land on a 404 — a fix that looks finished and is not.
  for (const l of ["de", "es", "fr", "zh", "ja", "ar"]) {
    assert.equal(frontDoorPath(`/${l}`), `/${l}/convert`, `/${l}`);
    assert.equal(frontDoorPath(`/${l}/`), `/${l}/convert`, `/${l}/ (trailing slash)`);
  }
});

test("a real page is never redirected", () => {
  for (const p of ["/convert", "/guides", "/de/convert", "/orca-filaments/prusament", "/image", "/mixer"]) {
    assert.equal(frontDoorPath(p), null, p);
  }
});

test("a two-letter segment that is not a locale is left alone", () => {
  // `/xy` is a missing page and should 404 as one, rather than being quietly sent to the converter
  // as though every unknown two-letter path were a language.
  assert.equal(frontDoorPath("/xy"), null);
  assert.equal(frontDoorPath("/en"), null, "`en` is unprefixed in this app — /en is not a front door");
});

test("the middleware runs the front door BEFORE next-intl", () => {
  // Behind the intl middleware, `/` resolves to `/en`, finds no page and 404s — which is what a
  // fresh clone did before this existed, and what Playwright's webServer health check tripped over.
  const src = readFileSync("src/middleware.ts", "utf8");
  const front = src.indexOf("frontDoorPath(pathname)");
  const intl = src.indexOf("return intlMiddleware(request)");
  assert.ok(front !== -1 && intl !== -1, "middleware no longer has both");
  assert.ok(front < intl, "the front door must run before next-intl, or `/` 404s");
});

test("the matcher does not exclude `/`", () => {
  // A matcher that skips the root would make every assertion above true and the site still broken:
  // the rule would be correct and never consulted.
  const src = readFileSync("src/middleware.ts", "utf8");
  const m = src.match(/matcher:\s*\[\s*"([^"]+)"/);
  assert.ok(m, "no matcher found");
  const re = new RegExp(m[1]!.replace(/\\\\/g, "\\"));
  assert.ok(re.test("/"), `matcher ${m[1]} does not match "/" — the front door would never run`);
});
