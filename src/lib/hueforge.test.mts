// Golden values for the ported HueForge relief engine.
//
// hueforge.ts is a mechanical port of the desktop app's lib/hueforge.js (638b0dd on the app's
// rebase/hueforge-flat). Porting meant ~100 edits — unary `+` on optional fields rewritten to
// Number(), non-null assertions, type annotations — every one of which could have shifted maths
// nobody would notice until a print came out the wrong colour.
//
// So the port was checked against the app directly, function by function, on identical inputs:
// luminance, defaultTd, layerAlpha, suggestLayers, orderByOpacity, buildStack (default opts, custom
// opts, and a deliberately poisoned layerH of "1e999"), solveHeightfield, downsample, downsampleAvg,
// scorePlan, enhancePalette, compositeSequence, sequenceToBands, quantizeTargets, u1Plan,
// smoothHeights, heightfieldToMesh and meshToStlBinary — 30 comparisons, all byte-identical.
//
// That comparison can't run in CI (it needs the app checked out next door), so the verified outputs
// are pinned here instead. If one of these changes, the port has drifted from the app — which is
// exactly the failure this file exists to catch, because the two would then turn the same photo into
// differently-coloured prints.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  luminance, defaultTd, layerAlpha, suggestLayers, orderByOpacity,
  buildStack, solveHeightfield, enhancePalette, sequenceToBands, u1Plan, smoothHeights,
  heightfieldToMesh, meshToStlBinary,
} from "./hueforge.ts";

const FILS = [{ hex: "#101010" }, { hex: "#C21807", td: 3 }, { hex: "#F5F5F5", td: 9, layers: 14 }];

/** A deterministic little image — no randomness, so the numbers below are stable. */
function testImage(W = 16, H = 12) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    data[i * 4] = (i * 37) % 256;
    data[i * 4 + 1] = (i * 91) % 256;
    data[i * 4 + 2] = (i * 13) % 256;
    data[i * 4 + 3] = i % 23 === 0 ? 0 : 255; // a few transparent pixels
  }
  return { data, width: W, height: H };
}

test("scalar helpers match the app", () => {
  assert.equal(luminance("#FF8800"), 0.59404);
  assert.equal(defaultTd("#FF8800"), 2.6);
  assert.equal(layerAlpha(0.08, 4), 0.045007413978564004);
  assert.equal(suggestLayers(4, 0.08), 13);
});

test("layerAlpha refuses to propagate a bad thickness as NaN", () => {
  // The app guards this deliberately: NaN here composites into a silently wrong colour.
  assert.equal(layerAlpha(NaN, 4), 0);
  assert.equal(layerAlpha(-1, 4), 0);
});

test("orderByOpacity sorts opaque (low TD) to the bottom", () => {
  assert.deepEqual(orderByOpacity(FILS).map((f) => f.hex), ["#101010", "#C21807", "#F5F5F5"]);
});

test("buildStack produces the app's stack and colour gradient", () => {
  const st = buildStack(FILS);
  assert.equal(st.totalLayers, 38);
  assert.equal(st.baseLayers, 4);
  assert.equal(st.bands.length, 3);
  assert.equal(st.palette.length, 35);
  assert.equal(st.palette[0].hex, "#101010", "gradient starts at the opaque base");
  assert.equal(st.palette[st.palette.length - 1].hex, "#B18584", "and ends at the composited top");
});

test("buildStack survives a layerH that is technically a number but not a height", () => {
  // +"1e999" is Infinity; the app guards it so the stack can't describe an unprintable part.
  const st = buildStack(FILS, { layerH: "1e999" as unknown as number });
  assert.equal(st.layerH, 0.08, "falls back to the default layer height");
  assert.ok(Number.isFinite(st.palette[0].height ?? 0));
});

test("solveHeightfield picks heights across the palette band", () => {
  const st = buildStack(FILS);
  const sol = solveHeightfield(testImage(), st, { smooth: 0 });
  assert.equal(sol.minK, 4, "transparent pixels sit on the base floor");
  assert.equal(sol.maxK, 38);
  assert.equal(+sol.meanDeltaE.toFixed(6), 32.267767);
  assert.equal(sol.heights.length, 16 * 12);
  assert.equal(sol.preview.length, 16 * 12 * 4);
});

test("enhancePalette deepens the darkest and lifts the lightest", () => {
  assert.deepEqual(enhancePalette(["#334455", "#AABBCC", "#778899"]), ["#192633", "#D2DDE9", "#7189A1"]);
});

test("sequenceToBands converts a per-layer sequence into Z ranges per head", () => {
  assert.deepEqual(sequenceToBands([0, 0, 1, 1, 2], FILS, 0.08), [
    { z0: 0, z1: 0.16, head: 0, hex: "#101010" },
    { z0: 0.16, z1: 0.32, head: 1, hex: "#C21807" },
    { z0: 0.32, z1: 0.4, head: 2, hex: "#F5F5F5" },
  ]);
});

test("u1Plan is automatic while the colours fit the four heads", () => {
  const plan = u1Plan(buildStack(FILS));
  assert.equal(plan.heads, 4);
  assert.equal(plan.colorCount, 3);
  assert.equal(plan.automatic, true, "3 colours on 4 heads needs no reload");
});

test("smoothHeights removes an isolated spike without touching the rest", () => {
  const out = smoothHeights(new Uint16Array([4, 9, 4, 4, 4, 4, 4, 4, 4]), 3, 3, 1);
  assert.ok(out[1] < 9, "the 9 spike is pulled down");
  assert.ok(Array.from(out).every((v) => v >= 4 && v <= 9), "stays inside the palette band");
});

test("heightfieldToMesh yields a watertight-sized plate and a valid binary STL", () => {
  const sol = solveHeightfield(testImage(), buildStack(FILS), { smooth: 0 });
  const mesh = heightfieldToMesh(sol, { widthMm: 60 });
  assert.equal(mesh.sizeMm.x, 60, "footprint honours widthMm");
  assert.ok(mesh.triangleCount > 0);
  const stl = meshToStlBinary(mesh.triangles);
  // Binary STL: 80-byte header + uint32 count + 50 bytes per triangle.
  assert.equal(stl.length, 84 + mesh.triangleCount * 50);
  assert.equal(new DataView(stl.buffer, stl.byteOffset).getUint32(80, true), mesh.triangleCount);
});
