import { SPONSOR_LABEL, SPONSOR_LINK_REL, type Sponsor } from "@/lib/sponsor";

/**
 * The sponsorship slots' markup — top and bottom, one company.
 *
 * Presentation only, and deliberately so: this file holds no data access, so nothing about a
 * sponsor can drag a client or a credential into a repository whose whole claim is that it has
 * none. `ConverterSponsorSlots.tsx` fetches the row and hands it here.
 *
 * The chrome follows `SiteFooter`: a full-width bordered element wrapping a `.page-read` container,
 * so the slot lines up with the measure every page is set to rather than inventing a width.
 *
 * NOTHING HERE MAY LOOK LIKE THE VERIFIED BADGE — no ✓, no emerald, no "verified"-adjacent word.
 * These pages compare printers and say they are independent; a paid banner borrowing the vocabulary
 * of MakerRun's evidence would undo both claims at once. `sponsorship-guard.test.mts` asserts it.
 */

/** The label. One component, so the two slots cannot end up saying different things. */
function Label() {
  return (
    <span className="shrink-0 rounded-full bg-surface-3 px-2 py-0.5 text-xs font-medium uppercase tracking-wider text-fg-muted">
      {SPONSOR_LABEL}
    </span>
  );
}

/**
 * A plain `<img>`, not `next/image`.
 *
 * This repo configures no `images.remotePatterns` at all — it is backend-free and hosts nothing — so
 * an optimised remote image would throw at render. The CSP already allows `https:` for `img-src`,
 * and the alternative is registering a storage host in the config of a repository that deliberately
 * knows about no storage. It is a 40px logo.
 */
function Logo({ sponsor, size }: { sponsor: Sponsor; size: number }) {
  if (!sponsor.logo_url) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={sponsor.logo_url}
      alt=""
      className="h-auto w-auto shrink-0 rounded"
      style={{ maxHeight: size, maxWidth: size * 3 }}
    />
  );
}

/**
 * TOP — a slim line under the header. Text-led on purpose: it sits directly above a headline about
 * what the converter does, and a logo-first banner there reads as an advert competing with it.
 */
export function SponsorBarView({ sponsor }: { sponsor: Sponsor | null }) {
  if (!sponsor) return null;
  return (
    <aside aria-label={SPONSOR_LABEL} className="border-b border-line bg-surface-2">
      <div className="page-read flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-xs">
        <Label />
        <a href={sponsor.url} target="_blank" rel={SPONSOR_LINK_REL} className="min-w-0 text-fg-muted hover:text-fg">
          <span className="font-medium text-fg">{sponsor.name}</span>
          {sponsor.tagline ? <span className="hidden sm:inline"> — {sponsor.tagline}</span> : null}
        </a>
      </div>
    </aside>
  );
}

/** BOTTOM — the fuller one, above the footer, where a logo belongs. Same company by construction. */
export function SponsorStripView({ sponsor }: { sponsor: Sponsor | null }) {
  if (!sponsor) return null;
  return (
    <aside aria-label={SPONSOR_LABEL} className="border-t border-line bg-surface-2">
      <div className="page-read flex flex-wrap items-center gap-x-4 gap-y-2 py-4">
        <Label />
        <Logo sponsor={sponsor} size={40} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-fg">{sponsor.name}</p>
          {sponsor.tagline ? <p className="mt-0.5 text-xs text-fg-muted">{sponsor.tagline}</p> : null}
        </div>
        <a href={sponsor.url} target="_blank" rel={SPONSOR_LINK_REL} className="btn-secondary btn-sm shrink-0">
          Visit {sponsor.name}
        </a>
      </div>
    </aside>
  );
}
