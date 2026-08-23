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
    title: "Convert a Snapmaker U1 .3mf to Bambu Studio (X1 / P1 / A1) — BedReady",
    description:
      "Print a Snapmaker U1 multicolor .3mf on a Bambu Lab X1, P1S or A1. BedReady swaps the U1 profile for the Bambu one and remaps your painted colors onto the AMS slots. Free, in your browser.",
    alternates: alternates("/u1-to-bambu", locale),
  };
}

const faq = [
  {
    q: "Will my U1 painted colors transfer to Bambu?",
    a: "Yes. Snapmaker's Orca-based U1 files and Bambu Studio share the same 3MF paint format, so BedReady reads your U1 color painting and remaps each slot onto a Bambu AMS slot. Text, logos and fine detail stay painted instead of collapsing to gray geometry.",
  },
  {
    q: "Which Bambu printers does it target?",
    a: "The Bambu Lab X1 Carbon, P1S and A1 — pick the one you own in the converter's target-printer menu. BedReady writes the matching printer profile and bed size into the file so it opens ready to slice.",
  },
  {
    q: "Why does a Snapmaker U1 .3mf open wrong in Bambu Studio?",
    a: "A U1 project carries a Snapmaker U1 (Orca) printer profile plus toolchanger machine settings. Bambu Studio only trusts its own project files, so it loads the U1 one with a foreign profile — the wrong machine, wrong bed and often mis-mapped filament slots.",
  },
  {
    q: "My U1 model uses all 4 slots — will they fit the AMS?",
    a: "Yes. The U1's 4 slots map straight across to a 4-slot AMS. BedReady lines the colors up in order so what you painted on the U1 is what loads on the Bambu.",
  },
  {
    q: "Is my file uploaded anywhere?",
    a: "No. The whole conversion runs inside your browser — the .3mf never leaves your device, there's no upload and no account. It's free.",
  },
  {
    q: "Do I still slice it in Bambu Studio?",
    a: "Yes. BedReady hands back a Bambu-ready .3mf that you open and slice in Bambu Studio (or Orca). It keeps the creator's print settings unless you change them there.",
  },
];

export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <main className="page-read py-12">
      <h1 className="text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
        Convert a Snapmaker U1 file to Bambu Lab (X1 / P1 / A1)
      </h1>
      <p className="mt-4 text-lg text-fg-muted">
        Got a multicolor <code className="text-violet-300">.3mf</code> built for the Snapmaker U1 but want to
        print it on your Bambu Lab X1, P1S or A1? Drop it into BedReady and get a Bambu-ready file back — the
        U1 profile swapped for the Bambu one and your painted colors remapped onto the AMS slots. Free, in your
        browser, nothing uploaded.
      </p>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href={{ pathname: "/convert", query: { to: "bambu-x1c" } }}
          className="btn-primary btn-lg"
        >
          Convert for Bambu — free
        </Link>
        <Link href="/extension" className="rounded-lg border border-line bg-surface-2 px-6 py-3 font-semibold text-fg transition hover:bg-surface-3">
          Get the browser extension
        </Link>
      </div>
      <p className="mt-3 text-xs text-fg-subtle">100% in your browser — your file is never uploaded.</p>

      <h2 className="mt-12 text-xl font-semibold tracking-tight text-fg">The problem</h2>
      <p className="mt-2 text-fg-muted">
        A Snapmaker U1 <code>.3mf</code> is a native U1 project. It&apos;s bundled with the Snapmaker U1&apos;s
        Orca-based printer profile plus toolchanger machine and filament settings. Open it in Bambu Studio and
        the printer inherits the wrong profile, the bed and build volume are off, and the slot assignments
        don&apos;t line up with your AMS. Re-assigning every color by hand is slow and easy to get wrong.
      </p>

      <h2 className="mt-8 text-xl font-semibold tracking-tight text-fg">What BedReady does in one click</h2>
      <ul className="mt-3 space-y-2 text-fg-muted">
        {[
          "Swaps the Snapmaker U1 profile for the Bambu X1 / P1S / A1 profile you pick",
          "Remaps your U1-painted colors onto the AMS slots — text, logos & detail kept exactly",
          "Sets the correct Bambu bed size and build height",
          "Keeps the creator's print settings (layer height, walls, infill, speeds)",
          "Runs 100% in your browser — nothing uploaded, free, no account",
        ].map((s) => (
          <li key={s} className="flex gap-2">
            <span className="mt-0.5 shrink-0 text-violet-400">✓</span>
            <span>{s}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-base text-fg-muted">
        Going the other way? BedReady also converts{" "}
        <Link href="/bambu-to-snapmaker-u1" className="text-violet-300 hover:underline">Bambu files to the U1</Link>.
        See the full <Link href="/features" className="text-violet-300 hover:underline">feature list &amp; comparison</Link>.
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
        <p className="font-semibold text-fg">Ready to print that U1 model on your Bambu?</p>
        <Link
          href={{ pathname: "/convert", query: { to: "bambu-x1c" } }}
          className="btn-primary btn-lg mt-4 inline-flex"
        >
          Convert your .3mf — free
        </Link>
      </div>

      <p className="mt-6 text-base text-fg-muted">
        See also:{" "}
        <Link href="/u1-to-prusa" className="text-violet-300 hover:underline">U1 → Prusa</Link>,{" "}
        <Link href="/u1-to-creality" className="text-violet-300 hover:underline">U1 → Creality</Link>,{" "}
        <Link href="/compare-multicolor-printers" className="text-violet-300 hover:underline">printer comparison</Link>.
      </p>

      <p className="mt-8 text-xs text-fg-subtle">
        Independent project — not affiliated with, endorsed by, or sponsored by Snapmaker or Bambu Lab. Bambu
        Studio, AMS, X1, P1 and A1 are trademarks of Bambu Lab. All product names are trademarks of their
        respective owners.
      </p>
    </main>
  );
}
