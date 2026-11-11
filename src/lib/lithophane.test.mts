// Lithophane core. Run: `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { unzipSync, strFromU8 } from "fflate";
import {
  planLithophane, slabMeshForHead, heightfieldMesh, lithophaneParts, meshVolume, slabCombos, attenuation,
  DEFAULT_CMYW, type IndexedMesh, type LithoImage,
} from "./lithophane.ts";
import { lithophaneTo3MF } from "./lithophane-3mf.ts";

/** A small test card: hue sweep left→right, brightness top→bottom, plus a white and a black patch. */
function card(w = 48, h = 36): LithoImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4, hue = (x / w) * 6, v = 1 - y / h;
    const f = hue - Math.floor(hue), seg = Math.floor(hue) % 6;
    const rgb = [[1, f, 0], [1 - f, 1, 0], [0, 1, f], [0, 1 - f, 1], [f, 0, 1], [1, 0, 1 - f]][seg];
    data[o] = rgb[0] * v * 255; data[o + 1] = rgb[1] * v * 255; data[o + 2] = rgb[2] * v * 255; data[o + 3] = 255;
  }
  for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) { const o = (y * w + x) * 4; data[o] = data[o + 1] = data[o + 2] = 255; }
  for (let y = h - 6; y < h; y++) for (let x = w - 6; x < w; x++) { const o = (y * w + x) * 4; data[o] = data[o + 1] = data[o + 2] = 0; }
  return { data, width: w, height: h };
}

/**
 * Closed and consistently oriented: every directed edge is matched by as many reverse uses. (Two
 * cells of one head can touch along a single edge — a run of layers 1–3 beside a run 4–5 — which
 * puts four faces on that edge; still closed, still a valid solid for a slicer.)
 */
function assertWatertight(m: IndexedMesh, label: string) {
  const p = m.positions;
  const key = (i: number) => `${p[i * 3].toFixed(4)},${p[i * 3 + 1].toFixed(4)},${p[i * 3 + 2].toFixed(4)}`;
  const edges = new Map<string, number>();
  const ix = m.indices;
  for (let t = 0; t < ix.length; t += 3) for (let e = 0; e < 3; e++) {
    const k = key(ix[t + e]) + ">" + key(ix[t + ((e + 1) % 3)]);
    edges.set(k, (edges.get(k) || 0) + 1);
  }
  for (const [k, n] of edges) {
    const [a, b] = k.split(">");
    assert.equal(edges.get(b + ">" + a), n, `${label}: open edge ${k}`);
  }
}

const SMALL = { widthMm: 12, heightMm: 9, cellMm: 0.5 };

test("combination table: every way to fill N layers from 3 colours, the rest white", () => {
  const c = slabCombos(3, 5);
  assert.equal(c.length, 56);
  assert.ok(c.every((x) => x.length === 3 && x.reduce((s, v) => s + v, 0) <= 5));
  assert.equal(new Set(c.map((x) => x.join())).size, 56);
});

test("attenuation: white only dims, cyan blocks red far more than blue", () => {
  const w = attenuation({ hex: "#FFFFFF", td: 2.5 });
  assert.ok(Math.abs(w[0] - w[2]) < 1e-9 && Math.abs(w[0] - Math.log(10) / 2.5) < 1e-9);
  const c = attenuation({ hex: "#00A3E0", td: 3 });
  assert.ok(c[0] > 3 * c[2]);
});

test("colour slab: in every cell the heads fill exactly N layers", () => {
  const plan = planLithophane(card(), SMALL);
  const heads = plan.filaments.length;
  for (let c = 0; c < plan.gw * plan.gh; c++) {
    let s = 0;
    for (let h = 0; h < heads; h++) s += plan.counts[c * heads + h];
    assert.equal(s, plan.colourLayers);
  }
  assert.equal(plan.whiteHead, 3); // the lightest of CMYW
});

test("the four heads' solids are watertight, never overlap and fill the slab exactly (no light leaks)", () => {
  const plan = planLithophane(card(), SMALL);
  const heads = plan.filaments.length;
  const cellVol = plan.cellMm * plan.cellMm * plan.layerH;
  let total = 0;
  for (let h = 0; h < heads; h++) {
    const m = slabMeshForHead(plan, h);
    assertWatertight(m, `head ${h}`);
    let layers = 0;
    for (let c = 0; c < plan.gw * plan.gh; c++) layers += plan.counts[c * heads + h];
    const v = meshVolume(m);
    assert.ok(Math.abs(v - layers * cellVol) < 1e-3, `head ${h}: volume ${v} vs ${layers * cellVol}`);
    total += v;
  }
  const slab = plan.gw * plan.cellMm * plan.gh * plan.cellMm * plan.colourLayers * plan.layerH;
  // Sum of the parts == the slab, and each part == its own cells: together that rules out both
  // overlap (sum would exceed) and gaps (sum would fall short).
  assert.ok(Math.abs(total - slab) < 1e-3, `slab ${total} vs ${slab}`);
});

test("the slab parts tile each layer: every (cell, layer) belongs to exactly one head", () => {
  const plan = planLithophane(card(), SMALL);
  const heads = plan.filaments.length;
  const order = [...plan.slabOrder, plan.whiteHead];
  for (let c = 0; c < plan.gw * plan.gh; c++) {
    const owner: number[] = [];
    for (const h of order) for (let k = 0; k < plan.counts[c * heads + h]; k++) owner.push(h);
    assert.equal(owner.length, plan.colourLayers);
  }
});

test("heightfield: watertight, inside min..max, sits on the slab", () => {
  const plan = planLithophane(card(), SMALL);
  const m = heightfieldMesh(plan);
  assertWatertight(m, "heightfield");
  assert.ok(meshVolume(m) > 0);
  const base = plan.colourLayers * plan.layerH;
  let lo = Infinity, hi = -Infinity;
  for (let i = 2; i < m.positions.length; i += 3) { lo = Math.min(lo, m.positions[i]); hi = Math.max(hi, m.positions[i]); }
  assert.ok(Math.abs(lo - base) < 1e-4);
  assert.ok(hi <= base + plan.maxMm + 1e-4);
  for (const t of plan.thickness) assert.ok(t >= plan.minMm - 1e-6 && t <= plan.maxMm + 1e-6);
});

test("brightness: white patch is thinnest, black patch thickest", () => {
  const plan = planLithophane(card(), { ...SMALL, mode: "classic" });
  const at = (i: number, j: number) => plan.thickness[j * plan.gw + i];
  assert.ok(at(1, 1) < plan.minMm + 0.15, `white ${at(1, 1)}`);
  assert.ok(at(plan.gw - 2, plan.gh - 2) > plan.maxMm - 0.15, `black ${at(plan.gw - 2, plan.gh - 2)}`);
});

test("classic: one white part on one head, no slab", () => {
  const plan = planLithophane(card(), { ...SMALL, mode: "classic" });
  const parts = lithophaneParts(plan);
  assert.equal(parts.length, 1);
  assert.equal(plan.colourLayers, 0);
  assert.equal(parts[0].head, 0);
});

test("colour: the backlit prediction keeps hue — a red patch reads red, a blue patch blue", () => {
  const w = 20, h = 10, data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4; data[o + 3] = 255;
    if (x < 10) data[o] = 220; else data[o + 2] = 220;
  }
  const plan = planLithophane({ data, width: w, height: h }, { widthMm: 10, heightMm: 5, cellMm: 0.5 });
  const px = (i: number) => [...plan.backlit.slice((2 * plan.gw + i) * 4, (2 * plan.gw + i) * 4 + 3)];
  const red = px(2), blue = px(plan.gw - 3);
  assert.ok(red[0] > red[2] + 40, `red ${red}`);
  assert.ok(blue[2] > blue[0] + 40, `blue ${blue}`);
});

test("grid is capped so a bed-sized print does not explode", () => {
  const plan = planLithophane(card(8, 8), { widthMm: 260, heightMm: 260, maxCells: 20_000 });
  assert.ok(plan.gw * plan.gh <= 20_500);
  assert.ok(plan.cellMm >= 260 / Math.sqrt(20_000) - 1e-6);
});

test("3MF: four heads named, 100% infill, first layer = layer height", () => {
  const plan = planLithophane(card(), SMALL);
  const zip = lithophaneTo3MF(plan, { name: "card" })!;
  const files = unzipSync(zip);
  const cfg = JSON.parse(strFromU8(files["Metadata/project_settings.config"]));
  assert.equal(cfg.sparse_infill_density, "100%");
  assert.ok(String(cfg.different_settings_to_system[0]).split(";").includes("sparse_infill_density"));
  assert.equal(cfg.layer_height, "0.1");
  assert.equal(cfg.initial_layer_print_height, "0.1");
  assert.deepEqual(cfg.filament_colour, DEFAULT_CMYW.map((f) => f.hex.toUpperCase()));
  const ms = strFromU8(files["Metadata/model_settings.config"]);
  for (const e of [1, 2, 3, 4]) assert.ok(ms.includes(`key="extruder" value="${e}"`), `extruder ${e}`);
});

test("shadows use the colour slab: a black patch backlights far darker than with white alone", () => {
  const img = card();
  const dark = (o: object) => {
    const p = planLithophane(img, { ...SMALL, ...o });
    const at = ((p.gh - 2) * p.gw + (p.gw - 2)) * 4; // inside the black patch
    return 0.2126 * p.backlit[at] + 0.7152 * p.backlit[at + 1] + 0.0722 * p.backlit[at + 2];
  };
  const slab = dark({}), white = dark({ shadows: "white" });
  assert.ok(slab < white * 0.5, `slab ${slab} vs white ${white}`);
});

test("colour grid 0.8 mm: one slab combination per 2×2 block, white detail still per cell", () => {
  const plan = planLithophane(card(), { ...SMALL, cellMm: 0.5, colourCellMm: 1.0 });
  assert.equal(plan.colourBlock, 2);
  const heads = plan.filaments.length;
  const key = (i: number, j: number) => [...plan.counts.slice((j * plan.gw + i) * heads, (j * plan.gw + i + 1) * heads)].join();
  for (let j = 0; j + 1 < plan.gh; j += 2) for (let i = 0; i + 1 < plan.gw; i += 2) {
    const k = key(i, j);
    assert.equal(key(i + 1, j), k); assert.equal(key(i, j + 1), k); assert.equal(key(i + 1, j + 1), k);
  }
  // Still watertight, still fills the slab, and fewer triangles than the per-cell slab.
  let tris = 0, total = 0;
  for (let h = 0; h < heads; h++) { const m = slabMeshForHead(plan, h); assertWatertight(m, `block head ${h}`); tris += m.indices.length / 3; total += meshVolume(m); }
  const slab = plan.gw * plan.cellMm * plan.gh * plan.cellMm * plan.colourLayers * plan.layerH;
  assert.ok(Math.abs(total - slab) < 1e-3);
  const fine = planLithophane(card(), { ...SMALL, cellMm: 0.5 });
  let fineTris = 0; for (let h = 0; h < heads; h++) fineTris += slabMeshForHead(fine, h).indices.length / 3;
  assert.ok(tris < fineTris, `${tris} vs ${fineTris}`);
});

test("white front layer: a white box under the slab, slab and heightfield lifted, 3MF first layer = 0.2", () => {
  const plan = planLithophane(card(), { ...SMALL, whiteFrontMm: 0.2 });
  const parts = lithophaneParts(plan);
  const front = parts.find((p) => p.name === "white front")!;
  assert.ok(front && front.head === plan.whiteHead);
  assertWatertight(front.mesh, "front");
  const W = plan.gw * plan.cellMm, H = plan.gh * plan.cellMm;
  assert.ok(Math.abs(meshVolume(front.mesh) - W * H * 0.2) < 1e-3);
  const zs = (m: IndexedMesh) => { let lo = Infinity; for (let i = 2; i < m.positions.length; i += 3) lo = Math.min(lo, m.positions[i]); return lo; };
  for (const h of plan.slabOrder) { const m = slabMeshForHead(plan, h); if (m.indices.length) assert.ok(Math.abs(zs(m) - 0.2) < 1e-4 || zs(m) > 0.2); }
  assert.ok(Math.abs(zs(heightfieldMesh(plan)) - (0.2 + plan.colourLayers * plan.layerH)) < 1e-4);
  const cfg = JSON.parse(strFromU8(unzipSync(lithophaneTo3MF(plan)!)["Metadata/project_settings.config"]));
  assert.equal(cfg.initial_layer_print_height, "0.2");
  assert.equal(cfg.layer_height, "0.1");
});
