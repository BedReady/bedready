// When to suggest one file per plate: more colours than slots overall, few enough on every plate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { coloursPerPlate, platesFitSlots } from "./plate-colors.ts";

const PAL = ["#000000", "#FFFFFF", "#FF0000", "#00FF00", "#0000FF", "#FFFF00", "#FF00FF", "#00FFFF"];
/** One part per plate, painted with the given states (0 = the base colour). */
function mesh(plates: number[][], baseState = 1) {
  return {
    palette: PAL, baseState,
    parts: plates.map((states) => ({ faceState: Uint8Array.from(states) })),
    plates: plates.map((_, i) => ({ partIndices: [i] })),
  };
}

test("one colour per plate, eight in all, fits a 4-slot printer plate by plate", () => {
  assert.equal(platesFitSlots(mesh([[1], [2], [3], [4], [5], [6], [7], [8], [2]]), 4), 9);
});

test("no suggestion when the whole file already fits, or a single plate", () => {
  assert.equal(platesFitSlots(mesh([[1, 2], [3, 4]]), 4), null);
  assert.equal(platesFitSlots(mesh([[1, 2, 3, 4, 5, 6]]), 4), null);
});

test("no suggestion when any plate needs more than the slots", () => {
  assert.equal(platesFitSlots(mesh([[1, 4, 5, 6, 8], [2, 3], [7]]), 4), null);
});

test("unpainted faces count as the base colour, and out-of-palette states are ignored", () => {
  assert.deepEqual(coloursPerPlate(mesh([[0, 0, 3], [0, 99]], 2)), [[2, 3], [2]]);
});
