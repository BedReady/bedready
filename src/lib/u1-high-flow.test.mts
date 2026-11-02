import { test } from "node:test";
import assert from "node:assert/strict";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { cleanThreeMF, collapseFlowVariants } from "./convert.ts";
import { applyHighFlow, highFlowPresetFor, U1_HIGH_FLOW_FILAMENTS } from "./u1-high-flow.ts";
import { u1NozzleVariant } from "./targets.ts";

const MESH = `<vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles>`;
const MODEL = `<?xml version="1.0"?><model><resources><object id="1"><mesh>${MESH}</mesh></object></resources><build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 128 128 0"/></build></model>`;
function file(cfg: Record<string, unknown>): File {
  const z = zipSync({ "Metadata/project_settings.config": strToU8(JSON.stringify(cfg)), "3D/3dmodel.model": strToU8(MODEL) });
  return new File([z as BlobPart], "t.3mf");
}
async function cfgOf(blob: Blob): Promise<Record<string, unknown>> {
  return JSON.parse(strFromU8(unzipSync(new Uint8Array(await blob.arrayBuffer()))["Metadata/project_settings.config"]));
}
const SRC = {
  printer_settings_id: "Bambu Lab P1S 0.4 nozzle",
  printable_area: ["0x0", "256x0", "256x256", "0x256"],
  filament_colour: ["#000000", "#FFFFFF", "#FF0000", "#00FF00"],
  filament_type: ["PLA", "PETG", "TPU", "PLA"],
  filament_settings_id: ["Bambu PLA Basic @BBL P1S", "Generic PETG", "Generic TPU", "Snapmaker PLA Matte @U1"],
};

test("high flow: each slot with a Snapmaker HF preset gets standard + high_flow entries; TPU stays standard", async () => {
  const r = await cleanThreeMF(file(SRC), "u1", { mode: "preserve", highFlow: true });
  const c = await cfgOf(r.blob);
  assert.deepEqual(c.filament_settings_id, ["Snapmaker PLA SnapSpeed @U1", "Snapmaker PETG HF", "Generic TPU", "Snapmaker PLA Matte @U1"]);
  assert.deepEqual(c.filament_flow_step_size, ["2", "2", "1", "2"]);
  assert.deepEqual(c.filament_volume_type, ["high_flow", "high_flow", "standard", "high_flow"]);
  assert.deepEqual(c.nozzle_volume_type, ["high_flow", "high_flow", "standard", "high_flow"]);
  const mvs = c.filament_max_volumetric_speed as string[];
  assert.equal(mvs.length, 7);
  assert.equal(mvs[1], "40"); // SnapSpeed's high-flow entry, from Snapmaker's preset
  assert.equal(mvs[6], "40"); // PLA Matte's
  assert.deepEqual(c.process_flow_support, ["standard", "high_flow"]);
  assert.equal((c.outer_wall_speed as string[])[1], "500");
  assert.equal((c.sparse_infill_speed as string[])[1], "600");
  assert.deepEqual(r.diff?.highFlow?.map((s) => s.preset), ["Snapmaker PLA SnapSpeed @U1", "Snapmaker PETG HF", null, "Snapmaker PLA Matte @U1"]);
});

test("high flow: the standard entries are exactly what the file had without it, and collapse back", async () => {
  for (const mode of ["stamp", "preserve"] as const) {
    const plain = await cfgOf((await cleanThreeMF(file(SRC), "u1", { mode })).blob);
    const hf = await cfgOf((await cleanThreeMF(file(SRC), "u1", { mode, highFlow: true })).blob);
    const back = collapseFlowVariants(structuredClone(hf));
    for (const k of ["nozzle_temperature", "filament_max_volumetric_speed", "pressure_advance", "filament_flow_ratio"])
      assert.deepEqual(back[k], plain[k], `${mode} ${k}`);
    assert.equal(String(at0(back.outer_wall_speed)), String(at0(plain.outer_wall_speed)), mode);
  }
});
const at0 = (v: unknown) => (Array.isArray(v) ? v[0] : v);

test("high flow: ignored off the 0.4 nozzle and when no slot has a preset", async () => {
  const c = await cfgOf((await cleanThreeMF(file(SRC), "u1", { mode: "stamp", highFlow: true, machine: u1NozzleVariant(0.6) })).blob);
  assert.equal(c.filament_flow_step_size, undefined);
  const o: Record<string, unknown> = { filament_settings_id: ["Generic TPU"], filament_type: ["TPU"], nozzle_temperature: ["230"] };
  assert.deepEqual(applyHighFlow(o), [{ slot: 0, preset: null }]);
  assert.deepEqual(o.nozzle_temperature, ["230"]);
});

test("high flow: no fibre-filled preset is offered (the hot end guide says they clog it)", () => {
  assert.ok(Object.keys(U1_HIGH_FLOW_FILAMENTS).every((n) => !/-(CF|GF)\b/.test(n)));
  assert.equal(highFlowPresetFor("Generic PLA-CF", "PLA-CF"), null);
  assert.equal(highFlowPresetFor("Generic PLA", "pla"), "Snapmaker PLA SnapSpeed @U1");
});
