// Bundles the extension scripts (inlining the shared conversion core, ../src/lib/convert.ts — kept
// three-free so each bundle stays small) AND packages both store zips. Run: `node extension/build.mjs`.
//   → ../public/bedready-extension.zip  (Chrome / Edge — manifest.json, background = service_worker)
//   → ../public/bedready-firefox.zip    (Firefox — manifest.firefox.json, background = event page)
// The bundles are cross-browser (src uses `browser ?? chrome`), so only the manifest differs per store.
// ── PIN THE TIMEZONE BEFORE ANYTHING READS A CLOCK ──────────────────────────────────────────────
//
// fflate writes each entry's mtime as a DOS timestamp, and it derives that from the Date's LOCAL
// parts — getHours(), not getUTCHours(). So a fixed `mtime` is only fixed within one timezone: the
// same source packed in Riyadh and in UTC differs at byte 12, with identical length, which is what
// a timezone offset looks like in a DOS time field.
//
// That was the first version of this file's reproducibility fix, and it passed locally and failed in
// CI — "committed 175641 bytes, fresh 175641" and not equal. Set before the first import so nothing
// has cached the zone yet.
process.env.TZ = "UTC";

import { build } from "esbuild";
import { zipSync } from "fflate";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const r = (p) => resolve(here, p);

await build({
  entryPoints: [r("src/content.ts"), r("src/popup.ts"), r("src/background.ts")],
  bundle: true,
  format: "iife",
  // esbuild only needs a floor that supports the syntax we emit; both Chrome MV3 and Firefox 115+ run it.
  target: ["chrome110", "firefox115"],
  loader: { ".json": "json" },
  outdir: r("dist"),
  logLevel: "info",
});
console.log("✓ built extension/dist/{content,popup,background}.js");

// Package: shared assets + a per-store manifest (named manifest.json inside each zip).
const read = (p) => new Uint8Array(readFileSync(r(p)));
const shared = {
  "popup.html": read("popup.html"),
  "icon16.png": read("icon16.png"),
  "icon32.png": read("icon32.png"),
  "icon48.png": read("icon48.png"),
  "icon128.png": read("icon128.png"),
  "dist/background.js": read("dist/background.js"),
  "dist/content.js": read("dist/content.js"),
  "dist/popup.js": read("dist/popup.js"),
};
/**
 * Where the two zips go. `../public` normally — they are committed, because they are also the
 * artifacts uploaded to the Chrome Web Store and AMO, and a file generated at deploy time cannot be
 * uploaded from the repository.
 *
 * Overridable so `extension-artifact.test.mts` can build into a temp directory and compare, rather
 * than overwriting the committed files as a side effect of checking them.
 */
const OUT_DIR = process.env.EXT_OUT_DIR ? resolve(process.env.EXT_OUT_DIR) : r("../public");

/**
 * ── ONE FIXED TIMESTAMP, SO THE ARTIFACT IS BYTE-REPRODUCIBLE ───────────────────────────────────
 *
 * Without it `zipSync` stamps every entry with the clock, so two builds of identical source produce
 * two different files — three builds a minute apart measured as three different SHA-256s. That costs
 * two things. A rebuild is a binary diff in every commit that touches the extension, and — the
 * reason it is fixed here — "is the committed zip what this source produces?" becomes a question
 * nothing can answer. The bundles themselves are already deterministic; only the container was not.
 *
 * 1980-01-01 is the zip epoch: DOS time cannot represent anything earlier, so it is the floor rather
 * than an arbitrary date.
 */
const FIXED_MTIME = new Date("1980-01-01T00:00:00Z");

mkdirSync(OUT_DIR, { recursive: true }); // ensure the output dir exists (e.g. a fresh source checkout)
const pkg = (out, manifestFile) => {
  const files = { ...shared, "manifest.json": read(manifestFile) };
  const stamped = Object.fromEntries(Object.entries(files).map(([k, v]) => [k, [v, { mtime: FIXED_MTIME }]]));
  const zip = zipSync(stamped, { level: 9, mtime: FIXED_MTIME });
  writeFileSync(resolve(OUT_DIR, out), zip);
  console.log(`✓ packaged ${resolve(OUT_DIR, out)} (${(zip.length / 1024).toFixed(0)} KB)`);
};
pkg("bedready-extension.zip", "manifest.json");
pkg("bedready-firefox.zip", "manifest.firefox.json");
