import { test } from "node:test";
import assert from "node:assert/strict";
import { reliefGrid } from "./relief-grid.ts";

test("the relief grid follows the nozzle, not the 140 px preview", () => {
  assert.equal(reliefGrid(100, 140, 100, 140), 250); // landscape 100 mm: 0.4 mm cells across
  assert.equal(reliefGrid(100, 100, 140, 140), 350); // portrait: the longer side scales with it
  assert.equal(reliefGrid(40, 140, 140, 140), 140); // small plate: never below the preview grid
  assert.equal(reliefGrid(300, 140, 140, 140), 400); // big plate: capped for solve time
});
