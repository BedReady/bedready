// 3MF documents are not always in millimetres.
//
// `<model unit="…">` may be micron, millimeter, centimeter, inch, foot or meter — the core spec's
// full list — and the attribute may be absent, which means millimetre. Nothing read it, so every
// vertex was taken as millimetres and every number derived from geometry inherited the error, in
// both directions: a 12×12×6 INCH box is 305×305×152 mm and does not fit the U1's bed, and it was
// told it fit; a 200 mm part written in microns measured 200000 and was told it was too big.
import { test } from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { extractMeshFromBuffer, unitScale } from "./paint.ts";
import { fitVerdict } from "./fit.ts";

function box(sx: number, sy: number, sz: number) {
  const v = [[0,0,0],[sx,0,0],[sx,sy,0],[0,sy,0],[0,0,sz],[sx,0,sz],[sx,sy,sz],[0,sy,sz]];
  const f = [[0,1,2],[0,2,3],[4,6,5],[4,7,6],[0,4,5],[0,5,1],[1,5,6],[1,6,2],[2,6,7],[2,7,3],[3,7,4],[3,4,0]];
  return `<mesh><vertices>${v.map(([x, y, z]) => `<vertex x="${x}" y="${y}" z="${z}"/>`).join("")}</vertices>`
    + `<triangles>${f.map(([a, b, c]) => `<triangle v1="${a}" v2="${b}" v3="${c}"/>`).join("")}</triangles></mesh>`;
}
const project = (unitAttr: string, dims: [number, number, number]) => zipSync({
  "[Content_Types].xml": strToU8(`<?xml version="1.0"?><Types/>`),
  "_rels/.rels": strToU8(`<?xml version="1.0"?><Relationships/>`),
  "3D/3dmodel.model": strToU8(
    `<?xml version="1.0"?><model ${unitAttr}><resources><object id="1" type="model">${box(...dims)}</object></resources>`
    + `<build><item objectid="1"/></build></model>`),
});
function measure(bytes: Uint8Array) {
  const m = extractMeshFromBuffer(bytes);
  const p = m.positions;
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) {
    if (p[i + k] < mn[k]) mn[k] = p[i + k];
    if (p[i + k] > mx[k]) mx[k] = p[i + k];
  }
  return { mesh: m, size: mx.map((v, k) => Math.round(v - mn[k])) };
}

test("the unit table matches the 3MF core spec, and anything else is millimetres", () => {
  assert.equal(unitScale("micron"), 0.001);
  assert.equal(unitScale("millimeter"), 1);
  assert.equal(unitScale("centimeter"), 10);
  assert.equal(unitScale("inch"), 25.4);
  assert.equal(unitScale("foot"), 304.8);
  assert.equal(unitScale("meter"), 1000);
  assert.equal(unitScale(undefined), 1, "absent means millimetre, per the spec");
  assert.equal(unitScale("furlong"), 1, "an unknown unit must not scale geometry to nonsense");
  assert.equal(unitScale(" INCH "), 25.4, "the attribute is not always tidily cased");
});

test("geometry is normalised to millimetres whatever the document declares", () => {
  const cases: [string, [number, number, number], number[]][] = [
    ['unit="millimeter"', [200, 200, 100], [200, 200, 100]],
    ["", [200, 200, 100], [200, 200, 100]],            // absent → millimetre
    ['unit="inch"', [12, 12, 6], [305, 305, 152]],
    ['unit="centimeter"', [30, 30, 20], [300, 300, 200]],
    ['unit="meter"', [0.3, 0.3, 0.2], [300, 300, 200]],
    ['unit="micron"', [200000, 200000, 100000], [200, 200, 100]],
    ['unit="foot"', [1, 1, 0.5], [305, 305, 152]],
  ];
  for (const [attr, dims, expected] of cases) {
    assert.deepEqual(measure(project(attr, dims)).size, expected, `${attr || "(no unit)"} should measure ${expected}`);
  }
});

test("the bed-fit verdict follows the real size, not the declared numbers", () => {
  // Each of these is genuinely too big for a 270 mm bed and each was previously waved through,
  // because the raw numbers looked small.
  for (const [attr, dims] of [['unit="inch"', [12, 12, 6]], ['unit="centimeter"', [30, 30, 20]], ['unit="meter"', [0.3, 0.3, 0.2]]] as const) {
    const { mesh } = measure(project(attr, dims as [number, number, number]));
    assert.equal(fitVerdict(mesh, 270, 270)?.kind, "part", `${attr} is 300 mm+ and must be caught`);
  }
  // And the mirror image: microns made a part that fits look enormous.
  const { mesh } = measure(project('unit="micron"', [200000, 200000, 100000]));
  assert.equal(fitVerdict(mesh, 270, 270), null, "a 200 mm part written in microns fits");
});

test("mmPerUnit is carried, so a value can be converted BACK to the document's space", () => {
  // The split export computes a bed-centering offset in mm and writes it into the ORIGINAL file,
  // whose coordinates are in its own unit. Without this the offset is off by the scale factor.
  assert.equal(measure(project('unit="inch"', [12, 12, 6])).mesh.mmPerUnit, 25.4);
  assert.equal(measure(project('unit="millimeter"', [10, 10, 10])).mesh.mmPerUnit, 1);
  assert.equal(measure(project("", [10, 10, 10])).mesh.mmPerUnit, 1);

  // Round trip: a part centred on a 270 mm bed lands at 135 mm, which is 5.315 in.
  const { mesh } = measure(project('unit="inch"', [12, 12, 6]));
  const offsetMm = 135 - 152.4; // bed centre minus the part's own mm centre
  assert.ok(Math.abs(offsetMm / mesh.mmPerUnit - (135 / 25.4 - 6)) < 1e-9, "the offset converts back to inches");
});

test("a unit on a component file does not override the document's", () => {
  // The unit is a property of the document, read from the file that carries <build>. A component
  // file claiming something else must not silently rescale part of the model.
  const bytes = zipSync({
    "[Content_Types].xml": strToU8(`<?xml version="1.0"?><Types/>`),
    "_rels/.rels": strToU8(`<?xml version="1.0"?><Relationships/>`),
    "3D/3dmodel.model": strToU8(
      `<?xml version="1.0"?><model unit="millimeter"><resources>`
      + `<object id="1" type="model"><components><component p:path="/3D/Objects/o.model" objectid="1"/></components></object>`
      + `</resources><build><item objectid="1"/></build></model>`),
    "3D/Objects/o.model": strToU8(
      `<?xml version="1.0"?><model unit="inch"><resources><object id="1" type="model">${box(100, 100, 50)}</object></resources><build/></model>`),
  });
  assert.deepEqual(measure(bytes).size, [100, 100, 50], "the build document's millimetre wins");
});
