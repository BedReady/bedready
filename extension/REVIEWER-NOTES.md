# Source code & reproducible build — for AMO reviewers

The add-on's `dist/*.js` files are produced by **esbuild** bundling the TypeScript sources below.
**No minification or obfuscation is applied** (esbuild `bundle: true`, no `minify`), so the shipped
JavaScript is readable and corresponds directly to the sources. `esbuild` combines multiple files into
one, and `fflate` is used only to write the store `.zip` — that's why source is submitted.

## Build environment
- **Node.js** — built/tested on v26.3.0 (any current LTS works)
- **Exact dependency versions** (see `package-lock.json`): `esbuild` 0.24.2, `fflate` 0.8.3
- **OS** — macOS or Linux; no OS-specific steps

## Build steps (from the archive root)
```bash
npm ci                    # installs esbuild + fflate at the locked versions
node extension/build.mjs  # bundles the sources and packages the store zips
```
This produces the three files shipped in the add-on:
- `extension/dist/background.js` ← `extension/src/background.ts`
- `extension/dist/content.js`    ← `extension/src/content.ts`
- `extension/dist/popup.js`      ← `extension/src/popup.ts`

Each inlines the shared conversion engine (`src/lib/convert.ts` + its imports). The script also writes
`public/bedready-firefox.zip` (and the Chrome zip); only `dist/*.js` + `manifest.json` + `popup.html` +
the icons form the add-on package.

A clean `npm ci && node extension/build.mjs` reproduces the shipped `dist/*.js` **byte-for-byte**
(esbuild output is deterministic; `tsconfig.json` is included because esbuild reads it).

## Source layout
- **Extension entry points:** `extension/src/{background,content,popup}.ts`
- **Shared conversion engine** (browser-agnostic, no network access): `src/lib/` —
  `convert.ts`, `targets.ts`, `paint.ts`, `swap-pauses.ts`, `filament-mixer.ts`, `mixed-filament.ts`
- **Only third-party code bundled into the add-on:** `fflate` (ZIP read/write). `esbuild` is build-only.
- **Firefox manifest:** `extension/manifest.firefox.json` (packaged as `manifest.json`).
- Cross-browser API access is via `const api = browser ?? chrome` (see the entry-point files).

## What the code does
Everything runs locally in the browser: it reads a `.3mf` the user downloads from
MakerWorld/Printables/Thingiverse, rewrites the slicer profile and colour assignments so the file prints
on a Snapmaker U1, and saves the result. **No servers, no network calls with user data, no telemetry,
no data collection** — matching the `data_collection_permissions: ["none"]` declaration.
