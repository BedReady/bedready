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
  buildStack, solveHeightfield, heightfieldToMesh, suggestFilaments, u1Plan, smoothHeights,
  DEFAULT_LAYER_H, U1_HEADS,
  type Filament, type ImageLike, type OwnedFilament, type Stack, type Solve, type SwapBand,
} from "./hueforge";
import { buildU1_3mf } from "./hueforge-3mf";

export type HueForgeOptions = {
  /** Filaments bottom->top. Omitted: suggested from the image (and the maker's spools, if given). */
  filaments?: Filament[];
  owned?: OwnedFilament[] | null;
  maxColors?: number;
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
  stack: Stack;
  solve: Solve;
  /** Head assignment + whether it prints without a mid-print reload. */
  plan: ReturnType<typeof u1Plan>;
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
 * Returns null when there's nothing printable — no filaments resolved, or a degenerate image —
 * rather than emitting a .3mf that opens empty.
 */
export function imageToHueForgeU1(img: ImageLike, opts: HueForgeOptions = {}): HueForgeResult | null {
  if (!img || !img.width || !img.height || !img.data?.length) return null;

  const layerH = Number(opts.layerH) > 0 ? Number(opts.layerH) : DEFAULT_LAYER_H;
  const filaments = opts.filaments?.length
    ? opts.filaments
    : suggestFilaments(img, opts.owned ?? null, Math.min(U1_HEADS, Math.max(2, opts.maxColors ?? U1_HEADS)));
  if (!filaments.length) return null;

  const stack = buildStack(filaments, { layerH, baseLayers: opts.baseLayers });
  if (!stack.palette.length) return null;

  const solve = solveHeightfield(img, stack, { smooth: opts.smooth ?? 0 });
  // solveHeightfield already smooths when asked; this is the explicit pass for callers that
  // solved raw first and want to despeckle without re-solving.
  if ((opts.smooth ?? 0) > 0) {
    solve.heights = smoothHeights(solve.heights, solve.width, solve.height, opts.smooth);
  }

  const mesh = heightfieldToMesh(solve, { widthMm: opts.widthMm });
  if (!mesh.triangleCount) return null;

  const bytes = buildU1_3mf({
    triangles: mesh.triangles,
    bands: stackBandsToSwapBands(stack),
    layerH,
    name: opts.name || "hueforge",
    sizeMm: mesh.sizeMm,
  });
  if (!bytes) return null;

  return {
    bytes,
    stack,
    solve,
    plan: u1Plan(stack),
    meanDeltaE: solve.meanDeltaE,
    filaments: stack.filaments,
    sizeMm: mesh.sizeMm,
  };
}
