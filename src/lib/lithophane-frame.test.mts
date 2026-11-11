// Lithophane frame. Run: `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { unzipSync, strFromU8 } from "fflate";
import { planLithophane, lithophaneParts, meshVolume, type IndexedMesh, type LithoImage, type LithoPlan } from "./lithophane.ts";
import {
  frameParts, borderMesh, hangerMesh, standSize, withFrame, translateParts, partsBounds, printThicknessMm,
  FRAME_DEFAULTS, type LithoFrameKind,
} from "./lithophane-frame.ts";
import { lithophaneTo3MF } from "./lithophane-3mf.ts";

function grad(w = 24, h = 18): LithoImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    data[o] = (x / w) * 255; data[o + 1] = (y / h) * 255; data[o + 2] = 128; data[o + 3] = 255;
  }
  return { data, width: w, height: h };
}

/** Closed and consistently oriented: every directed edge is matched by as many reverse uses. */
function assertWatertight(m: IndexedMesh, label: string) {
  const p = m.positions;
  const key = (i: number) => `${p[i * 3].toFixed(4)},${p[i * 3 + 1].toFixed(4)},${p[i * 3 + 2].toFixed(4)}`;
  const edges = new Map<string, number>();
  const ix = m.indices;
  assert.ok(ix.length > 0, `${label}: empty`);
  for (let t = 0; t < ix.length; t += 3) for (let e = 0; e < 3; e++) {
    const k = key(ix[t + e]) + ">" + key(ix[t + ((e + 1) % 3)]);
    edges.set(k, (edges.get(k) || 0) + 1);
  }
  for (const [k, n] of edges) {
    const [a, b] = k.split(">");
    assert.equal(edges.get(b + ">" + a), n, `${label}: open edge ${k}`);
  }
  assert.ok(meshVolume(m) > 0, `${label}: volume ${meshVolume(m)} (inside-out?)`);
}

/** Euler characteristic V - E + F of a closed manifold mesh: 2 for a ball, 0 for a ring (genus 1). */
function euler(m: IndexedMesh) {
  const p = m.positions;
  const key = (i: number) => `${p[i * 3].toFixed(4)},${p[i * 3 + 1].toFixed(4)},${p[i * 3 + 2].toFixed(4)}`;
  const vs = new Set<string>(), es = new Set<string>();
  for (let t = 0; t < m.indices.length; t += 3) for (let e = 0; e < 3; e++) {
    const a = key(m.indices[t + e]), b = key(m.indices[t + ((e + 1) % 3)]);
    vs.add(a); es.add(a < b ? a + "|" + b : b + "|" + a);
  }
  return vs.size - es.size + m.indices.length / 3;
}

const SMALL = { widthMm: 12, heightMm: 9, cellMm: 0.5 };
const plans: [string, LithoPlan][] = [
  ["colour", planLithophane(grad(), SMALL)],
  ["classic", planLithophane(grad(), { ...SMALL, mode: "classic" })],
];
const KINDS: LithoFrameKind[] = ["none", "stand", "hanger"];

test("frame parts are watertight and outward for every kind", () => {
  for (const [mode, plan] of plans) for (const kind of KINDS) {
    const parts = frameParts(plan, { frame: kind });
    assert.equal(parts.length, kind === "none" ? 1 : 2, `${mode}/${kind}`);
    for (const p of parts) {
      assertWatertight(p.mesh, `${mode}/${kind}/${p.name}`);
      assert.equal(p.head, plan.whiteHead);
      assert.equal(p.hex, plan.filaments[plan.whiteHead].hex);
    }
  }
});

test("border: exact ring volume, full print height, touches the picture without overlapping it", () => {
  for (const [mode, plan] of plans) {
    const b = 6, W = plan.gw * plan.cellMm, H = plan.gh * plan.cellMm, T = printThicknessMm(plan);
    const [ring] = frameParts(plan, { frame: "none", borderMm: b });
    const want = ((W + 2 * b) * (H + 2 * b) - W * H) * T;
    assert.ok(Math.abs(meshVolume(ring.mesh) - want) < 1e-3 * want, `${mode}: ring ${meshVolume(ring.mesh)} vs ${want}`);
    const { min, max } = partsBounds([ring]);
    assert.deepEqual(min.map((v) => +v.toFixed(4)), [-b, -b, 0]);
    assert.deepEqual(max.map((v) => +v.toFixed(4)), [+(W + b).toFixed(4), +(H + b).toFixed(4), +T.toFixed(4)]);
    // No vertex strictly inside the picture's footprint; the inner corners sit on its corners.
    const p = ring.mesh.positions;
    for (let i = 0; i < p.length; i += 3) {
      assert.ok(!(p[i] > 1e-4 && p[i] < W - 1e-4 && p[i + 1] > 1e-4 && p[i + 1] < H - 1e-4), `${mode}: vertex inside picture`);
    }
    // Picture + ring = the solid framed block minus what the heightfield's relief leaves out,
    // i.e. the volumes simply add (touching, not overlapping).
    const pic = lithophaneParts(plan).reduce((s, q) => s + meshVolume(q.mesh), 0);
    const all = [...lithophaneParts(plan), ring].reduce((s, q) => s + meshVolume(q.mesh), 0);
    assert.ok(Math.abs(all - pic - want) < 1e-3 * want);
    // Bounds of the picture lie exactly on the ring's inner edge.
    const pb = partsBounds(lithophaneParts(plan));
    assert.ok(Math.abs(pb.min[0]) < 1e-4 && Math.abs(pb.min[1]) < 1e-4 && Math.abs(pb.max[0] - W) < 1e-4 && Math.abs(pb.max[1] - H) < 1e-4);
  }
});

test("border width follows borderMm", () => {
  const plan = plans[0][1];
  const W = plan.gw * plan.cellMm, H = plan.gh * plan.cellMm;
  const { min, max } = partsBounds(frameParts(plan, { frame: "none", borderMm: 3 }));
  assert.ok(Math.abs(min[0] + 3) < 1e-4 && Math.abs(max[1] - (H + 3)) < 1e-4 && Math.abs(max[0] - (W + 3)) < 1e-4);
  assert.equal(borderMesh(10, 10, 2, 1).indices.length / 3, 32);
});

test("stand: a separate flat block below the frame, with a leaning slot the print fits", () => {
  for (const [mode, plan] of plans) {
    const b = FRAME_DEFAULTS.borderMm, W = plan.gw * plan.cellMm, H = plan.gh * plan.cellMm, T = printThicknessMm(plan);
    const Wf = W + 2 * b, Hf = H + 2 * b;
    const [, stand] = frameParts(plan, { frame: "stand" });
    assert.equal(stand.name, "stand");
    const { depth, length, height, slotDepth, slot, tan } = standSize(Wf, Hf, T);
    const sb = partsBounds([stand]);
    // Flat on the bed, low, a gap below the frame and centred on it — not touching it.
    assert.ok(Math.abs(sb.min[2]) < 1e-6 && Math.abs(sb.max[2] - height) < 1e-4, `${mode}: lies flat, ${height} mm tall`);
    assert.ok(height < 20, "low: does not multiply the layer count");
    assert.ok(Math.abs(sb.max[1] - (-b - FRAME_DEFAULTS.standGapMm)) < 1e-4, `${mode}: a gap below the frame`);
    assert.ok(Math.abs((sb.min[0] + sb.max[0]) / 2 - W / 2) < 1e-4 && Math.abs(sb.max[0] - sb.min[0] - length) < 1e-4, `${mode}: centred`);
    // Volume = block − slot (a parallelogram of width `slot`, height `slotDepth`).
    const want = length * (depth * height - slot * slotDepth);
    assert.ok(Math.abs(meshVolume(stand.mesh) - want) < 1e-3 * want, `${mode}: stand ${meshVolume(stand.mesh)} vs ${want}`);
    // The slot fits the print with clearance, and leans back by the lean angle.
    assert.ok(slot > T && slot - T <= 0.5);
    assert.ok(Math.abs(Math.atan(tan) * 180 / Math.PI - FRAME_DEFAULTS.leanDeg) < 1e-9);
    assert.ok(FRAME_DEFAULTS.leanDeg >= 10 && FRAME_DEFAULTS.leanDeg <= 15);
  }
});

test("hanger: a tab above the top border with a through hole (genus 1)", () => {
  for (const [mode, plan] of plans) {
    const b = FRAME_DEFAULTS.borderMm, W = plan.gw * plan.cellMm, H = plan.gh * plan.cellMm, T = printThicknessMm(plan);
    const [, tab] = frameParts(plan, { frame: "hanger" });
    assert.equal(tab.name, "hanger");
    const { hangerWidthMm: tw, hangerHeightMm: th, holeMm, holeSides: n } = FRAME_DEFAULTS;
    const tb = partsBounds([tab]);
    assert.ok(Math.abs(tb.min[1] - (H + b)) < 1e-4 && Math.abs(tb.max[1] - (H + b + th)) < 1e-4, `${mode}: tab on the top border`);
    assert.ok(Math.abs(tb.min[0] - (W / 2 - tw / 2)) < 1e-4 && Math.abs(tb.max[0] - (W / 2 + tw / 2)) < 1e-4);
    assert.ok(Math.abs(tb.max[2] - T) < 1e-4 && Math.abs(tb.min[2]) < 1e-6);
    // The hole: less than the solid tab by the polygon's area, and a ring topologically.
    const solid = tw * th * T;
    const R = holeMm / 2 / Math.cos(Math.PI / n);
    const holeArea = 0.5 * n * R * R * Math.sin((2 * Math.PI) / n);
    const v = meshVolume(tab.mesh);
    assert.ok(v < solid, `${mode}: ${v} !< ${solid}`);
    assert.ok(Math.abs(v - (solid - holeArea * T)) < 1e-3 * solid, `${mode}: ${v} vs ${solid - holeArea * T}`);
    assert.equal(euler(tab.mesh), 0, "genus 1");
    // The hole's flats are at least the hole size apart: a 4 mm nail fits.
    assert.ok(2 * R * Math.cos(Math.PI / n) >= holeMm - 1e-9);
  }
  // The border alone is a ring too; the stand block is a ball.
  const plan = plans[0][1];
  assert.equal(euler(frameParts(plan, { frame: "none" })[0].mesh), 0);
  assert.equal(euler(frameParts(plan, { frame: "stand" })[1].mesh), 2);
  assert.equal(euler(hangerMesh(0, 0, 2)), 0);
});

test("withFrame moves everything to ≥ 0 and reports the framed size", () => {
  for (const [mode, plan] of plans) for (const kind of KINDS) {
    const b = 5, W = plan.gw * plan.cellMm, H = plan.gh * plan.cellMm;
    const pic = lithophaneParts(plan);
    const f = withFrame(pic, plan, { kind, borderMm: b });
    const { min, max } = partsBounds(f.parts);
    assert.ok(min[0] > -1e-4 && min[1] > -1e-4 && min[2] > -1e-6, `${mode}/${kind}: min ${min}`);
    assert.ok(Math.abs(min[0]) < 1e-4 && Math.abs(min[1]) < 1e-4);
    assert.ok(Math.abs(f.sizeMm.x - max[0]) < 1e-4 && Math.abs(f.sizeMm.y - max[1]) < 1e-4);
    assert.ok(Math.abs(f.sizeMm.x - (W + 2 * b)) < 1e-4);
    assert.equal(f.offset.x, b);
    const drop = kind === "stand" ? FRAME_DEFAULTS.standGapMm + standSize(W + 2 * b, H + 2 * b, printThicknessMm(plan)).depth : 0;
    assert.ok(Math.abs(f.offset.y - (b + drop)) < 1e-4, `${mode}/${kind}: offset ${f.offset.y}`);
    assert.ok(Math.abs(f.sizeMm.y - (H + 2 * b + drop + (kind === "hanger" ? FRAME_DEFAULTS.hangerHeightMm : 0))) < 1e-4);
    // Moving does not change a part's volume or closure.
    for (let i = 0; i < f.parts.length; i++) assertWatertight(f.parts[i].mesh, `${mode}/${kind}/${f.parts[i].name} moved`);
  }
  const moved = translateParts(lithophaneParts(plans[1][1]), 3, 4, 0);
  assert.ok(Math.abs(partsBounds(moved).min[0] - 3) < 1e-4);
  assert.equal(withFrame(lithophaneParts(plans[1][1]), plans[1][1]).offset.x, 0);
});

test("3MF: a framed export has more parts and a bigger size", () => {
  for (const [mode, plan] of plans) {
    const read = (zip: Uint8Array) => {
      const files = unzipSync(zip);
      const objs = strFromU8(files["3D/Objects/object_1.model"]).match(/<object /g)!.length;
      return { objs, ms: strFromU8(files["Metadata/model_settings.config"]), root: strFromU8(files["3D/3dmodel.model"]) };
    };
    const bare = read(lithophaneTo3MF(plan, { name: "bare" })!);
    for (const kind of ["stand", "hanger"] as const) {
      const framed = read(lithophaneTo3MF(plan, { name: "framed", frame: { kind } })!);
      assert.equal(framed.objs, bare.objs + 2, `${mode}/${kind}`);
      assert.ok(framed.ms.includes(kind), `${mode}/${kind}: part named`);
      // The writer centres by sizeMm: a bigger framed size moves the build origin down-left.
      const tr = (s: string) => s.match(/<item [^>]*transform="([^"]+)"/)![1].split(" ").map(Number);
      const a = tr(bare.root), c = tr(framed.root);
      const b = FRAME_DEFAULTS.borderMm;
      assert.ok(Math.abs((a[9] - c[9]) - b) < 1e-3, `${mode}/${kind}: x origin ${a[9]} → ${c[9]}`);
      assert.ok(a[10] - c[10] > b - 1e-3, `${mode}/${kind}: y origin ${a[10]} → ${c[10]}`);
    }
  }
});
