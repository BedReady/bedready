// What the extension converts FOR, and how it behaves on a download — one record, shared by the popup,
// the background worker and the in-page button.
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────────
// Until 0.4.0 every path hardcoded `cleanThreeMF(file, "u1", …)`, while bedready.io/convert had grown
// a printer picker (#39) and U1 nozzle variants. So the extension, the surface people meet first on
// MakerWorld, could do less than the page it links to — and a Bambu or Prusa owner who installed it
// got U1 files they could not use. The target list is the website's own registry (targets.ts), not a
// copy, so a printer added there reaches the extension on the next build.
//
// Stored in `storage.local` (no sync: four small values, and a per-browser choice is the honest
// default for a per-machine setting). Every reader goes through `loadSettings`, which validates each
// field — the stored record outlives the code that wrote it, and a removed printer id must fall back
// to the U1 rather than reach the engine.
import { RETARGET_MACHINES, MACHINES, U1, U1_NOZZLES, U1_TESTED_NOZZLE, u1NozzleVariant, type Machine } from "../../src/lib/targets";
import type { CleanTarget, CleanOpts } from "../../src/lib/convert";

declare const browser: any;
declare const chrome: any;
const api: any = typeof browser !== "undefined" ? browser : typeof chrome !== "undefined" ? chrome : undefined;

export type Settings = {
  target: CleanTarget; // "u1", a RETARGET machine id, or "generic"
  nozzle: number; // U1 only: which of U1_NOZZLES
  autoConvert: boolean; // convert .3mf downloads from the model sites as they happen
  keepOriginal: boolean; // keep the downloaded original next to the converted copy
};

export const DEFAULTS: Settings = { target: "u1", nozzle: U1_TESTED_NOZZLE, autoConvert: true, keepOriginal: false };

/** Every target the extension offers, in the order the picker shows them. */
export const TARGETS: { id: CleanTarget; label: string; vendor: string }[] = [
  { id: "u1", label: "Snapmaker U1", vendor: "Snapmaker" },
  ...RETARGET_MACHINES.map((m) => ({ id: m.id as CleanTarget, label: m.name, vendor: m.vendor ?? "Other" })),
  { id: "generic", label: "Any slicer (clean generic 3MF)", vendor: "Other" },
];

const isTarget = (v: unknown): v is CleanTarget => TARGETS.some((t) => t.id === v);

export function sanitize(raw: unknown): Settings {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    target: isTarget(o.target) ? o.target : DEFAULTS.target,
    nozzle: (U1_NOZZLES as readonly number[]).includes(o.nozzle as number) ? (o.nozzle as number) : DEFAULTS.nozzle,
    autoConvert: typeof o.autoConvert === "boolean" ? o.autoConvert : DEFAULTS.autoConvert,
    keepOriginal: typeof o.keepOriginal === "boolean" ? o.keepOriginal : DEFAULTS.keepOriginal,
  };
}

const KEY = "settings";

export async function loadSettings(): Promise<Settings> {
  try {
    const got = await api?.storage?.local?.get(KEY);
    return sanitize(got?.[KEY]);
  } catch {
    return { ...DEFAULTS }; // no storage (the smoke-test page, an old Safari) → behave as 0.3.0 did
  }
}

export async function saveSettings(s: Settings): Promise<void> {
  try {
    await api?.storage?.local?.set({ [KEY]: sanitize(s) });
  } catch { /* best-effort: the popup still converts with what is on screen */ }
}

/** Call `fn` whenever another surface changes the settings (the popup, while a tab shows the button). */
export function onSettingsChanged(fn: (s: Settings) => void): void {
  try {
    api?.storage?.onChanged?.addListener((changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area === "local" && changes[KEY]) fn(sanitize(changes[KEY].newValue));
    });
  } catch { /* not in an extension context */ }
}

/** The machine a setting resolves to — the U1 at the chosen nozzle, a retarget printer, or none (generic). */
export function machineOf(s: Settings): Machine | undefined {
  if (s.target === "u1") return s.nozzle === U1_TESTED_NOZZLE ? U1 : u1NozzleVariant(s.nozzle);
  if (s.target === "generic" || s.target === "current") return undefined;
  return MACHINES[s.target];
}

/** Engine options for a one-click conversion (interception, the in-page button). */
export function quickOpts(s: Settings): CleanOpts {
  if (s.target !== "u1") return {};
  // U1: keep the creator's settings, and keep every colour (Full Spectrum is a no-op for ≤4-colour or
  // unpainted files, so those convert exactly as before). A non-tested nozzle passes its derived machine.
  return { mode: "preserve", fullSpectrum: true, ...(s.nozzle !== U1_TESTED_NOZZLE ? { machine: u1NozzleVariant(s.nozzle) } : {}) };
}

/** The short name a button or toast uses: "U1", "X1 Carbon", "MK4S + MMU3", "generic". */
export function shortName(s: Settings): string {
  if (s.target === "u1") return "U1";
  if (s.target === "generic") return "generic 3MF";
  const m = MACHINES[s.target];
  if (!m) return s.target;
  return m.vendor && m.name.startsWith(m.vendor + " ") ? m.name.slice(m.vendor.length + 1) : m.name;
}

/** Output filename suffix — the same one bedready.io/convert writes, so files from both read alike. */
export function suffixOf(target: CleanTarget): string {
  return target === "u1" ? ".u1.3mf" : target === "generic" ? ".generic.3mf" : `.${target}.3mf`;
}

/** Does this name look like something we already wrote? Guards the interceptor against its own output. */
export function isOurOutput(name: string): boolean {
  const n = name.toLowerCase();
  return TARGETS.some((t) => n.endsWith(suffixOf(t.id).toLowerCase()));
}

/**
 * Is a file's embedded printer profile already the chosen target? Then converting it again changes
 * nothing useful, and the interceptor leaves the download alone. `printer` is `detectProfile().printer`.
 */
export function alreadyFor(s: Settings, info: { isU1: boolean; printer: string | null }): boolean {
  if (s.target === "u1") {
    if (!info.isU1) return false;
    // "Snapmaker U1 (0.4 nozzle)": a U1 file at another nozzle still needs converting to the chosen one.
    const nz = /\(([\d.]+)\s*nozzle\)/i.exec(info.printer || "");
    return !nz || Number(nz[1]) === s.nozzle;
  }
  if (s.target === "generic" || !info.printer) return false;
  const m = MACHINES[s.target];
  if (!m) return false;
  const p = info.printer.trim().toLowerCase();
  // Bambu writes "Bambu Lab X1 Carbon 0.4 nozzle": the machine name, then the nozzle.
  return [m.name, m.printerSettingsId, m.printerModel].some((n) => {
    const k = (n || "").toLowerCase();
    return !!k && (p === k || p.startsWith(k + " "));
  });
}
