// The relief's filament picker. What it promises: a dark base and a light top, picks that are
// visibly different from each other, the photo's distinct hues even when they cover little of it,
// and only colours from the list (so every pick has a name a maker can buy by).
import { test } from "node:test";
import assert from "node:assert/strict";
import { FILAMENTS, pickFilaments } from "./hueforge-palette.ts";
import { deltaE, hexToLab } from "./color-mix.ts";

/** A portrait-shaped test card: mostly skin, a white headdress, a dark robe, and a small red check. */
function portrait(W = 80, H = 80) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      let c = [214, 166, 132]; // skin, ~half the card
      if (y < 16) c = [240, 240, 236]; // headdress
      if (y >= 56) c = [24, 20, 22]; // robe
      if (y < 16 && x < 12) c = [200, 30, 30]; // a small red check, ~3 % of the card
      if (x >= 70) c = [236, 236, 232]; // background
      // a little noise, as in a photo
      const n = ((x * 7 + y * 13) % 9) - 4;
      data[o] = c[0] + n; data[o + 1] = c[1] + n; data[o + 2] = c[2] + n; data[o + 3] = 255;
    }
  }
  return { data, width: W, height: H };
}

const listed = new Set(FILAMENTS.map((f) => f.hex));

test("anchors a dark base and a light top, ordered bottom first", () => {
  const p = pickFilaments(portrait(), 4);
  assert.equal(p.length, 4);
  const L = p.map((f) => hexToLab(f.hex)!.L);
  assert.ok(Math.min(...L) < 20, `a near-black base, got L ${L}`);
  assert.ok(Math.max(...L) > 85, `a near-white top, got L ${L}`);
  // orderByOpacity: transmission distance never decreases up the stack
  for (let i = 1; i < p.length; i++) assert.ok(p[i].td >= p[i - 1].td, "opaque at the bottom");
});

test("keeps a small distinct hue instead of a second shade of the dominant one", () => {
  const p = pickFilaments(portrait(), 4);
  const reds = p.filter((f) => { const lab = hexToLab(f.hex)!; return lab.a > 35 && lab.L < 60; });
  assert.ok(reds.length >= 1, `the red check should get a head: ${p.map((f) => f.name)}`);
  for (let i = 0; i < p.length; i++)
    for (let j = i + 1; j < p.length; j++)
      assert.ok(deltaE(p[i].hex, p[j].hex) >= 12, `${p[i].name} and ${p[j].name} are near-duplicates`);
});

test("every pick is a listed colour with a name", () => {
  for (const f of pickFilaments(portrait(), 4)) {
    assert.ok(listed.has(f.hex), `${f.hex} is not in FILAMENTS`);
    assert.ok(FILAMENTS.some((x) => x.key === f.name), `${f.name} has no entry`);
  }
});

test("grayscale picks only neutrals, black to white", () => {
  const p = pickFilaments(portrait(), 4, { grayscale: true });
  assert.equal(p.length, 4);
  const neutral = new Set(FILAMENTS.filter((f) => f.neutral).map((f) => f.hex));
  assert.ok(p.every((f) => neutral.has(f.hex)), `${p.map((f) => f.name)}`);
  assert.equal(p[0].name, "black");
  assert.equal(p[p.length - 1].name, "white");
});

test("a two-colour image gets fewer picks, not padding", () => {
  const W = 40, H = 40, data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { const v = i % W < 20 ? 10 : 245; data.set([v, v, v, 255], i * 4); }
  const p = pickFilaments({ data, width: W, height: H }, 4);
  assert.equal(p.length, 2, `${p.map((f) => f.name)}`);
});

test("an empty or fully transparent image picks nothing", () => {
  assert.deepEqual(pickFilaments({ data: new Uint8ClampedArray(0), width: 0, height: 0 }, 4), []);
  assert.deepEqual(pickFilaments({ data: new Uint8ClampedArray(16 * 4), width: 4, height: 4 }, 4), []);
});

test("nearestFilament names the closest listed colour", async () => {
  const { nearestFilament } = await import("./filament-colors.ts");
  assert.equal(nearestFilament("#000000"), "black");
  assert.equal(nearestFilament("#FFFFFF"), "white");
  assert.equal(nearestFilament("#C0201A"), "red");
  assert.equal(nearestFilament("zzz"), null);
});
