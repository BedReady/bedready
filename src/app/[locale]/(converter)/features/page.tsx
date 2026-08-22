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

/**
 * One encoding per column.
 *
 * The "typical converter" column used to mix ✓, ✗, "rare", "sometimes" and "some upload" — glyphs
 * and prose answering the same question, so the column could not be scanned and the rows could not
 * be compared with each other. A reader had to re-read every cell to work out which axis it was on.
 *
 * Three marks, always; the nuance that used to replace the mark now sits under it as a qualifier,
 * where it adds to the answer instead of standing in for it.
 */
type Support = true | false | "partial";

function Mark({ value, note }: { value: Support; note?: string }) {
  const label = value === true ? "Yes" : value === false ? "No" : "Partly";
  return (
    <span className="inline-flex flex-col items-center gap-0.5">
      <span
        aria-hidden
        className={
          value === true
            ? "text-emerald-400"
            : value === "partial"
              ? "text-amber-400"
              : "text-fg-subtle"
        }
      >
        {value === true ? "✓" : value === "partial" ? "◐" : "✗"}
      </span>
      <span className="sr-only">{label}</span>
      {note && <span className="text-[11px] leading-none text-fg-subtle">{note}</span>}
    </span>
  );
}

export default function FeaturesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  setRequestLocale(locale);
  const t = useTranslations("features");
  const groups = t.raw("groups") as Group[];

  return (
    <main className="shell py-12">
      <h1 className="text-3xl font-semibold tracking-tight text-fg sm:text-4xl">{t("title")}</h1>
      <p className="mt-3 max-w-2xl text-fg-muted">{t("intro")}</p>

      {/* The last group used to sit alone in the left column with an empty cell beside it — seven
          groups in a two-column grid. It spans instead, which reads as a closing row rather than an
          orphan. */}
      <div className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2">
        {groups.map((g, gi) => (
          <div
            key={g.title}
            className={`border-t border-line pt-5 ${gi === groups.length - 1 && groups.length % 2 === 1 ? "sm:col-span-2" : ""}`}
          >
            <h2 className="text-sm font-semibold text-fg">{g.title}</h2>
            <ul
              className={`mt-3 space-y-2 text-sm leading-relaxed text-fg-muted ${
                gi === groups.length - 1 && groups.length % 2 === 1 ? "sm:columns-2 sm:gap-x-10" : ""
              }`}
            >
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
      <div className="breakout mt-4 overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[30rem] text-start text-sm">
          <thead>
            <tr className="border-b border-line">
              <th className="eyebrow px-4 py-3 text-start">Capability</th>
              {/* The column the page is arguing for is the one the eye should land on. It had no
                  anchor at all: same weight, same ground, same alignment as the one beside it. */}
              <th className="eyebrow bg-violet-400/10 px-4 py-3 text-center text-violet-300">BedReady</th>
              <th className="eyebrow px-4 py-3 text-center">Typical converter</th>
            </tr>
          </thead>
          <tbody className="text-fg-muted">
            {(
              [
                ["Swap to the real Snapmaker U1 profile", true, true],
                ["Painted multicolor → the U1's 4 slots", true, true],
                ["Keeps the creator's print settings (layer height, walls, speeds)", true, "partial", "rare"],
                ["More than 4 colors — Full Spectrum 2-/3-filament mixing", true, false],
                ["Mix from your own filaments (CMYK or any 4)", true, false],
                ["Reads PrusaSlicer / Orca ColorMix mixed-filament files", true, false],
                ["Retarget to other printers (Bambu/Prusa/Creality) or a clean generic 3MF", true, false],
                ["STL → 3MF and 3MF → STL, both directions", true, "partial", "rare"],
                ["Color match tuned to what the U1 actually prints", true, false],
                ["Fixes spool-swap pauses", true, false],
                ["Keeps text, logos & fine painted detail", true, "partial", "sometimes"],
                ["100% in your browser — nothing uploaded", true, "partial", "some upload"],
                ["Library of files with profiles verified to print on a U1", true, false],
              ] as [string, Support, Support, string?][]
            ).map(([label, us, them, note], i) => (
              <tr key={i} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5">{label}</td>
                <td className="bg-violet-400/[0.06] px-4 py-2.5 text-center">
                  <Mark value={us} />
                </td>
                <td className="px-4 py-2.5 text-center">
                  <Mark value={them} note={note} />
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
        <Link href="/verified" className="btn-secondary btn-lg">
          {t("ctaBrowse")}
          <span aria-hidden className="text-[0.85em] text-fg-subtle">↗</span>
        </Link>
      </div>
      <p className="mt-4 text-xs text-fg-subtle">{t("note")}</p>
    </main>
  );
}
