# BedReady browser extension (scaffold)

Brings the BedReady converter to where U1 owners actually get files: a "→ U1 ✨" button next to
`.3mf` downloads on **MakerWorld / Printables / Thingiverse**, plus a drag-drop popup. Conversion runs
**100% in the browser** using the *same* engine as the website (`../src/lib/convert.ts`) — nothing is
uploaded. This matches/contests the competing ~1k-user "3MF to U1 – Universal" extension (Eric Reid),
where download-interception is the discovery hook (see `../CONVERTER-STRATEGY.md`, P2).

## Build

```bash
node extension/build.mjs      # bundles src/* -> dist/*, then packages BOTH store zips into ../public:
                              #   bedready-extension.zip (Chrome/Edge) + bedready-firefox.zip (Firefox)
```

The engine is three-free, so each bundle is small. The bundles are **cross-browser** (`src` uses
`browser ?? chrome`, which is promise-based in both Firefox and Chrome MV3); only the manifest differs.

## Load (Chrome/Edge)

1. `node extension/build.mjs`
2. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select `extension/`.
3. Visit a model page on MakerWorld/Printables/Thingiverse, or click the toolbar icon to drag-drop.

## Load (Firefox)

Firefox needs the **Firefox manifest** (`manifest.firefox.json`) as `manifest.json`. The packaged
`../public/bedready-firefox.zip` already has it. To load unpacked from the repo:

1. `node extension/build.mjs`
2. `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → select
   `public/bedready-firefox.zip` (or a copy of `extension/` with `manifest.firefox.json` renamed to
   `manifest.json`).
3. **Grant host access:** in Firefox MV3, `host_permissions` are opt-in — open the add-on's permissions
   and enable access to the three sites, or interception/in-page fetches won't run.

Firefox differences (handled): background is a non-persistent **event page** (`background.scripts`, not a
service worker); `browser_specific_settings.gecko.id` is required for signing/AMO. Publishing goes to
**addons.mozilla.org (AMO)**, not the Chrome Web Store.

## Safari (macOS/iOS)

Safari doesn't take a zip — a web extension must be wrapped in a native app built with **Xcode** and
distributed via the **Mac App Store** (or notarized), which needs an **Apple Developer account ($99/yr)**.
Apple ships a converter that turns our web extension into an Xcode project. We wrap that in a script so
the generated project is clean and reproducible:

```bash
node extension/build.mjs        # bundle dist/
node extension/pack-safari.mjs  # → safari/BedReady/BedReady.xcodeproj  (gitignored)
```

`pack-safari.mjs` stages a **clean copy** of only the packaged files into `.safari-src/` (so the app
Resources aren't polluted with src/docs/screenshots) and writes the Xcode project to `safari/` **outside**
`extension/` — the converter references the staged files in place, and writing inside `extension/` made it
copy its own output recursively ("file name too long"). It passes `--bundle-identifier io.bedready.BedReady`:
the converter derives the app id by swapping the last component for the app name and the extension id by
appending `.Extension`, so the last component **must** equal the app name or the two won't prefix-match
(`embedded binary's bundle id is not prefixed` build error). Don't delete `.safari-src/` — the project
references it.

Open the generated project, set your signing Team, build, and run; enable it in Safari → Settings →
Extensions (turn on "Allow unsigned extensions" in the Develop menu for local testing). Submit via App
Store Connect / Transporter.

**✅ Verified (2026-07-02):** the generated project builds — `xcodebuild … CODE_SIGNING_ALLOWED=NO` →
`BUILD SUCCEEDED`, producing `BedReady.app` with `BedReady Extension.appex` embedded in `Contents/PlugIns/`
and the full web extension (manifest + popup + `dist/{background,content,popup}.js`) in its Resources. The
only converter warning is the expected `downloads` key (see the limitation below).

**Important Safari limitation (verified):** Safari does **not** implement the `downloads` API, so the
**download-interception feature is disabled on Safari** — the converter warns about the `downloads`
manifest key, and `background.ts` already feature-detects it and no-ops. What still works on Safari: the
**popup (drag-drop)** and the **in-page "→ U1" button**. So on Safari the extension is "drop a file / click
the button," not auto-on-download.

**Safari download-naming quirk (verified, fixed):** saving a *named* file from the **popup** is the tricky
part, because the popup runs in the **extension origin** (`safari-web-extension://…`), where Safari:
(a) ignores the `<a download>` filename for `blob:` URLs regardless of MIME (WebKit bug 167341 — the file
saves as a nameless UUID "unknown file"), and (b) silently no-ops `data:` URL downloads entirely. The only
context where Safari honors a download filename is a **normal page origin**. So on WebKit the popup
(`popup.ts` → `saveResult()`) transfers the converted bytes to the **active tab** and runs the `<a download>`
there via `scripting.executeScript` (page origin → filename honored), falling back to a nameless in-popup
blob if the tab can't be scripted (a restricted page like Safari Settings / a blank Start Page, or an older
Safari without the scripting API). This needs `scripting` + `activeTab`, added to the **Safari manifest
only** by `pack-safari.mjs` — the Chrome/Firefox popups name blobs correctly and don't carry these. The
in-page "→ U1" button and the website (`bedready.io/convert`) already run in a page origin, so the shared
`download()` names files correctly there with no special handling. **User-facing note:** on Safari, keep a
normal web page in the active tab when using the popup (the file downloads via that tab). Verified working
2026-07-02.

Re-syncing after a code change: rebuild (`node extension/build.mjs`), then either re-run
`node extension/pack-safari.mjs` (regenerates the project — resets signing config), or, if you've already
configured signing, just copy the updated `dist/` (+ `manifest.json`/`popup.html`/icons if those changed)
into `.safari-src/` and rebuild in Xcode — the project references `.safari-src/` in place, so no re-convert
is needed. Don't re-run the converter over a project you've configured signing on — it overwrites.

## Architecture

- `manifest.json` — MV3; host permissions for the three sites; `downloads` permission; popup action;
  background service worker.
- `src/background.ts` — **primary mechanism: download-interception.** Listens for `.3mf` downloads from
  the target sites (`chrome.downloads.onCreated`), cancels the original, fetches + converts in the
  worker (nothing uploaded), and saves the U1-ready file. Selector-free — works no matter how the page's
  download button is built. (SWs lack `URL.createObjectURL`, so it hands `chrome.downloads` a base64
  `data:` URL.)
- `src/content.ts` — secondary: injects a "→ U1" button next to plain `<a href="*.3mf">` links (rare on
  these JS-driven sites; interception is the real path).
- `src/popup.ts` — drag-drop fallback (always works, site-independent); reports the diff + warnings.
- `build.mjs` — esbuild bundles each entry with the shared core inlined, then packages both store zips
  (Chrome + Firefox) from the same `dist/` + the two manifests.
- `manifest.json` (Chrome) / `manifest.firefox.json` (Firefox) — identical except background type
  (service worker vs event page) and the Firefox `gecko` add-on id.

## Smoke test (automated, real Chrome)

```bash
node extension/build.mjs
npm install --no-save puppeteer-core@^23   # not a project dep
node extension/smoke-test.mjs
```

`smoke-test.mjs` serves the extension dir and drives the **built** `popup.html` + `dist/popup.js` in
your installed Chrome: uploads a real `.3mf`, waits for the conversion, and validates the downloaded
output. The popup/content scripts use only DOM + the bundled engine (no `chrome.*` APIs), so this is a
faithful test of the shipped code. (Chrome 137+ blocks `--load-extension` via automation, so we load
the page directly rather than as an installed extension.)

**✅ Verified (2026-07-01):** popup loads + converts in real Chrome, including the **Full Spectrum
branch** — an 8-colour painted file shows the option, and clicking Convert keeps all 8 colours (4
filaments + 3 dithered mixes) in a valid U1 file with tower-safety (`rib`) + speed caps applied. The
smoke test drives both paths (drop-and-go and the Full Spectrum click). No runtime JS errors (the lone
404 is the browser's automatic favicon request). Run with a file Chrome can read:
`SMOKE_FILE=/path/to.3mf node extension/smoke-test.mjs` (macOS TCC can block Chrome from `~/Downloads`).

## Status / known gaps

- **Popup path:** ✅ verified in real Chrome, incl. Full Spectrum for >4-colour painted files (above).
- **Full Spectrum everywhere:** the popup offers it (default on, with an off toggle); the interception
  and in-page button apply it automatically (keep every colour). It's a no-op for ≤4-colour/unpainted
  files, so those convert byte-identically to before.
- **Download-interception (`background.ts`):** ⚠️ implemented, not yet runtime-tested (extension can't
  be auto-loaded under Chrome 137+). **Manual test:** load unpacked → download a `.3mf` from MakerWorld
  (try a >4-colour model too) → a `*.u1.3mf` should appear with a green `✓U1` badge + toast; a
  multicolour file's toast should read "Kept all N colours via Full Spectrum." If nothing happens, open
  the **service-worker console** (`chrome://extensions` → the card's "service worker" → inspect) — it
  logs the download URL + any error. Most likely follow-up: the file comes from a **CDN host** not in
  `host_permissions` (the SW fetch needs it) — the logged URL says which host to add.
- **Content-script selectors:** secondary (interception is the real path). Now case-insensitive and also
  matches `<a download="*.3mf">`, but still won't catch a pure-JS button with no anchor.
- **Icons:** ✅ `icon128.png` is in the manifest + package.
- **Colour-slot editor / by-layer M600:** the full per-slot editor + M600 opt-in live on
  bedready.io/convert (the popup links out); the popup itself covers profile-swap + Full Spectrum.
