// "What left this page": the sizing, addressing and naming the panel's figures rest on.
// Run: `npm test`. The browser half (wrapping fetch on a real page) is e2e/egress-panel.spec.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bodySize, describeUrl, classify, summarize, FILE_BYTES_THRESHOLD, type EgressEntry } from "./egress.ts";

test("body sizes are measured in bytes, without reading a stream", () => {
  assert.equal(bodySize(undefined), 0);
  assert.equal(bodySize(null), 0);
  assert.equal(bodySize(""), 0);
  assert.equal(bodySize("abc"), 3);
  assert.equal(bodySize("é"), 2, "UTF-8 bytes, not UTF-16 code units");
  assert.equal(bodySize(new Blob([new Uint8Array(5000)])), 5000);
  assert.equal(bodySize(new ArrayBuffer(10)), 10);
  assert.equal(bodySize(new Uint8Array(new ArrayBuffer(16), 4, 8)), 8, "a view counts its own bytes");
  assert.equal(bodySize(new URLSearchParams({ a: "1" })), 3);
  assert.equal(bodySize(new ReadableStream()), null, "reading a stream would change the request");
});

test("a FormData body counts its file — the case the panel exists to catch", () => {
  const fd = new FormData();
  fd.append("file", new Blob([new Uint8Array(200_000)]), "model.3mf");
  fd.append("target", "u1");
  const n = bodySize(fd)!;
  assert.ok(n >= 200_000 && n < 200_100, `got ${n}`);
  assert.ok(n > FILE_BYTES_THRESHOLD);
});

test("addresses keep origin and path, and never the query string", () => {
  const d = describeUrl("/api/convert?target=u1&token=secret#x", "https://bedready.io/en/convert");
  assert.deepEqual(d, { origin: "https://bedready.io", path: "/api/convert", url: "https://bedready.io/api/convert", rsc: false });
  assert.equal(describeUrl("/en/mixer?_rsc=abc", "https://bedready.io/")!.rsc, true);
  assert.equal(describeUrl("blob:https://bedready.io/123", "https://bedready.io/"), null, "a blob: URL never reaches the network");
  assert.equal(describeUrl("data:text/plain,hi", "https://bedready.io/"), null);
});

test("every call in convert-api.ts has a name in the panel", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync("src/lib/convert-api.ts", "utf8");
  const union = src.match(/export type ConvertApiPath =([^;]+);/)![1]!;
  for (const [, p] of union.matchAll(/"([^"]+)"/g)) {
    assert.notEqual(classify(p!), "other", `${p} would be listed as an unknown request`);
  }
  assert.equal(classify("/_vercel/insights/event"), "analytics");
  assert.equal(classify("/_vercel/insights/script.js"), "pageCode", "the script download is not an event");
  assert.equal(classify("/api/convert-count", { method: "GET" }), "counterRead");
  assert.equal(classify("/api/convert-count", { method: "POST" }), "counter");
  assert.equal(classify("/_next/static/chunks/abc.js"), "pageCode");
  assert.equal(classify("/en/convert", { rsc: true }), "pageData");
  assert.equal(classify("/thumb", { initiator: "img" }), "image");
});

test("file bytes count only bodies over the threshold, and say whose choice they were", () => {
  const e = (kind: EgressEntry["kind"], bodyBytes: number | null): EgressEntry => ({
    id: 0, method: "POST", url: "", origin: "", path: "", via: "fetch", at: 0, kind, bodyBytes,
  });
  const quiet = summarize([e("counter", 0), e("analytics", 120), e("pageCode", 0)]);
  assert.equal(quiet.fileBytes, 0);
  assert.equal(summarize([e("analytics", FILE_BYTES_THRESHOLD)]).fileBytes, 0, "the threshold itself is not a file");

  const chose = summarize([e("counter", 0), e("serverFallback", 900_000)]);
  assert.equal(chose.fileBytes, 900_000);
  assert.equal(chose.chosen.length, 1);
  assert.equal(chose.unexpected.length, 0);

  const odd = summarize([e("other", 50_000), e("other", null)]);
  assert.equal(odd.unexpected.length, 1);
  assert.equal(odd.unknownBodies, 1);
});
