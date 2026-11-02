// The extension INSTALLED in real Chrome, download interception included — the path smoke-test.mjs
// cannot reach. Run: `node extension/build.mjs && node extension/installed-test.mjs [file.3mf]`
// (needs `npm install --no-save puppeteer-core@^23`).
//
// Chrome 137+ ignores `--load-extension`, which is why interception went untested from 0.1 to 0.4.
// What still works is DevTools: `Extensions.loadUnpacked` over a pipe, with
// `--enable-unsafe-extension-debugging`, and puppeteer's default `--disable-extensions` removed.
//
// A "MakerWorld" download is faked with the Fetch domain on BOTH the browser target (the page's
// download) and the service worker (its own fetch of the same URL), so nothing reaches the network.
// Downloads land in a temp folder via Browser.setDownloadBehavior — which also makes Chrome name the
// extension's save "download.3mf", so files are checked by CONTENT (the printer they declare). Without
// that override the save is named correctly (`Benchy.u1.3mf`), measured 2026-10-29.
import puppeteer from "puppeteer-core";
import { readFileSync, readdirSync, mkdtempSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { unzipSync, strFromU8 } from "fflate";

const EXT = dirname(fileURLToPath(import.meta.url));
const SRC = process.argv[2] || join(EXT, "..", "sample.3mf");
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const printerOf = (buf) => {
  const z = unzipSync(buf);
  const k = Object.keys(z).find((n) => /project_settings\.config$/.test(n));
  return k ? JSON.parse(strFromU8(z[k])).printer_settings_id : "(generic)";
};

async function run({ target, keep = false, file }) {
  const DL = mkdtempSync(join(tmpdir(), "br-installed-"));
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, pipe: true,
    ignoreDefaultArgs: ["--disable-extensions"], args: ["--enable-unsafe-extension-debugging", "--no-first-run"],
  });
  const logs = [];
  try {
    const b = await browser.target().createCDPSession();
    const { id } = await b.send("Extensions.loadUnpacked", { path: EXT });
    const swt = await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().includes(id));
    await b.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: DL });
    const popup = await browser.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.select("#target", target);
    if (keep) await popup.click("#keep");
    await sleep(300);
    await popup.close();

    const body = readFileSync(file).toString("base64");
    const fake = (s) => s.on("Fetch.requestPaused", (e) => s.send("Fetch.fulfillRequest", {
      requestId: e.requestId, responseCode: 200, body,
      responseHeaders: [{ name: "Content-Type", value: "application/octet-stream" }, { name: "Content-Disposition", value: 'attachment; filename="Benchy.3mf"' }],
    }).catch(() => {}));
    const sw = await swt.createCDPSession();
    sw.on("Runtime.consoleAPICalled", (e) => logs.push(e.args.map((a) => a.value ?? a.description).join(" ")));
    await sw.send("Runtime.enable");
    for (const s of [b, sw]) { fake(s); await s.send("Fetch.enable", { patterns: [{ urlPattern: "https://makerworld.com/*" }] }); }

    const page = await browser.newPage();
    await page.evaluate(() => {
      const a = document.createElement("a");
      a.href = "https://makerworld.com/models/benchy/Benchy.3mf";
      a.download = "Benchy.3mf";
      document.body.append(a);
      a.click();
    });
    await sleep(10000);
    const files = readdirSync(DL).filter((f) => !f.endsWith(".crdownload"));
    return { files: files.map((f) => ({ f, printer: printerOf(readFileSync(join(DL, f))) })), logs, DL };
  } finally {
    await browser.close();
  }
}

// The in-page MakerWorld button: a faked model page (MakerWorld's real markup hook, span.primaryButton),
// its f3mf endpoint answering with a signed CDN link, and the CDN serving the file. The page asks the
// endpoint; the service worker fetches the CDN bytes. `signedIn: false` answers 403 like the real site.
async function runMakerWorldButton({ file, signedIn = true }) {
  const DL = mkdtempSync(join(tmpdir(), "br-mw-"));
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, pipe: true,
    ignoreDefaultArgs: ["--disable-extensions"], args: ["--enable-unsafe-extension-debugging", "--no-first-run"],
  });
  const seen = [];
  try {
    const b = await browser.target().createCDPSession();
    const { id } = await b.send("Extensions.loadUnpacked", { path: EXT });
    const swt = await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().includes(id));
    await b.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: DL });
    const html = `<!doctype html><html><body><div class="panel"><div class="row"><div class="btn"><span class="primaryButton"><div><span>Open in Bambu Studio</span></div></span><span>▾</span></div></div></div></body></html>`;
    const body = readFileSync(file).toString("base64");
    const answer = (s) => s.on("Fetch.requestPaused", (e) => {
      const u = e.request.url;
      seen.push(u);
      const r = u.includes("/f3mf")
        ? signedIn
          ? { code: 200, type: "application/json", body: Buffer.from(JSON.stringify({ name: "Benchy.3mf", url: "https://public-cdn.bblmw.com/makerworld/model/Benchy.3mf?sig=x" })).toString("base64") }
          : { code: 403, type: "application/json", body: Buffer.from('{"code":1,"error":"Please log in to download models."}').toString("base64") }
        : u.includes("bblmw.com")
          ? { code: 200, type: "application/octet-stream", body }
          : { code: 200, type: "text/html", body: Buffer.from(html).toString("base64") };
      s.send("Fetch.fulfillRequest", { requestId: e.requestId, responseCode: r.code, body: r.body, responseHeaders: [{ name: "Content-Type", value: r.type }] }).catch(() => {});
    });
    const sw = await swt.createCDPSession();
    const patterns = [{ urlPattern: "https://makerworld.com/*" }, { urlPattern: "https://public-cdn.bblmw.com/*" }];
    for (const s of [b, sw]) { answer(s); await s.send("Fetch.enable", { patterns }); }
    const page = await browser.newPage();
    await page.goto("https://makerworld.com/en/models/1092486-benchy#profileId-42", { waitUntil: "domcontentloaded" });
    const btn = await page.waitForSelector("button[data-bedready-mw]", { timeout: 15000 }).catch(() => null);
    await sleep(500);
    const label = btn ? await btn.evaluate((e) => e.textContent) : "";
    if (btn) await btn.click();
    await sleep(signedIn ? 10000 : 2000);
    const toast = await page.evaluate(() => document.getElementById("bedready-toast")?.shadowRoot?.textContent || "");
    const files = readdirSync(DL).filter((f) => !f.endsWith(".crdownload"));
    return { button: !!btn, label, toast, seen, files: files.map((f) => ({ f, printer: printerOf(readFileSync(join(DL, f))) })) };
  } finally {
    await browser.close();
  }
}

let failed = 0;
const check = (ok, what) => { console.log(`${ok ? "✓" : "✗"} ${what}`); if (!ok) failed++; };

const u1 = await run({ target: "u1", file: SRC });
const conv = u1.files.find((x) => x.printer.startsWith("Snapmaker U1"));
check(!!conv, `U1: download intercepted and converted (${JSON.stringify(u1.files)})`);

const x1 = await run({ target: "bambu-x1c", keep: true, file: SRC });
check(x1.files.some((x) => x.printer === "Bambu Lab X1 Carbon"), "X1 Carbon: converted for the chosen printer");
check(x1.files.length === 2, `keep original: both files present (${x1.files.length})`);

if (conv) {
  const again = await run({ target: "u1", file: join(u1.DL, conv.f) });
  check(again.logs.some((l) => /already for target/.test(l)) && again.files.length === 1, "a file already set up for the U1 is left as downloaded");
}
const mw = await runMakerWorldButton({ file: SRC });
check(mw.button && mw.label === "Download for U1", `MakerWorld page: "Download for U1" appears under Open in Bambu Studio (${mw.label})`);
check(mw.seen.some((u) => u.includes("/api/v1/design-service/instance/42/f3mf")), "MakerWorld page: it asks for the profile picked in the URL (#profileId-42)");
check(mw.files.some((x) => x.printer.startsWith("Snapmaker U1")), `MakerWorld page: the file is converted and saved (${JSON.stringify(mw.files)})`);
const out = await runMakerWorldButton({ file: SRC, signedIn: false });
check(out.files.length === 0 && /Sign in to MakerWorld/.test(out.toast), `MakerWorld page, signed out: says to sign in, saves nothing (${out.toast})`);
process.exit(failed ? 1 : 0);
