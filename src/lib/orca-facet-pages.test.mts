// The filament landing pages: what the server renders, and which of them are offered for indexing.
// Run: `npm test`.
//
// Until Nov 2026 the server HTML of every /orca-filaments/<slug> page said "Loading filament
// catalog…" and nothing else, and all 367 brand × material combos were in the sitemap, 238 of them
// with one or two profiles.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import sitemapDefault from "../app/sitemap.ts";
import {
  orcaCombos,
  indexedOrcaCombos,
  isThinCombo,
  facetProfiles,
  resolveOrcaSlug,
  readOrcaManifest,
  MIN_INDEXED_COMBO_PROFILES,
} from "./orca-filaments.ts";

const unwrap = <T,>(m: T): T => (m as { default?: T }).default ?? m;
const sitemap = unwrap(sitemapDefault);
const PAGE = "src/app/[locale]/(converter)/orca-filaments/[slug]/page.tsx";

test("a facet's server list is exactly the profiles its filters select", () => {
  const m = readOrcaManifest();
  assert.ok(m, "manifest present");
  for (const c of orcaCombos().slice(0, 40)) {
    const r = resolveOrcaSlug(c.slug);
    assert.ok(r && r.kind === "combo", c.slug);
    const list = facetProfiles(r);
    assert.equal(list.length, c.count, c.slug);
    assert.ok(list.every((p) => p.vendor === c.brand && p.type === c.material), c.slug);
  }
  const pla = resolveOrcaSlug("pla");
  assert.ok(pla && pla.kind === "material");
  assert.equal(facetProfiles(pla).length, m.profiles.filter((p) => p.type === "PLA").length);
});

test("the slug page hands the server's list to the browser component", () => {
  const src = readFileSync(PAGE, "utf8");
  assert.match(src, /<OrcaFilaments\b[^>]*\binitialCatalog=\{initialCatalog\}/);
});

test("thin combos are noindex,follow and absent from the sitemap; the rest are listed", async () => {
  const thin = orcaCombos().filter(isThinCombo);
  assert.ok(thin.length > 0, "the current manifest has thin combos, or this test proves nothing");
  assert.ok(indexedOrcaCombos().every((c) => c.count >= MIN_INDEXED_COMBO_PROFILES));

  const urls = new Set((await sitemap()).map((e) => new URL(e.url).pathname));
  for (const c of thin) assert.ok(!urls.has(`/orca-filaments/${c.slug}`), `${c.slug} is thin but in the sitemap`);
  for (const c of indexedOrcaCombos()) assert.ok(urls.has(`/orca-filaments/${c.slug}`), `${c.slug} missing from the sitemap`);

  const src = readFileSync(PAGE, "utf8");
  assert.match(src, /robots:\s*\{\s*index:\s*false,\s*follow:\s*true\s*\}/);
  assert.match(src, /isThinCombo\(/);
});
