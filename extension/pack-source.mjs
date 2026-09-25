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

// Exact set needed to reproduce the build (entry points + the engine's transitive imports + build config).
const paths = [
  "package.json",
  "package-lock.json",
  "tsconfig.json", // esbuild reads it (alwaysStrict etc.) — required for a byte-identical rebuild
  "extension/REVIEWER-NOTES.md",
  "extension/build.mjs",
  "extension/manifest.json",
  "extension/manifest.firefox.json",
  "extension/popup.html",
  "extension/icon16.png",
  "extension/icon32.png",
  "extension/icon48.png",
  "extension/icon128.png",
  "extension/src/background.ts",
  "extension/src/content.ts",
  "extension/src/popup.ts",
  "src/lib/convert.ts",
  "src/lib/targets.ts",
  "src/lib/u1-profile.json",
  "src/lib/paint.ts",
  "src/lib/swap-pauses.ts",
  "src/lib/filament-mixer.ts",
  "src/lib/mixed-filament.ts",
];

const files = Object.fromEntries(paths.map((p) => [p, read(p)]));
const zip = zipSync(files, { level: 9 });
const out = resolve(root, "bedready-extension-source.zip"); // repo root, gitignored — upload this to AMO
writeFileSync(out, zip);
console.log(`✓ ${paths.length} files → ${out} (${(zip.length / 1024).toFixed(0)} KB)`);
