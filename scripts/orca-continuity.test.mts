// A catalogue refresh must not break anything already out there (Turki, Nov 19 2026, on the
// OrcaSlicer 2.5.1 refresh). Every profile id and landing page served before it keeps working:
//   - every old id still has public/orca-filaments/profiles/<id>.json (a saved download link);
//   - every old id is either still in the manifest or in aliases.json (renamed → successor; null →
//     kept in the manifest as a legacy entry);
//   - the preset an old id now leads to carries the SAME filament_id it had, because presets
//     already on U1s and in projects match on it;
//   - every old landing page still resolves, or redirects to one that does.
// The fixtures are frozen: a later refresh adds to them, it never edits them.
// Run: `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolveOrcaSlug, readOrcaManifest } from "../src/lib/orca-filaments.ts";

const DIR = "public/orca-filaments";
const lines = (f: string) => readFileSync(f, "utf8").split("\n").filter((l) => l && !l.startsWith("#"));
const OLD_IDS = lines("scripts/fixtures/orca-ids-2026-11.tsv").map((l) => {
  const [id, fid] = l.split("\t");
  return { id, fid: fid === "-" ? null : fid };
});
const OLD_FACETS = lines("scripts/fixtures/orca-facets-2026-11.txt");
const aliases = JSON.parse(readFileSync(`${DIR}/aliases.json`, "utf8")) as {
  profiles: Record<string, string | null>;
  facets: Record<string, string>;
};
const manifest = readOrcaManifest()!;
const listed = new Map(manifest.profiles.map((p) => [p.id, p as typeof p & { legacy?: boolean }]));
const fidOf = (id: string) => {
  const f = JSON.parse(readFileSync(`${DIR}/profiles/${id}.json`, "utf8").replace(/^﻿/, "")).filament_id;
  return (Array.isArray(f) ? f[0] : f) ?? null;
};

test("the fixtures are the full pre-refresh catalogue", () => {
  assert.equal(OLD_IDS.length, 1271);
  assert.equal(OLD_FACETS.length, 451);
});

test("every old profile id still downloads and is listed or aliased", () => {
  for (const { id } of OLD_IDS) {
    assert.ok(existsSync(`${DIR}/profiles/${id}.json`), `profiles/${id}.json is gone`);
    assert.ok(listed.has(id) || id in aliases.profiles, `${id} is neither in the manifest nor in aliases.json`);
  }
});

test("aliases are consistent with the manifest", () => {
  for (const [id, to] of Object.entries(aliases.profiles)) {
    assert.ok(existsSync(`${DIR}/profiles/${id}.json`), `aliased ${id} has no file`);
    if (to === null) {
      assert.ok(listed.get(id)?.legacy, `${id} has no successor, so it must stay listed as legacy`);
    } else {
      assert.ok(!listed.has(id), `${id} is renamed to ${to} but still listed`);
      assert.ok(listed.has(to) && !listed.get(to)!.legacy, `${id} → ${to}, which is not a current profile`);
    }
  }
  for (const p of listed.values()) {
    assert.ok(existsSync(`${DIR}/${p.file}`), `${p.id}: ${p.file} missing`);
    if (p.legacy) assert.equal(aliases.profiles[p.id], null, `legacy ${p.id} must be aliased to null`);
  }
});

test("an old id leads to a preset with its old filament_id", () => {
  for (const { id, fid } of OLD_IDS) {
    assert.equal(fidOf(id), fid, `profiles/${id}.json changed filament_id`);
    const to = aliases.profiles[id];
    if (to) assert.equal(fidOf(to), fid, `${id} → ${to} changed filament_id`);
  }
});

test("every old landing page resolves or redirects to one that does", () => {
  for (const slug of OLD_FACETS) {
    if (resolveOrcaSlug(slug)) continue;
    const to = aliases.facets[slug];
    assert.ok(to, `/orca-filaments/${slug} would 404`);
    assert.ok(resolveOrcaSlug(to), `/orca-filaments/${slug} → ${to}, which does not resolve`);
  }
  for (const slug of Object.keys(aliases.facets)) {
    assert.equal(resolveOrcaSlug(slug), null, `${slug} is a live page; a redirect would hide it`);
  }
});

test("the slug page redirects a moved landing page instead of 404ing", () => {
  const src = readFileSync("src/app/[locale]/(converter)/orca-filaments/[slug]/page.tsx", "utf8");
  assert.match(src, /permanentRedirect\(`\/orca-filaments\/\$\{moved\}`\)/);
  assert.match(src, /aliases\.json/);
});
