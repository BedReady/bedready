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
