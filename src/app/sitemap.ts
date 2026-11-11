import type { MetadataRoute } from "next";
import { orcaBrands, orcaMaterials, indexedOrcaCombos } from "@/lib/orca-filaments";
import { CONVERTER_ORIGIN, CONVERTER_ROUTES } from "@/lib/origin";
import { GUIDES } from "@/lib/guides";
import { ENGLISH_ONLY_ROUTES } from "@/lib/english-only";

/**
 * The converter's sitemap.
 *
 * ── HOW THIS DIFFERS FROM THE ONE IT WAS CARVED FROM ────────────────────────────────────────────
 *
 * The combined site's sitemap queried Supabase for every published design, so it was `async` and
 * revalidated hourly. This one lists a fixed set of routes and needs no database at all — which is
 * the same reason this repository can be public. The library's designs are MakerRun's to publish.
 *
 * ── THE ROUTE LIST IS DERIVED, NOT RESTATED ─────────────────────────────────────────────────────
 *
 * The original enumerated seventeen URLs by hand, and a route added without a matching line here is
 * simply absent from the sitemap — silently, and forever. `CONVERTER_ROUTES` is the same list the
 * `(converter)` directory is pinned to by `origin-allocation.test.mts`, so adding a route adds it
 * here too.
 *
 * Priorities are the exception and stay explicit: they encode which pages matter, which is a
 * judgement no directory listing contains.
 */
const BASE = CONVERTER_ORIGIN;
const LOCALES = ["de", "es", "fr", "zh", "ja", "ar"]; // en is the default (unprefixed)

/** Pages worth ranking above the rest. Anything unlisted gets the default. */
const PRIORITY: Record<string, number> = {
  convert: 1,
  image: 0.8,
  guides: 0.8,
  "orca-filaments": 0.8,
  features: 0.7,
  "compare-multicolor-printers": 0.7,
  stickers: 0.6,
  extension: 0.6,
};

// hreflang alternates: en at the bare path, each other locale at /<loc><path>.
function alts(path: string): MetadataRoute.Sitemap[number]["alternates"] {
  const languages: Record<string, string> = { en: `${BASE}${path}`, "x-default": `${BASE}${path}` };
  for (const l of LOCALES) languages[l] = `${BASE}/${l}${path}`;
  return { languages };
}

/**
 * `translated: false` for a page that is English at every prefix: no alternates, matching its
 * canonicalOnly() metadata. The guides and filament pages were listed with seven hreflang
 * alternates while the pages themselves canonicalised to English, and the two contradicted
 * each other (Nov 2026 review).
 */
function entry(path: string, priority: number, changeFrequency: "weekly" | "monthly", translated = true): MetadataRoute.Sitemap[number] {
  return { url: `${BASE}${path}`, changeFrequency, priority, ...(translated ? { alternates: alts(path) } : {}) };
}

/** Translated tool pages below a top-level converter route (see `nested` below). */
const NESTED_TOOL_ROUTES = ["image/lithophane"] as const;

const englishOnly = new Set<string>(ENGLISH_ONLY_ROUTES);

export default function sitemap(): MetadataRoute.Sitemap {
  const routes = CONVERTER_ROUTES.map((r) =>
    entry(`/${r}`, PRIORITY[r] ?? 0.8, r === "orca-filaments" || r === "guides" ? "weekly" : "monthly", !englishOnly.has(r)),
  );

  // Tools nested under a converter route. CONVERTER_ROUTES lists the route group's top-level
  // directories only, so a page one level down is listed here or not at all.
  const nested = NESTED_TOOL_ROUTES.map((r) => entry(`/${r}`, 0.7, "monthly"));

  const guidePages = GUIDES.map((g) => entry(`/guides/${g.slug}`, 0.7, "monthly", false));

  // The filament pages are the long tail: brand, material, and every brand×material combination
  // with enough profiles to index. Thin combos are noindex and so not listed (isThinCombo()).
  const filaments = [
    ...orcaBrands().map((b) => entry(`/orca-filaments/${b.slug}`, 0.6, "monthly", false)),
    ...orcaMaterials().map((m) => entry(`/orca-filaments/${m.slug}`, 0.6, "monthly", false)),
    ...indexedOrcaCombos().map((c) => entry(`/orca-filaments/${c.slug}`, 0.5, "monthly", false)),
  ];

  return [...routes, ...nested, ...guidePages, ...filaments];
}
