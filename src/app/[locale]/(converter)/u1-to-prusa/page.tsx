import { setRequestLocale } from "next-intl/server";
import { ldJson } from "@/lib/json-ld";
import { Link } from "@/i18n/navigation";
import { alternates } from "@/lib/seo";

export const metadata = {
  title: "Convert a Snapmaker U1 .3mf to PrusaSlicer (MK4 + MMU3) — BedReady",
  description:
    "Open a Snapmaker U1 .3mf in PrusaSlicer for the Prusa MK4 + MMU3. BedReady saves a clean 3MF PrusaSlicer accepts — geometry preserved. Free, in your browser, nothing uploaded.",
  alternates: alternates("/u1-to-prusa"),
};

const faq = [
  {
    q: "Will my U1 colors transfer to PrusaSlicer?",
    a: "The geometry transfers exactly. Painted color is the caveat: the Snapmaker U1 uses an OrcaSlicer-family project, while PrusaSlicer stores its multi-material painting in a different format. BedReady saves a clean 3MF that PrusaSlicer opens without a foreign profile — but you may need to re-apply multicolor with PrusaSlicer's paint tool. We tell you this up front rather than shipping a file that silently imports gray.",
  },
  {
    q: "Why not fully translate the colors like the Bambu conversion does?",
    a: "Bambu Studio and the U1 share the same OrcaSlicer 3MF dialect, so colors remap one-to-one. PrusaSlicer uses a genuinely different project and paint format — rewriting one into the other reliably isn't something any converter can promise, so we're honest about it instead of guessing.",
  },
  {
    q: "What about the MMU3's 5 slots?",
    a: "The Prusa MK4 + MMU3 has 5 filament slots. BedReady targets the MK4 + MMU3 profile and bed; once open in PrusaSlicer you assign paint across up to 5 slots there.",
  },
  {
    q: "Why does a Snapmaker U1 .3mf open wrong in PrusaSlicer?",
    a: "A U1 project carries the Snapmaker U1 (Orca) printer profile and toolchanger machine settings. PrusaSlicer loads it with a foreign profile — wrong machine, bed and settings. BedReady strips that and hands PrusaSlicer clean geometry it accepts.",
  },
  {
    q: "Is my file uploaded anywhere?",
    a: "No. The whole conversion runs inside your browser — the .3mf never leaves your device, there's no upload and no account. It's free.",
  },
];

export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <main className="shell py-12">
      <h1 className="text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
        Convert a Snapmaker U1 file to PrusaSlicer (MK4 + MMU3)
      </h1>
      <p className="mt-4 text-lg text-fg-muted">
        Want to open a Snapmaker U1 <code className="text-violet-300">.3mf</code> in PrusaSlicer for your MK4 +
        MMU3? Drop it into BedReady and get back a clean 3MF that PrusaSlicer accepts — the U1 profile stripped
        and the geometry preserved. Free, in your browser, nothing uploaded.
      </p>
      <div className="mt-5 rounded-lg border border-line bg-surface-2 px-5 py-4 text-sm text-fg-muted">
        <span className="font-semibold text-fg">Heads up on color:</span> PrusaSlicer uses a different project
        format than the U1&apos;s Orca-based one, so geometry carries over but painted multicolor may need
        re-applying in PrusaSlicer&apos;s paint tool. We say so up front — no silent gray imports.
      </div>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href={{ pathname: "/convert", query: { to: "prusa-mk4-mmu3" } }}
          className="btn-primary btn-lg"
        >
          Convert for Prusa — free
        </Link>
        <Link href="/extension" className="rounded-lg border border-line bg-surface-2 px-6 py-3 font-semibold text-fg transition hover:bg-surface-3">
          Get the browser extension
        </Link>
      </div>
      <p className="mt-3 text-xs text-fg-subtle">100% in your browser — your file is never uploaded.</p>

      <h2 className="mt-12 text-xl font-semibold tracking-tight text-fg">The problem</h2>
      <p className="mt-2 text-fg-muted">
        A Snapmaker U1 <code>.3mf</code> is a native U1 project bundled with the Snapmaker U1&apos;s Orca-based
        printer profile and toolchanger machine settings. Open it in PrusaSlicer and it inherits the wrong
        printer, the wrong bed and machine settings meant for a toolchanger, not the MK4 + MMU3. PrusaSlicer
        also can&apos;t read the U1&apos;s Orca-format color painting, so multicolor doesn&apos;t come across.
      </p>

      <h2 className="mt-8 text-xl font-semibold tracking-tight text-fg">What BedReady does in one click</h2>
      <ul className="mt-3 space-y-2 text-fg-muted">
        {[
          "Strips the Snapmaker U1 profile so PrusaSlicer opens the file cleanly, no foreign profile",
          "Preserves the geometry exactly — models, parts and plates intact",
          "Targets the Prusa MK4 + MMU3 (5 slots) so you assign paint there",
          "Tells you up front when painted color needs re-applying — no silent gray imports",
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
        <Link href="/prusaslicer-to-snapmaker-u1" className="text-violet-300 hover:underline">PrusaSlicer files to the U1</Link>.
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
        <p className="font-semibold text-fg">Ready to open that U1 model in PrusaSlicer?</p>
        <Link
          href={{ pathname: "/convert", query: { to: "prusa-mk4-mmu3" } }}
          className="btn-primary btn-lg mt-4 inline-flex"
        >
          Convert your .3mf — free
        </Link>
      </div>

      <p className="mt-6 text-base text-fg-muted">
        See also:{" "}
        <Link href="/u1-to-bambu" className="text-violet-300 hover:underline">U1 → Bambu</Link>,{" "}
        <Link href="/u1-to-creality" className="text-violet-300 hover:underline">U1 → Creality</Link>.
      </p>

      <p className="mt-8 text-xs text-fg-subtle">
        Independent project — not affiliated with, endorsed by, or sponsored by Snapmaker or Prusa Research.
        PrusaSlicer, MK4 and MMU3 are trademarks of Prusa Research. All product names are trademarks of their
        respective owners.
      </p>
    </main>
  );
}
