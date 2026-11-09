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

import { englishOnlyRedirect, isEnglishOnlyPath } from "./english-only.ts";

test("locale copies of English-only pages go to the one English URL", () => {
  assert.equal(englishOnlyRedirect("/de/printables-to-snapmaker-u1"), "/printables-to-snapmaker-u1");
  assert.equal(englishOnlyRedirect("/es/guides/fix-geometry-only-snapmaker-orca"), "/guides/fix-geometry-only-snapmaker-orca");
  assert.equal(englishOnlyRedirect("/de/guides"), "/guides");
  assert.equal(englishOnlyRedirect("/de/guides/"), "/guides");
  assert.equal(englishOnlyRedirect("/fr/orca-filaments/orca"), "/orca-filaments/orca");
  assert.equal(englishOnlyRedirect("/ar/u1-to-bambu"), "/u1-to-bambu");
});

test("translated pages, English URLs and unknown prefixes stay put", () => {
  assert.equal(englishOnlyRedirect("/de/orca-filaments"), null); // the hub is translated
  assert.equal(englishOnlyRedirect("/de/convert"), null);
  assert.equal(englishOnlyRedirect("/guides/x"), null);
  assert.equal(englishOnlyRedirect("/orca-filaments/pla"), null);
  assert.equal(englishOnlyRedirect("/xx/guides"), null);
  assert.equal(englishOnlyRedirect("/de"), null);
  assert.equal(englishOnlyRedirect("/de/orca-filaments/pla/extra"), null);
});

test("SiteLink and the middleware both use it, and the middleware redirects before next-intl", () => {
  assert.ok(isEnglishOnlyPath("/guides/a") && isEnglishOnlyPath("/orca-filaments/pla") && !isEnglishOnlyPath("/orca-filaments"));
  assert.match(readFileSync("src/components/SiteLink.tsx", "utf8"), /isEnglishOnlyPath\(/);
  const mw = readFileSync("src/middleware.ts", "utf8");
  const at = mw.indexOf("englishOnlyRedirect(pathname)");
  assert.ok(at !== -1 && at < mw.indexOf("return intlMiddleware(request)"));
  // The English URL must skip next-intl's locale detection, or a German visitor loops /guides ⇄ /de/guides.
  const rw = mw.indexOf("isEnglishOnlyPath(pathname)) return NextResponse.rewrite(");
  assert.ok(rw !== -1 && rw < mw.indexOf("return intlMiddleware(request)"), "English-only paths no longer bypass locale detection");
});

test("pages that link to English-only pages use SiteLink, not next-intl's Link", () => {
  const offenders: string[] = [];
  const re = /href=\{?["`]\/(guides|orca-filaments\/|bambu-to|compare-|creality-to|makerworld-to|printables-to|prusaslicer-to|u1-to-)/;
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : e.name.endsWith(".tsx") ? [`${d}/${e.name}`] : []));
  for (const f of [...walk("src/app"), ...walk("src/components")]) {
    const src = readFileSync(f, "utf8");
    if (re.test(src) && /import \{[^}]*\bLink\b[^}]*\} from "@\/i18n\/navigation"/.test(src)) offenders.push(f);
  }
  assert.deepEqual(offenders, []);
});
