// Bambu/OrcaSlicer "paint_color" triangle-paint codec + mesh extraction.
// Codec verified by round-tripping all distinct codes in real files (0 failures).
import { unzipSync, strFromU8, strToU8 } from "fflate";

export function normalizeHex(h: string): string {
  const s = (h || "").replace("#", "");
  return s.length >= 6 ? "#" + s.slice(0, 6).toUpperCase() : "#FFFFFF";
}

// ---------- paint codec ----------

// The slicer (Orca/Bambu/Prusa, FacetsAnnotation::get_triangle_as_string) emits ONE hex digit per
// 4-bit nibble, LSB-first within the nibble, and PREPENDS each digit — so the string is the nibbles
// in reverse order, read right-to-left. Match that exactly (an earlier byte-pair version corrupted
// any code with an odd number of nibbles). Verified against the C++ in src/libslic3r/Model.cpp.
function hexToBits(h: string): number[] {
  const bits: number[] = [];
  for (let j = h.length - 1; j >= 0; j--) {
    const d = parseInt(h[j], 16);
    for (let b = 0; b < 4; b++) bits.push((d >> b) & 1);
  }
  return bits;
}
function bitsToHex(bits: number[]): string {
  let h = "";
  for (let i = 0; i < bits.length; i += 4) {
    let nib = 0;
    for (let b = 0; b < 4 && i + b < bits.length; b++) nib |= bits[i + b] << b;
    h = nib.toString(16).toUpperCase() + h; // prepend — first nibble ends up rightmost
  }
  return h;
}

/** Encode a paint_color for a triangle painted uniformly with filament `state` (1-based, ≥1). */
export function encodeSolidPaint(state: number): string {
  const bits = [0, 0]; // ss=0 → not subdivided
  if (state >= 3) {
    bits.push(1, 1);
    for (let i = 0; i < 4; i++) bits.push((state - 3) >> i & 1);
  } else {
    bits.push(state & 1, (state >> 1) & 1);
  }
  return bitsToHex(bits);
}

/** PrusaSlicer "multi-volume" files split one mesh into per-color volumes (triangle ranges with an
 *  extruder each, in Slic3r_PE_model.config) instead of painting. Translate those volumes into
 *  paint_color on each triangle so the rest of the pipeline (preview, reduce, convert) just works.
 *  No-op for any file without that config (Bambu, or already-painted Prusa). */
export function applyPrusaVolumePaint(entries: Record<string, Uint8Array>): Record<string, Uint8Array> {
  const cfgEntry = Object.entries(entries).find(([p]) => p.toLowerCase().endsWith("slic3r_pe_model.config"));
  if (!cfgEntry) return entries;
  const cfgXml = strFromU8(cfgEntry[1]);

  type ObjInfo = { objExtruder: number; vols: { first: number; last: number; extruder: number }[] };
  const objects = new Map<number, ObjInfo>();
  for (const om of cfgXml.matchAll(/<object id="(\d+)"[^>]*>([\s\S]*?)<\/object>/g)) {
    const oid = parseInt(om[1], 10);
    const body = om[2];
    const objExtruder = parseInt(body.match(/key="extruder" value="(\d+)"/)?.[1] ?? "1", 10);
    const vols: ObjInfo["vols"] = [];
    for (const vm of body.matchAll(/<volume firstid="(\d+)" lastid="(\d+)"[^>]*>([\s\S]*?)<\/volume>/g)) {
      vols.push({ first: parseInt(vm[1], 10), last: parseInt(vm[2], 10), extruder: parseInt(vm[3].match(/key="extruder" value="(\d+)"/)?.[1] ?? String(objExtruder), 10) });
    }
    objects.set(oid, { objExtruder, vols });
  }
  const withVols = [...objects.values()].filter((o) => o.vols.length);
  if (!withVols.length) return entries; // nothing to translate
  const onlyObj = objects.size === 1 ? [...objects.values()][0] : null;

  const out: Record<string, Uint8Array> = { ...entries };
  for (const [path, data] of Object.entries(entries)) {
    if (!path.toLowerCase().endsWith(".model")) continue;
    let changed = false;
    const xml = strFromU8(data).replace(/<object id="(\d+)"([^>]*)>([\s\S]*?)<\/object>/g, (block, oidStr) => {
      const info = objects.get(parseInt(oidStr, 10)) ?? onlyObj;
      if (!info || !info.vols.length) return block;
      const extOf = (t: number): number => {
        for (const v of info.vols) if (t >= v.first && t <= v.last) return v.extruder;
        return info.objExtruder;
      };
      let t = -1;
      return block.replace(/<triangle\b([^>]*?)\s*\/>/g, (tri, attrs: string) => {
        t++;
        if (/paint_color=|mmu_segmentation=/.test(attrs)) return tri; // explicitly painted → leave it
        // Paint every face with its exact filament (no reliance on an ambiguous "base" extruder).
        changed = true;
        return `<triangle${attrs} paint_color="${encodeSolidPaint(extOf(t))}"/>`;
      });
    });
    if (changed) out[path] = strToU8(xml);
  }
  return out;
}

/** Remap every leaf state in a paint_color code using stateMap, preserving structure. */
export function remapPaintCode(hex: string, stateMap: (s: number) => number): string {
  const bits = hexToBits(hex);
  let p = 0;
  const rd = (k: number) => {
    let n = 0;
    for (let i = 0; i < k; i++) n |= (bits[p++] || 0) << i;
    return n;
  };
  const out: number[] = [];
  (function tri() {
    const ss = rd(2);
    if (ss !== 0) {
      const side = rd(2);
      out.push(ss & 1, (ss >> 1) & 1, side & 1, (side >> 1) & 1);
      for (let c = 0; c < ss + 1; c++) tri();
      return;
    }
    const lo = rd(2);
    const s = lo === 3 ? rd(4) + 3 : lo;
    const ns = stateMap(s);
    out.push(0, 0);
    if (ns >= 3) {
      out.push(1, 1);
      for (let i = 0; i < 4; i++) out.push((ns - 3) >> i & 1);
    } else {
      out.push(ns & 1, (ns >> 1) & 1);
    }
  })();
  // Per-triangle bitstreams are whole nibbles by construction (each node emits 4 or 8 bits); pad to a
  // nibble boundary defensively so bitsToHex never drops a partial group.
  while (out.length % 4 !== 0) out.push(0);
  return bitsToHex(out);
}

/** Representative (first-leaf) state of a paint code — used for the preview's per-face color. */
export function dominantState(hex: string): number {
  const bits = hexToBits(hex);
  let p = 0;
  const rd = (k: number) => {
    let n = 0;
    for (let i = 0; i < k; i++) n |= (bits[p++] || 0) << i;
    return n;
  };
  let st = 0;
  (function tri() {
    const ss = rd(2);
    if (ss) {
      rd(2);
      for (let c = 0; c < ss + 1; c++) tri();
    } else {
      const lo = rd(2);
      const s = lo === 3 ? rd(4) + 3 : lo;
      if (st === 0) st = s;
    }
  })();
  return st;
}

// ---------- mesh extraction (for the colored preview) ----------

export type MeshData = {
  positions: Float32Array; // non-indexed: 9 floats (3 verts) per face (empty if skipped) — MILLIMETRES
  /** Millimetres per unit of the SOURCE file (`<model unit>`; 1 for the usual millimetre document).
   *  `positions` are already scaled by this. Anything computing a value in mm and writing it BACK
   *  into the original file — a bed-centering offset, say — has to divide by it first. */
  mmPerUnit: number;
  faceState: Uint8Array; // filament state per face (0 = base) (empty if skipped)
  palette: string[]; // filament colors, normalized
  usage: number[]; // faces per palette index (state-1)
  statesPresent: number[]; // distinct non-zero states actually used
  baseState: number;
  triangleCount: number; // total triangles in the model (set even when skipped)
  skipped: boolean; // true = too big even to sample; positions/faceState are empty
  sampled: boolean; // true = preview shows a representative subset (full model still converts)
  // One entry per placed part (build item). positions/faceState are zero-copy views into the
  // aggregate arrays above, so the UI can show one part at a time. Single-part files → one entry.
  parts: { name: string; objectId: number; positions: Float32Array; faceState: Uint8Array; triangleCount: number }[];
  // Plate grouping from model_settings (<plate> → object ids). Each entry indexes into `parts`.
  // Empty / single entry when the file isn't organised into multiple plates.
  plates: { name: string; partIndices: number[] }[];
};

/** Triangles we actually render. Bigger models are SAMPLED down to this (every Nth triangle) so the
 *  preview shows the shape + colours without the full memory/parse cost — the full model still converts. */
export const PREVIEW_BUDGET = 2_000_000;
/** Above this, even decoding/parsing is impractical (huge XML string) — skip the preview entirely. */
export const HARD_CAP = 30_000_000;
export const DEFAULT_MAX_FACES = PREVIEW_BUDGET; // back-compat alias

const TRI_RE = /<triangle[ />]/g; // matches <triangle .../> but not the <triangles> container

// 3MF transforms are 12 numbers (a 4×3 affine, row-vector convention): a point [x y z 1] maps as
// x' = a·x + d·y + g·z + tx, etc. We carry them as 4×4 row-major matrices so nested
// build-item ∘ component transforms compose with a plain matrix multiply.
const IDENTITY4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function transform12to16(t: number[]): number[] {
  if (t.length < 12) return IDENTITY4.slice();
  // prettier-ignore
  return [t[0], t[1], t[2], 0, t[3], t[4], t[5], 0, t[6], t[7], t[8], 0, t[9], t[10], t[11], 1];
}
function matMul(A: number[], B: number[]): number[] {
  const R = new Array(16);
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += A[r * 4 + k] * B[k * 4 + c];
      R[r * 4 + c] = s;
    }
  return R;
}
const attr = (s: string, name: string) => s.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`))?.[1];

// 3MF's <model> carries a `unit`, and it is not always millimetres — the core spec allows micron,
// centimeter, inch, foot and meter, and CAD exporters use them. Nothing here read it, so every
// vertex was treated as millimetres and every number derived from geometry inherited the error:
// a 12×12×6 INCH box (305×305×152 mm, far past the U1's bed) measured "12×12×6" and was told it
// fit, while a 200 mm part written in microns measured 200000 and was told it was too big.
// Band z-values are worse still — buildBandSwapPlan compares them against the slicer's
// layer_height, which is millimetres, so a mismatched unit makes the pause layers meaningless.
//
// Normalising here fixes all of it at once: every consumer of MeshData is downstream of this.
// The spec's default when the attribute is absent is millimetre.
const UNIT_MM: Record<string, number> = {
  micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000,
};
/** Millimetres per unit of the document's declared `unit`. Unknown or absent → 1 (millimetre). */
export function unitScale(unit: string | undefined): number {
  return UNIT_MM[(unit ?? "").trim().toLowerCase()] ?? 1;
}
const stripSlash = (p: string) => p.replace(/^\//, "");

type GeomObject = { mesh?: string; triCount?: number; comps?: { path: string; objectid: number; transform: number[] }[] };

/** Parse geometry + per-face paint color from raw .3mf bytes. Synchronous + Worker-safe (no three).
 *  Walks the real 3MF object graph — build items → objects → (cross-file) components — composing
 *  each transform so multi-part assemblies and repeated instances land in their true positions.
 *  Counts triangles first; samples down to `maxFaces` for big models, skips above `hardCap`. */
/** PrusaSlicer "Full Spectrum" (ColorMix): read Prusa_Slicer_full_spectrum.json into a colour-by-state
 *  palette. Physical + virtual extruders each carry a target `color`; `id` (1-based) is the paint state.
 *  Returns palette[id-1] = colour, or null when the file isn't a full-spectrum project. */
export function paletteFromFullSpectrum(entries: Record<string, Uint8Array>): string[] | null {
  const ent = Object.entries(entries).find(([p]) => /full_spectrum\.json$/i.test(p));
  if (!ent) return null;
  try {
    const o = JSON.parse(strFromU8(ent[1])) as {
      physical_extruders?: { color?: string; id?: number }[];
      virtual_extruders?: { color?: string; id?: number }[];
    };
    const all = [...(o.physical_extruders ?? []), ...(o.virtual_extruders ?? [])].filter((e) => e.id && e.color);
    if (!all.length) return null;
    const maxId = Math.max(...all.map((e) => e.id!));
    const pal = new Array<string>(maxId).fill("#FFFFFF");
    for (const e of all) pal[e.id! - 1] = normalizeHex(e.color!);
    return pal;
  } catch {
    return null;
  }
}

/** The exact mix recipe for each virtual (mixed) colour in a Full Spectrum file: state id → its component
 *  base extruders (1-based) + ratios. Lets the converter reproduce the author's colours precisely instead
 *  of re-deriving an approximate mix. */
export function recipesFromFullSpectrum(entries: Record<string, Uint8Array>): Map<number, { extruder: number; ratio: number }[]> | null {
  const ent = Object.entries(entries).find(([p]) => /full_spectrum\.json$/i.test(p));
  if (!ent) return null;
  try {
    const o = JSON.parse(strFromU8(ent[1])) as { virtual_extruders?: { id?: number; components?: { extruder?: number; ratio?: number }[] }[] };
    const m = new Map<number, { extruder: number; ratio: number }[]>();
    for (const v of o.virtual_extruders ?? []) {
      if (!v.id || !Array.isArray(v.components)) continue;
      const comps = v.components.filter((c) => c.extruder && c.ratio != null).map((c) => ({ extruder: c.extruder!, ratio: c.ratio! }));
      if (comps.length) m.set(v.id, comps);
    }
    return m.size ? m : null;
  } catch {
    return null;
  }
}

export function extractMeshFromBuffer(buf: Uint8Array, maxFaces = PREVIEW_BUDGET, hardCap = HARD_CAP): MeshData {
  const entries = applyPrusaVolumePaint(unzipSync(buf)); // translate Prusa multi-volume → paint

  let palette: string[] = [];
  let prusaPalette: string[] = []; // fallback from Slic3r_PE.config (Prusa has no project_settings)
  let baseState = 1; // global fallback base extruder
  // model_settings carries the base (unpainted-face) colour + name per object, keyed by total face
  // count (object ids there don't reliably match the geometry ids across slicer versions).
  const faceCountToExtr = new Map<number, number>();
  const faceCountToName = new Map<number, string>();
  // Bambu/Orca "object" colouring assigns a filament per <part id="N"> in model_settings.config, and
  // that part id equals the geometry component's objectid — the robust key (face counts collide: one
  // object can hold several parts with identical face counts but different extruders). Leaf id → extruder.
  const idToExtr = new Map<number, number>();
  const plateDefs: { name: string; objectIds: number[] }[] = []; // model_settings <plate> → object ids
  // Each .model file gets its own object-id namespace (the production-extension p:path scheme).
  const files = new Map<string, Map<number, GeomObject>>();
  let buildPath = ""; // the .model that holds <build> (usually 3D/3dmodel.model)
  let mmPerUnit = 1; // set from that file's <model unit="…">; everything below emits millimetres
  const buildItems: { objectid: number; transform: number[] }[] = [];

  for (const [path, data] of Object.entries(entries)) {
    const lower = path.toLowerCase();
    const base = lower.split("/").pop() ?? "";
    if (base === "project_settings.config") {
      try {
        palette = (JSON.parse(strFromU8(data)).filament_colour ?? []).map(normalizeHex);
      } catch {
        /* ignore */
      }
    } else if (base === "slic3r_pe.config") {
      // PrusaSlicer files have no project_settings.config. Pull the palette from the INI config —
      // prefer extruder_colour when filament_colour is a single default (MMU paint references extruders).
      const text = strFromU8(data);
      const grab = (key: string): string[] => {
        const m = text.match(new RegExp(`^;?\\s*${key}\\s*=\\s*(.+)$`, "m"));
        return m ? m[1].trim().split(/[;,]/).map((s) => normalizeHex(s.trim())).filter(Boolean) : [];
      };
      const fc = grab("filament_colour");
      const ec = grab("extruder_colour");
      const distinct = (a: string[]) => new Set(a).size;
      prusaPalette = distinct(fc) >= 2 ? fc : distinct(ec) >= 2 ? ec : fc.length ? fc : ec;
    } else if (base === "model_settings.config") {
      const xml = strFromU8(data);
      const first = xml.match(/key="extruder" value="(\d+)"/);
      if (first) baseState = parseInt(first[1], 10);
      for (const om of xml.matchAll(/<object\b[^>]*>([\s\S]*?)<\/object>/g)) {
        const body = om[1];
        const ex = parseInt(body.match(/key="extruder" value="(\d+)"/)?.[1] ?? "0", 10);
        const fc = parseInt(body.match(/face_count="(\d+)"/)?.[1] ?? "0", 10); // object total (first match)
        const nm = body.match(/key="name" value="([^"]*)"/)?.[1];
        if (fc > 0) {
          if (ex > 0) faceCountToExtr.set(fc, ex);
          if (nm) faceCountToName.set(fc, nm);
        }
        // Per-part filament: <part id="N"> carries its own extruder and its id matches the geometry
        // component's objectid. A part without one inherits the object's extruder (else the base).
        for (const pm of body.matchAll(/<part\b([^>]*)>([\s\S]*?)<\/part>/g)) {
          const pid = parseInt(attr(pm[1], "id") ?? "-1", 10);
          if (pid < 0) continue;
          const pe = parseInt(pm[2].match(/key="extruder" value="(\d+)"/)?.[1] ?? "0", 10);
          idToExtr.set(pid, pe > 0 ? pe : ex > 0 ? ex : baseState);
        }
      }
      for (const pm of xml.matchAll(/<plate>([\s\S]*?)<\/plate>/g)) {
        const body = pm[1];
        const name = body.match(/key="plater_name" value="([^"]*)"/)?.[1] ?? "";
        const objectIds = [...body.matchAll(/key="object_id" value="(\d+)"/g)].map((m) => parseInt(m[1], 10));
        if (objectIds.length) plateDefs.push({ name, objectIds });
      }
    } else if (lower.endsWith(".model")) {
      const xml = strFromU8(data);
      const objs = new Map<number, GeomObject>();
      for (const om of xml.matchAll(/<object\b([^>]*)>([\s\S]*?)<\/object>/g)) {
        const id = parseInt(attr(om[1], "id") ?? "-1", 10);
        if (id < 0) continue;
        const body = om[2];
        const meshM = body.match(/<mesh>([\s\S]*?)<\/mesh>/);
        if (meshM) {
          objs.set(id, { mesh: meshM[1] });
        } else {
          const comps: GeomObject["comps"] = [];
          for (const cm of body.matchAll(/<component\b([^>]*?)\/?>/g)) {
            const oid = parseInt(attr(cm[1], "objectid") ?? "-1", 10);
            if (oid < 0) continue;
            const cp = attr(cm[1], "path");
            const tStr = attr(cm[1], "transform");
            comps.push({
              path: cp ? stripSlash(cp) : stripSlash(path),
              objectid: oid,
              transform: transform12to16(tStr ? tStr.trim().split(/\s+/).map(Number) : []),
            });
          }
          objs.set(id, { comps });
        }
      }
      files.set(stripSlash(path), objs);
      if (/<build[\s>]/.test(xml)) {
        buildPath = stripSlash(path);
        // The document's unit lives on the <model> element of the file that carries <build>. Component
        // files are part of the same document and share it, so this is read once, not per file.
        mmPerUnit = unitScale(attr(xml.match(/<model\b[^>]*>/)?.[0] ?? "", "unit"));
        for (const im of xml.matchAll(/<item\b([^>]*?)\/?>/g)) {
          const oid = parseInt(attr(im[1], "objectid") ?? "-1", 10);
          if (oid < 0) continue;
          const tStr = attr(im[1], "transform");
          buildItems.push({ objectid: oid, transform: transform12to16(tStr ? tStr.trim().split(/\s+/).map(Number) : []) });
        }
      }
    }
  }

  const triCountOf = (node: GeomObject): number => {
    if (node.triCount == null) node.triCount = node.mesh ? (node.mesh.match(TRI_RE) || []).length : 0;
    return node.triCount;
  };
  // Walk the object graph from one root, applying composed transforms; calls onLeaf for each mesh.
  const walk = (path: string, oid: number, M: number[], depth: number, onLeaf: (node: GeomObject, M: number[], oid: number) => void) => {
    if (depth > 64) return; // cycle / runaway guard
    const node = files.get(path)?.get(oid);
    if (!node) return;
    if (node.mesh != null) { onLeaf(node, M, oid); return; }
    for (const c of node.comps ?? []) walk(c.path, c.objectid, matMul(c.transform, M), depth + 1, onLeaf);
  };

  if (palette.length === 0 && prusaPalette.length) palette = prusaPalette; // PrusaSlicer file
  // PrusaSlicer "Full Spectrum" (ColorMix): the real palette is 4 physical bases + N virtual (mixed)
  // colours, listed in Prusa_Slicer_full_spectrum.json. filament_colour only carries the 4 bases, so the
  // mixed states (5+) would render wrong — use the full-spectrum palette so all colours reflect.
  const fsPal = paletteFromFullSpectrum(entries);
  if (fsPal && fsPal.length > palette.length) palette = fsPal;

  // Roots: the build items. Fall back to every mesh object at identity if the build graph is empty.
  let roots = buildItems.map((it) => ({ path: buildPath, objectid: it.objectid, transform: it.transform }));
  if (roots.length === 0) {
    roots = [];
    for (const [path, objs] of files) for (const [id, node] of objs) if (node.mesh != null) roots.push({ path, objectid: id, transform: IDENTITY4.slice() });
  }

  // Pass 1: total triangle count (across instances) + per-root base extruder + name (by face count).
  let triangleCount = 0;
  const rootBase: number[] = [];
  const rootName: string[] = [];
  for (const r of roots) {
    let n = 0;
    walk(r.path, r.objectid, r.transform, 0, (node) => { n += triCountOf(node); });
    triangleCount += n;
    rootBase.push(faceCountToExtr.get(n) ?? baseState);
    rootName.push(faceCountToName.get(n) ?? "");
  }

  const empty = (skipped: boolean): MeshData => ({
    positions: new Float32Array(0),
    mmPerUnit,
    faceState: new Uint8Array(0),
    palette,
    usage: palette.map(() => 0),
    statesPresent: [],
    baseState,
    triangleCount,
    skipped,
    sampled: false,
    parts: [],
    plates: [],
  });
  if (triangleCount === 0) return empty(false);
  if (triangleCount > hardCap) return empty(true);

  // Sample down to the render budget for big models: keep every `stride`-th triangle. Thins only the
  // PREVIEW (shape + colour distribution stay representative); the full model still converts.
  const stride = triangleCount > maxFaces ? Math.ceil(triangleCount / maxFaces) : 1;
  const cap = stride === 1 ? triangleCount : Math.ceil(triangleCount / stride);
  const positions = new Float32Array(cap * 9);
  const faceState = new Uint8Array(cap);
  let vc = 0; // float cursor into positions
  let fc = 0; // face cursor
  let gtri = 0; // global triangle index across all leaves/instances (for stride sampling)

  // Pass 2: emit each mesh leaf, transformed to world space by its composed matrix.
  const emit = (seg: string, M: number[], baseExtr: number) => {
    const nv = (seg.match(/<vertex\b/g) || []).length;
    const vx = new Float32Array(nv * 3);
    let i = 0;
    for (const m of seg.matchAll(/<vertex[^>]*\/>/g)) {
      const tag = m[0];
      const x = +(tag.match(/x="([^"]+)"/)?.[1] ?? 0);
      const y = +(tag.match(/y="([^"]+)"/)?.[1] ?? 0);
      const z = +(tag.match(/z="([^"]+)"/)?.[1] ?? 0);
      // × mmPerUnit last: the scale is uniform, so scaling world space is the same as folding it
      // into M, and it correctly scales the translation terms (an offset is in the same unit).
      vx[i++] = (x * M[0] + y * M[4] + z * M[8] + M[12]) * mmPerUnit;
      vx[i++] = (x * M[1] + y * M[5] + z * M[9] + M[13]) * mmPerUnit;
      vx[i++] = (x * M[2] + y * M[6] + z * M[10] + M[14]) * mmPerUnit;
    }
    // Iterate lazily (don't materialize all matches — would OOM on huge meshes) and stride-sample.
    for (const m of seg.matchAll(/<triangle ([^>]*?)\/>/g)) {
      if (gtri++ % stride !== 0) continue; // sampled out
      const a = m[1];
      const v1 = +(a.match(/v1="(\d+)"/)?.[1] ?? 0);
      const v2 = +(a.match(/v2="(\d+)"/)?.[1] ?? 0);
      const v3 = +(a.match(/v3="(\d+)"/)?.[1] ?? 0);
      // Bambu/Orca use paint_color; PrusaSlicer uses (slic3rpe:)mmu_segmentation — same codec.
      const pc = a.match(/(?:paint_color|mmu_segmentation)="([0-9A-Fa-f]+)"/);
      faceState[fc++] = pc ? dominantState(pc[1]) : baseExtr;
      positions[vc++] = vx[v1 * 3]; positions[vc++] = vx[v1 * 3 + 1]; positions[vc++] = vx[v1 * 3 + 2];
      positions[vc++] = vx[v2 * 3]; positions[vc++] = vx[v2 * 3 + 1]; positions[vc++] = vx[v2 * 3 + 2];
      positions[vc++] = vx[v3 * 3]; positions[vc++] = vx[v3 * 3 + 1]; positions[vc++] = vx[v3 * 3 + 2];
    }
  };

  // Emit per root, recording each part's contiguous face range so the UI can show one at a time.
  const partRanges: { name: string; objectId: number; start: number }[] = [];
  roots.forEach((r, ri) => {
    partRanges.push({ name: rootName[ri], objectId: r.objectid, start: fc });
    walk(r.path, r.objectid, r.transform, 0, (node, M, leafOid) => emit(node.mesh as string, M, idToExtr.get(leafOid) ?? rootBase[ri]));
  });
  const parts = partRanges
    .map((pr, i) => {
      const end = i + 1 < partRanges.length ? partRanges[i + 1].start : fc;
      return {
        name: pr.name,
        objectId: pr.objectId,
        positions: positions.subarray(pr.start * 9, end * 9),
        faceState: faceState.subarray(pr.start, end),
        triangleCount: end - pr.start,
      };
    })
    .filter((p) => p.triangleCount > 0); // drop parts sampled entirely out on huge models

  // Group parts into plates (by object id from model_settings). Skip when there's only one plate.
  const plates = plateDefs
    .map((pd) => ({
      name: pd.name,
      partIndices: parts.map((p, i) => (pd.objectIds.includes(p.objectId) ? i : -1)).filter((i) => i >= 0),
    }))
    .filter((pl) => pl.partIndices.length > 0);

  const usage: number[] = palette.map(() => 0);
  const present = new Set<number>();
  for (let f = 0; f < fc; f++) {
    const s = faceState[f];
    if (s >= 1) { usage[s - 1] = (usage[s - 1] ?? 0) + 1; present.add(s); }
  }

  return {
    positions: vc === positions.length ? positions : positions.subarray(0, vc),
    mmPerUnit,
    faceState: fc === faceState.length ? faceState : faceState.subarray(0, fc),
    palette,
    usage,
    statesPresent: [...present].sort((a, b) => a - b),
    baseState,
    triangleCount,
    skipped: false,
    sampled: stride > 1,
    parts,
    plates,
  };
}

/** Parse a .3mf File for the colored preview (back-compat; runs on the calling thread). */
export async function extractMesh(file: File, maxFaces?: number): Promise<MeshData> {
  return extractMeshFromBuffer(new Uint8Array(await file.arrayBuffer()), maxFaces);
}

export type OverhangReport = {
  overhangArea: number; // surface area (mm²) of unsupported steep downward faces
  totalArea: number; // total surface area sampled
  ratio: number; // overhangArea / totalArea (0..1)
  needsSupport: boolean; // ratio over the advisory cutoff → recommend supports
};

/**
 * Heuristic "does this model need supports?" check from the (possibly sampled) preview triangles —
 * for an advisory, not a slicer-accurate support generator. A face is a steep overhang when its
 * outward normal points downward more than `thresholdDeg` from vertical (normal.z < -sin(threshold)).
 * The default is 50°, not a slicer's conservative support-generation angle: FDM prints overhangs up to
 * ~45–50° cleanly (the "45° rule"), and consecutive layers self-support gentle slopes and curved
 * undersides — so a lower threshold cries wolf. Only genuinely steep, near-horizontal faces are counted.
 * Faces resting on the build plate (near min Z) are excluded — they sit on the bed, not in mid-air.
 * Area-weighted so a few big ceilings register while a sprinkle of tiny facets doesn't. 3MF winding is
 * CCW→outward, so the normal sign is meaningful. `needsSupport` trips only at ≥5% of surface area being
 * unsupported steep overhang, so a small overhang patch doesn't raise an alarm.
 */
export function overhangReport(positions: Float32Array, thresholdDeg = 50, cutoff = 0.05): OverhangReport {
  const nFaces = Math.floor(positions.length / 9);
  if (nFaces === 0) return { overhangArea: 0, totalArea: 0, ratio: 0, needsSupport: false };
  let minZ = Infinity, maxZ = -Infinity;
  for (let i = 2; i < positions.length; i += 3) {
    const z = positions[i];
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const bedEps = Math.max(0.4, (maxZ - minZ) * 0.01); // first-layer-ish band that's "on the bed"
  const sinT = Math.sin((thresholdDeg * Math.PI) / 180);
  let overhangArea = 0, totalArea = 0;
  for (let f = 0; f < nFaces; f++) {
    const o = f * 9;
    const ax = positions[o], ay = positions[o + 1], az = positions[o + 2];
    const bx = positions[o + 3], by = positions[o + 4], bz = positions[o + 5];
    const cx = positions[o + 6], cy = positions[o + 7], cz = positions[o + 8];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len === 0) continue;
    totalArea += len / 2;
    if (nz / len >= -sinT) continue; // not a steep downward-facing overhang
    if (Math.max(az, bz, cz) <= minZ + bedEps) continue; // rests on the bed, not airborne
    overhangArea += len / 2;
  }
  const ratio = totalArea > 0 ? overhangArea / totalArea : 0;
  return { overhangArea, totalArea, ratio, needsSupport: ratio >= cutoff };
}
