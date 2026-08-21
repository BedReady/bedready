// TD calibration swatch card — the measuring instrument behind relief mode.
//
// WHY THIS EXISTS. Relief mode's whole model is one constant per filament: TD, the transmission
// distance, how far light gets into that plastic before it is blocked. Every colour the engine
// predicts comes out of it. Ours are generic estimates, which is why a full-spectrum photo lands
// around ΔE 17 — "an interpretation rather than a copy", as the page admits. Real measured TD for the
// spools actually on the shelf is the single biggest quality lever available, and it costs no extra
// compute.
//
// TD cannot be looked up. It depends on pigment load and opacity, so it varies between brands, and
// between colours within a brand. It has to be measured, and the way you measure it is to print the
// filament at a range of known thicknesses over a contrasting backing and see where the backing stops
// showing through. That is what this card is.
//
// HOW IT PRINTS. A flat backing slab, then a row of pads whose heights step up one layer at a time.
// The U1 swaps filament by global Z range, so layers 0..base print in the backing colour and
// everything above prints in the filament under test. A pad that is k layers tall therefore carries
// exactly k layers of test filament over the backing — the whole point, and it falls straight out of
// the geometry without needing per-region painting.
//
// ONE FILAMENT PER CARD. The swap is by height, not by area, so every pad above the base is the same
// filament. Calibrating four spools means four prints. That is a real constraint of the machine, not
// an oversight — trying to fake it with painted regions would put a colour boundary inside each pad
// and measure something else.
//
// Photograph the finished card flat-on under even light, sample the centre of each pad, and fit TD
// against the measured backing and the filament's own opaque colour. solveTd() does the fit.
import { buildU1_3mf } from "./hueforge-3mf";
import type { Triangle } from "./hueforge";

export type SwatchOptions = {
  /** Number of thickness steps. 12 spans the useful range for most filaments at 0.08 mm. */
  steps?: number;
  layerH?: number;
  /** Backing thickness. Must be opaque, or the bed shows through and every reading is wrong. */
  baseLayers?: number;
  /** Side of each square pad, mm. Big enough to sample cleanly in a photo. */
  padMm?: number;
  gapMm?: number;
  marginMm?: number;
  /** Head 1: the backing. A dark, fully opaque filament gives the strongest signal. */
  backingHex?: string;
  /** Head 2: the filament being measured. */
  testHex?: string;
  name?: string;
};

export type SwatchStep = {
  /** Layers of test filament on this pad. */
  layers: number;
  /** Total height of the pad, mm, including the backing. */
  z: number;
  /** Pad centre on the bed, mm — where to sample in the photograph. */
  cx: number;
  cy: number;
};

export type SwatchCard = {
  bytes: Uint8Array;
  steps: SwatchStep[];
  layerH: number;
  baseZ: number;
  sizeMm: { x: number; y: number; z: number };
};

const HEX6 = /^#[0-9a-f]{6}$/i;

const DEF = {
  steps: 10,
  layerH: 0.08,
  baseLayers: 8,
  padMm: 12,
  gapMm: 2,
  marginMm: 6,
  backingHex: "#101010",
  testHex: "#C21807",
};

/** Two triangles per face, twelve per box. Wound counter-clockwise seen from outside. */
function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Triangle[] {
  const v = (x: number, y: number, z: number) => [x, y, z] as unknown as Triangle[number];
  const q = (a: Triangle[number], b: Triangle[number], c: Triangle[number], d: Triangle[number]): Triangle[] =>
    [[a, b, c] as unknown as Triangle, [a, c, d] as unknown as Triangle];
  const p000 = v(x0, y0, z0), p100 = v(x1, y0, z0), p110 = v(x1, y1, z0), p010 = v(x0, y1, z0);
  const p001 = v(x0, y0, z1), p101 = v(x1, y0, z1), p111 = v(x1, y1, z1), p011 = v(x0, y1, z1);
  return [
    ...q(p000, p010, p110, p100), // bottom
    ...q(p001, p101, p111, p011), // top
    ...q(p000, p100, p101, p001), // -y
    ...q(p110, p010, p011, p111), // +y
    ...q(p000, p001, p011, p010), // -x
    ...q(p100, p110, p111, p101), // +x
  ];
}

/**
 * Build a printable TD calibration card for one filament.
 *
 * The returned `steps` carry each pad's layer count and bed position, which is what solveTd() needs
 * to match photographed samples back to thicknesses — so the card and the solver cannot drift apart.
 */
/**
 * Channel-wise contrast between the two filaments, 0..1.
 *
 * The card measures how fast the backing STOPS showing through, so it can only measure what the two
 * colours actually differ by. Measured on the first real print (2026-08-04): a red backing under a
 * red test filament left green and blue with no usable span at all, so a 14-pad card produced exactly
 * one channel of signal and a TD with a ±42% spread. Identical colours were already rejected; near
 * colours were not, and near is almost as useless.
 */
export function contrastOf(backingHex: string, testHex: string): number {
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [a, b] = [rgb(backingHex), rgb(testHex)];
  // The best single channel is what the fit will lean on; the others only add robustness.
  return Math.max(...a.map((v, i) => Math.abs(v - b[i]))) / 255;
}

/** Below this the card cannot measure anything worth having — see contrastOf. */
export const MIN_CONTRAST = 0.25;

export function buildSwatchCard(opts: SwatchOptions = {}): SwatchCard | null {
  const o = { ...DEF, ...opts };
  if (o.steps < 2 || o.layerH <= 0 || o.baseLayers < 1 || o.padMm <= 0) return null;
  if (!HEX6.test(o.backingHex) || !HEX6.test(o.testHex)) return null;
  // Refuse rather than print 17 minutes of unmeasurable plastic.
  if (contrastOf(o.backingHex, o.testHex) < MIN_CONTRAST) return null;

  const baseZ = +(o.baseLayers * o.layerH).toFixed(4);
  // A single row: easiest to photograph without one pad shadowing the next.
  const width = +(o.marginMm * 2 + o.steps * o.padMm + (o.steps - 1) * o.gapMm).toFixed(3);
  const depth = +(o.marginMm * 2 + o.padMm).toFixed(3);

  const triangles: Triangle[] = box(0, 0, 0, width, depth, baseZ);
  const steps: SwatchStep[] = [];
  for (let i = 0; i < o.steps; i++) {
    const layers = i + 1;
    const x0 = +(o.marginMm + i * (o.padMm + o.gapMm)).toFixed(3);
    const y0 = o.marginMm;
    const z1 = +(baseZ + layers * o.layerH).toFixed(4);
    triangles.push(...box(x0, y0, baseZ, x0 + o.padMm, y0 + o.padMm, z1));
    steps.push({ layers, z: z1, cx: +(x0 + o.padMm / 2).toFixed(3), cy: +(y0 + o.padMm / 2).toFixed(3) });
  }

  const topZ = steps[steps.length - 1].z;
  // Backing up to the top of the base, filament under test for everything above it. The upper band
  // runs past any pad, so the tallest pad's last layer is still the test filament.
  //
  // `head` is 0-BASED here — the assembler writes extruder = head + 1, matching how
  // stackBandsToSwapBands numbers relief bands. Passing 1 and 2 puts the card on the U1's second and
  // third heads, which still slices and still prints, just with the wrong two spools.
  const bands = [
    { z0: 0, z1: baseZ, head: 0, hex: o.backingHex },
    { z0: baseZ, z1: 1000, head: 1, hex: o.testHex },
  ];

  const bytes = buildU1_3mf({
    triangles,
    bands,
    layerH: o.layerH,
    name: o.name ?? `td-swatch-${o.testHex.replace("#", "")}`,
    sizeMm: { x: width, y: depth, z: topZ },
    filaments: [o.backingHex, o.testHex],
  });
  return bytes ? { bytes, steps, layerH: o.layerH, baseZ, sizeMm: { x: width, y: depth, z: topZ } } : null;
}

// ---------------------------------------------------------------------------
// Fitting TD from the photographed card
// ---------------------------------------------------------------------------

export type Sample = { layers: number; rgb: [number, number, number] };

/**
 * Fit TD from sampled pad colours.
 *
 * The model relief mode uses: a layer stack of thickness T over a backing composites as
 *
 *     observed = filament + (backing - filament) * 10^(-T / TD)
 *
 * so the backing's contribution decays by a factor of ten every TD millimetres. Rearranged per
 * sample, TD = -T / log10(f), where f is how much of the backing still shows. Averaging per-sample
 * estimates rather than running an optimiser keeps this legible and dependency-free — and the samples
 * that carry real signal are the thin ones, so each is weighted by how much backing it still shows.
 *
 * `backing` and `opaque` are measured from the card itself: the bare backing slab, and the thickest
 * pad (which is the filament's own colour if the card was tall enough).
 */
export function solveTd(
  samples: Sample[],
  backing: [number, number, number],
  opaque: [number, number, number],
  layerH: number,
): { td: number; residual: number; used: number; drift: number } | null {
  const usable: { td: number; w: number }[] = [];
  for (const s of samples) {
    const T = s.layers * layerH;
    if (T <= 0) continue;
    // Per channel: how much of the backing→filament gap remains. Only channels where the two
    // endpoints actually differ carry information.
    const fs: number[] = [];
    for (let c = 0; c < 3; c++) {
      const span = backing[c] - opaque[c];
      if (Math.abs(span) < 12) continue; // too little contrast in this channel to measure
      const f = (s.rgb[c] - opaque[c]) / span;
      if (f > 0.02 && f < 0.98) fs.push(f); // saturated readings say nothing about the rate
    }
    if (!fs.length) continue;
    const f = fs.reduce((a, b) => a + b, 0) / fs.length;
    usable.push({ td: -T / Math.log10(f), w: f });
  }
  if (!usable.length) return null;
  const wsum = usable.reduce((n, u) => n + u.w, 0);
  const td = usable.reduce((n, u) => n + u.td * u.w, 0) / wsum;
  const residual = Math.sqrt(usable.reduce((n, u) => n + u.w * (u.td - td) ** 2, 0) / wsum);
  // DRIFT is the number that matters when a fit goes wrong. A single-TD model should give the same
  // answer at every thickness, scattered by noise; a steady slide from thin pads to thick ones is a
  // MODEL mismatch, and averaging a drifting series just reports where the weights sat. The first
  // real print did exactly that — per-pad estimates ran 2.43 down to 0.62 and the mean, 1.405, meant
  // nothing. Spearman-style: fraction of adjacent pairs that decrease, mapped to -1..1.
  // Ties count as NEITHER: a perfect single-TD fit produces identical estimates, and an earlier
  // version that only counted decreases scored that flawless case as maximum drift.
  //   0  = scatter or exact agreement (healthy)
  //  -1  = estimates fall steadily with thickness (what the first real print did)
  //  +1  = estimates rise steadily
  let up = 0, down = 0;
  for (let i = 1; i < usable.length; i++) {
    if (usable[i].td < usable[i - 1].td) down++;
    else if (usable[i].td > usable[i - 1].td) up++;
  }
  const drift = usable.length > 1 ? +((up - down) / (usable.length - 1)).toFixed(3) : 0;
  return { td: +td.toFixed(4), residual: +residual.toFixed(4), used: usable.length, drift };
}
