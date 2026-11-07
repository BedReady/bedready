// "Does this model fit my printer?" in one line — the extension's "Check fit" on a MakerWorld page.
//
// ── NO NEW HEURISTICS ────────────────────────────────────────────────────────────────────────────
// Every judgement here is one /convert already makes, by the same function: the bed by `fitVerdict`
// (per plate, part vs layout — lib/fit.ts), "one file per plate keeps every colour" by
// `platesFitSlots`, the colour count the way `convertWarnings` counts it (painted → the colours the
// mesh actually uses, otherwise the filament list), and a file too big to open whole by
// `peekPlates`. This module only picks which of those answers is the one line worth showing, and
// returns it as a message key + values so each surface words it in its own language.
//
// Order: the bed first (a part that does not fit is the only problem colours cannot fix), then
// colours — fits as is, one file per plate, Full Spectrum, spool swaps, or merged.

import { analyzeThreeMF, ThreeMFError, type Analysis } from "./convert";
import { extractMeshFromBuffer, type MeshData } from "./paint";
import { fitVerdict } from "./fit";
import { platesFitSlots } from "./plate-colors";
import { peekPlates } from "./plates";
import type { Machine } from "./targets";

export type FitLineKey =
  | "fitOk" // colours fit the slots, bed checked
  | "fitOkSlotsOnly" // colours fit the slots, bed not measurable (preview too big to sample)
  | "fitFullSpectrum" // more colours than slots, kept by mixing (painted / ColorMix, mixing printer)
  | "fitSwaps" // more colours than slots, by layer: kept with spool-swap pauses (U1)
  | "fitSplit" // more colours than slots overall, few enough per plate: one file per plate (U1)
  | "fitMerge" // more colours than slots, the extras merge
  | "fitTooBig" // one part is bigger than the bed
  | "fitLayout" // every part fits, the plate's arrangement does not
  | "fitGeneric" // no printer chosen (generic 3MF): colours only
  | "fitBigFileSplit"; // too big to open whole, but it has plates that open one at a time

export type FitLine = { key: FitLineKey; params: Record<string, string | number> };

export const FIT_LINE_KEYS: readonly FitLineKey[] = [
  "fitOk", "fitOkSlotsOnly", "fitFullSpectrum", "fitSwaps", "fitSplit", "fitMerge", "fitTooBig", "fitLayout", "fitGeneric", "fitBigFileSplit",
];

/**
 * How the line should read at a glance: "ok" (prints with every colour, as is or by the export
 * named), "caution" (prints, but something is lost or unchecked), "no" (does not fit the bed).
 */
export function fitTone(key: FitLineKey): "ok" | "caution" | "no" {
  if (key === "fitTooBig") return "no";
  if (key === "fitMerge" || key === "fitOkSlotsOnly" || key === "fitLayout" || key === "fitGeneric") return "caution";
  return "ok";
}

/**
 * A line that came over a message, checked before it is shown: a known key, and only the param
 * names the lines use, each a short string or a finite number. Anything else → null.
 */
export function parseFitLine(raw: unknown): FitLine | null {
  const o = raw as { key?: unknown; params?: unknown } | null;
  if (!o || typeof o !== "object" || !FIT_LINE_KEYS.includes(o.key as FitLineKey)) return null;
  const params: Record<string, string | number> = {};
  const p = (o.params && typeof o.params === "object" ? o.params : {}) as Record<string, unknown>;
  for (const k of ["count", "plates", "heads", "printer"]) {
    const v = p[k];
    if (typeof v === "number" && Number.isFinite(v)) params[k] = v;
    else if (typeof v === "string" && v.length <= 60) params[k] = v;
  }
  return { key: o.key as FitLineKey, params };
}

/** What `fitLine` needs from a mesh: the shape `extractMeshFromBuffer` returns. */
export type FitLineMesh = Pick<MeshData, "positions" | "parts" | "plates" | "palette" | "baseState" | "statesPresent" | "skipped">;

export type FitLineInput = {
  analysis: Pick<Analysis, "colors" | "painted" | "encoding" | "fullSpectrumFile">;
  mesh: FitLineMesh | null;
  /** The chosen printer, or undefined for a generic 3MF (no bed, no slot count). */
  machine: Machine | undefined;
  /** The U1 target: the split-per-plate and spool-swap exports exist for it only, as on /convert. */
  isU1: boolean;
  /** The printer's short name as the extension shows it ("U1", "X1 Carbon"). */
  printer: string;
};

const usableMesh = (m: FitLineMesh | null): m is FitLineMesh => !!m && !m.skipped && m.positions.length >= 9;

/** The colours a model uses, counted as `convertWarnings` counts them for /convert's warnings. */
export function colourCount(analysis: FitLineInput["analysis"], mesh: FitLineMesh | null): number {
  if (analysis.painted && mesh && mesh.statesPresent.length) {
    return new Set([mesh.baseState, ...mesh.statesPresent].filter((s) => s >= 1 && s <= mesh.palette.length)).size;
  }
  return analysis.colors.length;
}

/** The one line for a file that opened. Pure: every input is data already read from the file. */
export function fitLine({ analysis, mesh, machine, isU1, printer }: FitLineInput): FitLine {
  const count = Math.max(1, colourCount(analysis, mesh));
  if (!machine) return { key: "fitGeneric", params: { count } };

  const measured = usableMesh(mesh);
  if (measured) {
    // fitVerdict takes one XY limit; a rectangular bed is checked against its shorter side, so a
    // "too big" here can be a part that fits only when rotated — never a "fits" that does not.
    const bed = fitVerdict(mesh, Math.min(machine.bed.x, machine.bed.y), machine.bed.z);
    if (bed) return { key: bed.kind === "part" ? "fitTooBig" : "fitLayout", params: { printer } };
  }

  const slots = machine.toolheads;
  if (count <= slots) return { key: measured ? "fitOk" : "fitOkSlotsOnly", params: { count, printer } };

  const plates = isU1 && measured ? platesFitSlots(mesh, slots) : null;
  if (plates) return { key: "fitSplit", params: { count, plates } };
  if (machine.supportsMixedFilament && (analysis.painted || analysis.fullSpectrumFile)) {
    return { key: "fitFullSpectrum", params: { count, printer } };
  }
  if (isU1 && analysis.encoding === "by-layer") return { key: "fitSwaps", params: { count, printer } };
  return { key: "fitMerge", params: { count, printer, heads: slots } };
}

/**
 * Read a .3mf and answer. Null when the file cannot be read at all (not a 3MF, or too big with no
 * plates to fall back on) — the caller says so rather than guessing.
 */
export async function checkFit(
  file: File,
  opts: { machine: Machine | undefined; isU1: boolean; printer: string },
): Promise<FitLine | null> {
  let analysis: Analysis;
  try {
    analysis = await analyzeThreeMF(file);
  } catch (e) {
    // Too big as one archive is not too big per plate: the same fallback /convert offers.
    if (e instanceof ThreeMFError && e.code !== "not_3mf") {
      try {
        const plates = peekPlates(new Uint8Array(await file.arrayBuffer())).filter((p) => p.bytes > 0).length;
        if (plates > 1) return { key: "fitBigFileSplit", params: { plates } };
      } catch {
        /* not plate-structured */
      }
    }
    return null;
  }
  let mesh: MeshData | null = null;
  try {
    mesh = extractMeshFromBuffer(new Uint8Array(await file.arrayBuffer()));
  } catch {
    mesh = null; // no preview: the colour verdict still stands, the bed goes unchecked
  }
  return fitLine({ analysis, mesh, ...opts });
}
