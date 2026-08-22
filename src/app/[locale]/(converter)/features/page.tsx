import { use } from "react";
import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import Link from "@/components/SiteLink";
import { alternates } from "@/lib/seo";

export const metadata = {
  title: "Converter features — BedReady",
  description:
    "Everything the BedReady converter does: multicolor on the U1's 4 slots, Full Spectrum mixing, spool-swap pauses, U1-safe profile, live preview, multi-part split, STL ↔ 3MF, and retargeting to other printers (Bambu/Prusa/Creality) or a clean generic 3MF. Free, in your browser.",
  alternates: alternates("/features"),
};

/**
 * The feature list's structure, in code — the messages carry only the words.
 *
 * ── WHY THIS IS NOT AN ARRAY IN THE MESSAGE FILES ANY MORE ──────────────────────────────────────
 *
 * It was `groups: [{ title, items: string[] }]`, and the items were addressed by position. On
 * 2026-08-22 the new i18n parity guard reported eighteen keys missing from `features.groups` in the
 * six non-English locales. The count was right; the conclusion drawn from it was not. The locales
 * carried the SAME bullets in a DIFFERENT ORDER, each missing a different one — so translating
 * English's last three and appending them made every count match, satisfied the guard, and shipped
 * six languages a page that stated three claims twice while still omitting the three it never had.
 *
 * Positional keys are why that was possible: `groups.1.items.3` is a *slot*, and nothing can check
 * that the slot holds the same claim in German as in English. `groups.colors.items.prusaPaint` is a
 * *name*, and parity over names is the semantic check the guard could not previously make.
 *
 * Order lives here rather than in seven JSON files, so a translator cannot reorder one locale's page
 * by accident, and adding a bullet is one edit here plus seven translations that the guard then
 * demands.
 */
const GROUPS = [
  { key: "slicers", items: ["sources", "creality", "retag", "colormix"] },
  { key: "colors", items: ["slots", "preserved", "match", "prusaPaint"] },
  { key: "beyond4", items: ["fullSpectrum", "ownFilaments", "heightBands", "mixLayerHeight", "swapPauses"] },
  { key: "u1", items: ["profileMode", "primeTower", "limits", "report"] },
  { key: "control", items: ["preview", "reorder", "physical"] },
  { key: "exports", items: ["split", "stl", "strip"] },
  { key: "free", items: ["inBrowser", "freeLangs", "extension", "library"] },
] as const;

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
      {note && <span className="text-xs leading-none text-fg-subtle">{note}</span>}
    </span>
  );
}

export default function FeaturesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  setRequestLocale(locale);
  const t = useTranslations("features");


  return (
    <main className="page-read py-12">
      <h1 className="text-3xl font-semibold tracking-tight text-fg sm:text-4xl">{t("title")}</h1>
      <p className="mt-3 max-w-2xl text-fg-muted">{t("intro")}</p>

      {/* The last group used to sit alone in the left column with an empty cell beside it — seven
          groups in a two-column grid. It spans instead, which reads as a closing row rather than an
          orphan. */}
      <div className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2">
        {GROUPS.map((g, gi) => {
          const last = gi === GROUPS.length - 1 && GROUPS.length % 2 === 1;
          return (
            <div key={g.key} className={`border-t border-line pt-5 ${last ? "sm:col-span-2" : ""}`}>
              <h2 className="text-sm font-semibold text-fg">{t(`groups.${g.key}.title`)}</h2>
              <ul className={`mt-3 space-y-2 text-sm leading-relaxed text-fg-muted ${last ? "sm:columns-2 sm:gap-x-10" : ""}`}>
                {g.items.map((k) => (
                  <li key={k}>{t(`groups.${g.key}.items.${k}`)}</li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      {/* Honest, capability-based comparison — why BedReady is the most complete U1 converter. */}
      <h2 className="mt-16 border-t border-line pt-10 text-xl font-semibold tracking-tight text-fg">How it compares</h2>
      <p className="mt-2 max-w-2xl text-base text-fg-muted">
        Most .3mf→U1 converters swap the profile and map colors to the 4 slots. BedReady does that too — and
        keeps going.
      </p>
      <div className="page-breakout mt-4 overflow-x-auto rounded-lg border border-line">
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
