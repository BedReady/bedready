import { setRequestLocale } from "next-intl/server";
import { ldJson } from "@/lib/json-ld";
import { Link } from "@/i18n/navigation";
import { alternates } from "@/lib/seo";

export const metadata = {
  title: "Convert Creality Print .3mf to the Snapmaker U1 — BedReady",
  description:
    "Convert a Creality Print .3mf (K-series / CFS multicolor) to print on the Snapmaker U1 — CFS colors mapped to the U1's 4 slots, the real U1 profile applied. Free, in your browser.",
  alternates: alternates("/creality-to-snapmaker-u1"),
};

const faq = [
  {
    q: "Can I open a Creality Print .3mf directly on the U1?",
    a: "Not cleanly. Creality Print writes the file with a Creality generator string and a creality.config vendor marker; Snapmaker Orca ignores that marker and treats the file as foreign, loading it with the wrong profile and often dropping the colors. BedReady rewrites it so Orca loads it as a native U1 project.",
  },
  {
    q: "Are my CFS multicolor colors kept?",
    a: "Yes. The color painting Creality Print produced for the CFS multi-material unit is read from the .3mf and mapped onto the U1's 4 filament slots, so painted faces — text, logos, detail — print in color instead of collapsing to gray geometry.",
  },
  {
    q: "My model has more than 4 CFS colors — will it still print?",
    a: "The U1 has 4 physical slots, so the first four CFS colors map straight across. Beyond that, Full Spectrum reproduces the extra shades by dithering 2- and 3-filament mixes from the four loaded colors, so a 5- or 6-color CFS model prints without swapping filament by hand.",
  },
  {
    q: "Does it fix the profile and machine settings for the U1?",
    a: "Yes. BedReady swaps the Creality K-series printer profile for the real Snapmaker U1 profile and normalizes the machine settings, so speeds, prime tower and filament-change behavior match the U1 rather than a Creality machine.",
  },
  {
    q: "Is my file uploaded anywhere?",
    a: "No. Conversion runs entirely in your browser — the .3mf never leaves your device, there's no account, and it's free.",
  },
];

export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <main className="page-read py-12">
      <h1 className="text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
        Convert Creality Print files to the Snapmaker U1
      </h1>
      <p className="mt-4 text-lg text-fg-muted">
        Drop a Creality Print <code className="text-violet-300">.3mf</code> (K-series / CFS multicolor) into
        BedReady and get a U1-ready file back — your CFS colors mapped onto the U1&apos;s 4 slots and the real
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
        A Creality Print <code>.3mf</code> is sliced for a Creality machine — a K-series printer with the CFS
        multi-color unit — and carries a Creality printer profile plus a <code>creality.config</code> vendor
        marker and its own color mapping. Snapmaker Orca ignores that marker and treats the file as foreign:
        it loads the wrong profile, the CFS colors land in the wrong slots — or drop out as plain gray
        geometry — and the machine settings are tuned for Creality hardware, not the U1. Re-doing it by hand
        is tedious.
      </p>

      <h2 className="mt-8 text-xl font-semibold tracking-tight text-fg">What BedReady does in one click</h2>
      <ul className="mt-3 space-y-2 text-fg-muted">
        {[
          "Rewrites the Creality generator so Snapmaker Orca loads the file as a native U1 project",
          "Swaps the Creality K-series profile for the real Snapmaker U1 profile",
          "Maps the CFS multicolor onto the U1's 4 slots — text, logos & detail kept exactly",
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
      <p className="mt-4 text-base text-fg-muted">
        Works with files from Creality Print, PrusaSlicer, Bambu Studio, MakerWorld and OrcaSlicer. See the
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
        <p className="font-semibold text-fg">Ready to print that Creality model on your U1?</p>
        <Link href="/convert" className="btn-primary btn-lg mt-4 inline-flex">
          Convert your .3mf — free
        </Link>
      </div>

      <p className="mt-6 text-base text-fg-muted">
        See also:{" "}
        <Link href="/bambu-to-snapmaker-u1" className="text-violet-300 hover:underline">Bambu → U1</Link>,{" "}
        <Link href="/prusaslicer-to-snapmaker-u1" className="text-violet-300 hover:underline">PrusaSlicer → U1</Link>.{" "}
        Going the other way? <Link href="/u1-to-creality" className="text-violet-300 hover:underline">U1 → Creality</Link>.
      </p>

      <p className="mt-8 text-xs text-fg-subtle">
        Independent project — not affiliated with, endorsed by, or sponsored by Snapmaker or Creality. Creality
        Print, CFS and the K-series names are trademarks of Creality. All product names are trademarks of their
        respective owners.
      </p>
    </main>
  );
}
