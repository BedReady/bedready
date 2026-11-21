// The extension's printer choice (extension/src/settings.ts). Lives here because `npm test` runs
// src/lib/*.test.mts; the module it tests is the extension's, and only its pure helpers are covered —
// storage is a thin try/catch around `storage.local`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitize, DEFAULTS, TARGETS, quickOpts, shortName, suffixOf, isOurOutput, isFreshDownload, FRESH_DOWNLOAD_MS, filenameFromDisposition, looksMachineNamed, alreadyFor, machineOf } from "../../extension/src/settings.ts";
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

test("downloads Chrome restores from history at startup are not converted again", () => {
  const now = Date.parse("2026-11-20T10:00:00Z");
  const at = (msAgo: number) => new Date(now - msAgo).toISOString();
  // A click: in progress, just started.
  assert.equal(isFreshDownload({ state: "in_progress", startTime: at(500) }, "ext", now), true);
  // History replayed at startup: finished or interrupted, started long ago.
  assert.equal(isFreshDownload({ state: "complete", startTime: at(3_600_000) }, "ext", now), false);
  assert.equal(isFreshDownload({ state: "interrupted", startTime: at(3_600_000) }, "ext", now), false);
  // An interrupted download Chrome resumes on startup is in progress again, but old.
  assert.equal(isFreshDownload({ state: "in_progress", startTime: at(FRESH_DOWNLOAD_MS + 1) }, "ext", now), false);
  // Our own converted file.
  assert.equal(isFreshDownload({ state: "in_progress", startTime: at(10), byExtensionId: "ext" }, "ext", now), false);
  // Missing fields (Firefox may omit some): do not block a real click.
  assert.equal(isFreshDownload({}, undefined, now), true);
});

test("a de-duplicated save of our own output is still recognised as ours", () => {
  assert.equal(isOurOutput("benchy.u1 (1).3mf"), true);
  assert.equal(isOurOutput("benchy.u1 (12).3mf"), true);
  assert.equal(isOurOutput("benchy (1).3mf"), false);
});

test("a CDN object key is not a name worth keeping", () => {
  assert.equal(looksMachineNamed("3b9f0c1d2e4a5b6c7d8e9f00112233.3mf"), true);
  assert.equal(looksMachineNamed("0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0.3mf"), true);
  assert.equal(looksMachineNamed("aZ3kQ9pLm2Xv8Rt5Yw1Nb7Hc.3mf"), true);
  assert.equal(looksMachineNamed("Benchy.3mf"), false);
  assert.equal(looksMachineNamed("Articulated_Dragon_v2_4colors.3mf"), false);
  assert.equal(looksMachineNamed("model.3mf"), false);
});

test("the server's file name is read from Content-Disposition, safely", () => {
  assert.equal(filenameFromDisposition('attachment; filename="Benchy.3mf"'), "Benchy.3mf");
  assert.equal(filenameFromDisposition("attachment; filename=Benchy.3mf"), "Benchy.3mf");
  assert.equal(filenameFromDisposition("attachment; filename=\"x.3mf\"; filename*=UTF-8''%E9%BE%99.3mf"), "龙.3mf");
  assert.equal(filenameFromDisposition('attachment; filename="../../etc/Benchy.3mf"'), "Benchy.3mf");
  assert.equal(filenameFromDisposition('attachment; filename="a:b.3mf"'), "a_b.3mf");
  assert.equal(filenameFromDisposition('attachment; filename="evil.exe"'), null);
  assert.equal(filenameFromDisposition('attachment; filename=".3mf"'), null);
  assert.equal(filenameFromDisposition(null), null);
});
