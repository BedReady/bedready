// Full-colour front-lit mode. Run: `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { unzipSync, strFromU8 } from "fflate";
import { planFullColour, fullColourParts } from "./fullcolour.ts";
import { fullColourTo3MF } from "./fullcolour-3mf.ts";
import { meshVolume, type IndexedMesh, type LithoImage } from "./lithophane.ts";

function patches(): LithoImage {
  // left→right: red, green, blue, white, black — 10 px each, 8 px tall
  const cols = [[220, 30, 30], [30, 170, 60], [40, 60, 200], [255, 255, 255], [0, 0, 0]];
  const w = 50, h = 8, data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = cols[(x / 10) | 0], o = (y * w + x) * 4; data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255; }
  return { data, width: w, height: h };
}
const OPTS = { widthMm: 25, heightMm: 4, cellMm: 0.5 };

function closed(m: IndexedMesh, label: string) {
  const p = m.positions, key = (i: number) => `${p[i * 3].toFixed(4)},${p[i * 3 + 1].toFixed(4)},${p[i * 3 + 2].toFixed(4)}`;
  const e = new Map<string, number>();
  for (let t = 0; t < m.indices.length; t += 3) for (let k = 0; k < 3; k++) { const s = key(m.indices[t + k]) + ">" + key(m.indices[t + ((k + 1) % 3)]); e.set(s, (e.get(s) || 0) + 1); }
  for (const [s, n] of e) { const [a, b] = s.split(">"); assert.equal(e.get(b + ">" + a), n, `${label}: open edge ${s}`); }
}

test("each patch reads as its colour; white stays white, black goes dark", () => {
  const plan = planFullColour(patches(), OPTS);
  const at = (i: number) => { const o = (1 * plan.gw + i) * 4; return [plan.preview[o], plan.preview[o + 1], plan.preview[o + 2]]; };
  const q = plan.gw / 5;
  const [red, green, blue, white, black] = [0, 1, 2, 3, 4].map((k) => at(Math.round(q * k + q / 2)));
  assert.ok(red[0] > red[1] + 60 && red[0] > red[2] + 60, `red ${red}`);
  assert.ok(green[1] > green[0] + 30 && green[1] > green[2] + 20, `green ${green}`);
  assert.ok(blue[2] > blue[0] + 40, `blue ${blue}`);
  assert.ok(white.every((v) => v > 235), `white ${white}`);
  assert.ok(black.every((v) => v < 90), `black ${black}`);
});

test("solids: closed, outward, read from the top (not mirrored), base + slab fill exactly", () => {
  const plan = planFullColour(patches(), OPTS);
  const parts = fullColourParts(plan);
  const W = plan.gw * plan.cellMm, H = plan.gh * plan.cellMm;
  let slab = 0;
  for (const p of parts) { closed(p.mesh, p.name); const v = meshVolume(p.mesh); assert.ok(v > 0, `${p.name} volume ${v}`); if (p.name !== "white base") slab += v; }
  assert.ok(Math.abs(slab - W * H * plan.colourLayers * plan.layerH) < 1e-3, `slab ${slab}`);
  // The red patch (image left) must be at small x: the cyan head is absent there, magenta+yellow present.
  const heads = plan.filaments.length, c = 1 * plan.gw + 1;
  const magenta = plan.counts[c * heads + 1], yellow = plan.counts[c * heads + 2];
  assert.ok(magenta > 0 && yellow > 0, "red uses magenta and yellow");
  const mag = parts.find((p) => p.head === 1)!.mesh;
  let minX = Infinity; for (let i = 0; i < mag.positions.length; i += 3) minX = Math.min(minX, mag.positions[i]);
  assert.ok(minX < plan.cellMm * 2, `magenta starts at x=${minX}, expected near 0 (unmirrored)`);
});

test("3MF: four heads, 0.2 first layer then the slab's layer height, 100% infill", () => {
  const plan = planFullColour(patches(), OPTS);
  const files = unzipSync(fullColourTo3MF(plan)!);
  const cfg = JSON.parse(strFromU8(files["Metadata/project_settings.config"]));
  assert.equal(cfg.initial_layer_print_height, "0.2");
  assert.equal(cfg.layer_height, String(plan.layerH));
  assert.equal(cfg.sparse_infill_density, "100%");
  const ms = strFromU8(files["Metadata/model_settings.config"]);
  for (const e of [1, 2, 3, 4]) assert.ok(ms.includes(`key="extruder" value="${e}"`));
  // base 1.0 = 0.2 + 10 × 0.08: the slab starts on a layer boundary
  assert.ok(Math.abs(((plan.baseMm - 0.2) / plan.layerH) - Math.round((plan.baseMm - 0.2) / plan.layerH)) < 1e-6);
});
