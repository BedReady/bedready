// The extension keeps the last intercepted original for the toast's "Edit colours" link. The privacy
// policy promises "at most 30 minutes"; until 0.6.5 nothing deleted an entry nobody took, so it sat in
// IndexedDB until the next download. This runs extension/src/handoff.ts against a minimal in-memory
// IndexedDB (only what that file uses) and a fake alarms API. Run: `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";

type Req<T> = { result?: T; error?: unknown; onsuccess?: () => void; onerror?: () => void; onupgradeneeded?: () => void };
const data = new Map<string, unknown>();
const req = <T,>(value: T): Req<T> => {
  const r: Req<T> = {};
  queueMicrotask(() => {
    r.result = value;
    r.onsuccess?.();
  });
  return r;
};
const store = {
  get: (k: string) => req(data.get(k)),
  put: (v: unknown, k: string) => (data.set(k, v), req(k)),
  delete: (k: string) => (data.delete(k), req(undefined)),
};
const db = { transaction: () => ({ objectStore: () => store }), createObjectStore: () => store, close: () => {} };
(globalThis as any).indexedDB = { open: () => req(db) };
const alarms: { name: string; delayInMinutes: number }[] = [];
(globalThis as any).chrome = { alarms: { create: (name: string, o: { delayInMinutes: number }) => alarms.push({ name, ...o }) } };

const { stash, sweep, take, TTL_MS, SWEEP_ALARM } = await import("../../extension/src/handoff.ts");

test("every stash schedules a sweep just after the 30-minute limit", async () => {
  alarms.length = 0;
  assert.equal(await stash(new Blob(["PK"]), "a.3mf"), true);
  assert.deepEqual(alarms, [{ name: SWEEP_ALARM, delayInMinutes: TTL_MS / 60_000 + 1 }]);
});

test("a sweep deletes an untaken file once it is past the limit, and only then", async () => {
  await stash(new Blob(["PK"]), "a.3mf");
  const at = (data.get("pending") as { at: number }).at;
  assert.equal(await sweep(at + TTL_MS - 1), false, "still within 30 minutes: kept");
  assert.ok(data.has("pending"));
  assert.equal(await sweep(at + TTL_MS + 1), true, "past 30 minutes: deleted");
  assert.ok(!data.has("pending"));
  assert.equal(await take(), null);
});
