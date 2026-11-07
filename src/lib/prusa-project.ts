// Bambu / Orca painted 3MF → a PrusaSlicer project for a multi-tool Prusa (the CORE One INDX first).
//
// Until this existed, a cross-family retarget fell back to a Generic 3MF. PrusaSlicer 2.9.6 does read
// Bambu's `paint_color` and its `p:path` components — verified by slicing on 2026-10-01 — so the
// painting survived. Three things did not:
//
//   1. WHICH TOOLHEAD. Paint states point at filament 1…n of whatever printer is active, so a model
//      painted for a Bambu AMS lands on INDX tools in creator order, not on the spools you loaded.
//      Here every state is remapped through the converter's slot assignment (`map`), the same one the
//      slot editor and "match colors to these slots" produce.
//   2. THE UNPAINTED FACES. Bambu stores a part's own filament in Metadata/model_settings.config,
//      which PrusaSlicer does not read, so a part assigned to filament 3 printed with tool 1. Every
//      face is painted EXPLICITLY here instead (the inverse of paint.ts's applyPrusaVolumePaint), so
//      nothing depends on a "base extruder" either slicer could interpret differently.
//   3. THE PRINTER. A minimal Metadata/Slic3r_PE.config names the target preset and carries the slot
//      colours. It holds identity and colour ONLY: BedReady is MIT and Prusa's profiles are AGPL, and
//      PrusaSlicer fills every other key from its own system preset of that name.
//
// Build items are moved from the source bed's centre to the target's, because a model centred on a
// 256 mm Bambu plate sits off the INDX's 205 mm-deep bed.
//
// Paint states after remapping are ≤ the target's toolheads (8 at most), so the encoding is the one
// PrusaSlicer's `mmu_segmentation` and Bambu's `paint_color` share: they only diverge above 16 states.

import { strFromU8, strToU8 } from "fflate";
import { encodeSolidPaint, remapPaintCode, normalizeHex } from "./paint";
import { mixRgb } from "./filament-mixer";
import { deltaE, hexToRgb, rgbToHex } from "./color-mix";
import type { Machine } from "./targets";

const SLIC3RPE_NS = "http://schemas.slic3r.org/3mf/2017/06";

// ── COLORMIX: PRUSASLICER FULLSPECTRUM VIRTUAL EXTRUDERS ─────────────────────────────────────────
//
// PrusaSlicer 2.9.6 prints a "virtual extruder" as a repeating cycle of physical tools, one per
// layer, in proportion to its component ratios. Read from its source (libslic3r/Feature/
// FullSpectrum/VirtualExtruder.cpp, Format/3mf.cpp at version_2.9.6) and confirmed by slicing on
// 2026-10-02: a face painted with virtual id 9 = {T1 0.5, T2 0.5} alternated T0/T1 through its
// layers, and the same file without the JSON fell back to T0.
//
//   · The definitions live in Metadata/Prusa_Slicer_full_spectrum.json, version 1:
//     { physical_extruders: [{id, color}], virtual_extruders: [{id, kind: "fullspectrum",
//       components: [{extruder, ratio}]}] }. `color` is optional and left out, so PrusaSlicer predicts
//     the blend with its own calibrated mixer rather than displaying ours.
//   · Virtual ids sit above the physical tools (9+ on the 8T). physical_extruders lists every tool,
//     so PrusaSlicer's import-time remap never runs (it shifts paint states only, not base extruders).
//   · 2 or 3 components (MAX_BLEND_COMPONENTS = 3). Ratios are the ones PrusaSlicer's own dialog
//     offers, 1:1, 1:3, 3:1 and 1:1:1, because any ratio becomes a layer cycle and an odd one makes a
//     long cycle of tool changes.
//   · Paint states stay ≤ 16, the encoding paint_color and mmu_segmentation share without the
//     MmPaintingVersion 2 extension, so the 8T gets at most 8 blends and the 4T 12, capped at 8.
export const FULL_SPECTRUM_FILE = "Metadata/Prusa_Slicer_full_spectrum.json";
const MAX_PAINT_STATE = 16;
const MAX_BLENDS = 8;
/** A spool this close needs no blend: a toolchange on every layer is not worth a near-invisible shift. */
const KEEP_SPOOL_DE = 6;
/** A blend has to beat the nearest spool by this much (CIEDE2000) to be worth its tool changes. */
const BLEND_MARGIN_DE = 2;

export type PrusaBlend = {
  /** 1-based physical tools and their shares; shares sum to 1. */
  components: { tool: number; ratio: number }[];
  /** Our predicted colour (Snapmaker's pigment model), for the preview only. */
  hex: string;
};

export type ColorMixPlan = {
  /** Per palette colour: 0-based target. < tools = a physical slot; tools + k = blend k. */
  map: number[];
  blends: PrusaBlend[];
  /** Per palette colour: what it is predicted to print as. */
  predicted: string[];
};

type Rgb3 = [number, number, number];
const rgb3 = (hex: string): Rgb3 => {
  const c = hexToRgb(hex) ?? { r: 255, g: 255, b: 255 };
  return [c.r, c.g, c.b];
};
const hex3 = ([r, g, b]: Rgb3) => rgbToHex(r, g, b).toUpperCase();

/** Every blend PrusaSlicer's dialog can express from these slots: pairs at 1:1, 1:3, 3:1, triples 1:1:1. */
function candidateBlends(slots: string[], loaded: (i: number) => boolean = () => true): PrusaBlend[] {
  const c = slots.map(rgb3);
  const out: PrusaBlend[] = [];
  const ok = (...ix: number[]) => ix.every(loaded);
  for (let i = 0; i < c.length; i++)
    for (let j = i + 1; j < c.length; j++)
      if (ok(i, j)) for (const t of [0.5, 0.25, 0.75])
        out.push({ components: [{ tool: i + 1, ratio: 1 - t }, { tool: j + 1, ratio: t }], hex: hex3(mixRgb(c[i], c[j], t)) });
  for (let i = 0; i < c.length; i++)
    for (let j = i + 1; j < c.length; j++)
      for (let k = j + 1; k < c.length; k++)
        if (ok(i, j, k)) out.push({
          components: [{ tool: i + 1, ratio: 1 / 3 }, { tool: j + 1, ratio: 1 / 3 }, { tool: k + 1, ratio: 1 / 3 }],
          hex: hex3(mixRgb(mixRgb(c[i], c[j], 0.5), c[k], 1 / 3)),
        });
  return out;
}

const blendKey = (b: PrusaBlend) => b.components.map((x) => `${x.tool}:${x.ratio.toFixed(4)}`).join("|");

/**
 * For each palette colour: the nearest loaded spool, or a blend of them when no spool is close and a
 * blend is clearly closer. Identical blends are shared. If more blends are wanted than ids exist, the
 * ones that improve their colour least go back to their spool.
 *
 * `usable` marks the slots that really hold a spool. The converter pads a 5-colour model to an 8-tool
 * INDX with white placeholders; without the mask those were matched and blended as if white were
 * loaded. Omitted (or nothing marked), every slot counts.
 */
export function planColorMix(palette: string[], slots: string[], tools: number, usable?: boolean[]): ColorMixPlan {
  const n = Math.min(Math.max(1, tools), slots.length || tools);
  const loaded = slots.slice(0, n).map(normalizeHex);
  const anyUsable = !!usable && loaded.some((_, i) => usable[i]);
  const isLoaded = (i: number) => !anyUsable || !!usable![i];
  const cands = candidateBlends(loaded, isLoaded);
  type Pick = { spool: number; spoolDE: number; blend: PrusaBlend | null; blendDE: number };
  const picks: Pick[] = palette.map((hex) => {
    let spool = 0;
    let spoolDE = Infinity;
    loaded.forEach((s, i) => {
      if (!isLoaded(i)) return;
      const d = deltaE(hex, s);
      if (d < spoolDE) {
        spoolDE = d;
        spool = i;
      }
    });
    if (spoolDE < KEEP_SPOOL_DE) return { spool, spoolDE, blend: null, blendDE: Infinity };
    let blend: PrusaBlend | null = null;
    let blendDE = Infinity;
    for (const b of cands) {
      const d = deltaE(hex, b.hex);
      if (d < blendDE) {
        blendDE = d;
        blend = b;
      }
    }
    return blendDE < spoolDE - BLEND_MARGIN_DE ? { spool, spoolDE, blend, blendDE } : { spool, spoolDE, blend: null, blendDE };
  });
  // Distinct blends, best improvement first, capped by the ids the paint encoding can address.
  const room = Math.max(0, Math.min(MAX_BLENDS, MAX_PAINT_STATE - n));
  const gain = new Map<string, number>();
  for (const p of picks) if (p.blend) gain.set(blendKey(p.blend), Math.max(gain.get(blendKey(p.blend)) ?? 0, p.spoolDE - p.blendDE));
  const kept = [...gain.entries()].sort((a, b) => b[1] - a[1]).slice(0, room).map(([k]) => k);
  const blends: PrusaBlend[] = [];
  const idOf = new Map<string, number>();
  for (const p of picks) {
    if (!p.blend) continue;
    const k = blendKey(p.blend);
    if (!kept.includes(k) || idOf.has(k)) continue;
    idOf.set(k, blends.length);
    blends.push(p.blend);
  }
  return {
    map: picks.map((p) => (p.blend && idOf.has(blendKey(p.blend)) ? n + idOf.get(blendKey(p.blend))! : p.spool)),
    blends,
    predicted: picks.map((p, i) => (p.blend && idOf.has(blendKey(p.blend)) ? p.blend.hex : loaded[p.spool] ?? palette[i])),
  };
}

/** The FullSpectrum JSON, in the shape PrusaSlicer 2.9.6 writes it (minus the optional colour). */
export function fullSpectrumJson(machine: Machine, colours: string[], blends: PrusaBlend[]): string {
  const n = Math.max(1, machine.toolheads);
  return JSON.stringify(
    {
      version: 1,
      physical_extruders: Array.from({ length: n }, (_, i) => ({ id: i + 1, color: normalizeHex(colours[i] ?? "#FFFFFF") })),
      virtual_extruders: blends.map((b, k) => ({
        id: n + 1 + k,
        kind: "fullspectrum",
        components: b.components.map((c) => ({ extruder: c.tool, ratio: +c.ratio.toFixed(6) })),
      })),
    },
    null,
    4,
  );
}

export type PrusaProjectInput = {
  /**
   * Source filament index (0-based) → target (0-based); null = identity. A target at or past the
   * machine's tool count is a blend: tools + k means `blends[k]`, written as virtual extruder
   * tools + 1 + k.
   */
  map: number[] | null;
  /** ColorMix blends the map may point at. Empty or absent: no FullSpectrum file is written. */
  blends?: PrusaBlend[];
  /** One colour per target slot. */
  colours: string[];
  /** One filament type per target slot. */
  types: string[];
};

type Extruders = { object: Map<string, number>; part: Map<string, number> };

/** Bambu/Orca model_settings.config: object id → its extruder, and object id/part id → the part's. */
function readExtruders(entries: Record<string, Uint8Array>): Extruders {
  const object = new Map<string, number>();
  const part = new Map<string, number>();
  const entry = Object.entries(entries).find(([p]) => p.toLowerCase().endsWith("model_settings.config"));
  if (!entry) return { object, part };
  const xml = strFromU8(entry[1]);
  for (const om of xml.matchAll(/<object id="(\d+)"[^>]*>([\s\S]*?)<\/object>/g)) {
    const [, oid, body] = om;
    const own = body.replace(/<part\b[\s\S]*?<\/part>/g, "").match(/key="extruder" value="(\d+)"/);
    if (own) object.set(oid, parseInt(own[1], 10));
    for (const pm of body.matchAll(/<part id="(\d+)"[^>]*>([\s\S]*?)<\/part>/g)) {
      const e = pm[2].match(/key="extruder" value="(\d+)"/);
      if (e) part.set(`${oid}/${pm[1]}`, parseInt(e[1], 10));
    }
  }
  return { object, part };
}

/**
 * Which source filament an unpainted face of `objectId` in `path` prints with. A component file's
 * object is a PART of the root object that references it, so its extruder is looked up as a part
 * first, then as that root object; a root-level mesh is its own object.
 */
function baseFilaments(entries: Record<string, Uint8Array>, ex: Extruders): (path: string, objectId: string) => number {
  const owner = new Map<string, string>(); // "path#objectid" → root object id
  const rootPath = Object.keys(entries).find((p) => p.toLowerCase() === "3d/3dmodel.model");
  if (rootPath) {
    const root = strFromU8(entries[rootPath]);
    for (const om of root.matchAll(/<object id="(\d+)"[^>]*>([\s\S]*?)<\/object>/g)) {
      for (const cm of om[2].matchAll(/<component\b([^>]*)\/>/g)) {
        const path = /p:path="\/?([^"]+)"/.exec(cm[1])?.[1];
        const oid = /objectid="(\d+)"/.exec(cm[1])?.[1];
        if (path && oid) owner.set(`${path}#${oid}`, om[1]);
      }
    }
  }
  return (path, objectId) => {
    const rootId = owner.get(`${path}#${objectId}`);
    if (rootId) return ex.part.get(`${rootId}/${objectId}`) ?? ex.object.get(rootId) ?? 1;
    return ex.object.get(objectId) ?? 1;
  };
}

// ── MODIFIERS, NEGATIVE PARTS, SUPPORT BLOCKERS AND ENFORCERS ────────────────────────────────────
//
// Bambu/Orca keep a part's KIND in model_settings.config (`<part subtype="negative_part">`), which
// PrusaSlicer does not read, and the project used to drop that file. PrusaSlicer 2.9 also turns every
// `<component>` of a non-PrusaSlicer 3MF into its own object (Format/3mf.cpp _create_object_instance at
// version_2.9.2), so a hole cutter arrived as a solid object printed beside the model, painted like it.
//
// PrusaSlicer's own form for a multi-part object is ONE mesh object holding every part's triangles, with
// Metadata/Slic3r_PE_model.config naming each part's triangle range and its `volume_type`
// (_generate_volumes in the same file; ModelVolume::type_from_string). So an object that has any
// non-model part is flattened into that form: each component's vertices go through its transform,
// parts keep their names and kinds, and only MODEL parts are painted. Objects made only of model parts
// are left exactly as before, the shape PrusaSlicer 2.9.6 was checked against.
const PRUSA_VOLUME_TYPE: Record<string, string> = {
  normal_part: "ModelPart",
  modifier_part: "ParameterModifier",
  negative_part: "NegativeVolume",
  support_blocker: "SupportBlocker",
  support_enforcer: "SupportEnforcer",
};

/** What the PrusaSlicer project could not carry over, for the user to be told. */
export type PrusaUntranslated = "per_height_colors" | "height_ranges" | "part_settings";

type PartInfo = { subtype: string; name: string; extruder?: number; settings: boolean };

/** model_settings.config parts by "objectId/partId": kind, name, extruder, and whether it sets anything else. */
function readParts(entries: Record<string, Uint8Array>): Map<string, PartInfo> {
  const parts = new Map<string, PartInfo>();
  const entry = Object.entries(entries).find(([p]) => p.toLowerCase().endsWith("model_settings.config"));
  if (!entry) return parts;
  const IDENTITY = /^(name|extruder|matrix|source_.*)$/;
  for (const om of strFromU8(entry[1]).matchAll(/<object id="(\d+)"[^>]*>([\s\S]*?)<\/object>/g)) {
    for (const pm of om[2].matchAll(/<part id="(\d+)"([^>]*)>([\s\S]*?)<\/part>/g)) {
      const subtype = /subtype="([^"]+)"/.exec(pm[2])?.[1] ?? "normal_part";
      const meta = [...pm[3].matchAll(/<metadata key="([^"]+)" value="([^"]*)"/g)];
      const ext = meta.find((m) => m[1] === "extruder")?.[2];
      parts.set(`${om[1]}/${pm[1]}`, {
        subtype,
        name: meta.find((m) => m[1] === "name")?.[2] ?? "",
        extruder: ext ? parseInt(ext, 10) : undefined,
        settings: meta.some((m) => !IDENTITY.test(m[1])),
      });
    }
  }
  return parts;
}

const OBJECT_RE = /<object id="(\d+)"([^>]*)>([\s\S]*?)<\/object>/g;
const xmlAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** Apply a 3MF row-major 3×4 transform ("m00 m01 m02 m10 … m32") to a point. */
function transformPoint(t: number[] | null, x: number, y: number, z: number): [number, number, number] {
  if (!t) return [x, y, z];
  return [x * t[0] + y * t[3] + z * t[6] + t[9], x * t[1] + y * t[4] + z * t[7] + t[10], x * t[2] + y * t[5] + z * t[8] + t[11]];
}

/** Centre of a Bambu/Orca `printable_area` polygon, or null. */
function areaCentre(area: unknown): [number, number] | null {
  if (!Array.isArray(area) || !area.length) return null;
  const pts = area.map((p) => String(p).split("x").map(Number)).filter((p) => p.length === 2 && p.every(Number.isFinite));
  if (!pts.length) return null;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

/** The minimal project config: the preset to resolve against, and the colours on each tool. */
export function prusaProjectConfig(machine: Machine, colours: string[], types: string[]): string {
  const n = Math.max(1, machine.toolheads);
  const pad = <T,>(a: T[], fill: T) => Array.from({ length: n }, (_, i) => a[i] ?? fill);
  const cols = pad(colours.map(normalizeHex), "#FFFFFF");
  const tys = pad(types, "PLA");
  const { x, y, z } = machine.bed;
  const lines = [
    `; generated by BedReady for ${machine.name}: identity and colours only; the preset supplies the rest`,
    `; printer_settings_id = ${machine.printerSettingsId ?? machine.name}`,
    ...(machine.printerModel ? [`; printer_model = ${machine.printerModel}`] : []),
    ...(machine.printerVariant ? [`; printer_variant = ${machine.printerVariant}`] : []),
    `; bed_shape = 0x0,${x}x0,${x}x${y},0x${y}`,
    `; max_print_height = ${z}`,
    `; nozzle_diameter = ${pad<number>([], machine.nozzle).join(",")}`,
    `; extruder_colour = ${cols.join(";")}`,
    `; filament_colour = ${cols.join(";")}`,
    `; filament_type = ${tys.join(";")}`,
  ];
  return lines.join("\n") + "\n";
}


/** Settings in model_settings.config beyond a part's kind, name and filament (layer height, infill …). */
function hasObjectSettings(entries: Record<string, Uint8Array>): boolean {
  const entry = Object.entries(entries).find(([p]) => p.toLowerCase().endsWith("model_settings.config"));
  if (!entry) return false;
  for (const om of strFromU8(entry[1]).matchAll(/<object id="\d+"[^>]*>([\s\S]*?)<\/object>/g)) {
    const own = om[1].replace(/<part\b[\s\S]*?<\/part>/g, "");
    for (const m of own.matchAll(/<metadata key="([^"]+)"/g)) if (!/^(name|extruder|matrix|source_.*)$/.test(m[1])) return true;
  }
  return false;
}

/**
 * The project's entries. Geometry files are rewritten (explicit, remapped, Prusa-named paint), Bambu
 * metadata is dropped, and Metadata/Slic3r_PE.config is added. Everything else passes through.
 * `untranslated` lists what the source carried that the project could not, so the user can be told.
 */
export function toPrusaProject(
  entries: Record<string, Uint8Array>,
  machine: Machine,
  input: PrusaProjectInput,
): { out: Record<string, Uint8Array>; removed: string[]; painted: boolean; untranslated: PrusaUntranslated[] } {
  const slots = Math.max(1, machine.toolheads);
  const blends = (input.blends ?? []).slice(0, Math.max(0, MAX_PAINT_STATE - slots));
  const toSlot = (filament: number): number => {
    // 1-based source filament → 1-based target tool or virtual extruder, clamped onto what exists.
    const s = input.map ? (input.map[filament - 1] ?? 0) + 1 : filament;
    return Math.min(Math.max(1, s), slots + blends.length);
  };
  const baseOf = baseFilaments(entries, readExtruders(entries));
  const parts = readParts(entries);

  // What is dropped with Metadata/: say so instead of losing it silently. Per-height colour changes
  // (custom_gcode_per_layer.xml) and height-range settings (layer_config_ranges.xml) are kept in
  // Bambu's dialect, with Orca option names and object numbering PrusaSlicer reads differently, so
  // they are not translated; neither are per-object or per-part settings.
  const untranslated = new Set<PrusaUntranslated>();
  for (const [path, data] of Object.entries(entries)) {
    const base = path.toLowerCase().split("/").pop() ?? "";
    if (base === "custom_gcode_per_layer.xml" && /<layer\b/.test(strFromU8(data))) untranslated.add("per_height_colors");
    if (base === "layer_config_ranges.xml" && /<range\b/.test(strFromU8(data))) untranslated.add("height_ranges");
  }
  if ([...parts.values()].some((p) => p.settings) || hasObjectSettings(entries)) untranslated.add("part_settings");

  // One triangle, painted for PrusaSlicer: every state remapped, and an unpainted face given its part's
  // filament explicitly. Linear on purpose: `([^>]*?)\s*\/>` let both halves match whitespace, so a run
  // of spaces with no "/>" backtracked quadratically — a 903-byte file held the main thread 15 s
  // (2026-10-02 review).
  const PAINT_ATTR = /\s(?:paint_color|slic3rpe:mmu_segmentation)="[0-9A-Fa-f]*"/g;
  const paintTriangle = (rawAttrs: string, base: number): string => {
    const attrs = rawAttrs.trimEnd();
    const stateMap = (s: number) => (s === 0 ? base : toSlot(s));
    const m = /\s(?:paint_color|slic3rpe:mmu_segmentation)="([0-9A-Fa-f]+)"/.exec(attrs);
    const code = m ? remapPaintCode(m[1], stateMap) : encodeSolidPaint(base);
    return `<triangle${attrs.replace(PAINT_ATTR, "")} slic3rpe:mmu_segmentation="${code}"/>`;
  };

  const texts: Record<string, string> = {};
  for (const [path, data] of Object.entries(entries)) if (path.toLowerCase().endsWith(".model")) texts[path] = strFromU8(data);
  const flat = flattenNonModelParts(texts, parts, baseOf, toSlot, paintTriangle);

  // Source bed centre, from project_settings.config, so items land on the target bed's centre.
  let shift: [number, number] = [0, 0];
  const ps = Object.entries(entries).find(([p]) => p.toLowerCase().endsWith("project_settings.config"));
  if (ps) {
    try {
      const c = areaCentre((JSON.parse(strFromU8(ps[1])) as Record<string, unknown>).printable_area);
      if (c) shift = [machine.bed.x / 2 - c[0], machine.bed.y / 2 - c[1]];
    } catch {
      /* malformed config: leave positions alone */
    }
  }

  const out: Record<string, Uint8Array> = {};
  const removed: string[] = [];
  let painted = flat.painted;
  for (const [path, data] of Object.entries(entries)) {
    const lower = path.toLowerCase();
    if (lower.startsWith("metadata/") && (lower.endsWith(".config") || lower.endsWith(".json") || lower.endsWith(".xml") || lower.endsWith(".gcode") || lower.endsWith(".md5"))) {
      removed.push(path); // Bambu/Orca settings, slice info, plate JSON: meaningless to PrusaSlicer
      continue;
    }
    if (!lower.endsWith(".model")) {
      out[path] = data;
      continue;
    }
    let xml = texts[path];
    const filePath = path.replace(/^\//, "");
    const isRoot = lower === "3d/3dmodel.model";
    xml = xml.replace(OBJECT_RE, (block, oid: string) => {
      if (!block.includes("<triangle")) return block; // a component wrapper: nothing to paint
      if (isRoot && flat.ids.has(oid)) return block; // flattened above, already painted part by part
      const base = toSlot(baseOf(filePath, oid));
      return block.replace(/<triangle\b([^>]*)\/>/g, (_t, rawAttrs: string) => {
        painted = true;
        return paintTriangle(rawAttrs, base);
      });
    });
    if (painted && !/xmlns:slic3rpe=/.test(xml)) {
      xml = xml.replace(/<model\b/, `<model xmlns:slic3rpe="${SLIC3RPE_NS}"`);
    }
    if (isRoot && (shift[0] || shift[1])) {
      xml = xml.replace(/<item\b([^>]*?)\btransform="([^"]+)"/g, (_m, pre: string, tr: string) => {
        const v = tr.trim().split(/\s+/).map(Number);
        if (v.length !== 12 || !v.every(Number.isFinite)) return `<item${pre}transform="${tr}"`;
        v[9] += shift[0];
        v[10] += shift[1];
        return `<item${pre}transform="${v.map((n) => +n.toFixed(6)).join(" ")}"`;
      });
    }
    out[path] = strToU8(xml);
  }
  out["Metadata/Slic3r_PE.config"] = strToU8(prusaProjectConfig(machine, input.colours, input.types));
  if (flat.config) out[PRUSA_MODEL_CONFIG] = strToU8(flat.config);
  if (blends.length) out[FULL_SPECTRUM_FILE] = strToU8(fullSpectrumJson(machine, input.colours, blends));
  return { out, removed, painted, untranslated: [...untranslated] };
}

export const PRUSA_MODEL_CONFIG = "Metadata/Slic3r_PE_model.config";

/**
 * Flatten every root object that has a non-model part into one mesh object, in place in `texts`, and
 * return the Slic3r_PE_model.config describing its volumes (see the note above PRUSA_VOLUME_TYPE).
 * Objects whose components cannot be resolved to meshes (nested components, a missing file) are left
 * alone. Each flattened object gets an id no .model file uses: PrusaSlicer looks volume metadata up by
 * bare object id across all files, so a reused id would hand these ranges to another mesh.
 */
function flattenNonModelParts(
  texts: Record<string, string>,
  parts: Map<string, PartInfo>,
  baseOf: (path: string, objectId: string) => number,
  toSlot: (filament: number) => number,
  paintTriangle: (rawAttrs: string, base: number) => string,
): { ids: Set<string>; config: string; painted: boolean } {
  const ids = new Set<string>();
  const rootPath = Object.keys(texts).find((p) => p.toLowerCase() === "3d/3dmodel.model");
  if (!rootPath || ![...parts.values()].some((p) => p.subtype !== "normal_part")) return { ids, config: "", painted: false };

  let nextId = 1;
  const refs = new Map<string, number>(); // "path#id" → how many components reference it
  const norm = (p: string) => p.replace(/^\//, "");
  for (const [path, xml] of Object.entries(texts)) {
    for (const om of xml.matchAll(OBJECT_RE)) {
      nextId = Math.max(nextId, parseInt(om[1], 10) + 1);
      for (const cm of om[3].matchAll(/<component\b([^>]*)\/>/g)) {
        const key = `${norm(/p:path="([^"]+)"/.exec(cm[1])?.[1] ?? path)}#${/objectid="(\d+)"/.exec(cm[1])?.[1]}`;
        refs.set(key, (refs.get(key) ?? 0) + 1);
      }
    }
  }
  const meshOf = (path: string, oid: string): string | null => {
    const file = Object.keys(texts).find((p) => norm(p) === path);
    if (!file) return null;
    for (const om of texts[file].matchAll(OBJECT_RE)) if (om[1] === oid && om[3].includes("<mesh")) return om[3];
    return null;
  };

  const consumed = new Map<string, number>();
  const objectsXml: string[] = [];
  const renamed = new Map<string, number>();
  let painted = false;
  texts[rootPath] = texts[rootPath].replace(OBJECT_RE, (block, rid: string, attrs: string, body: string) => {
    if (!body.includes("<components")) return block;
    const comps = [...body.matchAll(/<component\b([^>]*)\/>/g)].map((cm) => ({
      path: norm(/p:path="([^"]+)"/.exec(cm[1])?.[1] ?? rootPath),
      oid: /objectid="(\d+)"/.exec(cm[1])?.[1] ?? "",
      t: (() => {
        const v = /transform="([^"]+)"/.exec(cm[1])?.[1]?.trim().split(/\s+/).map(Number);
        return v && v.length === 12 && v.every(Number.isFinite) ? v : null;
      })(),
    }));
    const kinds = comps.map((c) => parts.get(`${rid}/${c.oid}`)?.subtype ?? "normal_part");
    if (kinds.every((k) => k === "normal_part")) return block;
    const meshes = comps.map((c) => meshOf(c.path, c.oid));
    if (meshes.some((m) => m === null)) return block;

    const vertices: string[] = [];
    const triangles: string[] = [];
    const volumes: string[] = [];
    comps.forEach((c, i) => {
      const part = parts.get(`${rid}/${c.oid}`);
      const kind = kinds[i];
      const isModel = kind === "normal_part";
      const vOffset = vertices.length;
      const first = triangles.length;
      for (const vm of meshes[i]!.matchAll(/<vertex\b([^>]*)\/>/g)) {
        const num = (k: string) => parseFloat(new RegExp(`\\b${k}="([^"]+)"`).exec(vm[1])?.[1] ?? "0");
        const [x, y, z] = transformPoint(c.t, num("x"), num("y"), num("z"));
        vertices.push(`<vertex x="${+x.toFixed(6)}" y="${+y.toFixed(6)}" z="${+z.toFixed(6)}"/>`);
      }
      const base = toSlot(baseOf(c.path, c.oid));
      for (const tm of meshes[i]!.matchAll(/<triangle\b([^>]*)\/>/g)) {
        const attrs = tm[1].replace(/\b(v[123])="(\d+)"/g, (_m, k: string, n: string) => `${k}="${parseInt(n, 10) + vOffset}"`);
        // Only a model part is printed, so only a model part is painted.
        if (isModel) {
          painted = true;
          triangles.push(paintTriangle(attrs, base));
        } else {
          triangles.push(`<triangle${attrs.trimEnd().replace(/\s(?:paint_color|slic3rpe:mmu_segmentation)="[0-9A-Fa-f]*"/g, "")}/>`);
        }
      }
      if (triangles.length === first) return;
      const meta = [
        `<metadata type="volume" key="name" value="${xmlAttr(part?.name || `part ${c.oid}`)}"/>`,
        `<metadata type="volume" key="volume_type" value="${PRUSA_VOLUME_TYPE[kind] ?? "ModelPart"}"/>`,
        ...(kind === "modifier_part" && part?.extruder ? [`<metadata type="volume" key="extruder" value="${toSlot(part.extruder)}"/>`] : []),
      ];
      volumes.push(`  <volume firstid="${first}" lastid="${triangles.length - 1}">\n   ${meta.join("\n   ")}\n  </volume>`);
      const key = `${c.path}#${c.oid}`;
      consumed.set(key, (consumed.get(key) ?? 0) + 1);
    });
    if (!volumes.length) return block;
    const id = nextId++;
    renamed.set(rid, id);
    ids.add(String(id));
    objectsXml.push(` <object id="${id}" instances_count="1">\n${volumes.join("\n")}\n </object>`);
    return `<object id="${id}"${attrs}><mesh><vertices>${vertices.join("")}</vertices><triangles>${triangles.join("")}</triangles></mesh></object>`;
  });
  if (!renamed.size) return { ids, config: "", painted: false };
  texts[rootPath] = texts[rootPath].replace(/(<item\b[^>]*?\bobjectid=")(\d+)(")/g, (m, a: string, n: string, b: string) =>
    renamed.has(n) ? `${a}${renamed.get(n)}${b}` : m,
  );
  // A part mesh referenced only by flattened objects now lives inside them; left in its file it would
  // load as an extra object.
  for (const [key, n] of consumed) {
    if (refs.get(key) !== n) continue;
    const [path, oid] = [key.slice(0, key.lastIndexOf("#")), key.slice(key.lastIndexOf("#") + 1)];
    const file = Object.keys(texts).find((p) => norm(p) === path);
    if (file) texts[file] = texts[file].replace(OBJECT_RE, (block, id: string) => (id === oid ? "" : block));
  }
  const config = `<?xml version="1.0" encoding="UTF-8"?>\n<config>\n${objectsXml.join("\n")}\n</config>\n`;
  return { ids, config, painted };
}
