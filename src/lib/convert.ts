// Conversion core — intentionally free of `three` so it bundles small for the browser extension.
// The three-dependent helpers (modelSizeMM, threeMFToSTL) live in ./convert-mesh.
import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";
import { U1, MACHINES, configFamily, type Machine, type Flavour } from "./targets";

// A .3mf is an untrusted zip. Guard against decompression bombs / oversized input BEFORE inflating it
// into memory: cap the compressed input, and (via the filter, which sees each entry's uncompressed size
// from the zip header before decompressing) cap the total inflated size — skip + bail past the cap so a
// tiny hostile file can't OOM the tab or the extension's service worker. Reachable automatically through
// the extension's download interceptor, so this is a real safety boundary, not just a nicety.
const MAX_ZIP_COMPRESSED = 200 * 1024 * 1024; // 200 MB on disk
const MAX_ZIP_INFLATED = 800 * 1024 * 1024; // 800 MB decompressed (sum of entries)
/**
 * Why a .3mf was rejected, in a form the UI can translate and act on.
 *
 * These limits are real and stay — a browser tab cannot inflate a gigabyte, and the cap is also the
 * zip-bomb defence. But the reason used to be thrown as a bare English sentence that the convert page
 * discarded, so a legitimate 228 MB multi-plate model just produced "Couldn't read that 3MF." The
 * numbers travel with the error now so the page can say what actually happened and what to do.
 */
export type ThreeMFErrorCode = "too_large" | "expands_too_large";

export class ThreeMFError extends Error {
  constructor(
    readonly code: ThreeMFErrorCode,
    /** Megabytes, rounded — what the file is, and what the limit is. */
    readonly sizeMB: number,
    readonly capMB: number,
  ) {
    super(`${code}: ${sizeMB}MB exceeds ${capMB}MB`);
    this.name = "ThreeMFError";
  }
}

const MB = 1024 * 1024;

/** Entries we decode to a JS string (the rest — thumbnails — stay binary). */
const TEXT_ENTRY = /\.(model|config|xml|rels)$/i;
/** V8's hard maximum string length (2^29 - 24 chars). Decoding past this throws a RangeError. */
export const MAX_TEXT_ENTRY = 0x1fffffe8;

/** Would decoding this entry to a string blow V8's limit? Pure, so it's testable without a 512 MB fixture. */
export function textEntryTooLarge(path: string, byteLength: number): boolean {
  return TEXT_ENTRY.test(path) && byteLength > MAX_TEXT_ENTRY;
}

export function safeUnzip(buf: Uint8Array): Record<string, Uint8Array> {
  if (buf.length > MAX_ZIP_COMPRESSED) {
    throw new ThreeMFError("too_large", Math.round(buf.length / MB), Math.round(MAX_ZIP_COMPRESSED / MB));
  }
  let inflated = 0;
  let overflow = false;
  const out = unzipSync(buf, {
    filter: (f) => {
      inflated += f.originalSize || 0; // originalSize = uncompressed size, read from the header pre-inflate
      if (inflated > MAX_ZIP_INFLATED) { overflow = true; return false; }
      return true;
    },
  });
  // `inflated` kept counting past the cap, so it reports the file's real expanded size, not the cap.
  if (overflow) {
    throw new ThreeMFError("expands_too_large", Math.round(inflated / MB), Math.round(MAX_ZIP_INFLATED / MB));
  }

  // A SINGLE entry can also be too big even when the total is under the cap. Every .model/.config is
  // decoded to a JS string, and V8 refuses beyond 2^29-24 chars (~512 MB) with
  // "Cannot create a string longer than 0x1fffffe8 characters" — a raw RangeError that reached the UI
  // as "Couldn't read that 3MF."
  //
  // Found by running 484 real .3mf files from a user's Downloads through this path: a 89 MB Luffy
  // model holds one 707 MB object_1.model, so it clears the 800 MB total cap and then dies on the
  // decode. Catch it here, where the size is known, rather than letting a V8 internal surface.
  for (const [path, data] of Object.entries(out)) {
    if (textEntryTooLarge(path, data.byteLength)) {
      throw new ThreeMFError("expands_too_large", Math.round(data.byteLength / MB), Math.round(MAX_TEXT_ENTRY / MB));
    }
  }
  return out;
}
// Cap the attacker-controlled filament-palette size before the mix-search paths (bestPhysicalSet / mix
// search are ~O(N⁴) in the colour count, which comes straight from the file). No real file has anywhere
// near this many spools; a larger count means a malformed/hostile file.
const MAX_COLORS = 64;
import { remapPaintCode, dominantState, applyPrusaVolumePaint, extractMeshFromBuffer, paletteFromFullSpectrum, recipesFromFullSpectrum } from "./paint";
import { detectColorBandsForMesh, type BandPlan, type ColorBand } from "./color-bands";
import { insertSwapPauses, buildBandSwapPlan, type SwapInstruction } from "./swap-pauses";
import { mixRgb } from "./filament-mixer";
import { serializeMixedDefs, MIXED_DITHERING_DEFAULTS, type MixedDef } from "./mixed-filament";

/** Snapmaker U1 build volume (mm). Kept for callers; sourced from the U1 machine definition. */
export const U1_BUILD_MM = U1.buildMM;
/** Snapmaker U1 max build height / Z (mm), from the U1 machine definition. */
export const U1_BUILD_Z_MM = U1.buildZMM;

/** Tally painted-area usage per filament state (for painted-file color reduction). */
function tallyPaintUsage(entries: Record<string, Uint8Array>, n: number): number[] {
  const usage = new Array<number>(n).fill(0);
  for (const [path, data] of Object.entries(entries)) {
    if (!path.toLowerCase().endsWith(".model")) continue;
    for (const m of strFromU8(data).matchAll(/paint_color="([0-9A-Fa-f]+)"/g)) {
      const s = dominantState(m[1]);
      if (s >= 1 && s <= n) usage[s - 1] += 1;
    }
  }
  return usage;
}

// "Generic" (strip-vendor-lock) export: the members a clean core-spec 3MF keeps. Everything else
// (Metadata/*.config vendor slicer settings, .gcode, .ini, plate artifacts…) is dropped. Colours and
// painted segmentation live in the .model geometry, so they survive; only the vendor *config* goes.
// Mirrors the desktop app's normalize mode (lib/mf-convert.js): keep 3D/, _rels/, [Content_Types].xml,
// .model, .rels + any image (thumbnails / Auxiliaries).
const GENERIC_CORE = /(^3D\/|^_rels\/|\.rels$|\[Content_Types\]\.xml$|\.model$)/i;
const GENERIC_IMAGE = /\.(png|jpe?g)$/i;
function isGenericKeep(path: string): boolean {
  return GENERIC_CORE.test(path) || GENERIC_IMAGE.test(path);
}

/** Foreign machine/print junk to strip. Geometry + model/color config are kept. */
function isStrippable(path: string): boolean {
  const p = path.toLowerCase();
  const base = p.split("/").pop() ?? "";
  if (base === "slice_info.config") return true;
  if (base === "slic3r_pe.config") return true;
  if (base === "slic3r_pe_model.config") return true; // Prusa model config (read upfront, then dropped)
  if (base === "creality.config") return true; // Creality vendor marker — Snapmaker Orca ignores it
  if (base.endsWith(".ini") && p.includes("metadata/")) return true;
  if (/^metadata\/(plate|top|pick)_/.test(p)) return true;
  if (base.endsWith(".gcode") || base.endsWith(".gcode.md5")) return true;
  return false;
}

// ---------- color helpers ----------

/** Normalize a hex color to #RRGGBB (drops alpha). */
export function normalizeHex(h: string): string {
  const s = (h || "").replace("#", "");
  if (s.length >= 6) return "#" + s.slice(0, 6).toUpperCase();
  return "#FFFFFF";
}
function hexToRgb(h: string): [number, number, number] {
  const s = normalizeHex(h).slice(1);
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

// Perceptual color: sRGB -> CIELAB, so "nearness" matches the human eye (not raw RGB).
function srgbToLinear(c: number): number {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}
function rgbToLab([r, g, b]: [number, number, number]): [number, number, number] {
  const R = srgbToLinear(r),
    G = srgbToLinear(g),
    B = srgbToLinear(b);
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X),
    fy = f(Y),
    fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
// Perceptual distance between two CIELAB colours via CIEDE2000 (ΔE00) — the modern standard. It fixes
// CIE76's (plain Euclidean) known non-uniformities: it down-weights differences in saturated regions,
// corrects the blue-hue rotation, and separately weights lightness/chroma/hue. Because our mix *prediction*
// already matches the slicer's pigment model (filament-mixer.ts), a better distance metric is the one
// remaining lever for choosing which mix / physical set best reproduces a target colour. kL=kC=kH=1.
function deltaE(a: [number, number, number], b: [number, number, number]): number {
  const [L1, a1, b1] = a;
  const [L2, a2, b2] = b;
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const Cbar7 = Cbar ** 7;
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const hp = (y: number, x: number) => { let h = Math.atan2(y, x) / rad; if (h < 0) h += 360; return h; };
  const h1p = C1p === 0 ? 0 : hp(b1, a1p);
  const h2p = C2p === 0 ? 0 : hp(b2, a2p);
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);
  const Lbarp = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;
  let hbarp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) hbarp = (h1p + h2p) / 2;
    else if (h1p + h2p < 360) hbarp = (h1p + h2p + 360) / 2;
    else hbarp = (h1p + h2p - 360) / 2;
  }
  const T =
    1 - 0.17 * Math.cos((hbarp - 30) * rad) + 0.24 * Math.cos(2 * hbarp * rad) +
    0.32 * Math.cos((3 * hbarp + 6) * rad) - 0.2 * Math.cos((4 * hbarp - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hbarp - 275) / 25) ** 2));
  const Cbarp7 = Cbarp ** 7;
  const Rc = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + 25 ** 7));
  const SL = 1 + (0.015 * (Lbarp - 50) ** 2) / Math.sqrt(20 + (Lbarp - 50) ** 2);
  const SC = 1 + 0.045 * Cbarp;
  const SH = 1 + 0.015 * Cbarp * T;
  const RT = -Math.sin(2 * dTheta * rad) * Rc;
  const lTerm = dLp / SL;
  const cTerm = dCp / SC;
  const hTerm = dHp / SH;
  return Math.sqrt(lTerm ** 2 + cTerm ** 2 + hTerm ** 2 + RT * cTerm * hTerm);
}
function rgbHex([r, g, b]: [number, number, number]): string {
  return "#" + [r, g, b].map((v) => Math.round(v).toString(16).toUpperCase().padStart(2, "0")).join("");
}

/** Closest approximation of `targetHex` as a Snapmaker "Full Spectrum" pigment mix of the loaded base
 *  filaments (1-based `a`/`b` indices). Searches every base pair × ratio step + pure singles using the
 *  ported slicer mixer; `a === b` means a pure colour is closer than any mix (no mixing needed). */
export type MixMatch = { a: number; b: number; mixBPercent: number; hex: string; deltaE: number };
export function bestMix(targetHex: string, baseHexes: string[]): MixMatch {
  const tLab = rgbToLab(hexToRgb(targetHex));
  const bases = baseHexes.map((h) => hexToRgb(h));
  let best: MixMatch | null = null;
  const consider = (a: number, b: number, pct: number, rgb: [number, number, number]) => {
    const dE = deltaE(tLab, rgbToLab(rgb));
    if (!best || dE < best.deltaE) best = { a: a + 1, b: b + 1, mixBPercent: pct, hex: rgbHex(rgb), deltaE: dE };
  };
  for (let i = 0; i < bases.length; i++) {
    consider(i, i, 0, bases[i]); // pure single base
    // Orca's Match Mix uses a 15% Min Mix Ratio — a component below that = too-thin dither layers, so
    // we don't propose sub-15% blends (they'd merge to the dominant colour anyway).
    for (let j = i + 1; j < bases.length; j++)
      for (let pct = MIN_MIX_RATIO; pct <= 100 - MIN_MIX_RATIO; pct += 5) consider(i, j, pct, mixRgb(bases[i], bases[j], pct / 100));
  }
  return best!;
}

/** Snapmaker Orca's "Min Mix Ratio" default — a mixed region's minor component must be ≥ this %, or the
 *  alternating layers get too thin to print cleanly. We honour it in the mix search + near-pure merges. */
export const MIN_MIX_RATIO = 15;

/** Weighted 3-filament blend (approximation via sequential 2-way mixing), matching how the U1 layers
 *  a gradient mix. Weights are percentages (sum ~100), in the same order as the colours. */
function mix3(rgb: [number, number, number][], w: number[]): [number, number, number] {
  const wab = w[0] + w[1];
  const t1 = mixRgb(rgb[0], rgb[1], wab > 0 ? w[1] / wab : 0.5);
  return mixRgb(t1, rgb[2], (w[2] ?? 0) / 100);
}

/** Best mix of the base filaments as a 2- OR 3-component blend (1-based ids). Searches pure singles +
 *  pairs (fine) + triples (coarse), perceptual ΔE. A triple must beat the best 2-way by >1.5 ΔE to win
 *  (avoids needless 3-filament mixes). ids.length: 1 = pure, 2 = pair, 3 = triple (the U1's gradient
 *  form: g<ids>/w<weights>). Verified the 3-way encoding against a real Orca save. */
export type MixMulti = { ids: number[]; weights: number[]; hex: string; deltaE: number };
export function bestMixMulti(targetHex: string, baseHexes: string[]): MixMulti {
  const tLab = rgbToLab(hexToRgb(targetHex));
  const bases = baseHexes.map((h) => hexToRgb(h));
  const n = bases.length;
  let best: MixMulti | null = null;
  const consider = (ids: number[], weights: number[], rgb: [number, number, number], bias = 0) => {
    const dE = deltaE(tLab, rgbToLab(rgb));
    if (!best || dE + bias < best.deltaE) best = { ids: ids.map((x) => x + 1), weights, hex: rgbHex(rgb), deltaE: dE };
  };
  const MIN = MIN_MIX_RATIO; // 15% — no component below this (Orca Min Mix Ratio)
  for (let i = 0; i < n; i++) {
    consider([i], [100], bases[i]);
    for (let j = i + 1; j < n; j++)
      for (let p = MIN; p <= 100 - MIN; p += 5) consider([i, j], [100 - p, p], mixRgb(bases[i], bases[j], p / 100));
  }
  // Triples — coarse (5% steps), every component ≥ MIN. Bias +1.5 so a 3-way only wins if clearly
  // better than the best 2-way.
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      for (let k = j + 1; k < n; k++)
        for (let wa = MIN; wa <= 100 - 2 * MIN; wa += 5)
          for (let wb = MIN; wa + wb <= 100 - MIN; wb += 5) {
            const wc = 100 - wa - wb;
            if (wc < MIN) continue;
            consider([i, j, k], [wa, wb, wc], mix3([bases[i], bases[j], bases[k]], [wa, wb, wc]), 1.5);
          }
  return best!;
}

/**
 * Pick which colours load as the (up to 4) physical Full-Spectrum heads. A mix only *approximates* a
 * colour, so we keep the colours a mix can LEAST reproduce and virtualise the ones it can fake well:
 * greedily drop the colour the survivors mix most faithfully (lowest best-mix ΔE). ΔE dominates on
 * purpose — a colour no mix can fake (e.g. white, a pure primary) must stay physical even if it's
 * barely painted, because area doesn't make a wrong colour acceptable. `usage` only breaks perceptual
 * ties (drop the less-painted of two equally-mixable colours). `pinned` colours are always kept (e.g.
 * the unpainted base, which covers most of the model). Returns palette indices, most-used first.
 */
export function bestPhysicalSet(hexes: string[], usage: number[] = [], pinned: number[] = []): number[] {
  const all = [...hexes.keys()];
  if (all.length <= 4) return all.sort((a, b) => (usage[b] ?? 0) - (usage[a] ?? 0));
  const pin = new Set(pinned.filter((i) => i >= 0 && i < hexes.length));
  const keep = new Set<number>(all);
  while (keep.size > 4) {
    const idxs = [...keep].filter((c) => !pin.has(c));
    if (!idxs.length) break; // >4 pinned colours: nothing left we're allowed to drop
    const dE = new Map<number, number>();
    for (const c of idxs) {
      const others = [...keep].filter((x) => x !== c).map((x) => normalizeHex(hexes[x]));
      dE.set(c, bestMix(normalizeHex(hexes[c]), others).deltaE);
    }
    const minDE = Math.min(...idxs.map((c) => dE.get(c)!));
    const dropI = idxs
      .filter((c) => dE.get(c)! <= minDE + 1.5) // ~JND tie band
      .sort((a, b) => (usage[a] ?? 0) - (usage[b] ?? 0))[0];
    keep.delete(dropI);
  }
  return [...keep].sort((a, b) => (usage[b] ?? 0) - (usage[a] ?? 0)); // slot 1 = most-used primary
}

/**
 * Reduce N colors to 4, perceptually (CIELAB ΔE) and usage-aware: repeatedly take
 * the LEAST-used color and fold it into its nearest-looking neighbor, so dominant
 * colors are preserved and only minor/similar ones get merged. Falls back to
 * nearest-pair merging when no usage counts are available.
 *
 * `pinned` (palette indices) protects colours from being merged away — a pinned colour is never the
 * one removed, so a small-but-important accent (eyes, a logo) keeps its own slot. Capped implicitly at
 * 4 by the caller; if somehow >4 are pinned, the least-used pinned ones still merge so we reach 4.
 */
export function reduceColors(
  hexes: string[],
  usage?: number[],
  pinned?: number[],
): { colors: string[]; map: number[] } {
  const pinSet = new Set(pinned ?? []);
  type G = { lab: [number, number, number]; members: number[]; rep: string; use: number; pin: boolean };
  const groups: G[] = hexes.map((h, i) => ({
    lab: rgbToLab(hexToRgb(h)),
    members: [i],
    rep: normalizeHex(h),
    use: usage?.[i] ?? 1,
    pin: pinSet.has(i),
  }));

  while (groups.length > 4) {
    if (usage) {
      // remove the least-used UNPINNED colour; fold it into its nearest-looking neighbor.
      let li = -1;
      for (let i = 0; i < groups.length; i++) if (!groups[i].pin && (li < 0 || groups[i].use < groups[li].use)) li = i;
      if (li < 0) for (let i = 0; i < groups.length; i++) if (li < 0 || groups[i].use < groups[li].use) li = i; // >4 pins: relax
      let ni = -1,
        nd = Infinity;
      for (let j = 0; j < groups.length; j++) {
        if (j === li) continue;
        const d = deltaE(groups[li].lab, groups[j].lab);
        if (d < nd) {
          nd = d;
          ni = j;
        }
      }
      groups[ni].members = groups[ni].members.concat(groups[li].members);
      groups[ni].use += groups[li].use;
      groups[ni].pin = groups[ni].pin || groups[li].pin;
      groups.splice(li, 1);
    } else {
      // nearest perceptual pair; remove the unpinned / less-membered one, keep the other's rep
      let bi = 0,
        bj = 1,
        bd = Infinity;
      for (let i = 0; i < groups.length; i++) {
        for (let j = i + 1; j < groups.length; j++) {
          const d = deltaE(groups[i].lab, groups[j].lab);
          if (d < bd) {
            bd = d;
            bi = i;
            bj = j;
          }
        }
      }
      const gi = groups[bi],
        gj = groups[bj];
      // remove gj when: gi is pinned-and-gj-isn't, or (same pin status) gj has ≤ members.
      const removeGj = (gi.pin && !gj.pin) || (gi.pin === gj.pin && gj.members.length <= gi.members.length);
      if (removeGj) {
        gi.members = gi.members.concat(gj.members);
        gi.pin = gi.pin || gj.pin;
        groups.splice(bj, 1);
      } else {
        gj.members = gj.members.concat(gi.members);
        gj.pin = gj.pin || gi.pin;
        groups.splice(bi, 1);
      }
    }
  }
  const map = new Array<number>(hexes.length);
  groups.forEach((g, gi) => g.members.forEach((m) => (map[m] = gi)));
  return { colors: groups.map((g) => normalizeHex(g.rep)), map };
}

/** Remap `key="extruder" value="N"` slot indices in a .config part using old->new(0..3) map. */
function remapExtruders(text: string, map: number[]): string {
  return text.replace(/(key="extruder"\s+value=")(\d+)(")/g, (_m, a, n, c) => {
    const old = parseInt(n, 10);
    const ni = old >= 1 && old <= map.length ? map[old - 1] + 1 : old;
    return `${a}${ni}${c}`;
  });
}

// ---------- filament preset naming ----------
// Which NAME each slot's filament preset carries. It changes no print setting — it decides which
// library preset Snapmaker Orca resolves the slot to, and model repositories can require projects to
// declare Generic or vendor presets rather than another printer's brand.
//
//   "source"    — keep whatever the author's file declared, falling back to Generic (the default,
//                 and what every conversion did before this option existed).
//   "generic"   — Generic <type>, the universally-resolvable name.
//   "snapmaker" — Snapmaker <type> where such a preset actually exists, else Generic <type>.
export type FilamentBrand = "source" | "generic" | "snapmaker";

// Materials Snapmaker ships a plainly-named preset for, taken from the U1's own filament catalogue
// (`public/orca-filaments/manifest.json`) rather than assumed. It is hardcoded because the converter
// runs offline in the browser and the extension, and `orca-filaments.test.mts` asserts it still
// matches the catalogue — so this list cannot drift from reality without a test failing.
//
// PA and PC are deliberately absent: the catalogue has "Snapmaker PA-CF" but no "Snapmaker PA", and
// nothing for PC. Naming a preset that does not exist is worse than naming a Generic one that does.
const SNAPMAKER_PRESET_TYPES = new Set(["PLA", "PETG", "ABS", "ASA", "PET", "PVA", "TPU"]);

/** The filament preset name for one slot under the chosen brand mode. */
export function filamentPresetId(type: string, brand: FilamentBrand = "source", sourceId?: string): string {
  const t = type || "PLA";
  if (brand === "snapmaker") return SNAPMAKER_PRESET_TYPES.has(t) ? `Snapmaker ${t}` : `Generic ${t}`;
  if (brand === "generic") return `Generic ${t}`;
  return sourceId ?? `Generic ${t}`;
}

/** Build a complete U1 project_settings.config from the bundled profile + given colors/types. */
function buildU1Config(colors: string[], types: string[], hasVLH = false, diff?: DiffReport, machine: Machine = U1, brand: FilamentBrand = "source"): string {
  const cfg = JSON.parse(JSON.stringify(machine.profile)) as Record<string, unknown[]>;
  const baseId = (cfg.filament_settings_id?.[0] as string) ?? "Generic PLA";

  const colour: string[] = [];
  const type: string[] = [];
  const sid: string[] = [];
  for (let i = 0; i < 4; i++) {
    colour.push(normalizeHex(colors[i] ?? (cfg.filament_colour[i] as string) ?? "#FFFFFF"));
    const t = types[i] ?? (cfg.filament_type[i] as string) ?? "PLA";
    type.push(t);
    // Stamp mode has no author preset to fall back on, so "source" keeps the reference profile's own
    // name — the behaviour every stamp produced before brand modes existed.
    sid.push(
      brand === "source"
        ? (types[i] ? baseId.replace(/^Generic\s+\S+/, `Generic ${t}`) : (cfg.filament_settings_id[i] as string))
        : filamentPresetId(t, brand),
    );
  }
  cfg.filament_colour = colour;
  cfg.filament_type = type;
  cfg.filament_settings_id = sid;
  if (hasVLH) applyVlhGuard(cfg as Record<string, unknown>, diff);
  return JSON.stringify(cfg);
}

// Keys whose VALUE must come from the U1 reference (hardware identity / machine / G-code).
// Everything else preserves the source file's process intent in "preserve" mode.
const U1_IDENTITY_KEYS = new Set([
  "printable_area", "printable_height", "bed_exclude_area", "bed_custom_model", "bed_custom_texture",
  "extruder_offset", "extruder_clearance_height_to_lid", "extruder_clearance_height_to_rod",
  "extruder_clearance_radius", "single_extruder_multi_material", "single_extruder_multi_material_priming",
  "gcode_flavor", "emit_machine_limits_to_gcode", "before_layer_change_gcode", "layer_change_gcode",
  "change_filament_gcode", "change_extrusion_role_gcode", "time_lapse_gcode", "printing_by_object_gcode",
  "template_custom_gcode", "version", "name",
]);
function isU1IdentityKey(k: string): boolean {
  if (k.startsWith("machine_")) return true; // limits, machine G-code, tool-change times
  if (k.startsWith("printer_")) return true; // printer_model / _settings_id / _variant / _structure …
  // Nozzle hardware (diameter, type, volume…) is machine identity. The creator's chosen TEMPERATURE
  // is not — that's a filament decision worth preserving, so it stays (clamped, see U1_CLAMP_KEYS).
  // But `nozzle_temperature_range_high` / `_range_low` describe what the MACHINE can do, and they're
  // what a validator reads. Preserving those meant the output declared the source printer's safe
  // range, so a too-hot preserved temp looked in-range to anything downstream.
  if (k.startsWith("nozzle_temperature_range")) return true;
  if (k.startsWith("nozzle_") && !k.startsWith("nozzle_temperature")) return true;
  return U1_IDENTITY_KEYS.has(k);
}

/** Map a source per-filament array (length = source filament count) to exactly 4 U1 slots. */
function mapTo4<T>(arr: T[], assign: number[], u1Arr: T[]): T[] {
  const out: T[] = [];
  for (let s = 0; s < 4; s++) {
    const i = assign.findIndex((a) => a === s);
    out.push(i >= 0 && i < arr.length ? arr[i] : (arr[0] ?? u1Arr[s] ?? u1Arr[0]));
  }
  return out;
}

// ---------- U1 output-safety guards (preserve mode only) ----------
// In "preserve" mode we keep the creator's process settings, but several source values are unsafe
// or invalid on the U1. These guards (key sets ported from thadius83/bambu-to-snapmaker-u1) make the
// preserved output actually slice + print correctly. Stamp mode uses the U1 profile wholesale, so it
// needs none of this.

// Speeds/accels capped at the U1 reference ceiling — a fast Bambu profile would otherwise emit motion
// the U1 can't sustain. Clamped element-wise for per-extruder arrays.
const U1_CLAMP_KEYS = new Set([
  "outer_wall_speed", "inner_wall_speed", "sparse_infill_speed", "internal_solid_infill_speed",
  "top_surface_speed", "gap_infill_speed", "travel_speed", "initial_layer_speed",
  "initial_layer_infill_speed", "initial_layer_travel_speed", "overhang_1_4_speed",
  "overhang_2_4_speed", "overhang_3_4_speed", "overhang_4_4_speed", "bridge_speed",
  "support_speed", "support_interface_speed", "default_acceleration", "outer_wall_acceleration",
  "inner_wall_acceleration", "sparse_infill_acceleration", "top_surface_acceleration",
  "initial_layer_acceleration", "travel_acceleration", "bridge_acceleration",
  // Hot-end temperature. Preserve mode carries the creator's temps over verbatim, and a project
  // sliced for ABS/ASA/PC on a machine with a hotter hot end routinely specifies 290–300 °C — which
  // then rode through into a file claiming to be U1-ready. See U1_CLAMP_AGAINST for the ceiling used.
  "nozzle_temperature", "nozzle_temperature_initial_layer",
]);
// Most clamped keys are capped at the U1 reference's value for the SAME key. Temperature can't be:
// the reference's `nozzle_temperature` (270) is just whatever filament the reference profile happened
// to use, not a limit — clamping to it would wrongly cool a legitimate 275 °C PETG setting. Cap
// against the profile's declared range ceiling instead, which is the one value that actually means
// "don't go above this".
//
// Deliberately no LOWER clamp: `nozzle_temperature_range_low` (240) is likewise filament-specific,
// and a source printing PLA at 190 °C is correct, not out of range.
const U1_CLAMP_AGAINST: Record<string, string> = {
  nozzle_temperature: "nozzle_temperature_range_high",
  nozzle_temperature_initial_layer: "nozzle_temperature_range_high",
};
// Bambu uses "0" as an auto-sentinel for these filament-slot keys; Orca needs an explicit slot.
const U1_FILAMENT_SLOT_SENTINEL_KEYS = new Set([
  "wall_filament", "sparse_infill_filament", "solid_infill_filament", "support_filament",
  "support_interface_filament", "wipe_tower_filament",
]);
// Bambu uses -1 as an inherit/auto sentinel for these; Orca needs a real value.
const U1_NEGATIVE_SENTINEL_KEYS = new Set([
  "raft_first_layer_expansion", "tree_support_wall_count", "prime_tower_lift_height",
]);
// Bambu enum strings Orca doesn't recognise.
const U1_VALUE_REMAP: Record<string, Record<string, string>> = {
  ensure_vertical_shell_thickness: { disabled: "none", enabled: "ensure_all", partial: "ensure_all" },
  support_style: { tree_organic: "default" },
};
// Prime/wipe-tower stability: always take these from the tested U1 reference (e.g. rib wall type)
// even in preserve mode — tower shift/collapse is the #1 officially-documented U1 multicolour failure.
const U1_TOWER_SAFETY_KEYS = new Set(["wipe_tower_wall_type", "prime_tower_brim_width"]);

const refAt = (ref: unknown, i: number): unknown =>
  Array.isArray(ref) ? (ref[i] ?? ref[0]) : ref;
/** Map a scalar-or-array value element-wise against a scalar-or-array reference. */
function mapVal(v: unknown, ref: unknown, fn: (val: unknown, r: unknown) => unknown): unknown {
  return Array.isArray(v) ? v.map((x, i) => fn(x, refAt(ref, i))) : fn(v, refAt(ref, 0));
}
function clampNum(v: unknown, ref: unknown): unknown {
  const n = parseFloat(String(v)), c = parseFloat(String(ref));
  // c <= 0 is an auto/match sentinel in Orca (e.g. overhang speeds), not a real ceiling — don't clamp to it.
  if (!Number.isFinite(n) || !Number.isFinite(c) || c <= 0 || n <= c) return v;
  return typeof v === "string" ? String(c) : c; // preserve the source's JSON type
}
/** Largest numeric element (for reporting an array clamp by its worst-case value). */
function maxNum(v: unknown): number {
  const nums = (Array.isArray(v) ? v : [v]).map((x) => parseFloat(String(x))).filter(Number.isFinite);
  return nums.length ? Math.max(...nums) : NaN;
}

/** Apply the U1 output-safety guards to a preserved config in place. `u1` is the reference profile. */
/** A plain-language record of what the conversion changed — surfaced to the user for trust. */
export type DiffReport = {
  mode: "preserve" | "stamp";
  printerFrom: string | null; // source printer/profile name, if any
  printerTo: string; // U1 profile we targeted
  clamped: { key: string; from: string; to: string }[]; // speeds/accels capped to U1 limits
  sentinelFixed: string[]; // Bambu auto-sentinels (0 / -1 / 0-width / enum) normalised
  towerSafety: string[]; // creator's tower keys overridden with U1-safe values
  droppedForeignKeys: number; // foreign-only profile keys removed
  antiClobber: boolean; // inherits_group blanked / print_settings_id suffixed
  vlhGuard: boolean; // variable-layer-height present → prime tower off / tree→normal supports
  bedShift: { dx: number; dy: number } | null; // model nudged off the U1's excluded bed border
  prusaPaint: boolean; // PrusaSlicer slic3rpe: paint attributes renamed to Orca's paint_* names
  foreignNative: boolean; // foreign producer (Prusa/Creality/…) rewritten so Orca loads it as native
  fullSpectrumMixes: number; // count of Full Spectrum mixed-filament definitions written (0 = off)
  nozzleFit: { key: string; from: string; to: string }[]; // extrusion widths / layer heights refitted to the target nozzle
  untestedProfile: boolean; // target profile is derived, not a real export anyone has printed from
  keptAllColours: number; // >4 pass-through: filaments written out untouched (0 = not this mode)
  filamentBrand: FilamentBrand | null; // relabelled the filament presets (null = kept the author's)
};

// ---------- nozzle fit (preserve + Full Spectrum modes) ----------
// `nozzle_diameter` is identity, so a converted file always DECLARES the target's nozzle. Extrusion
// widths and layer heights are process settings, so in preserve mode they arrive from the source — and
// nothing until now reconciled the two. A 0.6-nozzle source converted for a 0.4 U1 produced a file
// claiming a 0.4 nozzle while asking for 0.63 mm extrusions, silently, and that has been true for every
// mismatched source since launch. It became visible while adding U1 nozzle variants, where the mismatch
// is the normal case rather than the unusual one.
//
// The fix is the same rule in both directions: scale the source's nozzle-dependent values by
// target/source, then hold layer height inside the band the reference profile itself declares (20%–80%
// of nozzle — 0.08/0.32 on the 0.4 reference). A matched nozzle changes nothing.
const NOZZLE_FIT_KEYS = new Set([
  "line_width", "initial_layer_line_width", "inner_wall_line_width", "outer_wall_line_width",
  "internal_solid_infill_line_width", "sparse_infill_line_width", "support_line_width",
  "top_surface_line_width", "layer_height", "initial_layer_print_height",
]);
// Machine limits, not preferences: they describe what the installed nozzle can extrude, so they come
// from the target reference rather than the source, whatever the source believed.
const NOZZLE_LIMIT_KEYS = ["max_layer_height", "min_layer_height"];
const LAYER_MIN_RATIO = 0.2, LAYER_MAX_RATIO = 0.8;

/** Nozzle diameter declared by a config, or NaN. Per-extruder arrays are uniform on the U1. */
function nozzleOf(cfg: Record<string, unknown> | undefined): number {
  const v = cfg?.nozzle_diameter;
  return parseFloat(String(Array.isArray(v) ? v[0] : v));
}

/**
 * Refit preserved extrusion widths and layer heights from the source's nozzle to the target's, in
 * place. No-op when the two match (the overwhelmingly common case) or when either is unknown.
 */
function applyNozzleFit(
  out: Record<string, unknown>,
  src: Record<string, unknown>,
  ref: Record<string, unknown>,
  diff?: DiffReport,
): void {
  const tgt = nozzleOf(ref), from = nozzleOf(src);
  if (!Number.isFinite(tgt) || !Number.isFinite(from) || tgt <= 0 || from <= 0) return;
  for (const k of NOZZLE_LIMIT_KEYS) if (k in ref) out[k] = ref[k];
  if (Math.abs(tgt - from) < 0.001) return;

  const ratio = tgt / from;
  const lo = +(tgt * LAYER_MIN_RATIO).toFixed(2), hi = +(tgt * LAYER_MAX_RATIO).toFixed(2);
  for (const k of NOZZLE_FIT_KEYS) {
    const v = out[k];
    if (v === undefined || Array.isArray(v)) continue;
    const s = String(v);
    if (s.includes("%")) continue; // already nozzle-relative
    const n = parseFloat(s);
    if (!Number.isFinite(n) || n <= 0) continue;
    let next = Math.round(n * ratio * 100) / 100;
    // Layer height has a floor and a ceiling the extrusion widths don't: too thin won't bond, too thick
    // won't fit under the nozzle. Both bounds are the reference profile's own declared ratios.
    if (k === "layer_height" || k === "initial_layer_print_height") next = Math.min(hi, Math.max(lo, next));
    if (next === n) continue;
    out[k] = typeof v === "string" ? String(next) : next;
    diff?.nozzleFit.push({ key: k, from: s, to: String(next) });
  }
}

// PrusaSlicer stores paint data under slic3rpe:* attributes; OrcaSlicer reads the same byte-for-byte
// values under paint_* names (verified against both slicers' Format/3mf source — for ≤16 colours the
// encoding is identical, so translation is a pure attribute rename, no value transform). The unused
// xmlns:slic3rpe namespace decl is harmless to leave behind.
const PRUSA_PAINT_RENAMES: [RegExp, string][] = [
  [/\bslic3rpe:mmu_segmentation=/g, "paint_color="],
  [/\bslic3rpe:custom_supports=/g, "paint_supports="],
  [/\bslic3rpe:custom_seam=/g, "paint_seam="],
  [/\bslic3rpe:fuzzy_skin=/g, "paint_fuzzy_skin="],
];
function renamePrusaPaint(xml: string): string {
  let out = xml;
  for (const [re, to] of PRUSA_PAINT_RENAMES) out = out.replace(re, to);
  // Drop the Prusa namespace decl + any residual slic3rpe:* attrs — their presence makes Orca treat
  // the file as a foreign (Prusa) 3mf and load "geometry only".
  out = out.replace(/\s+xmlns:slic3rpe="[^"]*"/g, "").replace(/\s+slic3rpe:[\w-]+="[^"]*"/g, "");
  return out;
}

// Snapmaker Orca (like mainline OrcaSlicer/Bambu Studio) only fully imports a .3mf — colours, painted
// segmentation, plate/object assignments — when the producer string starts with an accepted prefix
// (its `m_is_bbl_3mf` whitelist). Foreign producers ("PrusaSlicer-2.x", "Creality_Print V6…", Cura,
// etc.) flip that flag false and the file loads "geometry data only" with all colour data dropped.
// Rewriting the <metadata name="Application"> value to an OrcaSlicer- string makes the converted file
// be trusted as a native project. Verified against OrcaSlicer/CrealityPrint Format/bbs_3mf.cpp.
const ORCA_GENERATOR = "OrcaSlicer-2.1.1";
const TRUSTED_GENERATORS = /^(BambuStudio-|OrcaSlicer-|SnapmakerOrca-)/;
function applicationValue(xml: string): string | null {
  const m = /<metadata\s+name="Application"[^>]*>([^<]*)<\/metadata>/.exec(xml);
  return m ? m[1].trim() : null;
}
/** True if a .model's producer string would make Snapmaker Orca load geometry-only. */
function needsGeneratorFix(xml: string): boolean {
  const app = applicationValue(xml);
  return app !== null && !TRUSTED_GENERATORS.test(app);
}
function forceOrcaGenerator(xml: string): string {
  return xml.replace(
    /(<metadata\s+name="Application"[^>]*>)[^<]*(<\/metadata>)/g,
    (_m, open, close) => `${open}${ORCA_GENERATOR}${close}`,
  );
}

/** Orca/Bambu projects require a model_settings.config (plate + object assignments). Prusa files have
 *  none, so synthesize a minimal valid one from the .model's build items, or Orca falls back to
 *  geometry-only on load. */
function generateOrcaModelSettings(mainModelXml: string): string {
  const items = [...mainModelXml.matchAll(/<item\b([^>]*?)\/>/g)]
    .map((m) => ({ id: /objectid="(\d+)"/.exec(m[1])?.[1], tr: /transform="([^"]*)"/.exec(m[1])?.[1] ?? "1 0 0 0 1 0 0 0 1 0 0 0" }))
    .filter((it): it is { id: string; tr: string } => !!it.id);
  if (!items.length) return "";
  const objs = items.map((it) => `  <object id="${it.id}">\n    <metadata key="name" value="object ${it.id}"/>\n    <metadata key="extruder" value="1"/>\n  </object>`).join("\n");
  const insts = items.map((it) => `    <model_instance>\n      <metadata key="object_id" value="${it.id}"/>\n      <metadata key="instance_id" value="0"/>\n    </model_instance>`).join("\n");
  const asm = items.map((it) => `  <assemble_item object_id="${it.id}" instance_id="0" transform="${it.tr}" offset="0 0 0"/>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<config>\n${objs}\n  <plate>\n    <metadata key="plater_id" value="1"/>\n    <metadata key="plater_name" value=""/>\n    <metadata key="locked" value="false"/>\n${insts}\n  </plate>\n  <assemble>\n${asm}\n  </assemble>\n</config>\n`;
}

/** Parse the filament palette from a PrusaSlicer Slic3r_PE.config (INI; keys are `; key = a;b;c`).
 *  Prusa files carry no project_settings.config, so this is where their colours/types come from. */
function readPrusaPalette(entries: Record<string, Uint8Array>): { colours: string[]; types: string[] } | null {
  for (const [path, data] of Object.entries(entries)) {
    if ((path.split("/").pop() ?? "").toLowerCase() !== "slic3r_pe.config") continue;
    const text = strFromU8(data);
    const grab = (key: string): string[] => {
      const m = text.match(new RegExp(`^;?\\s*${key}\\s*=\\s*(.+)$`, "m"));
      return m ? m[1].trim().split(/[;,]/).map((s) => s.trim()).filter(Boolean) : [];
    };
    // PrusaSlicer MMU painting references EXTRUDERS, so the true per-color palette is often in
    // extruder_colour — filament_colour may be left at a single default (e.g. all #FF8000). Use
    // whichever has real variety.
    const fc = grab("filament_colour").map(normalizeHex);
    const ec = grab("extruder_colour").map(normalizeHex);
    const distinct = (a: string[]) => new Set(a).size;
    const colours = distinct(fc) >= 2 ? fc : distinct(ec) >= 2 ? ec : fc.length ? fc : ec;
    if (colours.length) return { colours, types: grab("filament_type") };
  }
  return null;
}

/** True if any .model carries PrusaSlicer paint attributes (slic3rpe:*). */
function hasPrusaPaint(entries: Record<string, Uint8Array>): boolean {
  for (const [path, data] of Object.entries(entries)) {
    if (path.toLowerCase().endsWith(".model") && strFromU8(data).includes("slic3rpe:")) return true;
  }
  return false;
}

/** First corner of a printable_area list, e.g. "0.5x1" → [0.5, 1]; defaults to [0,0]. */
function bedOrigin(area: unknown): [number, number] {
  const c = String((Array.isArray(area) ? area[0] : "") ?? "").split("x").map(Number);
  return [Number.isFinite(c[0]) ? c[0] : 0, Number.isFinite(c[1]) ? c[1] : 0];
}

/** Shift every build-item placement by (dx,dy) — the translation is the last 3 values of an
 *  `<item transform>`. Skips multi-plate layouts (coords > 400mm). Returns whether it changed anything. */
function shiftBuildItems(xml: string, dx: number, dy: number): { xml: string; applied: boolean } {
  if (!dx && !dy) return { xml, applied: false };
  let max = 0;
  for (const m of xml.matchAll(/transform="([^"]+)"/g)) {
    const v = m[1].trim().split(/\s+/).map(Number);
    if (v.length >= 12) max = Math.max(max, Math.abs(v[9]), Math.abs(v[10]));
  }
  if (max > 400) return { xml, applied: false }; // looks like a multi-plate arrangement — don't touch
  let applied = false;
  const out = xml.replace(/(<item\b[^>]*\btransform=")([^"]+)(")/g, (m, a, t, c) => {
    const v = t.trim().split(/\s+/);
    if (v.length < 12) return m;
    v[9] = String(parseFloat(v[9]) + dx);
    v[10] = String(parseFloat(v[10]) + dy);
    applied = true;
    return `${a}${v.join(" ")}${c}`;
  });
  return { xml: out, applied };
}

/** Variable layer height breaks the prime tower + tree supports in Orca — disable/downgrade so it
 *  slices. Applied in both build paths when layer_config_ranges.xml / layer_heights_profile.txt exist. */
/** Pin process keys in different_settings_to_system[0] so Orca KEEPS our overrides on import instead of
 *  rebuilding the named system preset and reverting them. Merges with any existing diffs. Without this, a
 *  file whose list is empty (or omits the key) silently loses e.g. tower-off — Orca re-adds the prime
 *  tower, and its travels string all over the print. Format: a (filament_count+2) array; index 0 = the
 *  print-preset diffs (verified against a real Orca save). */
function pinProcessKeys(out: Record<string, unknown>, keys: string[]): void {
  if (!keys.length) return;
  const filCount = Array.isArray(out.filament_colour) ? (out.filament_colour as unknown[]).length : 4;
  const prev = Array.isArray(out.different_settings_to_system) ? (out.different_settings_to_system as string[]) : [];
  const merged = [...new Set([...(prev[0] ?? "").split(";").filter(Boolean), ...keys])].sort();
  const dss = new Array<string>(Math.max(filCount + 2, prev.length)).fill("");
  for (let i = 1; i < prev.length; i++) dss[i] = prev[i] ?? ""; // keep any per-filament diffs the source declared
  dss[0] = merged.join(";");
  out.different_settings_to_system = dss;
}

function applyVlhGuard(out: Record<string, unknown>, diff?: DiffReport): void {
  const pins: string[] = [];
  if (String(out.enable_prime_tower) !== "0") {
    out.enable_prime_tower = "0";
    pins.push("enable_prime_tower");
  }
  if (typeof out.support_type === "string" && out.support_type.startsWith("tree")) {
    out.support_type = out.support_type.replace(/^tree/, "normal"); // keep the (auto)/(manual) suffix
    pins.push("support_type");
  }
  if (pins.length) {
    pinProcessKeys(out, pins); // else Orca reverts tower-off on import → tower + stringing
    if (diff) diff.vlhGuard = true;
  }
}

function applyU1Safety(out: Record<string, unknown>, u1: Record<string, unknown>, diff?: DiffReport): void {
  const changed = (prev: string, k: string) => prev !== JSON.stringify(out[k]);

  // Tower stability — known-safe values from the U1 reference (rib wall etc.). Record only when we
  // actually overrode a different value the creator had set.
  for (const k of U1_TOWER_SAFETY_KEYS) {
    if (!(k in u1)) continue;
    const had = k in out, prev = JSON.stringify(out[k]);
    out[k] = u1[k];
    if (diff && had && changed(prev, k)) diff.towerSafety.push(k);
  }
  // Filament-slot "0" auto-sentinel -> reference slot.
  for (const k of U1_FILAMENT_SLOT_SENTINEL_KEYS) {
    if (!(k in out) || !(k in u1)) continue;
    const prev = JSON.stringify(out[k]);
    out[k] = mapVal(out[k], u1[k], (val, r) => (String(val) === "0" ? r : val));
    if (diff && changed(prev, k)) diff.sentinelFixed.push(k);
  }
  // Zero line_width -> reference line_width.
  for (const k of Object.keys(out)) {
    if ((k !== "line_width" && !k.endsWith("_line_width")) || u1[k] == null) continue;
    const prev = JSON.stringify(out[k]);
    out[k] = mapVal(out[k], u1[k], (val, r) => (parseFloat(String(val)) === 0 ? r : val));
    if (diff && changed(prev, k)) diff.sentinelFixed.push(k);
  }
  // -1 inherit-sentinel -> reference value.
  for (const k of U1_NEGATIVE_SENTINEL_KEYS) {
    if (!(k in out) || !(k in u1)) continue;
    const prev = JSON.stringify(out[k]);
    out[k] = mapVal(out[k], u1[k], (val, r) => (parseFloat(String(val)) === -1 ? r : val));
    if (diff && changed(prev, k)) diff.sentinelFixed.push(k);
  }
  // Bambu enum strings Orca doesn't know.
  for (const k of Object.keys(U1_VALUE_REMAP)) {
    if (!(k in out)) continue;
    const m = U1_VALUE_REMAP[k], prev = JSON.stringify(out[k]);
    out[k] = mapVal(out[k], null, (val) => (typeof val === "string" && val in m ? m[val] : val));
    if (diff && changed(prev, k)) diff.sentinelFixed.push(k);
  }
  // Clamp speeds/accels/temps to U1 ceilings. Most keys cap against the reference's value for the
  // same key; temperature caps against the declared range ceiling (see U1_CLAMP_AGAINST).
  for (const k of U1_CLAMP_KEYS) {
    const ceilKey = U1_CLAMP_AGAINST[k] ?? k;
    if (!(k in out) || !(ceilKey in u1)) continue;
    const prevVal = out[k], prev = JSON.stringify(prevVal);
    out[k] = mapVal(out[k], u1[ceilKey], clampNum);
    if (diff && changed(prev, k)) diff.clamped.push({ key: k, from: String(maxNum(prevVal)), to: String(maxNum(out[k])) });
  }
  // Stop Orca silently replacing our preserved settings with a same-named library profile.
  let clobber = false;
  if ("inherits_group" in out) {
    out.inherits_group = Array.isArray(out.inherits_group) ? (out.inherits_group as unknown[]).map(() => "") : "";
    clobber = true;
  }
  if (typeof out.print_settings_id === "string" && !out.print_settings_id.endsWith(" (converted)")) {
    out.print_settings_id = out.print_settings_id + " (converted)";
    clobber = true;
  }
  if (diff) diff.antiClobber = clobber;
}

/**
 * Identity-swap builder ("preserve" mode): keep the creator's process settings (layer height,
 * walls, infill, speeds, temps…) from the source, but take hardware identity (printer/nozzle/
 * machine/G-code/build-volume) from the U1 reference, drop foreign-only keys, and normalise every
 * per-filament array to the U1's 4 toolheads. `assign` maps source filament index → slot 0..3.
 */
function buildPreservedConfig(
  src: Record<string, unknown>,
  colors: string[],
  types: string[],
  assign: number[],
  diff?: DiffReport,
  hasVLH = false,
  machine: Machine = U1,
  brand: FilamentBrand = "source",
): string {
  const u1 = JSON.parse(JSON.stringify(machine.profile)) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (diff) diff.droppedForeignKeys = Object.keys(src).filter((k) => !(k in u1)).length;

  // Start from the U1 key universe (this drops any foreign-only keys the source carried).
  for (const k of Object.keys(u1)) {
    if (isU1IdentityKey(k)) out[k] = u1[k];
    else if (k in src) out[k] = src[k];
    else out[k] = u1[k];
  }

  // Normalise per-filament PROCESS arrays (4-long in the U1 ref) to 4 slots, preserving source values.
  for (const k of Object.keys(u1)) {
    if (isU1IdentityKey(k)) continue;
    const uv = u1[k];
    if (Array.isArray(uv) && uv.length === 4) {
      const sv = out[k];
      out[k] = Array.isArray(sv) ? mapTo4(sv as unknown[], assign, uv as unknown[]) : uv;
    }
  }

  // Lock in the chosen 4 slot colours/types (already reduced to <=4 by the caller).
  const baseId = (Array.isArray(u1.filament_settings_id) ? (u1.filament_settings_id[0] as string) : "") || "Generic PLA";
  const prevType = out.filament_type as string[] | undefined;
  const prevSid = out.filament_settings_id as string[] | undefined;
  out.filament_colour = [0, 1, 2, 3].map((s) => normalizeHex(colors[s] ?? "#FFFFFF"));
  out.filament_type = [0, 1, 2, 3].map((s) => types[s] ?? prevType?.[s] ?? "PLA");
  out.filament_settings_id = [0, 1, 2, 3].map((s) => {
    const t = (out.filament_type as string[])[s];
    return filamentPresetId(t, brand, prevSid?.[s] ?? baseId.replace(/^Generic\s+\S+/, `Generic ${t}`));
  });
  applyU1Safety(out, u1, diff);
  applyNozzleFit(out, src, u1, diff);
  if (hasVLH) applyVlhGuard(out, diff);
  return JSON.stringify(out);
}

/**
 * Full Spectrum builder. The kept filament list = the 4 physical (heads) + the genuine-mix virtuals,
 * selected from the source by `keptOld` (new filament index → source filament index). Per-filament
 * source arrays (length = source filament count) are reindexed to the kept set so everything lines up;
 * filaments 5+ are realised as dithered mixes via mixed_filament_definitions (added by the caller).
 */
function buildFullSpectrumConfig(
  src: Record<string, unknown>,
  keptOld: number[], // new 0-based filament index → source 0-based index
  srcCount: number, // source filament count (to detect per-filament arrays)
  keptHex: string[] | undefined, // actual hex loaded on each head (UI override), aligned to keptOld
  diff?: DiffReport,
  hasVLH = false,
  machine: Machine = U1,
  brand: FilamentBrand = "source",
): string {
  const u1 = JSON.parse(JSON.stringify(machine.profile)) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (diff) diff.droppedForeignKeys = Object.keys(src).filter((k) => !(k in u1)).length;
  for (const k of Object.keys(u1)) {
    if (isU1IdentityKey(k)) out[k] = u1[k];
    else if (k in src) out[k] = src[k];
    else out[k] = u1[k];
  }
  // Reindex every source per-filament array (length === srcCount) to the kept set.
  for (const k of Object.keys(src)) {
    const v = src[k];
    if (Array.isArray(v) && v.length === srcCount && !isU1IdentityKey(k)) {
      out[k] = keptOld.map((oldI) => v[oldI] ?? v[0]);
    }
  }
  const srcColours = (src.filament_colour as string[]) ?? [];
  const srcTypes = (src.filament_type as string[]) ?? [];
  const baseId = (Array.isArray(u1.filament_settings_id) ? (u1.filament_settings_id[0] as string) : "") || "Generic PLA";
  const srcSid = Array.isArray(src.filament_settings_id) ? (src.filament_settings_id as string[]) : [];
  out.filament_colour = keptOld.map((i, k) => normalizeHex(keptHex?.[k] || srcColours[i] || "#FFFFFF"));
  out.filament_type = keptOld.map((i) => srcTypes[i] ?? "PLA");
  out.filament_settings_id = keptOld.map((i) =>
    filamentPresetId(srcTypes[i] ?? "PLA", brand, srcSid[i] ?? baseId.replace(/^Generic\s+\S+/, `Generic ${srcTypes[i] ?? "PLA"}`)),
  );
  applyU1Safety(out, u1, diff);
  applyNozzleFit(out, src, u1, diff);
  if (hasVLH) applyVlhGuard(out, diff);
  return JSON.stringify(out);
}

// ---------- analysis (for the color picker UI) ----------

export type Encoding = "simple" | "object" | "painted" | "by-layer";
export type Analysis = {
  colors: string[];
  types: string[];
  painted: boolean;
  maxSlot: number;
  encoding: Encoding;
  usage: number[]; // per-color occurrence count from extruder metadata (0 if unknown)
  variableLayers: boolean; // file carries adaptive/variable layer height (layer_config_ranges/heights_profile)
  bandPlan?: BandPlan; // painted files only: vertical colour-banding analysis (manual filament-swap candidacy)
  fullSpectrumFile?: boolean; // a PrusaSlicer ColorMix file: first 4 palette entries are the physical bases
  flavour?: Flavour; // source slicer 3MF dialect (bambu/orca/prusa/generic) — drives retarget grouping
};

/** Count how often each slot index (1-based) is referenced by object extruder metadata. */
function tallyUsage(entries: Record<string, Uint8Array>, n: number): number[] {
  const usage = new Array<number>(n).fill(0);
  for (const [path, data] of Object.entries(entries)) {
    if (!path.toLowerCase().endsWith(".config")) continue;
    for (const m of strFromU8(data).matchAll(/key="extruder"\s+value="(\d+)"/g)) {
      const v = parseInt(m[1], 10);
      if (v >= 1 && v <= n) usage[v - 1] += 1;
    }
  }
  return usage;
}

export async function analyzeThreeMF(file: File): Promise<Analysis> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const entries = applyPrusaVolumePaint(safeUnzip(buf));
  let colors: string[] = [];
  let types: string[] = [];
  let painted = false;
  let maxSlot = 0;
  let variableLayers = false;
  for (const [path, data] of Object.entries(entries)) {
    const lower = path.toLowerCase();
    const base = lower.split("/").pop() ?? "";
    if (base === "layer_config_ranges.xml" || base === "layer_heights_profile.txt") variableLayers = true;
    if (base === "project_settings.config") {
      try {
        const o = JSON.parse(strFromU8(data)) as Record<string, unknown>;
        colors = (Array.isArray(o.filament_colour) ? o.filament_colour : []) as string[];
        types = (Array.isArray(o.filament_type) ? o.filament_type : []) as string[];
      } catch {
        /* ignore */
      }
    }
    // Painted via Bambu/Orca paint_color OR PrusaSlicer's slic3rpe:mmu_segmentation (same data).
    if (lower.endsWith(".model") && !painted && /paint_color|slic3rpe:mmu_segmentation/.test(strFromU8(data))) painted = true;
    if (lower.endsWith(".config")) {
      for (const m of strFromU8(data).matchAll(/key="extruder"\s+value="(\d+)"/g)) {
        const v = parseInt(m[1], 10);
        if (v > maxSlot) maxSlot = v;
      }
    }
  }
  // Prusa files carry no project_settings.config — take the palette from Slic3r_PE.config.
  if (!colors.length) {
    const pp = readPrusaPalette(entries);
    if (pp) {
      colors = pp.colours;
      types = pp.types;
    }
  }
  // PrusaSlicer "Full Spectrum" (ColorMix): the true palette is the 4 bases + N mixed colours from
  // Prusa_Slicer_full_spectrum.json — filament_colour only lists the 4 bases, so use the fuller one.
  const fsPal = paletteFromFullSpectrum(entries);
  const fullSpectrumFile = !!fsPal;
  if (fsPal && fsPal.length > colors.length) colors = fsPal;
  // A slicer's filament list is often padded past the slots the model actually uses (extra AMS spools,
  // sometimes a repeated colour), which inflates the colour count and can wrongly push a file past the
  // U1's 4 slots. For non-painted files the geometry references slots 1..maxSlot, so drop any trailing
  // palette entries beyond that. (Painted files count used colours from the mesh; FS palettes stay intact.)
  if (!painted && !fullSpectrumFile && maxSlot >= 1 && maxSlot < colors.length) {
    colors = colors.slice(0, maxSlot);
    types = types.slice(0, maxSlot);
  }
  let encoding: Encoding = "simple";
  if (colors.length > 4) encoding = painted ? "painted" : maxSlot > 4 ? "object" : "by-layer";

  // Painted, multicolour files: is it cleanly VERTICALLY colour-banded (every layer ~one colour)? If so
  // it's a candidate for exact printing via a few manual filament-swap pauses instead of Full Spectrum.
  // Skip the mesh parse for non-painted / single-colour files (nothing to band) — and it's guarded: a
  // too-big-to-sample mesh yields no positions, so detectColorBands simply reports not-banded.
  // Skip for big files: this runs on the MAIN thread, so a full mesh parse (e.g. a 150MB model) would
  // freeze the UI and make picking a file feel stuck. Consumers that need bands (the convert page) already
  // recompute them off-thread from the worker mesh, so this is a cheap extra only worth it for small files.
  let bandPlan: BandPlan | undefined;
  if (painted && colors.length > 1 && buf.length < 8_000_000) {
    try {
      const mesh = extractMeshFromBuffer(buf);
      if (mesh.positions.length > 0) bandPlan = detectColorBandsForMesh(mesh, mesh.baseState);
    } catch {
      /* band detection is best-effort — never block analysis on it */
    }
  }

  return {
    colors: colors.map(normalizeHex),
    types,
    painted,
    maxSlot,
    encoding,
    usage: tallyUsage(entries, colors.length),
    variableLayers,
    bandPlan,
    fullSpectrumFile,
    flavour: detectFlavour(entries),
  };
}

/** Coarse material family — used to flag prime/wipe-tower adhesion risk between mixed filaments. */
function materialFamily(t: string): string {
  const s = (t || "").toUpperCase();
  if (s.includes("TPU") || s.includes("TPE")) return "TPU";
  if (s.includes("PETG") || s.includes("PCTG")) return "PETG";
  if (s.includes("ASA")) return "ASA";
  if (s.includes("ABS")) return "ABS";
  if (s.includes("PLA")) return "PLA";
  if (s.includes("NYLON") || /\bPA\b|PAHT|PA6|PA12/.test(s)) return "NYLON";
  return s || "PLA";
}

// A message KEY plus its params, not a finished sentence. This module has no access to the request
// locale, so building English here made every converter advisory English in all 7 locales — the page
// around them was translated and these were not. The render site resolves `key` against the
// `convert` namespace.
export type ConvertWarning = {
  level: "warn" | "info";
  key: string;
  params?: Record<string, string | number>;
};

/**
 * The canonical ENGLISH rendering of a ConvertWarning.
 *
 * The website resolves warning keys through next-intl and never calls this. It exists for the
 * browser extension, which has no i18n runtime and is English-only — keeping the wording here means
 * the two surfaces can't drift, and the extension no longer has to regex-match on prose to identify
 * a warning (it matches on `key`).
 */
export function warningTextEn(w: ConvertWarning): string {
  const p = w.params ?? {};
  switch (w.key) {
    case "warnMixedFilaments":
      return `This file mixes ${p.families} filaments. On the U1's prime/wipe tower these can fail to bond to each other (e.g. PLA won't stick to PETG → "spaghetti"). In Orca, set the prime tower's filament to your main material instead of "Default".`;
    case "warnPaintedEdits":
      return `Colors are painted onto the mesh. After converting, don't use "Split to objects/parts" or the Cut tool in Orca — those drop painted colors.`;
    case "warnOverFourByLayer":
      return `${p.count} colors — more than the U1's 4 slots. Turn on the M600 spool-swap pauses below to keep all ${p.count}; leave them off and the least-used colors merge into their nearest match.`;
    case "warnOverFourMerge":
      return `${p.count} colors — more than the U1's 4 slots. Turn on Full Spectrum below to keep all ${p.count}, reproduced by mixing your 4 filaments; leave it off and the least-used colors merge into their nearest match.`;
    case "warnOverhangYes":
      return `Steep overhangs detected (~${p.percent}% of the surface). Supports are recommended — the converter keeps your source file's support setting, so if it didn't already have them, turn Supports on in Snapmaker Orca before slicing.`;
    case "warnOverhangNo":
      return `No significant overhangs detected — this model likely prints without supports. The converter keeps whatever support setting your source file had.`;
    case "warnTooBig":
      return `This model is ${p.x}×${p.y}×${p.z} mm — larger than the Snapmaker U1's ${p.maxXY}×${p.maxXY}×${p.maxZ} mm build volume. It may not fit; rotate or rescale in your slicer.`;
    default:
      return w.key;
  }
}

/** Warning keys meaning "you have more than 4 colours and some will be merged". */
export const OVER_FOUR_KEYS = ["warnOverFourByLayer", "warnOverFourMerge"];

/**
 * Pre-conversion advisories for the user (computed from the analysis, before they download):
 * prime/wipe-tower material-adhesion risk, painted-color edit fragility, and >4-colour handling.
 * Evidence-backed by the converter research (tower collapse is the #1 documented U1 failure;
 * paint is lost by Orca's split/cut).
 */
export function convertWarnings(a: Analysis, usedColors?: number): ConvertWarning[] {
  const out: ConvertWarning[] = [];
  // For painted files, prefer the count of colours actually used (the filament list can carry
  // extra, unpainted spools). By-layer/object-assigned counts come from the filament list.
  const colorCount = a.painted && typeof usedColors === "number" ? usedColors : a.colors.length;
  const fams = [...new Set(a.types.filter(Boolean).map(materialFamily))];
  if (fams.length > 1)
    out.push({ level: "warn", key: "warnMixedFilaments", params: { families: fams.join(" + ") } });
  if (a.painted) out.push({ level: "info", key: "warnPaintedEdits" });
  if (colorCount > 4)
    out.push({
      level: "info",
      // by-layer files can keep every colour via M600 pauses, so they get a different sentence.
      key: a.encoding === "by-layer" ? "warnOverFourByLayer" : "warnOverFourMerge",
      params: { count: colorCount },
    });
  return out;
}

/** What slicer/printer profile (if any) is baked into a .3mf — used to flag foreign uploads. */
export type ProfileInfo = {
  hasProfile: boolean; // carries a slicer profile (project/Slic3r config) at all
  brand: string | null; // "Bambu", "Prusa", "Snapmaker"… inferred from the printer
  printer: string | null; // raw printer name from the profile, e.g. "Bambu Lab X1 Carbon"
  isU1: boolean; // the embedded profile already targets the Snapmaker U1
  foreign: boolean; // has a profile, but it's for a non-U1 printer → suggest the converter
};

/** Map a printer/profile string to a known brand. null if unrecognized. */
function brandFromText(s: string): string | null {
  const t = s.toLowerCase();
  if (/snapmaker|\bu1\b/.test(t)) return "Snapmaker";
  if (/bambu|\bx1\b|\bp1[ps]?\b|\ba1\b|\bh2d\b/.test(t)) return "Bambu";
  // MK4S, MK4IS, MINIIS and COREONE — Prusa's CURRENT models — all failed the previous form,
  // because `\bmk[234]\b` needs a word boundary straight after the digit and "MK4S" has none.
  // Found by building a real PrusaSlicer .3mf and reading what came back, not by inspection.
  if (/prusa|slic3r|\bmk[234](\.\d)?(i?s)?\b|\bmini(\+|is)?\b|\bxl\b|core\s*one/.test(t)) return "Prusa";
  if (/creality|ender|\bk1\b|\bk2\b/.test(t)) return "Creality";
  if (/elegoo|neptune|centauri/.test(t)) return "Elegoo";
  if (/anycubic|kobra/.test(t)) return "Anycubic";
  if (/qidi/.test(t)) return "Qidi";
  if (/voron/.test(t)) return "Voron";
  return null;
}

/**
 * Inspect a .3mf for a baked-in slicer profile and decide whether it targets the U1.
 * Cheap (just unzips + reads the config text); safe to run on file-select. Non-3mf
 * or unreadable files return an empty (no-profile) result.
 */
export async function detectProfile(file: File): Promise<ProfileInfo> {
  const empty: ProfileInfo = {
    hasProfile: false,
    brand: null,
    printer: null,
    isU1: false,
    foreign: false,
  };
  if (!file.name.toLowerCase().endsWith(".3mf")) return empty;

  try {
    const entries = safeUnzip(new Uint8Array(await file.arrayBuffer()));
    let printer: string | null = null;
    let brandHint: string | null = null;
    let hasProfile = false;

    for (const [path, data] of Object.entries(entries)) {
      const base = (path.split("/").pop() ?? "").toLowerCase();
      // PrusaSlicer config is an INI file — its presence alone signals a Prusa profile.
      if (base === "slic3r_pe.config") {
        hasProfile = true;
        const ini = strFromU8(data);
        if (!printer) {
          const m = ini.match(/printer_model\s*=\s*(.+)/i);
          if (m) printer = m[1].trim();
        }
        // printer_model is a bare code ("MK4S", "COREONE"); printer_settings_id spells the vendor out
        // ("Original Prusa MK4S 0.4 nozzle"). Keeping it means the brand survives even for a model
        // this code has never heard of, which is the whole point of not being tied to one printer.
        if (!brandHint) {
          const sid = ini.match(/printer_settings_id\s*=\s*(.+)/i);
          if (sid) brandHint = sid[1].trim();
        }
      }
      // Bambu/Orca/Snapmaker-Orca all use project_settings.config (JSON).
      if (base === "project_settings.config") {
        hasProfile = true;
        try {
          const o = JSON.parse(strFromU8(data)) as Record<string, unknown>;
          printer =
            (o.printer_model as string) ||
            (o.printer_settings_id as string) ||
            (Array.isArray(o.print_compatible_printers)
              ? (o.print_compatible_printers[0] as string)
              : null) ||
            printer;
        } catch {
          /* ignore malformed config */
        }
      }
    }

    if (!hasProfile) return empty;
    // Model first — it is the more specific string — then the vendor-spelling fallback.
    const brand = (printer ? brandFromText(printer) : null) ?? (brandHint ? brandFromText(brandHint) : null);
    const isU1 = brand === "Snapmaker" || /\bu1\b/i.test(printer ?? "");
    return { hasProfile, brand, printer, isU1, foreign: !isU1 };
  } catch {
    return empty;
  }
}

// "u1" (default, full profile stamp/preserve), "current" (strip profile for your slicer), "generic"
// (strip vendor lock → core-spec 3MF), or a specific target-printer id from the registry (retarget).
export type CleanTarget =
  | "u1"
  | "current"
  | "generic"
  | "bambu-x1c"
  | "bambu-p1s"
  | "bambu-a1"
  | "prusa-mk4-mmu3"
  | "creality-k2";

/** Manual override from the color picker: the 4 final slot colors + old->slot(0..3) assignment.
 *  `mode` (u1 target only): "preserve" keeps the creator's print settings and swaps only printer
 *  identity (default); "stamp" replaces everything with the bundled tested U1 profile. */
export type CleanOpts = {
  slots?: string[];
  assign?: number[];
  mode?: "preserve" | "stamp";
  // For by-layer files with >4 colours: keep ALL colours via M600 spool-swap pauses (experimental)
  // instead of merging down to 4. Ignored unless the file has a per-layer colour sequence.
  swapPauses?: boolean;
  // Painted files with >4 colours: keep the 4 most-used as physical filaments and render the rest as
  // Snapmaker "Full Spectrum" mixes of those 4 (experimental). Applies to painted OR object-encoded
  // (per-part `key="extruder"`) files with >4 colours; ignored otherwise.
  fullSpectrum?: boolean;
  // Painted files that are cleanly VERTICALLY colour-banded: print every colour EXACTLY by mapping colours
  // to the 4 heads and inserting M600 filament-swap pauses for any beyond 4 (experimental). Ignored unless
  // painted AND detectColorBands reports the model is banded.
  bandSwap?: boolean;
  // Full Spectrum: source filament indices (0-based) to use as the 4 physical heads. Defaults to the
  // 4 most-used colours. Lets the UI let the user pick which colours load physically.
  physical?: number[];
  // Full Spectrum (CUSTOM palette): 4 hex colours of the user's OWN loaded filaments (e.g. CMYK), NOT
  // from the model. When set (with fullSpectrum), EVERY painted colour is reproduced as a mix of these
  // 4 — works at any colour count (incl. ≤4). Stamps the U1 profile with these 4 as filament_colour.
  customPhysical?: string[];
  // Full Spectrum: manual mix overrides, keyed by source colour index (0-based). a/b are 1-based into
  // the 4 physical; a === b means "use that pure physical". Anything not overridden uses bestMix.
  mixes?: Record<number, { a: number; b: number; mixBPercent: number }>;
  // Full Spectrum: "Subdivide Mix Layer" (dithering_local_z_mode). Default ON — the U1 splits each layer
  // into thinner sub-layers inside mixed areas for smoother blends (esp. on top surfaces), at the cost
  // of more toolchanges/time/purge. Set false to turn it off (fewer swaps, faster; coarser mixes).
  subdivide?: boolean;
  // Full Spectrum: dither layer height (mm) for the mixed/virtual colours. 0 or undefined = "Auto"
  // (Orca picks within 0.04–0.16mm — the verified default). A positive value forces every mixed-colour
  // dither band to that height: smaller = smoother blend but slower; larger = faster but more banding.
  mixedLayerHeight?: number;
  // Full Spectrum: the hex actually loaded on each of the 4 physical heads, aligned to `physical`.
  // Overrides the model's colour for that main so you can map to filaments you have but the model doesn't.
  physicalHex?: string[];
  // Variable layer height: by default, when a file has adaptive layers we disable the prime tower and
  // downgrade tree→normal supports, because Snapmaker Orca errors on VLH + prime tower / tree supports.
  // Set true to SKIP that guard and keep the creator's prime tower + supports (advanced: only if your
  // Orca build slices VLH + a prime tower, or you'll fix supports yourself). The VLH profile itself is
  // preserved either way.
  keepPrimeTowerVlh?: boolean;
  // Target printer to convert for. Defaults to the Snapmaker U1 (the only validated machine today).
  machine?: Machine;
  // >4 colours: write EVERY filament through untouched instead of merging to 4 / mixing / swap-pausing,
  // and let Snapmaker Orca ask which head each one loads on. Takes precedence over the other >4 modes
  // when set. Ignored for ≤4-colour files and for non-U1 targets.
  keepAllColours?: boolean;
  // Which NAME the output's filament presets carry. Changes no print setting — it decides which library
  // preset Orca resolves each slot to, and some model repositories require Generic or vendor presets
  // rather than another printer's brand. Defaults to keeping the author's.
  filamentBrand?: FilamentBrand;
};

export type CleanResult = {
  blob: Blob;
  removed: string[];
  kept: number;
  colorsKept: number;
  colorsTotal: number;
  over4: boolean;
  reduced: boolean;
  painted: boolean;
  manual: boolean;
  preserved: boolean; // true = kept the creator's settings (identity-swap); false = stamped U1 profile
  swaps: SwapInstruction[]; // M600 spool-swap plan, when swap-pauses were inserted (else empty)
  diff: DiffReport | null; // what the conversion changed (U1 target only; null for import/STL)
};

// ---------- source flavour detection + retarget (non-U1 target printers) ----------

/** Which slicer 3MF dialect a source file is in — mirrors the app's detectFlavour. */
function detectFlavour(entries: Record<string, Uint8Array>): Flavour {
  const names = Object.keys(entries);
  if (names.some((p) => /project_settings\.config$/i.test(p))) {
    // Bambu vs Orca share the config family; slice_info's header hints at Orca.
    const si = Object.entries(entries).find(([p]) => /slice_info\.config$/i.test(p));
    return si && /orca/i.test(strFromU8(si[1])) ? "orca" : "bambu";
  }
  if (names.some((p) => /slic3r_pe\.config$/i.test(p))) return "prusa";
  return "generic";
}

/** Rectangle printable_area polygon derived from a bed size (fallback when the target carries no exact one). */
function bedRect(bed: { x: number; y: number }): string[] {
  return ["0x0", `${bed.x}x0`, `${bed.x}x${bed.y}`, `0x${bed.y}`];
}

/** "Generic / strip vendor lock" export: keep geometry + rels + content-types + thumbnails, drop every
 *  vendor slicer config. Colours/painting live in the .model, so they survive. Shared by the "generic"
 *  target and by a cross-family retarget (where rewriting metadata can't produce a coherent file). */
function stripToGeneric(entries: Record<string, Uint8Array>): CleanResult {
  const out: Record<string, Uint8Array> = {};
  const removed: string[] = [];
  for (const [path, data] of Object.entries(entries)) {
    if (isGenericKeep(path)) out[path] = data;
    else removed.push(path);
  }
  const zipped = zipSync(out, { level: 6 });
  return {
    blob: new Blob([zipped.buffer as ArrayBuffer], { type: "model/3mf" }),
    removed,
    kept: Object.keys(out).length,
    colorsKept: 0,
    colorsTotal: 0,
    over4: false,
    reduced: false,
    painted: false,
    manual: false,
    preserved: false,
    swaps: [],
    diff: null,
  };
}

/**
 * Retarget a 3MF to a specific non-U1 printer. Decision (ported from the app's convert()):
 *   • SAME config family (source flavour and target flavour both map to the same family via
 *     configFamily) → REPROFILE: rewrite the vendor config's printer_model / printer_settings_id /
 *     printable_area / printable_height / nozzle to the target, and remap colours to the target's slot
 *     count when the source has more colours (or the UI supplied a slot assignment).
 *   • DIFFERENT families (e.g. Bambu → Prusa) → fall back to a clean Generic 3MF (the same output the
 *     "generic" target produces) so cross-ecosystem still yields an openable file with colours intact.
 * The U1's Full Spectrum / M600 / band-swap features are NOT applied here — those are U1 hardware-only.
 */
function retargetThreeMF(entries: Record<string, Uint8Array>, machine: Machine, opts?: CleanOpts): CleanResult {
  const srcFlavour = detectFlavour(entries);
  const srcFamily = configFamily(srcFlavour);
  const tgtFamily = configFamily(machine.flavour);
  const reprofile = srcFamily !== "generic" && srcFamily === tgtFamily;
  // Cross-family (or an unrecognised source) → clean Generic 3MF; there's no coherent metadata rewrite.
  if (!reprofile) return stripToGeneric(entries);

  // Read the source palette (Bambu/Orca JSON project settings, else a Prusa Slic3r_PE.config).
  let srcColours: string[] = [];
  let srcTypes: string[] = [];
  for (const [path, data] of Object.entries(entries)) {
    if ((path.split("/").pop() ?? "").toLowerCase() === "project_settings.config") {
      try {
        const o = JSON.parse(strFromU8(data)) as Record<string, unknown>;
        srcColours = (Array.isArray(o.filament_colour) ? o.filament_colour : []) as string[];
        srcTypes = (Array.isArray(o.filament_type) ? o.filament_type : []) as string[];
      } catch {
        /* ignore malformed config */
      }
    }
  }
  if (!srcColours.length) {
    const pp = readPrusaPalette(entries);
    if (pp) {
      srcColours = pp.colours;
      srcTypes = pp.types;
    }
  }
  const colorsTotal = srcColours.length;
  const slots = Math.max(1, machine.toolheads);

  // Colour → slot map. Manual assignment from the UI wins; otherwise reduce only when the source has more
  // colours than the target's slots. ≤slots with no manual reorder ⇒ colours preserved exactly (map null).
  let map: number[] | null = null;
  let useColours = srcColours;
  let useTypes = srcTypes;
  const manual = Boolean(opts?.slots && opts.slots.length > 0 && opts.assign);
  if (manual) {
    map = opts!.assign!;
    useColours = opts!.slots!.slice(0, slots).map(normalizeHex);
    useTypes = useColours.map((_, s) => {
      const oi = map!.findIndex((a) => a === s);
      return oi >= 0 ? srcTypes[oi] ?? "PLA" : "PLA";
    });
  } else if (colorsTotal > slots) {
    const r = reduceColors(srcColours, tallyUsage(entries, colorsTotal));
    // reduceColors targets 4 groups; clamp any group index into the target slot range for safety.
    map = r.map.map((g) => Math.min(g, slots - 1));
    useColours = r.colors.slice(0, slots).map(normalizeHex);
    useTypes = useColours.map((_, s) => {
      const oi = map!.findIndex((a) => a === s);
      return oi >= 0 ? srcTypes[oi] ?? "PLA" : "PLA";
    });
  }
  const reduced = !!map && (colorsTotal > slots || !map.every((a, i) => a === i));

  const settingsId = machine.printerSettingsId || machine.printerModel || machine.name;
  const nozzleStr = String(machine.nozzle ?? 0.4);
  const printableArea = machine.printableArea ?? bedRect(machine.bed);
  const printableHeight = machine.printableHeight ?? String(machine.bed.z);

  // Paint-code remap (painted files, only when reducing/reordering): source state → target slot (1-based).
  const stateMap = reduced && map ? (s: number) => (s === 0 ? 0 : s >= 1 && s <= colorsTotal ? map![s - 1] + 1 : s) : null;

  const out: Record<string, Uint8Array> = {};
  const removed: string[] = [];
  for (const [path, data] of Object.entries(entries)) {
    const lower = path.toLowerCase();
    const base = lower.split("/").pop() ?? "";

    if (base === "project_settings.config") {
      // Bambu/Orca JSON: rewrite printer identity + (optionally) the reduced palette.
      let o: Record<string, unknown>;
      try {
        o = JSON.parse(strFromU8(data)) as Record<string, unknown>;
      } catch {
        out[path] = data;
        continue;
      }
      if (machine.printerModel) o.printer_model = machine.printerModel;
      o.printer_settings_id = settingsId;
      o.nozzle_diameter = Array.isArray(o.nozzle_diameter) ? (o.nozzle_diameter as unknown[]).map(() => nozzleStr) : nozzleStr;
      o.printable_area = printableArea.slice();
      o.printable_height = printableHeight;
      if (reduced && map) {
        // Reindex every source per-filament array (length === colorsTotal) into the reduced slot set,
        // then lock the reduced colours/types.
        for (const k of Object.keys(o)) {
          const v = o[k];
          if (Array.isArray(v) && v.length === colorsTotal) {
            const slotArr: unknown[] = new Array(slots);
            for (let s = 0; s < slots; s++) {
              const oi = map.findIndex((a) => a === s);
              slotArr[s] = oi >= 0 ? v[oi] : v[0];
            }
            o[k] = slotArr;
          }
        }
        o.filament_colour = useColours.slice();
        o.filament_type = useTypes.slice();
      }
      out[path] = strToU8(JSON.stringify(o));
      continue;
    }

    // PrusaSlicer text config: rewrite printer identity + bed (same-family Prusa → Prusa retarget).
    if (base === "slic3r_pe.config") {
      let text = strFromU8(data);
      if (machine.printerModel) text = text.replace(/^(;?\s*printer_model\s*=).*$/im, `$1 ${machine.printerModel}`);
      text = text.replace(/^(;?\s*nozzle_diameter\s*=).*$/im, `$1 ${nozzleStr}`);
      const { x, y, z } = machine.bed;
      text = text.replace(/^(;?\s*bed_shape\s*=).*$/im, `$1 0x0,${x}x0,${x}x${y},0x${y}`);
      text = text.replace(/^(;?\s*max_print_height\s*=).*$/im, `$1 ${z}`);
      out[path] = strToU8(text);
      continue;
    }

    // Drop sliced/cache junk (gcode, plate artifacts, slice_info) — regenerated on re-slice.
    if (isStrippable(path)) {
      removed.push(path);
      continue;
    }

    if (lower.endsWith(".model")) {
      const raw = strFromU8(data);
      if (stateMap && raw.includes("paint_color")) {
        out[path] = strToU8(raw.replace(/paint_color="([0-9A-Fa-f]+)"/g, (_m, c) => `paint_color="${remapPaintCode(c, stateMap)}"`));
      } else {
        out[path] = data; // byte-identical — don't re-encode geometry
      }
      continue;
    }

    if (reduced && map && lower.endsWith(".config")) {
      // model_settings.config (XML) part→extruder refs → the reduced slots.
      out[path] = strToU8(remapExtruders(strFromU8(data), map));
      continue;
    }

    out[path] = data;
  }

  const zipped = zipSync(out, { level: 6 });
  return {
    blob: new Blob([zipped.buffer as ArrayBuffer], { type: "model/3mf" }),
    removed,
    kept: Object.keys(out).length,
    colorsKept: Math.min(useColours.length || colorsTotal, slots),
    colorsTotal,
    over4: colorsTotal > 4,
    reduced,
    painted: !!stateMap,
    manual,
    preserved: false,
    swaps: [],
    diff: null,
  };
}

export async function cleanThreeMF(file: File, target: CleanTarget, opts?: CleanOpts): Promise<CleanResult> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const entries = applyPrusaVolumePaint(safeUnzip(buf)); // Prusa multi-volume → paint, then process

  // Generic "strip vendor lock": produce a clean core-spec 3MF — keep geometry (.model + rels),
  // [Content_Types].xml and thumbnails/images; drop every vendor slicer config (Metadata/*.config,
  // slice_info, .gcode, .ini…). Colours/painting live in the .model, so they're preserved; only the
  // vendor *config* is removed. No U1 profile is stamped or preserved. Mirrors the app's normalize mode.
  if (target === "generic") return stripToGeneric(entries);

  // RETARGET: a specific non-U1 target printer from the registry. Same slicer family → rewrite the vendor
  // config for that printer; cross family → clean Generic 3MF. The U1 branch below is untouched (the U1
  // stays the default and only it gets Full Spectrum / M600 / band-swap — U1 hardware features).
  const targetMachine = target !== "u1" && target !== "current" ? MACHINES[target] : undefined;
  if (targetMachine && targetMachine.id !== "u1") return retargetThreeMF(entries, targetMachine, opts);

  // PrusaSlicer stores paint under slic3rpe:* attrs (byte-identical values, just a different name).
  // Rename to Orca's paint_* up front so the entire painted pipeline below — detection, usage tally,
  // >4 reduction, codec remap — treats a Prusa file exactly like a Bambu/Orca one.
  // Any PrusaSlicer file (has a Slic3r_PE config) needs its .model cleaned — rename paint attrs and
  // strip the slic3rpe namespace — so Orca doesn't treat it as a foreign 3mf.
  const isPrusa = target === "u1" && Object.keys(entries).some((p) => /slic3r_pe(_model)?\.config$/i.test(p));
  const prusaPaint = target === "u1" && hasPrusaPaint(entries);
  if (isPrusa) {
    for (const [path, data] of Object.entries(entries)) {
      if (!path.toLowerCase().endsWith(".model")) continue;
      const t = strFromU8(data);
      if (/slic3rpe[:=]/.test(t)) entries[path] = strToU8(renamePrusaPaint(t));
    }
  }

  let srcColours: string[] = [];
  let srcTypes: string[] = [];
  let srcCfg: Record<string, unknown> | null = null;
  let painted = false;
  let maxSlot = 0;
  let hasGeometry = false; // a .model with real mesh data
  let hasPlateGcode = false; // an already-sliced plate_N.gcode
  let hasVLH = false; // variable layer height (breaks prime tower + tree supports in Orca)
  const gcodeLayerExt = new Set<number>(); // distinct extruders used in the by-layer colour sequence
  for (const [path, data] of Object.entries(entries)) {
    const lower = path.toLowerCase();
    const base = lower.split("/").pop() ?? "";
    if (/plate_\d+\.gcode$/.test(lower)) hasPlateGcode = true;
    if (base === "layer_config_ranges.xml" || base === "layer_heights_profile.txt") hasVLH = true;
    if (base === "project_settings.config") {
      try {
        const o = JSON.parse(strFromU8(data)) as Record<string, unknown>;
        srcCfg = o;
        srcColours = (Array.isArray(o.filament_colour) ? o.filament_colour : []) as string[];
        srcTypes = (Array.isArray(o.filament_type) ? o.filament_type : []) as string[];
      } catch {
        /* ignore */
      }
    }
    if (lower.endsWith(".model")) {
      const text = strFromU8(data);
      if (!painted && text.includes("paint_color")) painted = true;
      if (!hasGeometry && text.includes("<vertex")) hasGeometry = true;
    }
    if (lower.endsWith(".config")) {
      for (const m of strFromU8(data).matchAll(/key="extruder"\s+value="(\d+)"/g)) {
        const v = parseInt(m[1], 10);
        if (v > maxSlot) maxSlot = v;
      }
    }
    // By-layer colour sequence (height-based colour changes) lives here — the swap-pause target.
    if (base === "custom_gcode_per_layer.xml") {
      for (const m of strFromU8(data).matchAll(/type="2"[^>]*extruder="(\d+)"|extruder="(\d+)"[^>]*type="2"/g)) {
        gcodeLayerExt.add(parseInt(m[1] ?? m[2], 10));
      }
    }
  }

  // An already-sliced export (plate G-code, no editable mesh) can't be re-targeted — converting it
  // would silently emit a near-empty model. Reject with a clear message instead.
  if (!hasGeometry && hasPlateGcode) {
    throw new Error(
      "This looks like an already-sliced G-code file, not an editable 3D model. Open the original model file (the one you slice from) and convert that instead.",
    );
  }

  // Prusa files have no project_settings.config → no palette from the scan. Pull it from Slic3r_PE.config
  // so >4 painted colours can be reduced (and the kept colours match the creator's, not U1 defaults).
  if (!srcColours.length) {
    const pp = readPrusaPalette(entries);
    if (pp) {
      srcColours = pp.colours;
      srcTypes = pp.types;
    }
  }

  // PrusaSlicer "Full Spectrum" (ColorMix): filament_colour lists only the 4 bases, but the model is
  // painted with those 4 PLUS the mixed (virtual) colours. Use the full palette (from full_spectrum.json)
  // as srcColours so the >4 path runs and every painted state maps to a real colour (else the mixed states
  // reference non-existent slots and the colours come out wrong).
  const fsPalette = paletteFromFullSpectrum(entries);
  if (fsPalette && fsPalette.length > srcColours.length) {
    srcColours = fsPalette;
    srcTypes = fsPalette.map((_, i) => srcTypes[i] ?? srcTypes[0] ?? "PLA");
  }
  const fsRecipes = fsPalette ? recipesFromFullSpectrum(entries) : null; // author's exact mix recipes

  const colorsTotal = srcColours.length;
  if (colorsTotal > MAX_COLORS) throw new Error(`This .3mf declares ${colorsTotal} filament colours — too many to process (looks malformed).`);
  const over4 = colorsTotal > 4;
  const objectAssigned = !painted && maxSlot > 4;
  // A by-layer (height) multicolour file with >4 colours can keep them all via M600 spool swaps.
  const byLayerOver4 = gcodeLayerExt.size > 4;
  const useSwap = Boolean(opts?.swapPauses) && target === "u1" && byLayerOver4;

  let reduced = false;
  let map: number[] | null = null;
  let useColours = srcColours;
  let useTypes = srcTypes;
  let stateMap: ((s: number) => number) | null = null; // painted-file paint-code remap
  let swapRemap: Map<number, number> | null = null; // by-layer >4: source slot(1-based) -> head(0-based)
  let swaps: SwapInstruction[] = [];
  const mixDefs: MixedDef[] = []; // Full Spectrum: virtual mixed-filament definitions for >4 colours
  let fsKeptOld: number[] | null = null; // Full Spectrum: new filament index → source index
  let customFS = false; // custom-palette Full Spectrum → stamp the U1 profile with the user's 4 colours
  let keptAll = false; // pass-through: every source filament written out, nothing merged or mixed
  let bandSwapXml: string | null = null; // painted band-swap: the synthesized custom_gcode_per_layer.xml (M600 pauses)
  const manual = Boolean(opts?.slots && opts.slots.length > 0);

  // Painted band-swap candidacy: is this painted file cleanly vertically colour-banded? Detect up front so
  // the branch chain can pick this exact-colour path over Full Spectrum's approximation.
  let bandDetect: { bands: ColorBand[]; baseState: number } | null = null;
  // Guard the direct (uncapped) unzip in extractMeshFromBuffer against a very large input (defense in
  // depth — the input already passed safeUnzip's caps upstream in cleanThreeMF).
  if (target === "u1" && painted && opts?.bandSwap && buf.length < 200_000_000) {
    try {
      const mesh = extractMeshFromBuffer(buf);
      if (mesh.positions.length > 0) {
        const bp = detectColorBandsForMesh(mesh, mesh.baseState);
        if (bp.banded && bp.bands.length > 1) bandDetect = { bands: bp.bands, baseState: mesh.baseState };
      }
    } catch {
      /* best-effort — fall through to the normal path if the mesh can't be read */
    }
  }

  // KEEP ALL COLOURS (pass-through). Every other >4 path decides something for the user: merge the
  // least-used, approximate them as mixes, or insert swap pauses. This one decides nothing — the
  // filament list arrives in the output exactly as the author wrote it, and Snapmaker Orca asks the
  // user which head each one loads on. Snapmaker's own converter offers the same choice, and Orca
  // fixed its filament→nozzle mapping for over-count files in 2.3.3–2.3.4.
  //
  // It is genuinely LESS capable than merging or Full Spectrum, not more; it is here because it is
  // sometimes what the user wants, and because "we merge to 4" was the only thing we could say.
  // Deliberately first in the chain: if the user explicitly asked to keep everything, no other mode
  // gets to overrule that.
  if (target === "u1" && opts?.keepAllColours && over4 && srcCfg) {
    // An identity kept-set through the variable-length builder = every source filament, in order, with
    // U1 hardware identity swapped in. Paint codes and per-object extruder refs stay valid untouched
    // precisely because nothing is renumbered.
    fsKeptOld = [...Array(colorsTotal).keys()];
    keptAll = true;
  } else if (target === "u1" && bandDetect) {
    // BAND-SWAP: the model is vertically banded, so map each colour to a physical head and insert an M600
    // pause for every colour beyond the 4 heads — keeping ALL colours exactly (no Full Spectrum mixing).
    const lh = srcCfg && srcCfg.layer_height != null ? parseFloat(String(srcCfg.layer_height)) : NaN;
    const { instructions, headOf, customGcodeXml } = buildBandSwapPlan(
      bandDetect.bands, srcColours, "M600", Number.isFinite(lh) ? lh : undefined, bandDetect.baseState,
    );
    const baseHead = (headOf.get(bandDetect.baseState) ?? 0) + 1; // unpainted faces (state 0) print here
    stateMap = (s) => (s === 0 ? baseHead : (headOf.get(s) ?? 0) + 1); // flatten each colour onto its head
    map = srcColours.map((_, i) => headOf.get(i + 1) ?? 0); // config extruder refs → head (0-based)
    // Each head's declared colour = the first band colour assigned to it (the spool you load first).
    const firstOnHead = (h: number) => { for (const [st, hd] of headOf) if (hd === h) return st; return 1; };
    useColours = [0, 1, 2, 3].map((h) => normalizeHex(srcColours[firstOnHead(h) - 1] ?? "#FFFFFF"));
    useTypes = [0, 1, 2, 3].map((h) => srcTypes[firstOnHead(h) - 1] ?? srcTypes[0] ?? "PLA");
    swaps = instructions;
    bandSwapXml = customGcodeXml;
    reduced = true;
  } else if (target === "u1" && (painted || objectAssigned) && colorsTotal > 0 && opts?.fullSpectrum && opts?.customPhysical?.length === 4) {
    // CUSTOM-PALETTE Full Spectrum: reproduce EVERY painted colour as a mix of the user's own 4 base
    // filaments (e.g. CMYK) — works at ANY colour count. The 4 physicals are the custom hexes (not model
    // colours), so we stamp the U1 profile with them and map every source colour to a pure/virtual mix.
    const physHex = opts.customPhysical.map(normalizeHex);
    const newOf = new Map<number, number>(); // source index → output 1-based filament index
    let mixIdx = 0;
    for (let oldI = 0; oldI < colorsTotal; oldI++) {
      const ov = opts.mixes?.[oldI];
      if (ov && ov.a >= 1 && ov.a <= 4 && ov.b >= 1 && ov.b <= 4) {
        // manual 2-component override
        if (ov.a === ov.b) newOf.set(oldI, ov.a);
        else { newOf.set(oldI, 5 + mixIdx); mixDefs.push({ componentA: ov.a, componentB: ov.b, mixBPercent: ov.mixBPercent, stableId: ++mixIdx }); }
        continue;
      }
      const mm = bestMixMulti(normalizeHex(srcColours[oldI]), physHex);
      if (mm.ids.length === 1) { newOf.set(oldI, mm.ids[0]); continue; } // pure physical
      if (mm.ids.length === 2) {
        const [a, b] = mm.ids, pctB = mm.weights[1];
        if (pctB >= 92) { newOf.set(oldI, b); continue; } // near-pure → merge
        if (pctB <= 8) { newOf.set(oldI, a); continue; }
        newOf.set(oldI, 5 + mixIdx);
        mixDefs.push({ componentA: a, componentB: b, mixBPercent: pctB, stableId: ++mixIdx });
        continue;
      }
      // 3-component (gradient) mix — g<ids>/w<weights>, distribution mode 0 (verified vs a real Orca save).
      newOf.set(oldI, 5 + mixIdx);
      mixDefs.push({
        componentA: mm.ids[0], componentB: mm.ids[1], mixBPercent: 50,
        gradientIds: mm.ids.join(""), gradientWeights: mm.weights.join("/"), distributionMode: 0,
        stableId: ++mixIdx,
      });
    }
    stateMap = (s) => (s === 0 ? 0 : newOf.get(s - 1) ?? 1);
    map = srcColours.map((_, i) => (newOf.get(i) ?? 1) - 1);
    useColours = physHex;
    useTypes = physHex.map(() => "PLA");
    customFS = true;
    reduced = true;
  } else if (target === "u1" && useSwap) {
    // Keep ALL colours: round-robin source slots onto the 4 heads; pauses (below) handle the rest.
    map = srcColours.map((_, i) => i % 4);
    swapRemap = new Map(srcColours.map((_, i) => [i + 1, i % 4]));
    useColours = [0, 1, 2, 3].map((h) => normalizeHex(srcColours[h] ?? "#FFFFFF"));
    useTypes = [0, 1, 2, 3].map((h) => srcTypes[h] ?? srcTypes[0] ?? "PLA");
    reduced = true;
  } else if (target === "u1" && (painted || objectAssigned) && colorsTotal > 0 && opts?.fullSpectrum && over4) {
    // Works for painted files AND object-encoded ones (per-part `key="extruder"`): the `map` below
    // remaps those extruder refs onto the physical heads / virtual mixes, so a 5-colour object model
    // keeps its extra colour as a mixed_filament_definition instead of silently dropping to 4.
    // NB: no srcCfg requirement — Prusa files carry no project_settings.config but still have a
    // palette (from Slic3r_PE.config) and painted geometry, so Full Spectrum must work for them too.
    // The output config falls back to withMixes(buildU1Config(...)) when srcCfg is null.
    // Full Spectrum (smart): keep 4 colours as physical heads; render the rest as mixes of those 4.
    // WHICH 4 to keep matters: a mix only *approximates* a colour, so virtualising the wrong one looks
    // bad. We can't reproduce an un-mixable colour (white, a pure primary) from the others, but we can
    // fake a mixable one (grey ≈ white+black). So instead of keeping the 4 most-*used* colours (which
    // would drop a small-but-un-mixable colour like white eyes and keep grey → white eyes printed grey),
    // greedily drop the colour the survivors can mix MOST faithfully — lowest best-mix ΔE wins, usage
    // only breaks ties (drop the less-painted of two equally-mixable colours). ΔE dominates on purpose:
    // a colour a mix can't fake (high ΔE) must stay physical even if it's tiny — area doesn't make a
    // wrong colour acceptable. Physical set still overridable via opts.physical (UI pick).
    const pu = tallyPaintUsage(entries, colorsTotal);
    const order = [...Array(colorsTotal).keys()].sort((a, b) => (pu[b] ?? 0) - (pu[a] ?? 0));
    const physOld =
      // Full Spectrum file (Prusa ColorMix): the first 4 palette entries ARE the physical bases and the
      // rest are already mixes of them — you can't load a "mix" on a head. Force the 4 bases as physical;
      // otherwise the picker may choose a virtual mix colour as a filament and Orca renders one colour.
      fsPalette
        ? [0, 1, 2, 3]
        : opts!.physical && opts!.physical.length === 4
          ? opts!.physical.slice(0, 4)
          : bestPhysicalSet(srcColours.slice(0, colorsTotal), pu);
    // The filament actually LOADED on each head. Defaults to the model's colour for that main, but the
    // UI can override any slot's hex (opts.physicalHex, aligned to opts.physical) so you can map to the
    // 4 filaments you really have — even ones not in the model. Mixes are then computed from these.
    // A ColorMix file's 4 bases are authoritative — ignore any physicalHex override from the page (which is
    // derived from the UI's picked colours and would otherwise stamp the wrong bases, e.g. a mix as a head).
    const physHex = physOld.map((i, k) => normalizeHex((fsPalette ? undefined : opts!.physicalHex?.[k]) || srcColours[i]));
    // filament_colour stays the 4 PHYSICAL only; mixes are virtual filaments (5+) that exist purely as
    // mixed_filament_definitions — no main-colour entry (matches how Orca stores a Full Spectrum file).
    const newOf = new Map<number, number>(); // source index → output 1-based filament index
    physOld.forEach((oldI, k) => newOf.set(oldI, k + 1));
    let mixIdx = 0;
    for (const oldI of order) {
      if (newOf.has(oldI)) continue; // physical
      const ov = opts!.mixes?.[oldI]; // manual override (a/b 1-based into the 4 physical) — always 2-way
      if (ov && ov.a >= 1 && ov.a <= 4 && ov.b >= 1 && ov.b <= 4) {
        if (ov.a === ov.b) newOf.set(oldI, ov.a); // pure physical
        else { newOf.set(oldI, 5 + mixIdx); mixDefs.push({ componentA: ov.a, componentB: ov.b, mixBPercent: ov.mixBPercent, stableId: ++mixIdx }); }
        continue;
      }
      // Full Spectrum file: reproduce the AUTHOR'S exact recipe (base extruders + ratios from
      // full_spectrum.json) rather than re-approximating it — otherwise a near-white mix can drift to a
      // cyan-heavy blend (white eyes → blue). Component extruders are 1-based into the 4 bases = the same
      // physical positions here (physOld is [0,1,2,3]).
      const rec = fsRecipes?.get(oldI + 1)?.filter((c) => c.extruder >= 1 && c.extruder <= 4);
      if (rec && rec.length) {
        if (rec.length === 1 || rec[0].extruder === rec[1]?.extruder) { newOf.set(oldI, rec[0].extruder); continue; }
        if (rec.length === 2) {
          newOf.set(oldI, 5 + mixIdx);
          mixDefs.push({ componentA: rec[0].extruder, componentB: rec[1].extruder, mixBPercent: Math.round(rec[1].ratio * 100), stableId: ++mixIdx });
          continue;
        }
        const g = rec.slice(0, 3);
        newOf.set(oldI, 5 + mixIdx);
        mixDefs.push({
          componentA: g[0].extruder, componentB: g[1].extruder, mixBPercent: 50,
          gradientIds: g.map((c) => c.extruder).join(""), gradientWeights: g.map((c) => Math.round(c.ratio * 100)).join("/"), distributionMode: 0,
          stableId: ++mixIdx,
        });
        continue;
      }
      // Converter-chosen: search pure/2-way/3-way (bestMixMulti) so a colour no pair can reach can still be
      // matched by a 3-filament gradient — same logic as custom-palette FS. Collapse near-pure (≥92% one
      // side) 2-way matches into that physical (a 95%-of-one "mix" is a redundant near-duplicate filament).
      const mm = bestMixMulti(normalizeHex(srcColours[oldI]), physHex);
      if (mm.ids.length === 1) { newOf.set(oldI, mm.ids[0]); continue; } // pure physical
      if (mm.ids.length === 2) {
        const [a, b] = mm.ids, pctB = mm.weights[1];
        if (pctB >= 92) { newOf.set(oldI, b); continue; }
        if (pctB <= 8) { newOf.set(oldI, a); continue; }
        newOf.set(oldI, 5 + mixIdx);
        mixDefs.push({ componentA: a, componentB: b, mixBPercent: pctB, stableId: ++mixIdx });
        continue;
      }
      // 3-component (gradient) mix — g<ids>/w<weights>, distribution mode 0 (verified vs a real Orca save).
      newOf.set(oldI, 5 + mixIdx);
      mixDefs.push({
        componentA: mm.ids[0], componentB: mm.ids[1], mixBPercent: 50,
        gradientIds: mm.ids.join(""), gradientWeights: mm.weights.join("/"), distributionMode: 0,
        stableId: ++mixIdx,
      });
    }
    fsKeptOld = physOld; // only the 4 physical land in filament_colour
    stateMap = (s) => (s === 0 ? 0 : newOf.get(s - 1) ?? 1);
    // Also remap object/part `key="extruder"` refs (e.g. the unpainted base colour) the same way —
    // otherwise the base would point at a now-virtual index and render as a mix.
    map = srcColours.map((_, i) => (newOf.get(i) ?? 1) - 1);
    useColours = physHex;
    useTypes = physOld.map((i) => srcTypes[i] ?? "PLA");
    reduced = true;
  } else if (target === "u1" && painted && colorsTotal > 0) {
    // Painted file: remap the paint codec so colors land in the right slots
    // (reduces >4 to 4; identity for <=4 unless the user reassigns). Needs a known palette — without
    // one (e.g. a Prusa file with no readable colours) we leave the codes untouched rather than guess.
    let assign: number[];
    if (manual && opts!.assign) {
      assign = opts!.assign;
      useColours = opts!.slots!.slice(0, 4).map(normalizeHex);
    } else {
      const r = reduceColors(srcColours, tallyPaintUsage(entries, colorsTotal));
      assign = r.map;
      useColours = r.colors;
    }
    useTypes = [0, 1, 2, 3].map((s) => {
      const oi = assign.findIndex((a) => a === s);
      return oi >= 0 ? srcTypes[oi] ?? "PLA" : "PLA";
    });
    const pu = tallyPaintUsage(entries, colorsTotal);
    const domIdx = pu.indexOf(Math.max(...pu, 0));
    const domSlot = domIdx >= 0 && assign[domIdx] != null ? assign[domIdx] + 1 : 1;
    stateMap = (s) => (s === 0 ? 0 : s >= 1 && s <= colorsTotal ? assign[s - 1] + 1 : domSlot);
    map = assign;
    reduced = true;
  } else if (target === "u1") {
    if (manual) {
      useColours = opts!.slots!.slice(0, 4).map(normalizeHex);
      if (opts!.assign && srcTypes.length) {
        useTypes = [0, 1, 2, 3].map((s) => {
          const oi = opts!.assign!.findIndex((a) => a === s);
          return oi >= 0 ? srcTypes[oi] ?? "PLA" : "PLA";
        });
      }
      // Rewrite per-object `key="extruder"` refs whenever the slot order actually changed — either a
      // >4 object reduction (objectAssigned) OR the user reordered the ≤4 slots (a non-identity assign,
      // e.g. via the slot ◀▶ buttons). Without this, reordering colours on a multi-plate "one colour
      // per plate" file rewrites filament_colour but leaves the extruder refs pointing at the old slots
      // → every plate prints the wrong colour. Identity assign (only editing colour VALUES in place)
      // needs no remap, so we skip it.
      const reorders = opts!.assign && !opts!.assign.every((a, i) => a === i);
      if (opts!.assign && (objectAssigned || reorders)) {
        map = opts!.assign;
        reduced = true;
      }
    } else if (over4 && objectAssigned) {
      const r = reduceColors(srcColours, tallyUsage(entries, srcColours.length));
      map = r.map;
      useColours = r.colors;
      useTypes = r.colors.map((_, gi) => {
        const fo = map!.indexOf(gi);
        return srcTypes[fo] ?? srcTypes[0] ?? "PLA";
      });
      reduced = true;
    }
  }

  // Profile mode: preserve the creator's settings (identity-swap) by default; "stamp" uses the
  // bundled tested U1 profile. Preserve needs a source config with filaments; else fall back to stamp.
  const wantPreserve = (opts?.mode ?? "preserve") === "preserve";
  // Custom-palette FS remaps the whole colour space to the user's filaments → stamp the tested U1
  // profile with those colours (preserving the source's per-filament settings would misalign).
  const canPreserve = wantPreserve && srcCfg !== null && colorsTotal > 0 && !customFS;
  const machine = opts?.machine ?? U1; // target printer (only the U1 is validated today)
  const brand: FilamentBrand = opts?.filamentBrand ?? "source";
  // source filament index -> slot 0..3 (reduction map if any, else manual assign, else identity).
  const assignEff = map ?? opts?.assign ?? srcColours.map((_, i) => Math.min(i, 3));
  const diff: DiffReport | null =
    target === "u1"
      ? {
          mode: canPreserve ? "preserve" : "stamp",
          printerFrom:
            (srcCfg?.printer_settings_id as string) ?? (srcCfg?.printer_model as string) ?? null,
          printerTo: machine.name,
          clamped: [],
          sentinelFixed: [],
          towerSafety: [],
          droppedForeignKeys: 0,
          antiClobber: false,
          vlhGuard: false,
          bedShift: null,
          prusaPaint,
          foreignNative: false,
          fullSpectrumMixes: mixDefs.length,
          nozzleFit: [],
          untestedProfile: machine.testedProfile === false,
          keptAllColours: keptAll ? colorsTotal : 0,
          filamentBrand: brand === "source" ? null : brand,
        }
      : null;
  // Nudge a (0,0)-origin Bambu/Prusa model onto the U1's printable area (origin 0.5,1) so edge-filling
  // models don't land on the excluded border. Only when the source bed origin differs from the U1's.
  const u1Org = bedOrigin(machine.profile?.printable_area);
  const srcOrg = bedOrigin(srcCfg?.printable_area);
  const dx = target === "u1" ? +(u1Org[0] - srcOrg[0]).toFixed(3) : 0;
  const dy = target === "u1" ? +(u1Org[1] - srcOrg[1]).toFixed(3) : 0;
  // Inject the Full Spectrum mixed-filament definitions + global dithering keys into a built config.
  const withMixes = (cfg: string): string => {
    if (!mixDefs.length) return cfg;
    const o = JSON.parse(cfg) as Record<string, unknown>;
    o.mixed_filament_definitions = serializeMixedDefs(mixDefs);
    for (const [k, v] of Object.entries(MIXED_DITHERING_DEFAULTS)) o[k] = v;
    // "Subdivide Mix Layer" — on by default (smoother blends), but the user can turn it off (fewer
    // toolchanges/less purge). MIXED_DITHERING_DEFAULTS turns it on; honour an explicit false.
    if (opts?.subdivide === false) {
      o.dithering_local_z_mode = "0";
      o.dithering_local_z_infill = "0";
    }
    // Mixed (Full Spectrum) zones lay down two filaments in alternating thin layers, so they run
    // hotter and fuse supports more readily than solid regions — give support interfaces extra
    // clearance for these prints. Floor only (never reduce a creator's larger gap). Bumped 0.3→0.35:
    // a real Minion print still had support lightly fused to a mixed feature (the goggles) at 0.3.
    const topGap = parseFloat(String(o.support_top_z_distance ?? "0"));
    if (!(topGap >= 0.35)) o.support_top_z_distance = "0.35";
    const botGap = parseFloat(String(o.support_bottom_z_distance ?? "0"));
    if (!(botGap >= 0.25)) o.support_bottom_z_distance = "0.25";
    // Mixed zones swap filament every dither step → lots of purge. Send that purge to the wipe tower
    // instead of dumping it into the model/supports (flush_into_support defaulted to 1, which deposits
    // coloured purge into the supports right beside painted features — the ooze/blobs seen on real mixed
    // prints). Turning all three flush-into-* off routes the purge to the tower. (NB: purge_in_prime_tower
    // is a single-extruder-multi-material setting — hidden and force-disabled on the U1 toolchanger — so
    // we don't touch it; flush_into_* is the real lever here.)
    o.flush_into_objects = "0";
    o.flush_into_infill = "0";
    o.flush_into_support = "0";
    // Explicit mixed-colour layer height: re-slice the painted mixed zones at this height via
    // dithering_z_step_size (the only key that actually changes the slice — the per-component heights
    // and bounds are no-ops with Local-Z/gradient off). Painted-zones-only so the rest of the model
    // keeps its normal layer height. Verified against Snapmaker Orca's update_layer_height_profile.
    const mlh = opts?.mixedLayerHeight;
    if (mlh && mlh > 0) {
      o.dithering_z_step_size = String(mlh);
      o.dithering_step_painted_zones_only = "1";
      // Switch from the default adaptive "Subdivide Mix Layer" (Local-Z) pipeline to the fixed-height
      // z-step pipeline — they're mutually exclusive (z-step guard is !local_z && !gradient && step>0).
      o.dithering_local_z_mode = "0";
      o.dithering_local_z_infill = "0";
    }
    // Make Orca actually KEEP these overrides on import. When a 3mf's print_settings_id names a system
    // preset, Orca rebuilds that preset and only re-applies the keys listed in different_settings_to_system
    // — anything else (our support gaps, purge routing, Subdivide toggles, the mix defs themselves)
    // silently reverts to the stock preset. So we must declare every print key we changed here. Format
    // (verified against a real Orca save): a filament_count+2 array of c-style key lists; index 0 = the
    // PRINT-preset diffs (these mixed/dithering/support/flush keys are all print-scoped), the rest blank.
    const overrideKeys = [
      "mixed_filament_definitions",
      ...Object.keys(MIXED_DITHERING_DEFAULTS),
      "support_top_z_distance", "support_bottom_z_distance",
      "flush_into_objects", "flush_into_infill", "flush_into_support",
    ];
    const filCount = Array.isArray(o.filament_colour) ? (o.filament_colour as unknown[]).length : 4;
    const prev = Array.isArray(o.different_settings_to_system) ? (o.different_settings_to_system as string[]) : [];
    const prevPrint = (prev[0] ?? "").split(";").filter(Boolean); // keep any the source already declared
    const printDiffs = [...new Set([...prevPrint, ...overrideKeys])].sort();
    const dss = new Array<string>(filCount + 2).fill("");
    dss[0] = printDiffs.join(";");
    o.different_settings_to_system = dss;
    return JSON.stringify(o);
  };
  // The VLH guard (prime tower off, tree→normal supports) applies only when the file has variable layers
  // AND the caller didn't opt to keep the tower. The VLH profile itself is preserved regardless.
  const guardVlh = hasVLH && !opts?.keepPrimeTowerVlh;
  const makeU1Config = () =>
    withMixes(
      fsKeptOld && srcCfg
        ? buildFullSpectrumConfig(srcCfg, fsKeptOld, colorsTotal, useColours, diff ?? undefined, guardVlh, machine, brand)
        : canPreserve
          ? buildPreservedConfig(srcCfg!, useColours, useTypes, assignEff, diff ?? undefined, guardVlh, machine, brand)
          : buildU1Config(useColours, useTypes, guardVlh, diff ?? undefined, machine, brand),
    );

  const removed: string[] = [];
  const out: Record<string, Uint8Array> = {};
  let hadProject = false;

  for (const [path, data] of Object.entries(entries)) {
    const lower = path.toLowerCase();
    const base = lower.split("/").pop() ?? "";

    if (base === "project_settings.config") {
      hadProject = true;
      if (target === "u1") out[path] = strToU8(makeU1Config());
      else removed.push(path);
      continue;
    }

    // By-layer colour sequence: rewrite pauses to the U1's M600, and (if requested) insert
    // batched M600 spool-swap pauses so >4 colours print without merging.
    if (target === "u1" && base === "custom_gcode_per_layer.xml") {
      let xml = strFromU8(data).replace(
        /(<layer\b[^>]*\btype="1"[^>]*\bgcode=")[^"]*(")/g,
        "$1M600$2",
      );
      if (useSwap && swapRemap) {
        const lh = srcCfg && srcCfg.layer_height != null ? parseFloat(String(srcCfg.layer_height)) : undefined;
        const r = insertSwapPauses(xml, swapRemap, srcColours, "M600", Number.isFinite(lh) ? lh : undefined);
        xml = r.xml;
        swaps = r.instructions;
      }
      out[path] = strToU8(xml);
      continue;
    }

    if (isStrippable(path)) {
      removed.push(path);
      continue;
    }

    if (lower.endsWith(".model")) {
      const raw = strFromU8(data); // Prusa slic3rpe:* attrs already renamed to paint_* upfront
      const needsPaint = !!stateMap && raw.includes("paint_color");
      const needsShift = target === "u1" && (!!dx || !!dy) && raw.includes("<build");
      const needsGen = target === "u1" && needsGeneratorFix(raw);
      if (!needsPaint && !needsShift && !needsGen) {
        out[path] = data; // byte-identical — don't re-encode geometry
        continue;
      }
      let text = needsPaint
        ? raw.replace(/paint_color="([0-9A-Fa-f]+)"/g, (_m, c) => `paint_color="${remapPaintCode(c, stateMap!)}"`)
        : raw;
      if (needsShift) {
        const r = shiftBuildItems(text, dx, dy);
        if (r.applied) {
          text = r.xml;
          if (diff) diff.bedShift = { dx, dy };
        }
      }
      if (needsGen) {
        text = forceOrcaGenerator(text); // foreign producer → trusted, else colours dropped
        if (diff) diff.foreignNative = true;
      }
      out[path] = strToU8(text);
    } else if (reduced && map && lower.endsWith(".config")) {
      out[path] = strToU8(remapExtruders(strFromU8(data), map));
    } else {
      out[path] = data;
    }
  }

  if (target === "u1" && !hadProject) {
    // No source profile to preserve → always the bundled stamp.
    out["Metadata/project_settings.config"] = strToU8(withMixes(buildU1Config(useColours, useTypes, guardVlh, diff ?? undefined, machine, brand)));
  }

  // Painted band-swap: painted files have no custom_gcode_per_layer.xml, so add the synthesized one with
  // the M600 pauses. (For >4-colour by-layer files the loop already rewrote the existing file above.)
  if (target === "u1" && bandSwapXml) out["Metadata/custom_gcode_per_layer.xml"] = strToU8(bandSwapXml);

  // PrusaSlicer files have no model_settings.config; without it Orca refuses to load
  // the file as a project ("loading geometry data only"). Synthesize one from the build items.
  if (target === "u1" && !Object.keys(out).some((p) => /model_settings\.config$/i.test(p))) {
    const mainModel = Object.entries(out).find(
      ([p, d]) => p.toLowerCase().endsWith(".model") && strFromU8(d).includes("<build"),
    );
    if (mainModel) {
      const ms = generateOrcaModelSettings(strFromU8(mainModel[1]));
      if (ms) out["Metadata/model_settings.config"] = strToU8(ms);
    }
  }

  const zipped = zipSync(out, { level: 6 });
  return {
    blob: new Blob([zipped.buffer as ArrayBuffer], { type: "model/3mf" }),
    removed,
    kept: Object.keys(out).length,
    // Pass-through keeps every filament, so the U1's 4 heads are not the ceiling here.
    colorsKept: target === "u1" ? (keptAll ? colorsTotal : Math.min(useColours.length || 4, 4)) : 0,
    colorsTotal,
    over4,
    reduced,
    painted,
    manual,
    preserved: target === "u1" && canPreserve,
    swaps,
    diff,
  };
}

// ---------- part / plate splitting (run on ALREADY-converted bytes) ----------
// These operate on a converted .3mf and only touch <build> items + model_settings <plate> blocks —
// geometry and paint are never modified, so colours can't change. Dropped objects simply aren't
// placed (they become unreferenced resources the slicer ignores).

const PLATE_ARTIFACT = /^(plate|plate_no_light|top|pick)_\d+\.(png|json)$|^plate_\d+\.gcode(\.md5)?$/;
// stale per-plate file references inside a <plate> block (regenerated on re-slice)
const stripPlateRefs = (block: string) =>
  block.replace(/\s*<metadata key="(gcode_file|thumbnail_file|thumbnail_no_light_file|top_file|pick_file)"[^>]*\/>/g, "");

/** Prune model_settings to a kept object-id set: drop plate instances, <assemble> items, and (only
 *  when its object ids align with the build's) orphan <object> setting blocks. Removing these dangling
 *  references is what lets the slicer load an isolated subset — a leftover <assemble> item pointing at
 *  a removed object makes Bambu/Orca reject the whole file. */
function pruneModelSettings(xml: string, keep: Set<number>): string {
  // plates: drop instances not kept; drop the whole plate when nothing of ours is left; renumber the
  // survivors from 1 so a part that was on plate 2+ doesn't leave a phantom empty plate 1 in the slicer.
  let plateIdx = 0;
  xml = xml.replace(/<plate>[\s\S]*?<\/plate>/g, (block) => {
    let b = block;
    for (const inst of block.matchAll(/<model_instance>[\s\S]*?<\/model_instance>/g))
      if (!keep.has(parseInt(/key="object_id" value="(\d+)"/.exec(inst[0])?.[1] ?? "-1", 10))) b = b.replace(inst[0], "");
    if (!/<model_instance>/.test(b)) return ""; // empty plate → remove
    plateIdx += 1;
    return stripPlateRefs(b).replace(/key="plater_id" value="\d+"/, `key="plater_id" value="${plateIdx}"`);
  });
  // assemble: drop items not kept; drop the block entirely if empty (a dangling item is fatal)
  xml = xml.replace(/<assemble>[\s\S]*?<\/assemble>/g, (block) => {
    let b = block;
    for (const it of block.matchAll(/<assemble_item\b[^>]*\/>/g))
      if (!keep.has(parseInt(/object_id="(\d+)"/.exec(it[0])?.[1] ?? "-1", 10))) b = b.replace(it[0], "");
    return /<assemble_item/.test(b) ? b : "";
  });
  // per-object settings: drop orphans — but only when every kept id maps to a settings object (some
  // slicer versions number model_settings objects differently from the build; don't risk nuking ours).
  const msIds = [...xml.matchAll(/<object id="(\d+)"/g)].map((m) => parseInt(m[1], 10));
  if ([...keep].every((id) => msIds.includes(id)))
    xml = xml.replace(/<object id="(\d+)"[\s\S]*?<\/object>/g, (block, id) => (keep.has(parseInt(id, 10)) ? block : ""));
  return xml;
}

const normPath = (p: string) => p.replace(/^\//, "");

/** Shift a build <item> tag's transform translation by (dx,dy) in the XY plane. */
function shiftItemXY(tag: string, dx: number, dy: number): string {
  return tag.replace(/transform="([^"]*)"/, (_m, t) => {
    const n = t.trim().split(/\s+/).map(Number);
    if (n.length >= 12) { n[9] += dx; n[10] += dy; } // indices 9,10 = tx,ty
    return `transform="${n.join(" ")}"`;
  });
}

/** Isolate the given build-item object ids into a standalone .3mf: removes the OTHER objects'
 *  geometry (so a later re-convert sees only this part's colours → an independent ≤4 palette),
 *  trims <build>, prunes model_settings (plates/assemble/orphan objects), drops empty .model files +
 *  their relationships, and drops cut_information (the isolated part has no cut-group left).
 *  `translateXY` shifts the kept items so the part lands on the bed — multi-plate files store parts
 *  on a global grid (plate 2+ sit off the single bed), which the slicer rejects when isolated. */
export function subsetThreeMF(bytes: Uint8Array, keep: Set<number>, translateXY?: [number, number]): Uint8Array {
  const entries = safeUnzip(bytes);

  // 1) Parse the object graph across all .model files (each file has its own id namespace).
  const fileObjs = new Map<string, Map<number, { comps: { path: string; id: number }[] }>>();
  let mainPath = "";
  for (const [path, data] of Object.entries(entries)) {
    if (!path.toLowerCase().endsWith(".model")) continue;
    const xml = strFromU8(data);
    // Every .model carries a <build> (the spec requires one); only the ROOT has build <item>s.
    if (/<build\b[^>]*>[\s\S]*?<item\b/.test(xml)) mainPath = normPath(path);
    const objs = new Map<number, { comps: { path: string; id: number }[] }>();
    for (const om of xml.matchAll(/<object\b([^>]*)>([\s\S]*?)<\/object>/g)) {
      const id = parseInt(/id="(\d+)"/.exec(om[1])?.[1] ?? "-1", 10);
      if (id < 0) continue;
      const comps = [...om[2].matchAll(/<component\b([^>]*?)\/?>/g)]
        .map((c) => ({
          path: /path="([^"]*)"/.exec(c[1])?.[1] ? normPath(/path="([^"]*)"/.exec(c[1])![1]) : normPath(path),
          id: parseInt(/objectid="(\d+)"/.exec(c[1])?.[1] ?? "-1", 10),
        }))
        .filter((c) => c.id >= 0);
      objs.set(id, { comps });
    }
    fileObjs.set(normPath(path), objs);
  }

  // 2) Transitive closure: every (file, object) reachable from the kept build items.
  const needed = new Set<string>();
  const stack = [...keep].map((id) => `${mainPath}#${id}`);
  while (stack.length) {
    const key = stack.pop()!;
    if (needed.has(key)) continue;
    needed.add(key);
    const [p, idStr] = key.split("#");
    for (const c of fileObjs.get(p)?.get(parseInt(idStr, 10))?.comps ?? []) stack.push(`${c.path}#${c.id}`);
  }

  // 3) Rebuild: prune geometry to the closure, trim build, prune model_settings, drop empty models.
  const out: Record<string, Uint8Array> = {};
  const droppedModels = new Set<string>();
  for (const [path, data] of Object.entries(entries)) {
    const lower = path.toLowerCase();
    const base = lower.split("/").pop() ?? "";
    if (PLATE_ARTIFACT.test(base) || base === "cut_information.xml" || base === "filament_sequence.json") continue;
    if (lower.endsWith(".model")) {
      let xml = strFromU8(data).replace(/<object\b([^>]*)>([\s\S]*?)<\/object>/g, (full, attrs) =>
        needed.has(`${normPath(path)}#${parseInt(/id="(\d+)"/.exec(attrs)?.[1] ?? "-1", 10)}`) ? full : "",
      );
      if (/<build\b/.test(xml)) {
        xml = xml.replace(/(<build\b[^>]*>)([\s\S]*?)(<\/build>)/, (_m, open, inner, close) => {
          const kept = [...inner.matchAll(/<item\b[^>]*\/>/g)]
            .map((m) => m[0])
            .filter((tag) => keep.has(parseInt(/objectid="(\d+)"/.exec(tag)?.[1] ?? "-1", 10)))
            .map((tag) => (translateXY ? shiftItemXY(tag, translateXY[0], translateXY[1]) : tag));
          return `${open}\n    ${kept.join("\n    ")}\n  ${close}`;
        });
      }
      if (!/<object\b/.test(xml)) { droppedModels.add(normPath(path)); continue; } // nothing left → drop file
      out[path] = strToU8(xml);
    } else if (base === "model_settings.config") {
      out[path] = strToU8(pruneModelSettings(strFromU8(data), keep));
    } else if (base === "slice_info.config") {
      out[path] = strToU8(strFromU8(data).replace(/<plate>[\s\S]*?<\/plate>/g, "")); // stale slice info
    } else {
      out[path] = data;
    }
  }

  // 4) Drop relationships pointing at removed .model files (dangling rels also reject the load).
  if (droppedModels.size) {
    for (const [path, data] of Object.entries(out)) {
      if (!path.toLowerCase().endsWith(".rels")) continue;
      out[path] = strToU8(
        strFromU8(data).replace(/\s*<Relationship\b[^>]*\/>/g, (rel) =>
          droppedModels.has(normPath(/Target="([^"]*)"/.exec(rel)?.[1] ?? "")) ? "" : rel,
        ),
      );
    }
  }
  return zipSync(out);
}

/** Rewrite model_settings so each group of object ids becomes its own plate (one multi-plate file).
 *  Geometry + build items are kept as-is; only plate assignment changes. */
export function reassignPlates(bytes: Uint8Array, groups: number[][]): Uint8Array {
  const entries = safeUnzip(bytes);
  const out: Record<string, Uint8Array> = {};
  const plateBlocks = groups
    .map((ids, i) => {
      const insts = ids
        .map(
          (id) =>
            `    <model_instance>\n      <metadata key="object_id" value="${id}"/>\n      <metadata key="instance_id" value="0"/>\n    </model_instance>`,
        )
        .join("\n");
      return `  <plate>\n    <metadata key="plater_id" value="${i + 1}"/>\n    <metadata key="plater_name" value=""/>\n    <metadata key="locked" value="false"/>\n${insts}\n  </plate>`;
    })
    .join("\n");
  for (const [path, data] of Object.entries(entries)) {
    const lower = path.toLowerCase();
    const base = lower.split("/").pop() ?? "";
    if (PLATE_ARTIFACT.test(base)) continue;
    if (base === "model_settings.config") {
      let xml = strFromU8(data).replace(/[ \t]*<plate>[\s\S]*?<\/plate>\n?/g, ""); // remove old plates
      xml = xml.replace(/<\/config>\s*$/, `${plateBlocks}\n</config>\n`);
      out[path] = strToU8(xml);
    } else if (base === "slice_info.config") {
      out[path] = strToU8(strFromU8(data).replace(/<plate>[\s\S]*?<\/plate>/g, ""));
    } else {
      out[path] = data;
    }
  }
  return zipSync(out);
}

/** Bundle several already-compressed .3mf files into one .zip (store, no recompression). */
export function zipFiles(files: { name: string; bytes: Uint8Array }[]): Uint8Array {
  return zipSync(Object.fromEntries(files.map((f) => [f.name, f.bytes])), { level: 0 });
}

/** Trigger a browser download for a Blob. */
/** Tested-print settings read from a converted .3mf — IN THE BROWSER, nothing uploaded. Lets a
 *  "verified link" entry carry the dialed U1 settings (colors/types/temps/layer height) without
 *  re-hosting the model file (important for MakerWorld & other no-redistribution licenses). */
export type ProfileSettings = {
  colors: string[];
  filamentTypes: string[];
  nozzleTemps: number[];
  layerHeight: number | null;
  fullSpectrum: boolean;
};

export async function extractPrintSettings(file: File): Promise<ProfileSettings | null> {
  const entries = safeUnzip(new Uint8Array(await file.arrayBuffer()));
  const cfgEntry = Object.entries(entries).find(([p]) => p.toLowerCase().endsWith("project_settings.config"));
  if (!cfgEntry) return null;
  let cfg: Record<string, unknown>;
  try {
    cfg = JSON.parse(strFromU8(cfgEntry[1]));
  } catch {
    return null;
  }
  const arr = (k: string): unknown[] => (Array.isArray(cfg[k]) ? (cfg[k] as unknown[]) : []);
  const colors = arr("filament_colour").map((c) => normalizeHex(String(c)));
  const filamentTypes = arr("filament_type").map((t) => String(t));
  const nozzleTemps = arr("nozzle_temperature").map((t) => parseInt(String(t), 10)).filter((n) => Number.isFinite(n));
  const lh = cfg.layer_height != null ? parseFloat(String(cfg.layer_height)) : NaN;
  const layerHeight = Number.isFinite(lh) ? lh : null;
  let fullSpectrum = Boolean(cfg.mixed_filament_definitions && String(cfg.mixed_filament_definitions).trim());
  if (!fullSpectrum) {
    const ms = Object.entries(entries).find(([p]) => p.toLowerCase().endsWith("model_settings.config"));
    if (ms) fullSpectrum = /mixed_filament/i.test(strFromU8(ms[1]));
  }
  return { colors, filamentTypes, nozzleTemps, layerHeight, fullSpectrum };
}

/** Trigger a browser download for a Blob. */
// Trigger a browser "Save file" for `blob` under `filename`. Attach the anchor to the DOM (some engines
// ignore a detached <a download>) and defer cleanup so the save has committed before we tear it down.
function saveViaAnchor(href: string, filename: string, cleanup?: () => void) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    cleanup?.();
  }, 1500);
}

// WebKit/Safari — desktop, iOS, and the extension popup/content-script contexts. iOS Chrome/Firefox/Edge
// also contain "Safari" in the UA, so exclude their tokens. The extension-popup origin is a belt-and-
// suspenders extra trigger.
export function isWebKit(): boolean {
  if (typeof location !== "undefined" && location.protocol === "safari-web-extension:") return true;
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  return /\bsafari\b/i.test(ua) && !/\b(crios|fxios|edgios|chrome|chromium|android|edg|opr|firefox)\b/i.test(ua);
}

export function download(blob: Blob, filename: string) {
  // Safari ignores the download-filename attribute for blob: URLs (WebKit bug 167341) and saves the file
  // named after the blob's UUID with NO extension — so the U1 file lands as an unopenable "unknown file".
  // Safari DOES honor the filename for data: URLs, so on WebKit read the blob into a data: URL first.
  // Other engines keep the efficient blob path (no giant base64 string, no memory spike on large files).
  // Safari won't download a data: URL from an extension popup at all (it silently no-ops), but it DOES
  // download a blob: URL. The catch: with the blob's real type ("model/3mf", unregistered) Safari tries to
  // *handle/preview* the content and in that mode drops the download-filename → a nameless "unknown file".
  // Re-wrapping the SAME bytes as application/octet-stream (cheap — no data copy) forces true download mode,
  // where Safari honors the download attribute and saves it as the proper .u1.3mf name.
  const dl = isWebKit() && blob.type !== "application/octet-stream" ? new Blob([blob], { type: "application/octet-stream" }) : blob;
  const url = URL.createObjectURL(dl);
  saveViaAnchor(url, filename, () => URL.revokeObjectURL(url));
}
