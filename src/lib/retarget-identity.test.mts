// Same-family retarget: which printer the output names. Run: `npm test`.
//
// A retarget rewrote printer_model and invented printer_settings_id ("Creality K2 Plus", which no
// slicer has), and kept the SOURCE printer's start/end G-code, filament-change G-code, G-code flavour,
// excluded bed corner and inherits_group. Prusa → Prusa wrote one nozzle_diameter for a five-extruder
// MMU3 (2026-11-07 review, repro r1).
import { test } from "node:test";
import assert from "node:assert/strict";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { cleanThreeMF, type CleanTarget } from "./convert.ts";
import { MACHINES } from "./targets.ts";

const f3 = (e: Record<string, string>) =>
  new File([zipSync(Object.fromEntries(Object.entries(e).map(([k, v]) => [k, strToU8(v)])), { level: 0 }) as BlobPart], "t.3mf");
const MESH = `<vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles>`;
const model = (app: string) =>
  `<?xml version="1.0"?><model><metadata name="Application">${app}</metadata><resources><object id="1"><mesh>${MESH}</mesh></object></resources><build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 128 128 0"/></build></model>`;
async function entry(blob: Blob, name: string): Promise<string> {
  return strFromU8(unzipSync(new Uint8Array(await blob.arrayBuffer()))[name]);
}

// ---------- Prusa → Prusa ----------
const PRUSA_INI = "; printer_model = MK4ISMMU3\n; printer_settings_id = Original Prusa MK4 MMU3 0.4 nozzle\n; printer_variant = 0.4\n; nozzle_diameter = 0.4,0.4,0.4,0.4,0.4\n; extruder_colour = #FF0000;#00FF00;#0000FF;#FFFFFF;#000000\n; filament_colour = #FF0000;#00FF00;#0000FF;#FFFFFF;#000000\n; bed_shape = 0x0,250x0,250x210,0x210\n";

test("retarget Prusa → Prusa: nozzle_diameter keeps one value per extruder (MMU3 has five)", async () => {
  const r = await cleanThreeMF(f3({ "3D/3dmodel.model": model("PrusaSlicer-2.9.0"), "Metadata/Slic3r_PE.config": PRUSA_INI }), "prusa-mk4s-mmu3");
  const ini = await entry(r.blob, "Metadata/Slic3r_PE.config");
  assert.match(ini, /^; nozzle_diameter = 0\.4,0\.4,0\.4,0\.4,0\.4$/m);
});

test("retarget Prusa → Prusa: the project names the target's own preset and variant from targets.ts", async () => {
  const r = await cleanThreeMF(f3({ "3D/3dmodel.model": model("PrusaSlicer-2.9.0"), "Metadata/Slic3r_PE.config": PRUSA_INI }), "prusa-mk4s-mmu3");
  const ini = await entry(r.blob, "Metadata/Slic3r_PE.config");
  assert.match(ini, /^; printer_model = MK4SMMU3$/m);
  assert.match(ini, /^; printer_settings_id = Original Prusa MK4S MMU3 0\.4 nozzle$/m);
  assert.match(ini, /^; printer_variant = 0\.4$/m);
});

// ---------- Bambu → Orca / Bambu ----------
const X1C = {
  printer_settings_id: "Bambu Lab X1 Carbon 0.4 nozzle", printer_model: "Bambu Lab X1 Carbon", printer_variant: "0.4",
  printer_structure: "corexy", inherits_group: ["", "", "Bambu Lab X1 Carbon 0.4 nozzle"],
  different_settings_to_system: ["layer_height", "", "machine_start_gcode"],
  gcode_flavor: "marlin", machine_start_gcode: ";===== machine: X1 =====\nM620 M", machine_end_gcode: "M620 S255",
  change_filament_gcode: "M620 S[next_extruder]A", bed_exclude_area: ["0x0", "18x0", "18x28", "0x28"],
  machine_max_speed_x: ["500", "200"], retraction_length: ["0.8"], nozzle_diameter: ["0.4"],
  printable_area: ["0x0", "256x0", "256x256", "0x256"],
  filament_colour: ["#FF0000"], filament_type: ["PLA"], filament_start_gcode: ["; filament start"], layer_height: "0.16",
};
const bambuFile = () =>
  f3({ "3D/3dmodel.model": model("BambuStudio-02.01"), "Metadata/project_settings.config": JSON.stringify(X1C) });
const MACHINE_KEYS = ["gcode_flavor", "machine_start_gcode", "machine_end_gcode", "change_filament_gcode", "bed_exclude_area", "machine_max_speed_x", "retraction_length", "printer_structure"];

for (const [target, preset, model_] of [
  ["creality-k2", "Creality K2 Plus 0.4 nozzle", "Creality K2 Plus"],
  ["bambu-a1", "Bambu Lab A1 0.4 nozzle", "Bambu Lab A1"],
] as const) {
  test(`retarget Bambu X1C → ${target}: names the real system preset and carries none of the X1C's printer`, async () => {
    const o = JSON.parse(await entry((await cleanThreeMF(bambuFile(), target)).blob, "Metadata/project_settings.config"));
    assert.equal(o.printer_settings_id, preset);
    assert.equal(o.printer_model, model_);
    assert.equal(o.printer_variant, "0.4");
    for (const k of MACHINE_KEYS) assert.ok(!(k in o), `${k} is the X1C's and must not reach a ${model_}`);
    assert.deepEqual(o.inherits_group, ["", "", ""], "the printer entry names no X1C parent");
    assert.deepEqual(o.different_settings_to_system, ["layer_height", "", ""], "X1C printer edits are not the target's");
    // The creator's process and filament settings stay.
    assert.equal(o.layer_height, "0.16");
    assert.deepEqual(o.filament_start_gcode, ["; filament start"]);
    assert.deepEqual(o.nozzle_diameter, ["0.4"]);
  });
}

test("retarget: a target with no known preset name gets no printer_settings_id rather than an invented one", async () => {
  const id = "test-orca-unknown";
  MACHINES[id] = { ...MACHINES["creality-k2"], id, name: "Some Orca Printer", printerModel: "Some Orca Printer", printerSettingsId: undefined, printerVariant: undefined };
  try {
    const o = JSON.parse(await entry((await cleanThreeMF(bambuFile(), id as CleanTarget)).blob, "Metadata/project_settings.config"));
    assert.ok(!("printer_settings_id" in o), `invented ${o.printer_settings_id}`);
    assert.ok(!("printer_variant" in o));
    assert.equal(o.printer_model, "Some Orca Printer");
    assert.ok(!("machine_start_gcode" in o));
  } finally {
    delete MACHINES[id];
  }
});
