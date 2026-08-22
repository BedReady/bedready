// Band detection asked per plate.
//
// detectColorBands slices the geometry it's given in Z and asks whether each slice is one colour.
// Every plate in a project sits at z=0, so handing it a whole multi-plate file slices all the plates
// at once — and two plates painted differently then look like one model with two-coloured layers.
// Both consequences were reproduced against the real detector before this was written:
//   • two cleanly banded plates → banded=false, blamed on "in-layer detail" that doesn't exist
//   • a plate big enough to carry the area-weighted purity vote → banded=true with ITS swap heights,
//     silently wrong for the smaller plate. convert.ts rewrites the output around those heights.
import { test } from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { extractMeshFromBuffer, encodeSolidPaint } from "./paint.ts";
import { detectColorBands, detectColorBandsForMesh } from "./color-bands.ts";

/** A cleanly banded part: flat triangles stacked in Z, colour switching once at `swap`. */
function part(swap: number, top: number, lower: number, upper: number, facesPerLayer = 6) {
  const pos: number[] = [], st: number[] = [];
  for (let z = 0; z < top; z += 0.2) {
    for (let k = 0; k < facesPerLayer; k++) {
      pos.push(k * 3, 0, z, k * 3 + 2, 0, z, k * 3 + 1, 2, z);
      st.push(z < swap ? lower : upper);
    }
  }
  return { positions: Float32Array.from(pos), faceState: Uint8Array.from(st) };
}

/** A mesh whose parts are each their own plate. */
const plated = (...parts: ReturnType<typeof part>[]) => ({
  positions: Float32Array.from(parts.flatMap((p) => Array.from(p.positions))),
  faceState: Uint8Array.from(parts.flatMap((p) => Array.from(p.faceState))),
  parts,
  plates: parts.map((_, i) => ({ name: `Plate ${i + 1}`, partIndices: [i] })),
});

test("a single banded plate is unaffected", () => {
  const m = plated(part(10, 20, 1, 2));
  const r = detectColorBandsForMesh(m, 1);
  assert.equal(r.banded, true);
  assert.deepEqual(r.changeHeights.map((h) => Math.round(h)), [10]);
});

test("plates that agree on their swaps keep the plan", () => {
  const m = plated(part(10, 20, 1, 2), part(10, 20, 1, 2));
  const r = detectColorBandsForMesh(m, 1);
  assert.equal(r.banded, true);
  assert.deepEqual(r.changeHeights.map((h) => Math.round(h)), [10]);
});

test("two cleanly banded plates are no longer blamed for sharing layers", () => {
  // Inverted colours: identical Z structure, opposite order.
  const m = plated(part(10, 20, 1, 2), part(10, 20, 2, 1));

  // Whole-file — what every caller used to do — sees two-coloured slices and says so.
  const whole = detectColorBands(m.positions, m.faceState, 1);
  assert.equal(whole.banded, false, "guard: the combined file really does look unbanded");
  assert.match(whole.reason, /share layers/);

  // Per plate, each is banded; they disagree only on which colour goes first, not on where the
  // pause happens, so the plan still stands and the false explanation is gone.
  const r = detectColorBandsForMesh(m, 1);
  assert.equal(r.banded, true);
  assert.doesNotMatch(r.reason, /share layers/);
});

test("plates needing different swap heights are refused, not averaged", () => {
  const big = part(10, 20, 1, 2, 120);  // swaps at 10, and carries the purity vote
  const small = part(4, 20, 1, 2, 4);   // swaps at 4

  // The dangerous case: whole-file says "banded" with the BIG plate's heights.
  const whole = detectColorBands(
    Float32Array.from([...big.positions, ...small.positions]),
    Uint8Array.from([...big.faceState, ...small.faceState]),
    1,
  );
  assert.equal(whole.banded, true, "guard: the big plate does carry the vote");
  assert.deepEqual(whole.changeHeights.map((h) => Math.round(h)), [10], "…with heights wrong for the small plate");

  // Per plate: no single plan is valid, so no plan is offered.
  const r = detectColorBandsForMesh(plated(big, small), 1);
  assert.equal(r.banded, false);
  assert.deepEqual(r.changeHeights, []);
  assert.match(r.reason, /different swap heights/);
  assert.match(r.reason, /Plate 1/);
  assert.match(r.reason, /Plate 2/);
});

test("an unbanded plate names itself in the reason", () => {
  // Plate 2 has genuine in-layer detail: two colours sharing every layer.
  const mixed = { positions: [] as number[], faceState: [] as number[] };
  for (let z = 0; z < 20; z += 0.2) {
    for (let k = 0; k < 6; k++) {
      mixed.positions.push(k * 3, 0, z, k * 3 + 2, 0, z, k * 3 + 1, 2, z);
      mixed.faceState.push(k % 2 ? 1 : 2);
    }
  }
  const m = plated(part(10, 20, 1, 2), {
    positions: Float32Array.from(mixed.positions),
    faceState: Uint8Array.from(mixed.faceState),
  });
  const r = detectColorBandsForMesh(m, 1);
  assert.equal(r.banded, false);
  assert.match(r.reason, /Plate 2/, "the reason should say which plate disqualified the file");
});

test("a file with no plate metadata behaves exactly as before", () => {
  const p = part(10, 20, 1, 2);
  const direct = detectColorBands(p.positions, p.faceState, 1);
  const viaMesh = detectColorBandsForMesh({ ...p, parts: [], plates: [] }, 1);
  assert.deepEqual(viaMesh, direct);
});

// ── the same thing, through the real parser ─────────────────────────────────────────────────────
// The tests above hand-build `parts`/`plates`, so they'd still pass if paint.ts stopped populating
// them. This one paints a genuine two-plate .3mf and drives the whole path.
test("a real painted two-plate .3mf with different swap heights is refused", () => {
  const stack = (swap: number, facesPerLayer: number) => {
    const v: string[] = [], tri: string[] = [];
    let n = 0;
    for (let z = 0; z < 20; z += 0.2) {
      for (let k = 0; k < facesPerLayer; k++) {
        v.push(`<vertex x="${k * 3}" y="0" z="${z.toFixed(2)}"/>`,
               `<vertex x="${k * 3 + 2}" y="0" z="${z.toFixed(2)}"/>`,
               `<vertex x="${k * 3 + 1}" y="2" z="${z.toFixed(2)}"/>`);
        tri.push(`<triangle v1="${n}" v2="${n + 1}" v3="${n + 2}"${z >= swap ? ` paint_color="${encodeSolidPaint(2)}"` : ""}/>`);
        n += 3;
      }
    }
    return `<mesh><vertices>${v.join("")}</vertices><triangles>${tri.join("")}</triangles></mesh>`;
  };
  const project = (specs: { swap: number; faces: number }[]) => {
    const ids = specs.map((_, i) => i + 1);
    const root = `<?xml version="1.0"?><model unit="millimeter"><resources>`
      + specs.map((sp, i) => `<object id="${ids[i]}" type="model">${stack(sp.swap, sp.faces)}</object>`).join("")
      + `</resources><build>`
      + ids.map((id, i) => `<item objectid="${id}" transform="1 0 0 0 1 0 0 0 1 ${i * 300} 0 0"/>`).join("")
      + `</build></model>`;
    const settings = `<?xml version="1.0"?><config>`
      + ids.map((id) => `<object id="${id}"><metadata key="name" value="obj${id}"/></object>`).join("")
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

  // A big plate swapping at 10 beside a small one swapping at 4.
  const m = extractMeshFromBuffer(project([{ swap: 10, faces: 60 }, { swap: 4, faces: 3 }]));
  assert.equal(m.plates.length, 2, "guard: the parser found the plates this test depends on");

  // Whole-file is confident and wrong — 10 mm is the big plate's pause, not the small plate's.
  const whole = detectColorBands(m.positions, m.faceState, m.baseState);
  assert.equal(whole.banded, true);
  assert.deepEqual(whole.changeHeights.map((h) => Math.round(h)), [10]);

  const r = detectColorBandsForMesh(m, m.baseState);
  assert.equal(r.banded, false);
  assert.match(r.reason, /different swap heights/);

  // Two plates that agree still get their plan.
  const agree = extractMeshFromBuffer(project([{ swap: 10, faces: 20 }, { swap: 10, faces: 20 }]));
  const ok = detectColorBandsForMesh(agree, agree.baseState);
  assert.equal(ok.banded, true);
  assert.deepEqual(ok.changeHeights.map((h) => Math.round(h)), [10]);
});
