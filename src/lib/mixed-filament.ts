// Serializer for Snapmaker Orca's `mixed_filament_definitions` (Full Spectrum / colour mixing).
// Format reverse-engineered from Snapmaker/OrcaSlicer MixedFilamentManager::serialize_custom_entries
// and verified byte-for-byte against a real Orca-saved file. Per definition, comma-separated:
//   compA,compB,enabled,custom,mixB%,pointillism,g<ids>,w<weights>,m<dist>,z<localZ>,
//   xa<offA>,xb<offB>,d<deleted>,o<originAuto>,u<stableId>[,cm<uiMode>][,r1/<g0>/<g1>][,<pattern>]
// Definitions are joined with ';'. DistributionMode: 0=LayerCycle, 1=Pointillisme, 2=Simple.

export type MixedDef = {
  componentA: number; // 1-based filament index
  componentB: number; // 1-based filament index
  mixBPercent: number; // 0..100 blend of component B
  stableId: number; // unique row id
  enabled?: boolean; // default true
  custom?: boolean; // default true (user/converter-defined)
  pointillismAll?: boolean;
  gradientIds?: string;
  gradientWeights?: string;
  distributionMode?: number; // default 2 (Simple)
  localZ?: number;
  surfaceOffsetA?: number;
  surfaceOffsetB?: number;
  deleted?: boolean;
  originAuto?: boolean;
  uiMode?: number; // default 0 → ",cm0"; <0 omits the token
};

/** Match Orca's format_surface_offset_token: fixed(4) with trailing zeros + dot trimmed, "-0"→"0". */
function fmtOffset(v: number): string {
  let s = (v || 0).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  if (s === "-0" || s === "") s = "0";
  return s;
}

export function serializeMixedDef(d: MixedDef): string {
  const tokens = [
    d.componentA,
    d.componentB,
    d.enabled === false ? 0 : 1,
    d.custom === false ? 0 : 1,
    Math.max(0, Math.min(100, Math.round(d.mixBPercent))),
    d.pointillismAll ? 1 : 0,
    "g" + (d.gradientIds ?? ""),
    "w" + (d.gradientWeights ?? ""),
    "m" + (d.distributionMode ?? 2),
    "z" + Math.max(0, d.localZ ?? 0),
    "xa" + fmtOffset(d.surfaceOffsetA ?? 0),
    "xb" + fmtOffset(d.surfaceOffsetB ?? 0),
    "d" + (d.deleted ? 1 : 0),
    "o" + (d.originAuto ? 1 : 0),
    "u" + d.stableId,
  ].join(",");
  const ui = d.uiMode ?? 0;
  return ui >= 0 ? `${tokens},cm${ui}` : tokens;
}

export function serializeMixedDefs(defs: MixedDef[]): string {
  return defs.map(serializeMixedDef).join(";");
}

/** Conservative, U1-safe defaults for the global dithering keys that accompany the definitions
 *  (taken from a real Orca-saved Full-Spectrum project). */
export const MIXED_DITHERING_DEFAULTS: Record<string, string> = {
  // NB: mixed_color_layer_height_a/_b are an integer A/B *layer-cadence* (value ÷ global layer height,
  // rounded), NOT a print height; the *_bound keys only apply in Local-Z / gradient modes. To actually
  // thin the mixed regions use dithering_z_step_size (see below) — verified against Snapmaker Orca's
  // PrintObject::update_layer_height_profile / ToolOrdering::resolve_mixed_with_layer_heights.
  mixed_color_layer_height_a: "0",
  mixed_color_layer_height_b: "0",
  // Ordered dithering: spread the layer cadence evenly instead of contiguous blocks, so an extreme
  // ratio (e.g. 80/20 → 1:4) blends finely rather than printing one thick band of each colour.
  mixed_filament_advanced_dithering: "1",
  mixed_filament_component_bias_enabled: "0",
  mixed_filament_gradient_mode: "0",
  mixed_filament_height_lower_bound: "0.04",
  mixed_filament_height_upper_bound: "0.16",
  mixed_filament_pointillism_line_gap: "0",
  mixed_filament_pointillism_pixel_size: "0",
  mixed_filament_region_collapse: "1",
  mixed_filament_surface_indentation: "0",
  // "Subdivide Mix Layer" (dithering_local_z_mode). Orca's adaptive Local-Z pipeline: inside the
  // painted mixing areas it subdivides each model layer into per-colour sublayers (heights chosen
  // within the lower/upper bounds above, 0.04–0.16) so colours alternate more often → noticeably
  // cleaner mixes, most visibly on top surfaces. Real Minion print confirmed the win. Defaulted ON
  // now because the purge it adds is routed entirely to the prime tower (see withMixes), so the
  // earlier ooze concern that kept subdivision off no longer applies. dithering_local_z_infill mirrors
  // Orca auto-enabling infill subdivision with the mode. Label/key/default verified against Snapmaker
  // Orca PrintConfig.cpp. NB: this is a DIFFERENT pipeline from dithering_z_step_size (a fixed height
  // everywhere) — the two are mutually exclusive, so the z-step override path turns Local-Z back off.
  dithering_local_z_mode: "1",
  dithering_local_z_infill: "1",
  // Fixed mixed-zone layer height (the OTHER, non-adaptive pipeline): 0 = unused; default mixing uses
  // Local-Z above. A positive value (set per-conversion via CleanOpts.mixedLayerHeight) re-slices the
  // painted mixed zones at that exact height and requires Local-Z off (guard: !local_z && !gradient &&
  // step > 0) — withMixes handles that switch.
  dithering_z_step_size: "0",
  dithering_step_painted_zones_only: "1",
};
