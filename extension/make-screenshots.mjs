// Generate Chrome Web Store screenshots (1280×800 PNGs) for the BedReady extension.
// Renders designed scenes that accurately depict the extension, via the installed Chrome.
//
// "Accurately depict" is the store's rule and it is load-bearing here: scene 2 used to show a button
// labelled "✨ Make U1-ready", which no extension has ever put on a page. The real one says "→ U1",
// in solid violet-600 (see extension/src/content.ts). The palette below is the site's, not the
// pre-2026-08 navy-and-orange one the popup was redrawn away from.
// Run: node extension/make-screenshots.mjs   → writes extension/store-screenshots/*.png
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "store-screenshots");
mkdirSync(OUT, { recursive: true });

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const base = `
  * { box-sizing: border-box; margin: 0; }
  body { width: 1280px; height: 800px; overflow: hidden; font-family: -apple-system, system-ui, sans-serif;
    background: linear-gradient(135deg, #0b1120 0%, #131a2c 100%); color: #e2e8f0; }
  .wrap { width: 1280px; height: 800px; padding: 72px 80px; display: flex; flex-direction: column; }
  .brand { display: flex; align-items: center; gap: 12px; font-size: 30px; font-weight: 800; color: #fff; }
  /* one flex item, or the row gap opens a space inside the wordmark: "Bed Ready". */
  .wm { display: block; }
  .dot { width: 14px; height: 14px; border-radius: 999px;
    background-image: linear-gradient(100deg, #7c3aed, #06b6d4 55%, #84cc16); }
  .accent { color: #8b5cf6; }  /* violet-500 — the 600 is too dark on this ground */
  h1 { font-size: 60px; font-weight: 800; color: #fff; line-height: 1.07; letter-spacing: -0.02em; }
  .sub { font-size: 28px; color: #94a3b8; margin-top: 18px; }
  .pill { display: inline-flex; align-items: center; gap: 10px; background: rgba(139,92,246,.15);
    color: #c4b5fd; font-size: 22px; font-weight: 600; padding: 10px 20px; border-radius: 999px; }
  .card { background: #0f172a; border: 1px solid rgba(255,255,255,.1); border-radius: 20px;
    box-shadow: 0 30px 80px rgba(0,0,0,.5); }
`;

// 1) The popup (mirrors extension/popup.html), shown as a floating panel.
const scene1 = `<!doctype html><html><head><meta charset="utf-8"><style>${base}
  .row { flex: 1; display: flex; align-items: center; gap: 64px; margin-top: 40px; }
  .popup { width: 380px; padding: 28px; }
  /* the popup opens on the wordmark's spectrum sweep — its most recognisable element */
  .popup .rule { height: 4px; border-radius: 999px; margin-bottom: 18px;
    background-image: linear-gradient(100deg, #7c3aed, #06b6d4 55%, #84cc16); }
  .popup h2 { font-size: 22px; color: #fff; }
  .popup .ps { color: #94a3b8; font-size: 16px; margin-top: 4px; }
  .drop { margin-top: 20px; padding: 40px; text-align: center; border: 2px dashed #8b5cf6;
    border-radius: 14px; color: #cbd5e1; font-size: 18px; }
  .popup .link { margin-top: 18px; font-size: 15px; color: #94a3b8; }
</style></head><body><div class="wrap">
  <div class="brand"><span class="dot"></span><span class="wm">Bed<span class="accent">Ready</span></span></div>
  <div class="row">
    <div style="flex:1">
      <h1>Convert 3MF files<br>for the Snapmaker&nbsp;U1</h1>
      <p class="sub">Right in your browser. Nothing is uploaded.</p>
      <div style="margin-top:28px"><span class="pill">100% private · free</span></div>
    </div>
    <div class="card popup">
      <div class="rule"></div>
      <h2>3MF → Snapmaker U1</h2>
      <div class="ps">100% in your browser — nothing is uploaded.</div>
      <div class="drop">Drop a .3mf here, or click to choose</div>
      <div class="link">Full preview &amp; color editor at <span class="accent">bedready.io/convert</span></div>
    </div>
  </div>
</div></body></html>`;

// 2) The in-page "→ U1" button on a model download page — label, fill and radius as shipped.
const scene2 = `<!doctype html><html><head><meta charset="utf-8"><style>${base}
  .row { flex: 1; display: flex; align-items: center; gap: 64px; margin-top: 40px; }
  .browser { width: 560px; }
  .bar { display: flex; gap: 8px; padding: 14px 18px; border-bottom: 1px solid rgba(255,255,255,.08); }
  .bar i { width: 12px; height: 12px; border-radius: 999px; background: #334155; display: block; }
  .body { padding: 26px; }
  .thumb { height: 220px; border-radius: 14px; background: linear-gradient(135deg,#1e293b,#0b1120);
    display: flex; align-items: center; justify-content: center; color: #475569; font-size: 18px; }
  .dlrow { display: flex; gap: 12px; margin-top: 20px; }
  .btn { padding: 14px 20px; border-radius: 12px; font-size: 17px; font-weight: 600; }
  .ghost { background: rgba(255,255,255,.08); color: #cbd5e1; }
  .u1 { background: #7c3aed; color: #fff; }  /* violet-600, solid — content.ts injectButton */
</style></head><body><div class="wrap">
  <div class="brand"><span class="dot"></span><span class="wm">Bed<span class="accent">Ready</span></span></div>
  <div class="row">
    <div style="flex:1">
      <h1>A “→ U1” button,<br>right on the<br>download page</h1>
      <p class="sub">MakerWorld · Bambu · Printables · Thingiverse</p>
    </div>
    <div class="card browser">
      <div class="bar"><i></i><i></i><i></i></div>
      <div class="body">
        <div class="thumb">Multicolor model · 6 colors</div>
        <div class="dlrow">
          <div class="btn ghost">Download .3mf</div>
          <div class="btn u1">→ U1</div>
        </div>
      </div>
    </div>
  </div>
</div></body></html>`;

// 3) Before/after — correct colors + the real U1 profile.
const swatch = (cols) => cols.map((c) => `<span style="width:54px;height:54px;border-radius:10px;background:${c};display:block"></span>`).join("");
const scene3 = `<!doctype html><html><head><meta charset="utf-8"><style>${base}
  .row { flex: 1; display: flex; align-items: center; gap: 40px; margin-top: 36px; }
  .panel { flex: 1; padding: 30px; }
  .tag { font-size: 17px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
  .bad { color: #f87171; } .good { color: #34d399; }
  .sw { display: flex; gap: 12px; margin-top: 22px; }
  .note { margin-top: 22px; font-size: 17px; color: #94a3b8; }
</style></head><body><div class="wrap">
  <div class="brand"><span class="dot"></span><span class="wm">Bed<span class="accent">Ready</span></span></div>
  <h1 style="margin-top:30px">Correct colors &amp; the real U1 profile</h1>
  <div class="row">
    <div class="card panel">
      <div class="tag bad">✗ Dropped into Orca as-is</div>
      <div class="sw">${swatch(["#8a8a8a", "#9b9b9b", "#777", "#888"])}</div>
      <div class="note">Wrong profile · scrambled slots · broken swap pauses</div>
    </div>
    <div class="card panel">
      <div class="tag good">✓ After BedReady</div>
      <div class="sw">${swatch(["#f6c200", "#e23b2e", "#1c1c1c", "#2563eb"])}</div>
      <div class="note">Real Snapmaker U1 profile · colors mapped to the 4 slots</div>
    </div>
  </div>
</div></body></html>`;

const scenes = [scene1, scene2, scene3];

// Shot via Chrome's own --screenshot rather than puppeteer-core: this script is documented in
// STORE-LISTING.md as "regenerate anytime", and puppeteer-core is not a dependency of this repo, so
// that promise was false — the script threw ERR_MODULE_NOT_FOUND. Chrome is already required here
// either way, and it renders these scenes at exactly 1280×800 with no install step.
const tmp = join(tmpdir(), `bedready-shot-${process.pid}.html`);

/** True when the file is a PNG that actually reaches its IEND chunk. Chrome occasionally dies with
 *  SIGKILL mid-write when launches follow each other closely, and a half-written PNG is worse than a
 *  failed run: it looks like an asset and gets uploaded. (Giving each launch its own --user-data-dir
 *  avoids the race but makes Chrome redo first-run setup and hang for minutes — not worth it.) */
function isCompletePng(file) {
  let d;
  try { d = readFileSync(file); } catch { return false; }
  if (d.length < 8 || !d.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return false;
  for (let i = 8; i + 8 <= d.length; i += 12 + d.readUInt32BE(i)) {
    if (d.subarray(i + 4, i + 8).toString() === "IEND") return true;
  }
  return false;
}

try {
  for (let i = 0; i < scenes.length; i++) {
    writeFileSync(tmp, scenes[i]);
    const out = join(OUT, `screenshot-${i + 1}.png`);
    rmSync(out, { force: true });
    for (let attempt = 1; attempt <= 3 && !isCompletePng(out); attempt++) {
      try {
        execFileSync(CHROME, [
          "--headless", "--disable-gpu", "--hide-scrollbars",
          "--force-device-scale-factor=1", "--window-size=1280,800",
          `--screenshot=${out}`, `file://${tmp}`,
        ], { stdio: "ignore", timeout: 60_000 });
      } catch {
        rmSync(out, { force: true }); // never leave a partial file behind
      }
    }
    if (!isCompletePng(out)) throw new Error(`screenshot-${i + 1}.png did not render after 3 attempts`);
    console.log(`wrote screenshot-${i + 1}.png`);
  }
} finally {
  rmSync(tmp, { force: true });
}
console.log("done →", OUT);
