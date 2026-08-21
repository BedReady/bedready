import ConverterHeader from "@/components/ConverterHeader";
import SiteFooter from "@/components/SiteFooter";

/**
 * The converter's shell — `bedready.io` after the split.
 *
 * ── WHAT IS DELIBERATELY ABSENT ─────────────────────────────────────────────────────────────────
 *
 * `ViewerProvider`. The library's shell wraps everything in it so the header's account, saves and
 * notification controls can share one auth round-trip; the converter has none of those controls,
 * requires no account, and is being carved into a public repo that ships no Supabase credentials.
 *
 * That absence is the entire reason this file and the route groups exist. Until 2026-08-21 the
 * converter rendered inside the library's layout, so every converter page mounted a Supabase client
 * and made an auth round-trip on load for a page with nothing to authenticate. Route groups do not
 * change any URL — `(converter)/convert` still serves `/convert` — so this is a structural change
 * with one visible consequence, the header.
 *
 * The groups are also the shape of the carve: `(converter)` is the public repo and `(library)` is
 * MakerRun, so splitting the repos becomes a directory copy rather than an archaeology exercise.
 *
 * ── WHAT IS SHARED, AND WHY THAT IS FINE ────────────────────────────────────────────────────────
 *
 * `SiteFooter` holds no viewer state and no Supabase client, so both shells use it. It links to
 * library pages, which are same-origin today and become cross-domain links to MakerRun after the
 * carve — which is what the footer of a funnel should do anyway.
 */
import type { Metadata } from "next";
import { ldJson } from "@/lib/json-ld";
import { siteMetadata, brandJsonLd, type SiteBrand } from "@/lib/site-metadata";
import { CONVERTER_ORIGIN } from "@/lib/origin";

/**
 * This site's identity. The converter — `bedready.io`.
 *
 * Both groups pass the same brand name today, so the emitted tags are byte-identical to what the
 * root layout produced before the metadata moved down. They diverge by changing these arguments,
 * not by forking a file.
 */
const BRAND: SiteBrand = { origin: CONVERTER_ORIGIN, name: "BedReady" };

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return siteMetadata(locale, BRAND);
}

/** Brand description for the Organization node. */
const DESCRIPTION =
  "Machine-agnostic 3D-print files with slicer profiles checked by our server, and a free in-browser converter for multicolor printing. Started with the Snapmaker U1, open to every printer.";

export default async function ConverterLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: ldJson(brandJsonLd(locale, BRAND, DESCRIPTION)) }}
      />
      <div className="flex min-h-screen flex-col">
        <ConverterHeader />
        {/* `#main-content` is the target of the skip link in the root layout. Both group shells must
            render it, or a keyboard user's first action lands nowhere on half the site. */}
        <div id="main-content" tabIndex={-1} className="flex-1">
          {children}
        </div>
        <SiteFooter />
      </div>
    </>
  );
}
