// A translated page must canonicalise to ITSELF.
//
// `alternates()` took only a path, so every locale got the unprefixed English URL: /de/convert
// emitted `canonical: https://bedready.io/convert` while ALSO announcing seven hreflang alternates.
// Those two statements contradict each other — hreflang describes a set of equal translations, a
// cross-language canonical says "index that one instead" — and Google honours the canonical. So six
// translated versions of every page carrying this were told not to exist, and the whole i18n effort
// was invisible in search. The file's own first line had always called the result "self-canonical".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { alternates, canonicalOnly } from "./seo.ts";

const LOCALES = ["en", "de", "es", "fr", "zh", "ja", "ar"];

test("each locale canonicalises to its own URL", () => {
  assert.equal(alternates("/convert", "en").canonical, "https://bedready.io/convert");
  assert.equal(alternates("/convert", "de").canonical, "https://bedready.io/de/convert");
  assert.equal(alternates("/convert", "ar").canonical, "https://bedready.io/ar/convert");
});

test("the canonical is always one of the page's own declared alternates", () => {
  for (const path of ["/convert", "/guides", "/extension", "/features", "/orca-filaments"]) {
    for (const l of LOCALES) {
      const a = alternates(path, l);
      assert.equal(a.canonical, a.languages[l], `${l}${path}: canonical must equal languages[${l}]`);
      assert.ok(Object.values(a.languages).includes(a.canonical));
    }
  }
});

test("hreflang still advertises every locale, unchanged", () => {
  const a = alternates("/convert", "de");
  assert.deepEqual(Object.keys(a.languages).sort(), ["ar", "de", "en", "es", "fr", "ja", "x-default", "zh"]);
  assert.equal(a.languages["x-default"], "https://bedready.io/convert", "x-default stays on English");
});

test("an unknown locale falls back to the unprefixed URL rather than inventing a prefix", () => {
  assert.equal(alternates("/convert", "kl").canonical, "https://bedready.io/convert");
});

test("canonicalOnly is untouched — those pages really are English at every prefix", () => {
  // lib/guides.ts and the filament catalogue render the same English body under every locale, so
  // they consolidate deliberately. Changing alternates() must not have changed that.
  assert.equal(canonicalOnly("/orca-filaments/anycubic").canonical, "https://bedready.io/orca-filaments/anycubic");
  assert.ok(!("languages" in canonicalOnly("/guides/x")), "canonicalOnly must not advertise translations");
});

test("no page still calls alternates() without a locale", () => {
  // The parameter is required, so tsc already enforces this — but a `// @ts-expect-error` or an
  // `any` would slip through, and this is the bug's exact shape.
  const walk = (d: string, out: string[] = []): string[] => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const f = join(d, e.name);
      if (e.isDirectory()) walk(f, out);
      else if (/\.tsx?$/.test(f)) out.push(f);
    }
    return out;
  };
  const bad: string[] = [];
  for (const f of walk("src/app")) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/\balternates\(\s*"[^"]+"\s*\)/g)) bad.push(`${f} — ${m[0]}`);
  }
  assert.deepEqual(bad, [], "these would canonicalise every locale onto English:\n  " + bad.join("\n  "));
});
