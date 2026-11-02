// The U1 High Flow hot end, as Snapmaker Orca 2.4 describes it in a project file.
//
// 2.4 stores a filament's standard and high-flow values side by side: `filament_flow_step_size` says how
// many entries each filament owns, `filament_flow_support` names each one, and `filament_volume_type` /
// `nozzle_volume_type` say which the file was sliced for. The printer refuses a file whose flow type does
// not match the hot end installed on that toolhead (wiki.snapmaker.com/en/snapmaker_u1/hot_end_guide).
// Shape checked against a real 2.4.0 export. convert.ts `collapseFlowVariants` is the reverse of this.
//
// Every value below is copied from Snapmaker's own presets (Snapmaker/OrcaSlicer v2.4.1,
// resources/profiles/Snapmaker, inherits resolved): the high-flow entry of each filament preset
// compatible with "Snapmaker U1 (0.4 nozzle)", and the four speeds of "0.20mm Standard @Snapmaker U1
// (0.4 nozzle)", the only process preset that declares high_flow. High Flow exists only at 0.4 mm.
// The CF/GF presets are left out on purpose: the hot end guide says fibre-filled filaments clog it.

/** Snapmaker's U1 0.4 presets that carry High Flow values: type + each high-flow entry. */
export const U1_HIGH_FLOW_FILAMENTS: Record<string, { type: string; hf: Record<string, string> }> = {
  "Snapmaker ABS @U1 0.4 nozzle": { type: "ABS", hf: {"filament_flow_ratio": "0.95", "pressure_advance": "0.02", "nozzle_temperature_initial_layer": "280", "nozzle_temperature": "280", "filament_max_volumetric_speed": "22", "fan_min_speed": "10", "fan_max_speed": "60", "additional_cooling_fan_speed": "0", "filament_retraction_length": "0.2", "filament_z_hop_types": "Slope Lift", "filament_retract_length_toolchange": "5", "filament_multitool_ramming": "1", "filament_multitool_ramming_volume": "5", "filament_multitool_ramming_flow": "30", "filament_minimal_purge_on_wipe_tower": "15"} },
  "Snapmaker ASA @U1 0.4 nozzle": { type: "ASA", hf: {"filament_flow_ratio": "0.94", "pressure_advance": "0.02", "nozzle_temperature_initial_layer": "280", "nozzle_temperature": "280", "filament_max_volumetric_speed": "22", "fan_min_speed": "10", "fan_max_speed": "25", "additional_cooling_fan_speed": "0", "filament_retraction_length": "0.6", "filament_z_hop_types": "Slope Lift", "filament_retract_length_toolchange": "5", "filament_multitool_ramming_volume": "10", "filament_multitool_ramming_flow": "20", "filament_minimal_purge_on_wipe_tower": "15"} },
  "Snapmaker PETG HF": { type: "PETG", hf: {"filament_flow_ratio": "0.955", "enable_pressure_advance": "1", "pressure_advance": "0.035", "nozzle_temperature_initial_layer": "230", "nozzle_temperature": "245", "filament_max_volumetric_speed": "30", "fan_min_speed": "30", "fan_max_speed": "60", "additional_cooling_fan_speed": "0", "filament_retraction_length": "0.8", "filament_retraction_speed": "40", "filament_deretraction_speed": "40", "filament_z_hop_types": "Slope Lift", "filament_wipe_distance": "1", "filament_retract_length_toolchange": "8", "filament_multitool_ramming": "1", "filament_multitool_ramming_volume": "8", "filament_multitool_ramming_flow": "30", "filament_minimal_purge_on_wipe_tower": "50"} },
  "Snapmaker PETG Translucent @U1 0.4 nozzle": { type: "PETG", hf: {"pressure_advance": "0.05"} },
  "Snapmaker PLA Full Spectrum @U1 0.4 nozzle": { type: "PLA", hf: {"enable_pressure_advance": "1", "pressure_advance": "0.024", "filament_retraction_length": "0.5", "filament_z_hop_types": "Slope Lift", "filament_retract_length_toolchange": "5"} },
  "Snapmaker PLA Glow @U1 0.4 nozzle": { type: "PLA", hf: {"filament_flow_ratio": "0.98", "pressure_advance": "0.023", "filament_max_volumetric_speed": "18", "additional_cooling_fan_speed": "100"} },
  "Snapmaker PLA Matte @U1": { type: "PLA", hf: {"filament_flow_ratio": "0.99", "enable_pressure_advance": "1", "pressure_advance": "0.024", "nozzle_temperature_initial_layer": "220", "nozzle_temperature": "220", "filament_max_volumetric_speed": "40", "fan_min_speed": "100", "fan_max_speed": "100", "additional_cooling_fan_speed": "100", "filament_retraction_length": "1", "filament_z_hop_types": "Slope Lift", "filament_wipe_distance": "1", "filament_retract_length_toolchange": "5", "filament_multitool_ramming_volume": "5", "filament_multitool_ramming_flow": "40", "filament_minimal_purge_on_wipe_tower": "15"} },
  "Snapmaker PLA Silk @U1": { type: "PLA", hf: {"filament_flow_ratio": "0.98", "pressure_advance": "0.015", "nozzle_temperature_initial_layer": "230", "nozzle_temperature": "230", "filament_max_volumetric_speed": "12", "fan_min_speed": "100", "fan_max_speed": "100", "additional_cooling_fan_speed": "80", "filament_retraction_length": "0.2", "filament_z_hop_types": "Slope Lift", "filament_retract_length_toolchange": "5", "filament_multitool_ramming_volume": "5", "filament_multitool_ramming_flow": "25", "filament_minimal_purge_on_wipe_tower": "15"} },
  "Snapmaker PLA SnapSpeed @U1": { type: "PLA", hf: {"filament_flow_ratio": "0.966", "enable_pressure_advance": "1", "pressure_advance": "0.024", "nozzle_temperature_initial_layer": "220", "nozzle_temperature": "220", "filament_max_volumetric_speed": "40", "fan_min_speed": "100", "fan_max_speed": "100", "additional_cooling_fan_speed": "70", "filament_retraction_length": "1.2", "filament_z_hop_types": "Slope Lift", "filament_retract_length_toolchange": "5", "filament_multitool_ramming": "1", "filament_multitool_ramming_volume": "5", "filament_multitool_ramming_flow": "40", "filament_minimal_purge_on_wipe_tower": "15"} },
  "Snapmaker PLA Translucent @U1 0.4 nozzle": { type: "PLA", hf: {"pressure_advance": "0.024"} },
  "Snapmaker PLA Wood @U1 0.4 nozzle": { type: "PLA", hf: {"pressure_advance": "0.024", "filament_max_volumetric_speed": "20", "filament_z_hop_types": "Auto Lift", "filament_retract_length_toolchange": "6"} },
  "Snapmaker PVA @U1": { type: "PVA", hf: {"filament_flow_ratio": "0.97", "filament_max_volumetric_speed": "6", "filament_retraction_length": "0.6"} },
  "Snapmaker Support For PLA @U1 0.4 nozzle": { type: "PLA", hf: {"filament_flow_ratio": "0.95", "filament_max_volumetric_speed": "18"} },
};

/** The high-flow speeds of "0.20mm Standard @Snapmaker U1 (0.4 nozzle)" (mm/s). */
export const U1_HIGH_FLOW_SPEEDS: Record<string, string> = {
  outer_wall_speed: "500",
  inner_wall_speed: "600",
  sparse_infill_speed: "600",
  internal_solid_infill_speed: "600",
};

/** A slot's material → the Snapmaker preset to give it when the slot is still generic or foreign. */
const DEFAULT_FOR_TYPE: Record<string, string> = {
  PLA: "Snapmaker PLA SnapSpeed @U1",
  PETG: "Snapmaker PETG HF",
  ABS: "Snapmaker ABS @U1 0.4 nozzle",
  ASA: "Snapmaker ASA @U1 0.4 nozzle",
  PVA: "Snapmaker PVA @U1",
};

// The keys 2.4 segments per filament (PrintConfig.cpp filament_flow_variant_options, v2.4.1).
const FILAMENT_KEYS = [
  "filament_flow_ratio", "enable_pressure_advance", "pressure_advance", "nozzle_temperature_initial_layer",
  "nozzle_temperature", "filament_max_volumetric_speed", "fan_min_speed", "fan_max_speed",
  "additional_cooling_fan_speed", "filament_retraction_length", "filament_retraction_speed",
  "filament_deretraction_speed", "filament_z_hop_types", "filament_wipe_distance",
  "filament_retract_length_toolchange", "filament_multitool_ramming", "filament_multitool_ramming_volume",
  "filament_multitool_ramming_flow", "filament_minimal_purge_on_wipe_tower",
];

/** One slot's outcome: the High Flow preset it was given, or null when its material has none. */
export type HighFlowSlot = { slot: number; preset: string | null };

/** The High Flow preset for a slot: its own when it already is one, else its material's default. */
export function highFlowPresetFor(settingsId: unknown, type: unknown): string | null {
  if (typeof settingsId === "string" && settingsId in U1_HIGH_FLOW_FILAMENTS) return settingsId;
  return DEFAULT_FOR_TYPE[String(type ?? "").toUpperCase()] ?? null;
}

const at = (v: unknown, i: number): unknown => (Array.isArray(v) ? v[Math.min(i, v.length - 1)] : v);

/**
 * Make a standard-flow U1 0.4 config High Flow, in place. Each slot whose material has a Snapmaker
 * High Flow preset takes that preset's name and gains its high-flow entry beside the value it already
 * had; a slot without one stays standard on a standard toolhead. Slot i is toolhead i.
 */
export function applyHighFlow(cfg: Record<string, unknown>): HighFlowSlot[] {
  const ids = Array.isArray(cfg.filament_settings_id) ? (cfg.filament_settings_id as unknown[]) : [];
  const types = Array.isArray(cfg.filament_type) ? (cfg.filament_type as unknown[]) : [];
  const n = ids.length;
  const slots: HighFlowSlot[] = ids.map((id, slot) => ({ slot, preset: highFlowPresetFor(id, types[slot]) }));
  if (!slots.some((s) => s.preset)) return slots;

  for (const k of FILAMENT_KEYS) {
    if (!(k in cfg)) continue;
    const v = cfg[k];
    cfg[k] = slots.flatMap(({ slot, preset }) => {
      const std = String(at(v, slot));
      return preset ? [std, U1_HIGH_FLOW_FILAMENTS[preset].hf[k] ?? std] : [std];
    });
  }
  cfg.filament_settings_id = slots.map(({ slot, preset }) => preset ?? ids[slot]);
  cfg.filament_flow_step_size = slots.map((s) => (s.preset ? "2" : "1"));
  cfg.filament_flow_support = slots.flatMap((s) => (s.preset ? ["standard", "high_flow"] : ["standard"]));
  cfg.filament_volume_type = slots.map((s) => (s.preset ? "high_flow" : "standard"));
  const heads = Array.isArray(cfg.nozzle_diameter) ? (cfg.nozzle_diameter as unknown[]).length : n;
  cfg.nozzle_volume_type = Array.from({ length: heads }, (_, i) => (slots[i]?.preset ? "high_flow" : "standard"));
  cfg.printer_flow_support = ["standard", "high_flow"];
  cfg.process_flow_support = ["standard", "high_flow"];
  for (const [k, hf] of Object.entries(U1_HIGH_FLOW_SPEEDS)) cfg[k] = [String(at(cfg[k], 0) ?? hf), hf];
  return slots;
}
