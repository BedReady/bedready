/**
 * Converter pages written in English only, deliberately: long-form landing and comparison pages whose
 * searches are English, and whose claims about other products go stale faster than six translations
 * could be kept up (see compare-u1-converters/page.tsx).
 *
 * They still render at every locale prefix, with the site chrome translated around English body text.
 * So they must not announce hreflang alternates. Seven "translations" of one English page is a
 * duplicate-content claim, and the self-canonical at /de/… told Google to index each copy
 * separately (Nov 2026 review). These pages use canonicalOnly(), and the sitemap lists them with no
 * alternates. english-only.test.mts keeps this list, the pages and the sitemap in step.
 */
export const ENGLISH_ONLY_ROUTES = [
  "bambu-to-snapmaker-u1",
  "compare-multicolor-printers",
  "compare-u1-converters",
  "creality-to-snapmaker-u1",
  "guides",
  "makerworld-to-snapmaker-u1",
  "printables-to-snapmaker-u1",
  "prusaslicer-to-snapmaker-u1",
  "u1-to-bambu",
  "u1-to-creality",
  "u1-to-prusa",
] as const;

const OTHER_LOCALES = new Set(["de", "es", "fr", "zh", "ja", "ar"]);
const ROUTES = new Set<string>(ENGLISH_ONLY_ROUTES);

/**
 * Whether a bare path (no locale prefix, no query) is an English-only page: one of the routes above
 * or anything under one (/guides/<slug>), or a filament profile page (/orca-filaments/<slug>). The
 * /orca-filaments hub itself is translated and is not on this list.
 */
export function isEnglishOnlyPath(bare: string): boolean {
  const segs = bare.split("/").filter(Boolean);
  if (segs.length === 0) return false;
  if (ROUTES.has(segs[0])) return true;
  return segs[0] === "orca-filaments" && segs.length === 2;
}

/**
 * Where a locale-prefixed copy of an English-only page should go: its English URL, or null.
 *
 * These pages used to render at every prefix with canonical → English (#20, Aug 2026). Three months
 * on, Search Console still crawled ~120 of the copies, listed them "crawled – currently not
 * indexed", and disagreed with the canonical on 11 (Nov 9 2026). One URL per page is the
 * unambiguous signal, so the middleware 308s /de/guides/x → /guides/x, and SiteLink points
 * straight at the English URL so no internal link lands on the redirect.
 */
export function englishOnlyRedirect(pathname: string): string | null {
  const m = /^\/([a-z]{2})(\/.*)$/.exec(pathname);
  if (!m || !OTHER_LOCALES.has(m[1])) return null;
  const bare = m[2].replace(/\/+$/, "") || "/";
  return isEnglishOnlyPath(bare) ? bare : null;
}
