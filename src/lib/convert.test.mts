// Converter regression suite. Run: `npm test` (tsx --test).
// Fixtures are built in-memory with fflate so the suite is self-contained (no external .3mf files).
import { test } from "node:test";
import assert from "node:assert/strict";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { cleanThreeMF, analyzeThreeMF, convertWarnings, warningTextEn, filamentPresetId, reduceColors, subsetThreeMF, reassignPlates, detectProfile, safeUnzip, ThreeMFError, textEntryTooLarge, MAX_TEXT_ENTRY, type Analysis } from "./convert.ts";
import { readFile } from "node:fs/promises";
import { remapPaintCode, dominantState, encodeSolidPaint } from "./paint.ts";
import { U1, u1NozzleVariant, type Machine } from "./targets.ts";
import { mixRgb } from "./filament-mixer.ts";
import { bestMix, bestPhysicalSet } from "./convert.ts";
import { parseStl, stlTo3MF } from "./stl.ts";

// ---------- fixtures ----------
function file3mf(entries: Record<string, string>): File {
  const z = zipSync(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, strToU8(v)])), { level: 0 });
  return new File([z as BlobPart], "test.3mf");
}
function project(o: Record<string, unknown> = {}): string {
  return JSON.stringify({
    printer_settings_id: "Bambu Lab P1S 0.4 nozzle",
    printable_area: ["0x0", "256x0", "256x256", "0x256"],
    filament_colour: ["#000000", "#FFFFFF"],
    filament_type: ["PLA", "PLA"],
    ...o,
  });
}
const MESH = `<vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles>`;
const model = (extra = "", build = `<build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 128 128 0"/></build>`) =>
  `<?xml version="1.0"?><model><resources><object id="1"><mesh>${MESH}</mesh></object></resources>${extra}${build}</model>`;

async function cfgOf(blob: Blob): Promise<Record<string, unknown>> {
  const e = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const ps = Object.entries(e).find(([p]) => p.toLowerCase().endsWith("project_settings.config"));
  return ps ? JSON.parse(strFromU8(ps[1])) : {};
}
const analysis = (o: Partial<Analysis>): Analysis =>
  ({ colors: [], types: [], painted: false, maxSlot: 0, encoding: "simple", usage: [], ...o });

// ---------- paint codec ----------
test("paint codec: identity remap is stable", () => {
  for (const code of ["4", "0C", "8", "10"]) {
    const round = remapPaintCode(code, (s) => s);
    // re-decoding the round-tripped code yields the same dominant state
    assert.equal(dominantState(round), dominantState(code));
  }
});
test("paint codec: remap changes the leaf state", () => {
  const code = "4"; // a painted state
  const remapped = remapPaintCode(code, (s) => (s === 0 ? 0 : s + 1));
  assert.notEqual(dominantState(remapped), 0);
});

// ---------- reduceColors ----------
test("reduceColors collapses >4 to exactly 4 and maps every source", () => {
  const hexes = ["#FF0000", "#FE0000", "#00FF00", "#0000FF", "#FFFFFF", "#000000"];
  const r = reduceColors(hexes, [100, 1, 100, 100, 100, 100]); // 2nd is least-used, near red
  assert.equal(r.colors.length, 4);
  assert.equal(r.map.length, hexes.length);
  assert.ok(r.map.every((m) => m >= 0 && m < 4));
  // the rarely-used near-duplicate red should fold into the red group
  assert.equal(r.map[1], r.map[0]);
});
test("filament mixer matches the slicer's golden value", () => {
  // From filament_mixer_model.h: lerp(0,33,133, 252,211,0, 0.5) → (47,141,56)
  assert.deepEqual(mixRgb([0, 33, 133], [252, 211, 0], 0.5), [47, 141, 56]);
  assert.deepEqual(mixRgb([10, 20, 30], [200, 100, 50], 0), [10, 20, 30]); // t=0 → c1
  assert.deepEqual(mixRgb([10, 20, 30], [200, 100, 50], 1), [200, 100, 50]); // t=1 → c2
});
test("bestMix: exact mix resolves to its components; pure stays pure", () => {
  const bases = ["#002185", "#FCD300", "#FF0000", "#FFFFFF"]; // blue, yellow, red, white
  const green = bestMix("#2F8D38", bases); // == mix(blue, yellow, 0.5)
  assert.ok(green.deltaE < 1);
  assert.deepEqual([green.a, green.b].sort(), [1, 2]); // blue + yellow
  assert.equal(green.mixBPercent, 50);
  const pure = bestMix("#FCD300", bases);
  assert.equal(pure.a, pure.b); // a pure colour beats any mix
  assert.ok(pure.deltaE < 1);
});
test("reduceColors: a pinned colour is protected from merging", () => {
  const hexes = ["#FF0000", "#FE0000", "#00FF00", "#0000FF", "#FFFF00"];
  const usage = [100, 100, 100, 100, 1]; // yellow is least-used → normally merged away
  assert.ok(!reduceColors(hexes, usage).colors.includes("#FFFF00"));
  const pinned = reduceColors(hexes, usage, [4]); // pin yellow
  assert.equal(pinned.colors.length, 4);
  assert.ok(pinned.colors.includes("#FFFF00")); // survives; a more-used colour merges instead
});

// ---------- convertWarnings ----------
test("convertWarnings: mixed materials -> tower adhesion warn", () => {
  const w = convertWarnings(analysis({ types: ["PLA", "PETG"], colors: ["#000", "#fff"] }));
  const hit = w.find((x) => x.key === "warnMixedFilaments");
  assert.ok(hit && hit.level === "warn");
  assert.equal(hit!.params?.families, "PLA + PETG");
});
test("convertWarnings: painted -> edit-fragility info; >4 -> reduce/M600 info", () => {
  const painted = convertWarnings(analysis({ types: ["PLA"], painted: true, colors: ["#000"] }));
  assert.ok(painted.some((x) => x.key === "warnPaintedEdits"));
  const over4 = convertWarnings(analysis({ types: ["PLA"], colors: ["a", "b", "c", "d", "e"], encoding: "by-layer" }));
  const o = over4.find((x) => x.key === "warnOverFourByLayer");
  assert.ok(o, "by-layer >4 should offer the M600 route");
  assert.equal(o!.params?.count, 5);
  // Non-by-layer files can't use M600 pauses, so they get the plain merge sentence.
  const merge = convertWarnings(analysis({ types: ["PLA"], colors: ["a", "b", "c", "d", "e"] }));
  assert.ok(merge.some((x) => x.key === "warnOverFourMerge"));
});

// The reason this file changed shape: these warnings used to be English sentences built inside
// lib/, which has no locale. They shipped untranslated in all 6 non-English locales while the page
// around them was translated. Keys can drift from messages/ silently, so pin both directions.
test("every warning key exists in messages/en.json and renders in English", async () => {
  const en = JSON.parse(await readFile(new URL("../../messages/en.json", import.meta.url), "utf8"));
  const emitted = [
    ...convertWarnings(analysis({ types: ["PLA", "PETG"], painted: true, colors: ["a", "b", "c", "d", "e"], encoding: "by-layer" })),
    ...convertWarnings(analysis({ types: ["PLA"], colors: ["a", "b", "c", "d", "e"] })),
    { level: "warn" as const, key: "warnOverhangYes", params: { percent: 30 } },
    { level: "info" as const, key: "warnOverhangNo" },
    { level: "warn" as const, key: "warnTooBig", params: { x: 1, y: 2, z: 3, maxXY: 270, maxZ: 270 } },
  ];
  for (const w of emitted) {
    assert.ok(en.convert[w.key], `messages/en.json convert.${w.key} is missing`);
    // warningTextEn backs the browser extension, which has no i18n runtime.
    assert.notEqual(warningTextEn(w), w.key, `warningTextEn has no case for ${w.key}`);
  }
});
test("convertWarnings: single material, <=4, not painted -> no warnings", () => {
  assert.equal(convertWarnings(analysis({ types: ["PLA", "PLA"], colors: ["#000", "#fff"] })).length, 0);
});

// ---------- cleanThreeMF integration ----------
test("tower-safety: output forces rib wall type (preserve)", async () => {
  const f = file3mf({ "Metadata/project_settings.config": project({ wipe_tower_wall_type: "rectangle" }), "3D/3dmodel.model": model() });
  const c = await cfgOf((await cleanThreeMF(f, "u1", { mode: "preserve" })).blob);
  assert.equal(c.wipe_tower_wall_type, "rib");
});
test("anti-clobber: print_settings_id suffixed; inherits_group dropped as a foreign key (preserve)", async () => {
  const f = file3mf({ "Metadata/project_settings.config": project({ print_settings_id: "0.20 Foo", inherits_group: ["a", "b"] }), "3D/3dmodel.model": model() });
  const r = await cleanThreeMF(f, "u1", { mode: "preserve" });
  const c = await cfgOf(r.blob);
  assert.match(String(c.print_settings_id), / \(converted\)$/);
  // inherits_group is not in the U1 schema → dropped entirely (can't reference a library profile).
  assert.equal(c.inherits_group, undefined);
  assert.equal(r.diff?.antiClobber, true);
});
test("value-clamp: speed above U1 ceiling is capped + reported", async () => {
  const f = file3mf({ "Metadata/project_settings.config": project({ outer_wall_speed: "350" }), "3D/3dmodel.model": model() });
  const r = await cleanThreeMF(f, "u1", { mode: "preserve" });
  const c = await cfgOf(r.blob);
  assert.equal(c.outer_wall_speed, "200"); // U1 ceiling
  assert.ok(r.diff?.clamped.some((x) => x.key === "outer_wall_speed" && x.to === "200"));
});
test("temp-clamp: nozzle temp above the U1 range ceiling is capped + reported", async () => {
  // An ABS/PC project off a hotter machine. Preserve mode used to carry 300 °C straight into a file
  // claiming to be U1-ready; the cap is the profile's declared range ceiling (280), not the
  // reference's own nozzle_temperature (270, which is just the reference filament's value).
  const f = file3mf({
    "Metadata/project_settings.config": project({ nozzle_temperature: ["300", "300"], nozzle_temperature_initial_layer: ["300", "300"] }),
    "3D/3dmodel.model": model(),
  });
  const r = await cleanThreeMF(f, "u1", { mode: "preserve" });
  const c = await cfgOf(r.blob);
  assert.deepEqual(c.nozzle_temperature, ["280", "280", "280", "280"]);
  assert.deepEqual(c.nozzle_temperature_initial_layer, ["280", "280", "280", "280"]);
  assert.ok(r.diff?.clamped.some((x) => x.key === "nozzle_temperature" && x.to === "280"));
});
test("temp-clamp: an in-range temp is preserved, not normalised to the reference", async () => {
  // 275 is above the reference's own nozzle_temperature (270) but inside the declared range (280),
  // so the creator's choice must survive — clamping to 270 here would be a regression.
  const f = file3mf({ "Metadata/project_settings.config": project({ nozzle_temperature: ["275", "275"] }), "3D/3dmodel.model": model() });
  const r = await cleanThreeMF(f, "u1", { mode: "preserve" });
  const c = await cfgOf(r.blob);
  assert.deepEqual(c.nozzle_temperature, ["275", "275", "275", "275"]);
  assert.equal(r.diff?.clamped.some((x) => x.key === "nozzle_temperature"), false);
});
test("temp-clamp: a cool PLA temp is left alone (no lower clamp)", async () => {
  // range_low is 240 in the reference, but 190 °C PLA is correct — never clamp upward.
  const f = file3mf({ "Metadata/project_settings.config": project({ nozzle_temperature: ["190", "190"] }), "3D/3dmodel.model": model() });
  const c = await cfgOf((await cleanThreeMF(f, "u1", { mode: "preserve" })).blob);
  assert.deepEqual(c.nozzle_temperature, ["190", "190", "190", "190"]);
});
test("declared nozzle range describes the U1, not the source machine", async () => {
  // The range keys are what a validator reads. Preserving the source's meant a too-hot preserved
  // temp looked in-range downstream.
  const f = file3mf({
    "Metadata/project_settings.config": project({ nozzle_temperature_range_high: ["320", "320"], nozzle_temperature_range_low: ["200", "200"] }),
    "3D/3dmodel.model": model(),
  });
  const c = await cfgOf((await cleanThreeMF(f, "u1", { mode: "preserve" })).blob);
  assert.deepEqual(c.nozzle_temperature_range_high, ["280", "280", "280", "280"]);
  assert.deepEqual(c.nozzle_temperature_range_low, ["240", "240", "240", "240"]);
});
test("clamp skips a 0 reference (auto sentinel, not a ceiling)", async () => {
  // overhang_1_4_speed U1 ref is 0 → a real source value must NOT be clamped to 0
  const f = file3mf({ "Metadata/project_settings.config": project({ overhang_1_4_speed: "60" }), "3D/3dmodel.model": model() });
  const c = await cfgOf((await cleanThreeMF(f, "u1", { mode: "preserve" })).blob);
  assert.equal(c.overhang_1_4_speed, "60");
});
test("bed-origin shift: (0,0)-origin model nudged by +0.5/+1", async () => {
  const f = file3mf({ "Metadata/project_settings.config": project(), "3D/3dmodel.model": model() });
  const r = await cleanThreeMF(f, "u1", { mode: "preserve" });
  assert.deepEqual(r.diff?.bedShift, { dx: 0.5, dy: 1 });
  const e = unzipSync(new Uint8Array(await r.blob.arrayBuffer()));
  const root = strFromU8(Object.entries(e).find(([p]) => p.endsWith("3dmodel.model"))![1]);
  const t = /transform="([^"]+)"/.exec(root)![1].trim().split(/\s+/).map(Number);
  assert.equal(t[9], 128.5);
  assert.equal(t[10], 129);
});
test("generic (strip vendor lock): keeps geometry + thumbnail, drops vendor configs", async () => {
  const f = file3mf({
    "[Content_Types].xml": `<?xml version="1.0"?><Types/>`,
    "_rels/.rels": `<?xml version="1.0"?><Relationships/>`,
    "3D/3dmodel.model": model(`<metadata name="paint_color">1</metadata>`),
    "3D/_rels/3dmodel.model.rels": `<?xml version="1.0"?><Relationships/>`,
    "Metadata/plate_1.png": "thumb",
    "Metadata/project_settings.config": project(),
    "Metadata/model_settings.config": `<config/>`,
    "Metadata/slice_info.config": `<config/>`,
    "Metadata/plate_1.gcode": "G1",
  });
  const r = await cleanThreeMF(f, "generic");
  const e = unzipSync(new Uint8Array(await r.blob.arrayBuffer()));
  const paths = Object.keys(e);
  // kept: core-spec geometry + rels + content types + thumbnail image
  assert.ok(paths.includes("[Content_Types].xml"));
  assert.ok(paths.includes("_rels/.rels"));
  assert.ok(paths.includes("3D/3dmodel.model"));
  assert.ok(paths.includes("3D/_rels/3dmodel.model.rels"));
  assert.ok(paths.includes("Metadata/plate_1.png"));
  // dropped: every vendor slicer config + sliced gcode
  assert.ok(!paths.some((p) => /\.config$/i.test(p)), "all vendor configs stripped");
  assert.ok(!paths.some((p) => /\.gcode$/i.test(p)), "sliced gcode stripped");
  // colours/paint live in the .model geometry and are preserved byte-for-byte
  assert.ok(strFromU8(e["3D/3dmodel.model"]).includes("paint_color"));
  assert.equal(r.diff, null);
  assert.ok(r.removed.length >= 3);
});
// ---------- multi-printer retargeting (non-U1 targets) ----------
test("retarget Bambu → another Bambu (X1C): printer identity rewritten, colours preserved", async () => {
  // Source is a Bambu project (P1S) with 2 colours → retarget to the Bambu X1 Carbon (same family).
  const f = file3mf({
    "Metadata/project_settings.config": project({ printer_model: "Bambu Lab P1S", filament_colour: ["#112233", "#445566"] }),
    "3D/3dmodel.model": model(),
  });
  const r = await cleanThreeMF(f, "bambu-x1c");
  const c = await cfgOf(r.blob);
  assert.equal(c.printer_model, "Bambu Lab X1 Carbon"); // printer_model retargeted
  assert.equal(c.printer_settings_id, "Bambu Lab X1 Carbon"); // settings id retargeted
  assert.deepEqual(c.printable_area, ["0x0", "256x0", "256x256", "0x256"]); // X1C bed polygon
  assert.equal(c.printable_height, "256");
  assert.deepEqual(c.filament_colour, ["#112233", "#445566"]); // colours preserved (≤4, no reorder)
  assert.equal(r.diff, null); // retarget carries no U1 diff
  assert.equal(r.reduced, false);
});

test("retarget across ecosystems (Bambu → Prusa): falls back to a Generic-stripped 3MF", async () => {
  const f = file3mf({
    "[Content_Types].xml": `<?xml version="1.0"?><Types/>`,
    "_rels/.rels": `<?xml version="1.0"?><Relationships/>`,
    "3D/3dmodel.model": model(`<metadata name="paint_color">1</metadata>`),
    "Metadata/project_settings.config": project(),
    "Metadata/slice_info.config": `<config/>`,
  });
  const r = await cleanThreeMF(f, "prusa-mk4-mmu3"); // Bambu source, Prusa target → cross family
  const e = unzipSync(new Uint8Array(await r.blob.arrayBuffer()));
  const paths = Object.keys(e);
  assert.ok(!paths.some((p) => /\.config$/i.test(p)), "vendor configs stripped (generic fallback)");
  assert.ok(paths.includes("3D/3dmodel.model"), "geometry kept");
  assert.ok(strFromU8(e["3D/3dmodel.model"]).includes("paint_color"), "colours/paint preserved in the mesh");
  assert.equal(r.diff, null);
});

test("retarget >4 colours reduces to the target slot count and remaps paint", async () => {
  const codes = ["4", "8", "0C", "1C", "2C"]; // paint states 1..5
  const tris = codes.map((c) => `<triangle v1="0" v2="1" v3="2" paint_color="${c}"/>`).join("");
  const verts = `<vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices>`;
  const m = `<?xml version="1.0"?><model><resources><object id="1"><mesh>${verts}<triangles>${tris}</triangles></mesh></object></resources><build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/></build></model>`;
  const f = file3mf({
    "Metadata/project_settings.config": project({ filament_colour: ["#FF0000", "#00FF00", "#0000FF", "#FFFF00", "#FF00FF"], filament_type: ["PLA", "PLA", "PLA", "PLA", "PLA"] }),
    "3D/3dmodel.model": m,
  });
  const r = await cleanThreeMF(f, "bambu-x1c"); // 4 slots
  assert.equal(r.colorsTotal, 5);
  assert.equal(r.reduced, true);
  const c = await cfgOf(r.blob);
  assert.equal((c.filament_colour as string[]).length, 4, "reduced to the target's 4 slots");
  const e = unzipSync(new Uint8Array(await r.blob.arrayBuffer()));
  const xml = strFromU8(Object.entries(e).find(([p]) => p.endsWith("3dmodel.model"))![1]);
  const states = [...xml.matchAll(/paint_color="([0-9A-Fa-f]+)"/g)].map((mm) => dominantState(mm[1]));
  assert.ok(Math.max(...states) <= 4, `all paint states remapped to ≤4 slots (got ${states})`);
});

test("regression: target u1 output is unchanged (identity + colours + no mixed defs)", async () => {
  // A plain 2-colour Bambu file → U1. The default (preserve) path must still stamp the U1 identity,
  // preserve the creator's colours, and add no Full Spectrum mixed_filament_definitions.
  const f = file3mf({ "Metadata/project_settings.config": project({ filament_colour: ["#000000", "#FFFFFF"] }), "3D/3dmodel.model": model() });
  const c = await cfgOf((await cleanThreeMF(f, "u1")).blob);
  assert.equal(c.printer_settings_id, "Snapmaker U1 (0.4 nozzle)"); // U1 identity, unchanged
  assert.deepEqual(c.filament_colour, ["#000000", "#FFFFFF", "#FFFFFF", "#FFFFFF"]); // colours preserved, padded to 4
  assert.ok(!String(c.mixed_filament_definitions ?? "").trim()); // no Full Spectrum mixes on a plain file
});

test("VLH guard: prime tower forced off + tree->normal when layer_config_ranges present", async () => {
  const f = file3mf({
    "Metadata/project_settings.config": project({ enable_prime_tower: "1", support_type: "tree(auto)" }),
    "3D/3dmodel.model": model(),
    "Metadata/layer_config_ranges.xml": `<objects/>`,
  });
  const r = await cleanThreeMF(f, "u1", { mode: "preserve" });
  const c = await cfgOf(r.blob);
  assert.equal(c.enable_prime_tower, "0");
  assert.equal(c.support_type, "normal(auto)");
  assert.equal(r.diff?.vlhGuard, true);
});
test("sliced-gcode reject: plate gcode + no mesh throws a clear error", async () => {
  const f = file3mf({
    "Metadata/project_settings.config": project(),
    "3D/3dmodel.model": `<?xml version="1.0"?><model></model>`, // no <vertex>
    "Metadata/plate_1.gcode": "G1 X0 Y0\n",
  });
  await assert.rejects(() => cleanThreeMF(f, "u1", { mode: "preserve" }), /already-sliced/);
});
test("Prusa-MMU translation: slic3rpe:* paint attrs renamed to paint_*, values verbatim", async () => {
  // A Prusa-style model: paint stored under slic3rpe:mmu_segmentation, value "5C0D".
  const prusaModel = `<?xml version="1.0"?><model xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06"><resources><object id="1"><mesh>${MESH.replace('<triangle v1="0" v2="1" v3="2"/>', '<triangle v1="0" v2="1" v3="2" slic3rpe:mmu_segmentation="5C0D" slic3rpe:custom_supports="4"/>')}</mesh></object></resources><build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 128 128 0"/></build></model>`;
  // Prusa files carry no project_settings.config (they use Slic3r_PE.config) → stamp path.
  const f = file3mf({ "Metadata/Slic3r_PE.config": "; prusa\n", "3D/3dmodel.model": prusaModel });
  const r = await cleanThreeMF(f, "u1", { mode: "preserve" });
  assert.equal(r.diff?.prusaPaint, true);
  const e = unzipSync(new Uint8Array(await r.blob.arrayBuffer()));
  const m = strFromU8(Object.entries(e).find(([p]) => p.endsWith("3dmodel.model"))![1]);
  assert.match(m, /paint_color="5C0D"/); // renamed, value identical
  assert.match(m, /paint_supports="4"/);
  assert.doesNotMatch(m, /slic3rpe:mmu_segmentation=/); // old attr gone
});
test("Prusa >4: palette from Slic3r_PE.config + paint reduced to 4", async () => {
  // 5-colour Prusa MMU model: palette in the INI, paint under slic3rpe:mmu_segmentation (states 1..5).
  const PALETTE = ["#FF0000", "#00FF00", "#0000FF", "#FFFFFF", "#000000"];
  const ini = `; generated by PrusaSlicer\n; filament_colour = ${PALETTE.join(";")}\n; filament_type = PLA;PLA;PLA;PLA;PLA\n`;
  const codes = ["4", "8", "0C", "1C", "2C"]; // leaf states 1,2,3,4,5
  const tris = codes.map((c) => `<triangle v1="0" v2="1" v3="2" slic3rpe:mmu_segmentation="${c}"/>`).join("");
  const verts = `<vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices>`;
  const m = `<?xml version="1.0"?><model xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06"><resources><object id="1"><mesh>${verts}<triangles>${tris}</triangles></mesh></object></resources><build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 128 128 0"/></build></model>`;
  const f = file3mf({ "Metadata/Slic3r_PE.config": ini, "3D/3dmodel.model": m });
  const r = await cleanThreeMF(f, "u1", { mode: "preserve" });
  assert.equal(r.diff?.prusaPaint, true);
  assert.equal(r.colorsTotal, 5);
  assert.equal(r.colorsKept, 4);
  assert.equal(r.reduced, true);
  const c = await cfgOf(r.blob);
  const outColours = c.filament_colour as string[];
  assert.equal(outColours.length, 4);
  // kept colours are drawn from the creator's Prusa palette (not U1 defaults)
  assert.ok(outColours.every((x) => PALETTE.includes(x)));
  // paint was renamed to Orca's attribute and remapped into the 4 slots (no slot >4 remains)
  const xml = strFromU8(Object.entries(unzipSync(new Uint8Array(await r.blob.arrayBuffer()))).find(([p]) => p.endsWith("3dmodel.model"))![1]);
  assert.match(xml, /paint_color=/);
  assert.doesNotMatch(xml, /slic3rpe:mmu_segmentation=/);
});
test("Full Spectrum: >4 painted → 4 physical filaments + mixed_filament_definitions", async () => {
  const codes = ["4", "8", "0C", "1C", "2C"]; // paint states 1..5
  const tris = codes.map((c) => `<triangle v1="0" v2="1" v3="2" paint_color="${c}"/>`).join("");
  const verts = `<vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices>`;
  const m = `<?xml version="1.0"?><model><resources><object id="1"><mesh>${verts}<triangles>${tris}</triangles></mesh></object></resources><build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/></build></model>`;
  // white, black, red, blue, GREY — grey ≈ white+black so it's the mixable one that should virtualise;
  // the others (esp. un-mixable white) must stay physical. (Mirrors the real Minion: white eyes kept,
  // grey goggle rendered as a mix — not white dropped and printed grey.)
  const f = file3mf({
    "Metadata/project_settings.config": project({ filament_colour: ["#FFFFFF", "#000000", "#FF0000", "#0000FF", "#808080"] }),
    "3D/3dmodel.model": m,
  });
  const r = await cleanThreeMF(f, "u1", { mode: "preserve", fullSpectrum: true });
  const mixes = r.diff!.fullSpectrumMixes;
  assert.ok(mixes >= 1, "grey virtualised as a mix of the 4 physical");
  const e = unzipSync(new Uint8Array(await r.blob.arrayBuffer()));
  const c = JSON.parse(strFromU8(Object.entries(e).find(([p]) => p.toLowerCase().endsWith("project_settings.config"))![1]));
  const phys = (c.filament_colour as string[]).map((h) => h.toUpperCase());
  assert.equal(phys.length, 4);
  assert.ok(phys.includes("#FFFFFF"), "un-mixable white kept physical (not dropped)");
  assert.ok(!phys.includes("#808080"), "mixable grey is the one virtualised");
  const defs = String(c.mixed_filament_definitions).split(";");
  assert.equal(defs.length, mixes);
  for (const d of defs) {
    const [a, b, , , mixB] = d.split(",").map(Number);
    assert.ok(a >= 1 && a <= 4 && b >= 1 && b <= 4 && a !== b, "genuine 2-component mix");
    assert.ok(mixB > 8 && mixB < 92, "a real blend, not a near-duplicate of a physical"); // no dup-colour filament
  }
  assert.equal(c.mixed_filament_region_collapse, "1"); // dithering defaults written
});
test("Full Spectrum: manual mix override is used instead of bestMix", async () => {
  const codes = ["4", "8", "0C", "1C", "2C"];
  const tris = codes.map((c) => `<triangle v1="0" v2="1" v3="2" paint_color="${c}"/>`).join("");
  const verts = `<vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices>`;
  const m = `<?xml version="1.0"?><model><resources><object id="1"><mesh>${verts}<triangles>${tris}</triangles></mesh></object></resources><build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/></build></model>`;
  const f = file3mf({
    "Metadata/project_settings.config": project({ filament_colour: ["#FF0000", "#00FF00", "#0000FF", "#FFFF00", "#FF00FF"] }),
    "3D/3dmodel.model": m,
  });
  // physical = first 4; override colour index 4 (magenta) to a 30% mix of physical 2+3
  const r = await cleanThreeMF(f, "u1", { mode: "preserve", fullSpectrum: true, physical: [0, 1, 2, 3], mixes: { 4: { a: 2, b: 3, mixBPercent: 30 } } });
  const e = unzipSync(new Uint8Array(await r.blob.arrayBuffer()));
  const c = JSON.parse(strFromU8(Object.entries(e).find(([p]) => p.toLowerCase().endsWith("project_settings.config"))![1]));
  const [a, b, , , mixB] = String(c.mixed_filament_definitions).split(";")[0].split(",").map(Number);
  assert.deepEqual([a, b, mixB], [2, 3, 30]); // our override, not bestMix's choice
});
test("pluggable target: a custom machine flows through (name + profile)", async () => {
  // Derive a fake machine from U1 with a different name + reference value, to prove opts.machine is used.
  const fake: Machine = {
    ...U1,
    name: "Test Printer X",
    profile: { ...U1.profile, printer_settings_id: "Test Printer X", wipe_tower_wall_type: "rectangle" },
  };
  const f = file3mf({ "Metadata/project_settings.config": project({ wipe_tower_wall_type: "rib" }), "3D/3dmodel.model": model() });
  const r = await cleanThreeMF(f, "u1", { mode: "stamp", machine: fake });
  const c = await cfgOf(r.blob);
  assert.equal(r.diff?.printerTo, "Test Printer X"); // name came from the machine
  assert.equal(c.wipe_tower_wall_type, "rectangle"); // tower-safety pulled from the machine's profile
  assert.equal(c.printer_settings_id, "Test Printer X");
});
test("analyze: >4 painted file is detected as painted", async () => {
  const f = file3mf({
    "Metadata/project_settings.config": project({ filament_colour: ["#1", "#2", "#3", "#4", "#5"] }),
    "3D/3dmodel.model": model(`<x paint_color="4"/>`),
  });
  const a = await analyzeThreeMF(f);
  assert.equal(a.painted, true);
  assert.equal(a.encoding, "painted");
});

// ---------- part / plate splitting ----------
const MULTI_PLATE = (() => {
  const tri = `<mesh><vertices><vertex x="0" y="0" z="0"/></vertices><triangles><triangle v1="0" v2="0" v3="0"/></triangles></mesh>`;
  const main =
    `<?xml version="1.0"?><model><resources>` +
    `<object id="2">${tri}</object><object id="4">${tri}</object><object id="6">${tri}</object>` +
    `</resources><build>` +
    `<item objectid="2" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>` +
    `<item objectid="4" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>` +
    `<item objectid="6" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>` +
    `</build></model>`;
  const ms =
    `<?xml version="1.0"?><config>` +
    `<object id="2"><metadata key="name" value="a"/></object><object id="4"><metadata key="name" value="b"/></object><object id="6"><metadata key="name" value="c"/></object>` +
    `<plate><metadata key="plater_id" value="1"/><metadata key="thumbnail_file" value="Metadata/plate_1.png"/><model_instance><metadata key="object_id" value="2"/></model_instance></plate>` +
    `<plate><metadata key="plater_id" value="2"/><model_instance><metadata key="object_id" value="4"/></model_instance><model_instance><metadata key="object_id" value="6"/></model_instance></plate>` +
    `<assemble><assemble_item object_id="2" instance_id="0"/><assemble_item object_id="4" instance_id="0"/><assemble_item object_id="6" instance_id="0"/></assemble>` +
    `</config>`;
  return new Uint8Array(
    zipSync({
      "Metadata/model_settings.config": strToU8(ms),
      "Metadata/plate_1.png": strToU8("x"),
      "Metadata/plate_2.png": strToU8("x"),
      "3D/3dmodel.model": strToU8(main),
    }),
  );
})();
const ms = (b: Uint8Array) => strFromU8(unzipSync(b)["Metadata/model_settings.config"]);
const buildIds = (b: Uint8Array) =>
  [...strFromU8(unzipSync(b)["3D/3dmodel.model"]).matchAll(/<item\b[^>]*objectid="(\d+)"/g)].map((m) => +m[1]);
const plateGroups = (b: Uint8Array) =>
  [...ms(b).matchAll(/<plate>([\s\S]*?)<\/plate>/g)].map((p) => [...p[1].matchAll(/object_id" value="(\d+)"/g)].map((m) => +m[1]));
const assembleIds = (b: Uint8Array) => [...(ms(b).match(/<assemble>[\s\S]*?<\/assemble>/)?.[0] ?? "").matchAll(/object_id="(\d+)"/g)].map((m) => +m[1]);
const settingObjIds = (b: Uint8Array) => [...ms(b).matchAll(/<object id="(\d+)"/g)].map((m) => +m[1]);

test("subsetThreeMF keeps only the chosen build items + prunes plates/assemble/objects", () => {
  const sub = subsetThreeMF(MULTI_PLATE, new Set([4, 6]));
  assert.deepEqual(buildIds(sub), [4, 6]); // object 2 dropped from <build>
  assert.deepEqual(plateGroups(sub), [[4, 6]]); // plate 1 (object 2) removed entirely
  assert.deepEqual(assembleIds(sub), [4, 6]); // dangling assemble item for object 2 removed (would reject the file)
  assert.deepEqual(settingObjIds(sub), [4, 6]); // orphan object-settings pruned (ids align with build)
  assert.ok(!Object.keys(unzipSync(sub)).some((n) => /plate_\d+\.png/.test(n))); // stale plate artifacts dropped
});

test("subsetThreeMF re-centers the kept part via translateXY (off-bed → on-bed)", () => {
  const off = (() => {
    const tri = `<mesh><vertices><vertex x="0" y="0" z="0"/></vertices><triangles><triangle v1="0" v2="0" v3="0"/></triangles></mesh>`;
    const main =
      `<?xml version="1.0"?><model><resources><object id="4">${tri}</object></resources>` +
      `<build><item objectid="4" transform="1 0 0 0 1 0 0 0 1 480 60 5"/></build></model>`; // off-bed plate-2 spot
    return new Uint8Array(zipSync({ "3D/3dmodel.model": strToU8(main) }));
  })();
  const sub = subsetThreeMF(off, new Set([4]), [135 - 480, 135 - 60]); // shift so x,y → 135
  const item = strFromU8(unzipSync(sub)["3D/3dmodel.model"]).match(/<item\b[^>]*\/>/)![0];
  const t = /transform="([^"]*)"/.exec(item)![1].split(/\s+/).map(Number);
  assert.equal(t[9], 135); // tx recentered
  assert.equal(t[10], 135); // ty recentered
  assert.equal(t[11], 5); // tz untouched
});

test("subsetThreeMF to a single object yields one build item on one plate", () => {
  const sub = subsetThreeMF(MULTI_PLATE, new Set([2]));
  assert.deepEqual(buildIds(sub), [2]);
  assert.deepEqual(plateGroups(sub), [[2]]);
  assert.deepEqual(assembleIds(sub), [2]); // assemble reduced to just object 2
});

test("reordering ≤4 slots on an object-coloured file remaps the extruder refs (plates keep colour)", () => {
  // 2 objects, one colour each (obj1=red/ext1, obj2=green/ext2) — the multi-plate "one colour per
  // plate" shape, with only 2 colours so the >4 reduction never runs.
  const twoObj =
    `<?xml version="1.0"?><model><resources><object id="1"><mesh>${MESH}</mesh></object>` +
    `<object id="2"><mesh>${MESH}</mesh></object></resources>` +
    `<build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 100 100 0"/><item objectid="2" transform="1 0 0 0 1 0 0 0 1 150 150 0"/></build></model>`;
  const modelSettings =
    `<?xml version="1.0"?><config><object id="1"><metadata key="extruder" value="1"/></object>` +
    `<object id="2"><metadata key="extruder" value="2"/></object></config>`;
  const entries = {
    "Metadata/project_settings.config": project({ filament_colour: ["#FF0000", "#00FF00"], filament_type: ["PLA", "PLA"] }),
    "3D/3dmodel.model": twoObj,
    "Metadata/model_settings.config": modelSettings,
  };
  const extrOf = (b: Uint8Array, id: number) =>
    new RegExp(`<object id="${id}">[\\s\\S]*?key="extruder"\\s+value="(\\d+)"`).exec(ms(b))?.[1];

  // Reorder: swap the two slots (green→slot0, red→slot1); the UI's moveSlot remaps assign to [1,0].
  return cleanThreeMF(file3mf(entries), "u1", { mode: "preserve", slots: ["#00FF00", "#FF0000"], assign: [1, 0] }).then(async (r) => {
    assert.equal(r.reduced, true, "non-identity assign triggers an extruder remap");
    const b = new Uint8Array(await r.blob.arrayBuffer());
    const cfg = JSON.parse(strFromU8(unzipSync(b)["Metadata/project_settings.config"]));
    assert.deepEqual((cfg.filament_colour as string[]).slice(0, 2), ["#00FF00", "#FF0000"]);
    // obj1 (was red) must now point at slot 2 (#FF0000); obj2 (was green) at slot 1 (#00FF00) → colours unchanged
    assert.equal(extrOf(b, 1), "2", "obj1 extruder remapped to keep red");
    assert.equal(extrOf(b, 2), "1", "obj2 extruder remapped to keep green");
  });
});

test("editing ≤4 slot VALUES in place (identity assign) does NOT remap extruders", () => {
  const twoObj =
    `<?xml version="1.0"?><model><resources><object id="1"><mesh>${MESH}</mesh></object>` +
    `<object id="2"><mesh>${MESH}</mesh></object></resources>` +
    `<build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 100 100 0"/><item objectid="2" transform="1 0 0 0 1 0 0 0 1 150 150 0"/></build></model>`;
  const modelSettings =
    `<?xml version="1.0"?><config><object id="1"><metadata key="extruder" value="1"/></object>` +
    `<object id="2"><metadata key="extruder" value="2"/></object></config>`;
  const entries = {
    "Metadata/project_settings.config": project({ filament_colour: ["#FF0000", "#00FF00"], filament_type: ["PLA", "PLA"] }),
    "3D/3dmodel.model": twoObj,
    "Metadata/model_settings.config": modelSettings,
  };
  const extrOf = (b: Uint8Array, id: number) =>
    new RegExp(`<object id="${id}">[\\s\\S]*?key="extruder"\\s+value="(\\d+)"`).exec(ms(b))?.[1];
  return cleanThreeMF(file3mf(entries), "u1", { mode: "preserve", slots: ["#123456", "#ABCDEF"], assign: [0, 1] }).then(async (r) => {
    const b = new Uint8Array(await r.blob.arrayBuffer());
    assert.equal(extrOf(b, 1), "1", "identity assign leaves obj1 extruder untouched");
    assert.equal(extrOf(b, 2), "2", "identity assign leaves obj2 extruder untouched");
  });
});

test("subsetThreeMF renumbers a surviving plate to 1 (no phantom empty plate)", () => {
  // objects 4 & 6 live on plate 2; isolating them must renumber that plate to 1
  const sub = subsetThreeMF(MULTI_PLATE, new Set([4, 6]));
  const plateIds = [...ms(sub).matchAll(/key="plater_id" value="(\d+)"/g)].map((m) => +m[1]);
  assert.deepEqual(plateIds, [1]); // single surviving plate, renumbered from 2 → 1
});

test("reassignPlates puts each group on its own plate (geometry untouched)", () => {
  const multi = reassignPlates(MULTI_PLATE, [[2], [4], [6]]);
  assert.deepEqual(buildIds(multi), [2, 4, 6]); // all parts still placed
  assert.deepEqual(plateGroups(multi), [[2], [4], [6]]); // three single-object plates
});

// ---------- foreign-producer trust (Snapmaker Orca m_is_bbl_3mf whitelist) ----------
// Orca loads "geometry data only" (colours dropped) unless the <metadata name="Application">
// producer string starts with BambuStudio-/OrcaSlicer-. Converted files must be rewritten.
async function modelOf(blob: Blob): Promise<string> {
  const e = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const m = Object.entries(e).find(([p]) => p.toLowerCase().endsWith("3dmodel.model")) ??
    Object.entries(e).find(([p]) => p.toLowerCase().endsWith(".model"));
  return m ? strFromU8(m[1]) : "";
}
function pathsOf(blob: Blob): Promise<string[]> {
  return blob.arrayBuffer().then((b) => Object.keys(unzipSync(new Uint8Array(b))));
}
const appOf = (xml: string) => /<metadata name="Application">([^<]*)<\/metadata>/.exec(xml)?.[1] ?? null;
const modelWithApp = (app: string) =>
  `<?xml version="1.0"?><model><metadata name="Application">${app}</metadata><resources><object id="1"><mesh>${MESH}</mesh></object></resources><build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 128 128 0"/></build></model>`;

test("foreign producer (PrusaSlicer) Application string is rewritten to OrcaSlicer-", async () => {
  const f = file3mf({ "3D/3dmodel.model": modelWithApp("PrusaSlicer-2.7.1+win64"), "Metadata/project_settings.config": project() });
  const r = await cleanThreeMF(f, "u1");
  assert.ok(appOf(await modelOf(r.blob))?.startsWith("OrcaSlicer-"));
});

test("foreign producer (Creality_Print) Application string is rewritten to OrcaSlicer-", async () => {
  const f = file3mf({ "3D/3dmodel.model": modelWithApp("Creality_Print V6.0.0.75 Alpha"), "Metadata/project_settings.config": project() });
  const r = await cleanThreeMF(f, "u1");
  assert.ok(appOf(await modelOf(r.blob))?.startsWith("OrcaSlicer-"));
});

test("native OrcaSlicer/Bambu producer is left untouched", async () => {
  for (const app of ["OrcaSlicer-2.1.1", "BambuStudio-01.09.00", "SnapmakerOrca-1.0.0"]) {
    const f = file3mf({ "3D/3dmodel.model": modelWithApp(app), "Metadata/project_settings.config": project() });
    const r = await cleanThreeMF(f, "u1");
    assert.equal(appOf(await modelOf(r.blob)), app);
  }
});

test("Creality vendor marker (creality.config) is stripped", async () => {
  const f = file3mf({
    "3D/3dmodel.model": modelWithApp("Creality_Print V6.0.0 Alpha"),
    "Metadata/project_settings.config": project(),
    "Metadata/creality.config": `<config><metadata key="Application" value="Creality_Print"/></config>`,
  });
  const r = await cleanThreeMF(f, "u1");
  assert.ok(!(await pathsOf(r.blob)).some((p) => /creality\.config$/i.test(p)));
});

test("rewriting the producer preserves paint_color data", async () => {
  const painted = `<?xml version="1.0"?><model><metadata name="Application">Creality_Print V6.0.0 Alpha</metadata><resources><object id="1"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2" paint_color="4"/></triangles></mesh></object></resources><build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 128 128 0"/></build></model>`;
  const f = file3mf({ "3D/3dmodel.model": painted, "Metadata/project_settings.config": project() });
  const r = await cleanThreeMF(f, "u1");
  const m = await modelOf(r.blob);
  assert.ok(appOf(m)?.startsWith("OrcaSlicer-"));
  assert.ok(m.includes('paint_color="4"'));
});

// ---------- Full Spectrum on Prusa (no project_settings.config) ----------
// Prusa files carry their palette in Slic3r_PE.config, not project_settings.config. Full Spectrum
// must still engage for >4-colour Prusa files (regression: it was gated on srcCfg and silently
// fell through to reduce-to-4, dropping the 5th colour).
test("Full Spectrum engages for a >4-colour Prusa file (no project_settings.config)", async () => {
  const { encodeSolidPaint } = await import("./paint.ts");
  const tris = [1, 2, 3, 4, 5].map((i) => `<triangle v1="0" v2="1" v3="2" slic3rpe:mmu_segmentation="${encodeSolidPaint(i)}"/>`).join("");
  const model5 = `<?xml version="1.0"?><model xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06"><metadata name="Application">PrusaSlicer-2.7.1</metadata><resources><object id="1"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles>${tris}</triangles></mesh></object></resources><build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 128 128 0"/></build></model>`;
  const f = file3mf({
    "3D/3dmodel.model": model5,
    "Metadata/Slic3r_PE.config": `; \nfilament_colour = #FFFFFF;#000000;#FF0000;#0000FF;#808080\nfilament_type = PLA;PLA;PLA;PLA;PLA\n`,
  });
  const r = await cleanThreeMF(f, "u1", { fullSpectrum: true });
  const cfg = await cfgOf(r.blob);
  const phys = (cfg.filament_colour as string[]).map((h) => h.toUpperCase());
  assert.equal(phys.length, 4, "4 physical colours kept");
  assert.ok(phys.includes("#FFFFFF") && !phys.includes("#808080"), "white kept, mixable grey virtualised");
  assert.ok(cfg.mixed_filament_definitions && String(cfg.mixed_filament_definitions).trim(), "mixed_filament_definitions written");
  assert.ok((r.diff?.fullSpectrumMixes ?? 0) >= 1, "at least one virtual mix generated for the 5th colour");
  assert.equal(r.colorsTotal, 5);
});

test("mixedLayerHeight re-slices the mixed zones via dithering_z_step_size", async () => {
  const { encodeSolidPaint } = await import("./paint.ts");
  const tris = [1, 2, 3, 4, 5].map((i) => `<triangle v1="0" v2="1" v3="2" slic3rpe:mmu_segmentation="${encodeSolidPaint(i)}"/>`).join("");
  const model5 = `<?xml version="1.0"?><model xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06"><resources><object id="1"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles>${tris}</triangles></mesh></object></resources><build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 128 128 0"/></build></model>`;
  const f = file3mf({
    "3D/3dmodel.model": model5,
    "Metadata/Slic3r_PE.config": `; \nfilament_colour = #FFFFFF;#000000;#FF0000;#0000FF;#808080\n`, // grey virtualises → mix present
  });
  // explicit height re-slices the painted mixed zones via dithering_z_step_size (the only key that
  // actually changes the slice; Local-Z must stay off for that path to apply)
  const pinned = await cfgOf((await cleanThreeMF(f, "u1", { fullSpectrum: true, mixedLayerHeight: 0.08 })).blob);
  assert.equal(pinned.dithering_z_step_size, "0.08");
  assert.equal(pinned.dithering_step_painted_zones_only, "1");
  // forcing a fixed height switches OFF the adaptive Subdivide Mix Layer (Local-Z) pipeline — mutually exclusive
  assert.equal(pinned.dithering_local_z_mode, "0");
  assert.equal(pinned.dithering_local_z_infill, "0");
  // 0 / omitted = Auto: z-step stays off (normal layer height in the mix), and Subdivide Mix Layer is
  // ON by default (Orca's dithering_local_z_mode) for cleaner mixes — verified to help on a real print.
  const auto = await cfgOf((await cleanThreeMF(f, "u1", { fullSpectrum: true, mixedLayerHeight: 0 })).blob);
  assert.equal(auto.dithering_z_step_size, "0");
  assert.equal(auto.dithering_local_z_mode, "1");
  assert.equal(auto.dithering_local_z_infill, "1");
  // mixed-zone support clearance floored at 0.35 so supports peel off painted/mixed features cleanly
  assert.ok(parseFloat(String(auto.support_top_z_distance)) >= 0.35, "FS support top gap floored at 0.35");
  // Orca only re-applies project overrides listed in different_settings_to_system when print_settings_id
  // names a system preset — otherwise our support/dithering/purge keys revert to stock on import.
  const dss = auto.different_settings_to_system as string[];
  assert.ok(Array.isArray(dss) && dss.length >= 3, "different_settings_to_system is a per-section array");
  const printDiffs = (dss[0] ?? "").split(";");
  for (const k of ["dithering_local_z_mode", "support_top_z_distance", "flush_into_support", "mixed_filament_definitions"])
    assert.ok(printDiffs.includes(k), `${k} declared as a system override so Orca keeps it`);
  assert.ok(!printDiffs.includes("purge_in_prime_tower"), "no SEMM-only purge_in_prime_tower (force-disabled on U1)");

  // Subdivide Mix Layer defaults on; opts.subdivide=false turns it (and infill subdivision) off.
  const off = await cfgOf((await cleanThreeMF(f, "u1", { fullSpectrum: true, subdivide: false })).blob);
  assert.equal(off.dithering_local_z_mode, "0", "subdivide:false disables Subdivide Mix Layer");
  assert.equal(off.dithering_local_z_infill, "0", "subdivide:false disables infill subdivision");
});

test("bestPhysicalSet: keeps un-mixable colours, virtualises the mixable one (no duplicate filament)", () => {
  // The Minion bug: white (eyes) + grey (goggles) among 5. Grey ≈ white+black is mixable; white is not.
  // Picking by usage alone dropped white → white printed grey AND a filament that duplicated grey.
  const palette = ["#F6FFF2", "#FFE700", "#000000", "#0000FF", "#A4A0AC"]; // white,yellow,black,blue,grey
  // grey barely painted, but it must still be the one dropped (it's the only mixable one).
  const usage = [3, 9, 9, 3, 1];
  const phys = bestPhysicalSet(palette, usage);
  assert.equal(phys.length, 4);
  const keptHex = phys.map((i) => palette[i]);
  assert.ok(keptHex.includes("#F6FFF2"), "white (un-mixable) kept physical");
  assert.ok(!keptHex.includes("#A4A0AC"), "grey (mixable ≈ white+black) virtualised");

  // pinned base is never dropped, even if it's the most mixable colour present.
  const pinnedGrey = bestPhysicalSet(palette, usage, [4]); // pin grey
  assert.ok(pinnedGrey.map((i) => palette[i]).includes("#A4A0AC"), "pinned colour stays physical");

  // ≤4 colours: everything kept, ordered by usage.
  assert.deepEqual(bestPhysicalSet(["#111111", "#222222"], [1, 5]), [1, 0]);
});

test("Custom-palette Full Spectrum: reproduces a ≤4-color model as mixes of the user's filaments (CMYK)", async () => {
  const { encodeSolidPaint } = await import("./paint.ts");
  const tris = [1, 2, 3].map((i) => `<triangle v1="0" v2="1" v3="2" paint_color="${encodeSolidPaint(i)}"/>`).join("");
  const m = `<?xml version="1.0"?><model><resources><object id="1"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles>${tris}</triangles></mesh></object></resources><build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/></build></model>`;
  // 3 painted colors (orange/green/purple), reproduced from a CMYK base — normal FS wouldn't even offer here.
  const f = file3mf({ "Metadata/project_settings.config": project({ filament_colour: ["#E86A17", "#2FA84F", "#8E44AD"] }), "3D/3dmodel.model": m });
  const CMYK = ["#29ABE2", "#ED1E79", "#FCEE21", "#111111"];
  const r = await cleanThreeMF(f, "u1", { fullSpectrum: true, customPhysical: CMYK });
  assert.ok((r.diff?.fullSpectrumMixes ?? 0) >= 1, "colors become mixes of the custom base");
  const cfg = await cfgOf(r.blob);
  assert.deepEqual((cfg.filament_colour as string[]).map((h) => h.toUpperCase()), CMYK, "filament_colour = the user's CMYK base");
  for (const d of String(cfg.mixed_filament_definitions).split(";").filter(Boolean)) {
    const [a, b] = d.split(",").map(Number);
    assert.ok(a >= 1 && a <= 4 && b >= 1 && b <= 4, "mix components reference the 4 base filaments");
  }
});

test("Custom-palette FS: hard colors use a 3-filament (gradient) mix — g<ids> + w<weights> + m0", async () => {
  const { encodeSolidPaint } = await import("./paint.ts");
  const tris = [1, 2].map((i) => `<triangle v1="0" v2="1" v3="2" paint_color="${encodeSolidPaint(i)}"/>`).join("");
  const m = `<?xml version="1.0"?><model><resources><object id="1"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles>${tris}</triangles></mesh></object></resources><build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/></build></model>`;
  // brown + olive — not reachable well with any 2 of CMYK, so they should go 3-way.
  const f = file3mf({ "Metadata/project_settings.config": project({ filament_colour: ["#6B4423", "#808000"] }), "3D/3dmodel.model": m });
  const r = await cleanThreeMF(f, "u1", { fullSpectrum: true, customPhysical: ["#29ABE2", "#ED1E79", "#FCEE21", "#111111"] });
  const cfg = await cfgOf(r.blob);
  const defs = String(cfg.mixed_filament_definitions).split(";").filter(Boolean);
  const threeWay = defs.filter((d) => /,g\d{3},w\d+\/\d+\/\d+,m0,/.test(d));
  assert.ok(threeWay.length >= 1, "at least one 3-filament gradient mix (g<3 ids>, w<3 weights>, m0)");
  for (const d of threeWay) {
    const g = /,g(\d{3}),/.exec(d)![1];
    const w = /,w(\d+\/\d+\/\d+),/.exec(d)![1].split("/").map(Number);
    assert.ok([...g].every((c) => +c >= 1 && +c <= 4), "gradient ids are valid filament slots");
    assert.equal(w.reduce((a, b) => a + b, 0), 100, "weights sum to 100");
  }
});

test("Full Spectrum: physical order controls filament_colour (slot) order", async () => {
  const { encodeSolidPaint } = await import("./paint.ts");
  const tris = [1, 2, 3, 4, 5].map((i) => `<triangle v1="0" v2="1" v3="2" paint_color="${encodeSolidPaint(i)}"/>`).join("");
  const m = `<?xml version="1.0"?><model><resources><object id="1"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles>${tris}</triangles></mesh></object></resources><build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 128 128 0"/></build></model>`;
  const f = () => file3mf({ "3D/3dmodel.model": m, "Metadata/project_settings.config": project({ filament_colour: ["#FF0000", "#00FF00", "#0000FF", "#FFFF00", "#FF00FF"], filament_type: ["PLA", "PLA", "PLA", "PLA", "PLA"] }) });
  const a = await cfgOf((await cleanThreeMF(f(), "u1", { fullSpectrum: true, physical: [0, 1, 2, 3] })).blob);
  const b = await cfgOf((await cleanThreeMF(f(), "u1", { fullSpectrum: true, physical: [1, 0, 2, 3] })).blob);
  assert.deepEqual(a.filament_colour, ["#FF0000", "#00FF00", "#0000FF", "#FFFF00"]);
  assert.deepEqual(b.filament_colour, ["#00FF00", "#FF0000", "#0000FF", "#FFFF00"]); // slots 1&2 swapped
});

// ---------- band-swap (painted, vertically colour-banded → manual M600 filament swaps) ----------
// 5 vertical wall triangles stacked in Z, each painted a clean band (states 1..5). Convert with
// bandSwap: colours 1-4 ride the 4 heads; colour 5 shares head 1 with an M600 pause at its band.
function bandedPaintedFile(): File {
  const verts: string[] = [];
  const tris: string[] = [];
  for (let k = 0; k < 5; k++) {
    const z0 = k * 4, z1 = z0 + 4, base = k * 3;
    verts.push(`<vertex x="0" y="0" z="${z0}"/>`, `<vertex x="1" y="0" z="${z0}"/>`, `<vertex x="0" y="0" z="${z1}"/>`);
    tris.push(`<triangle v1="${base}" v2="${base + 1}" v3="${base + 2}" paint_color="${encodeSolidPaint(k + 1)}"/>`);
  }
  const mesh = `<vertices>${verts.join("")}</vertices><triangles>${tris.join("")}</triangles>`;
  const mdl = `<?xml version="1.0"?><model><resources><object id="1"><mesh>${mesh}</mesh></object></resources><build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 128 128 0"/></build></model>`;
  return file3mf({
    "Metadata/project_settings.config": project({
      filament_colour: ["#ff0000", "#00ff00", "#0000ff", "#ffff00", "#ff00ff"],
      filament_type: ["PLA", "PLA", "PLA", "PLA", "PLA"],
      layer_height: "0.2",
    }),
    "3D/3dmodel.model": mdl,
  });
}

test("analyze: painted banded file exposes a banded bandPlan", async () => {
  const a = await analyzeThreeMF(bandedPaintedFile());
  assert.equal(a.painted, true);
  assert.ok(a.bandPlan?.banded, "should detect clean vertical banding");
  assert.equal(a.bandPlan?.colorCount, 5);
  assert.equal(a.bandPlan?.manualSwaps, 1);
});

test("band-swap convert: adds one M600 pause + flattens paint onto 4 heads", async () => {
  const r = await cleanThreeMF(bandedPaintedFile(), "u1", { mode: "preserve", bandSwap: true });
  assert.equal(r.swaps.length, 1);
  assert.equal(r.swaps[0].toColour, "#ff00ff"); // the 5th colour is the one you swap in
  const e = unzipSync(new Uint8Array(await r.blob.arrayBuffer()));
  const cg = Object.entries(e).find(([p]) => p.toLowerCase().endsWith("custom_gcode_per_layer.xml"));
  assert.ok(cg, "custom_gcode_per_layer.xml was added");
  assert.match(strFromU8(cg![1]), /type="1"[^>]*gcode="M600"/);
  assert.match(strFromU8(cg![1]), /top_z="15\.8"/); // band 5 starts at z=16, pause one layer below
  // Every painted face now maps to a head ≤ 4 (colour 5 folded onto head 1).
  const model = Object.entries(e).find(([p]) => p.toLowerCase().endsWith(".model"))!;
  const states = [...strFromU8(model[1]).matchAll(/paint_color="([0-9A-Fa-f]+)"/g)].map((m) => dominantState(m[1]));
  assert.ok(Math.max(...states) <= 4, `all paint states flattened to ≤4 heads (got ${states})`);
});

test("band-swap is opt-in: without bandSwap, a banded painted >4 file is NOT band-swapped", async () => {
  const r = await cleanThreeMF(bandedPaintedFile(), "u1", { mode: "preserve" });
  assert.equal(r.swaps.length, 0);
});

// ---------- STL → 3MF (plain-STL import) ----------
// Build a minimal binary STL (80-byte header + uint32 count + 50 bytes/triangle) in memory.
function binaryStl(tris: number[][][]): Uint8Array {
  const buf = new ArrayBuffer(84 + tris.length * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, tris.length, true); // triangle count; normals left as 0 (slicers recompute them)
  let off = 84;
  for (const tri of tris) {
    off += 12; // skip the facet normal
    for (const p of tri) {
      dv.setFloat32(off, p[0], true);
      dv.setFloat32(off + 4, p[1], true);
      dv.setFloat32(off + 8, p[2], true);
      off += 12;
    }
    off += 2; // 2-byte attribute
  }
  return new Uint8Array(buf);
}

test("parseStl: reads a binary STL's triangle count + vertex positions", () => {
  const pos = parseStl(binaryStl([[[0, 0, 0], [1, 0, 0], [0, 1, 0]]]));
  assert.equal(pos.length, 9); // one triangle = 9 floats
  assert.deepEqual([...pos], [0, 0, 0, 1, 0, 0, 0, 1, 0]);
});

test("stlTo3MF: wraps a binary STL cube into a valid core-spec 3MF (deduped verts)", () => {
  // Unit cube: 8 unique vertices, 12 triangles.
  const v = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
  const faces = [
    [0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6], [0, 5, 1], [0, 4, 5],
    [1, 6, 2], [1, 5, 6], [2, 7, 3], [2, 6, 7], [3, 4, 0], [3, 7, 4],
  ];
  const stl = binaryStl(faces.map((f) => f.map((i) => v[i])));
  assert.equal(parseStl(stl).length / 9, 12); // 12 triangles parsed

  const e = unzipSync(stlTo3MF(stl, "cube"));
  const paths = Object.keys(e);
  assert.ok(paths.includes("[Content_Types].xml"));
  assert.ok(paths.includes("_rels/.rels"));
  assert.ok(paths.includes("3D/3dmodel.model"));
  const xml = strFromU8(e["3D/3dmodel.model"]);
  assert.equal([...xml.matchAll(/<triangle\b/g)].length, 12); // all faces kept
  assert.equal([...xml.matchAll(/<vertex\b/g)].length, 8); // vertices deduped to 8 unique
  assert.match(xml, /3dmanufacturing\/core\/2015\/02/); // core-spec namespace
});

test("parseStl: ASCII STL parses to the same triangle", () => {
  const ascii = `solid t
facet normal 0 0 0
 outer loop
  vertex 0 0 0
  vertex 1 0 0
  vertex 0 1 0
 endloop
endfacet
endsolid t`;
  const pos = parseStl(new TextEncoder().encode(ascii));
  assert.equal(pos.length, 9);
  assert.deepEqual([...pos], [0, 0, 0, 1, 0, 0, 0, 1, 0]);
});

// ---------- detectProfile ----------
// This is the gate the whole trust chain hangs on: /api/verify-design and /api/admin/attach-profile
// both set `verified` from it, and the /verified wall claims verification can't be granted by hand.
// It had no coverage at all.
test("detectProfile: a Bambu project is detected as a foreign, non-U1 profile", async () => {
  const f = file3mf({ "Metadata/project_settings.config": project({ printer_model: "Bambu Lab P1S" }), "3D/3dmodel.model": model() });
  const info = await detectProfile(f);
  assert.equal(info.hasProfile, true);
  assert.equal(info.isU1, false, "a Bambu file must never verify as U1");
  assert.equal(info.foreign, true);
});

test("detectProfile: a PrusaSlicer project is detected as foreign (INI config, not JSON)", async () => {
  const f = file3mf({ "Metadata/Slic3r_PE.config": "; printer_model = MK4\n", "3D/3dmodel.model": model() });
  const info = await detectProfile(f);
  assert.equal(info.hasProfile, true);
  assert.equal(info.isU1, false);
});

test("detectProfile: the converter's own U1 output verifies as U1 (the round-trip we promise)", async () => {
  // Convert a Bambu file to U1, then feed the RESULT back in — this is exactly the path a maker takes
  // before attaching a tested profile, so it has to come back isU1.
  const src = file3mf({ "Metadata/project_settings.config": project({ printer_model: "Bambu Lab P1S" }), "3D/3dmodel.model": model() });
  const out = await cleanThreeMF(src, "u1", { mode: "preserve" });
  const info = await detectProfile(new File([await out.blob.arrayBuffer()], "converted.3mf"));
  assert.equal(info.hasProfile, true);
  assert.equal(info.isU1, true, "our own U1 output must pass the U1 check");
  assert.equal(info.foreign, false);
});

test("detectProfile: geometry-only 3mf has no profile (so it can't be verified)", async () => {
  const f = file3mf({ "3D/3dmodel.model": model() });
  const info = await detectProfile(f);
  assert.equal(info.hasProfile, false);
  assert.equal(info.isU1, false);
});

test("detectProfile: a non-.3mf filename is rejected outright", async () => {
  const z = file3mf({ "Metadata/project_settings.config": project(), "3D/3dmodel.model": model() });
  const info = await detectProfile(new File([await z.arrayBuffer()], "notamodel.zip"));
  assert.equal(info.hasProfile, false);
});

// ---------- oversized files ----------
// A 228 MB multi-plate model reported as "Couldn't read that 3MF." — the size reason was computed
// and then thrown away by the UI. The error must carry the numbers so the page can explain itself.
test("safeUnzip: over the compressed cap throws a typed error carrying real numbers", () => {
  const big = new Uint8Array(201 * 1024 * 1024);
  try {
    safeUnzip(big);
    assert.fail("should have thrown");
  } catch (e) {
    assert.ok(e instanceof ThreeMFError, "must be a ThreeMFError, not a bare Error");
    assert.equal(e.code, "too_large");
    assert.equal(e.sizeMB, 201);
    assert.equal(e.capMB, 200);
  }
});

test("safeUnzip: a normal file is unaffected by the guard", () => {
  const z = file3mf({ "Metadata/project_settings.config": project(), "3D/3dmodel.model": model() });
  assert.ok(Object.keys(safeUnzip(new Uint8Array(zipSync({ "a.txt": strToU8("hi") })))).length >= 1);
  assert.ok(z instanceof File);
});

// A real 89 MB Luffy model holds ONE 707 MB object_1.model: under the 800 MB total cap, but past
// V8's max string length, so decoding threw "Cannot create a string longer than 0x1fffffe8
// characters" and the UI showed "Couldn't read that 3MF." Found by running 484 real files.
test("textEntryTooLarge: only text entries, only past V8's string limit", () => {
  assert.equal(textEntryTooLarge("3D/Objects/object_1.model", 707 * 1024 * 1024), true);
  assert.equal(textEntryTooLarge("Metadata/project_settings.config", MAX_TEXT_ENTRY + 1), true);
  assert.equal(textEntryTooLarge("3D/3dmodel.model", MAX_TEXT_ENTRY), false, "exactly at the limit is fine");
  assert.equal(textEntryTooLarge("3D/3dmodel.model", 10 * 1024 * 1024), false, "normal model");
  // Thumbnails are never stringified, so their size is irrelevant.
  assert.equal(textEntryTooLarge("Metadata/plate_1.png", 900 * 1024 * 1024), false);
});

// ---------- U1 nozzle variants + nozzle fit ----------
// The U1 ships in four nozzle sizes; we bundle a real export for one (0.4). These assert the other
// three are DERIVED from it by a rule that reproduces the reference exactly at 0.4 — the property that
// makes the derivation checkable against a profile somebody actually printed from.

test("u1NozzleVariant: 0.4 is the bundled export itself, and says it is tested", () => {
  assert.equal(u1NozzleVariant(0.4), U1, "0.4 must be the real export, not a derived copy");
  assert.equal(U1.testedProfile, true);
  // An unknown nozzle falls back to the tested profile rather than inventing one.
  assert.equal(u1NozzleVariant(0.3), U1);
  assert.equal(u1NozzleVariant(NaN), U1);
});

test("u1NozzleVariant: a derived variant carries that nozzle's identity and is flagged untested", () => {
  const m = u1NozzleVariant(0.2);
  const p = m.profile as Record<string, unknown>;
  assert.equal(m.nozzle, 0.2);
  assert.equal(m.testedProfile, false, "nobody has printed from this one");
  assert.equal(m.derivedFromNozzle, 0.4);
  // Identity — this is what Snapmaker Orca matches its own library preset on.
  assert.equal(p.printer_settings_id, "Snapmaker U1 (0.2 nozzle)");
  assert.equal(p.printer_variant, "0.2");
  assert.deepEqual(p.nozzle_diameter, ["0.2", "0.2", "0.2", "0.2"]);
  assert.equal(p.printer_model, "Snapmaker U1", "same printer, different nozzle");
  // The tested profile is untouched — a derived variant must never mutate the bundled export.
  assert.deepEqual((U1.profile as Record<string, unknown>).nozzle_diameter, ["0.4", "0.4", "0.4", "0.4"]);
});

test("u1NozzleVariant: nozzle-dependent values scale, nozzle-relative ones don't", () => {
  const half = u1NozzleVariant(0.2).profile as Record<string, unknown>;
  const twice = u1NozzleVariant(0.8).profile as Record<string, unknown>;
  const ref = U1.profile as Record<string, unknown>;
  // 0.42 line width on a 0.4 nozzle is 105% of it; that ratio is preserved at every size.
  assert.equal(half.line_width, "0.21");
  assert.equal(twice.line_width, "0.84");
  assert.equal(half.initial_layer_line_width, "0.25"); // 0.5 → half
  // Layer-height limits are the reference's own 20%/80% of nozzle.
  assert.deepEqual(half.max_layer_height, ["0.16", "0.16", "0.16", "0.16"]);
  assert.deepEqual(half.min_layer_height, ["0.04", "0.04", "0.04", "0.04"]);
  // Percentages are ALREADY nozzle-relative — scaling them would apply the ratio twice.
  assert.equal(half.skin_infill_line_width, ref.skin_infill_line_width);
  assert.equal(half.skeleton_infill_line_width, "100%");
  assert.equal(half.ramming_line_width_ratio, ref.ramming_line_width_ratio, "a ratio, not a width");
  // Everything not nozzle-dependent is carried over untouched.
  assert.equal(half.printable_area !== undefined && JSON.stringify(half.printable_area), JSON.stringify(ref.printable_area));
});

test("nozzle fit: a 0.6-nozzle source converted for the 0.4 U1 has its widths refitted", async () => {
  const z = file3mf({
    "Metadata/project_settings.config": project({
      nozzle_diameter: ["0.6", "0.6", "0.6", "0.6"],
      line_width: "0.63", outer_wall_line_width: "0.63", layer_height: "0.3",
    }),
    "3D/3dmodel.model": model(),
  });
  const r = await cleanThreeMF(z, "u1", { mode: "preserve" });
  const cfg = await cfgOf(r.blob);
  // The file already DECLARED a 0.4 nozzle (identity) — before this guard it also asked for 0.63 mm
  // extrusions out of it, which is the bug this test exists for.
  assert.deepEqual(cfg.nozzle_diameter, ["0.4", "0.4", "0.4", "0.4"]);
  assert.equal(cfg.line_width, "0.42");
  assert.equal(cfg.outer_wall_line_width, "0.42");
  assert.equal(cfg.layer_height, "0.2");
  const keys = (r.diff?.nozzleFit ?? []).map((f) => f.key);
  assert.ok(keys.includes("line_width") && keys.includes("layer_height"), "the change is reported, not silent");
});

test("nozzle fit: a matching nozzle changes nothing and reports nothing", async () => {
  const z = file3mf({
    "Metadata/project_settings.config": project({
      nozzle_diameter: ["0.4", "0.4", "0.4", "0.4"], line_width: "0.42", layer_height: "0.2",
    }),
    "3D/3dmodel.model": model(),
  });
  const r = await cleanThreeMF(z, "u1", { mode: "preserve" });
  const cfg = await cfgOf(r.blob);
  assert.equal(cfg.line_width, "0.42");
  assert.equal(cfg.layer_height, "0.2");
  assert.deepEqual(r.diff?.nozzleFit, [], "no-op for the overwhelmingly common case");
});

test("nozzle fit: layer height is held inside the target nozzle's band", async () => {
  // 0.55 mm layers on a 0.6 nozzle (92% — already aggressive). Scaled to a 0.4 nozzle that is 0.367,
  // past what a 0.4 can lay down, so it clamps to the reference's own ceiling of 80%.
  const z = file3mf({
    "Metadata/project_settings.config": project({
      nozzle_diameter: ["0.6", "0.6", "0.6", "0.6"], layer_height: "0.55",
    }),
    "3D/3dmodel.model": model(),
  });
  const cfg = await cfgOf((await cleanThreeMF(z, "u1", { mode: "preserve" })).blob);
  assert.equal(cfg.layer_height, "0.32");
});

test("nozzle fit: converting FOR a 0.2 nozzle writes that nozzle's identity and scales down", async () => {
  const z = file3mf({
    "Metadata/project_settings.config": project({
      nozzle_diameter: ["0.4", "0.4", "0.4", "0.4"], line_width: "0.42", layer_height: "0.2",
    }),
    "3D/3dmodel.model": model(),
  });
  const r = await cleanThreeMF(z, "u1", { mode: "preserve", machine: u1NozzleVariant(0.2) });
  const cfg = await cfgOf(r.blob);
  assert.equal(cfg.printer_settings_id, "Snapmaker U1 (0.2 nozzle)");
  assert.deepEqual(cfg.nozzle_diameter, ["0.2", "0.2", "0.2", "0.2"]);
  assert.equal(cfg.line_width, "0.21");
  assert.equal(cfg.layer_height, "0.1");
  assert.equal(r.diff?.untestedProfile, true, "the UI has to be able to say this one is not tested");
});

test("nozzle fit: a source that declares no nozzle is left alone", async () => {
  const z = file3mf({ "Metadata/project_settings.config": project({ line_width: "0.42" }), "3D/3dmodel.model": model() });
  const r = await cleanThreeMF(z, "u1", { mode: "preserve" });
  assert.equal((await cfgOf(r.blob)).line_width, "0.42");
  assert.deepEqual(r.diff?.nozzleFit, []);
});

// ---------- keep-all-colours pass-through ----------
// The one >4 mode that decides nothing for the user. Its whole contract is "nothing was renumbered",
// so these assert absence of change as much as presence of it.

const overFour = (extra: Record<string, unknown> = {}) =>
  file3mf({
    "Metadata/project_settings.config": project({
      filament_colour: ["#FF0000", "#00FF00", "#0000FF", "#FFFF00", "#FF00FF", "#00FFFF"],
      filament_type: ["PLA", "PLA", "PLA", "PETG", "PLA", "PLA"],
      ...extra,
    }),
    "3D/3dmodel.model": model(),
  });

test("keep all colours: every filament survives, in the author's order", async () => {
  const r = await cleanThreeMF(overFour(), "u1", { mode: "preserve", keepAllColours: true });
  const cfg = await cfgOf(r.blob);
  assert.deepEqual(cfg.filament_colour, ["#FF0000", "#00FF00", "#0000FF", "#FFFF00", "#FF00FF", "#00FFFF"]);
  assert.deepEqual(cfg.filament_type, ["PLA", "PLA", "PLA", "PETG", "PLA", "PLA"]);
  assert.equal(r.reduced, false, "nothing was merged");
  assert.equal(r.colorsKept, 6, "all six kept — the U1's 4 heads are not the ceiling in this mode");
  assert.equal(r.diff?.keptAllColours, 6);
  // Still a U1 file: identity is swapped even though the palette is untouched.
  assert.equal(cfg.printer_model, "Snapmaker U1");
});

test("keep all colours: off by default — the same file still reduces to 4", async () => {
  const r = await cleanThreeMF(overFour(), "u1", { mode: "preserve" });
  const cfg = await cfgOf(r.blob);
  assert.equal((cfg.filament_colour as string[]).length, 4);
  assert.equal(r.colorsKept, 4);
  assert.equal(r.diff?.keptAllColours, 0);
});

test("keep all colours: ignored when the file already fits the 4 heads", async () => {
  const z = file3mf({
    "Metadata/project_settings.config": project({ filament_colour: ["#FF0000", "#00FF00"], filament_type: ["PLA", "PLA"] }),
    "3D/3dmodel.model": model(),
  });
  const r = await cleanThreeMF(z, "u1", { mode: "preserve", keepAllColours: true });
  assert.equal(r.diff?.keptAllColours, 0, "nothing to pass through — this is the ordinary path");
  assert.equal((await cfgOf(r.blob)).printer_model, "Snapmaker U1");
});

test("keep all colours: no mixed-filament definitions are written", async () => {
  // Pass-through must not be mistaken for Full Spectrum. These keys exist in the U1 reference with
  // empty/off defaults, so the contract is that they stay at those defaults — not that they're absent.
  const ref = U1.profile as Record<string, unknown>;
  const cfg = await cfgOf((await cleanThreeMF(overFour(), "u1", { mode: "preserve", keepAllColours: true })).blob);
  assert.equal(cfg.mixed_filament_definitions, ref.mixed_filament_definitions);
  assert.equal(cfg.mixed_filament_definitions, "", "no mixes declared");
  assert.equal(cfg.dithering_local_z_mode, ref.dithering_local_z_mode);
});

// ---------- filament preset brand ----------
// Naming only: no print setting changes. It decides which library preset Orca resolves each slot to,
// which is what model repositories care about when they require Generic or vendor presets.

const branded = () =>
  file3mf({
    "Metadata/project_settings.config": project({
      filament_colour: ["#FF0000", "#00FF00", "#0000FF"],
      filament_type: ["PLA", "PETG", "PC"],
      filament_settings_id: ["Bambu PLA Basic", "Bambu PETG HF", "Bambu PC"],
    }),
    "3D/3dmodel.model": model(),
  });

test("filament brand: the author's preset names are kept by default", async () => {
  const r = await cleanThreeMF(branded(), "u1", { mode: "preserve" });
  const sid = (await cfgOf(r.blob)).filament_settings_id as string[];
  assert.deepEqual(sid.slice(0, 3), ["Bambu PLA Basic", "Bambu PETG HF", "Bambu PC"]);
  assert.equal(r.diff?.filamentBrand, null, "nothing was relabelled");
});

test("filament brand: generic relabels every slot to a universally-resolvable preset", async () => {
  const r = await cleanThreeMF(branded(), "u1", { mode: "preserve", filamentBrand: "generic" });
  const sid = (await cfgOf(r.blob)).filament_settings_id as string[];
  assert.deepEqual(sid.slice(0, 3), ["Generic PLA", "Generic PETG", "Generic PC"]);
  assert.equal(r.diff?.filamentBrand, "generic");
});

test("filament brand: snapmaker uses real presets and falls back where none exists", async () => {
  const sid = ((await cfgOf((await cleanThreeMF(branded(), "u1", { mode: "preserve", filamentBrand: "snapmaker" })).blob))
    .filament_settings_id) as string[];
  // PLA and PETG have Snapmaker presets in the U1 catalogue; PC does not.
  assert.deepEqual(sid.slice(0, 3), ["Snapmaker PLA", "Snapmaker PETG", "Generic PC"]);
});

test("filament brand: naming does not touch colours, types or any print setting", async () => {
  const plain = await cfgOf((await cleanThreeMF(branded(), "u1", { mode: "preserve" })).blob);
  const snap = await cfgOf((await cleanThreeMF(branded(), "u1", { mode: "preserve", filamentBrand: "snapmaker" })).blob);
  for (const k of Object.keys(plain)) {
    if (k === "filament_settings_id") continue;
    assert.deepEqual(snap[k], plain[k], `${k} must be identical — brand mode is a naming change only`);
  }
});

test("filamentPresetId: the mapping itself", () => {
  assert.equal(filamentPresetId("PLA", "snapmaker"), "Snapmaker PLA");
  assert.equal(filamentPresetId("PC", "snapmaker"), "Generic PC", "no Snapmaker PC preset exists");
  assert.equal(filamentPresetId("PETG", "generic"), "Generic PETG");
  assert.equal(filamentPresetId("PETG", "source", "Bambu PETG HF"), "Bambu PETG HF");
  assert.equal(filamentPresetId("PETG", "source"), "Generic PETG", "source with nothing to keep");
  assert.equal(filamentPresetId("", "generic"), "Generic PLA", "an empty type is not a preset name");
});
