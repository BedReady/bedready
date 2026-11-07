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
 * Cached for five minutes, the endpoint's own cache lifetime, so the converter pages revalidate on
 * that interval rather than becoming dynamic. A booking can end inside that window; the client
 * slot re-checks the window on mount and drops an expired sponsor, by the same `activeSponsor()`.
 *
 * Any failure (timeout, HTTP error, bad JSON, the API down at build time) is "no sponsor". The
 * converter must build and render without the library, which is the whole point of the split.
 */
export const SPONSOR_REVALIDATE_SECONDS = 300;
const TIMEOUT_MS = 2500;

export function sponsorFeedUrl(): string {
  return new URL(convertApi("/api/v1/sponsor"), LIBRARY_ORIGIN.replace(/\/+$/, "") + "/").toString();
}

export async function fetchSponsor(now: Date = new Date()): Promise<Sponsor | null> {
  try {
    const res = await fetch(sponsorFeedUrl(), {
      next: { revalidate: SPONSOR_REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    } as RequestInit);
    if (!res.ok) return null;
    const body = (await res.json()) as { sponsor?: Sponsor | null };
    return activeSponsor(body?.sponsor ? [body.sponsor] : [], now);
  } catch {
    return null;
  }
}
