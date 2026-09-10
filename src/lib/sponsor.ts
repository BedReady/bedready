/**
 * Sponsorship — who is sponsoring right now, and what is safe to render for them.
 *
 * ── WHAT THIS IS ────────────────────────────────────────────────────────────────────────────────
 *
 * One outside company at a time, in a labelled slot at the top and bottom of the page. The same
 * single sponsorship runs on MakerRun (`makerrun.com`) and here, so a visitor crossing between the
 * two sees one company rather than two adverts.
 *
 * ── WHERE THE TRUTH LIVES, WHICH IS NOT HERE ────────────────────────────────────────────────────
 *
 * The booking lives in MakerRun's database, behind `GET /api/v1/sponsor`. This repository is
 * backend-free and ships no credentials — `convert-backend-free.test.mts` fails the moment anything
 * imports a database client — so the converter asks over HTTP through `convertApi()`, the one seam
 * it is allowed to reach a server through. `next.config.mjs` already proxies `/api/:path*` to the
 * library origin, so the bare same-origin path resolves without any new configuration.
 *
 * ── THE INVARIANT ───────────────────────────────────────────────────────────────────────────────
 *
 * A paid slot must always be LABELLED where it renders, and must never be styled to read like
 * MakerRun's verified badge. That badge means a machine opened a file and a person confirmed a
 * photograph; evidence that money can buy is not evidence. These pages also carry an independence
 * claim about the manufacturers they compare — a sponsor may now be one of them — so the promise
 * they make is about what money CANNOT buy, and SPONSORSHIP_NOTE is that promise in one place.
 */

/** The public shape, exactly the columns MakerRun publishes to an anonymous reader. */
export type Sponsor = {
  id: string;
  name: string;
  url: string;
  logo_url?: string | null;
  tagline?: string | null;
  starts_at: string;
  ends_at: string;
};

/** The word that makes this honest. One constant, so two slots cannot be labelled differently. */
export const SPONSOR_LABEL = "Sponsor";

/**
 * `rel` for every sponsor link.
 *
 * `sponsored` is required by Google's link-spam policy for a paid link, and the penalty for omitting
 * it falls on the site that SELLS the link. `noopener noreferrer` because these open a third-party
 * site in a new tab.
 */
export const SPONSOR_LINK_REL = "sponsored noopener noreferrer";

/**
 * The sentence that replaced "not sponsored by".
 *
 * Every page here used to promise it was "not affiliated with, endorsed by, or sponsored by
 * Snapmaker / Bambu / Creality / Prusa", and the printer comparison promised it was "not sponsored
 * by any manufacturer". A manufacturer may now buy the slot, so those became false.
 *
 * Deleting the clause would have been the wrong repair: these pages COMPARE and RANK the products of
 * the companies now eligible to sponsor them, and that independence claim is most of why anyone
 * should believe the comparison. So the promise moved from one about money NOT EXISTING to one about
 * what money CANNOT BUY — the promise actually worth making. "Not affiliated with or endorsed by"
 * survives untouched, because a sponsor is not an endorser and buys no affiliation.
 */
export const SPONSORSHIP_NOTE =
  "Any sponsor is labelled as a sponsor, and sponsorship never affects what is listed, ranked, compared or verified.";

/**
 * Half-open window: `starts_at <= now < ends_at`. Start inclusive, end EXCLUSIVE.
 *
 * Not an arbitrary choice, and not local to this file. MakerRun mirrors this exact boundary in three
 * places — the RLS policy that publishes the live row, `isWindowActive()` in its own source, and an
 * EXCLUDE constraint over `tstzrange(starts_at, ends_at, '[)')` that makes overlapping bookings
 * unrepresentable. Back-to-back bookings are legal precisely because all of them agree; widening
 * this to inclusive here would make a slot appear to run a moment after its successor started.
 */
export function isSponsorWindowActive(w: { starts_at: string; ends_at: string }, now: Date): boolean {
  const start = Date.parse(w.starts_at);
  const end = Date.parse(w.ends_at);
  // Unparseable fails CLOSED: the worst case is a paid banner not showing, which is visible and
  // fixable. Failing open would put an expired sponsor on the page, which nobody notices.
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  const t = now.getTime();
  return t >= start && t < end;
}

/**
 * Is this URL safe to render as a sponsor link?
 *
 * MakerRun's column already refuses anything but https, so this is defence in depth rather than a
 * second opinion — and it matters more here than there, because this side receives the value over
 * HTTP from another origin rather than reading it out of its own database. Refuses by NOT RENDERING
 * rather than throwing: a missing banner is a support ticket, a `javascript:` URL in site chrome is
 * an incident.
 */
export function isSafeSponsorUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * The sponsor to render, or null.
 *
 * Re-checks the window even though the API only ever returns a live booking: that response is
 * cacheable for five minutes and a sponsorship can end inside it.
 */
export function activeSponsor(rows: readonly Sponsor[] | null | undefined, now: Date): Sponsor | null {
  for (const s of rows ?? []) {
    if (!isSponsorWindowActive(s, now)) continue;
    if (!isSafeSponsorUrl(s.url)) continue;
    if (!s.name?.trim()) continue;
    return s;
  }
  return null;
}
