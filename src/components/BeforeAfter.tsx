import { useTranslations } from "next-intl";

/**
 * What the converter does, shown rather than described.
 *
 * ── WHY IT EXISTS ───────────────────────────────────────────────────────────────────────────────
 *
 * The converter's entire pitch is "colors preserved", and there was not one pixel of colour above
 * the fold on the page that makes the claim — six paragraphs of prose instead. Meanwhile /stickers,
 * a giveaway page, was the best-looking thing on the site. The capability was in the building; it
 * was just never spent where the argument is made.
 *
 * ── AND WHY IT IS A DIAGRAM, NOT A SCREENSHOT ───────────────────────────────────────────────────
 *
 * A screenshot of a slicer would be a picture of somebody else's software, would need re-taking every
 * time Orca's chrome changes, and would ship as a raster asset in a repository that has none. This
 * is drawn, so it is a few hundred bytes, it is sharp at any size, it re-themes for free, and it is
 * honestly a schematic rather than a photograph of a result.
 *
 * The four fills are the U1's four slots, which is the claim: not "we make it pretty", but "the paint
 * survives, mapped onto four physical filaments". The greyed panel is what the same file looks like
 * opened without the conversion — the failure the whole site is about.
 */

/** The U1's four heads, in the order the swatch row shows them. */
const SLOTS = ["#7c3aed", "#06b6d4", "#84cc16", "#f59e0b"];

function Plate({ painted }: { painted: boolean }) {
  // The unpainted plate has to READ as grey geometry, not as an empty panel. `--surface-3` alone is
  // slate-200 on a slate-100 card in light mode — technically a shape, visually nothing.
  const fill = (i: number) => (painted ? SLOTS[i] : i === 0 ? "var(--surface-3)" : "var(--fg-subtle)");
  const dim = painted ? 1 : 0.34;
  return (
    <svg viewBox="0 0 120 96" className="h-auto w-full" role="presentation">
      {/* the plate */}
      <rect x="8" y="14" width="104" height="68" rx="8" fill={fill(0)} />
      {/* a raised band */}
      <rect x="20" y="26" width="80" height="12" rx="4" fill={fill(1)} opacity={dim} />
      {/* a star, the kind of fine painted detail that collapses to geometry */}
      <path
        d="M60 46.5 63.9 55.3 73.5 56.3 66.3 62.7 68.3 72.1 60 67.3 51.7 72.1 53.7 62.7 46.5 56.3 56.1 55.3Z"
        fill={fill(2)}
        opacity={dim}
      />
      {/* two small marks */}
      <circle cx="27" cy="63" r="4.5" fill={fill(3)} opacity={dim} />
      <circle cx="93" cy="63" r="4.5" fill={fill(3)} opacity={dim} />
      {!painted && (
        <rect x="8" y="14" width="104" height="68" rx="8" fill="none" stroke="var(--fg-subtle)" strokeWidth="1.25" strokeDasharray="4 4" opacity="0.5" />
      )}
    </svg>
  );
}

export default function BeforeAfter() {
  const t = useTranslations("convert");
  // Deliberately compact. The point of moving the drop zone up was to get it above the fold —
  // measured at 660px against a 720px first screen once this figure was added, from 748px before.
  // A diagram that pushes the tool back under the fold has argued itself out of a job.
  return (
    <figure className="mt-5 rounded-lg border border-line bg-surface-2 px-4 py-3">
      <div className="mx-auto grid max-w-sm grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div>
          <Plate painted={false} />
          <figcaption className="mt-1.5 text-balance text-center text-xs leading-snug text-fg-subtle">
            {t("beforeCaption")}
          </figcaption>
        </div>
        <span aria-hidden className="text-lg text-fg-subtle rtl:-scale-x-100">→</span>
        <div>
          <Plate painted />
          <figcaption className="mt-1.5 text-balance text-center text-xs leading-snug text-fg-muted">
            {t("afterCaption")}
          </figcaption>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-center gap-2 border-t border-line pt-2.5">
        <span className="eyebrow">{t("slotsLabel")}</span>
        {SLOTS.map((c, i) => (
          <span
            key={c}
            className="h-3.5 w-7 rounded border border-line"
            style={{ background: c }}
            aria-label={`${i + 1}`}
          />
        ))}
      </div>
    </figure>
  );
}
