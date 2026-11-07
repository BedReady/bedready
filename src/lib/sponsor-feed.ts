import { convertApi } from "./convert-api";
import { LIBRARY_ORIGIN } from "./origin";
import { activeSponsor, type Sponsor } from "./sponsor";

/**
 * The live sponsor, read ON THE SERVER, for the converter layout to render into the HTML.
 *
 * ── WHY THE SERVER NOW ───────────────────────────────────────────────────────────────────────────
 *
 * Until Nov 7 2026 the slots fetched this from the browser after hydration. While nobody sponsored,
 * that cost nothing. Once MakerRun began filling the slot with a house sponsor (Khayt) it cost
 * every page a layout shift: the top bar arrived after first paint and pushed the headline and drop
 * zone down (0.037 CLS on / and /convert). Rendered here, the bar is in the first paint and nothing
 * moves. As a side effect the visitor's browser no longer contacts the API for it at all.
 *
 * Still no credential: it is the same anonymous, public endpoint, reached through `convertApi()`
 * like every other call this repository makes. When that returns a bare path (same-origin, where
 * `next.config.mjs` rewrites `/api/*` to the library), the server has no page origin to resolve it
 * against, so it goes to the rewrite's own destination, `LIBRARY_ORIGIN`.
 *
 * ── FRESHNESS AND FAILURE ────────────────────────────────────────────────────────────────────────
 *
 * Cached for a DAY, tagged `sponsor`. This read sits in the converter layout, and a page's
 * revalidate is the shortest of every cached fetch it renders. At five minutes (#98) it pulled every
 * converter page down to five minutes, the ~450 filament pages and the guides included, which export
 * a day of their own: production served `x-nextjs-stale-time: 300` on all of them, and each one
 * re-rendered and re-wrote its ISR entry every five minutes for a sponsor that changes when a
 * booking does, a few times a month. sponsor-feed-cache.test.mts keeps this from dropping below the
 * longest page revalidate again.
 *
 * What a day costs, and what covers it:
 *   · A NEW booking can take up to a day to appear. Invalidating the `sponsor` tag on the bedready
 *     Vercel project (dashboard, REST API, or the Vercel MCP's invalidate_by_tags) shows it on the
 *     next request to each page.
 *   · An ENDED booking may stay in a cached page past its end. The client slot re-checks the window
 *     on mount and drops it, by the same `activeSponsor()`, so an expired sponsor is never shown.
 *   · A failed refresh keeps the previous answer: the fetch cache serves its stale entry while it
 *     revalidates in the background, so a MakerRun blip does not blank the slot for a day.
 *
 * Any failure with nothing cached (timeout, HTTP error, bad JSON, the API down at build time) is
 * "no sponsor". The converter must build and render without the library, which is the whole point
 * of the split.
 */
export const SPONSOR_REVALIDATE_SECONDS = 86400;
/** The cache tag on the sponsor read; invalidate it to publish a booking change at once. */
export const SPONSOR_CACHE_TAG = "sponsor";
const TIMEOUT_MS = 2500;

export function sponsorFeedUrl(): string {
  return new URL(convertApi("/api/v1/sponsor"), LIBRARY_ORIGIN.replace(/\/+$/, "") + "/").toString();
}

export async function fetchSponsor(now: Date = new Date()): Promise<Sponsor | null> {
  try {
    const res = await fetch(sponsorFeedUrl(), {
      next: { revalidate: SPONSOR_REVALIDATE_SECONDS, tags: [SPONSOR_CACHE_TAG] },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    } as RequestInit);
    if (!res.ok) return null;
    const body = (await res.json()) as { sponsor?: Sponsor | null };
    return activeSponsor(body?.sponsor ? [body.sponsor] : [], now);
  } catch {
    return null;
  }
}
