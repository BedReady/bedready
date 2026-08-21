import type { Metadata } from "next";
import { ldJson } from "@/lib/json-ld";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { GUIDES, guideBySlug } from "@/lib/guides";
import { absoluteUrl } from "@/lib/origin";

export function generateStaticParams() {
  return GUIDES.map((g) => ({ slug: g.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const g = guideBySlug(slug);
  if (!g) return { title: "Guide not found — BedReady" };
  return {
    title: `${g.title} — BedReady`,
    description: g.description,
    openGraph: { title: g.title, description: g.description, type: "article" },
  };
}

export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const g = guideBySlug(slug);
  if (!g) notFound();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: g.title,
    description: g.description,
    author: { "@type": "Organization", name: "BedReady" },
    publisher: { "@type": "Organization", name: "BedReady" },
    mainEntityOfPage: absoluteUrl(`/guides/${g.slug}`),
  };

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(jsonLd) }} />
      <Link href="/guides" className="text-sm text-fg-muted hover:text-fg">← Guides</Link>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight text-fg">{g.title}</h1>
      <p className="mt-3 text-lg text-fg-muted">{g.intro}</p>

      <article className="mt-8 space-y-8">
        {g.sections.map((s) => (
          <section key={s.h}>
            <h2 className="text-lg font-semibold text-fg">{s.h}</h2>
            {s.p.map((para, i) => (
              <p key={i} className="mt-2 leading-relaxed text-fg-muted">{para}</p>
            ))}
          </section>
        ))}
      </article>

      <div className="mt-10 rounded-lg border border-violet-400/20 bg-violet-400/[0.05] p-5">
        <p className="font-semibold text-fg">Ready to try it?</p>
        <p className="mt-1 text-sm text-fg-muted">Free, in your browser — nothing uploaded.</p>
        <Link href="/convert" className="btn-primary btn-md mt-3 inline-flex">
          Convert a file →
        </Link>
      </div>
    </main>
  );
}
