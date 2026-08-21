// The CSP must name the converter's API origin, and nothing wider.
// Run: `npm test`.
//
// ── WHY THIS IS WORTH A TEST ────────────────────────────────────────────────────────────────────
//
// The converter calls four endpoints that stayed with MakerRun (`src/lib/convert-api.ts`). They are
// same-origin while one deployment serves both sites and cross-origin once this repository is its
// own. A `connect-src` that does not name the API origin refuses them IN THE BROWSER: no request
// reaches the server, no log line is written, and the only evidence is a console error on someone
// else's machine. The counter stops and failed conversions are never reported, silently.
//
// This file replaces the one carved from the combined repository, which tested a Supabase origin
// this build has none of — and which embedded the live project ref in its fixtures, which has no
// business in a public repository.
import { test } from "node:test";
import assert from "node:assert/strict";

/** Load next.config.mjs with a given API origin, and return the CSP header it would send. */
async function cspUnder(apiOrigin: string | undefined): Promise<string> {
  const before = process.env.NEXT_PUBLIC_CONVERT_API_ORIGIN;
  if (apiOrigin === undefined) delete process.env.NEXT_PUBLIC_CONVERT_API_ORIGIN;
  else process.env.NEXT_PUBLIC_CONVERT_API_ORIGIN = apiOrigin;
  try {
    // Cache-bust: the module reads the environment once, at import time.
    const mod = await import(`../../next.config.mjs?v=${encodeURIComponent(String(apiOrigin))}`);
    const headers = await mod.default.headers();
    const all = headers.flatMap((h: { headers: { key: string; value: string }[] }) => h.headers);
    const csp = all.find((h: { key: string }) => /content-security-policy/i.test(h.key));
    assert.ok(csp, "no Content-Security-Policy header is sent at all");
    return csp.value;
  } finally {
    if (before === undefined) delete process.env.NEXT_PUBLIC_CONVERT_API_ORIGIN;
    else process.env.NEXT_PUBLIC_CONVERT_API_ORIGIN = before;
  }
}

test("same-origin (unset) names no extra host — 'self' already covers it", async () => {
  const csp = await cspUnder(undefined);
  const connect = csp.split(";").find((d) => d.trim().startsWith("connect-src"))!;
  assert.ok(connect.includes("'self'"), "connect-src lost 'self'");
  assert.ok(!/https:\/\/makerrun/.test(connect), "named an API origin that was not configured");
});

test("a configured API origin is named in connect-src", async () => {
  const csp = await cspUnder("https://makerrun.com");
  const connect = csp.split(";").find((d) => d.trim().startsWith("connect-src"))!;
  assert.ok(
    connect.includes("https://makerrun.com"),
    "the API origin is missing from connect-src — every convert-api call would be refused in the " +
      "browser, with nothing server-side to show for it",
  );
});

test("only the origin is taken, never a path", async () => {
  const csp = await cspUnder("https://makerrun.com/api/");
  const connect = csp.split(";").find((d) => d.trim().startsWith("connect-src"))!;
  assert.ok(connect.includes("https://makerrun.com"), "origin missing");
  assert.ok(!connect.includes("/api/"), "a path leaked into the policy, which CSP cannot express");
});

test("the API origin is never widened to a wildcard", async () => {
  // Narrow on purpose. `connect-src` legitimately carries `https://*.vercel-insights.com` for
  // Analytics, and a blanket "no wildcards" assertion fails on that — which is how a test gets
  // deleted rather than fixed. What must never happen is the API HOST being wildcarded: the
  // combined repo's policy once said `*.supabase.co`, which permitted every project on the
  // internet and made connect-src close to meaningless.
  for (const o of ["https://makerrun.com", "http://localhost:3000"]) {
    const csp = await cspUnder(o);
    const connect = csp.split(";").find((d) => d.trim().startsWith("connect-src"))!;
    const host = new URL(o).hostname;
    const parent = host.split(".").slice(-2).join(".");
    assert.ok(!connect.includes(`*.${parent}`), `${o} was widened to *.${parent} in connect-src`);
  }
});

test("an unparseable origin fails closed rather than emitting a malformed directive", async () => {
  const csp = await cspUnder("not a url");
  const connect = csp.split(";").find((d) => d.trim().startsWith("connect-src"))!;
  assert.ok(connect.includes("'self'"), "connect-src lost 'self'");
  assert.ok(!connect.includes("not a url"), "a junk value was emitted into the policy");
});

test("the policy still carries the directives that are not about the API", async () => {
  const csp = await cspUnder("https://makerrun.com");
  for (const d of ["default-src 'self'", "object-src 'none'", "frame-ancestors 'none'", "worker-src 'self' blob:"]) {
    assert.ok(csp.includes(d), `lost \`${d}\` — the converter runs its parser in a Worker`);
  }
});
