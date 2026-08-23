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
    title: "Convert Bambu Studio .3mf to the Snapmaker U1 — BedReady",
    description:
      "Convert a Bambu Studio .3mf (X1, P1, A1 + AMS) to print on the Snapmaker U1 — AMS-painted colors mapped to the U1's 4 slots, real U1 profile applied. Free, in your browser.",
    alternates: alternates("/bambu-to-snapmaker-u1", locale),
  };
}

const faq = [
  {
    q: "Will my AMS colors transfer to the U1?",
    a: "Yes. Bambu Studio stores your AMS color painting as face-level paint data inside the .3mf. BedReady reads that painting and maps each AMS filament onto one of the U1's 4 slots, so every painted face — text, logos, fine detail — lands on the right color instead of collapsing to gray geometry.",
  },
  {
    q: "My model uses more than 4 AMS colors — what happens?",
    a: "The U1 has 4 physical filament slots, so the first four AMS colors map straight across. For anything beyond that, Full Spectrum reproduces the extra shades by dithering 2- and 3-filament mixes from the four loaded colors, so a 6- or 8-color AMS model still prints without a hardware swap.",
  },
  {
    q: "Why does a Bambu .3mf open wrong in Snapmaker Orca?",
    a: "A Bambu Studio file is a native Bambu project: it carries an X1/P1/A1 printer profile and Bambu-specific filament and machine settings. Snapmaker Orca only trusts its own project files, so it loads the Bambu one with a foreign profile and often drops the paint data — you get the wrong machine settings and mis-mapped or missing colors.",
  },
  {
    q: "Is my Bambu file uploaded anywhere?",
    a: "No. The whole conversion runs inside your browser — the .3mf never leaves your device, there's no upload and no account. It's free.",
  },
  {
    q: "Do I still slice it in Snapmaker Orca?",
    a: "Yes. BedReady hands back a U1-ready .3mf that you open and slice in Snapmaker Orca. It keeps the creator's print settings (layer height, walls, infill, speeds) unless you opt into the tested U1 profile instead.",
  },
];

export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <main className="page-read py-12">
      <h1 className="text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
        Convert Bambu Studio files to the Snapmaker U1
      </h1>
      <p className="mt-4 text-lg text-fg-muted">
        Drop a Bambu Studio <code className="text-violet-300">.3mf</code> (X1, P1, A1 + AMS) into BedReady and
        get a U1-ready file back — your AMS-painted colors mapped onto the U1&apos;s 4 slots and the real
        Snapmaker U1 profile applied. Free, in your browser, nothing uploaded.
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
        A Bambu Studio <code>.3mf</code> is a native Bambu project. It&apos;s painted for the AMS multi-material
        workflow and bundled with an X1/P1/A1 printer profile plus Bambu-specific machine and filament
        settings. Open it in Snapmaker Orca and the U1 inherits the wrong printer profile, your AMS colors
        land in the wrong slots — or drop out entirely as plain gray geometry — and the filament-change and
        prime-tower behavior is set up for a Bambu machine, not the U1&apos;s toolchanger. Re-painting every
        face by hand can take hours.
      </p>

      <h2 className="mt-8 text-xl font-semibold tracking-tight text-fg">What BedReady does in one click</h2>
      <ul className="mt-3 space-y-2 text-fg-muted">
        {[
          "Swaps the Bambu X1/P1/A1 profile for the real Snapmaker U1 profile",
          "Maps your AMS-painted colors onto the U1's 4 slots — text, logos & detail kept exactly",
          "Keeps the creator's print settings (layer height, walls, infill, speeds)",
          "More than 4 AMS colors? Full Spectrum mixes 2–3 filaments to reproduce the extras",
          "Normalizes Bambu's auto-sentinel settings and prime-tower setup for the U1",
          "Runs 100% in your browser — nothing uploaded, free, no account",
        ].map((s) => (
          <li key={s} className="flex gap-2">
            <span className="mt-0.5 shrink-0 text-violet-400">✓</span>
            <span>{s}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-base text-fg-muted">
        Works with files from Bambu Studio, MakerWorld, PrusaSlicer, OrcaSlicer and Creality Print. See the
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
        <p className="font-semibold text-fg">Ready to print that Bambu model on your U1?</p>
        <Link href="/convert" className="btn-primary btn-lg mt-4 inline-flex">
          Convert your .3mf — free
        </Link>
      </div>

      <p className="mt-6 text-base text-fg-muted">
        See also:{" "}
        <Link href="/printables-to-snapmaker-u1" className="text-violet-300 hover:underline">Printables → U1</Link>,{" "}
        <Link href="/prusaslicer-to-snapmaker-u1" className="text-violet-300 hover:underline">PrusaSlicer → U1</Link>.{" "}
        Going the other way? <Link href="/u1-to-bambu" className="text-violet-300 hover:underline">U1 → Bambu</Link>.
      </p>

      <p className="mt-8 text-xs text-fg-subtle">
        Independent project — not affiliated with, endorsed by, or sponsored by Snapmaker or Bambu Lab. Bambu
        Studio, AMS, X1, P1 and A1 are trademarks of Bambu Lab. All product names are trademarks of their
        respective owners.
      </p>
    </main>
  );
}
