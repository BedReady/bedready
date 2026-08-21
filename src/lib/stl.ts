// Pure STL → 3MF port from the Bed Ready desktop app (lib/stl-parse.js + lib/mf-write.js), rewritten in
// TypeScript with no three.js dependency so it bundles small and runs anywhere (browser, node --test).
// Lets a plain STL (geometry only — no colours, no slicer profile) enter the converter pipeline by
// wrapping it as a clean core-spec 3MF that any slicer opens.
import { zipSync, strToU8 } from "fflate";

// Binary STL layout: 80-byte header + uint32 triangle count + 50 bytes/triangle (12B normal + 3×12B
// vertices + 2B attribute). We confirm binary by matching the declared count to the byte length — ASCII
// STLs can falsely begin with "solid", so the exact size check is the reliable discriminator.
function looksBinary(dv: DataView): boolean {
  if (dv.byteLength < 84) return false;
  const count = dv.getUint32(80, true);
  return dv.byteLength === 84 + count * 50;
}

function parseBinary(dv: DataView): Float32Array {
  const count = dv.getUint32(80, true);
  // Guard the allocation: a malformed/non-STL buffer can carry a bogus count (up to ~4B) which would
  // blow up `new Float32Array` (RangeError/OOM) and then index past the buffer. The declared triangles
  // must fit the file (header + count×50). Trailing bytes are fine (>=), a short buffer is not.
  if (84 + count * 50 > dv.byteLength) throw new Error("parseStl: STL triangle count exceeds file size");
  const out = new Float32Array(count * 9);
  let off = 84;
  let o = 0;
  for (let i = 0; i < count; i++) {
    off += 12; // skip the facet normal
    for (let k = 0; k < 3; k++) {
      out[o++] = dv.getFloat32(off, true);
      out[o++] = dv.getFloat32(off + 4, true);
      out[o++] = dv.getFloat32(off + 8, true);
      off += 12;
    }
    off += 2; // 2-byte attribute byte count
  }
  return out;
}

function parseAscii(text: string): Float32Array {
  const nums: number[] = [];
  // Include `-` in the char class so negative-exponent scientific notation (e.g. 1.5e-3) parses whole;
  // without it the match stops at "1.5e" and the vertex line is silently dropped.
  const re = /vertex\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) nums.push(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
  const triCount = Math.floor(nums.length / 9); // 3 vertices × 3 coords per triangle; drop a partial tail
  return Float32Array.from(nums.slice(0, triCount * 9));
}

/**
 * Parse an STL (binary OR ASCII) into raw triangle positions: 9 floats per triangle
 * (v1.xyz, v2.xyz, v3.xyz). Detection mirrors the desktop app: binary if the byte length exactly
 * matches the 80-byte header + count×50, else ASCII (with a best-effort binary fallback).
 */
export function parseStl(bytes: Uint8Array): Float32Array {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (looksBinary(dv)) return parseBinary(dv);
  const text = new TextDecoder("utf-8").decode(bytes);
  if (!/facet|vertex/i.test(text)) {
    // Not ASCII either — best-effort binary read so a slightly-off size still works.
    if (dv.byteLength >= 84) return parseBinary(dv);
    throw new Error("parseStl: unrecognized STL");
  }
  return parseAscii(text);
}

// Round to 4 decimals (µm precision) and stringify — same as the app's fmt(), keeps the .model compact.
function fmt(n: number): string {
  const x = Number(n);
  return Number.isFinite(x) ? String(Math.round(x * 1e4) / 1e4) : "0";
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Build the core-spec 3D/3dmodel.model. Vertices are deduped (by rounded coordinate) so the mesh isn't
// bloated 3× by per-triangle emission — triangles then reference the shared vertex indices.
function buildModelXml(pos: Float32Array, name?: string): string {
  const verts: string[] = [];
  const tris: string[] = [];
  const index = new Map<string, number>();
  const idxOf = (x: number, y: number, z: number): number => {
    const fx = fmt(x), fy = fmt(y), fz = fmt(z);
    const key = `${fx},${fy},${fz}`;
    let id = index.get(key);
    if (id === undefined) {
      id = verts.length;
      index.set(key, id);
      verts.push(`<vertex x="${fx}" y="${fy}" z="${fz}"/>`);
    }
    return id;
  };
  const triCount = Math.floor(pos.length / 9);
  for (let i = 0; i < triCount; i++) {
    const o = i * 9;
    const a = idxOf(pos[o], pos[o + 1], pos[o + 2]);
    const b = idxOf(pos[o + 3], pos[o + 4], pos[o + 5]);
    const c = idxOf(pos[o + 6], pos[o + 7], pos[o + 8]);
    if (a === b || b === c || a === c) continue; // drop degenerate faces (would reject in some slicers)
    tris.push(`<triangle v1="${a}" v2="${b}" v3="${c}"/>`);
  }
  const title = name ? `<metadata name="Title">${xmlEscape(name)}</metadata>` : "";
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">'
    + title
    + '<resources><object id="1" type="model"><mesh>'
    + `<vertices>${verts.join("")}</vertices><triangles>${tris.join("")}</triangles>`
    + "</mesh></object></resources>"
    + '<build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/></build></model>';
}

const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8"?>\n'
  + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  + '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>'
  + "</Types>";

const RELS = '<?xml version="1.0" encoding="UTF-8"?>\n'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rel-1" Target="/3D/3dmodel.model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>'
  + "</Relationships>";

/**
 * Wrap a plain STL as a valid core-spec 3MF (mirrors the desktop app's meshTo3mf structure):
 * `[Content_Types].xml`, `_rels/.rels`, and `3D/3dmodel.model` with a single deduped mesh object + build
 * item. Geometry only — no colours or slicer profile. Returns the zipped 3MF bytes.
 */
export function stlTo3MF(bytes: Uint8Array, name?: string): Uint8Array {
  const pos = parseStl(bytes);
  return zipSync(
    {
      "[Content_Types].xml": strToU8(CONTENT_TYPES),
      "_rels/.rels": strToU8(RELS),
      "3D/3dmodel.model": strToU8(buildModelXml(pos, name)),
    },
    { level: 6 },
  );
}
