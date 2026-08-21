// "My filaments" inventory tests — hex normalization, perceptual colour distance, nearest-spool
// matching, and id allocation. Pure logic (no DOM/localStorage). Run: `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { normHex, colorDistance, nearestFilament, newId, assignFilaments } from "./my-filaments.ts";

test("normHex handles #, no-#, 3-digit, whitespace, junk", () => {
  assert.equal(normHex("#aabbcc"), "#AABBCC");
  assert.equal(normHex("aabbcc"), "#AABBCC");
  assert.equal(normHex("#abc"), "#AABBCC");
  assert.equal(normHex("  #FfEe00 "), "#FFEE00");
  assert.equal(normHex("nope"), "");
  assert.equal(normHex(""), "");
});

test("colorDistance: identical = 0; black↔white large; near < far", () => {
  assert.equal(colorDistance("#123456", "#123456"), 0);
  assert.ok(colorDistance("#000000", "#FFFFFF") > 90);
  assert.ok(colorDistance("#FF0000", "#FE0101") < colorDistance("#FF0000", "#00FF00"));
});

test("nearestFilament picks perceptually closest; null on empty inventory", () => {
  const inv = [
    { id: "f1", name: "Red", hex: "#FF0000" },
    { id: "f2", name: "Green", hex: "#00FF00" },
    { id: "f3", name: "Blue", hex: "#0000FF" },
  ];
  assert.equal(nearestFilament("#EE0505", inv)?.id, "f1");
  assert.equal(nearestFilament("#05EE05", inv)?.id, "f2");
  assert.equal(nearestFilament("#0A0AF0", inv)?.id, "f3");
  assert.equal(nearestFilament("#000000", []), null);
});

test("newId returns the lowest free id (reuses gaps)", () => {
  assert.equal(newId([]), "f1");
  assert.equal(newId([{ id: "f1", name: "", hex: "#000000" }]), "f2");
  assert.equal(newId([{ id: "f2", name: "", hex: "#000000" }]), "f1");
});

// ---------- assignFilaments ----------
const INV = [
  { id: "f1", name: "Red", hex: "#FF0000" },
  { id: "f2", name: "Green", hex: "#00FF00" },
  { id: "f3", name: "Blue", hex: "#0000FF" },
  { id: "f4", name: "White", hex: "#FFFFFF" },
];

test("assignFilaments: each spool is used at most once", () => {
  // Two heads want near-identical reds. Matching independently would hand BOTH the same spool —
  // impossible to load, and it collapses the Full Spectrum mixing basis.
  const out = assignFilaments(
    [{ index: 0, hex: "#FF0000" }, { index: 1, hex: "#FE0202" }],
    INV,
  );
  const used = out.map((a) => a.filament.id);
  assert.equal(new Set(used).size, used.length, "a spool was assigned twice");
  assert.equal(out.length, 2);
});

test("assignFilaments: the single best pair wins outright", () => {
  // f1 is an exact match for head 1, so it must go there — not to head 0 just because head 0 sorts first.
  const out = assignFilaments(
    [{ index: 0, hex: "#DD2222" }, { index: 1, hex: "#FF0000" }],
    INV,
  );
  const byIndex = Object.fromEntries(out.map((a) => [a.index, a.filament.id]));
  assert.equal(byIndex[1], "f1");
  assert.notEqual(byIndex[0], "f1");
});

test("assignFilaments: obvious colours land on the obvious spools", () => {
  const out = assignFilaments(
    [{ index: 0, hex: "#0A0AF0" }, { index: 1, hex: "#05EE05" }, { index: 2, hex: "#EE0505" }],
    INV,
  );
  const byIndex = Object.fromEntries(out.map((a) => [a.index, a.filament.id]));
  assert.deepEqual(byIndex, { 0: "f3", 1: "f2", 2: "f1" });
});

test("assignFilaments: fewer spools than heads → the remainder reuse, and are flagged", () => {
  const out = assignFilaments(
    [{ index: 0, hex: "#FF0000" }, { index: 1, hex: "#FE0101" }],
    [{ id: "f1", name: "Red", hex: "#FF0000" }],
  );
  assert.equal(out.length, 2);
  assert.equal(out.filter((a) => a.reused).length, 1, "the surplus head should be flagged as a reuse");
  assert.equal(out.filter((a) => !a.reused).length, 1);
});

test("assignFilaments: empty inputs are safe, and output is ordered by head index", () => {
  assert.deepEqual(assignFilaments([], INV), []);
  assert.deepEqual(assignFilaments([{ index: 0, hex: "#FFFFFF" }], []), []);
  const out = assignFilaments(
    [{ index: 3, hex: "#FFFFFF" }, { index: 0, hex: "#FF0000" }, { index: 2, hex: "#00FF00" }],
    INV,
  );
  assert.deepEqual(out.map((a) => a.index), [0, 2, 3]);
});
