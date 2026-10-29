// The extension's printer choice (extension/src/settings.ts). Lives here because `npm test` runs
// src/lib/*.test.mts; the module it tests is the extension's, and only its pure helpers are covered —
// storage is a thin try/catch around `storage.local`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitize, DEFAULTS, TARGETS, quickOpts, shortName, suffixOf, isOurOutput, alreadyFor, machineOf } from "../../extension/src/settings.ts";
import { MACHINES, RETARGET_MACHINES } from "./targets.ts";

test("a stored record the code no longer understands falls back field by field", () => {
  assert.deepEqual(sanitize(undefined), DEFAULTS);
  assert.deepEqual(sanitize({ target: "removed-printer", nozzle: 0.5, autoConvert: "yes", keepOriginal: 1 }), DEFAULTS);
  assert.deepEqual(sanitize({ target: "bambu-x1c", nozzle: 0.6, autoConvert: false, keepOriginal: true }), {
    target: "bambu-x1c", nozzle: 0.6, autoConvert: false, keepOriginal: true,
  });
});

test("the picker offers every registry printer, the U1 first and generic last", () => {
  assert.equal(TARGETS[0].id, "u1");
  assert.equal(TARGETS.at(-1)?.id, "generic");
  for (const m of RETARGET_MACHINES) assert.ok(TARGETS.some((t) => t.id === m.id), m.id);
});

test("one-click options: U1 keeps settings and colours; other printers take the engine defaults", () => {
  assert.deepEqual(quickOpts(DEFAULTS), { mode: "preserve", fullSpectrum: true });
  const u06 = quickOpts({ ...DEFAULTS, nozzle: 0.6 });
  assert.equal(u06.machine?.nozzle, 0.6);
  assert.deepEqual(quickOpts({ ...DEFAULTS, target: "prusa-mk4s-mmu3" }), {});
  assert.equal(machineOf({ ...DEFAULTS, target: "generic" }), undefined);
});

test("names and suffixes match what bedready.io/convert writes", () => {
  assert.equal(shortName(DEFAULTS), "U1");
  assert.equal(shortName({ ...DEFAULTS, target: "bambu-x1c" }), "X1 Carbon");
  assert.equal(suffixOf("u1"), ".u1.3mf");
  assert.equal(suffixOf("generic"), ".generic.3mf");
  assert.equal(suffixOf("bambu-a1"), ".bambu-a1.3mf");
});

test("the interceptor never re-converts its own output, for any target", () => {
  for (const t of TARGETS) assert.ok(isOurOutput(`Benchy${suffixOf(t.id)}`), t.id);
  assert.ok(isOurOutput("BENCHY.U1.3MF"));
  assert.ok(!isOurOutput("Benchy.3mf"));
});

test("already set up for the target: U1 by flag and nozzle, others by printer name", () => {
  assert.ok(alreadyFor(DEFAULTS, { isU1: true, printer: "Snapmaker U1 (0.4 nozzle)" }));
  // a 0.4 U1 file still needs converting for a 0.6 U1
  assert.ok(!alreadyFor({ ...DEFAULTS, nozzle: 0.6 }, { isU1: true, printer: "Snapmaker U1 (0.4 nozzle)" }));
  assert.ok(!alreadyFor(DEFAULTS, { isU1: false, printer: "Bambu Lab X1 Carbon 0.4 nozzle" }));
  // a bare "Snapmaker U1" (no nozzle named) is taken as 0.4: skipped for 0.4 owners only
  assert.ok(alreadyFor(DEFAULTS, { isU1: true, printer: "Snapmaker U1" }));
  assert.ok(!alreadyFor({ ...DEFAULTS, nozzle: 0.6 }, { isU1: true, printer: "Snapmaker U1" }));
  const x1 = { ...DEFAULTS, target: "bambu-x1c" as const };
  assert.ok(alreadyFor(x1, { isU1: false, printer: `${MACHINES["bambu-x1c"].name} 0.4 nozzle` }));
  assert.ok(!alreadyFor(x1, { isU1: false, printer: "Bambu Lab P1S 0.4 nozzle" }));
  assert.ok(!alreadyFor({ ...DEFAULTS, target: "generic" }, { isU1: false, printer: "anything" }));
});
