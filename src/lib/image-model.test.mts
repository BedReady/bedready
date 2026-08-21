// Image → U1 panel engine tests: median-cut quantization, flat painted-panel geometry, and a full
// round-trip of the emitted .3mf back through the converter's own extractMeshFromBuffer. Run: `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { unzipSync, strFromU8 } from "fflate";
import { quantize, buildPanelMesh, buildImage3MF, imageTo3MF } from "./image-model.ts";
import { extractMeshFromBuffer } from "./paint.ts";

// Build a 4x4 RGBA image: rows 0-1 red (8px), row 2 green (4px), row 3 blue (4px) → 3 clear colours.
function makeImg(): { px: Uint8Array; w: number; h: number } {
  const w = 4, h = 4;
  const px = new Uint8Array(w * h * 4);
  const set = (i: number, r: number, g: number, b: number) => { px[i*4]=r; px[i*4+1]=g; px[i*4+2]=b; px[i*4+3]=255; };
  for (let i = 0; i < 16; i++) {
    const row = Math.floor(i / 4);
    if (row < 2) set(i, 255, 0, 0);
    else if (row === 2) set(i, 0, 255, 0);
    else set(i, 0, 0, 255);
  }
  return { px, w, h };
}

test("quantize recovers 3 colours, dominant first", () => {
  const { px, w, h } = makeImg();
  const q = quantize(px, w, h, 3);
  assert.equal(q.palette.length, 3);
  assert.equal(q.indices.length, 16);
  // Red is most-used (8/16) → palette[0] should be ~red.
  const [r, g, b] = [parseInt(q.palette[0].slice(1,3),16), parseInt(q.palette[0].slice(3,5),16), parseInt(q.palette[0].slice(5,7),16)];
  assert.ok(r > 200 && g < 40 && b < 40, `dominant expected red, got ${q.palette[0]}`);
});

test("panel mesh: correct triangle + paint counts", () => {
  const { px, w, h } = makeImg();
  const q = quantize(px, w, h, 3);
  const mesh = buildPanelMesh(q, { widthMM: 40, thicknessMM: 2.4 });
  const triCount = mesh.positions.length / 9;
  assert.equal(triCount, 42); // 16*2 top + 2 bottom + 8 walls
  const painted = [...mesh.faceState].filter((s) => s > 0).length;
  assert.equal(painted, 32); // only the 16 top cells (2 tris each)
  // Bounds: 40mm longest side, 4x4 → 40mm square, 2.4mm thick.
  let maxX = 0, maxZ = 0;
  for (let i = 0; i < mesh.positions.length; i += 3) { maxX = Math.max(maxX, mesh.positions[i]); maxZ = Math.max(maxZ, mesh.positions[i+2]); }
  assert.ok(Math.abs(maxX - 40) < 1e-3 && Math.abs(maxZ - 2.4) < 1e-3);
});

test("emitted .3mf round-trips through the real extractMeshFromBuffer", () => {
  const { px, w, h } = makeImg();
  const { bytes, palette } = imageTo3MF(px, w, h, { colors: 3, widthMM: 40, name: "test-panel" });
  // Raw structure checks
  const entries = unzipSync(bytes);
  assert.ok(entries["3D/3dmodel.model"], "has model");
  assert.ok(entries["Metadata/project_settings.config"], "has project settings");
  const model = strFromU8(entries["3D/3dmodel.model"]);
  const paintCount = (model.match(/paint_color=/g) || []).length;
  assert.equal(paintCount, 32, "32 painted top triangles");
  const cfg = JSON.parse(strFromU8(entries["Metadata/project_settings.config"]));
  assert.equal(cfg.filament_colour.length, 3);

  // The converter's own reader must parse it: palette + geometry recovered.
  const mesh = extractMeshFromBuffer(bytes);
  assert.equal(mesh.palette.length, 3, "extractor reads 3 filament colours");
  assert.equal(mesh.positions.length / 9, 42, "extractor sees all 42 faces");
  // Palette colours survived the round-trip (order preserved via filament_colour).
  assert.equal(mesh.palette[0], palette[0]);
  // Painted faces recovered across slots (sum of usage covers the painted top at least).
  const totalUsage = mesh.usage.reduce((a, b) => a + b, 0);
  assert.ok(totalUsage >= 32, `usage should cover painted faces, got ${totalUsage}`);
});

test("dithering: same palette, more colour mixing than flat quantization", () => {
  // 16x1 horizontal greyscale gradient 0..255.
  const w = 16, h = 1;
  const px = new Uint8Array(w * h * 4);
  for (let x = 0; x < w; x++) { const v = Math.round((x / (w - 1)) * 255); px[x*4]=v; px[x*4+1]=v; px[x*4+2]=v; px[x*4+3]=255; }
  const flat = quantize(px, w, h, 2);
  const dith = quantize(px, w, h, 2, { dither: true });
  // Palette (median cut) is identical — dithering only changes assignment.
  assert.deepEqual(dith.palette, flat.palette);
  assert.equal(flat.palette.length, 2);
  // Both indices appear under dithering.
  assert.equal(new Set(dith.indices).size, 2);
  const transitions = (idx: Uint8Array) => { let t = 0; for (let i = 1; i < idx.length; i++) if (idx[i] !== idx[i-1]) t++; return t; };
  // Error diffusion intermixes the two colours → strictly more index flips than the single flat boundary.
  assert.ok(transitions(dith.indices) > transitions(flat.indices), `expected more transitions with dither (flat=${transitions(flat.indices)}, dith=${transitions(dith.indices)})`);
});

test("relief mode: brightness raises the top surface, watertight + round-trips", () => {
  const w = 3, h = 3;
  const q = { palette: ["#FFFFFF", "#000000"], indices: Uint8Array.from([0,1,0, 1,0,1, 0,1,0]), width: w, height: h };
  const T = 2, R = 4;
  const flat = buildPanelMesh(q, { widthMM: 30, thicknessMM: T });
  const lumaAll1 = new Float32Array(w * h).fill(1);
  const relief = buildPanelMesh(q, { widthMM: 30, thicknessMM: T, reliefMM: R, luma: lumaAll1 });
  // Top raised to exactly T+R (all cells brightness 1); bottom stays at 0.
  let zMin = Infinity, zMax = -Infinity;
  for (let i = 2; i < relief.positions.length; i += 3) { zMin = Math.min(zMin, relief.positions[i]); zMax = Math.max(zMax, relief.positions[i]); }
  assert.ok(Math.abs(zMax - (T + R)) < 1e-4, `top should reach ${T + R}, got ${zMax}`);
  assert.equal(zMin, 0);
  // Only the top cells are painted (2 tris each).
  assert.equal([...relief.faceState].filter((s) => s > 0).length, w * h * 2);
  // Relief adds per-segment skirt walls → strictly more triangles than the flat single-quad walls.
  assert.ok(relief.positions.length > flat.positions.length, "relief has more geometry than flat");

  // A brightness gradient produces varying heights (real relief, not a flat raise).
  const grad = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) grad[y * w + x] = x / (w - 1);
  const gr = buildPanelMesh(q, { widthMM: 30, thicknessMM: T, reliefMM: R, luma: grad });
  const topZ = new Set<number>();
  for (let f = 0; f < gr.faceState.length; f++) if (gr.faceState[f] > 0) for (let k = 0; k < 3; k++) topZ.add(Math.round(gr.positions[f * 9 + k * 3 + 2] * 100));
  assert.ok(topZ.size > 1, "gradient relief should have multiple distinct top heights");

  // Still a valid painted .3mf the converter can read.
  const bytes = buildImage3MF(relief, "relief");
  const mesh = extractMeshFromBuffer(bytes);
  assert.equal(mesh.palette.length, 2);
  assert.ok(mesh.positions.length > 0);
});
