// Bed-fit checking, and specifically the bug it was written for: a four-plate project reported as
// "454×516×49 mm — larger than the U1's 270×270×270 mm build volume" when every part on every plate
// fit fine. The mesh positions are in plate-layout space, so measuring the whole file measures the
// arrangement. These tests pin the distinction between a model that's too big and a layout that is.
import { test } from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { extractMeshFromBuffer } from "./paint.ts";
import { fitVerdict, type FitMesh } from "./fit.ts";

const MAX_XY = 270;
const MAX_Z = 270;

/** An axis-aligned box as a triangle soup, at an offset — i.e. a part sitting somewhere on a bed. */
function boxPart(size: [number, number, number], at: [number, number, number] = [0, 0, 0]) {
  const [sx, sy, sz] = size;
  const [ox, oy, oz] = at;
  const corners: [number, number, number][] = [
    [ox, oy, oz], [ox + sx, oy, oz], [ox, oy + sy, oz],
    [ox + sx, oy + sy, oz], [ox, oy, oz + sz], [ox + sx, oy + sy, oz + sz],
  ];
  return { positions: Float32Array.from(corners.flat()) };
}

const mesh = (parts: { positions: Float32Array }[], plates: number[][] = []): FitMesh => ({
  positions: Float32Array.from(parts.flatMap((p) => Array.from(p.positions))),
  parts,
  plates: plates.map((partIndices) => ({ partIndices })),
});

test("a model that fits raises nothing", () => {
  assert.equal(fitVerdict(mesh([boxPart([100, 100, 50])]), MAX_XY, MAX_Z), null);
});

test("a single oversize part is reported with its own dimensions", () => {
  const v = fitVerdict(mesh([boxPart([300, 100, 50])]), MAX_XY, MAX_Z);
  assert.equal(v?.kind, "part");
  assert.deepEqual([v.x, v.y, v.z], [300, 100, 50]);
});

test("height is checked against the z limit, not the footprint limit", () => {
  const v = fitVerdict(mesh([boxPart([100, 100, 400])]), MAX_XY, 270);
  assert.equal(v?.kind, "part");
  assert.equal(v.z, 400);
});

test("sub-millimetre overshoot is tolerated", () => {
  assert.equal(fitVerdict(mesh([boxPart([270.4, 270.4, 270.4])]), MAX_XY, MAX_Z), null);
});

// ── the reported bug ────────────────────────────────────────────────────────────────────────────
test("parts spread across SEPARATE plates are never measured together", () => {
  // Four plates, each holding one small part, laid out on a 2×2 grid of beds the way a slicer writes
  // them. Whole-file extent is ~454×516 — the number the user was shown. Each plate is fine.
  const parts = [
    boxPart([120, 90, 49], [0, 0, 0]),
    boxPart([120, 90, 49], [334, 0, 0]),
    boxPart([120, 90, 49], [0, 426, 0]),
    boxPart([120, 90, 49], [334, 426, 0]),
  ];
  const m = mesh(parts, [[0], [1], [2], [3]]);

  // The whole-file box really is oversize — this is what the old check measured.
  const wholeFile: FitMesh = { positions: m.positions, parts: [], plates: [] };
  const naive = fitVerdict(wholeFile, MAX_XY, MAX_Z);
  assert.equal(naive?.kind, "part", "guard: the layout really does exceed the bed when measured whole");
  assert.equal(Math.round(naive.x), 454);
  assert.equal(Math.round(naive.y), 516);

  // Measured per plate — which is how it prints — nothing is wrong.
  assert.equal(fitVerdict(m, MAX_XY, MAX_Z), null);
});

test("parts spread too wide ON ONE plate are a layout problem, not a model problem", () => {
  const m = mesh([boxPart([120, 90, 49], [0, 0, 0]), boxPart([120, 90, 49], [200, 0, 0])], [[0, 1]]);
  const v = fitVerdict(m, MAX_XY, MAX_Z);
  assert.equal(v?.kind, "layout", "each part fits; only the arrangement doesn't");
  assert.equal(v.x, 320);
});

test("an oversize part on an over-full plate reports the part, since rescaling is the real fix", () => {
  const m = mesh([boxPart([400, 90, 49], [0, 0, 0]), boxPart([120, 90, 49], [500, 0, 0])], [[0, 1]]);
  assert.equal(fitVerdict(m, MAX_XY, MAX_Z)?.kind, "part");
});

test("without plate metadata, parts share one bed and their spread still counts", () => {
  const m = mesh([boxPart([120, 90, 49], [0, 0, 0]), boxPart([120, 90, 49], [200, 0, 0])]);
  assert.equal(fitVerdict(m, MAX_XY, MAX_Z)?.kind, "layout");
});

test("a mesh with no parts falls back to its raw positions", () => {
  const m: FitMesh = { positions: boxPart([300, 10, 10]).positions, parts: [], plates: [] };
  assert.equal(fitVerdict(m, MAX_XY, MAX_Z)?.kind, "part");
});

test("an empty mesh raises nothing", () => {
  assert.equal(fitVerdict({ positions: new Float32Array(0), parts: [], plates: [] }, MAX_XY, MAX_Z), null);
});

// ── the same bug, through the real parser ───────────────────────────────────────────────────────
// The unit tests above hand-build `parts`, so they'd still pass if paint.ts stopped populating them.
// This one goes through the actual .3mf path: a four-plate project of ordinary little cubes, laid
// out the way a slicer writes them. Measured whole it reports the exact numbers from the bug report.
test("a real four-plate .3mf of small cubes does not warn", () => {
  const SIZE: [number, number, number] = [120, 90, 49];
  const SLOTS: [number, number][] = [[0, 0], [334, 0], [0, 426], [334, 426]];
  const ids = [1, 2, 3, 4];

  const cube = ([sx, sy, sz]: [number, number, number]) => {
    const v = [[0,0,0],[sx,0,0],[sx,sy,0],[0,sy,0],[0,0,sz],[sx,0,sz],[sx,sy,sz],[0,sy,sz]];
    const f = [[0,1,2],[0,2,3],[4,6,5],[4,7,6],[0,4,5],[0,5,1],[1,5,6],[1,6,2],[2,6,7],[2,7,3],[3,7,4],[3,4,0]];
    return `<mesh><vertices>${v.map(([x, y, z]) => `<vertex x="${x}" y="${y}" z="${z}"/>`).join("")}</vertices>`
      + `<triangles>${f.map(([a, b, c]) => `<triangle v1="${a}" v2="${b}" v3="${c}"/>`).join("")}</triangles></mesh>`;
  };
  const project = (sizeOf: (id: number) => [number, number, number]) => {
    const root = `<?xml version="1.0"?><model unit="millimeter"><resources>`
      + ids.map((id) => `<object id="${id}" type="model">${cube(sizeOf(id))}</object>`).join("")
      + `</resources><build>`
      + ids.map((id, i) => `<item objectid="${id}" transform="1 0 0 0 1 0 0 0 1 ${SLOTS[i][0]} ${SLOTS[i][1]} 0"/>`).join("")
      + `</build></model>`;
    const settings = `<?xml version="1.0"?><config>`
      + ids.map((id) => `<object id="${id}"><metadata key="name" value="cube${id}"/></object>`).join("")
      + ids.map((id, i) => `<plate><metadata key="plater_id" value="${i + 1}"/><metadata key="plater_name" value="Plate ${i + 1}"/>`
        + `<model_instance><metadata key="object_id" value="${id}"/></model_instance></plate>`).join("")
      + `</config>`;
    return zipSync({
      "[Content_Types].xml": strToU8(`<?xml version="1.0"?><Types/>`),
      "_rels/.rels": strToU8(`<?xml version="1.0"?><Relationships/>`),
      "3D/3dmodel.model": strToU8(root),
      "Metadata/model_settings.config": strToU8(settings),
    });
  };

  const m = extractMeshFromBuffer(project(() => SIZE));
  assert.equal(m.plates.length, 4, "guard: the parser found the plates this test depends on");

  // The whole-file box — what the old check measured — is the bug report, to the millimetre.
  const whole = fitVerdict({ positions: m.positions, parts: [], plates: [] }, 270, 270);
  assert.equal(whole?.kind, "part");
  assert.deepEqual([whole.x, whole.y, whole.z].map(Math.round), [454, 516, 49]);

  assert.equal(fitVerdict(m, 270, 270), null, "measured per plate, every cube fits");

  // A genuinely oversize part on one plate is still caught.
  const big = extractMeshFromBuffer(project((id) => (id === 2 ? [300, 90, 49] : SIZE)));
  assert.deepEqual(fitVerdict(big, 270, 270), { kind: "part", x: 300, y: 90, z: 49 });
});
