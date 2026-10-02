// Bambu/Orca → PrusaSlicer project for the CORE One INDX. Run: `npm test`.
//
// The expectations here were first checked against PrusaSlicer 2.9.6 itself (2026-10-01): it read
// these projects' Slic3r_PE.config identity, sliced the remapped paint onto the expected tools, and
// printed the base layer with the part's own filament — where the unconverted Bambu file used T0.
import { test } from "node:test";
import assert from "node:assert/strict";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { toPrusaProject, prusaProjectConfig, planColorMix, fullSpectrumJson, FULL_SPECTRUM_FILE } from "./prusa-project.ts";
import { MACHINES } from "./targets.ts";
import { cleanThreeMF } from "./convert.ts";

const INDX8 = MACHINES["prusa-core-one-indx-8t"];
const INDX4 = MACHINES["prusa-core-one-indx-4t"];

// A MakerWorld-shaped file: root object 2 → component in 3D/Objects/object_1.model. Four side faces
// painted with filaments 1..4; the two base faces unpainted, on a part assigned filament 2.
function fixture({ area = true }: { area?: boolean } = {}): Record<string, Uint8Array> {
  const t = (a: number, b: number, c: number, code?: string) =>
    `<triangle v1="${a}" v2="${b}" v3="${c}"${code ? ` paint_color="${code}"` : ""}/>`;
  const part = `<?xml version="1.0"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="30" y="0" z="0"/><vertex x="30" y="30" z="0"/><vertex x="0" y="30" z="0"/><vertex x="15" y="15" z="25"/></vertices><triangles>${t(0, 1, 4, "4")}${t(1, 2, 4, "8")}${t(2, 3, 4, "0C")}${t(3, 0, 4, "1C")}${t(0, 2, 1)}${t(0, 3, 2)}</triangles></mesh></object></resources><build/></model>`;
  const root = `<?xml version="1.0"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p"><resources><object id="2" type="model"><components><component p:path="/3D/Objects/object_1.model" objectid="1"/></components></object></resources><build><item objectid="2" transform="1 0 0 0 1 0 0 0 1 128 128 0"/></build></model>`;
  return {
    "[Content_Types].xml": strToU8("<Types/>"),
    "3D/3dmodel.model": strToU8(root),
    "3D/Objects/object_1.model": strToU8(part),
    "Metadata/model_settings.config": strToU8(
      `<config><object id="2"><metadata key="extruder" value="1"/><part id="1" subtype="normal_part"><metadata key="extruder" value="2"/></part></object></config>`,
    ),
    "Metadata/project_settings.config": strToU8(
      JSON.stringify({
        filament_colour: ["#FF0000", "#00FF00", "#0000FF", "#FFFF00"],
        filament_type: ["PLA", "PLA", "PETG", "PLA"],
        ...(area ? { printable_area: ["0x0", "256x0", "256x256", "0x256"] } : {}),
      }),
    ),
  };
}

const paints = (out: Record<string, Uint8Array>) =>
  [...strFromU8(out["3D/Objects/object_1.model"]).matchAll(/slic3rpe:mmu_segmentation="([^"]+)"/g)].map((m) => m[1]);

test("every face is painted explicitly, unpainted ones with their PART's filament", () => {
  const { out } = toPrusaProject(fixture(), INDX8, { map: null, colours: [], types: [] });
  // Sides keep states 1..4; the two base faces become state 2 (code "8"), the part's filament —
  // PrusaSlicer would otherwise print them with tool 1, since it never reads model_settings.config.
  assert.deepEqual(paints(out), ["4", "8", "0C", "1C", "8", "8"]);
  assert.ok(!strFromU8(out["3D/Objects/object_1.model"]).includes("paint_color="));
  assert.match(strFromU8(out["3D/Objects/object_1.model"]), /xmlns:slic3rpe="http:\/\/schemas\.slic3r\.org\/3mf\/2017\/06"/);
});

test("the slot map moves painted states and the base together", () => {
  const { out } = toPrusaProject(fixture(), INDX8, { map: [3, 2, 1, 0], colours: [], types: [] });
  // 1↔4 and 2↔3: sides read 4,3,2,1, and the base (filament 2) follows to tool 3.
  assert.deepEqual(paints(out), ["1C", "0C", "8", "4", "0C", "0C"]);
});

test("a state past the machine's tools is clamped onto it rather than written out of range", () => {
  const { out } = toPrusaProject(fixture(), INDX4, { map: [0, 1, 2, 7], colours: [], types: [] });
  assert.equal(paints(out)[3], "1C"); // filament 4 → slot 8 requested → tool 4, the last one there is
});

test("build items move from the source bed's centre to the INDX's", () => {
  const { out } = toPrusaProject(fixture(), INDX8, { map: null, colours: [], types: [] });
  const tr = /transform="([^"]+)"/.exec(strFromU8(out["3D/3dmodel.model"]))![1].split(" ").map(Number);
  // 256×256 plate centred at 128,128 → 248×205 bed centred at 124,102.5.
  assert.deepEqual(tr.slice(9), [124, 102.5, 0]);
  const unmoved = toPrusaProject(fixture({ area: false }), INDX8, { map: null, colours: [], types: [] }).out;
  assert.match(strFromU8(unmoved["3D/3dmodel.model"]), /transform="1 0 0 0 1 0 0 0 1 128 128 0"/);
});

test("Bambu metadata goes; a minimal Slic3r_PE.config naming the preset comes in", () => {
  const { out, removed } = toPrusaProject(fixture(), INDX8, { map: null, colours: ["#ff0000", "#00FF00"], types: ["PLA", "PETG"] });
  assert.deepEqual(removed.sort(), ["Metadata/model_settings.config", "Metadata/project_settings.config"]);
  const cfg = strFromU8(out["Metadata/Slic3r_PE.config"]);
  assert.match(cfg, /^; printer_settings_id = Prusa CORE One INDX 8T HF0\.4 nozzle$/m);
  assert.match(cfg, /^; printer_model = COREONE_INDX8T$/m);
  assert.match(cfg, /^; printer_variant = HF0\.4$/m);
  assert.match(cfg, /^; bed_shape = 0x0,248x0,248x205,0x205$/m);
  assert.match(cfg, /^; nozzle_diameter = 0\.4(,0\.4){7}$/m);
  // One colour per tool: the given ones, then white, so all eight tools are defined.
  assert.match(cfg, /^; extruder_colour = #FF0000;#00FF00(;#FFFFFF){6}$/m);
  assert.match(cfg, /^; filament_type = PLA;PETG(;PLA){6}$/m);
});

test("the config carries identity and colour only — no Prusa profile content", () => {
  // BedReady is MIT; Prusa's profiles are AGPL. PrusaSlicer resolves everything else from its own
  // system preset of this name, so nothing like start G-code may ever be written here.
  const keys = prusaProjectConfig(INDX4, [], [])
    .split("\n")
    .filter((l) => /^; \w+ =/.test(l))
    .map((l) => l.slice(2).split(" =")[0]);
  assert.deepEqual(keys, [
    "printer_settings_id", "printer_model", "printer_variant", "bed_shape", "max_print_height",
    "nozzle_diameter", "extruder_colour", "filament_colour", "filament_type",
  ]);
});

test("cleanThreeMF routes a Bambu file to a Prusa project for the INDX, and nowhere else changes", async () => {
  const file = new File([zipSync(fixture())], "m.3mf");
  const indx = unzipSync(new Uint8Array(await (await cleanThreeMF(file, "prusa-core-one-indx-8t")).blob.arrayBuffer()));
  assert.ok(indx["Metadata/Slic3r_PE.config"], "an INDX target gets a PrusaSlicer project");
  assert.equal(paints(indx).length, 6);
  // A Bambu → Creality (Orca family) retarget is unchanged: same-family reprofile, no Prusa config.
  const k2 = unzipSync(new Uint8Array(await (await cleanThreeMF(file, "creality-k2")).blob.arrayBuffer()));
  assert.equal(k2["Metadata/Slic3r_PE.config"], undefined);
});

// ── ColorMix (FullSpectrum virtual extruders) ────────────────────────────────────────────────────
// Checked against PrusaSlicer 2.9.6 by slicing (2026-10-02): with these blends written, a purple face
// printed from red + blue and the black tool it was assigned to went unused.

const LOADED = ["#FF0000", "#0000FF", "#FFFFFF", "#000000", "#00FF00", "#FFFF00", "#00FFFF", "#FF8000"];

test("a colour with a close spool stays on it; one with none becomes a blend above the tools", () => {
  const plan = planColorMix(["#FF0000", "#800080"], LOADED, 8);
  assert.equal(plan.map[0], 0, "red is loaded: no blend");
  assert.equal(plan.map[1], 8, "purple → the first virtual id after 8 tools");
  assert.deepEqual(plan.blends[0].components.map((c) => c.tool).sort(), [1, 2], "from red and blue");
});

test("only PrusaSlicer's dialog ratios are used: 1:1, 1:3, 3:1, 1:1:1", () => {
  const plan = planColorMix(["#800080", "#C04040", "#4040C0", "#808080", "#7F3F7F"], LOADED, 8);
  for (const b of plan.blends) {
    const r = b.components.map((c) => +c.ratio.toFixed(4)).sort();
    const ok = [[0.5, 0.5], [0.25, 0.75], [0.3333, 0.3333, 0.3333]].some((x) => JSON.stringify(x) === JSON.stringify(r));
    assert.ok(ok, `ratio ${r}`);
    assert.ok(Math.abs(b.components.reduce((s, c) => s + c.ratio, 0) - 1) < 1e-9);
  }
});

test("identical blends are shared, and the paint encoding caps how many exist", () => {
  const same = planColorMix(["#800080", "#7F007F"], LOADED, 8);
  assert.equal(same.blends.length, 1);
  assert.equal(same.map[0], same.map[1]);
  // Many distinct mixed colours on an 8T: never more than 8 blends (ids 9..16).
  const many = Array.from({ length: 30 }, (_, i) => `#${((i * 2654435761) >>> 8 & 0xffffff).toString(16).padStart(6, "0")}`);
  const capped = planColorMix(many, LOADED, 8);
  assert.ok(capped.blends.length <= 8);
  assert.ok(capped.map.every((m) => m < 8 + capped.blends.length));
});

test("the FullSpectrum JSON has PrusaSlicer's shape: every physical tool, virtual ids after them", () => {
  const plan = planColorMix(["#800080"], LOADED, 8);
  const j = JSON.parse(fullSpectrumJson(INDX8, LOADED, plan.blends));
  assert.equal(j.version, 1);
  assert.equal(j.physical_extruders.length, 8);
  assert.deepEqual(j.physical_extruders[1], { id: 2, color: "#0000FF" });
  assert.equal(j.virtual_extruders[0].id, 9);
  assert.equal(j.virtual_extruders[0].kind, "fullspectrum");
  assert.equal(j.virtual_extruders[0].color, undefined, "left to PrusaSlicer's own mixer");
});

test("cleanThreeMF writes blends only when asked, and only for a ColorMix machine", async () => {
  const purple = fixture();
  purple["Metadata/project_settings.config"] = strToU8(JSON.stringify({ filament_colour: ["#FF0000", "#0000FF", "#FFFFFF", "#800080"], filament_type: ["PLA", "PLA", "PLA", "PLA"] }));
  const file = new File([zipSync(purple)], "m.3mf");
  const opts = { slots: LOADED, assign: [0, 1, 2, 3] };
  const off = unzipSync(new Uint8Array(await (await cleanThreeMF(file, "prusa-core-one-indx-8t", opts)).blob.arrayBuffer()));
  assert.equal(off[FULL_SPECTRUM_FILE], undefined);
  const on = unzipSync(new Uint8Array(await (await cleanThreeMF(file, "prusa-core-one-indx-8t", { ...opts, colorMix: true })).blob.arrayBuffer()));
  assert.ok(on[FULL_SPECTRUM_FILE]);
  assert.equal(paints(on)[3], "6C", "filament 4 (purple) → virtual extruder 9");
  const mk4 = unzipSync(new Uint8Array(await (await cleanThreeMF(file, "prusa-mk4-mmu3", { ...opts, slots: LOADED.slice(0, 5), colorMix: true })).blob.arrayBuffer()));
  assert.equal(mk4[FULL_SPECTRUM_FILE], undefined, "MMU3 is not a ColorMix target");
});

// Placeholder slots on an 8-tool INDX are padded white; they must not be blended or matched.
test("planColorMix: unusable slots are neither spools nor blend components", () => {
  const slots = ["#FF0000", "#0000FF", "#FFFFFF", "#FFFFFF"];
  const usable = [true, true, false, false];
  const plan = planColorMix(["#FFC0CB", "#FF0000"], slots, 4, usable);
  for (const b of plan.blends) for (const c of b.components) assert.ok(c.tool <= 2, `blend uses placeholder tool ${c.tool}`);
  assert.ok(plan.map.every((m) => m >= 4 || usable[m]), "a colour was matched to a placeholder slot");
  const open = planColorMix(["#FFC0CB"], slots, 4);
  assert.ok(open.map[0] === 2 || open.blends.some((b) => b.components.some((c) => c.tool > 2)), "without a mask white counts as loaded");
});
