// Generate the Safari (macOS) Xcode project from the built web extension using Apple's converter.
// Requires macOS + Xcode. Run:  node extension/build.mjs && node extension/pack-safari.mjs
// Output: <repo>/safari/ (gitignored — it snapshots dist and is machine/team-specific). Open the
// generated BedReady.xcodeproj in Xcode, set your signing Team, build, and submit via App Store Connect.
//
// We convert a CLEAN staging copy (only the packaged files) and write the project OUTSIDE extension/,
// so the converter can't copy its own output into the app Resources (that caused an infinite path
// nest → "file name too long" build failure).
//
// NOTE: Safari has no `downloads` API, so download-interception is off there (background.ts feature-
// detects it). The popup (drag-drop) and the in-page "→ U1" button work — both save via <a download>.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { rmSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const staging = resolve(repo, ".safari-src"); // clean web-extension dir (only what the store package has)
const out = resolve(repo, "safari"); // generated Xcode project

rmSync(staging, { recursive: true, force: true });
rmSync(out, { recursive: true, force: true });
mkdirSync(resolve(staging, "dist"), { recursive: true });
for (const f of ["popup.html", "icon16.png", "icon32.png", "icon48.png", "icon128.png"])
  copyFileSync(resolve(here, f), resolve(staging, f));
// Safari-only manifest tweak: the popup can't name a download from the extension origin (Safari drops the
// <a download> filename for blobs and won't download data: URLs), so on Safari the popup injects the save
// into the active tab (page origin, where the name is honored). That needs `scripting` + `activeTab` —
// added HERE so the Chrome/Firefox manifests don't carry permissions only Safari uses.
const mf = JSON.parse(readFileSync(resolve(here, "manifest.json"), "utf8"));
mf.permissions = [...new Set([...(mf.permissions || []), "scripting", "activeTab"])];
// App Store rejects a Safari-extension manifest description over 112 chars (Chrome allows 132), so use a
// shorter one for the Safari build only — the Chrome/Firefox manifest keeps its own.
mf.description = "Convert MakerWorld/Bambu/Prusa .3mf files for the Snapmaker U1 — 100% in your browser, nothing uploaded.";
writeFileSync(resolve(staging, "manifest.json"), JSON.stringify(mf, null, 2));
for (const f of ["background.js", "content.js", "popup.js"]) copyFileSync(resolve(here, "dist", f), resolve(staging, "dist", f));
mkdirSync(out, { recursive: true });

execFileSync(
  "xcrun",
  [
    "safari-web-extension-converter", staging,
    "--project-location", out,
    "--app-name", "BedReady",
    // The converter derives the APP id by replacing the last component with the app name, and the
    // EXTENSION id by appending ".Extension" — so the last component MUST equal the app name, or the two
    // won't prefix-match ("embedded binary's bundle id is not prefixed" build error).
    "--bundle-identifier", "io.bedready.BedReady",
    "--macos-only", "--no-open", "--no-prompt", "--force",
  ],
  { stdio: "inherit" },
);
// The App Store rejects a Mac archive whose Info.plist lacks LSApplicationCategoryType; the converter
// omits it. Insert the category into the generated APP Info.plist (not the extension's).
const appPlist = resolve(out, "BedReady", "BedReady", "Info.plist");
execFileSync("plutil", ["-insert", "LSApplicationCategoryType", "-string", "public.app-category.developer-tools", appPlist], { stdio: "inherit" });
// The app uses only exempt encryption (standard HTTPS, no custom crypto) — declare it so App Store Connect
// doesn't block every build on the export-compliance question.
execFileSync("plutil", ["-insert", "ITSAppUsesNonExemptEncryption", "-bool", "NO", appPlist], { stdio: "inherit" });
// NOTE: don't rename the app/target in Xcode — the App Store bundle name can't contain characters like ':'.
// The store display name ("BedReady: 3MF Converter") goes in App Store Connect only; the bundle stays "BedReady".
// Keep .safari-src/ — the generated project REFERENCES these files in place (it doesn't copy them),
// so deleting it would break the build. Both .safari-src/ and safari/ are gitignored. After changing
// the extension, re-run this (regenerates the project) or copy new dist into .safari-src/dist + rebuild.
console.log("\n✓ Safari project → safari/BedReady/BedReady.xcodeproj  — open in Xcode, set your signing Team, build.");
