import type { Metadata } from "next";
import { ldJson } from "@/lib/json-ld";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { alternates } from "@/lib/seo";
import OrcaFilaments from "@/components/OrcaFilaments";
import { orcaBrands, orcaMaterials } from "@/lib/orca-filaments";

// Localized title/description. This is a long-tail SEO surface served in 7 locales, so the SERP
// snippet has to be translated too — an English snippet on /de/orca-filaments wastes the page.
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "orcaPage" });
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: alternates("/orca-filaments"),
  };
}

export default async function OrcaFilamentsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("orcaPage");
  const brands = orcaBrands();
  const materials = orcaMaterials();

  // The FAQ doubles as the FAQPage JSON-LD below, so it has to be built from the translated strings
  // — otherwise the localized pages emit English structured data.
  const faq = [
    { q: t("faq1q"), a: t("faq1a") },
    { q: t("faq2q"), a: t("faq2a") },
    { q: t("faq3q"), a: t("faq3a") },
    { q: t("faq4q"), a: t("faq4a") },
  ];

  return (
    <main className="shell py-12">
      <h1 className="text-3xl font-semibold tracking-tight text-fg sm:text-4xl">{t("heading")}</h1>
      <p className="mt-4 max-w-2xl text-lg text-fg-muted">{t("intro")}</p>

      <OrcaFilaments />

      <OrcaFilaments />

      {/* ── THE TAG CLOUD MOVED BELOW THE TOOL ────────────────────────────────────────────────────
          Roughly sixty brand chips and twenty material chips opened this page, pushing the search
          field and its two filter dropdowns about 560px down — and duplicating what those dropdowns
          already do, since every chip is also an option in "All brands" or "All materials".

          They are not decoration and they are not deleted: each one is an internal link to a real
          landing page, and that is worth keeping. It is worth keeping *after* the thing somebody
          came here to use. */}
      {brands.length > 0 && (
        <div className="mt-12 flex flex-wrap items-center gap-2">
          <span className="eyebrow">{t("popularBrands")}</span>
          {brands.map((b) => (
            <Link
              key={b.slug}
              href={`/orca-filaments/${b.slug}`}
              className="rounded-full border border-line bg-surface-2 px-3 py-1 text-xs font-medium text-fg-muted transition hover:border-violet-400/40 hover:text-fg"
            >
              {b.name}
            </Link>
          ))}
        </div>
      )}
      {materials.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="eyebrow">{t("byMaterial")}</span>
          {materials.map((mtl) => (
            <Link
              key={mtl.slug}
              href={`/orca-filaments/${mtl.slug}`}
              className="rounded-full border border-line bg-surface-2 px-3 py-1 text-xs font-medium text-fg-muted transition hover:border-violet-400/40 hover:text-fg"
            >
              {mtl.name}
            </Link>
          ))}
        </div>
      )}

      <h2 className="mt-14 text-xl font-semibold tracking-tight text-fg">{t("faqHeading")}</h2>
      <div className="mt-4 space-y-5">
        {faq.map((f) => (
          <div key={f.q}>
            <h3 className="font-semibold text-fg">{f.q}</h3>
            <p className="mt-1 text-sm text-fg-muted">{f.a}</p>
          </div>
        ))}
      </div>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          // ldJson escapes `<`/`>`/`&` for a raw-text <script>. This file used to inline that chain
          // itself — correct, and the third separate copy of one rule. See lib/json-ld.ts.
          __html: ldJson({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
          }),
        }}
      />

      <p className="mt-10 text-sm text-fg-muted">
        {t.rich("seeAlso", {
          conv: (c) => <Link href="/convert" className="text-violet-300 hover:underline">{c}</Link>,
          cmp: (c) => <Link href="/compare-multicolor-printers" className="text-violet-300 hover:underline">{c}</Link>,
        })}
      </p>
      <p className="mt-8 text-[11px] text-fg-subtle">{t("disclaimer")}</p>
    </main>
  );
}
