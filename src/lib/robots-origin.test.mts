// robots.txt must describe THIS site, not the one this repository was carved out of.
// Run: `npm test`.
//
// ── WHY THIS ASSERTS AGREEMENT RATHER THAN A LITERAL ────────────────────────────────────────────
//
// The bug was not that `robots.ts` held a wrong string — every string in it was a correct value for
// MakerRun. It was that `robots.ts` and `sitemap.ts`, two files in the same directory, disagreed
// about which site they belong to: one announced `makerrun.com` while the other emitted 473 URLs on
// `bedready.io`. A test pinning `CONVERTER_ORIGIN` in `robots.ts` alone would have passed while that
// disagreement persisted, because it would only have restated one half of it.
//
// So the invariant is the relationship: whatever host the sitemap's URLs live on is the host
// robots.txt must advertise. That holds under any configuration of the two origin variables,
// including ones nobody has tried yet.
import { test } from "node:test";
import assert from "node:assert/strict";
import robotsDefault from "../app/robots.ts";
import sitemapDefault from "../app/sitemap.ts";
import { CONVERTER_ORIGIN, LIBRARY_ORIGIN } from "./origin.ts";

/**
 * The app-router modules export a default, and the test runner transpiles them to CJS — so the
 * default arrives one level deeper than its type says and `robots()` throws "not a function".
 * Every other test in this directory imports NAMED exports, which is why none of them needs this.
 */
const unwrap = <T,>(m: T): T => (m as { default?: T }).default ?? m;
const robots = unwrap(robotsDefault);
const sitemap = unwrap(sitemapDefault);

test("robots.txt advertises the host the sitemap's URLs actually live on", async () => {
  const entries = await sitemap();
  const hosts = [...new Set(entries.map((e) => new URL(e.url).origin))];
  assert.equal(hosts.length, 1, `the sitemap spans more than one origin: ${hosts.join(", ")}`);

  const r = robots();
  assert.equal(
    r.sitemap,
    `${hosts[0]}/sitemap.xml`,
    "robots.txt points at a sitemap on a different host than the one it serves — crawlers largely " +
      "ignore a cross-host sitemap reference, so this site's URLs lose their declared entry point",
  );
  assert.equal(r.host, hosts[0], "robots.txt declares another site as this one's preferred host");
});

test("robots.txt names the converter, and specifically not the library", () => {
  // The regression in plain terms, for when the test above fails and the cause is not obvious.
  const r = robots();
  assert.equal(r.host, CONVERTER_ORIGIN);
  assert.notEqual(
    r.host,
    LIBRARY_ORIGIN,
    "robots.ts is naming LIBRARY_ORIGIN again — correct in MakerRun's copy, inverted here",
  );
});

test("the disallow list does not block paths that 301 to the library", async () => {
  // Disallowing a URL stops Googlebot fetching it, so it never sees the redirect and never passes
  // the signal on. The carved-over list disallowed /upload, /account, /saves and friends — all of
  // which are now 301s to MakerRun, which is the opposite of what the split needs.
  const { redirectTargetFor } = await import("./origin.ts");

  // Mirrors the middleware's guard. Route handlers return before the redirect rule is consulted, so
  // the rule's answer for them is not what the site does — /api is disallowed deliberately, and
  // asking `redirectTargetFor` about it would report a 301 that never happens.
  const isRouteHandler = (p: string) => p.startsWith("/api/") || p === "/api" || p.startsWith("/auth/");

  const disallow = [robots().rules].flat().flatMap((r) => (r?.disallow ? [r.disallow].flat() : []));
  assert.ok(disallow.length > 0, "the disallow list is empty — this test would pass vacuously");

  for (const rule of disallow) {
    const path = rule.replace(/\*/g, "").replace(/\/$/, "") || "/";
    if (isRouteHandler(path)) continue;
    assert.equal(
      redirectTargetFor("bedready.io", path, CONVERTER_ORIGIN, LIBRARY_ORIGIN),
      null,
      `robots.txt disallows ${rule}, but that path 301s to the library — blocking it withholds the ` +
        "ranking signal the redirect exists to transfer",
    );
  }
});
