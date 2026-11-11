// Lithophane maker: a photo -> a backlit print, in full colour on the Snapmaker U1 or classic white.
//
// Written from first principles for Bed Ready (no code taken from any other lithophane or HueForge-
// style tool). Pure module: no DOM, no React, no fetch — so Khayt can port it the way it ported
// planPainting. Everything here takes plain arrays and returns plain arrays.
//
// THE MODEL
//
// A lithophane is looked at with a light behind it. What reaches the eye at a point is the light
// that got through every layer of plastic in that point's column. Each filament f is treated as a
// filter with a per-channel attenuation coefficient k_f,c (1/mm, linear light):
//
//     transmitted_c = exp(-Σ_layers thickness × k_f,c)
//
// so a column's colour is the PRODUCT of its layers, and the order of the layers inside a column
// does not change what is seen with the light on. k comes from two numbers we already have for
// every filament: its colour (hex) and its TD (transmission distance — the thickness at which it
// passes ~10% of the light, the same meaning hueforge.ts gives it):
//
//     k_f,c = ln(10)/TD                           a neutral part: thicker = darker, every channel
//           + -ln(max(colour_c, 0.03)) / SAT_MM   a selective part: cyan blocks red, and so on
//
// SAT_MM (0.25 mm) is how much of a colour it takes to show that colour strongly. It is a seed to be
// replaced by a printed swatch measurement, not a known constant.
//
// White has no selective part, so white plastic only dims. That is the classic lithophane.
//
// THE PRINT (bottom of the bed = the face you look at)
//
//   z = 0 .. N×layerH      the COLOUR SLAB: N thin layers (default 5 × 0.1 mm). In every pixel
//                          column the slab is filled in a fixed order — colour head A for a layers,
//                          then B for b, then C for c, then white for the rest. One order for every
//                          pixel means each head's share of a column is ONE contiguous run, so the
//                          slab is four simple solids that tile it exactly (no gaps, no overlap —
//                          light that leaks past the colour would wash it out).
//   above                  the WHITE HEIGHTFIELD, min..max mm thick, that carries the light and shade.
//
// The image is mirrored in X so it reads correctly from the flat face.
//
// THE SOLVER
//
// A pixel's target colour is split into "how bright" and "what colour". For every combination of
// counts (a, b, c) with a+b+c ≤ N (56 of them for N = 5) we know the slab's filter; the white
// thickness then scales it. For each pixel we try each combination at the brightness that best
// matches the target and keep the one with the smallest CIEDE2000 — the same metric the rest of
// the site uses. Unique colours are cached, so a photo costs a few hundred thousand ΔE calls.
//
// Black maps to the darkest the whole column can go — thickest white AND the densest slab — so
// shadows use dense C+M+Y. Mapping black to the thickest white alone (the first version) left every
// dark area a light grey: sRGB ~100 for the darkest 5% of a portrait, against ~20 now.
//
// Classic mode is the same without the slab: white thickness only.
import { ciede2000, rgbToLab, type Lab } from "./color-mix";

export type LithoImage = { data: Uint8ClampedArray; width: number; height: number };
export type LithoFilament = { hex: string; td?: number; name?: string };
export type LithoMode = "colour" | "classic";

export type LithoOptions = {
  mode?: LithoMode;
  /** Printed width and height of the picture, mm. */
  widthMm?: number;
  heightMm?: number;
  /** Source rectangle (pixels) to use; the whole image when absent. Stretched to width×height. */
  crop?: { x: number; y: number; w: number; h: number };
  /** Pixel size on the print, mm. Raised automatically when the grid would exceed maxCells. */
  cellMm?: number;
  maxCells?: number;
  /** White heightfield thickness range, mm (on top of the colour slab in colour mode). */
  minMm?: number;
  maxMm?: number;
  layerH?: number;
  /** Colour slab layers (colour mode). */
  colourLayers?: number;
  /** The 4 loaded filaments (colour mode). The lightest is used as the white. */
  filaments?: LithoFilament[];
  /** TD of the white used for the heightfield, mm. */
  whiteTd?: number;
  /**
   * Spread each pixel's colour error to its neighbours (error diffusion). With only N layers there
   * are 56 slab colours; diffusing the error lets neighbouring pixels mix them, so a gradient reads
   * as a gradient instead of bands. On by default.
   */
  diffuse?: boolean;
  /**
   * Where black maps to. "slab" (default): the darkest the WHOLE column can go — thickest white
   * plus the densest colour slab — so shadows use dense C+M+Y instead of stopping at grey white.
   * "white": the darkest the white alone reaches (the first version; washed-out darks).
   */
  shadows?: "slab" | "white";
  /** Tone curve on the photo (linear light) before mapping: >1 deepens the mid-shadows. Default 1. */
  gamma?: number;
};

export type LithoPlan = {
  mode: LithoMode;
  gw: number;
  gh: number;
  cellMm: number;
  layerH: number;
  colourLayers: number;
  minMm: number;
  maxMm: number;
  /** Filaments by head (colour: 4; classic: 1). */
  filaments: Required<Pick<LithoFilament, "hex" | "td">>[];
  whiteHead: number;
  /** Colour heads in slab order (bottom first), white excluded. */
  slabOrder: number[];
  /** Per cell (row-major, image orientation), the slab layer count of each head: counts[cell*heads + head]. */
  counts: Uint8Array;
  /** Per cell, the white heightfield thickness, mm. */
  thickness: Float32Array;
  /** Predicted look, RGBA gw×gh, image orientation. */
  backlit: Uint8ClampedArray;
  frontlit: Uint8ClampedArray;
  /** Mean CIEDE2000 of each pixel's slab colour against its target (after error diffusion). */
  meanDeltaE: number;
};

/** An indexed triangle mesh. Triangles are counter-clockwise seen from outside. */
export type IndexedMesh = { positions: Float32Array; indices: Uint32Array };

export const LITHO_DEFAULTS = {
  widthMm: 100,
  heightMm: 140,
  cellMm: 0.4,
  maxCells: 120_000,
  minMm: 0.8,
  maxMm: 3.0,
  layerH: 0.1,
  colourLayers: 5,
  whiteTd: 2.5,
} as const;

/** Translucent CMY + white: the set the colour mode is tuned for. TDs are seeds, not measurements. */
export const DEFAULT_CMYW: LithoFilament[] = [
  { hex: "#00A3E0", td: 3, name: "Cyan" },
  { hex: "#E4007C", td: 3, name: "Magenta" },
  { hex: "#FFE500", td: 3, name: "Yellow" },
  { hex: "#FFFFFF", td: 2.5, name: "White" },
];

const LN10 = Math.log(10);
/**
 * How much of a pixel's colour error is passed on. Full Floyd–Steinberg (1.0) reaches the right
 * average colour but reads as speckle at 0.4 mm; 0.7 keeps gradients smooth with far less noise.
 */
const DIFFUSE_GAIN = 0.7;
/** Selective-absorption depth, mm (see the header). */
export const SAT_MM = 0.25;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const fin = (v: unknown, fb: number) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : fb; };
const toLin = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const toSrgb = (c: number) => { c = clamp(c, 0, 1); return 255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055); };
const linLum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function hexLin(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  const v = m ? parseInt(m[1], 16) : 0xffffff;
  return [toLin((v >> 16) & 255), toLin((v >> 8) & 255), toLin(v & 255)];
}
const labOfLin = (r: number, g: number, b: number): Lab => rgbToLab({ r: toSrgb(r), g: toSrgb(g), b: toSrgb(b) });

/** Sideways spread of light in the white before it leaves the print, mm. A preview estimate. */
const SCATTER_MM = 0.4;

/** Separable box blur of radius r on a 3-channel float image. */
function boxBlur3(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) for (let ch = 0; ch < 3; ch++) {
    let s = 0, n = 0;
    for (let d = -r; d <= r; d++) { const x = i + d; if (x < 0 || x >= w) continue; s += src[(j * w + x) * 3 + ch]; n++; }
    tmp[(j * w + i) * 3 + ch] = s / n;
  }
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) for (let ch = 0; ch < 3; ch++) {
    let s = 0, n = 0;
    for (let d = -r; d <= r; d++) { const y = j + d; if (y < 0 || y >= h) continue; s += tmp[(y * w + i) * 3 + ch]; n++; }
    out[(j * w + i) * 3 + ch] = s / n;
  }
  return out;
}

/** Per-channel attenuation (1/mm) of a filament. Exported for tests and the preview. */
export function attenuation(f: { hex: string; td: number }): [number, number, number] {
  const td = Math.max(0.05, f.td);
  const base = LN10 / td;
  return hexLin(f.hex).map((c) => base + -Math.log(Math.max(c, 0.03)) / SAT_MM) as [number, number, number];
}

/** Every way to fill `n` layers from `k` colour heads (counts sum ≤ n); the rest is white. */
export function slabCombos(k: number, n: number): number[][] {
  const out: number[][] = [];
  const rec = (i: number, left: number, cur: number[]) => {
    if (i === k) { out.push(cur.slice()); return; }
    for (let c = 0; c <= left; c++) { cur.push(c); rec(i + 1, left - c, cur); cur.pop(); }
  };
  rec(0, n, []);
  return out;
}

/** Area-average the crop into a gw×gh grid of linear RGB (+ alpha 0..1). */
function resample(img: LithoImage, crop: { x: number; y: number; w: number; h: number }, gw: number, gh: number) {
  const out = new Float32Array(gw * gh * 4);
  const sx = crop.w / gw, sy = crop.h / gh;
  for (let j = 0; j < gh; j++) {
    const y0 = crop.y + j * sy, y1 = y0 + sy;
    for (let i = 0; i < gw; i++) {
      const x0 = crop.x + i * sx, x1 = x0 + sx;
      let r = 0, g = 0, b = 0, a = 0, w = 0;
      for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy++) {
        if (yy < 0 || yy >= img.height) continue;
        const wy = Math.min(y1, yy + 1) - Math.max(y0, yy);
        for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx++) {
          if (xx < 0 || xx >= img.width) continue;
          const wt = wy * (Math.min(x1, xx + 1) - Math.max(x0, xx));
          if (wt <= 0) continue;
          const o = (yy * img.width + xx) * 4;
          const al = img.data[o + 3] / 255;
          // Transparent pixels read as white: a lithophane has no "nothing", only light.
          r += wt * (al * toLin(img.data[o]) + (1 - al));
          g += wt * (al * toLin(img.data[o + 1]) + (1 - al));
          b += wt * (al * toLin(img.data[o + 2]) + (1 - al));
          a += wt * al; w += wt;
        }
      }
      const q = (j * gw + i) * 4;
      if (w > 0) { out[q] = r / w; out[q + 1] = g / w; out[q + 2] = b / w; out[q + 3] = a / w; }
      else { out[q] = out[q + 1] = out[q + 2] = 1; out[q + 3] = 0; }
    }
  }
  return out;
}

function normalise(o: LithoOptions) {
  const mode: LithoMode = o.mode === "classic" ? "classic" : "colour";
  const widthMm = fin(o.widthMm, LITHO_DEFAULTS.widthMm);
  const heightMm = fin(o.heightMm, LITHO_DEFAULTS.heightMm);
  const maxCells = fin(o.maxCells, LITHO_DEFAULTS.maxCells);
  let cellMm = fin(o.cellMm, LITHO_DEFAULTS.cellMm);
  // Never finer than the grid cap: a 270 mm print at 0.4 mm would be 455k cells, millions of
  // triangles and a file no browser should be asked to write.
  cellMm = Math.max(cellMm, Math.sqrt((widthMm * heightMm) / maxCells));
  const gw = Math.max(2, Math.round(widthMm / cellMm));
  const gh = Math.max(2, Math.round(heightMm / cellMm));
  cellMm = widthMm / gw; // exact width; height follows the same pitch (square cells)
  const minMm = fin(o.minMm, LITHO_DEFAULTS.minMm);
  const maxMm = Math.max(minMm + 0.1, fin(o.maxMm, LITHO_DEFAULTS.maxMm));
  const layerH = fin(o.layerH, LITHO_DEFAULTS.layerH);
  const colourLayers = mode === "classic" ? 0 : Math.round(clamp(fin(o.colourLayers, LITHO_DEFAULTS.colourLayers), 1, 12));
  return { mode, widthMm, heightMm, gw, gh, cellMm, minMm, maxMm, layerH, colourLayers, whiteTd: fin(o.whiteTd, LITHO_DEFAULTS.whiteTd) };
}

/** Plan a lithophane: per-cell slab counts and white thickness, plus the predicted look. */
export function planLithophane(img: LithoImage, opts: LithoOptions = {}): LithoPlan {
  const n = normalise(opts);
  const { gw, gh, mode, layerH, colourLayers: N, minMm, maxMm } = n;
  const crop = opts.crop && opts.crop.w > 0 && opts.crop.h > 0 ? opts.crop : { x: 0, y: 0, w: img.width, h: img.height };
  const px = resample(img, crop, gw, gh);
  const cells = gw * gh;

  // Filaments and which one is "white".
  let fils: { hex: string; td: number }[];
  let whiteHead = 0;
  if (mode === "classic") {
    fils = [{ hex: "#FFFFFF", td: n.whiteTd }];
  } else {
    const src = (opts.filaments && opts.filaments.length >= 2 ? opts.filaments : DEFAULT_CMYW).slice(0, 4);
    fils = src.map((f) => ({ hex: String(f.hex || "#FFFFFF").toUpperCase(), td: fin(f.td, 3) }));
    let best = -1;
    fils.forEach((f, i) => { const [r, g, b] = hexLin(f.hex); const l = linLum(r, g, b); if (l > best) { best = l; whiteHead = i; } });
  }
  const heads = fils.length;
  const slabOrder = fils.map((_f, i) => i).filter((i) => i !== whiteHead);
  const att = fils.map(attenuation);
  // The heightfield is white plastic of the white's TD (or the white TD option in classic mode).
  const kW = mode === "classic" ? LN10 / n.whiteTd : LN10 / Math.max(0.05, fils[whiteHead].td);

  // Slab filters, relative to an all-white slab (so the white filament defines "white").
  const combos = mode === "classic" ? [[]] : slabCombos(slabOrder.length, N);
  const filt = combos.map((cnt) => {
    const used = cnt.reduce((s, c) => s + c, 0);
    const T = [0, 1, 2].map((ch) => {
      let k = (N - used) * layerH * att[whiteHead][ch];
      cnt.forEach((c, i) => { k += c * layerH * att[slabOrder[i]][ch]; });
      return Math.exp(-k);
    });
    return T;
  });
  const ref = filt[0].map((v, ch) => (mode === "classic" ? 1 : Math.exp(-N * layerH * att[whiteHead][ch])));
  const Q = filt.map((T) => T.map((v, ch) => v / ref[ch]));
  const QY = Q.map((q) => linLum(q[0], q[1], q[2]));
  // Darkest the heightfield alone can go, relative to the thinnest.
  const rMin = Math.exp(-kW * (maxMm - minMm));

  const counts = new Uint8Array(cells * heads);
  const thickness = new Float32Array(cells);
  const backlit = new Uint8ClampedArray(cells * 4);
  const frontlit = new Uint8ClampedArray(cells * 4);
  const cache = new Map<number, { k: number; rho: number; de: number }>();
  const lit = new Float32Array(cells * 3);
  let deSum = 0;

  // Tone-mapped targets in linear light: black → the darkest heightfield, white → white.
  const tgt = new Float32Array(cells * 3);
  // The darkest column: thickest white times the densest slab (colour mode, unless shadows: "white").
  const floor = rMin * (mode === "colour" && opts.shadows !== "white" ? Math.min(...QY) : 1);
  const gamma = fin(opts.gamma, 1);
  for (let c = 0; c < cells; c++) for (let ch = 0; ch < 3; ch++) tgt[c * 3 + ch] = floor + (1 - floor) * Math.pow(px[c * 4 + ch], gamma);
  const diffuse = opts.diffuse !== false && mode === "colour";
  const pick = (t: number[]) => {
    const key = (Math.round(clamp(t[0], 0, 1) * 63) << 12) | (Math.round(clamp(t[1], 0, 1) * 63) << 6) | Math.round(clamp(t[2], 0, 1) * 63);
    let hit = cache.get(key);
    if (!hit) {
      const tc = t.map((v) => clamp(v, 0, 1));
      const tLab = labOfLin(tc[0], tc[1], tc[2]);
      const tY = linLum(tc[0], tc[1], tc[2]);
      let bk = 0, br = 1, bd = Infinity;
      for (let k = 0; k < Q.length; k++) {
        const rho = clamp(QY[k] > 1e-6 ? tY / QY[k] : 1, rMin, 1);
        const q = Q[k];
        const de = ciede2000(tLab, labOfLin(q[0] * rho, q[1] * rho, q[2] * rho));
        if (de < bd) { bd = de; bk = k; br = rho; }
      }
      hit = { k: bk, rho: br, de: bd };
      cache.set(key, hit);
    }
    return hit;
  };

  for (let jj = 0; jj < gh; jj++) {
    // Serpentine rows, so the error does not drift one way across the picture.
    const ltr = jj % 2 === 0;
    for (let s = 0; s < gw; s++) {
      const ii = ltr ? s : gw - 1 - s;
      const c = jj * gw + ii;
      const t = [tgt[c * 3], tgt[c * 3 + 1], tgt[c * 3 + 2]];
      const hit = pick(t);
      if (diffuse) {
        const q = Q[hit.k];
        const dir = ltr ? 1 : -1;
        for (let ch = 0; ch < 3; ch++) {
          // Clamp what is passed on: an unreachable colour must not snowball into its neighbours.
          const err = DIFFUSE_GAIN * clamp(t[ch] - q[ch] * hit.rho, -0.15, 0.15);
          const add = (di: number, dj: number, w: number) => {
            const i2 = ii + di, j2 = jj + dj;
            if (i2 < 0 || i2 >= gw || j2 >= gh) return;
            tgt[(j2 * gw + i2) * 3 + ch] += err * w;
          };
          add(dir, 0, 7 / 16); add(-dir, 1, 3 / 16); add(0, 1, 5 / 16); add(dir, 1, 1 / 16);
        }
      }
    deSum += hit.de;
    const cnt = combos[hit.k];
    let used = 0;
    cnt.forEach((v, i) => { counts[c * heads + slabOrder[i]] = v; used += v; });
    if (mode === "colour") counts[c * heads + whiteHead] = N - used;
    thickness[c] = minMm + -Math.log(hit.rho) / kW;

    const q = Q[hit.k];
    for (let ch = 0; ch < 3; ch++) lit[c * 3 + ch] = q[ch] * hit.rho;

    // Light off: what the face shows in room light — the slab composited from the viewing face
    // inwards over the white bulk (each layer covers 1 - 10^(-h/TD) of what is behind it).
    let fr = 0, fg = 0, fb = 0, cover = 1;
    const shade = 0.82 + 0.12 * ((thickness[c] - minMm) / (maxMm - minMm)); // thicker reads a touch brighter
    if (mode === "colour") {
      const seq = [...slabOrder, whiteHead];
      for (const h of seq) {
        const lay = counts[c * heads + h];
        if (!lay) continue;
        const a = 1 - Math.pow(0.1, (lay * layerH) / Math.max(0.05, fils[h].td));
        const [r, g, b] = hexLin(fils[h].hex);
        fr += cover * a * r; fg += cover * a * g; fb += cover * a * b; cover *= 1 - a;
      }
    }
    fr += cover; fg += cover; fb += cover;
    frontlit[c * 4] = toSrgb(fr * shade); frontlit[c * 4 + 1] = toSrgb(fg * shade); frontlit[c * 4 + 2] = toSrgb(fb * shade); frontlit[c * 4 + 3] = 255;
    }
  }

  // Light spreads sideways inside the white before it leaves the print, so neighbouring cells blend.
  // A small blur stands in for that; without it the preview shows a speckle the print does not.
  const r = Math.max(1, Math.round(SCATTER_MM / n.cellMm));
  const blurred = boxBlur3(lit, gw, gh, r);
  for (let c = 0; c < cells; c++) {
    backlit[c * 4] = toSrgb(blurred[c * 3]); backlit[c * 4 + 1] = toSrgb(blurred[c * 3 + 1]); backlit[c * 4 + 2] = toSrgb(blurred[c * 3 + 2]); backlit[c * 4 + 3] = 255;
  }

  return {
    mode, gw, gh, cellMm: n.cellMm, layerH, colourLayers: N, minMm, maxMm,
    filaments: fils, whiteHead, slabOrder, counts, thickness, backlit, frontlit,
    meanDeltaE: deSum / cells,
  };
}

// ---------------------------------------------------------------------------------------------
// Geometry. Print coordinates: x = (gw - i) × cell for image column i (mirrored, so the picture
// reads right from the flat face), y = (gh - j) × cell for image row j (row 0 at the top), z up.

class MeshBuilder {
  pos: number[] = [];
  idx: number[] = [];
  map = new Map<string, number>();
  v(x: number, y: number, z: number): number {
    const k = x.toFixed(4) + "," + y.toFixed(4) + "," + z.toFixed(4);
    let i = this.map.get(k);
    if (i === undefined) { i = this.pos.length / 3; this.pos.push(x, y, z); this.map.set(k, i); }
    return i;
  }
  quad(a: number, b: number, c: number, d: number) { this.idx.push(a, b, c, a, c, d); }
  done(): IndexedMesh { return { positions: Float32Array.from(this.pos), indices: Uint32Array.from(this.idx) }; }
}

/**
 * One head's share of the colour slab: in every cell, the run of layers [z0, z1) that head fills.
 * Walls are emitted one layer at a time so every vertex sits on the cell/layer lattice — that is
 * what makes the four heads' solids watertight and seam-to-seam with each other.
 */
export function slabMeshForHead(plan: LithoPlan, head: number): IndexedMesh {
  const { gw, gh, cellMm: s, layerH } = plan;
  const heads = plan.filaments.length;
  const order = [...plan.slabOrder, plan.whiteHead];
  const pos = order.indexOf(head);
  const run = (i: number, j: number): [number, number] | null => {
    if (i < 0 || j < 0 || i >= gw || j >= gh) return null;
    const c = j * gw + i;
    let z0 = 0;
    for (let k = 0; k < pos; k++) z0 += plan.counts[c * heads + order[k]];
    const n = plan.counts[c * heads + head];
    return n ? [z0, z0 + n] : null;
  };
  const m = new MeshBuilder();
  const X = (i: number) => (gw - i) * s;
  const Y = (j: number) => (gh - j) * s;
  const Z = (l: number) => l * layerH;
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      const r = run(i, j);
      if (!r) continue;
      // Corners: x runs right-to-left as i grows, y top-to-bottom as j grows.
      const xa = X(i + 1), xb = X(i), ya = Y(j + 1), yb = Y(j);
      const [l0, l1] = r;
      // top (+z) and bottom (-z)
      m.quad(m.v(xa, ya, Z(l1)), m.v(xb, ya, Z(l1)), m.v(xb, yb, Z(l1)), m.v(xa, yb, Z(l1)));
      m.quad(m.v(xa, ya, Z(l0)), m.v(xa, yb, Z(l0)), m.v(xb, yb, Z(l0)), m.v(xb, ya, Z(l0)));
      // Four sides, layer by layer, wherever the neighbour does not hold this head at that layer.
      for (let l = l0; l < l1; l++) {
        const za = Z(l), zb = Z(l + 1);
        const has = (ii: number, jj: number) => { const q = run(ii, jj); return !!q && q[0] <= l && l < q[1]; };
        // -x side is image column i+1 (x decreases as i grows): face at x = xa, normal -x
        if (!has(i + 1, j)) m.quad(m.v(xa, ya, za), m.v(xa, ya, zb), m.v(xa, yb, zb), m.v(xa, yb, za));
        // +x side, image column i-1: face at x = xb, normal +x
        if (!has(i - 1, j)) m.quad(m.v(xb, ya, za), m.v(xb, yb, za), m.v(xb, yb, zb), m.v(xb, ya, zb));
        // -y side, image row j+1: face at y = ya, normal -y
        if (!has(i, j + 1)) m.quad(m.v(xa, ya, za), m.v(xb, ya, za), m.v(xb, ya, zb), m.v(xa, ya, zb));
        // +y side, image row j-1: face at y = yb, normal +y
        if (!has(i, j - 1)) m.quad(m.v(xa, yb, za), m.v(xa, yb, zb), m.v(xb, yb, zb), m.v(xb, yb, za));
      }
    }
  }
  return m.done();
}

/**
 * The white heightfield: a closed solid from z = base to base + thickness, its top a smooth surface
 * through the cell corners (each corner the mean of the cells around it), its bottom flat.
 */
export function heightfieldMesh(plan: LithoPlan): IndexedMesh {
  const { gw, gh, cellMm: s, thickness } = plan;
  const base = plan.colourLayers * plan.layerH;
  const W = gw + 1, H = gh + 1;
  const top = new Float32Array(W * H);
  for (let cj = 0; cj < H; cj++) for (let ci = 0; ci < W; ci++) {
    let sum = 0, cnt = 0;
    for (const [i, j] of [[ci - 1, cj - 1], [ci, cj - 1], [ci - 1, cj], [ci, cj]]) {
      if (i < 0 || j < 0 || i >= gw || j >= gh) continue;
      sum += thickness[j * gw + i]; cnt++;
    }
    top[cj * W + ci] = base + sum / cnt;
  }
  const pos = new Float32Array(W * H * 2 * 3);
  const X = (ci: number) => (gw - ci) * s, Y = (cj: number) => (gh - cj) * s;
  for (let cj = 0; cj < H; cj++) for (let ci = 0; ci < W; ci++) {
    const v = cj * W + ci;
    pos.set([X(ci), Y(cj), top[v]], v * 3);
    pos.set([X(ci), Y(cj), base], (W * H + v) * 3);
  }
  const T = (ci: number, cj: number) => cj * W + ci;
  const B = (ci: number, cj: number) => W * H + cj * W + ci;
  const idx: number[] = [];
  const quad = (a: number, b: number, c: number, d: number) => idx.push(a, b, c, a, c, d);
  for (let cj = 0; cj < gh; cj++) for (let ci = 0; ci < gw; ci++) {
    // corner (ci+1) has the smaller x; (cj+1) the smaller y
    quad(T(ci + 1, cj + 1), T(ci, cj + 1), T(ci, cj), T(ci + 1, cj));
    quad(B(ci + 1, cj + 1), B(ci + 1, cj), B(ci, cj), B(ci, cj + 1));
  }
  for (let ci = 0; ci < gw; ci++) {
    // y min edge (cj = gh), normal -y; y max edge (cj = 0), normal +y
    quad(B(ci + 1, gh), B(ci, gh), T(ci, gh), T(ci + 1, gh));
    quad(B(ci + 1, 0), T(ci + 1, 0), T(ci, 0), B(ci, 0));
  }
  for (let cj = 0; cj < gh; cj++) {
    // x min edge (ci = gw), normal -x; x max edge (ci = 0), normal +x
    quad(B(gw, cj + 1), T(gw, cj + 1), T(gw, cj), B(gw, cj));
    quad(B(0, cj + 1), B(0, cj), T(0, cj), T(0, cj + 1));
  }
  return { positions: pos, indices: Uint32Array.from(idx) };
}

export type LithoPart = { hex: string; head: number; name: string; mesh: IndexedMesh };

/** Every solid in the print, one per (head, role). The white head owns the slab fill and the heightfield. */
export function lithophaneParts(plan: LithoPlan): LithoPart[] {
  const parts: LithoPart[] = [];
  if (plan.mode === "colour") {
    for (const h of [...plan.slabOrder, plan.whiteHead]) {
      const mesh = slabMeshForHead(plan, h);
      if (mesh.indices.length) parts.push({ hex: plan.filaments[h].hex, head: h, name: h === plan.whiteHead ? "colour layer white" : `colour layer ${h + 1}`, mesh });
    }
  }
  parts.push({ hex: plan.filaments[plan.whiteHead].hex, head: plan.whiteHead, name: "lithophane", mesh: heightfieldMesh(plan) });
  return parts;
}

/** Signed volume of a closed mesh (mm³) — positive when its faces point outwards. */
export function meshVolume(m: IndexedMesh): number {
  const p = m.positions, ix = m.indices;
  let v = 0;
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3;
    v += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1])
       - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c])
       + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return v / 6;
}

/**
 * A lazy Triangle[] for writers that walk triangles (hueforge-3mf). A real (sparse) array, because
 * the writer checks Array.isArray, whose iterator builds each triangle on demand — a million
 * triangles as nested arrays would cost hundreds of MB in the browser for nothing.
 */
export function asTriangles(m: IndexedMesh): number[][][] {
  const n = m.indices.length / 3;
  const p = m.positions, ix = m.indices;
  const at = (k: number) => [p[ix[k] * 3], p[ix[k] * 3 + 1], p[ix[k] * 3 + 2]];
  const view = new Array(n) as number[][][];
  Object.defineProperty(view, Symbol.iterator, {
    value: function* () { for (let t = 0; t < n; t++) yield [at(t * 3), at(t * 3 + 1), at(t * 3 + 2)]; },
  });
  return view;
}
