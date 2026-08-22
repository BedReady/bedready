import { setRequestLocale } from "next-intl/server";
import { ldJson } from "@/lib/json-ld";
import { Link } from "@/i18n/navigation";
import { alternates } from "@/lib/seo";

export const metadata = {
  title: "Multicolor 3D Printer Comparison — Snapmaker U1 vs Bambu vs Prusa vs Creality — BedReady",
  description:
    "How the Snapmaker U1, Bambu X1C (AMS), Prusa MK4+MMU3 and Creality K2 Plus compare for multicolor printing — slots, method, purge waste, software — and how to move .3mf files between them.",
  alternates: alternates("/compare-multicolor-printers"),
};

// Honest side-by-side. The U1's edge is the toolchanger (no purge/poop); AMS/MMU systems purge on every
// color change. All figures are the maker-facing basics, not a spec sheet.
type Row = { label: string; u1: string; bambu: string; prusa: string; creality: string };
const ROWS: Row[] = [
  { label: "Multicolor method", u1: "4-tool toolchanger", bambu: "AMS (single hotend)", prusa: "MMU3 (single hotend)", creality: "CFS (single hotend)" },
  { label: "Color slots", u1: "4", bambu: "4 (up to 16 w/ 4× AMS)", prusa: "5", creality: "4 (up to 16 w/ 4× CFS)" },
  { label: "Purge / waste per swap", u1: "None — no purge tower", bambu: "Purge + poop each change", prusa: "Purge tower each change", creality: "Purge each change" },
  { label: "Slicer", u1: "Snapmaker Orca", bambu: "Bambu Studio / Orca", prusa: "PrusaSlicer", creality: "Creality Print (Orca)" },
  { label: ">4 colors", u1: "Full Spectrum mixing / M600", bambu: "Add AMS units", prusa: "5 slots + swaps", creality: "Add CFS units" },
  { label: "BedReady converts", u1: "Native target ✓", bambu: "↔ U1 ✓ (same 3MF family)", prusa: "↔ U1 (geometry; re-paint)", creality: "↔ U1 ✓ (same 3MF family)" },
];

const faq = [
  {
    q: "Which multicolor printer wastes the least filament?",
    a: "The Snapmaker U1. It's a true toolchanger — each color has its own tool, so there's no purge tower or 'poop' on a color change. AMS (Bambu), MMU (Prusa) and CFS (Creality) all share one hotend, so they purge the old color out on every swap, which can add up to more waste than the print itself on color-heavy models.",
  },
  {
    q: "Can I print a Bambu or Prusa multicolor file on another printer?",
    a: "Often, yes — that's what BedReady does. Bambu Studio, OrcaSlicer, Snapmaker Orca and Creality Print share the same 3MF paint format, so painted colors carry across those cleanly. PrusaSlicer uses a different format, so geometry transfers but you may re-apply paint. Use the free in-browser converter to retarget a file to your printer.",
  },
  {
    q: "How many colors can each printer do?",
    a: "The U1 has 4 tools; the Prusa MMU3 has 5 slots; Bambu and Creality start at 4 and expand to 16 by chaining four AMS/CFS units. On the U1, Full Spectrum reproduces more than 4 colors by dithering mixes of the 4 loaded filaments, and M600 band-swaps keep exact colors with a few manual swaps.",
  },
  {
    q: "Is BedReady tied to one printer?",
    a: "No. It started U1-first but now retargets .3mf files between the U1, Bambu (X1C/P1S/A1), Prusa (MK4+MMU3) and Creality (K2 Plus), in your browser, free. The verified-profile library is U1-focused, but the converter is machine-agnostic.",
  },
];

export default async function ComparePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <main className="shell py-12">
      <h1 className="text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
        Multicolor 3D printer comparison
      </h1>
      <p className="mt-4 text-lg text-fg-muted">
        The Snapmaker U1, Bambu Lab X1C, Prusa MK4 + MMU3 and Creality K2 Plus all print in color — but very
        differently. Here&apos;s an honest side-by-side on slots, method and waste, plus how to move a{" "}
        <code className="text-violet-300">.3mf</code> between them.
      </p>

      <div className="mt-8 overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              <th className="py-2 pe-3 font-semibold text-fg-subtle"> </th>
              <th className="py-2 pe-3 font-semibold text-fg">Snapmaker U1</th>
              <th className="py-2 pe-3 font-semibold text-fg">Bambu X1C</th>
              <th className="py-2 pe-3 font-semibold text-fg">Prusa MK4+MMU3</th>
              <th className="py-2 pe-3 font-semibold text-fg">Creality K2 Plus</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.label} className="border-b border-line/60 align-top">
                <td className="py-2.5 pe-3 font-medium text-fg-muted">{r.label}</td>
                <td className="py-2.5 pe-3 text-fg">{r.u1}</td>
                <td className="py-2.5 pe-3 text-fg-muted">{r.bambu}</td>
                <td className="py-2.5 pe-3 text-fg-muted">{r.prusa}</td>
                <td className="py-2.5 pe-3 text-fg-muted">{r.creality}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-fg-subtle">
        Independent comparison — not sponsored by any manufacturer. Slots/features are the maker-facing basics;
        check each vendor for full specs.
      </p>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/convert" className="btn-primary btn-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50">
          Convert a file for your printer — free
        </Link>
      </div>

      <h2 className="mt-12 text-xl font-semibold tracking-tight text-fg">The real difference: purge waste</h2>
      <p className="mt-2 text-fg-muted">
        The headline spec everyone quotes is slot count, but the one that shows up in your filament bill is
        <em> purge</em>. A single-hotend system (AMS, MMU, CFS) has to flush the old color out of the nozzle on
        every change — a purge tower or discarded &quot;poop.&quot; On a color-dense model that waste can rival
        the part. The U1&apos;s toolchanger keeps each color on its own tool, so it doesn&apos;t purge at all.
        Whichever you own, BedReady&apos;s converter maps your colors onto its slots so the file just works.
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

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: ldJson({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
          }),
        }}
      />

      <p className="mt-10 text-base text-fg-muted">
        Converting between printers:{" "}
        <Link href="/u1-to-bambu" className="text-violet-300 hover:underline">U1 → Bambu</Link>,{" "}
        <Link href="/u1-to-prusa" className="text-violet-300 hover:underline">U1 → Prusa</Link>,{" "}
        <Link href="/u1-to-creality" className="text-violet-300 hover:underline">U1 → Creality</Link>,{" "}
        <Link href="/bambu-to-snapmaker-u1" className="text-violet-300 hover:underline">Bambu → U1</Link>.
      </p>

      <p className="mt-8 text-xs text-fg-subtle">
        Independent project — not affiliated with, endorsed by, or sponsored by Snapmaker, Bambu Lab, Prusa
        Research or Creality. All product names are trademarks of their respective owners.
      </p>
    </main>
  );
}
