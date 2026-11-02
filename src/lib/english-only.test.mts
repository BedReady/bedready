// A converter page either translates its body or is on ENGLISH_ONLY_ROUTES. The pages on the list
// use canonicalOnly() (no hreflang) and the sitemap gives them no alternates. A page that is neither
// would advertise seven translations of English text, which is what 11 pages did until Nov 2026.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { ENGLISH_ONLY_ROUTES } from "./english-only.ts";

const DIR = "src/app/[locale]/(converter)";
const english = new Set<string>(ENGLISH_ONLY_ROUTES);

test("every converter page translates its body, or is listed as English-only and says so to search engines", () => {
  const wrong: string[] = [];
  for (const r of readdirSync(DIR)) {
    const f = `${DIR}/${r}/page.tsx`;
    if (!existsSync(f)) continue;
    const src = readFileSync(f, "utf8");
    const translates = /\b(useTranslations|getTranslations)\(/.test(src);
    if (english.has(r)) {
      if (!src.includes("canonicalOnly(")) wrong.push(`${r}: English-only but not canonicalOnly()`);
      if (/\balternates\(/.test(src)) wrong.push(`${r}: English-only but still announces hreflang alternates`);
    } else if (!translates) {
      wrong.push(`${r}: no translations and not on ENGLISH_ONLY_ROUTES`);
    }
  }
  assert.deepEqual(wrong, []);
});

test("the list names real pages", () => {
  for (const r of ENGLISH_ONLY_ROUTES) assert.ok(existsSync(`${DIR}/${r}/page.tsx`), r);
});
