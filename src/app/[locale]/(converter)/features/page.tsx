import type { Metadata } from "next";
import { use } from "react";
import { useTranslations } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import Link from "@/components/SiteLink";
import { PlateCorners } from "@/components/PlateHeads";
import { alternates } from "@/lib/seo";
import { safariArg } from "@/lib/extension-stores";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "features" });
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: alternates("/features", locale),
  };
}

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

// Literal colours, not theme utilities: the table sits on the plate, dark in both themes, and light
// mode darkens the emerald/amber utilities for white pages (globals.css), which sank them into it.
// `label` is what a screen reader hears for the symbol: the page's own "Yes" / "No" / "Partly".
function Mark({ value, note, label }: { value: Support; note?: string; label: string }) {
  return (
    <span className="inline-flex flex-col items-center gap-0.5">
      <span
        aria-hidden
        className={
          value === true
            ? "text-[#4ade80]"
            : value === "partial"
              ? "text-[#c9a86a]"
              : "text-[#8f8a80]"
        }
      >
        {value === true ? "✓" : value === "partial" ? "◐" : "✗"}
      </span>
      <span className="sr-only">{label}</span>
      {note && <span className="text-xs leading-none text-[#a9a49a]">{note}</span>}
    </span>
  );
}

const MARK: Record<string, "yes" | "no" | "partly"> = { true: "yes", false: "no", partial: "partly" };

// The comparison rows; their wording is in messages under features.compare. It was hard-coded English,
// which under /ar also ran right-to-left and flipped "100%" to the end of its line.
const COMPARE: [string, Support, Support, ("rare" | "sometimes" | "someUpload")?][] = [
  ["profile", true, true],
  ["slots", true, true],
  ["settings", true, "partial", "rare"],
  ["moreColors", true, false],
  ["ownFilaments", true, false],
  ["colorMix", true, false],
  ["retarget", true, false],
  ["stl", true, "partial", "rare"],
  ["colorMatch", true, false],
  ["swapPauses", true, false],
  ["detail", true, "partial", "sometimes"],
  ["browser", true, "partial", "someUpload"],
  ["library", true, false],
];

export default function FeaturesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  setRequestLocale(locale);
  const t = useTranslations("features");


  // The /extension grammar (Figma: Extension page — Desktop · Light): a hero, the four-filament rule,
  // then ruled rows with the subject on the start edge. The seven groups were a two-column card-less
  // grid whose last group had to span to avoid an orphan; as rows, seven is just seven. The comparison
  // table stands on the plate, the site's stage for the thing that does the work — here, the argument.
  return (
    <main className="page-read py-12">
      <div className="measure-full">
        <h1 className="max-w-[40rem] text-3xl font-semibold tracking-tight text-fg sm:text-5xl">{t("title")}</h1>
        <p className="mt-5 max-w-[40rem] text-lg text-fg-muted">{t("intro")}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/convert" className="btn-primary btn-lg">
            {t("ctaConvert")}
          </Link>
          <Link href="/verified" className="btn-secondary btn-lg">
            {t("ctaBrowse")}
            <span aria-hidden className="text-[0.85em] text-fg-subtle">↗</span>
          </Link>
        </div>
      </div>

      <div className="measure-full mt-16">
        <div className="brand-rule" aria-hidden="true" />
        {GROUPS.map((g) => (
          <section key={g.key} className="grid gap-x-12 gap-y-3 border-b border-line py-7 sm:grid-cols-[13rem_minmax(0,1fr)]">
            <h2 className="text-lg font-semibold text-fg" style={{ fontStretch: "112%" }}>{t(`groups.${g.key}.title`)}</h2>
            <ul className="space-y-2 text-base leading-relaxed text-fg-muted lg:columns-2 lg:gap-x-10 [&>li]:break-inside-avoid">
              {g.items.map((k) => (
                <li key={k}>{t(`groups.${g.key}.items.${k}`)}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {/* Honest, capability-based comparison — why BedReady is the most complete U1 converter. */}
      <h2 className="mt-16 text-2xl font-semibold tracking-tight text-fg" style={{ fontStretch: "112%" }}>{t("compare.title")}</h2>
      <p className="mt-2 max-w-2xl text-base text-fg-muted">{t("compare.intro")}</p>
      {/* The plate is dark in both themes, so the table's colours are the plate's own (as on /convert's
          drop zone), not the theme tokens, which would put dark-mode-light text on it in light mode. */}
      <div className="page-breakout plate mt-6 px-3 py-8 sm:px-10 sm:py-10">
        <PlateCorners />
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[30rem] text-start text-sm text-[#d2cec5]">
            <thead>
              <tr className="border-b border-white/15">
                <th className="px-4 py-3 text-start text-xs font-semibold text-[#a9a49a]" style={{ fontStretch: "112%" }}>{t("compare.capability")}</th>
                {/* The column the page is arguing for is the one the eye should land on: T3's yellow,
                    the plate's one bright filament. */}
                <th className="bg-[#ffd200]/10 px-4 py-3 text-center text-xs font-semibold text-[#ffd200]" style={{ fontStretch: "112%" }}>BedReady</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-[#a9a49a]" style={{ fontStretch: "112%" }}>{t("compare.typical")}</th>
              </tr>
            </thead>
            <tbody>
              {COMPARE.map(([key, us, them, note]) => (
                <tr key={key} className="border-b border-white/10 last:border-0">
                  <td className="px-4 py-2.5">{t(`compare.rows.${key}`)}</td>
                  <td className="bg-[#ffd200]/[0.06] px-4 py-2.5 text-center">
                    <Mark value={us} label={t(`compare.marks.${MARK[String(us)]}`)} />
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <Mark value={them} note={note && t(`compare.marks.${note}`)} label={t(`compare.marks.${MARK[String(them)]}`)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="mt-3 text-xs text-fg-subtle">{t("compare.note")}</p>
      <p className="mt-10 text-sm text-fg-muted">{t("note", safariArg)}</p>
    </main>
  );
}
