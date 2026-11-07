// The extension's "Check fit" line: which one of /convert's own answers is shown, for which printer.
// Run: `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { zipSync, strToU8 } from "fflate";
import { IntlMessageFormat } from "intl-messageformat";
import { checkFit, colourCount, fitLine, fitTone, parseFitLine, FIT_LINE_KEYS, type FitLineInput } from "./fit-check.ts";
import { MACHINES, U1 } from "./targets.ts";

const PAL = ["#000000", "#FFFFFF", "#FF0000", "#00FF00", "#0000FF", "#FFFF00", "#FF00FF", "#00FFFF"];

/** A box part `size` mm, painted with `states` (one per face). */
function part(size: [number, number, number], states: number[] = [0], at: [number, number, number] = [0, 0, 0]) {
  const [sx, sy, sz] = size;
  const [ox, oy, oz] = at;
  // Two triangles spanning the box's corners: enough for a bounding box.
  const positions = Float32Array.from([ox, oy, oz, ox + sx, oy, oz, ox, oy + sy, oz, ox + sx, oy + sy, oz, ox, oy, oz + sz, ox + sx, oy + sy, oz + sz]);
  return { name: "p", objectId: 1, positions, faceState: Uint8Array.from(states), triangleCount: 2 };
}

function mesh(parts: ReturnType<typeof part>[], plates: number[][] = [], baseState = 1) {
  const states = new Set<number>();
  parts.forEach((p) => p.faceState.forEach((s) => s && states.add(s)));
  return {
    positions: Float32Array.from(parts.flatMap((p) => Array.from(p.positions))),
    parts,
    plates: plates.map((partIndices) => ({ name: "", partIndices })),
    palette: PAL,
    baseState,
    statesPresent: [...states].sort((a, b) => a - b),
    skipped: false,
  };
}

const analysis = (colours: number, extra: Partial<FitLineInput["analysis"]> = {}): FitLineInput["analysis"] => ({
  colors: PAL.slice(0, colours),
  painted: false,
  encoding: colours > 4 ? "object" : "simple",
  fullSpectrumFile: false,
  ...extra,
});

const u1 = (a: FitLineInput["analysis"], m: FitLineInput["mesh"]) => fitLine({ analysis: a, mesh: m, machine: U1, isU1: true, printer: "U1" });

test("a model whose colours and parts fit says so, with its colour count", () => {
  const line = u1(analysis(4), mesh([part([100, 100, 50])]));
  assert.deepEqual(line, { key: "fitOk", params: { count: 4, printer: "U1" } });
});

test("a part larger than the bed outranks everything about colour", () => {
  assert.equal(u1(analysis(2), mesh([part([300, 100, 50])])).key, "fitTooBig");
  // Every part fits; their arrangement on the one plate does not.
  assert.equal(u1(analysis(2), mesh([part([200, 100, 50]), part([200, 100, 50], [0], [220, 0, 0])])).key, "fitLayout");
});

test("a rectangular bed is checked against its shorter side", () => {
  const mk4 = Object.values(MACHINES).find((m) => m.bed.x !== m.bed.y)!;
  const short = Math.min(mk4.bed.x, mk4.bed.y);
  const line = fitLine({ analysis: analysis(1), mesh: mesh([part([short + 20, 50, 50])]), machine: mk4, isU1: false, printer: "x" });
  assert.equal(line.key, "fitTooBig");
});

test("more painted colours than slots: Full Spectrum on the U1, merged on a printer without mixing", () => {
  const painted = analysis(6, { painted: true, encoding: "painted" });
  const m = mesh([part([50, 50, 50], [1, 2, 3, 4, 5, 6])]);
  assert.deepEqual(u1(painted, m), { key: "fitFullSpectrum", params: { count: 6, printer: "U1" } });
  const x1 = MACHINES["bambu-x1c"] ?? Object.values(MACHINES).find((mm) => mm.id !== "u1" && !mm.supportsMixedFilament && mm.toolheads === 4)!;
  assert.equal(x1.supportsMixedFilament ?? false, false);
  const line = fitLine({ analysis: painted, mesh: m, machine: x1, isU1: false, printer: "X1" });
  assert.deepEqual(line, { key: "fitMerge", params: { count: 6, printer: "X1", heads: 4 } });
});

test("a painted file counts the colours its mesh uses, not its padded filament list", () => {
  const a = analysis(8, { painted: true, encoding: "painted" });
  const m = mesh([part([50, 50, 50], [0, 2, 3])]); // base (1) + 2 + 3
  assert.equal(colourCount(a, m), 3);
  assert.equal(u1(a, m).key, "fitOk");
});

test("few colours per plate, many overall: split per plate (U1 only, as on /convert)", () => {
  const m = mesh(
    [part([50, 50, 50], [1]), part([50, 50, 50], [2]), part([50, 50, 50], [3, 4, 5]), part([50, 50, 50], [6])],
    [[0], [1], [2], [3]],
  );
  const a = analysis(6, { painted: true, encoding: "painted" });
  assert.deepEqual(u1(a, m), { key: "fitSplit", params: { count: 6, plates: 4 } });
  const other = Object.values(MACHINES).find((mm) => mm.id !== "u1" && mm.toolheads === 4)!;
  assert.notEqual(fitLine({ analysis: a, mesh: m, machine: other, isU1: false, printer: "o" }).key, "fitSplit");
});

test("by-layer colours over the slots keep every colour with spool swaps on the U1", () => {
  assert.equal(u1(analysis(5, { encoding: "by-layer" }), mesh([part([50, 50, 50])])).key, "fitSwaps");
  assert.equal(u1(analysis(5, { encoding: "object" }), mesh([part([50, 50, 50])])).key, "fitMerge");
});

test("no preview mesh: the bed goes unchecked and the line says only the slots fit", () => {
  assert.equal(u1(analysis(3), null).key, "fitOkSlotsOnly");
  assert.equal(u1(analysis(3), { ...mesh([part([900, 900, 900])]), skipped: true, positions: new Float32Array(0) }).key, "fitOkSlotsOnly");
});

test("generic target: colours only", () => {
  assert.deepEqual(fitLine({ analysis: analysis(5), mesh: null, machine: undefined, isU1: false, printer: "generic" }), {
    key: "fitGeneric",
    params: { count: 5 },
  });
});

test("checkFit reads a real file end to end", async () => {
  const file = new File([readFileSync("sample.3mf")], "sample.3mf");
  const line = await checkFit(file, { machine: U1, isU1: true, printer: "U1" });
  assert.ok(line);
  assert.equal(line.key, "fitOk");
});

test("checkFit answers null for something that is not a 3MF", async () => {
  const junk = zipSync({ "readme.txt": strToU8("hello") });
  assert.equal(await checkFit(new File([junk], "x.3mf"), { machine: U1, isU1: true, printer: "U1" }), null);
});

test("a line from a message is shown only when its key is known and its params are plain values", () => {
  assert.deepEqual(parseFitLine({ key: "fitOk", params: { count: 3, printer: "U1", extra: "x" } }), {
    key: "fitOk",
    params: { count: 3, printer: "U1" },
  });
  assert.equal(parseFitLine({ key: "toastDone", params: {} }), null);
  assert.equal(parseFitLine(null), null);
  assert.equal(parseFitLine("fitOk"), null);
  assert.deepEqual(parseFitLine({ key: "fitSplit", params: { count: { toString: () => "<b>" }, plates: NaN } })?.params, {});
});

test("the tone: the bed is the one hard no; merged or unchecked is a caution", () => {
  assert.equal(fitTone("fitTooBig"), "no");
  assert.equal(fitTone("fitMerge"), "caution");
  assert.equal(fitTone("fitOk"), "ok");
  assert.equal(fitTone("fitSplit"), "ok");
});

test("every line key has a translation that formats with the params it is given, in every locale", () => {
  const KEYS = FIT_LINE_KEYS;
  const values = { count: 6, printer: "U1", plates: 3, heads: 4 };
  for (const l of ["en", "ar", "de", "es", "fr", "ja", "zh"]) {
    const ext = JSON.parse(readFileSync(`messages/${l}.json`, "utf8")).ext as Record<string, string>;
    for (const k of [...KEYS, "fitCheck", "fitChecking", "fitFailed", "fitOpen", "fitTitle"]) {
      assert.ok(ext[k], `${l}: ext.${k} missing`);
      const out = String(new IntlMessageFormat(ext[k], l).format(values));
      assert.ok(out && !/[{}]/.test(out), `${l} ext.${k}: ${out}`);
      // One line: the verdict sits under a button on somebody else's page. (The tooltip may run long.)
      if (k !== "fitTitle") assert.ok(!out.includes("\n") && out.length <= 90, `${l} ext.${k} is not one short line: ${out}`);
    }
  }
});
