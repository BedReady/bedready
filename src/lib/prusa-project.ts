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
import type { Machine } from "./targets";

const SLIC3RPE_NS = "http://schemas.slic3r.org/3mf/2017/06";

export type PrusaProjectInput = {
  /** Source filament index (0-based) → target slot (0-based); null = identity. */
  map: number[] | null;
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

/**
 * The project's entries. Geometry files are rewritten (explicit, remapped, Prusa-named paint), Bambu
 * metadata is dropped, and Metadata/Slic3r_PE.config is added. Everything else passes through.
 */
export function toPrusaProject(
  entries: Record<string, Uint8Array>,
  machine: Machine,
  input: PrusaProjectInput,
): { out: Record<string, Uint8Array>; removed: string[]; painted: boolean } {
  const slots = Math.max(1, machine.toolheads);
  const toSlot = (filament: number): number => {
    // 1-based source filament → 1-based target tool, clamped onto the machine.
    const s = input.map ? (input.map[filament - 1] ?? 0) + 1 : filament;
    return Math.min(Math.max(1, s), slots);
  };
  const baseOf = baseFilaments(entries, readExtruders(entries));

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
  let painted = false;
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
    let xml = strFromU8(data);
    const filePath = path.replace(/^\//, "");
    xml = xml.replace(/<object id="(\d+)"([^>]*)>([\s\S]*?)<\/object>/g, (block, oid: string) => {
      if (!block.includes("<triangle")) return block; // a component wrapper: nothing to paint
      const base = toSlot(baseOf(filePath, oid));
      const stateMap = (s: number) => (s === 0 ? base : toSlot(s));
      return block.replace(/<triangle\b([^>]*?)\s*\/>/g, (_t, attrs: string) => {
        painted = true;
        const m = /\s(?:paint_color|slic3rpe:mmu_segmentation)="([0-9A-Fa-f]+)"/.exec(attrs);
        const rest = attrs.replace(/\s(?:paint_color|slic3rpe:mmu_segmentation)="[0-9A-Fa-f]*"/g, "");
        const code = m ? remapPaintCode(m[1], stateMap) : encodeSolidPaint(base);
        return `<triangle${rest} slic3rpe:mmu_segmentation="${code}"/>`;
      });
    });
    if (painted && !/xmlns:slic3rpe=/.test(xml)) {
      xml = xml.replace(/<model\b/, `<model xmlns:slic3rpe="${SLIC3RPE_NS}"`);
    }
    if (lower === "3d/3dmodel.model" && (shift[0] || shift[1])) {
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
  return { out, removed, painted };
}
