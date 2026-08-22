import { setRequestLocale } from "next-intl/server";
import { ldJson } from "@/lib/json-ld";
import { Link } from "@/i18n/navigation";
import { alternates } from "@/lib/seo";

export const metadata = {
  title: "Convert a Snapmaker U1 .3mf to the Creality K2 Plus — BedReady",
  description:
    "Print a Snapmaker U1 multicolor .3mf on the Creality K2 Plus. Both use OrcaSlicer-family projects, so BedReady swaps the profile and remaps your painted colors onto the K2's slots. Free, in your browser.",
  alternates: alternates("/u1-to-creality"),
};

const faq = [
  {
    q: "Will my U1 painted colors transfer to the Creality K2?",
    a: "Yes — cleanly. The Snapmaker U1 and the Creality K2 Plus both use OrcaSlicer-family 3MF projects, so they share the same color-painting format. BedReady reads your U1 painting and remaps each slot onto the K2's slots, keeping text, logos and fine detail exactly.",
  },
  {
    q: "Why does a Snapmaker U1 .3mf open wrong in Creality Print?",
    a: "Even though both are Orca-based, a U1 project carries the Snapmaker U1 printer profile and toolchanger machine settings. Creality Print loads it with that foreign profile — the wrong machine, bed and slot setup — until the profile is swapped for the K2's.",
  },
  {
    q: "Does the K2's CFS map to the U1's slots?",
    a: "Yes. BedReady lines your U1 colors up onto the K2 Plus's multi-material slots in order, so what you painted on the U1 is what loads on the K2.",
  },
  {
    q: "Is my file uploaded anywhere?",
    a: "No. The whole conversion runs inside your browser — the .3mf never leaves your device, there's no upload and no account. It's free.",
  },
  {
    q: "Do I still slice it in Creality Print?",
    a: "Yes. BedReady hands back a K2-ready .3mf that you open and slice in Creality Print (or Orca). It keeps the creator's print settings unless you change them there.",
  },
];

export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <main className="shell py-12">
      <h1 className="text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
        Convert a Snapmaker U1 file to the Creality K2 Plus
      </h1>
      <p className="mt-4 text-lg text-fg-muted">
        Built a multicolor <code className="text-violet-300">.3mf</code> for the Snapmaker U1 and want to run it
        on your Creality K2 Plus? Drop it into BedReady and get a K2-ready file back — the U1 profile swapped for
        the K2&apos;s and your painted colors remapped onto its slots. Because both printers use
        OrcaSlicer-family projects, the colors carry over cleanly. Free, in your browser, nothing uploaded.
      </p>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href={{ pathname: "/convert", query: { to: "creality-k2" } }}
          className="btn-primary btn-lg"
        >
          Convert for Creality — free
        </Link>
        <Link href="/extension" className="rounded-lg border border-line bg-surface-2 px-6 py-3 font-semibold text-fg transition hover:bg-surface-3">
          Get the browser extension
        </Link>
      </div>
      <p className="mt-3 text-xs text-fg-subtle">100% in your browser — your file is never uploaded.</p>

      <h2 className="mt-12 text-xl font-semibold tracking-tight text-fg">The problem</h2>
      <p className="mt-2 text-fg-muted">
        A Snapmaker U1 <code>.3mf</code> is a native U1 project bundled with the Snapmaker U1&apos;s printer
        profile and toolchanger machine settings. Open it in Creality Print and — even though it&apos;s also
        Orca-based — the K2 inherits the wrong profile, the bed and build volume are off, and the slot
        assignments don&apos;t line up. Fixing it by hand means re-picking the printer and re-assigning colors.
      </p>

      <h2 className="mt-8 text-xl font-semibold tracking-tight text-fg">What BedReady does in one click</h2>
      <ul className="mt-3 space-y-2 text-fg-muted">
        {[
          "Swaps the Snapmaker U1 profile for the Creality K2 Plus profile",
          "Remaps your U1-painted colors onto the K2's slots — text, logos & detail kept exactly",
          "Sets the correct K2 Plus bed size and build height",
          "Keeps the creator's print settings (layer height, walls, infill, speeds)",
          "Runs 100% in your browser — nothing uploaded, free, no account",
        ].map((s) => (
          <li key={s} className="flex gap-2">
            <span className="mt-0.5 shrink-0 text-violet-400">✓</span>
            <span>{s}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-sm text-fg-muted">
        Going the other way? BedReady also converts{" "}
        <Link href="/creality-to-snapmaker-u1" className="text-violet-300 hover:underline">Creality files to the U1</Link>.
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
        <p className="font-semibold text-fg">Ready to print that U1 model on your K2?</p>
        <Link
          href={{ pathname: "/convert", query: { to: "creality-k2" } }}
          className="btn-primary btn-lg mt-4 inline-flex"
        >
          Convert your .3mf — free
        </Link>
      </div>

      <p className="mt-6 text-sm text-fg-muted">
        See also:{" "}
        <Link href="/u1-to-bambu" className="text-violet-300 hover:underline">U1 → Bambu</Link>,{" "}
        <Link href="/u1-to-prusa" className="text-violet-300 hover:underline">U1 → Prusa</Link>.
      </p>

      <p className="mt-8 text-[11px] text-fg-subtle">
        Independent project — not affiliated with, endorsed by, or sponsored by Snapmaker or Creality. Creality,
        K2 Plus and Creality Print are trademarks of Creality. All product names are trademarks of their
        respective owners.
      </p>
    </main>
  );
}
