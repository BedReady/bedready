import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { canonicalOnly } from "@/lib/seo";
import OrcaFilaments from "@/components/OrcaFilaments";
import { orcaBrands, orcaMaterials, orcaCombos, resolveOrcaSlug, materialsForBrand, brandsForMaterial } from "@/lib/orca-filaments";

// One SEO page per brand, per material, AND per brand×material combo (e.g. "sunlu-petg"), each pre-filtered.
// ALL of them are prebuilt — see generateStaticParams for why on-demand was the expensive option.
// All disambiguated by resolveOrcaSlug and driven by the pre-baked manifest.
export const revalidate = 86400; // a day; the catalog only changes when the manifest is regenerated

export function generateStaticParams() {
  // Prebuild EVERY slug, combos included. On-demand generation looks like the cheaper option and is the
  // opposite: a path that wasn't prerendered is served through next-intl's default-locale rewrite, and a
  // fallback render behind that rewrite is never cached — so every request for an unprefixed combo URL
  // rendered from scratch, forever. Combos were 656 of 832 function invocations in a 12-hour sample.
  const slugs = new Set<string>();
  for (const b of orcaBrands()) slugs.add(b.slug);
  for (const t of orcaMaterials()) slugs.add(t.slug);
  for (const c of orcaCombos()) slugs.add(c.slug);
  return [...slugs].map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const r = resolveOrcaSlug(slug);
  if (!r) return {};
  return {
    title: `Add ${r.name} Filament Profiles to Snapmaker Orca (Snapmaker U1) — BedReady`,
    description: `Install ${r.name} filament profiles into Snapmaker Orca for the Snapmaker U1 — one click in Chrome/Edge, or download and import. Free, in your browser, nothing uploaded.`,
    // Canonical only — no hreflang. Everything above this line is hardcoded English, so the seven
    // locale-prefixed variants of this page are the same page, not translations of it. Advertising
    // them multiplied a 451-page catalog into 3,157 crawlable URLs, every one of which a crawler walks.
    alternates: canonicalOnly(`/orca-filaments/${r.slug}`),
  };
}

export default async function OrcaFacetPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const r = resolveOrcaSlug(slug);
  if (!r) notFound();

  const initialVendor = r.kind === "brand" ? r.name : r.kind === "combo" ? r.brand : "";
  const initialType = r.kind === "material" ? r.name : r.kind === "combo" ? r.material : "";

  // Internal links to the long tail: from a brand → its materials, from a material → its brands.
  const crossLinks =
    r.kind === "brand" ? materialsForBrand(r.name).map((c) => ({ slug: c.slug, label: `${r.name} ${c.material}` }))
    : r.kind === "material" ? brandsForMaterial(r.name).map((c) => ({ slug: c.slug, label: `${c.brand} ${r.name}` }))
    : [];

  return (
    <main className="shell py-12">
      <p className="text-sm">
        <Link href="/orca-filaments" className="text-violet-300 hover:underline">← All filament profiles</Link>
        {r.kind === "combo" && (
          <>
            {" · "}
            <Link href={`/orca-filaments/${vendorSlugOf(r.brand)}`} className="text-violet-300 hover:underline">{r.brand}</Link>
            {" · "}
            <Link href={`/orca-filaments/${vendorSlugOf(r.material)}`} className="text-violet-300 hover:underline">{r.material}</Link>
          </>
        )}
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
        Add {r.name} filament profiles to Snapmaker Orca
      </h1>
      <p className="mt-4 max-w-2xl text-lg text-fg-muted">
        {r.kind === "combo" ? (
          <>Every {r.name} filament profile from OrcaSlicer, ready for Snapmaker Orca on the Snapmaker U1 — set to
          the right temperatures and compatible out of the box.</>
        ) : r.kind === "material" ? (
          <>Every {r.name} filament profile from OrcaSlicer, ready to drop into Snapmaker Orca — Snapmaker&apos;s
          fork of OrcaSlicer — for the Snapmaker U1.</>
        ) : (
          <>Snapmaker Orca is Snapmaker&apos;s fork of OrcaSlicer, so it runs {r.name} filament profiles — they
          just need to land in the right folder, set up for the Snapmaker U1.</>
        )}{" "}
        Pick one below and install it in one click, or download and import. Free, in your browser, nothing uploaded.
      </p>

      <OrcaFilaments initialVendor={initialVendor} initialType={initialType} />

      {crossLinks.length > 0 && (
        <div className="mt-8">
          <p className="eyebrow">
            {r.kind === "brand" ? `${r.name} by material` : `${r.name} by brand`}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {crossLinks.map((c) => (
              <Link key={c.slug} href={`/orca-filaments/${c.slug}`} className="rounded-full border border-line bg-surface-2 px-3 py-1 text-xs font-medium text-fg-muted transition hover:border-violet-400/40 hover:text-fg">
                {c.label}
              </Link>
            ))}
          </div>
        </div>
      )}

      <p className="mt-10 text-sm text-fg-muted">
        <Link href="/orca-filaments" className="text-violet-300 hover:underline">Browse all filament profiles →</Link>
      </p>
      <p className="mt-8 text-[11px] text-fg-subtle">
        Independent project — not affiliated with, endorsed by, or sponsored by Snapmaker, the OrcaSlicer
        project{r.kind !== "material" ? ` or ${r.kind === "combo" ? r.brand : r.name}` : ""}. All brand and
        product names are trademarks of their respective owners. Filament profiles are provided as a starting
        point; verify settings for your printer.
      </p>
    </main>
  );
}

// Local helper: the brand/material name → its own facet slug (for the combo breadcrumb links).
function vendorSlugOf(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
