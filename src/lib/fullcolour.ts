// Full-colour front-lit print ("Full colour (CMY + white)" HueForge mode): a photo as a flat print
// that reads in full colour in ROOM light, on the Snapmaker U1's four heads.
//
// Written from first principles for Bed Ready, alongside the lithophane core it reuses
// (lithophane.ts: the filament filter model, the slab combination table and the slab meshes).
// Pure module — no DOM — so Khayt's HueForge area can port it with the lithophane.
//
// WHY A SECOND MODE. Today's HueForge (hueforge.ts) swaps filaments at fixed global heights, so a
// pixel only chooses a HEIGHT: every colour it can show lies on one 1-D path through four
// filaments, and a photo posterises onto that path. Here each pixel chooses how many layers of
// cyan, magenta and yellow sit in its own column — a 3-D set of colours — like a halftone print.
//
// THE PRINT (viewed from the top, light from the room)
//
//   z = 0 .. baseMm             a flat WHITE base: the reflector. Light that gets through the
//                               colour bounces off it and comes back out.
//   z = baseMm .. + N×layerH    the COLOUR SLAB, filled per column in a fixed order (C, M, Y, then
//                               white) exactly like the lithophane's — four solids that tile it.
//
// THE MODEL. Light crosses the slab twice (in, off the white, out), so a column's reflectance is
// the square of its one-way transmission: R_c = exp(-2 Σ thickness × k_f,c), k from each filament's
// hex and TD as in lithophane.ts. Brightness has no free thickness here (there is no backlight to
// dim), so darkness comes only from slab density; the photo is tone-mapped onto [darkest slab,
// white] and each pixel picks the nearest of the slab combinations by CIEDE2000, with error
// diffusion so neighbouring pixels mix (which is what makes a few hundred combinations read as a photo).
import { ciede2000 } from "./color-mix";
import {
  DEFAULT_CMYW, MeshBuilder, attenuation, boxBlur3, hexLin, labOfLin, linLum, resampleToGrid, slabCombos, slabMeshForHead, toSrgb,
  type IndexedMesh, type LithoFilament, type LithoImage, type LithoPart, type LithoPlan,
} from "./lithophane";

export type FullColourOptions = {
  widthMm?: number;
  heightMm?: number;
  crop?: { x: number; y: number; w: number; h: number };
  cellMm?: number;
  maxCells?: number;
  /** White base under the colour, mm. Thick enough to be an opaque reflector. */
  baseMm?: number;
  /** Colour slab: layers × layerH. */
  colourLayers?: number;
  layerH?: number;
  /** The 4 loaded filaments; the lightest is the white base. Default: translucent CMY + white. */
  filaments?: LithoFilament[];
  /** Error diffusion between pixels (default on). */
  diffuse?: boolean;
  /**
   * Scales each filament's colour-selective absorption (1 = the lithophane's model). Front-lit
   * light crosses the slab twice, and one 0.1 mm layer at full strength is already a strong colour
   * step; below 1 makes the steps finer. Default 0.5 (with 8 × 0.08 mm layers): chosen by rendering
   * a portrait and two colour photos — 1.0 turned skin into pink speckle on white. A seed until a
   * printed swatch card measures it.
   */
  satScale?: number;
};

export type FullColourPlan = LithoPlan & { baseMm: number; preview: Uint8ClampedArray };

const FC = { widthMm: 100, heightMm: 100, cellMm: 0.4, maxCells: 120_000, baseMm: 1.0, colourLayers: 8, layerH: 0.08, satScale: 0.5 } as const;
const fin = (v: unknown, fb: number) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : fb; };
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const DIFFUSE_GAIN = 0.85;

export function planFullColour(img: LithoImage, opts: FullColourOptions = {}): FullColourPlan {
  const widthMm = fin(opts.widthMm, FC.widthMm), heightMm = fin(opts.heightMm, FC.heightMm);
  let cellMm = Math.max(fin(opts.cellMm, FC.cellMm), Math.sqrt((widthMm * heightMm) / fin(opts.maxCells, FC.maxCells)));
  const gw = Math.max(2, Math.round(widthMm / cellMm)), gh = Math.max(2, Math.round(heightMm / cellMm));
  cellMm = widthMm / gw;
  const layerH = fin(opts.layerH, FC.layerH);
  const N = Math.round(clamp(fin(opts.colourLayers, FC.colourLayers), 1, 12));
  const baseMm = fin(opts.baseMm, FC.baseMm);
  const crop = opts.crop && opts.crop.w > 0 && opts.crop.h > 0 ? opts.crop : { x: 0, y: 0, w: img.width, h: img.height };
  const px = resampleToGrid(img, crop, gw, gh);
  const cells = gw * gh;

  const src = (opts.filaments && opts.filaments.length >= 2 ? opts.filaments : DEFAULT_CMYW).slice(0, 4);
  const fils = src.map((f) => ({ hex: String(f.hex || "#FFFFFF").toUpperCase(), td: fin(f.td, 3) }));
  let whiteHead = 0, best = -1;
  fils.forEach((f, i) => { const [r, g, b] = hexLin(f.hex); const l = linLum(r, g, b); if (l > best) { best = l; whiteHead = i; } });
  const heads = fils.length;
  const slabOrder = fils.map((_f, i) => i).filter((i) => i !== whiteHead);
  const sat = Number(opts.satScale) > 0 ? Number(opts.satScale) : FC.satScale;
  const att = fils.map((f) => {
    const base = Math.log(10) / Math.max(0.05, f.td);
    return attenuation(f).map((k) => base + (k - base) * sat);
  });

  // Reflectance of each slab combination, relative to an all-white slab (white reads as white).
  const combos = slabCombos(slabOrder.length, N);
  const oneWay = (cnt: number[]) => [0, 1, 2].map((ch) => {
    const used = cnt.reduce((s, c) => s + c, 0);
    let k = (N - used) * layerH * att[whiteHead][ch];
    cnt.forEach((c, i) => { k += c * layerH * att[slabOrder[i]][ch]; });
    return Math.exp(-k);
  });
  const ref = oneWay(slabOrder.map(() => 0));
  const R = combos.map((cnt) => oneWay(cnt).map((t, ch) => (t / ref[ch]) ** 2));
  const RLab = R.map((r) => labOfLin(r[0], r[1], r[2]));
  const floor = Math.min(...R.map((r) => linLum(r[0], r[1], r[2])));

  const tgt = new Float32Array(cells * 3);
  for (let c = 0; c < cells; c++) for (let ch = 0; ch < 3; ch++) tgt[c * 3 + ch] = floor + (1 - floor) * px[c * 4 + ch];
  const orig = tgt.slice();
  const cache = new Map<number, number>();
  const pick = (t: number[]) => {
    const key = (Math.round(clamp(t[0], 0, 1) * 63) << 12) | (Math.round(clamp(t[1], 0, 1) * 63) << 6) | Math.round(clamp(t[2], 0, 1) * 63);
    let k = cache.get(key);
    if (k === undefined) {
      const tl = labOfLin(clamp(t[0], 0, 1), clamp(t[1], 0, 1), clamp(t[2], 0, 1));
      let bd = Infinity; k = 0;
      for (let i = 0; i < R.length; i++) { const d = ciede2000(tl, RLab[i]); if (d < bd) { bd = d; k = i; } }
      cache.set(key, k);
    }
    return k;
  };

  const counts = new Uint8Array(cells * heads);
  const lit = new Float32Array(cells * 3);
  const diffuse = opts.diffuse !== false;
  let deSum = 0;
  for (let j = 0; j < gh; j++) {
    const ltr = j % 2 === 0;
    for (let s = 0; s < gw; s++) {
      const i = ltr ? s : gw - 1 - s;
      const c = j * gw + i;
      const t = [tgt[c * 3], tgt[c * 3 + 1], tgt[c * 3 + 2]];
      const k = pick(t);
      const r = R[k];
      if (diffuse) {
        const dir = ltr ? 1 : -1;
        for (let ch = 0; ch < 3; ch++) {
          const err = DIFFUSE_GAIN * clamp(t[ch] - r[ch], -0.2, 0.2);
          const add = (di: number, dj: number, w: number) => {
            const i2 = i + di, j2 = j + dj;
            if (i2 < 0 || i2 >= gw || j2 >= gh) return;
            tgt[(j2 * gw + i2) * 3 + ch] += err * w;
          };
          add(dir, 0, 7 / 16); add(-dir, 1, 3 / 16); add(0, 1, 5 / 16); add(dir, 1, 1 / 16);
        }
      }
      let used = 0;
      combos[k].forEach((v, n) => { counts[c * heads + slabOrder[n]] = v; used += v; });
      counts[c * heads + whiteHead] = N - used;
      for (let ch = 0; ch < 3; ch++) lit[c * 3 + ch] = r[ch];
    }
  }
  // At arm's length a 0.4 mm dither blends; the preview shows it blended (one-cell box blur).
  const blurred = boxBlur3(lit, gw, gh, 1);
  const preview = new Uint8ClampedArray(cells * 4);
  // Scored as the eye sees it (blended), against the tone-mapped photo — a per-pixel score would
  // count the dither itself as error.
  for (let c = 0; c < cells; c++) deSum += ciede2000(labOfLin(orig[c * 3], orig[c * 3 + 1], orig[c * 3 + 2]), labOfLin(blurred[c * 3], blurred[c * 3 + 1], blurred[c * 3 + 2]));
  for (let c = 0; c < cells; c++) {
    preview[c * 4] = toSrgb(blurred[c * 3]); preview[c * 4 + 1] = toSrgb(blurred[c * 3 + 1]); preview[c * 4 + 2] = toSrgb(blurred[c * 3 + 2]); preview[c * 4 + 3] = 255;
  }
  return {
    mode: "colour", gw, gh, cellMm, layerH, colourLayers: N, colourBlock: 1,
    // The slab sits on the base: reuse the lithophane's "front layer" offset for it.
    whiteFrontMm: baseMm, minMm: 0, maxMm: 0,
    filaments: fils, whiteHead, slabOrder, counts,
    thickness: new Float32Array(cells), backlit: preview, frontlit: preview,
    meanDeltaE: deSum / cells, baseMm, preview,
  };
}

/** Mirror a mesh in X about x = w/2 (and fix the winding): the lithophane is read from its flat
 *  face, so its slab is built mirrored; a front-lit print is read from the top, so undo that. */
function reflectX(m: IndexedMesh, w: number): IndexedMesh {
  const p = Float32Array.from(m.positions);
  for (let i = 0; i < p.length; i += 3) p[i] = w - p[i];
  const ix = Uint32Array.from(m.indices);
  for (let t = 0; t < ix.length; t += 3) { const a = ix[t + 1]; ix[t + 1] = ix[t + 2]; ix[t + 2] = a; }
  return { positions: p, indices: ix };
}

function box(w: number, h: number, d: number): IndexedMesh {
  const m = new MeshBuilder();
  const a = (x: number, y: number, z: number) => m.v(x, y, z);
  m.quad(a(0, 0, d), a(w, 0, d), a(w, h, d), a(0, h, d));
  m.quad(a(0, 0, 0), a(0, h, 0), a(w, h, 0), a(w, 0, 0));
  m.quad(a(0, 0, 0), a(w, 0, 0), a(w, 0, d), a(0, 0, d));
  m.quad(a(0, h, 0), a(0, h, d), a(w, h, d), a(w, h, 0));
  m.quad(a(0, 0, 0), a(0, 0, d), a(0, h, d), a(0, h, 0));
  m.quad(a(w, 0, 0), a(w, h, 0), a(w, h, d), a(w, 0, d));
  return m.done();
}

/** The base plus the four slab solids, read from the top. */
export function fullColourParts(plan: FullColourPlan): LithoPart[] {
  const W = plan.gw * plan.cellMm, H = plan.gh * plan.cellMm;
  const parts: LithoPart[] = [{ hex: plan.filaments[plan.whiteHead].hex, head: plan.whiteHead, name: "white base", mesh: box(W, H, plan.baseMm) }];
  for (const h of [...plan.slabOrder, plan.whiteHead]) {
    const mesh = slabMeshForHead(plan, h);
    if (mesh.indices.length) parts.push({ hex: plan.filaments[h].hex, head: h, name: h === plan.whiteHead ? "colour layer white" : `colour layer ${h + 1}`, mesh: reflectX(mesh, W) });
  }
  return parts;
}
