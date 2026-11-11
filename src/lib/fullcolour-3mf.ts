// Full-colour front-lit print -> Snapmaker U1 project 3MF, through the flat-mode writer: one part
// per solid, each naming its head. A 0.2 mm first layer (the base's first layer, all white), then
// the slab's layer height, so every colour layer in the file is a layer the slicer prints. The
// white base is 0.2 + n × layerH, which planFullColour's defaults (1.0 = 0.2 + 10 × 0.08) satisfy.
import { buildFlatU1_3mf } from "./hueforge-3mf";
import { asTriangles } from "./lithophane";
import { LITHO_PRINT_SETTINGS } from "./lithophane-3mf";
import { fullColourParts, type FullColourPlan } from "./fullcolour";

export function fullColourTo3MF(plan: FullColourPlan, o: { name?: string; thumbnailPng?: Uint8Array } = {}): Uint8Array | null {
  const parts = fullColourParts(plan);
  return buildFlatU1_3mf({
    parts: parts.map((p) => ({ hex: p.hex, head: p.head, name: p.name, triangles: asTriangles(p.mesh) })),
    layerH: plan.layerH,
    firstLayerH: 0.2,
    name: o.name || "Full colour",
    sizeMm: { x: plan.gw * plan.cellMm, y: plan.gh * plan.cellMm, z: plan.baseMm + plan.colourLayers * plan.layerH },
    filaments: plan.filaments.map((f) => f.hex),
    baseHead: plan.whiteHead,
    thumbnailPng: o.thumbnailPng,
    // 100% infill: the base is the reflector, and a sparse grid would show through thin colour.
    settings: LITHO_PRINT_SETTINGS,
  });
}
