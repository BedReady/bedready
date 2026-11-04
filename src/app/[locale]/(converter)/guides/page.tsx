import type { Metadata } from "next";
import { Link } from "@/i18n/navigation";
import { GUIDES } from "@/lib/guides";
import { canonicalOnly } from "@/lib/seo";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Guides — BedReady",
    description: "Guides for printing multicolor models on the Snapmaker U1: MakerWorld, Bambu, PrusaSlicer, Creality, and fixing Snapmaker Orca import issues.",
    alternates: canonicalOnly("/guides"),
  };
}

const TOOLS = [
  {
    href: "/orca-filaments",
    title: "Add OrcaSlicer filament profiles to Snapmaker Orca",
    description: "Install any OrcaSlicer filament profile (SUNLU, Polymaker, eSUN…) into Snapmaker Orca for the Snapmaker U1 — one click, or download & import.",
  },
];

// The /extension and /features grammar: a hero, the four-filament rule, then ruled rows with the
// subject on the start edge — here "Guides" and "Tools", each beside its list of links.
export default function GuidesPage() {
  return (
    <main lang="en" dir="ltr" className="page-read py-12">
      <h1 className="text-3xl font-semibold tracking-tight text-fg sm:text-5xl">Guides</h1>
      <p className="mt-5 text-lg text-fg-muted">Practical guides for multicolor printing on the Snapmaker U1.</p>

      <div className="measure-full mt-12">
        <div className="brand-rule" aria-hidden="true" />
        <Group title="Guides" items={GUIDES.map((g) => ({ href: `/guides/${g.slug}`, title: g.title, description: g.description }))} />
        <Group title="Tools" items={TOOLS} />
      </div>
    </main>
  );
}

function Group({ title, items }: { title: string; items: { href: string; title: string; description: string }[] }) {
  return (
    <section className="grid gap-x-12 gap-y-2 border-b border-line py-7 sm:grid-cols-[13rem_minmax(0,1fr)]">
      <h2 className="text-lg font-semibold text-fg" style={{ fontStretch: "112%" }}>{title}</h2>
      <ul className="max-w-[45rem] divide-y divide-line [&>li:first-child>a]:pt-0">
        {items.map((it) => (
          <li key={it.href}>
            <Link href={it.href} className="group block py-4">
              <h3 className="font-semibold text-fg group-hover:text-violet-300 group-hover:underline">{it.title}</h3>
              <p className="mt-1.5 text-base leading-relaxed text-fg-muted">{it.description}</p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
