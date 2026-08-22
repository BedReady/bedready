// Detect whether a painted model is VERTICALLY colour-banded — i.e. every layer is a single colour and
// the colour only changes as you go up in Z. When it is, all colours can be printed EXACTLY on the U1 by
// pausing for a filament swap at each band boundary (no Full Spectrum approximation, no dropped colours).
//
// The load-bearing distinction (per the research): vertical colour (Z-stratified, one colour per layer) is
// a manual-swap job; horizontal / in-layer colour (a logo, text inset, gradient — two colours sharing a
// layer) genuinely needs the multiple toolheads. So the test is NOT "each colour sits in a contiguous Z
// range" — it's "is every thin Z slice essentially one colour?". A logo that shares layers with the wall
// behind it makes those slices two-coloured and correctly disqualifies the model.
//
// Input is the extracted mesh (see paint.ts MeshData): `positions` = 9 floats per face (3 verts × xyz,
// already transformed to true coordinates), `faceState` = filament state per face (0 = base → baseState).
//
// NOTE: this takes a flat pair of arrays and so cannot know about plates. Callers holding a parsed
// mesh should use detectColorBandsForMesh (bottom of this file), which asks the question per plate.

import { printGroups, flattenGroup, type GroupableMesh } from "./print-groups";

export type ColorBand = {
  state: number; // 1-based palette index (base faces resolved to baseState)
  z0: number; // band bottom (mm)
  z1: number; // band top (mm)
};

export type BandPlan = {
  banded: boolean; // true = cleanly vertical-stratified (every slice ~one colour)
  bands: ColorBand[]; // bottom → top; empty when not banded
  changeHeights: number[]; // Z (mm) of each swap point (every band boundary above the first)
  colorCount: number; // distinct colours across the bands
  manualSwaps: number; // U1 toolchanger: first 4 bands load on the 4 heads for free; the rest each need a
  // manual spool swap → max(0, bands − 4)
  purity: number; // 0..1 — area fraction that sits in its own slice's dominant colour (higher = cleaner)
  reason: string; // short human explanation (esp. when not banded)
};

type Opts = {
  binHeight?: number; // slice thickness for the monochrome test (mm); ~a layer height. Default 0.2
  purity?: number; // min overall single-colour purity to call it banded. Default 0.9
};

const HEADS = 4; // U1 physical toolheads

/** Analyse a painted mesh for clean vertical colour banding. Pure + Worker-safe (no three, no DOM). */
export function detectColorBands(
  positions: Float32Array,
  faceState: Uint8Array,
  baseState: number,
  opts: Opts = {},
): BandPlan {
  const binHeight = opts.binHeight && opts.binHeight > 0 ? opts.binHeight : 0.2;
  const purityMin = opts.purity ?? 0.9;
  const faceCount = faceState.length;
  const none = (reason: string): BandPlan => ({ banded: false, bands: [], changeHeights: [], colorCount: 0, manualSwaps: 0, purity: 0, reason });

  if (faceCount === 0 || positions.length < faceCount * 9) return none("no geometry to analyse");

  // Global Z extent.
  let zMin = Infinity, zMax = -Infinity;
  for (let f = 0; f < faceCount; f++) {
    const o = f * 9;
    for (const zi of [o + 2, o + 5, o + 8]) {
      const z = positions[zi];
      if (z < zMin) zMin = z;
      if (z > zMax) zMax = z;
    }
  }
  const span = zMax - zMin;
  if (!(span > 0)) return none("model has no height");

  // Slice height into bins; cap the count so a very tall model stays cheap (coarser bins are fine here).
  const nbins = Math.min(4000, Math.max(1, Math.ceil(span / binHeight)));
  const binH = span / nbins;
  const binOf = (z: number) => Math.min(nbins - 1, Math.max(0, Math.floor((z - zMin) / binH)));

  // Per-bin colour → surface area (area-weighted so a stray sliver can't outvote a wall).
  const bins: Map<number, number>[] = Array.from({ length: nbins }, () => new Map());
  const binTotal = new Float64Array(nbins);

  for (let f = 0; f < faceCount; f++) {
    const o = f * 9;
    const ax = positions[o], ay = positions[o + 1], az = positions[o + 2];
    const bx = positions[o + 3], by = positions[o + 4], bz = positions[o + 5];
    const cx = positions[o + 6], cy = positions[o + 7], cz = positions[o + 8];
    // 3D triangle area = ½|(B−A)×(C−A)|.
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const cxx = uy * vz - uz * vy, cyy = uz * vx - ux * vz, czz = ux * vy - uy * vx;
    const area = 0.5 * Math.hypot(cxx, cyy, czz);
    if (!(area > 0)) continue;

    const state = faceState[f] === 0 ? baseState : faceState[f];
    const flo = Math.min(az, bz, cz), fhi = Math.max(az, bz, cz);

    if (fhi - flo < 1e-9) {
      // Flat (horizontal) face — lives entirely in one bin.
      const b = binOf(flo);
      bins[b].set(state, (bins[b].get(state) ?? 0) + area);
      binTotal[b] += area;
      continue;
    }
    // Spread the face's area across every bin its Z-extent overlaps, proportional to the overlap.
    const first = binOf(flo), last = binOf(fhi);
    const inv = 1 / (fhi - flo);
    for (let b = first; b <= last; b++) {
      const bBot = zMin + b * binH, bTop = bBot + binH;
      const ov = Math.min(fhi, bTop) - Math.max(flo, bBot);
      if (ov <= 0) continue;
      const a = area * ov * inv;
      bins[b].set(state, (bins[b].get(state) ?? 0) + a);
      binTotal[b] += a;
    }
  }

  // Dominant colour per (non-empty) bin + overall purity (area in each bin's dominant colour).
  const dom: number[] = new Array(nbins).fill(0); // 0 = empty bin
  let domArea = 0, totArea = 0;
  for (let b = 0; b < nbins; b++) {
    totArea += binTotal[b];
    if (binTotal[b] <= 0) continue;
    let best = 0, bestA = -1;
    for (const [s, a] of bins[b]) if (a > bestA) { bestA = a; best = s; }
    dom[b] = best;
    domArea += bestA;
  }
  const purity = totArea > 0 ? domArea / totArea : 0;
  if (purity < purityMin)
    return { banded: false, bands: [], changeHeights: [], colorCount: 0, manualSwaps: 0, purity, reason: "colours share layers (in-layer detail) — needs multiple heads, not a swap" };

  // Compress the dominant-colour sequence of non-empty bins into bands, smoothing lone single-bin flips
  // (a seam bin can momentarily read as the neighbouring colour) so they don't spawn spurious 1-bin bands.
  const seq: { state: number; bin: number }[] = [];
  for (let b = 0; b < nbins; b++) if (dom[b] !== 0) seq.push({ state: dom[b], bin: b });
  if (seq.length === 0) return none("no colour data");
  for (let i = 1; i < seq.length - 1; i++)
    if (seq[i].state !== seq[i - 1].state && seq[i - 1].state === seq[i + 1].state) seq[i].state = seq[i - 1].state;

  const bands: ColorBand[] = [];
  for (const { state, bin } of seq) {
    const bBot = zMin + bin * binH, bTop = bBot + binH;
    const cur = bands[bands.length - 1];
    if (cur && cur.state === state) cur.z1 = bTop;
    else bands.push({ state, z0: bBot, z1: bTop });
  }

  const changeHeights = bands.slice(1).map((b) => b.z0);
  const colorCount = new Set(bands.map((b) => b.state)).size;
  const manualSwaps = Math.max(0, bands.length - HEADS);
  return {
    banded: true,
    bands,
    changeHeights,
    colorCount,
    manualSwaps,
    purity,
    reason:
      bands.length <= 1
        ? "single colour — no swaps needed"
        : `${bands.length} colour bands; ${manualSwaps} manual filament swap${manualSwaps === 1 ? "" : "s"} on the U1`,
  };
}

// ── PER PLATE ───────────────────────────────────────────────────────────────────────────────────
// detectColorBands answers "is every thin Z slice one colour?", and a multi-plate file breaks that
// question rather than the answer: plates all sit at z=0, so slicing the whole file slices every
// plate at once and two plates painted differently look like one model with two-coloured layers.
//
// Both failure modes are real and were reproduced:
//   • two plates each cleanly banded → banded=false, "colours share layers (in-layer detail)",
//     which is false — they don't share layers, they share a Z range. The exact-swap path is lost.
//   • one plate large enough to carry the purity vote → banded=TRUE with the big plate's swap
//     heights, silently wrong for every other plate. That plan reaches convert.ts, which rewrites
//     the output around those heights, so a wrong answer here becomes a wrongly converted file.
//
// The second is the one that matters, so this is deliberately conservative: a file qualifies only if
// EVERY plate is banded and they agree on the swaps. Plates that disagree have no single valid plan
// — the honest result is "not a band-swap candidate", which just falls through to the normal path.

/** Two plans agree when their swap heights match to within half a bin — the same physical pauses. */
function sameSwaps(a: number[], b: number[], tol: number): boolean {
  return a.length === b.length && a.every((h, i) => Math.abs(h - b[i]) <= tol);
}

/** Band analysis over a parsed mesh, asked per plate. Use this instead of calling detectColorBands
 *  with a whole file's positions — see the note above. */
export function detectColorBandsForMesh(
  mesh: GroupableMesh & { baseState?: number },
  baseState: number,
  opts: Opts = {},
): BandPlan {
  const groups = printGroups(mesh);
  const plans = groups.map((g) => {
    const { positions, faceState } = flattenGroup(g);
    return {
      name: g.name,
      plan: detectColorBands(
        positions instanceof Float32Array ? positions : Float32Array.from(Array.from(positions)),
        faceState instanceof Uint8Array ? faceState : Uint8Array.from(Array.from(faceState)),
        baseState,
        opts,
      ),
    };
  });
  if (plans.length === 0) return detectColorBands(new Float32Array(0), new Uint8Array(0), baseState, opts);
  if (plans.length === 1) return plans[0].plan;

  const named = (n: string, i: number) => n || `plate ${i + 1}`;
  const unbanded = plans.findIndex((p) => !p.plan.banded);
  if (unbanded >= 0) {
    return {
      ...plans[unbanded].plan,
      reason: `${named(plans[unbanded].name, unbanded)}: ${plans[unbanded].plan.reason}`,
    };
  }

  const tol = (opts.binHeight && opts.binHeight > 0 ? opts.binHeight : 0.2) / 2;
  const first = plans[0].plan;
  const differing = plans.findIndex((p) => !sameSwaps(p.plan.changeHeights, first.changeHeights, tol));
  if (differing > 0) {
    return {
      banded: false,
      bands: [],
      changeHeights: [],
      colorCount: 0,
      manualSwaps: 0,
      purity: Math.min(...plans.map((p) => p.plan.purity)),
      reason:
        `each plate is banded, but they need different swap heights ` +
        `(${named(plans[0].name, 0)} at ${first.changeHeights.map((h) => h.toFixed(1)).join("/")} mm, ` +
        `${named(plans[differing].name, differing)} at ${plans[differing].plan.changeHeights.map((h) => h.toFixed(1)).join("/")} mm) — ` +
        `convert one plate at a time to use swaps`,
    };
  }
  return first;
}
