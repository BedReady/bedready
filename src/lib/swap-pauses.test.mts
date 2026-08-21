// buildBandSwapPlan tests — turning a detectColorBands result into a manual filament-swap plan for the
// 4-head U1. Validates: ≤4 colours need no manual swap (toolchanger covers them), >4 colours produce
// swaps at the right height, and repeated colours reuse their head instead of re-swapping. Run: `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBandSwapPlan } from "./swap-pauses.ts";

const PALETTE = ["#ff0000", "#00ff00", "#0000ff", "#ffff00", "#ff00ff", "#00ffff"]; // states 1..6
const band = (state: number, z0: number, z1: number) => ({ state, z0, z1 });

test("2 colours → no manual swaps (both ride the toolheads)", () => {
  const { instructions, headOf } = buildBandSwapPlan([band(1, 0, 5), band(2, 5, 10)], PALETTE, "M600", 0.2);
  assert.equal(instructions.length, 0);
  assert.equal(headOf.get(1), 0);
  assert.equal(headOf.get(2), 1);
});

test("4 colours → still no manual swaps (exactly fills 4 heads)", () => {
  const bands = [band(1, 0, 4), band(2, 4, 8), band(3, 8, 12), band(4, 12, 16)];
  const { instructions } = buildBandSwapPlan(bands, PALETTE, "M600", 0.2);
  assert.equal(instructions.length, 0);
});

test("repeated colour (red, blue, red) → 0 swaps: each colour keeps its own head", () => {
  const bands = [band(1, 0, 5), band(2, 5, 10), band(1, 10, 15)];
  const { instructions } = buildBandSwapPlan(bands, PALETTE, "M600", 0.2);
  assert.equal(instructions.length, 0);
});

test("5 distinct colours → 1 manual swap, at one layer below the 5th band", () => {
  const bands = [band(1, 0, 4), band(2, 4, 8), band(3, 8, 12), band(4, 12, 16), band(5, 16, 20)];
  const { instructions } = buildBandSwapPlan(bands, PALETTE, "M600", 0.2);
  assert.equal(instructions.length, 1);
  const s = instructions[0];
  assert.equal(s.toSlot, 5); // load the 5th colour
  assert.equal(s.toColour, "#ff00ff"); // state 5 → PALETTE[4]
  assert.equal(s.z, 16 - 0.2); // pause one layer-height below the band it serves
  assert.equal(s.toolhead, 1); // reused head 0 (1-based)
});

test("6 distinct colours → 2 manual swaps", () => {
  const bands = [1, 2, 3, 4, 5, 6].map((s, i) => band(s, i * 4, i * 4 + 4));
  const { instructions } = buildBandSwapPlan(bands, PALETTE, "M600", 0.2);
  assert.equal(instructions.length, 2);
});

test("customGcodeXml: one M600 pause layer per swap height, valid custom_gcode file", () => {
  const bands = [band(1, 0, 4), band(2, 4, 8), band(3, 8, 12), band(4, 12, 16), band(5, 16, 20)];
  const { customGcodeXml } = buildBandSwapPlan(bands, PALETTE, "M600", 0.2);
  assert.match(customGcodeXml, /<custom_gcodes_per_layer>/);
  assert.match(customGcodeXml, /type="1"[^>]*gcode="M600"/);
  assert.equal((customGcodeXml.match(/<layer\b/g) ?? []).length, 1); // one swap → one pause layer
  assert.match(customGcodeXml, /top_z="15\.8"/); // 16 − 0.2
});

test("baseState seeds head 0 so unpainted faces stay correct", () => {
  // Bottom band is colour 3 (not the base). Force base colour 1 onto head 0.
  const bands = [band(3, 0, 5), band(1, 5, 10)];
  const { headOf } = buildBandSwapPlan(bands, PALETTE, "M600", 0.2, 1);
  assert.equal(headOf.get(1), 0); // base colour → head 0 (slot 1)
  assert.equal(headOf.get(3), 1);
});
