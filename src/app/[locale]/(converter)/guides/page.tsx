import { Link } from "@/i18n/navigation";
import { GUIDES } from "@/lib/guides";
import { alternates } from "@/lib/seo";

export const metadata = {
  title: "Guides — BedReady",
  description: "Guides for printing multicolor models on the Snapmaker U1: MakerWorld, Bambu, PrusaSlicer, Creality, and fixing Snapmaker Orca import issues.",
  alternates: alternates("/guides"),
};

export default function GuidesPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tight text-fg sm:text-4xl">Guides</h1>
      <p className="mt-3 text-fg-muted">Practical guides for multicolor printing on the Snapmaker U1.</p>
      <ul className="mt-10">
        {GUIDES.map((g) => (
          <li key={g.slug}>
            <Link href={`/guides/${g.slug}`} className="group block border-t border-line py-5 transition hover:bg-surface-2">
              <h2 className="font-semibold text-fg group-hover:text-violet-300">{g.title}</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">{g.description}</p>
            </Link>
          </li>
        ))}
      </ul>

      <h2 className="eyebrow mt-14 block border-t border-line pt-6">Tools</h2>
      <ul className="mt-4">
        <li>
          <Link href="/orca-filaments" className="group block border-t border-line py-5 transition hover:bg-surface-2">
            <h3 className="font-semibold text-fg group-hover:text-violet-300">Add OrcaSlicer filament profiles to Snapmaker Orca</h3>
            <p className="mt-1 text-sm text-fg-muted">Install any OrcaSlicer filament profile (SUNLU, Polymaker, eSUN…) into Snapmaker Orca for the Snapmaker U1 — one click, or download &amp; import.</p>
          </Link>
        </li>
      </ul>
    </main>
  );
}
