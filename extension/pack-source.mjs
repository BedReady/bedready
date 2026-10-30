// Assemble the source archive to submit to AMO (Firefox add-on review requires reproducible source,
// because the add-on's dist/*.js are bundled by esbuild). Produces a zip whose layout matches the repo
// so a reviewer can run `npm ci && node extension/build.mjs` from the archive root and reproduce dist/.
// Written OUTSIDE public/ (not served) — run: `node extension/pack-source.mjs`.
import { zipSync } from "fflate";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const read = (p) => new Uint8Array(readFileSync(resolve(root, p)));

// What the bundles are built FROM is read off esbuild's own metafile, not listed by hand. The hand list
// went stale once already: 0.4.0/0.5.0 added extension/src/settings.ts and handoff.ts, the archive
// left them out, and an AMO reviewer could not have rebuilt dist/ from it (found 2026-10-29).
import { build } from "esbuild";
const meta = await build({
  entryPoints: ["extension/src/content.ts", "extension/src/popup.ts", "extension/src/background.ts"].map((p) => resolve(root, p)),
  absWorkingDir: root, bundle: true, write: false, metafile: true, outdir: "out", logLevel: "silent",
});
const imported = Object.keys(meta.metafile.inputs).filter((p) => !p.startsWith("node_modules/"));

// Plus what the build needs that nothing imports: config, manifests, the popup page, icons.
const paths = [...new Set([
  "package.json",
  "package-lock.json",
  "tsconfig.json", // esbuild reads it (alwaysStrict etc.) — required for a byte-identical rebuild
  "extension/REVIEWER-NOTES.md",
  "extension/build.mjs",
  "extension/messages-plugin.mjs", // build.mjs imports it; the messages/*.json it reads come in via the metafile
  "extension/manifest.json",
  "extension/manifest.firefox.json",
  "extension/popup.html",
  "extension/icon16.png",
  "extension/icon32.png",
  "extension/icon48.png",
  "extension/icon128.png",
  ...imported,
])];

const files = Object.fromEntries(paths.map((p) => [p, read(p)]));
const zip = zipSync(files, { level: 9 });
const out = resolve(root, "bedready-extension-source.zip"); // repo root, gitignored — upload this to AMO
writeFileSync(out, zip);
console.log(`✓ ${paths.length} files → ${out} (${(zip.length / 1024).toFixed(0)} KB)`);
