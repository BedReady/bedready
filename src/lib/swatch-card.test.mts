// The TD calibration card and its solver.
//
// The card is a measuring instrument, so the thing worth pinning is that it measures the SAME model
// the engine predicts with. hueforge.ts computes opacity as 1 - 0.1^(T/TD); if the solver ever fits a
// different curve, every TD it produces would be quietly wrong in a way no structural check catches —
// the files would print, the colours would just be off. The round-trip test below closes that loop by
// synthesising samples straight from the engine's formula and requiring the solver to recover TD.
import { test } from "node:test";
import assert from "node:assert/strict";
import { unzipSync, strFromU8 } from "fflate";
import { buildSwatchCard, solveTd, contrastOf, type Sample } from "./swatch-card.ts";

test("the card steps up exactly one layer per pad", () => {
  const c = buildSwatchCard({ steps: 6, layerH: 0.1, baseLayers: 5 })!;
  assert.ok(c, "card should build");
  assert.equal(c.steps.length, 6);
  assert.equal(c.baseZ, 0.5);
  assert.deepEqual(c.steps.map((s) => s.layers), [1, 2, 3, 4, 5, 6]);
  // Each pad is the backing plus exactly its own layer count — this is the measurement.
  for (const s of c.steps) assert.ok(Math.abs(s.z - (0.5 + s.layers * 0.1)) < 1e-6, `pad ${s.layers} at ${s.z}`);
  // Pads must not overlap, or two thicknesses share one sample area.
  const xs = c.steps.map((s) => s.cx);
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i] > xs[i - 1], "pads march along X");
});

test("the backing prints on head 1 and the filament under test on head 2", () => {
  const c = buildSwatchCard({ steps: 4, layerH: 0.08, baseLayers: 10, backingHex: "#101010", testHex: "#C21807" })!;
  const e = unzipSync(c.bytes);
  const xml = strFromU8(e["Metadata/layer_config_ranges.xml"]);
  const heads = [...xml.matchAll(/<option opt_key="extruder">(\d+)<\/option>/g)].map((m) => m[1]);
  assert.deepEqual(heads, ["1", "2"], "one swap: backing, then the filament being measured");
  const cfg = JSON.parse(strFromU8(e["Metadata/project_settings.config"]));
  assert.equal(cfg.printer_model, "Snapmaker U1");
  assert.deepEqual(cfg.filament_colour.slice(0, 2), ["#101010", "#C21807"]);
  // The swap must land exactly on top of the backing. One layer out and every pad carries the wrong
  // number of test layers, which biases TD without looking wrong.
  const zs = [...xml.matchAll(/max_z="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.ok(Math.abs(zs[0] - c.baseZ) < 1e-4, `first band should end at the backing top, got ${zs[0]}`);
});

test("the card is a package a slicer will open", () => {
  const e = unzipSync(buildSwatchCard({ steps: 4 })!.bytes);
  const names = new Set(Object.keys(e));
  // The invariant four separate plate bugs were needed to learn: nothing may name a part that is not
  // here, and no object id may reference an object the root does not define.
  const missing: string[] = [];
  for (const n of names) {
    if (/Objects\/.*\.model$/.test(n)) continue;
    for (const m of strFromU8(e[n]).matchAll(/["'>\s](\/?(?:Metadata|3D)\/[\w\-./]+\.(?:png|model|config|xml|rels))/g)) {
      if (!names.has(m[1].replace(/^\/+/, ""))) missing.push(`${n} -> ${m[1]}`);
    }
  }
  assert.deepEqual(missing, [], "no reference to an absent part");
  const root = strFromU8(e["3D/3dmodel.model"]);
  const defined = new Set([...root.matchAll(/<object\s+id="(\d+)"/g)].map((m) => m[1]));
  const built = [...root.matchAll(/<item\b[^>]*objectid="(\d+)"/g)].map((m) => m[1]);
  assert.ok(built.length > 0, "the card must be on the build plate");
  assert.deepEqual(built.filter((id) => !defined.has(id)), [], "every build item resolves");
});

test("rejects settings that cannot measure anything", () => {
  assert.equal(buildSwatchCard({ steps: 1 }), null, "one pad fits no curve");
  assert.equal(buildSwatchCard({ layerH: 0 }), null);
  assert.equal(buildSwatchCard({ baseLayers: 0 }), null, "no backing means nothing to see through");
});

/** Samples generated from the engine's own transmission model at a known TD. */
function synthesise(td: number, layerH: number, steps: number,
  backing: [number, number, number], opaque: [number, number, number]): Sample[] {
  return Array.from({ length: steps }, (_, i) => {
    const T = (i + 1) * layerH;
    const f = Math.pow(0.1, T / td); // hueforge.ts: opacity = 1 - 0.1^(T/TD)
    return {
      layers: i + 1,
      rgb: [0, 1, 2].map((c) => opaque[c] + (backing[c] - opaque[c]) * f) as [number, number, number],
    };
  });
}

test("solveTd recovers the TD its samples were generated from", () => {
  const backing: [number, number, number] = [16, 16, 16];
  const opaque: [number, number, number] = [194, 24, 7];
  for (const td of [0.4, 1.2, 3, 8]) {
    const got = solveTd(synthesise(td, 0.08, 14, backing, opaque), backing, opaque, 0.08);
    assert.ok(got, `no fit for TD ${td}`);
    assert.ok(Math.abs(got!.td - td) < 0.02 * td, `TD ${td} -> ${got!.td}`);
    assert.ok(got!.residual < 0.05 * td, `fit should be tight, residual ${got!.residual}`);
  }
});

test("solveTd ignores readings that carry no information", () => {
  const backing: [number, number, number] = [16, 16, 16];
  const opaque: [number, number, number] = [194, 24, 7];
  const samples = synthesise(1.5, 0.08, 14, backing, opaque);
  // Pads thick enough to be fully opaque have hit the floor: they say "at least this thick", not
  // "this thick". Including them would drag the estimate up without bound.
  samples.push({ layers: 40, rgb: [...opaque] as [number, number, number] });
  samples.push({ layers: 60, rgb: [...opaque] as [number, number, number] });
  const got = solveTd(samples, backing, opaque, 0.08)!;
  assert.ok(Math.abs(got.td - 1.5) < 0.05, `saturated pads must not skew the fit, got ${got.td}`);
  assert.ok(got.used < samples.length, "the saturated readings should be dropped");
});

test("solveTd declines rather than inventing a number", () => {
  const grey: [number, number, number] = [128, 128, 128];
  // No contrast between backing and filament: the card cannot measure this pairing at all, and a
  // confident wrong TD here would poison every colour the engine predicts for that spool.
  assert.equal(solveTd([{ layers: 3, rgb: [128, 128, 128] }], grey, grey, 0.08), null);
  assert.equal(solveTd([], [16, 16, 16], [194, 24, 7], 0.08), null);
});

// WHAT THE FIRST REAL PRINT TAUGHT (2026-08-04). A red backing under a red test filament left green
// and blue with no usable span, so a 14-pad card yielded one channel of signal and a TD with a ±42%
// spread. Identical colours were already refused; near colours were not, and near is almost as bad.
test("refuses a colour pairing it cannot measure", () => {
  assert.equal(buildSwatchCard({ backingHex: "#8B1A10", testHex: "#C21807" }), null, "red on red");
  assert.equal(buildSwatchCard({ backingHex: "#C21807", testHex: "#C21807" }), null, "identical");
  assert.ok(buildSwatchCard({ backingHex: "#101010", testHex: "#C21807" }), "black backing is fine");
  assert.ok(contrastOf("#101010", "#C21807") > contrastOf("#8B1A10", "#C21807"));
  assert.equal(buildSwatchCard({ backingHex: "not-a-hex", testHex: "#C21807" }), null);
});

// The same print showed pads 11-14 carrying no signal at all and pad 1 indistinguishable from the
// base: every usable reading sat between 0.16 and 0.80 mm. Spending steps above that prints plastic
// the solver then discards.
test("the default card concentrates its steps where the signal is", () => {
  const c = buildSwatchCard()!;
  const thickest = c.steps[c.steps.length - 1].layers * c.layerH;
  assert.ok(thickest <= 0.8 + 1e-9, `thickest pad ${thickest}mm should stay inside the usable range`);
});

// Drift is what exposed the bad fit. Averaging a drifting series reports where the weights sat, not
// a transmission distance, so solveTd has to surface the difference between scatter and slide.
test("solveTd reports drift, so a model mismatch cannot hide inside the mean", () => {
  const backing: [number, number, number] = [16, 16, 16];
  const opaque: [number, number, number] = [194, 24, 7];
  const clean = solveTd(synthesise(1.5, 0.08, 10, backing, opaque), backing, opaque, 0.08)!;
  assert.ok(Math.abs(clean.drift) < 0.5, `a true single-TD fit should not trend, got ${clean.drift}`);

  // Samples bent so the apparent TD slides with thickness, as the real print's did.
  const bent = synthesise(1.5, 0.08, 10, backing, opaque).map((s, i) => ({
    layers: s.layers,
    rgb: s.rgb.map((v, c) => v + (opaque[c] - v) * (i / 12)) as [number, number, number],
  }));
  const got = solveTd(bent, backing, opaque, 0.08)!;
  assert.ok(got.drift < -0.7, `a downward slide should report drift near -1, got ${got.drift}`);
});
