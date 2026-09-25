// Smoke-test the EXACT built extension bundle (extension/dist/popup.js + popup.html) in real Chrome.
// The popup/content scripts use only DOM + the bundled conversion engine (no chrome.* APIs), so
// serving the page and driving it is a faithful test of the shipped bundle. Chrome 149 blocks
// --load-extension via automation, so we load the page directly instead.
import puppeteer from "puppeteer-core";
import { readFileSync, mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, extname } from "node:path";
import { createServer } from "node:http";
import { unzipSync, strFromU8 } from "fflate";

import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
const EXT = dirname(fileURLToPath(import.meta.url));
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
// Override with SMOKE_FILE=/path/to.3mf — e.g. when macOS TCC blocks Chrome from reading ~/Downloads
// under automation, point it at a file in an unprotected location.
const SRC = process.env.SMOKE_FILE || `${homedir()}/Downloads/Keychain+S.3mf`;
const DL = mkdtempSync(join(tmpdir(), "u1ext-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json" };

const server = createServer((req, res) => {
  const p = join(EXT, decodeURIComponent(req.url.split("?")[0]));
  try {
    if (statSync(p).isFile()) {
      res.writeHead(200, { "content-type": MIME[extname(p)] || "application/octet-stream" });
      res.end(readFileSync(p));
      return;
    }
  } catch {}
  res.writeHead(404).end("nf");
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-first-run"] });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  const client = await page.createCDPSession();
  await client.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: DL, eventsEnabled: true }).catch(() => {});

  await page.goto(`http://127.0.0.1:${port}/popup.html`, { waitUntil: "networkidle0" });
  await page.waitForSelector("#file");
  console.log("✓ popup.html + dist/popup.js loaded in Chrome");

  await (await page.$("#file")).uploadFile(SRC);
  // A painted file with >4 colours shows a Full Spectrum choice + Convert button; a simple file converts
  // on its own. Wait for either, click Convert if it appears, then wait for the result.
  await page.waitForFunction(
    () => /Done|Error/.test(document.getElementById("status")?.textContent || "") || !!document.querySelector("#opts button"),
    { timeout: 20000 },
  );
  const convertBtn = await page.$("#opts button");
  if (convertBtn) {
    console.log("✓ Full Spectrum option shown (>4-colour file) — clicking Convert");
    await convertBtn.click();
  }
  await page.waitForFunction(() => /Done|Error/.test(document.getElementById("status")?.textContent || ""), { timeout: 20000 });
  console.log("popup status:", JSON.stringify(await page.$eval("#status", (el) => el.textContent)));

  let file = null;
  for (let i = 0; i < 40 && !file; i++) {
    const fs = readdirSync(DL).filter((f) => f.endsWith(".3mf") && !f.endsWith(".crdownload"));
    if (fs.length) file = fs[0];
    else await sleep(250);
  }
  if (file) {
    const e = unzipSync(new Uint8Array(readFileSync(join(DL, file))));
    const ps = Object.entries(e).find(([p]) => p.toLowerCase().endsWith("project_settings.config"));
    const cfg = ps ? JSON.parse(strFromU8(ps[1])) : {};
    console.log("✓ downloaded:", file);
    console.log("  printer:", cfg.printer_settings_id, "| colours:", JSON.stringify(cfg.filament_colour), "| tower:", cfg.wipe_tower_wall_type);
  } else console.log("✗ no converted file downloaded");
  console.log("page errors:", errors.length ? errors : "none");
} finally {
  await browser.close();
  server.close();
}
