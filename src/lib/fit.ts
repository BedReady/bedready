// Does it fit on the bed?
//
// ── WHY THIS ISN'T ONE BOUNDING BOX ─────────────────────────────────────────────────────────────
// The preview mesh's `positions` are in PLATE-LAYOUT space (see lib/print-groups.ts), so one bounding
// box over the whole file measures the ARRANGEMENT, not the model. A four-plate project measures
// about two beds across, and the old check reported that as a model too big for the U1 — a real
// report read "This model is 454×516×49 mm" for a model that fits comfortably, the 49 mm being the
// only honest number in it.
//
// So the question "does it fit" has to be asked per plate, because a plate is what actually gets
// printed at one time. And inside a plate there are two different failures with two different fixes:
//
//   • a single part is bigger than the bed  → rescale or rotate it (nothing else helps)
//   • every part fits, but they're spread wider than the bed → rearrange them (the model is fine)
//
// Collapsing those into one "too big" message told people to rescale a model that didn't need it.

import { printGroups, type GroupableMesh } from "./print-groups";

/** The shape this needs from MeshData — narrowed so tests can build one by hand. */
export type FitMesh = GroupableMesh;

export type FitVerdict =
  /** One part is genuinely larger than the build volume. Dimensions are that part's. */
  | { kind: "part"; x: number; y: number; z: number }
  /** Every part fits; their layout doesn't. Dimensions are the plate's footprint. */
  | { kind: "layout"; x: number; y: number };

type Box = { x: number; y: number; z: number };

/** Extent of a run of xyz triples. Null when there's nothing to measure. */
function boxOf(positions: ArrayLike<number>): Box | null {
  if (positions.length < 9) return null;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return { x: maxX - minX, y: maxY - minY, z: maxZ - minZ };
}

/** First group that won't print, or null when everything fits. `tol` mm of slack matches the desktop
 *  app, which ignores the sub-millimetre overshoot that rounding and wall thickness produce. */
export function fitVerdict(mesh: FitMesh, maxXY: number, maxZ: number, tol = 1): FitVerdict | null {
  for (const group of printGroups(mesh)) {
    const boxes = group.parts.map((p) => boxOf(p.positions)).filter((b): b is Box => b !== null);
    // A part over the limit is the model's problem, and it's the one worth naming first — a plate can
    // be both over-full AND hold an oversize part, and rescaling is the fix that has to happen.
    const tooBig = boxes.find((b) => b.x > maxXY + tol || b.y > maxXY + tol || b.z > maxZ + tol);
    if (tooBig) return { kind: "part", x: tooBig.x, y: tooBig.y, z: tooBig.z };

    // Footprint of everything on this plate. Height can't overflow from arrangement — parts sit side
    // by side on the bed, not stacked — so a z within limits above is the final word on z.
    const spread = boxOf(concatXY(group.parts));
    if (spread && (spread.x > maxXY + tol || spread.y > maxXY + tol)) {
      return { kind: "layout", x: spread.x, y: spread.y };
    }
  }
  return null;
}

/** The group's vertices as one array, so its footprint is measured across all its parts at once. */
function concatXY(group: { positions: ArrayLike<number> }[]): ArrayLike<number> {
  if (group.length === 1) return group[0].positions;
  const total = group.reduce((n, p) => n + p.positions.length, 0);
  const out = new Float32Array(total);
  let at = 0;
  for (const p of group) {
    for (let i = 0; i < p.positions.length; i++) out[at++] = p.positions[i];
  }
  return out;
}
