// Small hostile files that used to cost seconds to hours of CPU (2026-10-02 security review).
// Each case is a few hundred bytes; each must now fail or finish fast. Run: `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { zipSync, strToU8 } from "fflate";
import { boundedUnzip, applyPrusaVolumePaint, extractMeshFromBuffer } from "./paint.ts";

const MB = 1024 * 1024;

/** A zip whose one entry inflates to `real` bytes of zeros while its headers claim `claimed`. */
function lyingZip(real: number, claimed: number): Uint8Array {
  const z = zipSync({ "3D/big.bin": new Uint8Array(real) }, { level: 9 });
  const v = new DataView(z.buffer, z.byteOffset, z.byteLength);
  for (let i = 0; i + 4 <= z.length; i++) {
    const sig = v.getUint32(i, true);
    if (sig === 0x04034b50) v.setUint32(i + 22, claimed, true); // local header: uncompressed size
    if (sig === 0x02014b50) v.setUint32(i + 24, claimed, true); // central directory: the same
  }
  return z;
}

test("boundedUnzip: a header that understates the size does not get past the cap", () => {
  const z = lyingZip(64 * MB, 16);
  const t = performance.now();
  const r = boundedUnzip(z, 1 * MB);
  assert.equal(r.overflow, true);
  assert.ok(r.inflated < 20 * MB, `inflated ${r.inflated} of 64 MB: the cut came after the work`);
  assert.equal(r.out["3D/big.bin"], undefined, "a cut-off entry must not be returned half-inflated");
  assert.ok(performance.now() - t < 1000);
});

test("boundedUnzip: one entry past its own limit is reported by name", () => {
  const r = boundedUnzip(lyingZip(4 * MB, 16), 100 * MB, (name) => (name.endsWith(".bin") ? 1 * MB : Infinity));
  assert.equal(r.overflow, false);
  assert.equal(r.entryOverflow?.name, "3D/big.bin");
});

test("boundedUnzip: an honest archive comes back byte-identical", () => {
  const a = strToU8("<model/>".repeat(10_000));
  const b = new Uint8Array(300_000).map((_, i) => (i * 7919) & 255);
  const r = boundedUnzip(zipSync({ "3D/3dmodel.model": a, "Metadata/x.png": [b, { level: 0 }] }), 100 * MB);
  assert.equal(r.overflow, false);
  assert.deepEqual(r.out["3D/3dmodel.model"], a);
  assert.deepEqual(r.out["Metadata/x.png"], b);
});

test("applyPrusaVolumePaint: a triangle tag that never closes is linear, not quadratic", () => {
  const cfg = `<config><object id="1"><metadata type="object" key="extruder" value="1"/>` +
    `<volume firstid="0" lastid="0"><metadata type="volume" key="extruder" value="2"/></volume></object></config>`;
  const model = `<model><resources><object id="1"><mesh><triangles><triangle v1="0"${" ".repeat(200_000)}</triangles></mesh></object></resources></model>`;
  const t = performance.now();
  applyPrusaVolumePaint({ "Metadata/Slic3r_PE_model.config": strToU8(cfg), "3D/3dmodel.model": strToU8(model) });
  assert.ok(performance.now() - t < 1000, `took ${Math.round(performance.now() - t)} ms`);
});

test("neither triangle rewriter uses the backtracking pattern", () => {
  for (const f of ["paint.ts", "prusa-project.ts"]) {
    const src = readFileSync(new URL(`./${f}`, import.meta.url), "utf8");
    assert.ok(!src.includes("<triangle\\b([^>]*?)"), `${f} matches <triangle …/> with a lazy group before \\s*`);
  }
});

test("extractMeshFromBuffer: a component graph that doubles per level stops on the visit budget", () => {
  const levels = 30;
  let objs = "";
  for (let k = 1; k <= levels; k++) {
    objs += `<object id="${k}"><components><component objectid="${k + 1}"/><component objectid="${k + 1}"/></components></object>`;
  }
  objs += `<object id="${levels + 1}"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices>` +
    `<triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>`;
  const model = `<?xml version="1.0"?><model unit="millimeter"><resources>${objs}</resources><build><item objectid="1"/></build></model>`;
  const t = performance.now();
  assert.throws(() => extractMeshFromBuffer(zipSync({ "3D/3dmodel.model": strToU8(model) })), /too large/);
  assert.ok(performance.now() - t < 5000, `took ${Math.round(performance.now() - t)} ms`);
});
