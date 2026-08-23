/**
 * Per-site metadata and brand structured data, built for whichever origin is asking.
 *
 * ── WHY THIS IS NOT IN THE ROOT LAYOUT ANY MORE ─────────────────────────────────────────────────
 *
 * `[locale]/layout.tsx` serves BOTH route groups, so it cannot name one origin. It used to, and
 * everything it emitted — `metadataBase`, the OpenGraph `url`, the Organization and WebSite
 * JSON-LD — said `https://bedready.io` for every page on the site.
 *
 * `metadataBase` is the one with teeth. It is what relative OpenGraph and Twitter image paths
 * resolve against, so a library page served from `makerrun.com` with `metadataBase` still pointing
 * at `bedready.io` publishes social cards whose images live on the other domain. That fails quietly:
 * the page is fine, the tags are well-formed, and only a crawler or a pasted link ever shows it.
 *
 * A layout's `generateMetadata` is not given the pathname, so the root layout cannot decide this per
 * request. The group layouts can, because each one IS the answer — `(converter)` is one origin,
 * `(library)` is the other. So this builds the metadata and both call it with their own.
 *
 * ── THE TWO SITES WILL DIVERGE, BUT NOT SPECULATIVELY ───────────────────────────────────────────
 *
 * Both groups pass the same brand name today, so the output is byte-identical to what the root
 * layout emitted. They diverge by passing different arguments, not by forking this file.
 *
 * The translation namespace is deliberately NOT one of those arguments. It was, for about ten
 * minutes, and `i18n-parity.test.mts` failed immediately: its dead-key detector reads the namespace
 * off `getTranslations({ namespace: "…" })` as a literal, so a variable there made `meta.ogTitle`,
 * `meta.ogDescription` and `meta.description` look like keys nothing renders — three live strings,
 * one cleanup away from being deleted out of all seven locale files.
 *
 * The detector was right and the parameter was speculation. When the two sites genuinely need
 * different copy, add the second namespace then, as a literal the scanner can see.
 */
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

/** One site's identity. Both groups pass their own. */
export type SiteBrand = {
  /** Origin this site is served from — `CONVERTER_ORIGIN` or `LIBRARY_ORIGIN`. */
  origin: string;
  /** Brand name for OpenGraph `siteName` and the Organization node. */
  name: string;
};

/**
 * Localized site-wide metadata, so `/de`, `/ja`, `/ar` get translated SERP snippets rather than
 * English. Pages inherit this unless they set their own.
 */
export async function siteMetadata(locale: string, brand: SiteBrand): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: "meta" });
  return {
    metadataBase: new URL(brand.origin),
    title: t("title"),
    description: t("description"),
    openGraph: {
      title: t("ogTitle"),
      description: t("ogDescription"),
      url: brand.origin,
      siteName: brand.name,
      type: "website",
    },
    // NO title/description here, deliberately.
    //
    // Next merges metadata per key: a page that sets `openGraph` does not touch `twitter`, so it
    // inherited these — and 42 pages ended up serving a card that named the SITE while their og:
    // tags named the page. Sharing a guide on X read "BedReady — ready for any bed" instead of the
    // guide's own title.
    //
    // A card falls back to og:title / og:description when the twitter equivalents are absent, so
    // omitting them makes every page's card follow its own openGraph — and pages that set no
    // openGraph still inherit the site's from above, which is what these said anyway. The proof
    // that the fallback works is already in this site: no twitter.images is set here either, and
    // a design page's twitter:image correctly resolves to that design's cover.
    twitter: { card: "summary_large_image" },
    // Google Search Console (URL-prefix) verification. Set GOOGLE_SITE_VERIFICATION in Vercel to the
    // token from GSC ("HTML tag" method) → renders <meta name="google-site-verification">. Blank = no
    // tag. Prefer the DNS/Domain-property method when you can; this is the zero-DNS fallback.
    //
    // After the split each deployment needs its OWN token: a GSC URL-prefix property is per-origin,
    // so the converter's token does not verify the library's domain.
    verification: process.env.GOOGLE_SITE_VERIFICATION
      ? { google: process.env.GOOGLE_SITE_VERIFICATION }
      : undefined,
  };
}

/**
 * Brand-level structured data — Organization + WebSite.
 *
 * Helps Google associate the brand, logo and social profiles, and is eligible for a knowledge panel.
 * Rendered once per page. The `@id` values are origin-scoped so the two sites do not claim to be the
 * same Organization once they are on different domains.
 */
export function brandJsonLd(locale: string, brand: SiteBrand, description: string) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${brand.origin}/#org`,
        name: brand.name,
        url: brand.origin,
        logo: `${brand.origin}/icon.svg`,
        description,
      },
      {
        "@type": "WebSite",
        "@id": `${brand.origin}/#website`,
        name: brand.name,
        url: brand.origin,
        publisher: { "@id": `${brand.origin}/#org` },
        inLanguage: locale,
      },
    ],
  };
}
