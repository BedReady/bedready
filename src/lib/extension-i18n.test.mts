// The extension's translated text (extension/src/i18n.ts, strings in messages/<locale>.json `ext`).
// Parity across locales is i18n-parity.test.mts's job; this covers what parity cannot see: a
// translation that is present but does not FORMAT (a stray brace, a plural with no `other`) would
// show its raw ICU text in the popup, and only in that one language.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { IntlMessageFormat } from "intl-messageformat";
import { pickLocale, t, warningText } from "../../extension/src/i18n.ts";

const LOCALES = ["en", "ar", "de", "es", "fr", "ja", "zh"] as const;
const ext = (l: string) => JSON.parse(readFileSync(`messages/${l}.json`, "utf8")).ext as Record<string, string>;
const VALUES = { printer: "U1", file: "a.3mf", out: "a.u1.3mf", size: 0.4, total: 6, mixes: 2, kept: 4, count: 3, heads: 4, dx: 1, dy: 2, message: "x" };

test("every extension string formats in every locale, with the placeholders English uses", () => {
  const en = ext("en");
  for (const l of LOCALES) {
    const m = ext(l);
    for (const [k, src] of Object.entries(m)) {
      const out = String(new IntlMessageFormat(src, l).format(VALUES));
      assert.ok(!/[{}]/.test(out), `${l} ext.${k} left a brace: ${out}`);
      // A translation that drops {file} or {printer} tells the user less than English does.
      for (const ph of en[k].match(/\{(\w+)[},]/g) ?? []) {
        const name = ph.slice(1, -1);
        assert.ok(src.includes(`{${name}`), `${l} ext.${k} is missing {${name}}`);
      }
    }
  }
});

test("store descriptions fit Chrome's 132 characters", () => {
  for (const l of LOCALES) assert.ok(ext(l).storeDescription.length <= 132, l);
});

test("the browser's language picks the locale, and anything else falls back to English", () => {
  assert.equal(pickLocale("ar-SA"), "ar");
  assert.equal(pickLocale("zh-TW"), "zh");
  assert.equal(pickLocale("pt-BR"), "en");
  assert.equal(pickLocale(undefined), "en");
  assert.equal(t("buttonReady", { printer: "U1" }, "de"), "✓ U1 bereit");
  assert.equal(t("no-such-key", undefined, "de"), "no-such-key");
});

test("converter warnings come from the site's own sentences, plural included", () => {
  const w = { level: "warn" as const, key: "warnOverFourMerge", params: { count: 6 } };
  assert.match(warningText(w, "en"), /^6 colors/);
  assert.notEqual(warningText(w, "de"), warningText(w, "en"));
});
