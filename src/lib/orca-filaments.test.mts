import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Validates the baked /orca-filaments dataset (produced by scripts/build-orca-filaments.mjs).
// This is the contract the web UI + the browser installer consume, so it must always hold:
// every profile is self-contained, Snapmaker-U1-targeted, and installs verbatim as a user preset.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIR = path.join(ROOT, "public", "orca-filaments");

type ManifestEntry = {
  id: string; name: string; vendor: string; type: string;
  nozzleTemp: number | null; bedTemp: number | null; file: string;
};
type Manifest = { machine: string; vendors: string[]; types: string[]; profiles: ManifestEntry[] };

import { filamentPresetId } from "./convert.ts";

const manifest: Manifest = JSON.parse(fs.readFileSync(path.join(DIR, "manifest.json"), "utf8"));

test("manifest has the expected shape and a substantial library", () => {
  assert.match(manifest.machine, /Snapmaker U1/);
  assert.ok(Array.isArray(manifest.vendors) && manifest.vendors.length > 20, "many vendors");
  assert.ok(Array.isArray(manifest.types) && manifest.types.length > 5, "several material types");
  assert.ok(manifest.profiles.length > 500, `expected a large library, got ${manifest.profiles.length}`);
});

test("every manifest entry is well-formed and its faceting is consistent", () => {
  const vendors = new Set(manifest.vendors);
  const types = new Set(manifest.types);
  const ids = new Set<string>();
  for (const p of manifest.profiles) {
    assert.ok(p.id && p.name && p.vendor && p.type && p.file, `complete entry: ${JSON.stringify(p)}`);
    assert.ok(!ids.has(p.id), `unique id: ${p.id}`);
    ids.add(p.id);
    assert.ok(vendors.has(p.vendor), `vendor "${p.vendor}" is in the facet list`);
    assert.ok(types.has(p.type), `type "${p.type}" is in the facet list`);
    assert.equal(p.file, `profiles/${p.id}.json`, "file path matches id");
    // The UI declares nozzleTemp/bedTemp as non-null numbers — never emit null.
    assert.equal(typeof p.nozzleTemp, "number", `nozzleTemp is a number for ${p.id}`);
    assert.equal(typeof p.bedTemp, "number", `bedTemp is a number for ${p.id}`);
  }
});

test("every profile file is self-contained, U1-targeted, and install-ready", () => {
  for (const p of manifest.profiles) {
    const abs = path.join(DIR, p.file);
    assert.ok(fs.existsSync(abs), `file exists: ${p.file}`);
    const preset = JSON.parse(fs.readFileSync(abs, "utf8"));

    assert.equal(preset.type, "filament", `${p.id}: type=filament`);
    assert.equal(preset.from, "User", `${p.id}: from=User (lands as an editable user preset)`);
    assert.equal("inherits" in preset, false, `${p.id}: inherits chain is flattened away`);
    // Not restricted to a specific printer — empty string is fine (that's what Orca's own presets carry),
    // a non-empty condition is not.
    assert.ok(!preset.compatible_printers_condition, `${p.id}: no restrictive printer condition`);
    // Snapmaker Orca silently DROPS a preset with no `version`, so it never appears in the dropdown —
    // guard against regenerating a catalog without one (the bug this whole feature hit).
    assert.ok(preset.version, `${p.id}: carries a version (else Snapmaker Orca won't load it)`);
    assert.ok(preset.name, `${p.id}: has a name`);
    assert.ok(preset.filament_type, `${p.id}: keeps its real filament_type`);

    assert.ok(Array.isArray(preset.compatible_printers), `${p.id}: compatible_printers is a list`);
    assert.ok(
      preset.compatible_printers.some((n: string) => /^Snapmaker U1/.test(n)),
      `${p.id}: compatible with a Snapmaker U1 machine`,
    );
    assert.ok(Array.isArray(preset.nozzle_temperature) && preset.nozzle_temperature.length > 0,
      `${p.id}: has a nozzle temperature`);

    // Regression guard: keys from a newer upstream OrcaSlicer that Snapmaker Orca's fork doesn't
    // understand must be stripped (they cause "unknown option" noise on load and are useless on a U1).
    for (const k of Object.keys(preset)) {
      assert.ok(!/^filament_tower_/.test(k), `${p.id}: foreign key ${k} was not stripped`);
      assert.ok(!/^epoxy_resin_plate_temp/.test(k), `${p.id}: foreign key ${k} was not stripped`);
      assert.ok(!/_(BRASS|HS)$/.test(k), `${p.id}: foreign nozzle-material key ${k} was not stripped`);
    }
  }
});

// The converter's Snapmaker-brand filament mode names presets like "Snapmaker PETG". That list is
// hardcoded in convert.ts because the converter runs offline in the browser and the extension — this
// test is what stops it drifting from the catalogue it claims to describe. A material that Snapmaker
// starts (or stops) shipping shows up here as a failure rather than as a preset Orca can't resolve.
test("the converter's Snapmaker filament brand list matches the real U1 catalogue", () => {
  const named = new Set(manifest.profiles.map((p) => p.name));

  // Every type we claim a Snapmaker preset for must actually have one.
  for (const t of ["PLA", "PETG", "ABS", "ASA", "PET", "PVA", "TPU"]) {
    assert.equal(filamentPresetId(t, "snapmaker"), `Snapmaker ${t}`, `${t}: claimed as Snapmaker-branded`);
    assert.ok(named.has(`Snapmaker ${t}`), `Snapmaker ${t} exists in the U1 filament catalogue`);
  }

  // And every type we DON'T claim must genuinely lack one, or we are sending users to Generic when a
  // real vendor preset exists. PA is the interesting case: the catalogue has "Snapmaker PA-CF" only.
  for (const t of manifest.types) {
    if (filamentPresetId(t, "snapmaker").startsWith("Snapmaker ")) continue;
    assert.ok(!named.has(`Snapmaker ${t}`), `Snapmaker ${t} exists but the converter falls back to Generic`);
    assert.equal(filamentPresetId(t, "snapmaker"), `Generic ${t}`, `${t}: falls back to a Generic preset`);
  }
  assert.equal(filamentPresetId("PA", "snapmaker"), "Generic PA", "PA-CF is not PA");
});
