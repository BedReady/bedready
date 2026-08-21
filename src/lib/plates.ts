// Per-plate extraction for .3mf files too big to open whole.
//
// A multi-plate project (a poster kit, a model split across 18 build plates) can be 228 MB
// compressed / 1.14 GB inflated, far past what a browser tab can hold. But each PLATE is small:
// in the file that prompted this, the largest is 240 MB inflated and the smallest 13.5 MB.
//
// The trick that makes this cheap: fflate's `filter` runs BEFORE decompression, so entries we
// reject cost nothing but their local header. Reading the full plate layout of that 228 MB file
// inflates 80 KB and takes ~3 ms — everything needed to show a plate picker, without ever holding
// the geometry.
//
// STRUCTURE (Bambu/Orca "production extension" layout):
//   3D/3dmodel.model            root: <object id=N><components><component p:path="/3D/Objects/object_M.model">
//                               plus <build><item objectid=N>
//   3D/Objects/object_M.model   the actual geometry, one file per object — the big ones
//   3D/_rels/3dmodel.model.rels a Relationship per object part
//   Metadata/model_settings.config  <plate> blocks whose model_instance object_id refers to the
//                               ROOT object id (N), NOT the object_M.model filename. Conflating
//                               those two silently mismaps plates — it made half of them measure 0 MB
//                               on my first pass at this.
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";

export type PlateInfo = {
  /** 1-based plater_id from model_settings.config. */
  index: number;
  name: string;
  /** Root-model object ids on this plate. */
  objectIds: number[];
  /** The 3D/Objects/*.model parts those objects point at. */
  paths: string[];
  /** Uncompressed bytes of those parts — what opening this plate alone would cost. */
  bytes: number;
};

const ROOT = "3D/3dmodel.model";
const ROOT_RELS = "3D/_rels/3dmodel.model.rels";
const MODEL_SETTINGS = "Metadata/model_settings.config";
const PROJECT_SETTINGS = "Metadata/project_settings.config";

/** Entries small enough to always inflate: everything except the geometry parts and thumbnails. */
const META_ENTRY = new RegExp(
  `^(\\[Content_Types\\]\\.xml|_rels/\\.rels|${ROOT}|${ROOT_RELS}|Metadata/(model_settings|project_settings|slice_info)\\.config)$`,
);

/** Read every entry's uncompressed size without inflating any of it. */
function entrySizes(bytes: Uint8Array): Map<string, number> {
  const sizes = new Map<string, number>();
  unzipSync(bytes, {
    filter: (f) => {
      sizes.set(f.name, f.originalSize || 0);
      return false; // reject everything: we only wanted the headers
    },
  });
  return sizes;
}

/** Map root object id -> the /3D/Objects/*.model part it references. */
function objectParts(rootXml: string): Map<number, string> {
  const out = new Map<number, string>();
  // <object id="2" ...> … <component p:path="/3D/Objects/object_1.model" …/> … </object>
  for (const m of rootXml.matchAll(/<object\b[^>]*\bid="(\d+)"[\s\S]*?<\/object>/g)) {
    const id = Number(m[1]);
    const path = m[0].match(/\bp:path="\/?([^"]+\.model)"/i)?.[1];
    if (path) out.set(id, path.replace(/^\/+/, ""));
  }
  return out;
}

/**
 * List the plates in a .3mf without inflating its geometry.
 *
 * Deliberately does NOT go through safeUnzip: that inflates everything and would reject the very
 * files this exists to rescue. Nothing here decompresses a geometry part, so there's no zip-bomb
 * exposure — the cost is bounded by the metadata entries, which are kilobytes.
 */
export function peekPlates(bytes: Uint8Array): PlateInfo[] {
  const meta = unzipSync(bytes, { filter: (f) => META_ENTRY.test(f.name) });
  const settings = meta[MODEL_SETTINGS];
  const root = meta[ROOT];
  if (!settings || !root) return [];

  const parts = objectParts(strFromU8(root));
  const sizes = entrySizes(bytes);
  const xml = strFromU8(settings);

  const plates: PlateInfo[] = [];
  for (const block of xml.matchAll(/<plate>([\s\S]*?)<\/plate>/g)) {
    const body = block[1];
    const index = Number(body.match(/key="plater_id"\s+value="(\d+)"/)?.[1] ?? plates.length + 1);
    const name = body.match(/key="plater_name"\s+value="([^"]*)"/)?.[1] || "";
    const objectIds = [...body.matchAll(/key="object_id"\s+value="(\d+)"/g)].map((m) => Number(m[1]));
    const paths = [...new Set(objectIds.map((id) => parts.get(id)).filter((p): p is string => !!p))];
    plates.push({
      index,
      name,
      objectIds,
      paths,
      bytes: paths.reduce((s, p) => s + (sizes.get(p) ?? 0), 0),
    });
  }
  return plates;
}

/** Keep only the XML blocks whose id attribute is in `keep`. */
function filterBlocks(xml: string, tag: string, attr: string, keep: Set<number>): string {
  const re = new RegExp(`<${tag}\\b[^>]*\\b${attr}="(\\d+)"(?:[\\s\\S]*?<\\/${tag}>|[^>]*\\/>)`, "g");
  return xml.replace(re, (m, id) => (keep.has(Number(id)) ? m : ""));
}

// ---------------------------------------------------------------------------
// Re-seating an extracted plate on the bed
//
// A multi-plate project lays its plates out side by side in ONE world coordinate space — plate 1
// near the origin, the rest marching off across a virtual table. Pull plate 6 out on its own and it
// keeps the world position it had in that layout, which is nowhere near the single bed of the file
// you just made.
//
// Measured on the file that exposed this (Small Spiderman colored.3mf, plate 6): the extracted model
// landed at Y -287.5 .. -68.4 against a printable Y of 1 .. 271 — entirely behind the bed. The
// package was valid, the geometry complete, every relationship resolved, and Orca opened it happily
// and showed nothing it could print. None of the structural checks notice this, because nothing about
// the file is malformed; it is simply in the wrong place.
// ---------------------------------------------------------------------------

type Bounds = { lo: [number, number, number]; hi: [number, number, number] };

/**
 * Bounding box of a .model part, scanned in chunks.
 *
 * Never turns the part into one JS string: these reach 250 MB, and decoding that whole is both a
 * memory spike and (past ~512 MB) a hard V8 limit. Decodes 8 MB at a time, carrying a short tail so
 * a <vertex> split across the boundary is not missed.
 */
function partBounds(part: Uint8Array): Bounds | null {
  const dec = new TextDecoder("utf-8");
  const re = /<vertex\s+x="([-\d.eE+]+)"\s+y="([-\d.eE+]+)"\s+z="([-\d.eE+]+)"/g;
  const lo: [number, number, number] = [Infinity, Infinity, Infinity];
  const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let seen = 0;
  let tail = "";
  const CHUNK = 8 * 1024 * 1024;
  for (let off = 0; off < part.length; off += CHUNK) {
    const s = tail + dec.decode(part.subarray(off, Math.min(off + CHUNK, part.length)), { stream: true });
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    let last = 0;
    while ((m = re.exec(s))) {
      const v = [Number(m[1]), Number(m[2]), Number(m[3])];
      for (let i = 0; i < 3; i++) {
        if (v[i] < lo[i]) lo[i] = v[i];
        if (v[i] > hi[i]) hi[i] = v[i];
      }
      seen++;
      last = re.lastIndex;
    }
    // 200 chars comfortably spans one <vertex .../> element.
    tail = s.slice(Math.max(last, s.length - 200));
  }
  return seen ? { lo, hi } : null;
}

/** 3MF item transforms are 12 numbers: a column-major 3x3 followed by the translation. */
function parseTransform(t: string | undefined): number[] {
  const n = (t ?? "").trim().split(/\s+/).map(Number);
  return n.length === 12 && n.every(Number.isFinite) ? n : [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
}

function applyTransform(t: number[], p: number[]): number[] {
  return [
    t[0] * p[0] + t[3] * p[1] + t[6] * p[2] + t[9],
    t[1] * p[0] + t[4] * p[1] + t[7] * p[2] + t[10],
    t[2] * p[0] + t[5] * p[1] + t[8] * p[2] + t[11],
  ];
}

/** World-space XY box of a local box under `t`, by transforming all eight corners. */
function worldBox(t: number[], b: Bounds): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const x of [b.lo[0], b.hi[0]]) {
    for (const y of [b.lo[1], b.hi[1]]) {
      for (const z of [b.lo[2], b.hi[2]]) {
        const w = applyTransform(t, [x, y, z]);
        if (w[0] < minX) minX = w[0];
        if (w[0] > maxX) maxX = w[0];
        if (w[1] < minY) minY = w[1];
        if (w[1] > maxY) maxY = w[1];
      }
    }
  }
  return { minX, maxX, minY, maxY };
}

/**
 * Centre of the source file's own printable area, e.g. ["0.5x1","270.5x1","270.5x271","0.5x271"].
 *
 * The SOURCE bed, deliberately, not the U1's: extraction happens before the user chooses an output,
 * and one of the choices is a generic 3MF for some other printer. Re-seating on the bed the file was
 * authored for is the neutral move, and every bed we retarget to is at least that big.
 */
function bedCentre(settings: Uint8Array | undefined): { x: number; y: number } | null {
  if (!settings) return null;
  try {
    const area = (JSON.parse(strFromU8(settings)) as { printable_area?: string[] }).printable_area;
    if (!Array.isArray(area) || !area.length) return null;
    const pts = area
      .map((p) => String(p).split("x").map(Number))
      .filter((p) => p.length === 2 && p.every(Number.isFinite));
    if (!pts.length) return null;
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  } catch {
    return null;
  }
}

/**
 * Shift every kept build item so the group sits centred on the bed.
 *
 * One shared delta rather than centring each object, so a plate holding several parts keeps the
 * arrangement the author gave it. Returns the root XML unchanged if anything needed is missing —
 * a plate in the wrong place still prints once you move it, whereas a botched transform does not.
 */
function reseatOnBed(
  rootXml: string,
  keepIds: Set<number>,
  parts: Map<number, string>,
  entries: Record<string, Uint8Array>,
  centre: { x: number; y: number } | null,
): string {
  if (!centre) return rootXml;

  const items = [...rootXml.matchAll(/<item\b[^>]*\bobjectid="(\d+)"[^>]*\/>/g)]
    .filter((m) => keepIds.has(Number(m[1])));
  if (!items.length) return rootXml;

  const boundsCache = new Map<string, Bounds | null>();
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const m of items) {
    const path = parts.get(Number(m[1]));
    const part = path ? entries[path] : undefined;
    if (!part) return rootXml;
    if (!boundsCache.has(path!)) boundsCache.set(path!, partBounds(part));
    const b = boundsCache.get(path!);
    if (!b) return rootXml;
    const box = worldBox(parseTransform(m[0].match(/\btransform="([^"]+)"/)?.[1]), b);
    minX = Math.min(minX, box.minX); maxX = Math.max(maxX, box.maxX);
    minY = Math.min(minY, box.minY); maxY = Math.max(maxY, box.maxY);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return rootXml;

  const dx = centre.x - (minX + maxX) / 2;
  const dy = centre.y - (minY + maxY) / 2;
  // Sub-millimetre corrections are noise — leave a file that was already seated alone.
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return rootXml;

  return rootXml.replace(/<item\b[^>]*\/>/g, (tag) => {
    const id = Number(tag.match(/\bobjectid="(\d+)"/)?.[1]);
    if (!keepIds.has(id)) return tag;
    const t = parseTransform(tag.match(/\btransform="([^"]+)"/)?.[1]);
    t[9] += dx;
    t[10] += dy;
    const moved = t.join(" ");
    return /\btransform="/.test(tag)
      ? tag.replace(/\btransform="[^"]+"/, `transform="${moved}"`)
      : tag.replace(/\/>$/, ` transform="${moved}"/>`);
  });
}

/**
 * Build a standalone .3mf containing just one plate.
 *
 * Only that plate's geometry parts are inflated, so peak memory is the plate — not the archive.
 * The result is an ordinary .3mf, so everything downstream (analyzeThreeMF, cleanThreeMF, the
 * preview) works on it unchanged.
 */
export function extractPlate(bytes: Uint8Array, plateIndex: number): Uint8Array {
  const plates = peekPlates(bytes);
  const plate = plates.find((p) => p.index === plateIndex);
  if (!plate) throw new Error(`plate ${plateIndex} not found`);
  if (!plate.paths.length) throw new Error(`plate ${plateIndex} has no geometry`);

  const wanted = new Set(plate.paths);
  const entries = unzipSync(bytes, {
    filter: (f) => META_ENTRY.test(f.name) || wanted.has(f.name),
  });

  const keepIds = new Set(plate.objectIds);
  const out: Record<string, Uint8Array> = {};

  // Root model: keep only this plate's objects and their build items, then move what's left onto
  // the bed — see reseatOnBed. Without that the plate keeps its position in the multi-plate layout
  // and lands off the printable area, in a file that is otherwise perfectly valid.
  const rootXml = strFromU8(entries[ROOT]);
  const kept = filterBlocks(filterBlocks(rootXml, "object", "id", keepIds), "item", "objectid", keepIds);
  out[ROOT] = strToU8(
    reseatOnBed(kept, keepIds, objectParts(rootXml), entries, bedCentre(entries[PROJECT_SETTINGS])),
  );

  // Relationships are pruned LAST, against the finished package — see pruneRels.


  // model_settings: this plate only, and only its objects.
  //
  // The surviving plate is renumbered to 1. It used to keep its original plater_id, so extracting
  // plate 6 produced a project whose only plate announced itself as the sixth — and its thumbnail
  // metadata still named Metadata/plate_6.png and friends, none of which are in the package. Those
  // are plain metadata values rather than OPC relationships, so pruneRels never saw them.
  const ms = strFromU8(entries[MODEL_SETTINGS]);
  out[MODEL_SETTINGS] = strToU8(
    filterBlocks(ms, "object", "id", keepIds)
      .replace(/<plate>[\s\S]*?<\/plate>/g, (m) =>
        new RegExp(`key="plater_id"\\s+value="${plateIndex}"`).test(m) ? m : "",
      )
      .replace(/(<metadata\s+key="plater_id"\s+value=")\d+(")/, "$11$2")
      .replace(/\s*<metadata\s+key="(thumbnail_file|thumbnail_no_light_file|top_file|pick_file)"[^>]*\/>/g, "")
      // THE ONE THAT ACTUALLY BROKE ORCA. <assemble> lists every object in the ORIGINAL project as
      // <assemble_item object_id="N"> — a different tag AND a different attribute name from
      // <object id="N">, so filterBlocks never touched it. Every extracted plate therefore declared
      // an assembly of all 18 objects while containing one, Orca resolved that list, found nothing,
      // and reported "The file does not contain any geometry data" — before it ever looked at a mesh.
      // Which is why inlining the geometry and rewriting the root both changed nothing.
      .replace(/<assemble_item\b[^>]*\/>/g, (m) =>
        keepIds.has(Number(m.match(/\bobject_id="(\d+)"/)?.[1])) ? m : "",
      )
      .replace(/\s*<assemble>\s*<\/assemble>/g, ""),
  );

  for (const [name, data] of Object.entries(entries)) {
    if (name === ROOT || name === MODEL_SETTINGS) continue;
    out[name] = data; // content types, .rels, project_settings, slice_info, and the plate's parts
  }

  // Drop every relationship whose target didn't make it into this package.
  //
  // This is what broke Snapmaker Orca with "The file does not contain any geometry data." The
  // geometry was fine — root object, build item and part were all present and our own parser read it
  // happily. But _rels/.rels still advertised Metadata/plate_1.png thumbnails that we'd dropped, and
  // an OPC package with dangling relationship targets is malformed, so Orca rejected the archive
  // before it ever looked for a mesh.
  //
  // Applied to EVERY .rels file against the final entry set, rather than hand-pruning one of them:
  // the failure mode is silent (a valid-looking zip that no slicer will open), so the invariant
  // belongs in one place that can't drift from what we actually ship.
  const present = new Set(Object.keys(out));
  for (const name of present) {
    if (!name.endsWith(".rels")) continue;
    out[name] = strToU8(pruneRels(strFromU8(out[name]), present));
  }

  // …and the same rule for the root model's own thumbnail pointers, which are plain metadata rather
  // than relationships and so survived every version of the check above. See pruneMissingThumbnails.
  out[ROOT] = strToU8(pruneMissingThumbnails(strFromU8(out[ROOT]), present));

  return zipSync(out, { level: 6 });
}

/**
 * Drop `<metadata name="Thumbnail_*">/Metadata/plate_1.png</metadata>` when that file isn't here.
 *
 * The third place this same defect turned up. First it was `_rels/.rels` still advertising dropped
 * thumbnails; then `model_settings.config` naming plate_6.png and friends; and finally the root model
 * itself, which carries its own Thumbnail_Middle / Thumbnail_Small pointers. Each time the fix was
 * scoped to the file where the bug was found rather than to the rule, so the bug simply moved.
 *
 * THE RULE, stated once: an extracted package must not reference a part it does not contain —
 * anywhere, in any syntax, not only in relationships.
 */
export function pruneMissingThumbnails(xml: string, present: Set<string>): string {
  return xml.replace(
    /\s*<metadata\s+name="Thumbnail_[^"]*"\s*>([^<]*)<\/metadata>/g,
    (m, target: string) => (present.has(target.trim().replace(/^\/+/, "")) ? m : ""),
  );
}

/** Remove <Relationship> elements pointing at parts that aren't in `present`. */
export function pruneRels(xml: string, present: Set<string>): string {
  return xml.replace(/<Relationship\b[^>]*?(?:\/>|<\/Relationship>)/g, (m) => {
    const t = m.match(/Target="([^"]+)"/)?.[1];
    if (!t) return m;
    // Targets are usually package-absolute ("/Metadata/x.png"); relative ones resolve to the root
    // here because every .rels we emit sits one level under a folder we keep.
    return present.has(t.replace(/^\/+/, "")) ? m : "";
  });
}
