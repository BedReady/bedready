import { setRequestLocale } from "next-intl/server";
import { ldJson } from "@/lib/json-ld";
import { Link } from "@/i18n/navigation";
import { alternates } from "@/lib/seo";

export const metadata = {
  title: "Convert PrusaSlicer .3mf to the Snapmaker U1 — BedReady",
  description:
    "Convert a PrusaSlicer / MMU .3mf to print on the Snapmaker U1 — painted colors, supports and seams translated, the real U1 profile applied. Free, in your browser, nothing uploaded.",
  alternates: alternates("/prusaslicer-to-snapmaker-u1"),
};

const faq = [
  {
    q: "Does it read my MMU color painting?",
    a: "Yes. PrusaSlicer stores MMU color painting as slic3rpe:mmu_segmentation paint data. BedReady translates that into the paint_color format Snapmaker Orca reads, so every painted face maps onto the U1's 4 slots instead of loading as plain gray geometry.",
  },
  {
    q: "What about painted supports and seams?",
    a: "Those come across too. BedReady translates PrusaSlicer's custom-support painting (slic3rpe:custom_supports) and seam painting (slic3rpe:custom_seam) into Orca's paint_supports and paint_seam attributes, so your enforced/blocked supports and seam placement survive the conversion.",
  },
  {
    q: "Which PrusaSlicer version and export format should I use?",
    a: "Export the project as a .3mf (File → Export → Export project as 3MF, or Save Project) rather than a plain STL. The .3mf is what carries the paint data and the filament palette; recent PrusaSlicer 2.x releases all use the slic3rpe paint attributes BedReady understands.",
  },
  {
    q: "Why can't Snapmaker Orca just open the PrusaSlicer file?",
    a: "PrusaSlicer writes its paint data under its own slic3rpe namespace and tags the file with a Prusa generator string. Snapmaker Orca only fully trusts its own native projects, so it treats the Prusa file as foreign — dropping the paint and loading geometry only. BedReady renames the paint attributes and rewrites the generator so Orca loads it as native.",
  },
  {
    q: "Is my file uploaded anywhere?",
    a: "No. The conversion runs entirely in your browser — the .3mf never leaves your device, there's no account, and it's free.",
  },
];

export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <main className="shell py-12">
      <h1 className="text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
        Convert PrusaSlicer files to the Snapmaker U1
      </h1>
      <p className="mt-4 text-lg text-fg-muted">
        Drop a PrusaSlicer or MMU <code className="text-violet-300">.3mf</code> into BedReady and get a
        U1-ready file back — painted colors, supports and seams translated into Snapmaker Orca&apos;s format
        and the real U1 profile applied. Free, in your browser, nothing uploaded.
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
        PrusaSlicer stores everything you painted — MMU colors, custom supports, seam placement — under its
        own <code>slic3rpe:</code> attributes, alongside a Prusa/MMU printer profile and its own filament
        palette. Snapmaker Orca can&apos;t read that directly: it tags the file as a foreign Prusa project,
        drops the paint data, and loads the model as plain gray geometry with the wrong profile. Redoing the
        color painting, supports and seams by hand defeats the point of a project file.
      </p>

      <h2 className="mt-8 text-xl font-semibold tracking-tight text-fg">What BedReady does in one click</h2>
      <ul className="mt-3 space-y-2 text-fg-muted">
        {[
          "Translates PrusaSlicer paint data — colors, supports and seams — into Orca's paint_* format",
          "Rewrites the Prusa generator string so Orca loads the file as a native U1 project",
          "Applies the real Snapmaker U1 profile in place of the Prusa/MMU one",
          "Reads the filament palette from the Slic3r_PE config and maps colors to the U1's 4 slots",
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
        Works with files from PrusaSlicer, OrcaSlicer, Bambu Studio, MakerWorld and Creality Print. See the
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
        <p className="font-semibold text-fg">Ready to print your PrusaSlicer project on the U1?</p>
        <Link href="/convert" className="btn-primary btn-lg mt-4 inline-flex">
          Convert your .3mf — free
        </Link>
      </div>

      <p className="mt-6 text-base text-fg-muted">
        See also:{" "}
        <Link href="/bambu-to-snapmaker-u1" className="text-violet-300 hover:underline">Bambu → U1</Link>,{" "}
        <Link href="/creality-to-snapmaker-u1" className="text-violet-300 hover:underline">Creality → U1</Link>.{" "}
        Going the other way? <Link href="/u1-to-prusa" className="text-violet-300 hover:underline">U1 → Prusa</Link>.
      </p>

      <p className="mt-8 text-xs text-fg-subtle">
        Independent project — not affiliated with, endorsed by, or sponsored by Snapmaker or Prusa Research.
        PrusaSlicer is a trademark of Prusa Research. All product names are trademarks of their respective
        owners.
      </p>
    </main>
  );
}
