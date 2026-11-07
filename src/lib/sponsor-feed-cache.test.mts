// The sponsor read lives in the converter LAYOUT, so its cache lifetime is a ceiling on every
// converter page's. At 300 s (#98) it pulled the daily filament pages and the guides down to five
// minutes; production served `x-nextjs-stale-time: 300` on all of them. Run: `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fetchSponsor, SPONSOR_REVALIDATE_SECONDS, SPONSOR_CACHE_TAG } from "./sponsor-feed.ts";

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx|ts)$/.test(e)) out.push(full);
  }
  return out;
}

test("the sponsor is cached at least as long as the longest converter page revalidate", () => {
  const found: { file: string; seconds: number }[] = [];
  for (const f of walk("src/app/[locale]/(converter)")) {
    // Share-card images are separate routes with no layout around them, so they do not count.
    if (/opengraph-image|twitter-image/.test(f)) continue;
    const m = readFileSync(f, "utf8").match(/export const revalidate\s*=\s*(\d+)/);
    if (m) found.push({ file: f, seconds: Number(m[1]) });
  }
  assert.ok(found.length > 0, "the filament pages export a revalidate");
  for (const { file, seconds } of found) {
    assert.ok(SPONSOR_REVALIDATE_SECONDS >= seconds, `${file} wants ${seconds}s but the layout's sponsor read caps it at ${SPONSOR_REVALIDATE_SECONDS}s`);
  }
});

test("the fetch carries that lifetime and the tag that publishes a booking change at once", async () => {
  const real = globalThis.fetch;
  let init: { next?: { revalidate?: number; tags?: string[] } } | undefined;
  globalThis.fetch = (async (_url: unknown, i: unknown) => {
    init = i as typeof init;
    return new Response(JSON.stringify({ sponsor: null }));
  }) as typeof fetch;
  try {
    await fetchSponsor(new Date("2026-11-07T12:00:00Z"));
  } finally {
    globalThis.fetch = real;
  }
  assert.equal(init?.next?.revalidate, SPONSOR_REVALIDATE_SECONDS);
  assert.deepEqual(init?.next?.tags, [SPONSOR_CACHE_TAG]);
});
