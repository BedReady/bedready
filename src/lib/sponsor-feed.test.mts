// The server-side sponsor read must fail closed: the converter builds and renders without MakerRun.
// Run: `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchSponsor, sponsorFeedUrl } from "./sponsor-feed.ts";

const LIVE = {
  id: "s1", name: "Acme", url: "https://acme.example/", tagline: null,
  starts_at: "2026-11-01T00:00:00Z", ends_at: "2026-11-09T00:00:00Z",
};
const NOW = new Date("2026-11-07T12:00:00Z");

function withFetch(impl: typeof fetch, run: () => Promise<void>) {
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  return run().finally(() => {
    globalThis.fetch = real;
  });
}

test("a same-origin seam resolves to the rewrite's destination, not a bare path", () => {
  const u = new URL(sponsorFeedUrl());
  assert.match(u.protocol, /^https?:$/);
  assert.equal(u.pathname, "/api/v1/sponsor");
});

test("a live booking comes back", () =>
  withFetch(async () => new Response(JSON.stringify({ sponsor: LIVE })), async () => {
    assert.equal((await fetchSponsor(NOW))?.name, "Acme");
  }));

test("an ended booking, an HTTP error, bad JSON and a network failure are all no sponsor", async () => {
  const cases: (typeof fetch)[] = [
    async () => new Response(JSON.stringify({ sponsor: { ...LIVE, ends_at: "2026-11-07T00:00:00Z" } })),
    async () => new Response("nope", { status: 503 }),
    async () => new Response("{not json"),
    async () => {
      throw new TypeError("fetch failed");
    },
  ];
  for (const c of cases) await withFetch(c, async () => assert.equal(await fetchSponsor(NOW), null));
});
