#!/usr/bin/env node
// Slicer golden check: converter output through REAL slicers.
//
// Unit tests read our own output with our own parser, so they agree with whatever we wrote. Three
// classes of bug got past them in Nov 2026 and showed up the moment a real slicer opened the file:
//   - the HueForge U1 template carried ABS values under a "Generic PLA" label, so Snapmaker Orca
//     sliced every HueForge export at M104 S270 with a 90 °C bed (#100);
//   - PLA Orca filament profiles had no bed temperature, so the bed was 0 °C (#99) — the same
//     class of fault, and what the bed assertion below exists for;
//   - retarget bugs that changed a printer's extruder count or tool mapping (#102/#104/#106/#110).
//
// This builds a handful of outputs from synthetic fixtures through the real converter code
// (cleanThreeMF, imageToHueForgeU1 → buildU1_3mf, buildFlatU1_3mf), slices each with the Snapmaker
// Orca CLI (and PrusaSlicer for Prusa retargets), and asserts on the G-code:
//   - the slicer exits 0 and prints no "Invalid values" / "not compatible" error;
//   - every tool the print uses heats to a PLA nozzle temperature (M104 S200–S249, never S260+);
//   - the bed (M140/M190) is 50–70 °C;
//   - the number of tools used equals the number of slots the fixture paints;
//   - a Prusa MMU3 retarget keeps its five extruders.
//
// Run:  npx tsx scripts/slicer-golden.mjs [case-name ...]
// Slicers are found from ORCA_BIN / PRUSA_BIN, then ./.slicers/{orca,prusa}/AppRun (where the
// nightly workflow unpacks its AppImages), then the macOS apps in /Applications (stable PrusaSlicer
// before an alpha: the 3.0 alphas abort on CLI export). A slicer that is not found is a failure,
// unless SLICER_GOLDEN_SKIP_MISSING=1 (then its cases are reported as skipped).
// Output goes to SLICER_GOLDEN_OUT (default: ./slicer-golden-out); failing cases keep their input
// 3MF, G-code and slicer log under <out>/failed/<case>/ for the workflow to upload.
//
// Not part of `npm test`: it needs two desktop slicers and takes a minute or two.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, cpSync } from "node:fs";
import { join, resolve } from "node:path";
import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";

import { cleanThreeMF } from "../src/lib/convert.ts";
import { buildFlatU1_3mf } from "../src/lib/hueforge-3mf.ts";
import { imageToHueForgeU1 } from "../src/lib/hueforge-pipeline.ts";
import { planLithophane } from "../src/lib/lithophane.ts";
import { lithophaneTo3MF } from "../src/lib/lithophane-3mf.ts";
import { planFullColour } from "../src/lib/fullcolour.ts";
import { fullColourTo3MF } from "../src/lib/fullcolour-3mf.ts";

const OUT = resolve(process.env.SLICER_GOLDEN_OUT || "slicer-golden-out");
const SKIP_MISSING = process.env.SLICER_GOLDEN_SKIP_MISSING === "1";
const TIMEOUT_MS = Number(process.env.SLICER_GOLDEN_TIMEOUT_MS) || 10 * 60 * 1000;
const ONLY = process.argv.slice(2).filter((a) => !a.startsWith("-"));

// ---------- slicers ----------

function findBin(envName, candidates) {
  const fromEnv = process.env[envName];
  if (fromEnv) return existsSync(fromEnv) ? fromEnv : null;
  return candidates.find((p) => existsSync(p)) ?? null;
}

/** Installed macOS apps named `prefix*.app`, stable releases before alphas/betas, newest name first. */
function macApps(prefix, inner) {
  try {
    const pre = (n) => (/alpha|beta|rc\d/i.test(n) ? 1 : 0);
    return readdirSync("/Applications")
      .filter((n) => n.startsWith(prefix) && n.endsWith(".app"))
      .sort((a, b) => pre(a) - pre(b) || b.localeCompare(a))
      .map((n) => join("/Applications", n, inner));
  } catch {
    return [];
  }
}

// Where the nightly workflow unpacks the AppImages (and where a local copy can go too; gitignored).
const LOCAL = resolve(".slicers");
const ORCA = findBin("ORCA_BIN", [
  join(LOCAL, "orca/AppRun"),
  "/Applications/Snapmaker Orca.app/Contents/MacOS/Snapmaker_Orca",
]);
const PRUSA = findBin("PRUSA_BIN", [
  join(LOCAL, "prusa/AppRun"),
  ...macApps("PrusaSlicer", "Contents/MacOS/PrusaSlicer"),
]);

function run(bin, args) {
  const r = spawnSync(bin, args, { encoding: "utf8", timeout: TIMEOUT_MS, maxBuffer: 256 * 1024 * 1024 });
  const log = `$ ${[bin, ...args].map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" ")}\n` +
    `exit=${r.status} signal=${r.signal ?? ""}${r.error ? ` error=${r.error.message}` : ""}\n` +
    `--- stdout ---\n${r.stdout ?? ""}\n--- stderr ---\n${r.stderr ?? ""}`;
  return { status: r.status, log };
}

/** Snapmaker Orca: slice plate 1 of a project file; returns the plate G-code. */
function sliceOrca(input, dir) {
  const r = run(ORCA, ["--allow-newer-file", "--slice", "1", "--outputdir", dir, input]);
  const gcodePath = join(dir, "plate_1.gcode");
  return { ...r, gcodePath, gcode: existsSync(gcodePath) ? readFileSync(gcodePath, "utf8") : null };
}

/** PrusaSlicer: export G-code from a project file, using the config the project carries. */
function slicePrusa(input, dir) {
  const gcodePath = join(dir, "out.gcode");
  const r = run(PRUSA, ["--export-gcode", "--output", gcodePath, input]);
  return { ...r, gcodePath, gcode: existsSync(gcodePath) ? readFileSync(gcodePath, "utf8") : null };
}

// ---------- G-code reading ----------

/** Errors a slicer prints while still exiting 0, or before refusing the file. */
const SLICER_ERRORS = /invalid values?|not compatible|incompatible|cannot be sliced|nothing to be sliced|failed to slice/i;

/**
 * Tool numbers the print actually selects, from T commands in the body (ignoring the start block's
 * own housekeeping by reading only after the first layer change), plus the tool the print starts on.
 */
function toolsUsed(gcode) {
  const used = new Set();
  const lines = gcode.split("\n");
  let current = null;
  let printing = false;
  for (const raw of lines) {
    const line = raw.split(";")[0].trim();
    const comment = raw.trim();
    if (!printing && /^;\s*(LAYER_CHANGE|CHANGE_LAYER|LAYER:\s*0|layer num\/total_layer_count: 1\/)/i.test(comment)) printing = true;
    const t = /^T(\d+)\b/.exec(line);
    if (t) current = Number(t[1]);
    // An extrusion move while printing: the current tool lays plastic.
    if (printing && current !== null && /^G[123]\b/.test(line) && /\bE\d*\.?\d*[1-9]/.test(line) && !/\bE-/.test(line)) {
      used.add(current);
    }
  }
  return [...used].sort((a, b) => a - b);
}

/** Every nozzle temperature set per tool: M104/M109 S<n> [T<k>] (no T = the current tool). */
function nozzleTemps(gcode) {
  const byTool = new Map();
  let current = 0;
  for (const raw of gcode.split("\n")) {
    const line = raw.split(";")[0].trim();
    const t = /^T(\d+)\b/.exec(line);
    if (t) current = Number(t[1]);
    const m = /^M10[49]\b(.*)$/.exec(line);
    if (!m) continue;
    const s = /\bS(\d+(?:\.\d+)?)/.exec(m[1]);
    if (!s) continue;
    const tk = /\bT(\d+)/.exec(m[1]);
    const tool = tk ? Number(tk[1]) : current;
    if (!byTool.has(tool)) byTool.set(tool, []);
    byTool.get(tool).push(Number(s[1]));
  }
  return byTool;
}

function bedTemps(gcode) {
  return [...gcode.matchAll(/^M1(?:40|90)\b[^;\n]*\bS(\d+(?:\.\d+)?)/gm)].map((m) => Number(m[1]));
}

/** A key from the config block the slicer appends to the G-code (`; key = value`). */
function gcodeConfig(gcode, key) {
  const m = new RegExp(`^;\\s*${key}\\s*=\\s*(.*)$`, "m").exec(gcode);
  return m ? m[1].trim() : null;
}

// ---------- fixtures (built here, so no third-party model ships in the repo) ----------

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="png" ContentType="image/png"/></Types>`;
const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`;

/** A closed box as 3MF vertices/triangles; `paint` gives a paint_color per side (front, right, back, left). */
function boxMesh([x0, y0, z0], [x1, y1, z1], paint = {}) {
  const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const faces = [
    [[0, 2, 1], [0, 3, 2], null], // bottom
    [[4, 5, 6], [4, 6, 7], null], // top
    [[0, 1, 5], [0, 5, 4], paint.front],
    [[1, 2, 6], [1, 6, 5], paint.right],
    [[2, 3, 7], [2, 7, 6], paint.back],
    [[3, 0, 4], [3, 4, 7], paint.left],
  ];
  const verts = v.map(([x, y, z]) => `<vertex x="${x}" y="${y}" z="${z}"/>`).join("");
  const tris = faces.flatMap(([a, b, p]) => [a, b].map(([i, j, k]) => `<triangle v1="${i}" v2="${j}" v3="${k}"${p ? ` paint_color="${p}"` : ""}/>`)).join("");
  return `<mesh><vertices>${verts}</vertices><triangles>${tris}</triangles></mesh>`;
}

/** The same box as the assembler's triangle list. */
function boxTriangles([x0, y0, z0], [x1, y1, z1]) {
  const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const idx = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  return idx.map((t) => t.map((i) => v[i]));
}

function zipFile(entries, name) {
  const files = Object.fromEntries(Object.entries(entries).map(([k, s]) => [k, typeof s === "string" ? strToU8(s) : s]));
  return new File([zipSync(files, { level: 6 })], name);
}

function bambuProject(objects, cfg) {
  const resources = objects.map((o, i) => `<object id="${i + 1}" type="model">${o.mesh}</object>`).join("");
  const items = objects.map((o, i) => `<item objectid="${i + 1}" transform="1 0 0 0 1 0 0 0 1 ${o.at[0]} ${o.at[1]} 0" printable="1"/>`).join("");
  const model = `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Application">BambuStudio-02.01.01.52</metadata><resources>${resources}</resources><build>${items}</build></model>`;
  const settings = `<?xml version="1.0" encoding="UTF-8"?><config>${objects.map((o, i) => `<object id="${i + 1}"><metadata key="name" value="${o.name}"/><metadata key="extruder" value="${o.extruder ?? 1}"/></object>`).join("")}<plate><metadata key="plater_id" value="1"/><metadata key="plater_name" value=""/>${objects.map((_, i) => `<model_instance><metadata key="object_id" value="${i + 1}"/><metadata key="instance_id" value="0"/></model_instance>`).join("")}</plate></config>`;
  return {
    "[Content_Types].xml": CONTENT_TYPES,
    "_rels/.rels": ROOT_RELS,
    "3D/3dmodel.model": model,
    "Metadata/model_settings.config": settings,
    "Metadata/project_settings.config": JSON.stringify(cfg),
  };
}

const P1S_PLA = (colors) => ({
  printer_model: "Bambu Lab P1S",
  printer_settings_id: "Bambu Lab P1S 0.4 nozzle",
  print_settings_id: "0.20mm Standard @BBL X1C",
  printable_area: ["0x0", "256x0", "256x256", "0x256"],
  layer_height: "0.2",
  filament_colour: colors,
  filament_type: colors.map(() => "PLA"),
  filament_settings_id: colors.map(() => "Bambu PLA Basic @BBL X1C"),
  nozzle_temperature: colors.map(() => "220"),
  hot_plate_temp: colors.map(() => "55"),
});

/** A gradient with distinct hues, so the HueForge planner has a reason to use every filament. */
function gradientImage(w = 48, h = 32) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const t = x / (w - 1), u = y / (h - 1);
      data[i] = Math.round(255 * t);
      data[i + 1] = Math.round(255 * u * (1 - t));
      data[i + 2] = Math.round(255 * (1 - u));
      data[i + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

function prusaMmu3Project() {
  const objects = [
    { mesh: boxMesh([0, 0, 0], [15, 15, 8]), at: [80, 100], extruder: 1 },
    { mesh: boxMesh([0, 0, 0], [15, 15, 8]), at: [120, 100], extruder: 3 },
    { mesh: boxMesh([0, 0, 0], [15, 15, 8]), at: [160, 100], extruder: 5 },
  ];
  const resources = objects.map((o, i) => `<object id="${i + 1}" type="model">${o.mesh}</object>`).join("");
  const items = objects.map((o, i) => `<item objectid="${i + 1}" transform="1 0 0 0 1 0 0 0 1 ${o.at[0]} ${o.at[1]} 0" printable="1"/>`).join("");
  const model = `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06"><metadata name="slic3rpe:Version3mf">1</metadata><metadata name="Application">PrusaSlicer-2.9.0</metadata><resources>${resources}</resources><build>${items}</build></model>`;
  const modelCfg = `<?xml version="1.0" encoding="UTF-8"?><config>${objects.map((o, i) => `<object id="${i + 1}" instances_count="1"><metadata type="object" key="name" value="box${i + 1}"/><metadata type="object" key="extruder" value="${o.extruder}"/><volume firstid="0" lastid="11"><metadata type="volume" key="name" value="box${i + 1}"/><metadata type="volume" key="volume_type" value="ModelPart"/></volume></object>`).join("")}</config>`;
  const five = (v) => Array(5).fill(v).join(",");
  const colors = "#FF8000;#DB5182;#3EC0FF;#FF4F4F;#FBEB7D";
  const ini = [
    "; generated by PrusaSlicer 2.9.0",
    "; printer_model = MK4ISMMU3",
    "; printer_settings_id = Original Prusa MK4 MMU3 0.4 nozzle",
    "; printer_variant = 0.4",
    "; printer_technology = FFF",
    "; gcode_flavor = marlin2",
    "; bed_shape = 0x0,250x0,250x210,0x210",
    "; max_print_height = 220",
    "; single_extruder_multi_material = 1",
    "; wipe_tower = 1",
    "; use_relative_e_distances = 1",
    "; layer_gcode = G92 E0",
    "; wipe_tower_x = 170",
    "; wipe_tower_y = 140",
    `; nozzle_diameter = ${five("0.4")}`,
    `; extruder_colour = ${colors}`,
    `; filament_colour = ${colors}`,
    `; filament_type = ${Array(5).fill("PLA").join(";")}`,
    `; temperature = ${five("215")}`,
    `; first_layer_temperature = ${five("215")}`,
    `; bed_temperature = ${five("60")}`,
    `; first_layer_bed_temperature = ${five("60")}`,
    `; retract_length = ${five("0.8")}`,
    `; extruder_offset = ${Array(5).fill("0x0").join(",")}`,
    "; layer_height = 0.2",
    "; first_layer_height = 0.2",
    "",
  ].join("\n");
  return {
    "[Content_Types].xml": CONTENT_TYPES,
    "_rels/.rels": ROOT_RELS,
    "3D/3dmodel.model": model,
    "Metadata/Slic3r_PE.config": ini,
    "Metadata/Slic3r_PE_model.config": modelCfg,
  };
}

async function blobBytes(r) {
  return new Uint8Array(await r.blob.arrayBuffer());
}

// Each case: build() -> { bytes, expectTools } ; slicer; checks.
const PLA = { nozzle: [200, 249], bed: [50, 70] };

const CASES = [
  {
    name: "u1-stamp-painted-4",
    what: "Bambu P1S project, one cube painted in four colors → U1, stamp mode",
    slicer: "orca",
    pla: true,
    async build() {
      const cols = ["#FF0000", "#00FF00", "#0000FF", "#FFFF00"];
      const files = bambuProject(
        [{ name: "cube", at: [128, 128], mesh: boxMesh([-15, -15, 0], [15, 15, 20], { front: "4", right: "8", back: "0C", left: "1C" }) }],
        P1S_PLA(cols),
      );
      const r = await cleanThreeMF(zipFile(files, "painted.3mf"), "u1", { mode: "stamp" });
      return { bytes: await blobBytes(r), expectTools: 4 };
    },
  },
  {
    name: "u1-stamp-objects-2",
    what: "Bambu P1S project, two cubes on slots 1 and 3 → U1, stamp mode",
    slicer: "orca",
    pla: true,
    async build() {
      const cols = ["#FF0000", "#00FF00", "#0000FF"];
      const files = bambuProject(
        [
          { name: "a", at: [100, 128], extruder: 1, mesh: boxMesh([-10, -10, 0], [10, 10, 10]) },
          { name: "b", at: [156, 128], extruder: 3, mesh: boxMesh([-10, -10, 0], [10, 10, 10]) },
        ],
        P1S_PLA(cols),
      );
      const r = await cleanThreeMF(zipFile(files, "objects.3mf"), "u1", { mode: "stamp" });
      return { bytes: await blobBytes(r), expectTools: 2 };
    },
  },
  {
    name: "u1-preserve-objects-2",
    what: "Bambu P1S project, two cubes on slots 1 and 3 → U1, preserve mode (the default)",
    slicer: "orca",
    pla: true,
    async build() {
      const cols = ["#FF0000", "#00FF00", "#0000FF"];
      const files = bambuProject(
        [
          { name: "a", at: [100, 128], extruder: 1, mesh: boxMesh([-10, -10, 0], [10, 10, 10]) },
          { name: "b", at: [156, 128], extruder: 3, mesh: boxMesh([-10, -10, 0], [10, 10, 10]) },
        ],
        P1S_PLA(cols),
      );
      const r = await cleanThreeMF(zipFile(files, "objects.3mf"), "u1");
      return { bytes: await blobBytes(r), expectTools: 2 };
    },
  },
  {
    name: "hueforge-relief",
    what: "HueForge relief (imageToHueForgeU1 → buildU1_3mf), four PLA filaments",
    slicer: "orca",
    pla: true,
    async build() {
      const filaments = [{ hex: "#111111" }, { hex: "#C21807", td: 3 }, { hex: "#1F4FD8", td: 3 }, { hex: "#F5F5F5", td: 6 }];
      const res = imageToHueForgeU1(gradientImage(), { filaments, widthMm: 40, name: "golden" });
      if (!res) throw new Error("imageToHueForgeU1 returned null");
      // The heads the layer ranges actually switch to: that is what the slicer should print with.
      const xml = strFromU8(unzipSync(res.bytes)["Metadata/layer_config_ranges.xml"]);
      const heads = new Set([...xml.matchAll(/<option opt_key="extruder">(\d+)<\/option>/g)].map((m) => m[1]));
      return { bytes: res.bytes, expectTools: heads.size };
    },
  },
  {
    name: "hueforge-flat",
    what: "HueForge flat mode (buildFlatU1_3mf): base slab + three color caps on four heads",
    slicer: "orca",
    pla: true,
    async build() {
      const parts = [
        { hex: "#111111", head: 0, name: "base", triangles: boxTriangles([0, 0, 0], [42, 30, 0.8]) },
        { hex: "#C21807", head: 1, name: "red", triangles: boxTriangles([1, 1, 0.8], [13, 29, 1.6]) },
        { hex: "#1F4FD8", head: 2, name: "blue", triangles: boxTriangles([15, 1, 0.8], [27, 29, 1.6]) },
        { hex: "#F5F5F5", head: 3, name: "white", triangles: boxTriangles([29, 1, 0.8], [41, 29, 1.6]) },
      ];
      const bytes = buildFlatU1_3mf({ parts, layerH: 0.2, name: "golden-flat", sizeMm: { x: 42, y: 30, z: 1.6 } });
      if (!bytes) throw new Error("buildFlatU1_3mf returned null");
      return { bytes, expectTools: 4 };
    },
  },
  {
    name: "lithophane-colour",
    what: "Colour lithophane (planLithophane → lithophaneTo3MF): CMY colour slab + white heightfield on four heads",
    slicer: "orca",
    pla: true,
    async build() {
      const plan = planLithophane(gradientImage(), { widthMm: 40, heightMm: 30 });
      const bytes = lithophaneTo3MF(plan, { name: "golden-litho" });
      if (!bytes) throw new Error("lithophaneTo3MF returned null");
      return { bytes, expectTools: 4 };
    },
  },
  {
    name: "lithophane-colour-testprint",
    what: "Colour lithophane with the test-print options: 0.8 mm colour grid + 0.2 mm white front layer",
    slicer: "orca",
    pla: true,
    async build() {
      const plan = planLithophane(gradientImage(), { widthMm: 40, heightMm: 30, colourCellMm: 0.8, whiteFrontMm: 0.2 });
      const bytes = lithophaneTo3MF(plan, { name: "golden-litho-testprint" });
      if (!bytes) throw new Error("lithophaneTo3MF returned null");
      return { bytes, expectTools: 4 };
    },
  },
  {
    name: "lithophane-classic",
    what: "Classic white lithophane: one heightfield on one head",
    slicer: "orca",
    pla: true,
    async build() {
      const plan = planLithophane(gradientImage(), { widthMm: 40, heightMm: 30, mode: "classic" });
      const bytes = lithophaneTo3MF(plan, { name: "golden-litho-classic" });
      if (!bytes) throw new Error("lithophaneTo3MF returned null");
      return { bytes, expectTools: 1 };
    },
  },
  {
    name: "lithophane-colour-stand",
    what: "Colour lithophane with a 6 mm border and a stand foot (frame parts on the white head)",
    slicer: "orca",
    pla: true,
    async build() {
      const plan = planLithophane(gradientImage(), { widthMm: 40, heightMm: 30 });
      const bytes = lithophaneTo3MF(plan, { name: "golden-litho-stand", frame: { kind: "stand" } });
      if (!bytes) throw new Error("lithophaneTo3MF returned null");
      return { bytes, expectTools: 4 };
    },
  },
  {
    name: "lithophane-classic-hanger",
    what: "Classic white lithophane with a 6 mm border and a hanger tab with a 4 mm hole",
    slicer: "orca",
    pla: true,
    async build() {
      const plan = planLithophane(gradientImage(), { widthMm: 40, heightMm: 30, mode: "classic" });
      const bytes = lithophaneTo3MF(plan, { name: "golden-litho-hanger", frame: { kind: "hanger" } });
      if (!bytes) throw new Error("lithophaneTo3MF returned null");
      return { bytes, expectTools: 1 };
    },
  },
  {
    name: "fullcolour",
    what: "Full-colour front-lit print (planFullColour → fullColourTo3MF): white base + CMY slab on four heads",
    slicer: "orca",
    pla: true,
    async build() {
      const plan = planFullColour(gradientImage(), { widthMm: 40, heightMm: 30 });
      const bytes = fullColourTo3MF(plan, { name: "golden-fullcolour" });
      if (!bytes) throw new Error("fullColourTo3MF returned null");
      return { bytes, expectTools: 4 };
    },
  },
  {
    name: "prusa-mmu3-retarget",
    what: "PrusaSlicer MK4 MMU3 project (5 filaments, boxes on 1/3/5) → MK4S MMU3 retarget",
    slicer: "prusa",
    pla: false, // the fixture's own temperatures pass through; the check here is the extruder count
    async build() {
      const r = await cleanThreeMF(zipFile(prusaMmu3Project(), "mmu3.3mf"), "prusa-mk4s-mmu3");
      return { bytes: await blobBytes(r), expectTools: 3, expectExtruders: 5 };
    },
    check(gcode, fail) {
      const nd = gcodeConfig(gcode, "nozzle_diameter");
      const n = nd ? nd.split(",").length : 0;
      if (n !== 5) fail(`extruder count: G-code config says nozzle_diameter = ${nd ?? "(missing)"} (${n}), expected 5`);
      const pm = gcodeConfig(gcode, "printer_model");
      if (pm && !/MMU3/.test(pm)) fail(`printer_model is ${pm}, expected an MMU3 model`);
    },
  },
];

// ---------- run ----------

// The U1 start and tool-change G-code also sets non-printing temperatures: 140/130/170 °C while it
// probes and wipes, 70 °C for a parked head. Anything under this is one of those, not a print
// temperature; no filament prints below it.
const STANDBY_BELOW = 180;

function checkPla(gcode, used, fail) {
  const temps = nozzleTemps(gcode);
  const seen = new Set();
  const once = (m) => { if (!seen.has(m)) { seen.add(m); fail(m); } };
  for (const t of used) {
    const printing = (temps.get(t) ?? []).filter((s) => s >= STANDBY_BELOW);
    if (!printing.length) once(`T${t} prints but no M104/M109 sets it to a print temperature`);
    for (const s of printing) {
      if (s >= 260) once(`T${t} nozzle M104 S${s}: 260+ is an ABS/ASA temperature, not PLA`);
      else if (s < PLA.nozzle[0] || s > PLA.nozzle[1]) once(`T${t} nozzle M104 S${s} is outside PLA ${PLA.nozzle[0]}–${PLA.nozzle[1]}`);
    }
  }
  for (const [t, list] of temps) for (const s of list) if (s >= 260 && !used.includes(t)) once(`T${t} (no extrusion) is heated to S${s}`);
  const beds = bedTemps(gcode).filter((s) => s > 0);
  if (!beds.length) once("no M140/M190 sets a bed temperature (bed 0 °C)");
  for (const s of beds) if (s < PLA.bed[0] || s > PLA.bed[1]) once(`bed M140/M190 S${s} is outside PLA ${PLA.bed[0]}–${PLA.bed[1]}`);
}

async function runCase(c) {
  const dir = join(OUT, c.name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const failures = [];
  const fail = (m) => failures.push(m);
  const bin = c.slicer === "orca" ? ORCA : PRUSA;
  if (!bin) {
    const msg = `${c.slicer === "orca" ? "Snapmaker Orca (ORCA_BIN)" : "PrusaSlicer (PRUSA_BIN)"} not found`;
    return SKIP_MISSING ? { c, skipped: msg, failures } : { c, failures: [msg] };
  }

  let built;
  try {
    built = await c.build();
  } catch (e) {
    return { c, failures: [`build threw: ${e?.stack || e}`] };
  }
  const input = join(dir, `${c.name}.3mf`);
  writeFileSync(input, built.bytes);

  const sliced = c.slicer === "orca" ? sliceOrca(input, dir) : slicePrusa(input, dir);
  writeFileSync(join(dir, "slicer.log"), sliced.log);
  if (sliced.status !== 0) fail(`slicer exited ${sliced.status}`);
  const errLine = sliced.log.split("\n").find((l) => SLICER_ERRORS.test(l));
  if (errLine) fail(`slicer reported: ${errLine.trim().slice(0, 300)}`);

  let used = [];
  if (!sliced.gcode) {
    fail(`no G-code at ${sliced.gcodePath}`);
  } else {
    used = toolsUsed(sliced.gcode);
    if (used.length !== built.expectTools) fail(`tools used: ${used.map((t) => `T${t}`).join(" ") || "none"} (${used.length}), expected ${built.expectTools}`);
    if (c.pla) checkPla(sliced.gcode, used, fail);
    c.check?.(sliced.gcode, fail);
  }

  if (failures.length) {
    const keep = join(OUT, "failed", c.name);
    mkdirSync(keep, { recursive: true });
    cpSync(dir, keep, { recursive: true });
  }
  const temps = sliced.gcode ? nozzleTemps(sliced.gcode) : new Map();
  const summary = sliced.gcode
    ? `tools ${used.map((t) => `T${t}`).join(",")} | nozzle ${used.map((t) => `T${t}:${[...new Set(temps.get(t) ?? [])].join("/")}`).join(" ")} | bed ${[...new Set(bedTemps(sliced.gcode))].join("/")}`
    : "";
  return { c, failures, summary };
}

const versions = [];
if (ORCA) versions.push(`Snapmaker Orca: ${ORCA}`);
if (PRUSA) versions.push(`PrusaSlicer:    ${PRUSA}`);
console.log(versions.join("\n") || "no slicers found");
console.log(`output: ${OUT}\n`);
rmSync(join(OUT, "failed"), { recursive: true, force: true });

let failed = 0;
for (const c of CASES.filter((c) => !ONLY.length || ONLY.includes(c.name))) {
  const t0 = Date.now();
  const r = await runCase(c);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (r.skipped) {
    console.log(`SKIP ${c.name} — ${r.skipped}`);
  } else if (r.failures.length) {
    failed++;
    console.log(`FAIL ${c.name} (${secs}s) — ${c.what}`);
    if (r.summary) console.log(`     ${r.summary}`);
    for (const f of r.failures) console.log(`     - ${f}`);
  } else {
    console.log(`PASS ${c.name} (${secs}s) — ${r.summary}`);
  }
}
console.log(failed ? `\n${failed} case(s) failed; inputs, G-code and logs are in ${join(OUT, "failed")}` : "\nall cases passed");
process.exit(failed ? 1 : 0);
