// Keep-all-colours from a compact config. Run: `npm test`.
//
// Keep all colours writes every source filament, so a 6-filament file needs 6 entries in every
// per-filament array. Only arrays the SOURCE carried at full length were reindexed; everything a
// compact Bambu config leaves out stayed at the U1 reference's 4, so 95 per-filament arrays came out
// 4 long beside a 6-long filament_colour (2026-11-07 review, repro r5).
import { test } from "node:test";
import assert from "node:assert/strict";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { cleanThreeMF } from "./convert.ts";
import { U1 } from "./targets.ts";
import { U1_FILAMENT_PRESETS } from "./u1-filament-presets.ts";

const MESH = `<vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2" paint_color="4"/></triangles>`;
const MODEL = `<?xml version="1.0"?><model><metadata name="Application">BambuStudio-02.01</metadata><resources><object id="1"><mesh>${MESH}</mesh></object></resources><build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 128 128 0"/></build></model>`;
const COLS = ["#FF0000", "#00FF00", "#0000FF", "#FFFFFF", "#000000", "#FF8800"];

async function keepAll(cfg: Record<string, unknown>): Promise<Record<string, unknown>> {
  const z = zipSync({ "3D/3dmodel.model": strToU8(MODEL), "Metadata/project_settings.config": strToU8(JSON.stringify(cfg)) }, { level: 0 });
  const r = await cleanThreeMF(new File([z as BlobPart], "t.3mf"), "u1", { keepAllColours: true });
  return JSON.parse(strFromU8(unzipSync(new Uint8Array(await r.blob.arrayBuffer()))["Metadata/project_settings.config"]));
}
// The compact shape Bambu Studio saves: no filament_type, no temperatures, only the preset names.
const compact = (ids = COLS.map(() => "Bambu PLA Basic @BBL A1"), extra: Record<string, unknown> = {}) =>
  ({ printer_settings_id: "Bambu Lab A1 0.4 nozzle", filament_colour: COLS, filament_settings_id: ids, ...extra });

// One entry per head, not per filament: these stay 4 on the U1 whatever the filament count.
const PER_EXTRUDER = /^(nozzle_(?!temperature)|extruder_|machine_|printer_|printable_|bed_|retract|retraction_|deretraction_|z_hop|wipe$|wipe_distance$|travel_slope$|long_retractions_when_cut$|min_layer_height$|max_layer_height$)/;

test("keep all colours: every per-filament array has one entry per filament, from a compact config", async () => {
  const o = await keepAll(compact());
  const ref = U1.profile as Record<string, unknown>;
  const short = Object.keys(o).filter((k) => Array.isArray(ref[k]) && (ref[k] as unknown[]).length === 4 && !PER_EXTRUDER.test(k) && (o[k] as unknown[]).length !== 6);
  assert.deepEqual(short, [], `per-filament arrays not padded to 6: ${short.join(" ")}`);
  for (const k of ["nozzle_temperature", "hot_plate_temp", "fan_max_speed", "filament_density", "filament_max_volumetric_speed", "default_filament_colour"]) {
    assert.equal((o[k] as unknown[]).length, 6, k);
  }
});

test("keep all colours: per-extruder arrays stay one per head", async () => {
  const o = await keepAll(compact());
  for (const k of ["retraction_length", "z_hop", "nozzle_diameter", "extruder_colour"]) {
    if (k in o) assert.equal((o[k] as unknown[]).length, 4, k);
  }
});

test("keep all colours: the padded slots take their own material's preset, not the reference's ABS", async () => {
  const ids = [...COLS.slice(0, 5).map(() => "Bambu PLA Basic @BBL A1"), "Bambu PETG HF @BBL A1"];
  const o = await keepAll(compact(ids));
  const temp = o.nozzle_temperature as string[];
  const pla = U1_FILAMENT_PRESETS.PLA.nozzle_temperature, petg = U1_FILAMENT_PRESETS.PETG.nozzle_temperature;
  assert.deepEqual(temp, [pla, pla, pla, pla, pla, petg]);
  assert.equal((o.filament_type as string[])[5], "PETG");
});

test("keep all colours: a source array shorter than the filament list keeps its values and fills the rest by material", async () => {
  const ids = [...COLS.slice(0, 4).map(() => "Bambu PLA Basic @BBL A1"), "Bambu PETG HF @BBL A1", "Bambu PETG HF @BBL A1"];
  const o = await keepAll(compact(ids, { nozzle_temperature: ["205", "206", "207", "208"] }));
  const petg = U1_FILAMENT_PRESETS.PETG.nozzle_temperature;
  assert.deepEqual(o.nozzle_temperature, ["205", "206", "207", "208", petg, petg]);
});

test("keep all colours: a full-length source array is still carried as written", async () => {
  const o = await keepAll(compact(undefined, { nozzle_temperature: COLS.map((_, i) => String(200 + i)) }));
  assert.deepEqual(o.nozzle_temperature, ["200", "201", "202", "203", "204", "205"]);
});
