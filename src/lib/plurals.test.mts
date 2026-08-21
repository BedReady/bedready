// Message strings that take a count must actually pluralise. Run: `npm test`.
//
// `design.downloadsCount` was `"{count} downloads"` in every locale, so a design with one download
// read "1 downloads" on its own page, in seven languages. The dashboard had the same bug in a
// hardcoded string and it was fixed there first; this one lived in the message files and survived,
// because nothing checks a translation for grammar.
//
// Formatting each string for real is the only check worth having: a plural block that is malformed
// throws at render time, and "looks like it has a plural in it" would pass a regex while breaking the
// page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { IntlMessageFormat } from "intl-messageformat";

const LOCALES = ["en", "ar", "de", "es", "fr", "ja", "zh"] as const;

/** Keys that take a count and must read correctly at 1. `path` is dotted into the message file. */
const COUNTED = [{ path: "design.downloadsCount", arg: "count" }];

function messageAt(locale: string, path: string): string | undefined {
  const file = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"));
  return path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], file) as string | undefined;
}

test("every counted string formats without throwing, at every plural boundary", () => {
  for (const { path, arg } of COUNTED) {
    for (const locale of LOCALES) {
      const msg = messageAt(locale, path);
      assert.ok(msg, `${locale}: ${path} is missing`);
      // 0, 1, 2, 5, 11, 100 covers every ICU category Arabic distinguishes, which is the widest set.
      for (const n of [0, 1, 2, 5, 11, 100]) {
        assert.doesNotThrow(
          () => new IntlMessageFormat(msg!, locale).format({ [arg]: n }),
          `${locale}: ${path} failed to format at ${n}`,
        );
      }
    }
  }
});

test("English says '1 download', not '1 downloads'", () => {
  const msg = messageAt("en", "design.downloadsCount")!;
  const one = String(new IntlMessageFormat(msg, "en").format({ count: 1 }));
  const two = String(new IntlMessageFormat(msg, "en").format({ count: 2 }));
  assert.match(one, /\b1 download\b/);
  assert.ok(!/1 downloads/.test(one), "the reported bug: a singular count with a plural noun");
  assert.match(two, /\b2 downloads\b/);
});

test("locales without a plural distinction are left alone rather than forced into one", () => {
  // Japanese and Chinese do not inflect for number. Wrapping them in a plural block would add
  // branches that can never differ, and invite a translator to invent a distinction the language
  // does not make.
  for (const locale of ["ja", "zh"]) {
    const msg = messageAt(locale, "design.downloadsCount")!;
    assert.ok(!msg.includes("plural"), `${locale} should not carry a plural block`);
  }
});
