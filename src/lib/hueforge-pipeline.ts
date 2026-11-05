// Photo -> HueForge relief -> Snapmaker U1 3MF, in one call.
//
// Wires the ported engine (hueforge.ts) to the ported assembler (hueforge-3mf.ts) so the page doesn't
// have to know the order of operations. Pure and DOM-free: the caller turns a File into RGBA pixels
// (canvas drawImage + getImageData), this takes it from pixels onward.
//
// HOW THIS DIFFERS FROM THE EXISTING /image MODE. image-model.ts quantises to <=4 flat colours and
// paints the top surface — one opaque colour per XY region, no light mixing, and the optional
// "relief" there is just a brightness bump for texture. This module does the actual HueForge thing:
// surface HEIGHT varies per pixel, filaments swap at global Z heights, and the visible colour at any
// point is the transmission composite of every layer beneath it. That's what buys photographic
// gradients from four spools.
import {
  heightfieldToMesh, suggestFilaments, planPainting,
  DEFAULT_LAYER_H, U1_HEADS,
  type Filament, type ImageLike, type OwnedFilament, type Stack, type Solve, type SwapBand,
} from "./hueforge";
import { hexToRgb } from "./color-mix";
import { buildU1_3mf } from "./hueforge-3mf";
import { pickFilaments } from "./hueforge-palette";

export type HueForgeOptions = {
  /** Filaments bottom->top. Omitted: suggested from the image (and the maker's spools, if given). */
  filaments?: Filament[];
  owned?: OwnedFilament[] | null;
  maxColors?: number;
  /** Suggest only black, greys and white. Ignored when `filaments` or `owned` is given. */
  grayscale?: boolean;
  /**
   * The pixels the filament picker reads, when they should differ from the ones the relief is built
   * from. The page passes the photo at one fixed grid here, so changing the print size changes the
   * relief's resolution but not which filaments it asks for. Omitted: the picker reads `img`.
   */
  pickFrom?: ImageLike;
  layerH?: number;
  baseLayers?: number;
  /** Plate width in mm; height follows the image's aspect. */
  widthMm?: number;
  /** Despeckle rounds on the solved height map. 0 = raw solve. */
  smooth?: number;
  name?: string;
};

export type HueForgeResult = {
  /** The Orca-ready .3mf. */
  bytes: Uint8Array;
  solve: Solve;
  /** How many heads the plan uses, and whether it prints without a mid-print reload. */
  plan: { heads: number; colorCount: number; automatic: boolean };
  /** Mean CIEDE2000 between the photo and what this stack can actually reach — the match quality. */
  meanDeltaE: number;
  filaments: Filament[];
  sizeMm: { x: number; y: number; z: number };
};

/**
 * The engine describes bands as 1-based LAYER ranges; the assembler wants Z heights per head.
 * Converting here rather than in either module keeps both faithful to the app's versions.
 */
export function stackBandsToSwapBands(stack: Stack): SwapBand[] {
  return stack.bands.map((b, i) => ({
    // startLayer is 1-based and inclusive, so the band begins at the top of the layer below it.
    z0: +((b.startLayer - 1) * stack.layerH).toFixed(4),
    z1: +(b.endLayer * stack.layerH).toFixed(4),
    head: i,
    hex: b.hex,
  }));
}

/**
 * Turn RGBA pixels into a U1-ready HueForge relief.
 *
 * Runs the optimised engine (planPainting): it learns a per-layer filament sequence for this image
 * and composites it FRONT-LIT (tdScale), the way a print on a shelf is seen. Until Nov 2026 this ran
 * the first engine instead (buildStack + solveHeightfield): one fixed band per filament, composited
 * as if lit from behind, which posterised a portrait into four soft height zones. planPainting was
 * already ported (see hueforge.ts) and is what the desktop app ships; on two test images it matched
 * the photo more closely (mean ΔE 6.8 → 5.6 and 8.6 → 4.6) in a third of the time.
 *
 * Returns null when there's nothing printable — no filaments resolved, or a degenerate image —
 * rather than emitting a .3mf that opens empty.
 */
export function imageToHueForgeU1(img: ImageLike, opts: HueForgeOptions = {}): HueForgeResult | null {
  if (!img || !img.width || !img.height || !img.data?.length) return null;

  const layerH = Number(opts.layerH) > 0 ? Number(opts.layerH) : DEFAULT_LAYER_H;
  const widthMm = Number(opts.widthMm) > 0 ? Number(opts.widthMm) : undefined;
  const heads = Math.min(U1_HEADS, Math.max(2, opts.maxColors ?? U1_HEADS));
  const filaments = (opts.filaments?.length
    ? opts.filaments
    // From the maker's own spools: the engine's picker, which snaps to them. Otherwise the site's
    // picker (hueforge-palette.ts): a dark, a light and the photo's distinct hues, as real colours.
    : opts.owned?.length
      ? suggestFilaments(opts.pickFrom ?? img, opts.owned, heads)
      : pickFilaments(opts.pickFrom ?? img, heads, { grayscale: opts.grayscale }))
    .filter((f) => f && hexToRgb(f.hex));
  if (!filaments.length) return null;

  // Black and white reads its tones from layer depth alone, and the engine's front-lit default
  // (tdScale 0.2) is too opaque for that: one layer of white over black jumped straight to a mid
  // gray, the dark half of a face snapped to black, and the two grays were never used (Nov 2026,
  // a portrait came out as flat patches). Half as opaque and 3.2 mm tall gives the shading back.
  // Colour mode keeps the default: on the same test set this setting turned skin olive or yellow.
  const gray = opts.grayscale && !opts.filaments?.length && !opts.owned?.length;
  const plan = planPainting(img, filaments, {
    layerH,
    widthMm,
    ...(gray ? { tdScale: 0.5, heightMm: 3.2 } : {}),
    smooth: opts.smooth ?? 0,
    ...(opts.baseLayers != null ? { baseLayers: opts.baseLayers } : {}),
  });
  if (!plan || !plan.bands.length) return null;

  const mesh = heightfieldToMesh(plan.solve, { widthMm, layerH });
  if (!mesh.triangleCount) return null;

  const bytes = buildU1_3mf({
    triangles: mesh.triangles,
    bands: plan.bands,
    // Indexed by head: a filament can recur in several bands, so the bands can't name the slots.
    filaments: plan.filaments,
    layerH,
    name: opts.name || "hueforge",
    sizeMm: mesh.sizeMm,
  });
  if (!bytes) return null;

  const used = new Set(plan.bands.map((b) => b.head)).size;
  return {
    bytes,
    solve: plan.solve,
    // Every head stays loaded for the whole print, so a sequence over ≤4 filaments never needs a reload.
    plan: { heads: U1_HEADS, colorCount: used, automatic: plan.filaments.length <= U1_HEADS },
    meanDeltaE: plan.meanDeltaE,
    filaments: plan.filaments,
    sizeMm: mesh.sizeMm,
  };
}
