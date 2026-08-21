import { setRequestLocale } from "next-intl/server";
import { ldJson } from "@/lib/json-ld";
import { Link } from "@/i18n/navigation";
import { alternates } from "@/lib/seo";

export const metadata = {
  title: "Print Printables models on the Snapmaker U1 — BedReady",
  description:
    "Convert a Printables .3mf project to print on the Snapmaker U1 — multicolor kept, the real U1 profile applied. Download the .3mf project, not just the STL. Free, in your browser.",
  alternates: alternates("/printables-to-snapmaker-u1"),
};

const faq = [
  {
    q: "STL or .3mf — which should I download from Printables?",
    a: "Download the .3mf project if the model is multicolor. A plain STL is only geometry — it carries no colour painting, so there's nothing to preserve. The .3mf project file holds the paint data and slicer settings; that's the file to run through BedReady to keep the colours.",
  },
  {
    q: "Does it keep the multi-material colors from the project file?",
    a: "Yes. Printables multicolor projects are usually sliced in PrusaSlicer or Bambu Studio with painted MMU/AMS colour data. BedReady reads that painting and maps every painted face onto the U1's 4 slots, so text, logos and detail print in colour instead of dropping to grey geometry.",
  },
  {
    q: "Why doesn't the Printables .3mf just open on the U1?",
    a: "Those project files are sliced for another printer — a Prusa or Bambu machine — and carry that printer's profile and paint format. Snapmaker Orca only trusts its own native projects, so it loads the foreign file with the wrong profile and often ignores the colours. BedReady rewrites the file so Orca loads it as a native U1 project.",
  },
  {
    q: "Is the model uploaded anywhere?",
    a: "No. Conversion happens entirely in your browser — the downloaded .3mf never leaves your device, there's no account and it's free.",
  },
  {
    q: "Can I redistribute the converted file?",
    a: "That's up to the model's licence on Printables — always check the creator's terms before sharing a remix or a converted copy. BedReady only re-targets the file for your U1; it doesn't change or grant any rights to the model itself. See our own terms on the licenses page.",
  },
];

export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
        Print Printables models on the Snapmaker U1
      </h1>
      <p className="mt-4 text-lg text-fg-muted">
        Download a Printables <code className="text-violet-300">.3mf</code> project and drop it into BedReady
        to get a U1-ready file back — the multicolor painting kept and the real Snapmaker U1 profile applied.
        Free, in your browser, nothing uploaded.
      </p>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/convert" className="btn-primary btn-lg">
          Convert a file — free
        </Link>
        <Link href="/extension" className="rounded-md border border-line bg-surface-2 px-6 py-3 font-semibold text-fg transition hover:bg-surface-3">
          Get the browser extension
        </Link>
      </div>
      <p className="mt-3 text-xs text-fg-subtle">100% in your browser — your file is never uploaded.</p>

      <h2 className="mt-12 text-xl font-semibold tracking-tight text-fg">The problem</h2>
      <p className="mt-2 text-fg-muted">
        Printables hosts two very different downloads: plain STL geometry and full <code>.3mf</code> project
        files. For a multicolor model you want the <strong>.3mf project</strong> — the STL throws the colours
        away. But those projects are almost always sliced in PrusaSlicer or Bambu Studio for a different
        printer, so they arrive with a foreign printer profile and paint data Snapmaker Orca won&apos;t trust.
        Open one on the U1 and you get the wrong profile and the colours mapped to the wrong slots — or dropped
        to plain grey geometry.
      </p>

      <h2 className="mt-8 text-xl font-semibold tracking-tight text-fg">What BedReady does in one click</h2>
      <ul className="mt-3 space-y-2 text-fg-muted">
        {[
          "Rewrites the Printables project so Snapmaker Orca loads it as a native U1 file",
          "Applies the real Snapmaker U1 profile in place of the source printer's",
          "Keeps the multicolor painting — mapped onto the U1's 4 slots, text & logos included",
          "Keeps the creator's print settings (layer height, walls, infill, speeds)",
          "More than 4 colors? Full Spectrum mixes 2–3 filaments to reproduce the extras",
          "Runs 100% in your browser — nothing uploaded, free, no account",
        ].map((s) => (
          <li key={s} className="flex gap-2">
            <span className="mt-0.5 shrink-0 text-violet-400">✓</span>
            <span>{s}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-sm text-fg-muted">
        Works with .3mf projects from Printables, MakerWorld, PrusaSlicer, Bambu Studio and Creality Print.
        See the full <Link href="/features" className="text-violet-300 hover:underline">feature list &amp; comparison</Link>.
      </p>

      <h2 className="mt-10 text-xl font-semibold tracking-tight text-fg">FAQ</h2>
      <div className="mt-4 space-y-5">
        {faq.map((f) => (
          <div key={f.q}>
            <h3 className="font-semibold text-fg">{f.q}</h3>
            <p className="mt-1 text-sm text-fg-muted">{f.a}</p>
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
        <p className="font-semibold text-fg">Ready to print that Printables model on your U1?</p>
        <Link href="/convert" className="btn-primary btn-lg mt-4 inline-flex">
          Convert your .3mf — free
        </Link>
      </div>

      <p className="mt-6 text-sm text-fg-muted">
        See also:{" "}
        <Link href="/bambu-to-snapmaker-u1" className="text-violet-300 hover:underline">Bambu → U1</Link>,{" "}
        <Link href="/prusaslicer-to-snapmaker-u1" className="text-violet-300 hover:underline">PrusaSlicer → U1</Link>,{" "}
        <Link href="/licenses" className="text-violet-300 hover:underline">licensing note</Link>.
      </p>

      <p className="mt-8 text-[11px] text-fg-subtle">
        Independent project — not affiliated with, endorsed by, or sponsored by Snapmaker or Printables /
        Prusa Research. Printables is a trademark of Prusa Research. All product names are trademarks of their
        respective owners.
      </p>
    </main>
  );
}
