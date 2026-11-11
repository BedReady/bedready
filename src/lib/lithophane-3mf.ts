// Lithophane -> Snapmaker U1 project 3MF.
//
// Reuses the flat-mode writer (buildFlatU1_3mf: one part per solid, each naming its head), with the
// print settings a lithophane cannot do without:
//   - 100% infill: the light is the picture, and sparse infill prints as a grid of shadows;
//   - every layer at the slab's layer height, first layer included, so the colour layers in the
//     file are the colour layers the slicer prints (a thicker first layer would merge two).
import { buildFlatU1_3mf } from "./hueforge-3mf";
import { asTriangles, lithophaneParts, type LithoPlan } from "./lithophane";
import { withFrame, type LithoFrameKind } from "./lithophane-frame";

export type LithoExportOpts = {
  name?: string;
  thumbnailPng?: Uint8Array;
  /** A border round the picture (default 6 mm), plus a stand foot or a hanger tab. */
  frame?: { kind: LithoFrameKind; borderMm?: number };
};

export const LITHO_PRINT_SETTINGS: Record<string, string> = {
  sparse_infill_density: "100%",
  sparse_infill_pattern: "rectilinear",
};

export function lithophaneTo3MF(plan: LithoPlan, o: LithoExportOpts = {}): Uint8Array | null {
  const picture = lithophaneParts(plan);
  const T = plan.whiteFrontMm + plan.colourLayers * plan.layerH + plan.maxMm;
  // The writer centres by sizeMm and does not move parts, so a frame (which reaches below 0) moves
  // everything up to start at 0 and reports the framed size.
  const framed = o.frame ? withFrame(picture, plan, o.frame) : null;
  const parts = framed ? framed.parts : picture;
  const sizeMm = framed
    ? { x: framed.sizeMm.x, y: framed.sizeMm.y, z: Math.max(T, framed.sizeMm.z) }
    : { x: plan.gw * plan.cellMm, y: plan.gh * plan.cellMm, z: T };
  return buildFlatU1_3mf({
    parts: parts.map((p) => ({ hex: p.hex, head: p.head, name: p.name, triangles: asTriangles(p.mesh) })),
    layerH: plan.layerH,
    // The white front layer, when there is one, IS the first layer; the slab's 0.1 mm layers follow.
    firstLayerH: plan.whiteFrontMm > 0 ? plan.whiteFrontMm : plan.layerH,
    name: o.name || "Lithophane",
    sizeMm,
    filaments: plan.filaments.map((f) => f.hex),
    baseHead: plan.whiteHead,
    thumbnailPng: o.thumbnailPng,
    settings: LITHO_PRINT_SETTINGS,
  });
}
