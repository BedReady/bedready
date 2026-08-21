// Pluggable conversion targets. The engine is fundamentally a profile/slot remap, so adding a printer
// = adding a Machine (its bed + toolhead count + slicer flavour + printer identity). The Snapmaker U1 is
// the fully-validated STAMP target (it ships a tested reference profile in u1-profile.json and owns the
// Full Spectrum / M600 / band-swap hardware features). The other entries are RETARGET-only: within the
// same slicer family the converter rewrites the source file's vendor config (printer model / settings id
// / printable area / nozzle) to that printer; across families it falls back to a clean Generic 3MF.
//
// Registry values (bed / flavour / printerModel) are ported verbatim from the Bed Ready desktop app's
// lib/printer-profiles.js so the two stay in lock-step — see each entry's source note.
import u1Profile from "./u1-profile.json";

export type Flavour = "bambu" | "orca" | "prusa" | "generic";

export type Machine = {
  id: string;
  name: string; // printer_settings_id — shown to users and written to the output profile
  vendor?: string;
  flavour: Flavour; // the slicer 3MF dialect this printer uses
  toolheads: number; // physical colour slots (maxColors: AMS / CFS / MMU / toolhead)
  buildMM: number; // square build-plate size (mm) — kept for legacy U1 callers (= bed.x)
  buildZMM: number; // max build height / Z (mm) (= bed.z)
  bed: { x: number; y: number; z: number }; // build volume (mm)
  nozzle: number; // default nozzle diameter (mm)
  printerModel?: string; // vendor printer_model written into project settings on a retarget
  printerSettingsId?: string; // exact library preset name (printer_settings_id); falls back to printerModel
  printableArea?: string[]; // exact build-plate polygon (keeps plate layout correct); else derived from bed
  printableHeight?: string; // exact printable_height string; else derived from bed.z
  supportsMixedFilament?: boolean; // Full Spectrum dithering is a hardware feature — gate on this, NOT flavour
  profile?: Record<string, unknown>; // tested reference project_settings (STAMP target only — the U1)
  // TRUE only for a profile a human has actually printed from. The bundled U1 profile is a real export
  // from a real machine; the derived nozzle variants below are arithmetic on it and nobody has printed
  // one. Surfaces in the UI and the diff report — this site's whole claim is that it says which is which.
  testedProfile?: boolean;
  derivedFromNozzle?: number; // set on a derived variant: the tested nozzle its values were scaled from
};

// The Snapmaker U1 — the default + fully-validated target. Values kept byte-identical to before.
export const U1: Machine = {
  id: "u1",
  name: String((u1Profile as Record<string, unknown>).printer_settings_id ?? "Snapmaker U1 (0.4 nozzle)"),
  vendor: "Snapmaker",
  flavour: "orca",
  toolheads: 4,
  buildMM: 270, // 270×270 mm bed (source: app lib/printer-profiles.js snapmaker-u1 bed)
  buildZMM: 270, // 270 mm max Z (same source)
  bed: { x: 270, y: 270, z: 270 },
  nozzle: 0.4,
  printerModel: "Snapmaker U1",
  printerSettingsId: "Snapmaker U1 (0.4 nozzle)",
  supportsMixedFilament: true, // U1 hardware "Full Spectrum" mixing — gate the whole feature on this flag
  profile: u1Profile as Record<string, unknown>,
  testedProfile: true, // the bundled profile is a real export from the owner's own U1
};

// ---------- U1 nozzle variants ----------
// The U1 ships in four nozzle sizes and Snapmaker Orca has a library preset for each. We bundle a real
// export for ONE of them (0.4). The other three are derived here rather than invented: every value below
// is either a hardware fact (diameter, variant, preset name) or the 0.4 reference scaled by the nozzle
// ratio — which reproduces the reference EXACTLY at 0.4, so the derivation is checkable against a file
// somebody actually printed. See `u1NozzleVariant`.
//
// WHY DERIVE AT ALL, given this project's rule about hand-made stamps? Because the alternative shipped
// today is worse: a 0.2-nozzle owner currently gets a file declaring a 0.4 nozzle, which is wrong in a
// way nothing warns about. A derived variant is wrong-in-the-small and says so; the status quo is
// wrong-in-the-large and silent. Replace any of these the moment a real export for that nozzle exists.
export const U1_NOZZLES = [0.2, 0.4, 0.6, 0.8] as const;
export type U1Nozzle = (typeof U1_NOZZLES)[number];

/** The nozzle the bundled reference profile was exported at. Everything else is scaled from it. */
export const U1_TESTED_NOZZLE = 0.4;

// Keys whose reference VALUE is a linear function of nozzle diameter. Anything expressed as a
// percentage (`skin_infill_line_width: "100%"`) is already nozzle-relative and must NOT be scaled;
// `ramming_line_width_ratio` is a ratio for the same reason. Extrusion widths and layer heights are
// the two families that scale, and the reference's own ratios are preserved exactly (e.g. line_width
// 0.42 = 105% of 0.4, max_layer_height 0.32 = 80%, min_layer_height 0.08 = 20%).
const NOZZLE_SCALED_KEYS = [
  "line_width", "initial_layer_line_width", "inner_wall_line_width", "outer_wall_line_width",
  "internal_solid_infill_line_width", "sparse_infill_line_width", "support_line_width",
  "top_surface_line_width",
  "layer_height", "initial_layer_print_height", "max_layer_height", "min_layer_height",
  "nozzle_diameter",
] as const;

/** Scale a numeric-string value (or array of them) by `ratio`, to 2dp. Percentages pass through. */
function scaleValue(v: unknown, ratio: number): unknown {
  if (Array.isArray(v)) return v.map((x) => scaleValue(x, ratio));
  const s = String(v);
  if (s.includes("%")) return v; // already nozzle-relative
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return v;
  const scaled = Math.round(n * ratio * 100) / 100;
  return typeof v === "string" ? String(scaled) : scaled;
}

const variantCache = new Map<number, Machine>();

/**
 * The U1 as a given nozzle size. Returns the tested `U1` itself for 0.4; for the other three it
 * returns a derived Machine whose profile carries that nozzle's identity (diameter, `printer_variant`,
 * and the exact Snapmaker Orca preset name) with every nozzle-dependent value scaled by the ratio.
 *
 * `testedProfile` is false on the derived ones, and every surface that shows a profile is expected to
 * say so. An unknown nozzle falls back to the tested 0.4 rather than guessing.
 */
export function u1NozzleVariant(nozzle: number): Machine {
  if (!(U1_NOZZLES as readonly number[]).includes(nozzle) || nozzle === U1_TESTED_NOZZLE) return U1;
  const cached = variantCache.get(nozzle);
  if (cached) return cached;

  const ratio = nozzle / U1_TESTED_NOZZLE;
  const profile = JSON.parse(JSON.stringify(u1Profile)) as Record<string, unknown>;
  for (const k of NOZZLE_SCALED_KEYS) if (k in profile) profile[k] = scaleValue(profile[k], ratio);
  // Identity, not arithmetic: these are what Snapmaker Orca matches its own preset on.
  const settingsId = `Snapmaker U1 (${nozzle} nozzle)`;
  profile.printer_settings_id = settingsId;
  profile.printer_variant = String(nozzle);

  const m: Machine = {
    ...U1,
    id: `u1-${nozzle}`,
    name: settingsId,
    nozzle,
    printerSettingsId: settingsId,
    profile,
    testedProfile: false,
    derivedFromNozzle: U1_TESTED_NOZZLE,
  };
  variantCache.set(nozzle, m);
  return m;
}

// Retarget targets — a few popular printers ported from the app registry. No reference profile: the
// converter rewrites the SOURCE file's vendor config in place (same family) or emits a Generic 3MF
// (cross family). buildMM/buildZMM mirror bed.x/bed.z for the shared fit-warning helpers.
const RETARGET: Machine[] = [
  {
    id: "bambu-x1c", name: "Bambu Lab X1 Carbon", vendor: "Bambu Lab", flavour: "bambu",
    toolheads: 4, buildMM: 256, buildZMM: 256, bed: { x: 256, y: 256, z: 256 }, nozzle: 0.4,
    printerModel: "Bambu Lab X1 Carbon", // source: app printer-profiles.js bambu-x1c
  },
  {
    id: "bambu-p1s", name: "Bambu Lab P1S", vendor: "Bambu Lab", flavour: "bambu",
    toolheads: 4, buildMM: 256, buildZMM: 256, bed: { x: 256, y: 256, z: 256 }, nozzle: 0.4,
    printerModel: "Bambu Lab P1S", // source: app printer-profiles.js bambu-p1s
  },
  {
    id: "bambu-a1", name: "Bambu Lab A1", vendor: "Bambu Lab", flavour: "bambu",
    toolheads: 4, buildMM: 256, buildZMM: 256, bed: { x: 256, y: 256, z: 256 }, nozzle: 0.4,
    printerModel: "Bambu Lab A1", // source: app printer-profiles.js bambu-a1
  },
  {
    id: "prusa-mk4-mmu3", name: "Prusa MK4 + MMU3", vendor: "Prusa Research", flavour: "prusa",
    toolheads: 5, buildMM: 250, buildZMM: 220, bed: { x: 250, y: 210, z: 220 }, nozzle: 0.4,
    printerModel: "MK4IS", // source: app printer-profiles.js prusa-mk4-mmu3
  },
  {
    id: "creality-k2", name: "Creality K2 Plus", vendor: "Creality", flavour: "orca",
    toolheads: 4, buildMM: 350, buildZMM: 350, bed: { x: 350, y: 350, z: 350 }, nozzle: 0.4,
    printerModel: "Creality K2 Plus", // source: app printer-profiles.js creality-k2
  },
];

/** The non-U1 retarget printers, in menu order. */
export const RETARGET_MACHINES: Machine[] = RETARGET;

/** Registry of supported target printers, keyed by id (U1 first). */
export const MACHINES: Record<string, Machine> = {
  [U1.id]: U1,
  ...Object.fromEntries(RETARGET.map((m) => [m.id, m])),
};

/** Resolve a machine by id, defaulting to the U1. */
export function getMachine(id?: string): Machine {
  return (id && MACHINES[id]) || U1;
}

/**
 * The 3MF config family a flavour uses. Bambu Studio and OrcaSlicer share the same
 * project_settings.config JSON dialect ("bbl"), so retargeting between them is coherent; PrusaSlicer
 * uses a different text .config. A retarget only makes sense within one family — the converter can't
 * turn a Bambu project into a working Prusa one by rewriting metadata. (Ported from the app.)
 */
export function configFamily(flavour: Flavour): "bbl" | "prusa" | "generic" {
  if (flavour === "bambu" || flavour === "orca") return "bbl";
  if (flavour === "prusa") return "prusa";
  return "generic";
}
