// nextPaint must resolve even when requestAnimationFrame never fires.
//
// That is not hypothetical: rAF callbacks do NOT run in a hidden tab. The converter awaited two
// frames before analysing, so picking a file and switching away left the page on
// "Reading colors & geometry…" forever, with no error and no way forward. Observed directly in a
// non-compositing browser pane: document.hidden true, zero rAF callbacks in 4 seconds.
import { test } from "node:test";
import assert from "node:assert/strict";

const g = globalThis as { requestAnimationFrame?: (cb: FrameRequestCallback) => number };
const original = g.requestAnimationFrame;

test("resolves via the timeout when rAF never fires (hidden tab)", async () => {
  g.requestAnimationFrame = () => 0; // registered, never invoked — exactly what a hidden tab does
  const { nextPaint } = await import("./next-paint.ts");
  const t0 = Date.now();
  await nextPaint(50);
  assert.ok(Date.now() - t0 >= 45, "should have waited for the timeout rather than hanging");
  g.requestAnimationFrame = original;
});

test("resolves via frames when they do fire, without waiting out the timeout", async () => {
  g.requestAnimationFrame = (cb: FrameRequestCallback) => {
    setTimeout(() => cb(0), 1);
    return 0;
  };
  const { nextPaint } = await import("./next-paint.ts");
  const t0 = Date.now();
  await nextPaint(5000); // a timeout this long would be obvious if frames were ignored
  assert.ok(Date.now() - t0 < 500, "two frames should win the race, not the timeout");
  g.requestAnimationFrame = original;
});

test("resolves when requestAnimationFrame doesn't exist at all", async () => {
  delete g.requestAnimationFrame;
  const { nextPaint } = await import("./next-paint.ts");
  await nextPaint(20); // must not throw
  g.requestAnimationFrame = original;
});
