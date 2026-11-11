// Lithophane frame: a solid border round the picture, plus a stand foot or a hanger tab.
//
// Written from first principles for Bed Ready. Pure module (no DOM, no React), like lithophane.ts,
// so Khayt can port it.
//
// COORDINATES are the lithophane's own (see lithophane.ts): the picture fills x ∈ [0, W],
// y ∈ [0, H] with W = gw × cell and H = gh × cell, the viewing face on the bed at z = 0, and the
// thickest column reaching T = colour slab + maxMm. Image row 0 (the top of the photo) is at y = H.
//
//   BORDER  a rectangular ring [-b, W+b] × [-b, H+b] minus the picture, z ∈ [0, T]. Its inner walls
//           lie exactly on the picture's outer walls: the two touch and never overlap.
//   STAND   a SEPARATE flat block printed beside the frame (below it on the bed, a gap away), with
//           a slot along its length that leans back by LEAN_DEG: the framed print slides into the
//           slot and stands leaning back. Printed flat it adds only its own ~12 mm of height — the
//           first version, a foot fused to the frame and reaching 20–30 mm up behind the face,
//           multiplied the print's layer count (107 → 602 layer changes) for a solid fin.
//   HANGER  a tab on the top edge (the y = H+b side) with a round hole for a nail or string, the
//           circle a 24-sided polygon whose INSCRIBED circle is the hole size (so the nail fits).
//
// Every solid is a prism: a 2D region (convex pieces, called sectors, that tile it) swept along one
// axis. Caps are the sectors fanned into triangles; walls follow the region's outer loop and any
// hole loops. The vertices are shared by position, so the result is closed; its orientation is
// checked by its signed volume and flipped if it came out inside-out.
import type { IndexedMesh, LithoPart, LithoPlan } from "./lithophane";

export type LithoFrameKind = "none" | "stand" | "hanger";
export type LithoFrameOpts = { frame?: LithoFrameKind; borderMm?: number };

export const FRAME_DEFAULTS = {
  borderMm: 6,
  /** Backward lean of a standing print, degrees. */
  leanDeg: 12,
  /** Stand block: depth (front to back) at least this, mm … */
  standMinDepthMm: 30,
  /** … or this share of the framed height, whichever is more. */
  standDepthShare: 0.22,
  /** Block height and slot depth, mm. */
  standHeightMm: 12,
  slotDepthMm: 8,
  /** Slot = print thickness + this clearance, mm (a snug sliding fit in PLA). */
  slotClearanceMm: 0.4,
  /** Gap between the frame and the stand on the bed, mm. */
  standGapMm: 8,
  /** Stand length as a share of the framed width (min 50 mm, never wider than the frame). */
  standLengthShare: 0.6,
  hangerWidthMm: 14,
  hangerHeightMm: 10,
  holeMm: 4,
  holeSides: 24,
} as const;

type P2 = [number, number];
type Map3 = (u: number, v: number, w: number) => [number, number, number];

class Builder {
  pos: number[] = [];
  idx: number[] = [];
  private map = new Map<string, number>();
  v(p: [number, number, number]): number {
    const k = p[0].toFixed(4) + "," + p[1].toFixed(4) + "," + p[2].toFixed(4);
    let i = this.map.get(k);
    if (i === undefined) { i = this.pos.length / 3; this.pos.push(p[0], p[1], p[2]); this.map.set(k, i); }
    return i;
  }
  tri(a: number, b: number, c: number) { this.idx.push(a, b, c); }
  quad(a: number, b: number, c: number, d: number) { this.idx.push(a, b, c, a, c, d); }
}

function signedVolume(pos: number[], idx: number[]): number {
  let v = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    v += pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1])
       - pos[a + 1] * (pos[b] * pos[c + 2] - pos[b + 2] * pos[c])
       + pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c]);
  }
  return v / 6;
}

/**
 * Sweep a 2D region along w ∈ [w0, w1]. `sectors` are convex CCW polygons tiling the region;
 * `outer` is its boundary (CCW) and `holes` the boundaries of any holes (CCW too — they are walked
 * backwards here). Sector edges on the boundary must use the boundary's own vertices.
 */
function prism(sectors: P2[][], outer: P2[], holes: P2[][], w0: number, w1: number, map: Map3): IndexedMesh {
  const m = new Builder();
  const at = (p: P2, w: number) => m.v(map(p[0], p[1], w));
  for (const s of sectors) {
    for (let k = 1; k + 1 < s.length; k++) {
      m.tri(at(s[0], w1), at(s[k], w1), at(s[k + 1], w1));
      m.tri(at(s[0], w0), at(s[k + 1], w0), at(s[k], w0));
    }
  }
  for (let i = 0; i < outer.length; i++) {
    const a = outer[i], b = outer[(i + 1) % outer.length];
    m.quad(at(a, w0), at(b, w0), at(b, w1), at(a, w1));
  }
  for (const h of holes) for (let i = 0; i < h.length; i++) {
    const a = h[i], b = h[(i + 1) % h.length];
    m.quad(at(a, w0), at(a, w1), at(b, w1), at(b, w0));
  }
  if (signedVolume(m.pos, m.idx) < 0) {
    for (let t = 0; t < m.idx.length; t += 3) { const s = m.idx[t + 1]; m.idx[t + 1] = m.idx[t + 2]; m.idx[t + 2] = s; }
  }
  return { positions: Float32Array.from(m.pos), indices: Uint32Array.from(m.idx) };
}

const XY: Map3 = (u, v, w) => [u, v, w];

/** Print thickness: colour slab + the thickest white. */
export function printThicknessMm(plan: LithoPlan): number {
  return (plan.whiteFrontMm || 0) + plan.colourLayers * plan.layerH + plan.maxMm;
}

const borderOf = (o: LithoFrameOpts) => {
  const b = Number(o.borderMm);
  return Number.isFinite(b) && b > 0 ? b : FRAME_DEFAULTS.borderMm;
};

/** The ring round the picture: [-b, W+b] × [-b, H+b] minus [0, W] × [0, H], z ∈ [0, T]. */
export function borderMesh(W: number, H: number, b: number, T: number): IndexedMesh {
  const inner: P2[] = [[0, 0], [W, 0], [W, H], [0, H]];
  const outer: P2[] = [[-b, -b], [W + b, -b], [W + b, H + b], [-b, H + b]];
  const sectors = [0, 1, 2, 3].map((k) => { const n = (k + 1) % 4; return [inner[k], outer[k], outer[n], inner[n]]; });
  // Each sector [inner k, outer k, outer k+1, inner k+1] is a trapezoid; CCW as written.
  return prism(sectors, outer, [inner], 0, T, XY);
}

/** Stand-block geometry for a framed width Wf, height Hf and print thickness T (mm). */
export function standSize(Wf: number, Hf: number, T: number) {
  const D = FRAME_DEFAULTS;
  const tan = Math.tan((D.leanDeg * Math.PI) / 180);
  const depth = Math.max(D.standMinDepthMm, D.standDepthShare * Hf);
  const length = Math.min(Wf, Math.max(50, D.standLengthShare * Wf));
  const slot = T + D.slotClearanceMm;
  // The slot's mouth sits 40% of the way back, so the leaning print's weight lands over the block.
  const mouth = depth * 0.4;
  return { depth, length, height: D.standHeightMm, slotDepth: D.slotDepthMm, slot, mouth, tan };
}

/**
 * The stand block, lying on the bed: x ∈ [x0, x0 + length], y ∈ [y0, y0 + depth], z ∈ [0, height],
 * minus a slot cut down from the top face that leans back (towards +y) by LEAN_DEG. Cross-section
 * in (y, z) swept along x, in three convex sectors (the floor under the slot and the two cheeks).
 */
export function standMesh(x0: number, y0: number, Wf: number, Hf: number, T: number): IndexedMesh {
  const { depth: Dp, length, height: Hs, slotDepth: d, slot: w, mouth: a, tan } = standSize(Wf, Hf, T);
  const z1 = Hs - d, dt = d * tan; // the slot's floor is `dt` further back than its mouth (it leans)
  const Y = (y: number) => y0 + y;
  const floor: P2[] = [[Y(0), 0], [Y(Dp), 0], [Y(Dp), z1], [Y(a + w + dt), z1], [Y(a + dt), z1], [Y(0), z1]];
  const front: P2[] = [[Y(0), z1], [Y(a + dt), z1], [Y(a), Hs], [Y(0), Hs]];
  const back: P2[] = [[Y(a + w + dt), z1], [Y(Dp), z1], [Y(Dp), Hs], [Y(a + w), Hs]];
  const outer: P2[] = [[Y(0), 0], [Y(Dp), 0], [Y(Dp), z1], [Y(Dp), Hs], [Y(a + w), Hs], [Y(a + w + dt), z1], [Y(a + dt), z1], [Y(a), Hs], [Y(0), Hs], [Y(0), z1]];
  return prism([floor, front, back], outer, [], x0, x0 + length, (u, v, ww) => [ww, u, v]);
}

/**
 * The hanger tab: x ∈ [cx - w/2, cx + w/2], y ∈ [y0, y0 + h], z ∈ [0, T], with a polygonal hole of
 * inscribed diameter `holeMm` at its centre. Each sector is the convex piece between two adjacent
 * rays from the hole centre: hole edge, the rectangle points the rays hit, and any corner between.
 */
export function hangerMesh(cx: number, y0: number, T: number): IndexedMesh {
  const { hangerWidthMm: w, hangerHeightMm: h, holeMm, holeSides: n } = FRAME_DEFAULTS;
  const cy = y0 + h / 2, hw = w / 2, hh = h / 2;
  const R = holeMm / 2 / Math.cos(Math.PI / n); // circumradius: the flats sit on the hole circle
  const ang = (k: number) => (2 * Math.PI * k) / n + Math.PI / n; // offset half a step: no ray hits a corner
  const hole: P2[] = [], hit: P2[] = [];
  for (let k = 0; k < n; k++) {
    const a = ang(k), dx = Math.cos(a), dy = Math.sin(a);
    hole.push([cx + R * dx, cy + R * dy]);
    const s = Math.min(Math.abs(dx) > 1e-12 ? hw / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-12 ? hh / Math.abs(dy) : Infinity);
    hit.push([cx + s * dx, cy + s * dy]);
  }
  const corners: { a: number; p: P2 }[] = [[hw, hh], [-hw, hh], [-hw, -hh], [hw, -hh]].map(([dx, dy]) => {
    let a = Math.atan2(dy, dx); if (a < 0) a += 2 * Math.PI;
    return { a, p: [cx + dx, cy + dy] as P2 };
  });
  const sectors: P2[][] = [], outer: P2[] = [];
  for (let k = 0; k < n; k++) {
    const a0 = ang(k), a1 = ang(k + 1);
    const between = corners.filter((c) => (c.a > a0 && c.a < a1) || (c.a + 2 * Math.PI > a0 && c.a + 2 * Math.PI < a1));
    const chain: P2[] = [hit[k], ...between.map((c) => c.p)];
    outer.push(...chain);
    // CCW: back along the hole (k+1 → k), then out and along the rectangle (k → corner → k+1).
    sectors.push([hole[(k + 1) % n], hole[k], ...chain, hit[(k + 1) % n]]);
  }
  return prism(sectors, outer, [hole], 0, T, XY);
}

/** The extra parts a frame adds, in the picture's own coordinates (they can be negative). */
export function frameParts(plan: LithoPlan, opts: LithoFrameOpts = {}): LithoPart[] {
  const kind = opts.frame ?? "none";
  const b = borderOf(opts);
  const W = plan.gw * plan.cellMm, H = plan.gh * plan.cellMm, T = printThicknessMm(plan);
  const head = plan.whiteHead, hex = plan.filaments[head].hex;
  const parts: LithoPart[] = [{ hex, head, name: "frame", mesh: borderMesh(W, H, b, T) }];
  if (kind === "stand") {
    const Wf = W + 2 * b, Hf = H + 2 * b, { depth, length } = standSize(Wf, Hf, T);
    // Centred under the frame, a gap below its bottom edge.
    parts.push({ hex, head, name: "stand", mesh: standMesh(-b + (Wf - length) / 2, -b - FRAME_DEFAULTS.standGapMm - depth, Wf, Hf, T) });
  }
  if (kind === "hanger") parts.push({ hex, head, name: "hanger", mesh: hangerMesh(W / 2, H + b, T) });
  return parts;
}

/** Bounding box of a set of parts. */
export function partsBounds(parts: LithoPart[]) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) {
    const a = p.mesh.positions;
    for (let i = 0; i < a.length; i += 3) for (let c = 0; c < 3; c++) {
      if (a[i + c] < lo[c]) lo[c] = a[i + c];
      if (a[i + c] > hi[c]) hi[c] = a[i + c];
    }
  }
  return { min: lo, max: hi };
}

/** A copy of each part moved by (dx, dy, dz). */
export function translateParts(parts: LithoPart[], dx: number, dy: number, dz = 0): LithoPart[] {
  return parts.map((p) => {
    const src = p.mesh.positions, out = new Float32Array(src.length);
    for (let i = 0; i < src.length; i += 3) { out[i] = src[i] + dx; out[i + 1] = src[i + 1] + dy; out[i + 2] = src[i + 2] + dz; }
    return { ...p, mesh: { positions: out, indices: p.mesh.indices } };
  });
}

/**
 * Picture + frame, moved so every coordinate is ≥ 0 (the flat 3MF writer centres by size and does
 * not move parts), with the framed size. No `frame` → the picture as it was. `offset` is how far
 * the picture moved: (b, b), or (b, b + gap + stand depth) with a stand.
 */
export function withFrame(picture: LithoPart[], plan: LithoPlan, frame?: { kind: LithoFrameKind; borderMm?: number }) {
  const all = frame ? [...picture, ...frameParts(plan, { frame: frame.kind, borderMm: frame.borderMm })] : picture;
  const { min, max } = partsBounds(all);
  const dx = Math.max(0, -min[0]), dy = Math.max(0, -min[1]);
  return {
    parts: dx || dy ? translateParts(all, dx, dy) : all,
    sizeMm: { x: max[0] + dx, y: max[1] + dy, z: max[2] },
    offset: { x: dx, y: dy },
  };
}
