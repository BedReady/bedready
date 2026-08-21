// Build a page's self-canonical + hreflang alternates. Mirrors the sitemap's `alts()`: en is unprefixed
// (the default locale), the others are /<locale><path>. Pass a path with a leading slash, or "" for home.
import { originFor, absoluteUrl } from "@/lib/origin";
const LOCALES = ["de", "es", "fr", "zh", "ja", "ar"];

// Normalize: home is "" not "/" (a trailing slash makes locale alternates `/de/`, which 308-redirect
// to `/de` — Google wants hreflang/canonical to point at the final 200 URL). Strip any trailing slash
// so callers can pass "/" or "/foo/" harmlessly and the output matches the sitemap's `alts()`.
const normalize = (path: string) => (path === "/" ? "" : path.replace(/\/$/, ""));

export function alternates(path: string): { canonical: string; languages: Record<string, string> } {
  const p = normalize(path);
  const base = originFor(p || "/");
  const languages: Record<string, string> = { en: `${base}${p}`, "x-default": `${base}${p}` };
  for (const l of LOCALES) languages[l] = `${base}/${l}${p}`;
  return { canonical: `${base}${p}`, languages };
}

/**
 * Self-canonical with NO hreflang block, for pages that render the same English content at every
 * locale prefix.
 *
 * hreflang is a claim that translations exist. Announcing seven for a page that has one is wrong on
 * its own terms, and it is expensive in a way that showed up on the bill: each alternate is a URL
 * crawlers walk, each walk of an unbuilt path is an on-demand render, and each render is an ISR write
 * plus Fluid CPU. The canonical still points at the unprefixed URL, so a locale-prefixed page that
 * someone does reach consolidates onto the one version worth indexing.
 */
export function canonicalOnly(path: string): { canonical: string } {
  return { canonical: absoluteUrl(path) };
}
