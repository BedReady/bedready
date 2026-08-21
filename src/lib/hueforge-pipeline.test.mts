// Photo -> HueForge relief -> U1 3MF, end to end.
//
// The engine and the assembler each have their own parity tests against the desktop app. This file
// covers the seam between them, which exists only on the web side and therefore has no app version
// to compare against: the layer-range -> Z-height conversion, and the "don't emit an empty model"
// guards. The band conversion is the sharp edge — startLayer is 1-based and inclusive, so an
// off-by-one puts every colour swap one layer out, which still slices and still prints, just wrong.
import { test } from "node:test";
import assert from "node:assert/strict";
import { unzipSync, strFromU8 } from "fflate";
import { buildStack } from "./hueforge.ts";
import { imageToHueForgeU1, stackBandsToSwapBands } from "./hueforge-pipeline.ts";

const FILS = [{ hex: "#101010" }, { hex: "#C21807", td: 3 }, { hex: "#F5F5F5", td: 9, layers: 14 }];

function photo(W = 24, H = 18) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    // a smooth-ish gradient, which is what relief mode is for
    data[i * 4] = (i * 7) % 256;
    data[i * 4 + 1] = (i * 3) % 256;
    data[i * 4 + 2] = 255 - ((i * 5) % 256);
    data[i * 4 + 3] = 255;
  }
  return { data, width: W, height: H };
}

test("bands convert from 1-based layer ranges to contiguous Z heights", () => {
  const stack = buildStack(FILS);
  const swap = stackBandsToSwapBands(stack);
  assert.equal(swap.length, stack.bands.length);
  // First band starts at the bed, not one layer up.
  assert.equal(swap[0].z0, 0, "the first band must start at z=0");
  // Bands tile without gaps or overlap — a gap is a height with no assigned head.
  for (let i = 1; i < swap.length; i++) {
    assert.equal(swap[i].z0, swap[i - 1].z1, `band ${i} must start where band ${i - 1} ended`);
  }
  // Heads are assigned in print order, and colours follow the stack.
  assert.deepEqual(swap.map((b) => b.head), stack.bands.map((_, i) => i));
  assert.deepEqual(swap.map((b) => b.hex), stack.bands.map((b) => b.hex));
  // Total height matches the stack's layer count.
  assert.equal(swap[swap.length - 1].z1, +(stack.totalLayers * stack.layerH).toFixed(4));
});

test("produces a U1 3MF whose swaps are height-range modifiers", () => {
  const r = imageToHueForgeU1(photo(), { filaments: FILS, widthMm: 80, name: "t" });
  assert.ok(r, "pipeline returned null");
  const e = unzipSync(r!.bytes);
  const xml = strFromU8(e["Metadata/layer_config_ranges.xml"]);
  const heads = [...xml.matchAll(/<option opt_key="extruder">(\d+)<\/option>/g)].map((m) => m[1]);
  assert.deepEqual(heads, ["1", "2", "3"], "one head per band, in order");
  const cfg = JSON.parse(strFromU8(e["Metadata/project_settings.config"]));
  assert.equal(cfg.printer_model, "Snapmaker U1");
  assert.deepEqual(cfg.filament_colour.slice(0, 3), ["#101010", "#C21807", "#F5F5F5"]);
});

test("reports the match quality and whether it prints without a reload", () => {
  const r = imageToHueForgeU1(photo(), { filaments: FILS, widthMm: 80 })!;
  assert.ok(Number.isFinite(r.meanDeltaE) && r.meanDeltaE >= 0, "meanDeltaE must be a real number");
  assert.equal(r.plan.colorCount, 3);
  assert.equal(r.plan.automatic, true, "3 colours on 4 heads needs no mid-print reload");
  assert.equal(r.sizeMm.x, 80, "footprint honours widthMm");
  assert.ok(r.sizeMm.z > 0, "a relief must have height");
});

test("suggests filaments from the image when none are given", () => {
  const r = imageToHueForgeU1(photo(), { widthMm: 60, maxColors: 3 });
  assert.ok(r, "should still produce a model");
  assert.ok(r!.filaments.length >= 2 && r!.filaments.length <= 4, `got ${r!.filaments.length} filaments`);
  assert.ok(r!.filaments.every((f) => /^#[0-9A-F]{6}$/i.test(f.hex)), "every suggestion is a real hex");
});

test("returns null rather than an empty model", () => {
  assert.equal(imageToHueForgeU1({ data: new Uint8ClampedArray(0), width: 0, height: 0 }), null);
  // Every filament unparseable -> buildStack filters them all out -> no palette -> null.
  assert.equal(imageToHueForgeU1(photo(), { filaments: [{ hex: "zzz" }] }), null, "unparseable filament");
});

test("an empty filament list means 'suggest for me', not 'none'", () => {
  // `opts.filaments?.length ? ... : suggest(...)` — an empty array is indistinguishable from
  // omitting the option, which is the app's convention. Pinned so it isn't mistaken for a bug.
  const r = imageToHueForgeU1(photo(), { filaments: [], widthMm: 60 });
  assert.ok(r, "empty list should fall back to suggested filaments");
  assert.ok(r!.filaments.length >= 2);
});
