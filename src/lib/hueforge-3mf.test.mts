// Golden output for the ported HueForge → U1 3MF assembler.
//
// Verified against the desktop app before pinning: the same inputs produce an archive whose every
// entry is byte-identical to the app's export — [Content_Types].xml, _rels/.rels, 3D/3dmodel.model,
// 3D/_rels/3dmodel.model.rels, 3D/Objects/object_1.model, project_settings.config,
// model_settings.config and layer_config_ranges.xml. That comparison needs the app checked out next
// door so it can't run in CI; these assertions stand in for it.
//
// What actually matters in this file is layer_config_ranges.xml: each Z band carries an `extruder`
// option, which is how Orca changes tool automatically at each colour swap. Get that wrong and the
// file still opens, still looks right in the plater, and prints in one colour.
import { test } from "node:test";
import assert from "node:assert/strict";
import { unzipSync, strFromU8 } from "fflate";
import { buildStack, solveHeightfield, heightfieldToMesh, sequenceToBands } from "./hueforge.ts";
import { buildU1_3mf } from "./hueforge-3mf.ts";

const FILS = [{ hex: "#101010" }, { hex: "#C21807", td: 3 }, { hex: "#F5F5F5", td: 9, layers: 14 }];

function build() {
  const W = 12, H = 10, data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    data[i * 4] = (i * 37) % 256; data[i * 4 + 1] = (i * 91) % 256;
    data[i * 4 + 2] = (i * 13) % 256; data[i * 4 + 3] = 255;
  }
  const st = buildStack(FILS);
  const mesh = heightfieldToMesh(solveHeightfield({ data, width: W, height: H }, st, { smooth: 0 }), { widthMm: 60 });
  const out = buildU1_3mf({
    triangles: mesh.triangles,
    bands: sequenceToBands([0, 0, 1, 1, 2], FILS, st.layerH),
    layerH: st.layerH, name: "T", sizeMm: mesh.sizeMm,
  });
  assert.ok(out, "assembler returned null");
  return unzipSync(out!);
}

test("emits the package Orca expects", () => {
  assert.deepEqual(Object.keys(build()).sort(), [
    "3D/3dmodel.model",
    "3D/Objects/object_1.model",
    "3D/_rels/3dmodel.model.rels",
    "Metadata/layer_config_ranges.xml",
    "Metadata/model_settings.config",
    "Metadata/project_settings.config",
    "[Content_Types].xml",
    "_rels/.rels",
  ]);
});

test("every relationship target exists — the mistake that broke plate extraction", () => {
  const e = build();
  const names = new Set(Object.keys(e));
  for (const rel of [...names].filter((n) => n.endsWith(".rels"))) {
    for (const m of strFromU8(e[rel]).matchAll(/Target="\/?([^"]+)"/g)) {
      assert.ok(names.has(m[1].replace(/^\/+/, "")), `${rel} points at missing ${m[1]}`);
    }
  }
});

test("layer_config_ranges assigns a head per Z band — the whole feature", () => {
  const xml = strFromU8(build()["Metadata/layer_config_ranges.xml"]);
  const extruders = [...xml.matchAll(/<option opt_key="extruder">(\d+)<\/option>/g)].map((m) => m[1]);
  assert.deepEqual(extruders, ["1", "2", "3"], "one head per band, in print order");
  const ranges = [...xml.matchAll(/min_z="([\d.]+)" max_z="([\d.]+)"/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(ranges, [["0", "0.16"], ["0.16", "0.32"], ["0.32", "1000"]]);
  assert.ok(ranges[ranges.length - 1][1] === "1000", "the top band runs to the ceiling, not the model height");
});

test("project_settings carries the real U1 envelope, not a stub", () => {
  const cfg = JSON.parse(strFromU8(build()["Metadata/project_settings.config"]));
  assert.equal(cfg.printer_model, "Snapmaker U1");
  assert.ok(Object.keys(cfg).length > 500, `expected the full U1 profile, got ${Object.keys(cfg).length} keys`);
  // Colours are indexed by head and padded to the U1's four slots.
  assert.deepEqual(cfg.filament_colour, ["#101010", "#C21807", "#F5F5F5", "#FFFFFF"]);
  assert.equal(cfg.layer_height, "0.08");
});

test("refuses to build from nothing rather than emitting an empty model", () => {
  assert.equal(buildU1_3mf({ triangles: [], bands: [], layerH: 0.08 }), null);
  assert.equal(buildU1_3mf({ triangles: [[[0, 0, 0], [1, 0, 0], [0, 1, 0]]], bands: [], layerH: 0.08 }), null);
});

// THE BUG THIS PINS: the geometry part was emitted without a <build> element. The 3MF core spec
// requires one in EVERY model part, including a part that exists only to be referenced by
// <components p:path> and has nothing of its own to place. lib3mf refuses to load such a part, so
// the root object referencing it never resolves, and the error surfaces one level up as
// "Build item not found" — which points at the root's build item, which was never the problem.
//
// Caught 2026-08-03 by validating our own output against lib3mf rather than against our own parser.
// Both relief and calibration-card output were affected, and no web-generated relief had ever been
// opened in a slicer, which is why it went unnoticed.
test("every emitted model part carries the required <build> element", () => {
  const r = buildU1_3mf({
    triangles: [[[0, 0, 0], [10, 0, 0], [10, 10, 0]], [[0, 0, 0], [10, 10, 0], [0, 10, 0]]],
    bands: [{ z0: 0, z1: 1, head: 0, hex: "#101010" }],
    layerH: 0.2,
    name: "build-element",
  });
  assert.ok(r, "assembler returned nothing");
  const e = unzipSync(r!);
  for (const name of Object.keys(e).filter((n) => n.endsWith(".model"))) {
    assert.match(strFromU8(e[name]), /<build\b[^>]*\/?>/,
      `${name} must contain a <build> element — the spec requires one in every model part`);
  }
});
