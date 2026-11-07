// Bambu/Orca → PrusaSlicer project: modifiers, negative parts, blockers/enforcers, and what cannot be
// carried over. Run: `npm test`.
//
// The project dropped Metadata/*.config, and with it model_settings.config's part kinds. PrusaSlicer
// 2.9 turns each component of a foreign 3MF into its own object, so a hole cutter (negative_part)
// arrived as a solid, painted object, and per-height colour changes vanished without a word
// (2026-11-07 review, repro r6). Format checked against PrusaSlicer's Format/3mf.cpp (version_2.9.2):
// one mesh object per multi-part object, its volumes as triangle ranges in Slic3r_PE_model.config.
import { test } from "node:test";
import assert from "node:assert/strict";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { cleanThreeMF } from "./convert.ts";
import { toPrusaProject } from "./prusa-project.ts";
import { MACHINES } from "./targets.ts";

const INDX4 = MACHINES["prusa-core-one-indx-4t"];
const PRUSA_MODEL_CONFIG = "Metadata/Slic3r_PE_model.config"; // PrusaSlicer's MODEL_CONFIG_FILE
const TET = (dx = 0) =>
  `<mesh><vertices><vertex x="${dx}" y="0" z="0"/><vertex x="${10 + dx}" y="0" z="0"/><vertex x="${dx}" y="10" z="0"/><vertex x="${dx}" y="0" z="10"/></vertices><triangles><triangle v1="0" v2="2" v3="1" paint_color="8"/><triangle v1="0" v2="1" v3="3"/><triangle v1="0" v2="3" v3="2"/><triangle v1="1" v2="2" v3="3"/></triangles></mesh>`;

type Part = { id: number; subtype: string; name: string; extra?: string; transform?: string };
function source(parts: Part[], extra: Record<string, string> = {}): Record<string, Uint8Array> {
  const comps = parts.map((p) => `<component p:path="/3D/Objects/object_1.model" objectid="${p.id}" transform="${p.transform ?? "1 0 0 0 1 0 0 0 1 0 0 0"}"/>`).join("");
  const root = `<?xml version="1.0"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p"><metadata name="Application">BambuStudio-02.01</metadata><resources><object id="1" type="model"><components>${comps}</components></object></resources><build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 128 128 0"/></build></model>`;
  const obj = `<?xml version="1.0"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>${parts.map((p) => `<object id="${p.id}" type="model">${TET()}</object>`).join("")}</resources><build/></model>`;
  const ms = `<?xml version="1.0"?><config><object id="1"><metadata key="name" value="Box"/><metadata key="extruder" value="1"/>${parts.map((p) => `<part id="${p.id}" subtype="${p.subtype}"><metadata key="name" value="${p.name}"/>${p.extra ?? ""}</part>`).join("")}</object></config>`;
  const proj = JSON.stringify({ printer_settings_id: "Bambu Lab X1 Carbon 0.4 nozzle", printable_area: ["0x0", "256x0", "256x256", "0x256"], filament_colour: ["#FF0000", "#00FF00"], filament_type: ["PLA", "PLA"] });
  const all: Record<string, string> = { "3D/3dmodel.model": root, "3D/Objects/object_1.model": obj, "Metadata/model_settings.config": ms, "Metadata/project_settings.config": proj, ...extra };
  return Object.fromEntries(Object.entries(all).map(([k, v]) => [k, strToU8(v)]));
}
const text = (out: Record<string, Uint8Array>, k: string) => strFromU8(out[k]);
const project = (parts: Part[], map: number[] | null = null) => toPrusaProject(source(parts), INDX4, { map, colours: ["#FF0000", "#00FF00"], types: ["PLA", "PLA"] });

test("prusa project: a negative part becomes a NegativeVolume of its object, not a solid object of its own", () => {
  const { out } = project([{ id: 2, subtype: "normal_part", name: "body" }, { id: 3, subtype: "negative_part", name: "hole" }]);
  const cfg = text(out, PRUSA_MODEL_CONFIG);
  assert.match(cfg, /<volume firstid="0" lastid="3">\s*<metadata type="volume" key="name" value="body"\/>\s*<metadata type="volume" key="volume_type" value="ModelPart"\/>/);
  assert.match(cfg, /<volume firstid="4" lastid="7">\s*<metadata type="volume" key="name" value="hole"\/>\s*<metadata type="volume" key="volume_type" value="NegativeVolume"\/>/);
  // The object the config names is the one mesh object the build places, holding all 8 triangles.
  const root = text(out, "3D/3dmodel.model");
  const id = /<object id="(\d+)" instances_count/.exec(cfg)![1];
  assert.match(root, new RegExp(`<item objectid="${id}"`));
  const obj = new RegExp(`<object id="${id}"[^>]*><mesh>([\\s\\S]*?)</mesh></object>`).exec(root)![1];
  assert.equal([...obj.matchAll(/<triangle\b/g)].length, 8);
  assert.ok(!root.includes("<components>"), "no component is left for PrusaSlicer to split into its own object");
  // The parts no longer stand alone in their file, where they would load as extra objects.
  assert.ok(!/<object\b/.test(text(out, "3D/Objects/object_1.model")));
});

test("prusa project: only model parts are painted; the cutter's triangles carry no mmu_segmentation", () => {
  const { out } = project([{ id: 2, subtype: "normal_part", name: "body" }, { id: 3, subtype: "negative_part", name: "hole" }]);
  const tris = [...text(out, "3D/3dmodel.model").matchAll(/<triangle\b[^>]*\/>/g)].map((m) => m[0]);
  assert.equal(tris.length, 8);
  assert.ok(tris.slice(0, 4).every((t) => /slic3rpe:mmu_segmentation="/.test(t)), "body faces painted");
  assert.ok(tris.slice(4).every((t) => !/mmu_segmentation|paint_color/.test(t)), "hole faces unpainted");
});

test("prusa project: modifiers, blockers and enforcers keep their kinds; a modifier's filament follows the slot map", () => {
  const { out } = project(
    [
      { id: 2, subtype: "normal_part", name: "body" },
      { id: 3, subtype: "modifier_part", name: "mod", extra: `<metadata key="extruder" value="2"/>` },
      { id: 4, subtype: "support_blocker", name: "block" },
      { id: 5, subtype: "support_enforcer", name: "force" },
    ],
    [1, 0],
  );
  const cfg = text(out, PRUSA_MODEL_CONFIG);
  assert.match(cfg, /value="mod"\/>\s*<metadata type="volume" key="volume_type" value="ParameterModifier"\/>\s*<metadata type="volume" key="extruder" value="1"\/>/);
  assert.match(cfg, /value="block"\/>\s*<metadata type="volume" key="volume_type" value="SupportBlocker"\/>/);
  assert.match(cfg, /value="force"\/>\s*<metadata type="volume" key="volume_type" value="SupportEnforcer"\/>/);
});

test("prusa project: each part's transform is applied when its mesh joins the object", () => {
  const { out } = project([{ id: 2, subtype: "normal_part", name: "body" }, { id: 3, subtype: "negative_part", name: "hole", transform: "1 0 0 0 1 0 0 0 1 5 6 7" }]);
  const xs = [...text(out, "3D/3dmodel.model").matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"/g)].map((m) => m.slice(1).map(Number));
  assert.deepEqual(xs[4], [5, 6, 7], "the hole's first vertex moved by its component transform");
  assert.deepEqual(xs[0], [0, 0, 0]);
});

test("prusa project: an object made only of model parts is written exactly as before (no model config)", () => {
  const { out } = project([{ id: 2, subtype: "normal_part", name: "a" }, { id: 3, subtype: "normal_part", name: "b" }]);
  assert.ok(!(PRUSA_MODEL_CONFIG in out));
  assert.match(text(out, "3D/3dmodel.model"), /<components>/);
});

test("prusa project: per-height colors, height ranges and part settings are reported, not dropped silently", async () => {
  const lcr = `<?xml version="1.0"?><objects><object id="1"><range min_z="0" max_z="2"><option opt_key="extruder">1</option></range></object></objects>`;
  const cg = `<?xml version="1.0"?><custom_gcodes_per_layer><plate><plate_info id="1"/><layer top_z="5" type="0" extruder="2" color="#00FF00" extra="" gcode="tool_change"/></plate></custom_gcodes_per_layer>`;
  const parts = [{ id: 2, subtype: "normal_part", name: "body", extra: `<metadata key="sparse_infill_density" value="40%"/>` }];
  const z = zipSync({ ...source(parts), "Metadata/layer_config_ranges.xml": strToU8(lcr), "Metadata/custom_gcode_per_layer.xml": strToU8(cg) }, { level: 0 });
  const r = await cleanThreeMF(new File([z as BlobPart], "t.3mf"), "prusa-core-one-indx-4t");
  assert.deepEqual([...(r.untranslated ?? [])].sort(), ["height_ranges", "part_settings", "per_height_colors"]);
  // A plain file reports nothing.
  const plain = await cleanThreeMF(new File([zipSync(source([{ id: 2, subtype: "normal_part", name: "body" }])) as BlobPart], "p.3mf"), "prusa-core-one-indx-4t");
  assert.deepEqual(plain.untranslated, []);
});

test("prusa project: the converted r6 file holds the negative part as a NegativeVolume", async () => {
  const r = await cleanThreeMF(new File([zipSync(source([{ id: 2, subtype: "normal_part", name: "body" }, { id: 3, subtype: "negative_part", name: "hole" }])) as BlobPart], "r6.3mf"), "prusa-core-one-indx-4t");
  const e = unzipSync(new Uint8Array(await r.blob.arrayBuffer()));
  assert.match(strFromU8(e[PRUSA_MODEL_CONFIG]), /value="NegativeVolume"/);
});
