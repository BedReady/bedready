// The extension's availability copy follows the store listings, and the hero button follows the
// visitor's browser. Run: `npm test`.
//
// Until Nov 2026 four messages in seven languages said the extension was "Available for Chrome,
// Edge, Firefox, and Safari" while SAFARI_APPSTORE_URL was empty.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { IntlMessageFormat } from "intl-messageformat";
import { installTargetFor, safariArg, SAFARI_LIVE } from "./extension-stores.ts";

const LOCALES = ["en", "ar", "de", "es", "fr", "ja", "zh"];
const SAFARI_KEYS = ["extension.intro", "extension.metaDescription", "extension.desktopOnly", "features.note"];

const get = (m: Record<string, unknown>, k: string) =>
  k.split(".").reduce<unknown>((o, p) => (o as Record<string, unknown>)?.[p], m) as string;

test("every message that names the browsers says Safari only when the listing is live", () => {
  for (const l of LOCALES) {
    const m = JSON.parse(readFileSync(`messages/${l}.json`, "utf8"));
    for (const k of SAFARI_KEYS) {
      const src = get(m, k);
      assert.match(src, /\{safari, select, live \{/, `${l} ${k}: no safari select`);
      const live = String(new IntlMessageFormat(src, l).format({ safari: "live" }));
      const soon = String(new IntlMessageFormat(src, l).format({ safari: "soon" }));
      assert.ok(/Safari|سفاري/.test(live), `${l} ${k}: the live wording does not name Safari`);
      assert.notEqual(live, soon, `${l} ${k}`);
    }
    // The privacy intro is rendered on MakerRun, not here, so it is plain text: it must not
    // promise Safari while the listing is pending.
    if (!SAFARI_LIVE) {
      const p = get(m, "privacy.intro");
      assert.doesNotMatch(p, /Firefox(,| und| y| et| و|、| 和)? ?(and )?Safari\)/, `${l} privacy.intro claims Safari`);
    }
  }
  assert.equal(new IntlMessageFormat(get(JSON.parse(readFileSync("messages/en.json", "utf8")), "extension.intro"), "en").format(safariArg)
    .toString()
    .includes(SAFARI_LIVE ? "and Safari" : "Safari is coming soon"), true);
});

test("the pages pass the safari argument to every one of those messages", () => {
  const ext = readFileSync("src/app/[locale]/(converter)/extension/page.tsx", "utf8");
  assert.match(ext, /t\("intro", safariArg\)/);
  assert.match(ext, /t\("metaDescription", safariArg\)/);
  assert.match(ext, /t\("desktopOnly", safariArg\)/);
  assert.match(ext, /<AppJsonLd[^>]*values=\{safariArg\}/);
  assert.doesNotMatch(ext, /const (CHROME_WEBSTORE|FIREFOX_AMO|SAFARI_APPSTORE)_URL/, "the store URLs live in lib/extension-stores.ts");
  const features = readFileSync("src/app/[locale]/(converter)/features/page.tsx", "utf8");
  assert.match(features, /t\("note", safariArg\)/);
});

test("the hero button aims at the visitor's browser", () => {
  const ua = {
    chromeMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    edgeWin: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
    firefoxLinux: "Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0",
    safariMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
    iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
    androidChrome: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
    androidFirefox: "Mozilla/5.0 (Android 14; Mobile; rv:133.0) Gecko/133.0 Firefox/133.0",
  };
  assert.equal(installTargetFor(ua.chromeMac), "chrome");
  assert.equal(installTargetFor(ua.edgeWin), "edge");
  assert.equal(installTargetFor(ua.firefoxLinux), "firefox");
  assert.equal(installTargetFor(ua.safariMac), SAFARI_LIVE ? "safari" : "other");
  assert.equal(installTargetFor(ua.iphone), "other");
  assert.equal(installTargetFor(ua.androidChrome), "other");
  assert.equal(installTargetFor(ua.androidFirefox), "other");
});
