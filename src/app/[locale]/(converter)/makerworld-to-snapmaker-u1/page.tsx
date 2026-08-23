import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { ldJson } from "@/lib/json-ld";
import { Link } from "@/i18n/navigation";
import { alternates } from "@/lib/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: "Print MakerWorld & Bambu files on the Snapmaker U1 (free converter) — BedReady",
    description:
      "Convert a MakerWorld or Bambu .3mf to print correctly on the Snapmaker U1 — colors kept, the real U1 profile applied, swap pauses fixed. Free, in your browser, nothing uploaded.",
    alternates: alternates("/makerworld-to-snapmaker-u1", locale),
  };
}

const faq = [
  {
    q: "Why won't MakerWorld files print right on the Snapmaker U1?",
    a: "A MakerWorld or Bambu .3mf is sliced for a Bambu printer — the painted colors and print settings are stored in that printer's profile. Open it in Snapmaker Orca and you get the wrong profile, colors mapped to the wrong slots (or dropped to plain gray geometry), and broken filament-change behavior. BedReady rewrites the file for the U1 so it opens correctly.",
  },
  {
    q: "Does it keep the colors?",
    a: "Yes — every painted face is preserved, including text, logos and fine detail. Painted multicolor is mapped onto the U1's 4 slots, and for files with more than 4 colors, Full Spectrum reproduces the extras by dithering 2- and 3-filament mixes.",
  },
  {
    q: "Is my file uploaded anywhere?",
    a: "No. Conversion runs entirely in your browser — the file never leaves your device. It's free, with no account.",
  },
  {
    q: "Do I still need to slice it?",
    a: "Yes — BedReady produces a U1-ready .3mf that you open and slice in Snapmaker Orca. It keeps the creator's print settings (layer height, walls, infill, speeds) unless you choose the tested U1 profile instead.",
  },
];

export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <main className="page-read py-12">
      <h1 className="text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
        Print MakerWorld &amp; Bambu files on the Snapmaker U1
      </h1>
      <p className="mt-4 text-lg text-fg-muted">
        Drop a MakerWorld or Bambu <code className="text-violet-300">.3mf</code> into BedReady and get a
        U1-ready file back — colors kept, the real Snapmaker U1 profile applied, prime tower and swap pauses
        fixed. Free, in your browser, nothing uploaded.
      </p>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/convert" className="btn-primary btn-lg">
          Convert a file — free
        </Link>
        <Link href="/extension" className="rounded-lg border border-line bg-surface-2 px-6 py-3 font-semibold text-fg transition hover:bg-surface-3">
          Get the browser extension
        </Link>
      </div>
      <p className="mt-3 text-xs text-fg-subtle">100% in your browser — your file is never uploaded.</p>

      <h2 className="mt-12 text-xl font-semibold tracking-tight text-fg">The problem</h2>
      <p className="mt-2 text-fg-muted">
        MakerWorld and Bambu Studio slice for Bambu printers. Open one of those <code>.3mf</code> files in
        Snapmaker Orca and it loads with a foreign printer profile, the painted colors land in the wrong
        slots — or drop out entirely as plain gray geometry — and the filament-change and prime-tower setup
        is wrong for the U1. Re-painting by hand takes hours.
      </p>

      <h2 className="mt-8 text-xl font-semibold tracking-tight text-fg">What BedReady does in one click</h2>
      <ul className="mt-3 space-y-2 text-fg-muted">
        {[
          "Swaps the Bambu profile for the real Snapmaker U1 profile",
          "Maps painted multicolor onto the U1's 4 slots — colors kept exactly, text & logos included",
          "Keeps the creator's print settings (layer height, walls, infill, speeds)",
          "More than 4 colors? Full Spectrum mixes 2–3 filaments to reproduce the extras",
          "Fixes the prime tower and filament-change pauses",
          "Runs 100% in your browser — nothing uploaded, free, no account",
        ].map((s) => (
          <li key={s} className="flex gap-2">
            <span className="mt-0.5 shrink-0 text-violet-400">✓</span>
            <span>{s}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-base text-fg-muted">
        Works with files from MakerWorld, Bambu Studio, PrusaSlicer, OrcaSlicer and Creality Print. See the
        full <Link href="/features" className="text-violet-300 hover:underline">feature list &amp; comparison</Link>.
      </p>

      <h2 className="mt-10 text-xl font-semibold tracking-tight text-fg">FAQ</h2>
      <div className="mt-4 space-y-5">
        {faq.map((f) => (
          <div key={f.q}>
            <h3 className="font-semibold text-fg">{f.q}</h3>
            <p className="mt-1 text-base text-fg-muted">{f.a}</p>
          </div>
        ))}
      </div>

      {/* FAQ structured data for a richer search result. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: ldJson({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: faq.map((f) => ({
              "@type": "Question",
              name: f.q,
              acceptedAnswer: { "@type": "Answer", text: f.a },
            })),
          }),
        }}
      />

      <div className="mt-12 rounded-lg border border-line bg-surface-2 p-6 text-center">
        <p className="font-semibold text-fg">Ready to print that MakerWorld model?</p>
        <Link href="/convert" className="btn-primary btn-lg mt-4 inline-flex">
          Convert your .3mf — free
        </Link>
      </div>

      <p className="mt-8 text-xs text-fg-subtle">
        Independent project — not affiliated with, endorsed by, or sponsored by Snapmaker, Bambu Lab, or
        MakerWorld. All product names are trademarks of their respective owners.
      </p>
    </main>
  );
}
