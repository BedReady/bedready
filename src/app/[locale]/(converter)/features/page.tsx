import { use } from "react";
import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { alternates } from "@/lib/seo";

export const metadata = {
  title: "Converter features — BedReady",
  description:
    "Everything the BedReady converter does: multicolor on the U1's 4 slots, Full Spectrum mixing, spool-swap pauses, U1-safe profile, live preview, multi-part split, STL ↔ 3MF, and retargeting to other printers (Bambu/Prusa/Creality) or a clean generic 3MF. Free, in your browser.",
  alternates: alternates("/features"),
};

type Group = { title: string; items: string[] };

export default function FeaturesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  setRequestLocale(locale);
  const t = useTranslations("features");
  const groups = t.raw("groups") as Group[];

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tight text-fg sm:text-4xl">{t("title")}</h1>
      <p className="mt-3 max-w-2xl text-fg-muted">{t("intro")}</p>

      <div className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2">
        {groups.map((g) => (
          <div key={g.title} className="border-t border-line pt-5">
            <h2 className="text-sm font-semibold text-fg">{g.title}</h2>
            <ul className="mt-3 space-y-2 text-sm leading-relaxed text-fg-muted">
              {g.items.map((it, i) => (
                <li key={i}>{it}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Honest, capability-based comparison — why BedReady is the most complete U1 converter. */}
      <h2 className="mt-16 border-t border-line pt-10 text-xl font-semibold tracking-tight text-fg">How it compares</h2>
      <p className="mt-2 max-w-2xl text-sm text-fg-muted">
        Most .3mf→U1 converters swap the profile and map colors to the 4 slots. BedReady does that too — and
        keeps going.
      </p>
      <div className="mt-4 overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[30rem] text-start text-sm">
          <thead>
            <tr className="border-b border-line">
              <th className="eyebrow px-4 py-3 text-start">Capability</th>
              <th className="eyebrow px-4 py-3 text-center text-violet-300">BedReady</th>
              <th className="eyebrow px-4 py-3 text-center">Typical converter</th>
            </tr>
          </thead>
          <tbody className="text-fg-muted">
            {(
              [
                ["Swap to the real Snapmaker U1 profile", true, true],
                ["Painted multicolor → the U1's 4 slots", true, true],
                ["Keeps the creator's print settings (layer height, walls, speeds)", true, "rare"],
                ["More than 4 colors — Full Spectrum 2-/3-filament mixing", true, false],
                ["Mix from your own filaments (CMYK or any 4)", true, false],
                ["Reads PrusaSlicer / Orca ColorMix mixed-filament files", true, false],
                ["Retarget to other printers (Bambu/Prusa/Creality) or a clean generic 3MF", true, false],
                ["STL → 3MF and 3MF → STL, both directions", true, "rare"],
                ["Color match tuned to what the U1 actually prints", true, false],
                ["Fixes spool-swap pauses", true, false],
                ["Keeps text, logos & fine painted detail", true, "sometimes"],
                ["100% in your browser — nothing uploaded", true, "some upload"],
                ["Library of files with profiles verified to print on a U1", true, false],
              ] as [string, boolean, boolean | string][]
            ).map(([label, us, them], i) => (
              <tr key={i} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5">{label}</td>
                <td className="px-4 py-2.5 text-center">
                  {us ? <span className="text-green-400">✓</span> : <span className="text-fg-subtle">✗</span>}
                </td>
                <td className="px-4 py-2.5 text-center">
                  {them === true ? (
                    <span className="text-green-400">✓</span>
                  ) : them === false ? (
                    <span className="text-fg-subtle">✗</span>
                  ) : (
                    <span className="text-fg-subtle">{them}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-fg-subtle">
        Comparison reflects common .3mf→U1 converters as of 2026; capabilities vary by tool.
      </p>

      <div className="mt-10 flex flex-wrap gap-3">
        <Link href="/convert" className="btn-primary btn-lg">
          {t("ctaConvert")}
        </Link>
        <Link href="/designs" className="btn-secondary btn-lg">
          {t("ctaBrowse")}
        </Link>
      </div>
      <p className="mt-4 text-xs text-fg-subtle">{t("note")}</p>
    </main>
  );
}
