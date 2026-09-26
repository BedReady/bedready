// Stale-chunk recovery: reload once, never loop. Run: `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isChunkLoadError, shouldReload } from "./chunk-reload.ts";

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

const STALE = { name: "ChunkLoadError", message: "Loading chunk 1567 failed.\n(missing: https://bedready.io/_next/static/chunks/1567-x.js)" };

test("recognises the production error and the other browsers' wording", () => {
  assert.ok(isChunkLoadError(STALE));
  assert.ok(isChunkLoadError({ name: "Error", message: "Loading chunk 4707 failed." }));
  assert.ok(isChunkLoadError({ name: "Error", message: "Loading CSS chunk 12 failed." }));
  assert.ok(isChunkLoadError({ name: "TypeError", message: "Failed to fetch dynamically imported module: https://x/y.js" }));
  assert.ok(isChunkLoadError({ name: "TypeError", message: "error loading dynamically imported module" }));
});

test("an ordinary render error is not a chunk error, and does not reload", () => {
  assert.equal(isChunkLoadError({ name: "TypeError", message: "Cannot read properties of undefined" }), false);
  assert.equal(isChunkLoadError(null), false);
  assert.equal(shouldReload({ name: "TypeError", message: "x is undefined" }, "https://a/", memoryStorage(), 0), false);
});

test("reloads the first time, then refuses inside the window: a broken chunk must not loop", () => {
  const s = memoryStorage();
  assert.equal(shouldReload(STALE, "https://makerrun.com/", s, 1_000), true);
  assert.equal(shouldReload(STALE, "https://makerrun.com/", s, 5_000), false);
});

test("a later deploy, or another page, gets its own reload", () => {
  const s = memoryStorage();
  assert.equal(shouldReload(STALE, "https://makerrun.com/", s, 0), true);
  assert.equal(shouldReload(STALE, "https://makerrun.com/", s, 60_000), true);
  assert.equal(shouldReload(STALE, "https://makerrun.com/designs", s, 60_500), true);
});

test("no usable storage means no reload, because there is no loop guard", () => {
  assert.equal(shouldReload(STALE, "https://a/", null, 0), false);
  const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => {} };
  assert.equal(shouldReload(STALE, "https://a/", throwing, 0), false);
});
