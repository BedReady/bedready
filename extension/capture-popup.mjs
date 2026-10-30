// Capture the REAL popup, installed in Chrome, in both themes → public/extension/popup-{light,dark}.png
// (shown on bedready.io/extension) — and the dark one is what store screenshot 1 embeds.
// Run: `node extension/build.mjs && node extension/capture-popup.mjs` (needs puppeteer-core, as
// installed-test.mjs does). Installed rather than opened as a file, so the printer picker is filled
// from the real settings code and the "On download" switches exist (they hide without a downloads API).
import puppeteer from "puppeteer-core";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const EXT = dirname(fileURLToPath(import.meta.url));
const OUT = join(EXT, "..", "public", "extension");
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, pipe: true,
  ignoreDefaultArgs: ["--disable-extensions"], args: ["--enable-unsafe-extension-debugging", "--no-first-run"],
});
try {
  const b = await browser.target().createCDPSession();
  const { id } = await b.send("Extensions.loadUnpacked", { path: EXT });
  const page = await browser.newPage();
  await page.setViewport({ width: 352, height: 800, deviceScaleFactor: 2 });
  for (const theme of ["light", "dark"]) {
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: theme }]);
    await page.goto(`chrome-extension://${id}/popup.html`);
    await page.waitForSelector("#target option");
    await page.evaluate(() => { document.getElementById("prefs").open = true; });
    const h = await page.evaluate(() => Math.ceil(document.documentElement.getBoundingClientRect().height));
    await page.screenshot({ path: join(OUT, `popup-${theme}.png`), clip: { x: 0, y: 0, width: 352, height: h } });
    console.log(`popup-${theme}.png  352×${h} @2x`);
  }
} finally {
  await browser.close();
}
