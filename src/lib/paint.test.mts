// Paint-codec tests. Validate our paint_color hex codec against the slicer's own algorithm
// (FacetsAnnotation::get_triangle_as_string / set_triangle_from_string, OrcaSlicer/PrusaSlicer
// src/libslic3r/Model.cpp). Run: `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { remapPaintCode, dominantState, extractMeshFromBuffer, encodeSolidPaint, overhangReport } from "./paint.ts";

const id = (s: number) => s;

// ---------- golden vectors (real slicer output) ----------
// "5C0D" is a real Orca code: a split triangle with leaves {state 0, state 8}; dominant (first
// non-zero leaf) = 8. Worked out by hand from the C++ and confirmed in the source teardown.
test("dominantState matches slicer on a known split code", () => {
  assert.equal(dominantState("5C0D"), 8);
});
test("identity remap is canonical (round-trips to the exact same hex)", () => {
  for (const code of ["4", "8", "5C0D", "1C0C2C0C1C13"]) {
    assert.equal(remapPaintCode(code, id), code);
  }
});
test("single-nibble leaf codes decode to the right state", () => {
  // leaf state n<3 encodes as one nibble: bits [0,0, n0,n1] -> nibble value n<<2
  assert.equal(dominantState("4"), 1); // 0b0100 -> lo=1
  assert.equal(dominantState("8"), 2); // 0b1000 -> lo=2
});
test("remap actually changes the encoded state and is reversible", () => {
  const up = remapPaintCode("5C0D", (s) => (s === 0 ? 0 : s + 1)); // 8 -> 9
  assert.notEqual(up, "5C0D");
  assert.equal(dominantState(up), 9);
  const back = remapPaintCode(up, (s) => (s === 0 ? 0 : s - 1)); // 9 -> 8
  assert.equal(back, "5C0D");
});

// ---------- fuzz vs an independent transcription of the slicer codec ----------
type Node = { leaf: number } | { sides: number; side: number; kids: Node[] };

// reference encode: bitstream matching TriangleSelector::serialize (children in stream order)
function encodeBits(n: Node, bits: number[]): void {
  if ("leaf" in n) {
    bits.push(0, 0); // split_sides = 0 => leaf
    if (n.leaf >= 3) {
      bits.push(1, 1); // lo == 3 escape
      for (let i = 0; i < 4; i++) bits.push(((n.leaf - 3) >> i) & 1);
    } else {
      bits.push(n.leaf & 1, (n.leaf >> 1) & 1);
    }
  } else {
    bits.push(n.sides & 1, (n.sides >> 1) & 1);
    bits.push(n.side & 1, (n.side >> 1) & 1);
    for (const k of n.kids) encodeBits(k, bits);
  }
}
// reference bits->hex matching get_triangle_as_string: 4-bit nibble LSB-first, prepend the digit.
function bitsToHexRef(bits: number[]): string {
  let out = "";
  for (let i = 0; i < bits.length; i += 4) {
    let v = 0;
    for (let k = 3; k >= 0; k--) v = (v << 1) | (bits[i + k] ?? 0);
    out = v.toString(16).toUpperCase() + out;
  }
  return out;
}
function firstNonZeroLeaf(n: Node): number {
  if ("leaf" in n) return n.leaf;
  for (const k of n.kids) {
    const s = firstNonZeroLeaf(k);
    if (s !== 0) return s;
  }
  return 0;
}
// deterministic PRNG so failures reproduce
let seed = 123456789;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
function randTree(depth: number): Node {
  if (depth <= 0 || rnd() < 0.5) return { leaf: Math.floor(rnd() * 17) }; // states 0..16
  const sides = 1 + Math.floor(rnd() * 3); // 1..3 => 2..4 children
  const kids: Node[] = [];
  for (let i = 0; i <= sides; i++) kids.push(randTree(depth - 1));
  return { sides, side: Math.floor(rnd() * 4), kids };
}

// ---------- mesh extraction (typed arrays + cap) ----------
const PAINTED_3MF = (() => {
  const model = `<?xml version="1.0"?><model><resources><object id="1"><mesh>` +
    `<vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/><vertex x="1" y="1" z="0"/></vertices>` +
    `<triangles><triangle v1="0" v2="1" v3="2"/><triangle v1="1" v2="3" v3="2" paint_color="8"/></triangles>` +
    `</mesh></object></resources><build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/></build></model>`;
  return zipSync({
    "Metadata/project_settings.config": strToU8(JSON.stringify({ filament_colour: ["#FF0000", "#00FF00"] })),
    "3D/3dmodel.model": strToU8(model),
  });
})();

test("extractMeshFromBuffer: typed arrays, correct counts + per-face states", () => {
  const m = extractMeshFromBuffer(PAINTED_3MF);
  assert.equal(m.skipped, false);
  assert.equal(m.triangleCount, 2);
  assert.ok(m.positions instanceof Float32Array);
  assert.ok(m.faceState instanceof Uint8Array);
  assert.equal(m.positions.length, 18); // 2 faces * 9 floats
  assert.equal(m.faceState.length, 2);
  assert.equal(m.faceState[0], 1); // unpainted → base extruder 1
  assert.equal(m.faceState[1], 2); // paint_color "8" → state 2
  assert.deepEqual(m.palette, ["#FF0000", "#00FF00"]);
  assert.deepEqual(m.usage, [1, 1]);
  assert.deepEqual(m.statesPresent, [1, 2]);
});

test("overhangReport: flags an elevated downward ceiling, ignores walls and bed-resting faces", () => {
  // elevated horizontal face with a DOWNWARD normal (overhang). winding a,b,c → (b-a)×(c-a).z < 0
  const ceiling = [0, 0, 10, 0, 10, 10, 10, 0, 10];
  const wall = [0, 0, 0, 0, 0, 10, 10, 0, 0]; // vertical → normal horizontal, nz≈0, not an overhang
  const bedFace = [0, 0, 0, 0, 10, 0, 10, 0, 0]; // downward normal but sitting on the plate (z≈minZ)

  // ceiling + wall: half the area overhangs → recommend support
  let r = overhangReport(new Float32Array([...ceiling, ...wall]));
  assert.ok(r.ratio > 0.45 && r.ratio < 0.55, `~50% overhang, got ${r.ratio}`);
  assert.equal(r.needsSupport, true);

  // wall + bed-resting face only: nothing airborne → no support
  r = overhangReport(new Float32Array([...wall, ...bedFace]));
  assert.equal(r.overhangArea, 0);
  assert.equal(r.needsSupport, false);

  assert.equal(overhangReport(new Float32Array(0)).needsSupport, false); // empty mesh
});

test("extractMeshFromBuffer: over the render budget → sampled down (not skipped)", () => {
  const m = extractMeshFromBuffer(PAINTED_3MF, 1); // budget below the 2 triangles → stride 2
  assert.equal(m.skipped, false);
  assert.equal(m.sampled, true);
  assert.equal(m.triangleCount, 2); // full count still reported
  assert.equal(m.faceState.length, 1); // sampled to ~1 triangle
  assert.equal(m.positions.length, 9);
});
test("extractMeshFromBuffer: over the hard cap → skipped before building (no arrays)", () => {
  const m = extractMeshFromBuffer(PAINTED_3MF, 2_000_000, 1); // hardCap below the 2 triangles
  assert.equal(m.skipped, true);
  assert.equal(m.sampled, false);
  assert.equal(m.triangleCount, 2); // count still reported
  assert.equal(m.positions.length, 0); // never allocated/filled
  assert.deepEqual(m.palette, ["#FF0000", "#00FF00"]); // palette still available for the UI
});

// Multi-part assembly: cross-file (p:path) component + composed transforms + instancing.
// Object 10 (a triangle) lives in a sub-model, referenced by assembly object 1 with a +100 X shift;
// object 11 (another triangle) is placed twice at different spots. All three must land in their
// true world positions (the old parser stacked everything at the origin and dropped instances).
const MULTIPART_3MF = (() => {
  const tri =
    `<mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices>` +
    `<triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh>`;
  const main =
    `<?xml version="1.0"?><model><resources>` +
    `<object id="1"><components><component p:path="/3D/Objects/sub.model" objectid="10" transform="1 0 0 0 1 0 0 0 1 100 0 0"/></components></object>` +
    `<object id="11">${tri}</object>` +
    `</resources><build>` +
    `<item objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>` + // assembly → object 10 at x≈100
    `<item objectid="11" transform="1 0 0 0 1 0 0 0 1 0 200 0"/>` + // object 11 at y≈200
    `<item objectid="11" transform="1 0 0 0 1 0 0 0 1 500 0 0"/>` + // object 11 instanced at x≈500
    `</build></model>`;
  const sub = `<?xml version="1.0"?><model><resources><object id="10">${tri}</object></resources></model>`;
  return zipSync({
    "Metadata/project_settings.config": strToU8(JSON.stringify({ filament_colour: ["#FF0000", "#00FF00"] })),
    "3D/3dmodel.model": strToU8(main),
    "3D/Objects/sub.model": strToU8(sub),
  });
})();

test("extractMeshFromBuffer: multi-part — cross-file components, composed transforms, instancing", () => {
  const m = extractMeshFromBuffer(MULTIPART_3MF);
  assert.equal(m.triangleCount, 3); // object 10 once + object 11 twice (instance counted)
  assert.equal(m.faceState.length, 3);
  // bounds across all rendered vertices
  let minX = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < m.positions.length; i += 3) {
    minX = Math.min(minX, m.positions[i]);
    maxX = Math.max(maxX, m.positions[i]);
    maxY = Math.max(maxY, m.positions[i + 1]);
  }
  assert.ok(maxX >= 500, `instance should reach x≈500, got ${maxX}`); // proves instancing + build transform
  assert.ok(maxY >= 200, `object 11 should reach y≈200, got ${maxY}`); // proves a distinct build transform
  assert.ok(minX <= 1, `object 11's origin instance should be near x=0, got ${minX}`);
  // the cross-file component's +100 X shift must have applied (not all geometry at the origin)
  assert.ok(maxX - minX >= 500, "parts must be spread out, not stacked at the origin");
  // segmented into one entry per build item (object 10, object 11, object 11-instance)
  assert.equal(m.parts.length, 3);
  assert.deepEqual(m.parts.map((p) => p.triangleCount), [1, 1, 1]);
  assert.equal(m.parts.reduce((a, p) => a + p.triangleCount, 0), m.faceState.length); // views tile the whole
  assert.ok(m.parts.every((p) => p.positions.buffer === m.positions.buffer)); // zero-copy views, not new buffers
  assert.deepEqual(m.parts.map((p) => p.objectId), [1, 11, 11]); // build-item object ids preserved
  assert.deepEqual(m.plates, []); // no model_settings plates in this fixture
});

test("extractMeshFromBuffer: groups parts into plates from model_settings", () => {
  const tri =
    `<mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices>` +
    `<triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh>`;
  const main =
    `<?xml version="1.0"?><model><resources>` +
    `<object id="2">${tri}</object><object id="4">${tri}</object><object id="6">${tri}</object>` +
    `</resources><build>` +
    `<item objectid="2" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>` +
    `<item objectid="4" transform="1 0 0 0 1 0 0 0 1 50 0 0"/>` +
    `<item objectid="6" transform="1 0 0 0 1 0 0 0 1 100 0 0"/>` +
    `</build></model>`;
  // plate 1 = object 2; plate 2 = objects 4 and 6
  const ms =
    `<?xml version="1.0"?><config>` +
    `<plate><metadata key="plater_id" value="1"/><model_instance><metadata key="object_id" value="2"/><metadata key="instance_id" value="0"/></model_instance></plate>` +
    `<plate><metadata key="plater_id" value="2"/>` +
    `<model_instance><metadata key="object_id" value="4"/><metadata key="instance_id" value="0"/></model_instance>` +
    `<model_instance><metadata key="object_id" value="6"/><metadata key="instance_id" value="0"/></model_instance></plate>` +
    `</config>`;
  const buf = zipSync({
    "Metadata/project_settings.config": strToU8(JSON.stringify({ filament_colour: ["#FF0000", "#00FF00"] })),
    "Metadata/model_settings.config": strToU8(ms),
    "3D/3dmodel.model": strToU8(main),
  });
  const m = extractMeshFromBuffer(buf);
  assert.equal(m.parts.length, 3);
  assert.equal(m.plates.length, 2);
  assert.deepEqual(m.plates[0].partIndices, [0]); // object 2 → part 0
  assert.deepEqual(m.plates[1].partIndices, [1, 2]); // objects 4,6 → parts 1,2
});

test("fuzz: our codec round-trips slicer-encoded codes (1000 trees)", () => {
  for (let t = 0; t < 1000; t++) {
    const tree = randTree(4);
    const bits: number[] = [];
    encodeBits(tree, bits);
    const hex = bitsToHexRef(bits);
    // identity remap must reproduce the exact slicer hex (proves hexToBits/bitsToHex match the slicer)
    assert.equal(remapPaintCode(hex, id), hex, `round-trip mismatch on ${hex}`);
    // dominant = first non-zero leaf in stream order
    assert.equal(dominantState(hex), firstNonZeroLeaf(tree), `dominant mismatch on ${hex}`);
  }
});

// PrusaSlicer multi-volume: one mesh split into per-color volumes (triangle ranges with an extruder
// each, in Slic3r_PE_model.config) — colors come from volumes, not painting.
test("encodeSolidPaint round-trips through dominantState", () => {
  for (let s = 1; s <= 8; s++) assert.equal(dominantState(encodeSolidPaint(s)), s);
});

test("extractMeshFromBuffer: Prusa multi-volume colors via Slic3r_PE_model.config", () => {
  const v = (x: number, y: number, z: number) => `<vertex x="${x}" y="${y}" z="${z}"/>`;
  const tri = (a: number, b: number, c: number) => `<triangle v1="${a}" v2="${b}" v3="${c}"/>`;
  const model =
    `<?xml version="1.0"?><model><resources><object id="1" type="model"><mesh>` +
    `<vertices>${v(0, 0, 0)}${v(1, 0, 0)}${v(0, 1, 0)}${v(1, 1, 0)}</vertices>` +
    `<triangles>${tri(0, 1, 2)}${tri(1, 2, 3)}${tri(2, 3, 0)}${tri(3, 0, 1)}</triangles>` +
    `</mesh></object></resources><build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/></build></model>`;
  const peCfg = `; filament_colour = #FFFFFF;#FFFFFF;#FFFFFF\n; extruder_colour = #FF0000;#00FF00;#0000FF\n`;
  const modelCfg =
    `<config><object id="1"><metadata type="object" key="extruder" value="1"/>` +
    `<volume firstid="0" lastid="1"><metadata type="volume" key="extruder" value="1"/></volume>` +
    `<volume firstid="2" lastid="3"><metadata type="volume" key="extruder" value="2"/></volume>` +
    `</object></config>`;
  const buf = zipSync({
    "3D/3dmodel.model": strToU8(model),
    "Metadata/Slic3r_PE.config": strToU8(peCfg),
    "Metadata/Slic3r_PE_model.config": strToU8(modelCfg),
  });
  const m = extractMeshFromBuffer(buf);
  assert.deepEqual(m.palette, ["#FF0000", "#00FF00", "#0000FF"]); // from extruder_colour
  assert.deepEqual(m.statesPresent, [1, 2]); // tris 0-1 → ext 1, tris 2-3 → ext 2
  assert.equal(m.usage[0], 2); // two faces filament 1
  assert.equal(m.usage[1], 2); // two faces filament 2
});
