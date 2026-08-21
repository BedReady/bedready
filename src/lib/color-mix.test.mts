// color-mix.ts is a port of the BedReady desktop app's lib/color-mix.js. These tests pin the
// behaviour that matters, plus known-good CIEDE2000 reference values.
//
// Why CIEDE2000 rather than the CIE76 deltaE already inside convert.ts: HueForge ranks thousands of
// candidate colours along a transmission gradient, and CIE76's blue/saturation errors pick a visibly
// wrong layer height there. The reference pairs below are from the Sharma et al. CIEDE2000 test set,
// which is the standard way to catch a mis-transcribed term in that formula — the hue-rotation term
// in particular is easy to get subtly wrong and hard to notice by eye.
import { test } from "node:test";
import assert from "node:assert/strict";
import { hexToRgb, rgbToHex, rgbToLab, hexToLab, deltaE, ciede2000, nearest, blend, gradient } from "./color-mix.ts";

const close = (a: number, b: number, tol = 1e-4) =>
  assert.ok(Math.abs(a - b) < tol, `${a} !== ${b} (tol ${tol})`);

test("hexToRgb accepts 3- and 6-digit, with or without #, and rejects junk", () => {
  assert.deepEqual(hexToRgb("#FF8800"), { r: 255, g: 136, b: 0 });
  assert.deepEqual(hexToRgb("f80"), { r: 255, g: 136, b: 0 });
  assert.deepEqual(hexToRgb("  #ff8800 "), { r: 255, g: 136, b: 0 });
  for (const bad of ["", "#12345", "nope", null, undefined]) assert.equal(hexToRgb(bad), null);
});

test("rgbToHex clamps and rounds", () => {
  assert.equal(rgbToHex(255, 136, 0), "#FF8800");
  assert.equal(rgbToHex(-5, 300, 127.6), "#00FF80");
});

test("rgbToLab hits the D65 reference points", () => {
  const white = rgbToLab({ r: 255, g: 255, b: 255 });
  close(white.L, 100, 0.01);
  close(white.a, 0, 0.05); // the D65 matrix constants leave a ~0.01 residue; unchanged from the app
  close(white.b, 0, 0.05);
  const black = rgbToLab({ r: 0, g: 0, b: 0 });
  close(black.L, 0, 0.01);
});

// Sharma et al. CIEDE2000 reference pairs — these specifically exercise the hue-rotation and
// chroma-weighting terms that a transcription error would break.
test("ciede2000 matches published reference values", () => {
  const cases: [number[], number[], number][] = [
    [[50.0000, 2.6772, -79.7751], [50.0000, 0.0000, -82.7485], 2.0425],
    [[50.0000, 3.1571, -77.2803], [50.0000, 0.0000, -82.7485], 2.8615],
    [[50.0000, 2.8361, -74.0200], [50.0000, 0.0000, -82.7485], 3.4412],
    [[50.0000, -1.3802, -84.2814], [50.0000, 0.0000, -82.7485], 1.0000],
    [[50.0000, 0.0000, 0.0000], [50.0000, -1.0000, 2.0000], 2.3669],
    [[50.0000, -1.0000, 2.0000], [50.0000, 0.0000, 0.0000], 2.3669], // symmetric
    [[50.0000, 2.4900, -0.0010], [50.0000, -2.4900, 0.0009], 7.1792],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
  ];
  for (const [a, b, want] of cases) {
    const got = ciede2000({ L: a[0], a: a[1], b: a[2] }, { L: b[0], a: b[1], b: b[2] });
    close(got, want, 1e-4);
  }
});

test("deltaE is zero for identical colours and Infinity for junk", () => {
  close(deltaE("#123456", "#123456"), 0, 1e-9);
  assert.equal(deltaE("#123456", "not-a-colour"), Infinity);
  assert.equal(deltaE("#123456", null), Infinity);
});

test("deltaE ranks a near-match below an obvious mismatch", () => {
  const near = deltaE("#FF0000", "#FE0201");
  const far = deltaE("#FF0000", "#00FF00");
  assert.ok(near < 2, `near-identical reds should be tiny, got ${near}`);
  assert.ok(far > 50, `red vs green should be large, got ${far}`);
});

test("nearest sorts closest-first, tags deltaE, drops uncomparable, honours limit", () => {
  const cands = [
    { name: "green", color: "#00FF00" },
    { name: "almost", color: "#FE0201" },
    { name: "broken", color: "zzz" },
    { name: "blue", color: "#0000FF" },
  ];
  const out = nearest("#FF0000", cands);
  assert.equal(out[0].name, "almost");
  assert.ok(!out.some((c) => c.name === "broken"), "uncomparable candidates are dropped");
  assert.ok(out.every((c) => typeof c.deltaE === "number"));
  assert.equal(nearest("#FF0000", cands, { limit: 2 }).length, 2);
  // A non-default colour field, which the filament inventory uses.
  assert.equal(nearest("#FF0000", [{ hex: "#FE0201" }], { key: "hex" })[0].hex, "#FE0201");
});

test("blend mixes in LINEAR light, not sRGB", () => {
  // The whole point of linear blending: 50% black↔white is ~#BC, not the naive #808080.
  const mid = blend("#000000", "#FFFFFF", 0.5)!;
  const v = parseInt(mid.slice(1, 3), 16);
  assert.ok(v > 180 && v < 195, `linear-light midpoint should be ~188, got ${mid}`);
  assert.equal(blend("#112233", "#445566", 0), "#112233");
  assert.equal(blend("#112233", "#445566", 1), "#445566");
  // "bad" would NOT work here — b/a/d are all hex digits, so it parses as #BBAADD.
  assert.equal(blend("zzz", "#445566", 0.5), null);
});

test("gradient includes both endpoints and has the requested length", () => {
  const g = gradient("#000000", "#FFFFFF", 5);
  assert.equal(g.length, 5);
  assert.equal(g[0], "#000000");
  assert.equal(g[4], "#FFFFFF");
  assert.equal(gradient("#000000", "nope", 5).length, 0, "a bad endpoint yields no gradient");
});

test("hexToLab round-trips through rgbToLab", () => {
  assert.deepEqual(hexToLab("#FF8800"), rgbToLab({ r: 255, g: 136, b: 0 }));
  assert.equal(hexToLab("nope"), null);
});
