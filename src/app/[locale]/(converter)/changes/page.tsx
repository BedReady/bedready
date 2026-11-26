import type { Metadata } from "next";
import { use } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { alternates } from "@/lib/seo";
import { WHATS_NEW, whatsNewByDay, type WhatsNewArea } from "@/lib/whats-new";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "changes" });
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: alternates("/changes", locale),
  };
}

// Each area wears its toolhead's filament, the site's only colour (Figma: What's new, "Change / Area
// tag"): T1 cyan the converter, T2 magenta the image tools, T3 yellow the extension.
const AREA_SLOT: Record<WhatsNewArea, string> = { converter: "var(--slot-1)", image: "var(--slot-2)", extension: "var(--slot-3)" };

/**
 * An entry's date is a CALENDAR date ("2026-11-26"), not an instant. `new Date("2026-11-26")` is
 * midnight UTC, which a formatter in the visitor's zone shows as the 25th anywhere west of UTC. So
 * it is built as UTC and formatted in UTC: a deliberate zone, the one the date was written in, and
 * the same day for every reader. (Temporal.PlainDate is the native type for this; it is not in Node
 * 20, which CI and the build run on.)
 */
function calendarDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export default function ChangesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  setRequestLocale(locale);
  const t = useTranslations("changes");
  const format = useFormatter();
  const days = whatsNewByDay(WHATS_NEW);

  // The /features grammar (Figma: What's new — Desktop · Light, 25:29; Mobile, 26:46): a hero, the
  // brand rule, then ruled rows with the date on the start edge and that day's changes beside it.
  return (
    <main className="page-read py-12">
      <div className="measure-full">
        <h1 className="max-w-[40rem] text-3xl font-semibold tracking-tight text-fg sm:text-5xl">{t("title")}</h1>
        <p className="mt-5 max-w-[40rem] text-lg text-fg-muted">{t("intro")}</p>
      </div>

      <div className="measure-full mt-12">
        <div className="brand-rule" aria-hidden="true" />
        {days.map((day) => (
          <section
            key={day.date}
            aria-labelledby={`d-${day.date}`}
            className="grid gap-x-12 gap-y-3 border-b border-line py-7 sm:grid-cols-[13rem_minmax(0,1fr)]"
          >
            <h2 id={`d-${day.date}`} className="text-lg font-semibold text-fg" style={{ fontStretch: "112%" }}>
              <time dateTime={day.date}>
                {format.dateTime(calendarDate(day.date), { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}
              </time>
            </h2>
            <ul className="space-y-4">
              {day.entries.map((e, i) => (
                <li key={i} className="space-y-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-line py-0.5 ps-2 pe-2.5 text-xs font-semibold text-fg-muted" style={{ fontStretch: "112%" }}>
                    <span aria-hidden className="size-2 rounded-full" style={{ background: AREA_SLOT[e.area] }} />
                    {t(`areas.${e.area}`)}
                  </span>
                  {/* The entries are English on every locale (see whats-new.ts): say so, and keep
                      their direction left-to-right inside an Arabic page. */}
                  <p lang="en" dir="ltr" className="text-base leading-relaxed text-fg-muted">
                    {e.text}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <p className="mt-8 text-sm text-fg-subtle">{t("note")}</p>
    </main>
  );
}
