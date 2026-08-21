// Image → U1 multicolor panel (flat-panel MVP). Turns a photo/logo/artwork into a flat, printable
// multicolour plate: quantize to ≤4 colours, extrude a thin slab, and PAINT the top surface per colour
// using the same Bambu/Orca `paint_color` codec the converter already speaks. The emitted .3mf carries
// `filament_colour` in project_settings.config, so it flows straight into the existing pipeline:
// `extractMeshFromBuffer` (live preview) and `cleanThreeMF(file, "u1", {mode:"stamp"})` (U1 output).
//
// Pure + framework-free (no DOM, no three) so it unit-tests and runs in a Web Worker. The caller is
// responsible for turning a File/<img> into RGBA pixels at the target grid resolution (a canvas
// drawImage + getImageData in the page); this module takes it from pixels onward.
import { zipSync, strToU8 } from "fflate";
import { encodeSolidPaint } from "./paint";

export type Quantized = {
  palette: string[]; // ≤k hex colours, most-used first (index 0 = base / dominant)
  indices: Uint8Array; // one 0-based palette index per pixel (length = w*h)
  width: number;
  height: number;
};

export type PanelMesh = {
  positions: Float32Array; // 9 floats per triangle (v1.xyz v2.xyz v3.xyz), millimetres
  faceState: Uint8Array; // 0 = unpainted (base extruder); 1..k = painted with that slot
  palette: string[];
};

// ---------- colour quantization (median cut — deterministic) ----------

function hex(r: number, g: number, b: number): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return ("#" + h(r) + h(g) + h(b)).toUpperCase();
}

type Box = { px: number[] }; // indices into a flat [r,g,b] pixel list

/**
 * Median-cut quantization of RGBA pixels to at most `k` colours (k clamped to 1..4 for the U1).
 * `pixels` is RGBA (length w*h*4); fully-transparent pixels are ignored. Deterministic.
 */
export function quantize(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  k = 4,
  opts: { dither?: boolean } = {},
): Quantized {
  const K = Math.max(1, Math.min(4, k | 0));
  const n = width * height;
  // Collect opaque RGB samples; remember each pixel's sample slot (or -1 if transparent → treated as base).
  const rgb: number[] = []; // flat r,g,b
  const pixelSample = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const a = pixels[i * 4 + 3];
    if (a < 8) continue; // transparent → leave as base (index 0) later
    pixelSample[i] = rgb.length / 3;
    rgb.push(pixels[i * 4], pixels[i * 4 + 1], pixels[i * 4 + 2]);
  }
  const sampleCount = rgb.length / 3;
  if (sampleCount === 0) {
    // Fully transparent image — one black slot, everything base.
    return { palette: ["#000000"], indices: new Uint8Array(n), width, height };
  }

  const boxes: Box[] = [{ px: Array.from({ length: sampleCount }, (_, i) => i) }];
  const rangeOf = (box: Box) => {
    let rmin = 255, rmax = 0, gmin = 255, gmax = 0, bmin = 255, bmax = 0;
    for (const p of box.px) {
      const r = rgb[p * 3], g = rgb[p * 3 + 1], b = rgb[p * 3 + 2];
      if (r < rmin) rmin = r; if (r > rmax) rmax = r;
      if (g < gmin) gmin = g; if (g > gmax) gmax = g;
      if (b < bmin) bmin = b; if (b > bmax) bmax = b;
    }
    return { r: rmax - rmin, g: gmax - gmin, b: bmax - bmin };
  };
  // Split the box with the widest single-channel range until we have K boxes (or can't split further).
  while (boxes.length < K) {
    let target = -1, targetRange = -1, axis = 0;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].px.length < 2) continue;
      const rg = rangeOf(boxes[i]);
      const mx = Math.max(rg.r, rg.g, rg.b);
      if (mx > targetRange) { targetRange = mx; target = i; axis = rg.r === mx ? 0 : rg.g === mx ? 1 : 2; }
    }
    if (target < 0) break; // nothing splittable
    const box = boxes[target];
    box.px.sort((p, q) => rgb[p * 3 + axis] - rgb[q * 3 + axis]);
    const mid = box.px.length >> 1;
    const a: Box = { px: box.px.slice(0, mid) };
    const b: Box = { px: box.px.slice(mid) };
    boxes.splice(target, 1, a, b);
  }

  // Each box → its average colour. Track sample→box so we can index pixels, and box population for ordering.
  const sampleBox = new Int32Array(sampleCount);
  const boxColor: [number, number, number][] = [];
  boxes.forEach((box, bi) => {
    let r = 0, g = 0, b = 0;
    for (const p of box.px) { r += rgb[p * 3]; g += rgb[p * 3 + 1]; b += rgb[p * 3 + 2]; sampleBox[p] = bi; }
    const c = box.px.length || 1;
    boxColor.push([r / c, g / c, b / c]);
  });

  // Order palette by popularity (most pixels first) so index 0 is the dominant colour (nice base).
  const order = boxes.map((box, bi) => ({ bi, count: box.px.length })).sort((x, y) => y.count - x.count);
  const remap = new Int32Array(boxes.length);
  order.forEach((o, newIdx) => (remap[o.bi] = newIdx));
  const palette = order.map((o) => hex(...boxColor[o.bi]));

  const indices = new Uint8Array(n);
  if (!opts.dither) {
    for (let i = 0; i < n; i++) {
      const s = pixelSample[i];
      indices[i] = s < 0 ? 0 : remap[sampleBox[s]];
    }
    return { palette, indices, width, height };
  }

  // Floyd–Steinberg dithering: map each pixel to the nearest palette colour and diffuse the residual
  // error to neighbours, so a photo's smooth gradients render as intermixed dots of the 4 filaments
  // (which the U1 prints beautifully) instead of flat posterized blocks. Deterministic scan order.
  const pal = palette.map((h): [number, number, number] => [
    parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16),
  ]);
  const nearest = (r: number, g: number, b: number): number => {
    let bi = 0, bd = Infinity;
    for (let p = 0; p < pal.length; p++) {
      const dr = r - pal[p][0], dg = g - pal[p][1], db = b - pal[p][2];
      const d = dr * dr + dg * dg + db * db;
      if (d < bd) { bd = d; bi = p; }
    }
    return bi;
  };
  // Working float buffer (RGB) so diffused error accumulates at sub-8-bit precision.
  const buf = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { buf[i * 3] = pixels[i * 4]; buf[i * 3 + 1] = pixels[i * 4 + 1]; buf[i * 3 + 2] = pixels[i * 4 + 2]; }
  const add = (i: number, er: number, eg: number, eb: number, w: number) => {
    buf[i * 3] += (er * w) / 16; buf[i * 3 + 1] += (eg * w) / 16; buf[i * 3 + 2] += (eb * w) / 16;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (pixelSample[i] < 0) { indices[i] = 0; continue; } // transparent → base
      const r = buf[i * 3], g = buf[i * 3 + 1], b = buf[i * 3 + 2];
      const pi = nearest(r, g, b);
      indices[i] = pi;
      const er = r - pal[pi][0], eg = g - pal[pi][1], eb = b - pal[pi][2];
      if (x + 1 < width) add(i + 1, er, eg, eb, 7);
      if (y + 1 < height) {
        if (x > 0) add(i + width - 1, er, eg, eb, 3);
        add(i + width, er, eg, eb, 5);
        if (x + 1 < width) add(i + width + 1, er, eg, eb, 1);
      }
    }
  }
  return { palette, indices, width, height };
}

// ---------- geometry (flat painted panel) ----------

export type PanelOpts = {
  widthMM?: number; // longest side in mm (default 100); height derived from aspect ratio
  thicknessMM?: number; // total (base) plate thickness (default 2.4)
  reliefMM?: number; // if >0 (with `luma`), raise the top surface by brightness → a 3D relief
  luma?: Float32Array; // per-cell brightness 0..1 (length w*h), drives relief height
};

/**
 * Build a flat rectangular plate whose TOP surface is a grid painted per the quantized image (one filament
 * slot per cell). Walls + bottom are unpainted (base extruder). One quad (2 triangles) per image cell on
 * top; a single quad each for bottom and the four walls. Y is flipped so the print reads the same as the
 * source image viewed from above.
 */
export function buildPanelMesh(q: Quantized, opts: PanelOpts = {}): PanelMesh {
  const { width: w, height: h, indices, palette } = q;
  const longest = opts.widthMM && opts.widthMM > 0 ? opts.widthMM : 100;
  const T = opts.thicknessMM && opts.thicknessMM > 0 ? opts.thicknessMM : 2.4;
  // Scale so the LONGEST image side maps to `longest` mm; keep aspect ratio.
  const cell = longest / Math.max(w, h);
  const W = w * cell, H = h * cell;

  const pos: number[] = [];
  const state: number[] = [];
  const tri = (
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    s: number,
  ) => {
    pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    state.push(s);
  };

  // ---- Relief (heightmap) path: a watertight height-field with shared per-corner heights ----
  const relief = opts.reliefMM && opts.reliefMM > 0 && opts.luma && opts.luma.length === w * h ? opts.reliefMM : 0;
  if (relief) {
    const luma = opts.luma!;
    const vx = (gx: number) => gx * cell;
    const vy = (gy: number) => (h - gy) * cell; // Y flip so image-top reads upright from above
    // Height at a grid corner = base T + relief × average brightness of the ≤4 cells touching it.
    // Shared corners → one height → the surface (and its skirt) stays watertight.
    const cornerZ = (gx: number, gy: number): number => {
      let s = 0, c = 0;
      for (const [dx, dy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]] as const) {
        const cx = gx + dx, cy = gy + dy;
        if (cx >= 0 && cx < w && cy >= 0 && cy < h) { s += luma[cy * w + cx]; c++; }
      }
      return T + relief * (c ? s / c : 0);
    };
    // Top surface: 2 painted triangles per cell using its 4 corner heights.
    for (let gy = 0; gy < h; gy++) {
      for (let gx = 0; gx < w; gx++) {
        const slot = (indices[gy * w + gx] ?? 0) + 1;
        const x0 = vx(gx), x1 = vx(gx + 1), yA = vy(gy), yB = vy(gy + 1);
        const z00 = cornerZ(gx, gy), z10 = cornerZ(gx + 1, gy), z11 = cornerZ(gx + 1, gy + 1), z01 = cornerZ(gx, gy + 1);
        tri(x0, yA, z00, x1, yA, z10, x1, yB, z11, slot);
        tri(x0, yA, z00, x1, yB, z11, x0, yB, z01, slot);
      }
    }
    // Flat bottom over the full footprint.
    tri(0, 0, 0, W, H, 0, W, 0, 0, 0);
    tri(0, 0, 0, 0, H, 0, W, H, 0, 0);
    // Skirt walls: per edge segment, connect the varying top profile down to z=0 (unpainted).
    for (let gx = 0; gx < w; gx++) {
      const x0 = vx(gx), x1 = vx(gx + 1);
      // image-top edge (gy=0)
      const yT = vy(0), zt0 = cornerZ(gx, 0), zt1 = cornerZ(gx + 1, 0);
      tri(x0, yT, zt0, x1, yT, zt1, x1, yT, 0, 0); tri(x0, yT, zt0, x1, yT, 0, x0, yT, 0, 0);
      // image-bottom edge (gy=h)
      const yB = vy(h), zb0 = cornerZ(gx, h), zb1 = cornerZ(gx + 1, h);
      tri(x0, yB, zb0, x1, yB, 0, x1, yB, zb1, 0); tri(x0, yB, zb0, x0, yB, 0, x1, yB, 0, 0);
    }
    for (let gy = 0; gy < h; gy++) {
      const yA = vy(gy), yB2 = vy(gy + 1);
      // left edge (gx=0)
      const zl0 = cornerZ(0, gy), zl1 = cornerZ(0, gy + 1);
      tri(0, yA, zl0, 0, yB2, 0, 0, yB2, zl1, 0); tri(0, yA, zl0, 0, yA, 0, 0, yB2, 0, 0);
      // right edge (gx=w)
      const zr0 = cornerZ(w, gy), zr1 = cornerZ(w, gy + 1);
      tri(W, yA, zr0, W, yB2, zr1, W, yB2, 0, 0); tri(W, yA, zr0, W, yB2, 0, W, yA, 0, 0);
    }
    return { positions: Float32Array.from(pos), faceState: Uint8Array.from(state), palette };
  }

  // Top surface: per cell, two triangles, wound CCW seen from +Z (outward normal +Z), painted with slot.
  for (let gy = 0; gy < h; gy++) {
    for (let gx = 0; gx < w; gx++) {
      const slot = (indices[gy * w + gx] ?? 0) + 1; // 1-based filament slot
      const x0 = gx * cell, x1 = x0 + cell;
      // Flip Y so image-top maps to +Y-far → prints upright when viewed from above.
      const y0 = (h - gy) * cell, y1 = y0 - cell;
      tri(x0, y0, T, x1, y0, T, x1, y1, T, slot);
      tri(x0, y0, T, x1, y1, T, x0, y1, T, slot);
    }
  }
  // Bottom (z=0), CCW seen from -Z, unpainted.
  tri(0, 0, 0, W, H, 0, W, 0, 0, 0);
  tri(0, 0, 0, 0, H, 0, W, H, 0, 0);
  // Four walls (unpainted). Each as two triangles with outward normals.
  // Front (y=0)
  tri(0, 0, 0, W, 0, 0, W, 0, T, 0); tri(0, 0, 0, W, 0, T, 0, 0, T, 0);
  // Back (y=H)
  tri(0, H, 0, W, H, T, W, H, 0, 0); tri(0, H, 0, 0, H, T, W, H, T, 0);
  // Left (x=0)
  tri(0, 0, 0, 0, 0, T, 0, H, T, 0); tri(0, 0, 0, 0, H, T, 0, H, 0, 0);
  // Right (x=W)
  tri(W, 0, 0, W, H, 0, W, H, T, 0); tri(W, 0, 0, W, H, T, W, 0, T, 0);

  return { positions: Float32Array.from(pos), faceState: Uint8Array.from(state), palette };
}

// ---------- 3MF assembly (painted, pipeline-compatible) ----------

function fmt(n: number): string {
  const x = Number(n);
  return Number.isFinite(x) ? String(Math.round(x * 1e4) / 1e4) : "0";
}
function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** core-spec 3D/3dmodel.model with per-triangle paint_color (deduped vertices). */
function buildPaintedModelXml(pos: Float32Array, faceState: Uint8Array, name?: string): string {
  const verts: string[] = [];
  const tris: string[] = [];
  const index = new Map<string, number>();
  const idxOf = (x: number, y: number, z: number): number => {
    const key = `${fmt(x)},${fmt(y)},${fmt(z)}`;
    let id = index.get(key);
    if (id === undefined) {
      id = verts.length;
      index.set(key, id);
      verts.push(`<vertex x="${fmt(x)}" y="${fmt(y)}" z="${fmt(z)}"/>`);
    }
    return id;
  };
  const triCount = Math.floor(pos.length / 9);
  for (let i = 0; i < triCount; i++) {
    const o = i * 9;
    const a = idxOf(pos[o], pos[o + 1], pos[o + 2]);
    const b = idxOf(pos[o + 3], pos[o + 4], pos[o + 5]);
    const c = idxOf(pos[o + 6], pos[o + 7], pos[o + 8]);
    if (a === b || b === c || a === c) continue; // drop degenerate faces
    const s = faceState[i] ?? 0;
    const paint = s > 0 ? ` paint_color="${encodeSolidPaint(s)}"` : "";
    tris.push(`<triangle v1="${a}" v2="${b}" v3="${c}"${paint}/>`);
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
  + '<Default Extension="config" ContentType="application/xml"/>'
  + "</Types>";
const RELS = '<?xml version="1.0" encoding="UTF-8"?>\n'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rel-1" Target="/3D/3dmodel.model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>'
  + "</Relationships>";

/**
 * Assemble a painted .3mf from a panel mesh. Carries `filament_colour` in project_settings.config so the
 * converter's palette reader picks up the exact colours. Returns the zipped bytes — feed to
 * `cleanThreeMF(new File([bytes], "image.3mf"), "u1", {mode:"stamp"})` for the U1-ready result.
 */
export function buildImage3MF(mesh: PanelMesh, name = "image"): Uint8Array {
  const projectSettings = JSON.stringify({
    filament_colour: mesh.palette,
    // A minimal, Orca-shaped hint set; the converter's stamp path fills in the real U1 profile.
    filament_type: mesh.palette.map(() => "PLA"),
    version: "1.0",
    from: "BedReady image studio",
  });
  return zipSync(
    {
      "[Content_Types].xml": strToU8(CONTENT_TYPES),
      "_rels/.rels": strToU8(RELS),
      "3D/3dmodel.model": strToU8(buildPaintedModelXml(mesh.positions, mesh.faceState, name)),
      "Metadata/project_settings.config": strToU8(projectSettings),
    },
    { level: 6 },
  );
}

/** Convenience: pixels → U1-panel .3mf bytes (quantize → mesh → 3MF). Caller supplies grid-res RGBA. */
export function imageTo3MF(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  opts: { colors?: number; widthMM?: number; thicknessMM?: number; name?: string } = {},
): { bytes: Uint8Array; palette: string[]; mesh: PanelMesh } {
  const q = quantize(pixels, width, height, opts.colors ?? 4);
  const mesh = buildPanelMesh(q, { widthMM: opts.widthMM, thicknessMM: opts.thicknessMM });
  const bytes = buildImage3MF(mesh, opts.name ?? "image");
  return { bytes, palette: q.palette, mesh };
}
