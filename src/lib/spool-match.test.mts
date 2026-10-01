// Matching a model's colours to the spools already loaded. Run: `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FAR_MATCH, matchToSpools } from "./spool-match.ts";

const CMYK = ["#29ABE2", "#ED1E79", "#FCEE21", "#111111"];

test("each colour goes to the slot that looks most like it", () => {
  // Near-CMYK shades (ΔE 3–11). Dodger blue would map to the cyan slot too, but at ΔE 37 it is a
  // different blue, and the far-match flag is right to say so.
  const r = matchToSpools(["#2299DD", "#E0207A", "#F5E820", "#000000"], CMYK);
  assert.deepEqual(r.map, [0, 1, 2, 3]);
  assert.deepEqual(r.far, []);
  assert.deepEqual(matchToSpools(["#1E90FF"], CMYK).far, [0]);
});

test("slots are shared: several shades of one colour all print from that spool", () => {
  const r = matchToSpools(["#E00000", "#B00000", "#FF3030", "#111111"], ["#FF0000", "#FFFFFF", "#0000FF", "#000000"]);
  assert.deepEqual(r.map, [0, 0, 0, 3]);
});

test("a colour nothing resembles is still mapped, and flagged", () => {
  // Green against CMYK: the nearest is cyan or yellow, neither of which is green.
  const r = matchToSpools(["#00A000"], CMYK);
  assert.equal(r.map.length, 1);
  assert.ok(r.distance[0] >= FAR_MATCH, `green → ΔE ${r.distance[0]}`);
  assert.deepEqual(r.far, [0]);
});

test("an exact spool is distance zero", () => {
  const r = matchToSpools(["#29ABE2"], CMYK);
  assert.equal(r.map[0], 0);
  assert.ok(r.distance[0] < 0.001);
});

test("ties go to the lower slot, so the result never flickers", () => {
  const r = matchToSpools(["#808080"], ["#808080", "#808080"]);
  assert.equal(r.map[0], 0);
});

test("no slots is not a crash: everything goes to slot 0 and is flagged", () => {
  const r = matchToSpools(["#FF0000", "#00FF00"], []);
  assert.deepEqual(r.map, [0, 0]);
  assert.deepEqual(r.far, [0, 1]);
});
