// The lithophane page's crop and estimate arithmetic. Run: `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { coverCrop, panCrop, nudgeCrop, estimateHours, clampSizeMm, centreOf } from "./lithophane-crop.ts";

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test("cover: the largest window of the print's aspect, centred", () => {
  // Landscape photo, portrait print (100 × 140): full height, width = 1000 × 100/140.
  const r = coverCrop(2000, 1000, 100 / 140);
  close(r.h, 1000);
  close(r.w, 1000 * (100 / 140));
  close(r.x, (2000 - r.w) / 2);
  close(r.y, 0);
  // Portrait photo, landscape print: full width.
  const s = coverCrop(600, 1200, 2);
  close(s.w, 600); close(s.h, 300); close(s.y, 450);
});

test("cover: the window always has the print's aspect and stays inside the photo", () => {
  for (const [iw, ih, a, cx, cy] of [[640, 480, 0.5, 0, 0], [640, 480, 3, 1, 1], [100, 100, 1, 0.9, 0.1]] as const) {
    const r = coverCrop(iw, ih, a, { cx, cy });
    close(r.w / r.h, a, 1e-6);
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= iw + 1e-9 && r.y + r.h <= ih + 1e-9);
  }
});

test("pan: dragging the photo right moves the window left, by the preview's scale", () => {
  const iw = 2000, ih = 1000, a = 0.5;
  const c0 = { cx: 0.5, cy: 0.5 };
  const r0 = coverCrop(iw, ih, a, c0); // 500 × 1000
  // Preview 250 px wide → 2 photo px per screen px; drag 50 px right → window 100 px left.
  const c1 = panCrop(iw, ih, a, c0, 50, 0, 250);
  const r1 = coverCrop(iw, ih, a, c1);
  close(r1.x, r0.x - 100);
  close(r1.y, r0.y);
});

test("pan: an overshoot is clamped, so dragging back responds at once", () => {
  const iw = 2000, ih = 1000, a = 0.5;
  const far = panCrop(iw, ih, a, { cx: 0.5, cy: 0.5 }, 1e6, 0, 250);
  close(coverCrop(iw, ih, a, far).x, 0);
  const back = panCrop(iw, ih, a, far, -10, 0, 250);
  close(coverCrop(iw, ih, a, back).x, 20);
});

test("nudge: arrow keys step 5% of the window and ignore other keys", () => {
  const iw = 2000, ih = 1000, a = 0.5;
  const c = nudgeCrop(iw, ih, a, { cx: 0.5, cy: 0.5 }, "ArrowRight")!;
  const r0 = coverCrop(iw, ih, a), r1 = coverCrop(iw, ih, a, c);
  close(r1.x - r0.x, r0.w * 0.05);
  assert.equal(nudgeCrop(iw, ih, a, { cx: 0.5, cy: 0.5 }, "Enter"), null);
  // Already full height: up/down cannot move it.
  const u = nudgeCrop(iw, ih, a, { cx: 0.5, cy: 0.5 }, "ArrowUp")!;
  close(coverCrop(iw, ih, a, u).y, 0);
});

test("centreOf inverts coverCrop where the window is free to move", () => {
  const r = coverCrop(1000, 800, 1, { cx: 0.4, cy: 0.5 });
  const c = centreOf(r, 1000, 800);
  close(c.cx, 0.4); close(c.cy, 0.5);
});

test("estimate: 0.8 h per 2500 mm², rounded, at least 1", () => {
  assert.equal(estimateHours(100, 140), 4); // 4.48
  assert.equal(estimateHours(50, 50), 1); // 0.8
  assert.equal(estimateHours(10, 10), 1);
  assert.equal(estimateHours(270, 270), 23); // 23.3
  assert.equal(estimateHours(NaN, 100), 1);
});

test("size: clamped to 10–270 mm, with a fallback for junk", () => {
  assert.equal(clampSizeMm("300", 100), 270);
  assert.equal(clampSizeMm(5, 100), 10);
  assert.equal(clampSizeMm("", 100), 100);
  assert.equal(clampSizeMm("abc", 140), 140);
  assert.equal(clampSizeMm("120.5", 100), 120.5);
});
