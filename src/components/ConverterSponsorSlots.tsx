"use client";

import { useEffect, useState } from "react";
import { convertApi } from "@/lib/convert-api";
import { activeSponsor, type Sponsor } from "@/lib/sponsor";
import { SponsorBarView, SponsorStripView } from "./SponsorSlot";

/**
 * The sponsor slots, fetched over HTTP.
 *
 * ── WHY NOT SERVER-RENDERED ─────────────────────────────────────────────────────────────────────
 *
 * Because the booking is MakerRun's, and this repository holds no credential to read it with. That
 * is the property `convert-backend-free.test.mts` exists to keep: a public repo shipping a database
 * URL and key means every fork reads and writes the real project's tables, and it makes "nothing is
 * uploaded" harder to say rather than easier.
 *
 * So it goes through `convertApi()` — the one seam the converter may reach a server through — and
 * `next.config.mjs` proxies `/api/:path*` to the library origin, so the bare path needs no new
 * configuration on either side.
 *
 * ── THE COST, STATED PLAINLY ────────────────────────────────────────────────────────────────────
 *
 * The slot arrives after hydration rather than in the HTML. A content blocker can stop the request,
 * and the banner appears a beat late — both worse for a sponsor than MakerRun's server-rendered
 * copy, and both the price of the constraint above. It renders NOTHING while loading and reserves no
 * space, so a page with no sponsor never shows a gap and one with a sponsor grows rather than
 * displacing content already read.
 */
export default function ConverterSponsorBar() {
  return <SponsorBarView sponsor={useLiveSponsor()} />;
}

export function ConverterSponsorStrip() {
  return <SponsorStripView sponsor={useLiveSponsor()} />;
}

/**
 * The live sponsor, or null.
 *
 * Both slots call this and each fetches — two requests per page rather than one. Deliberate: sharing
 * would need a provider in a shell whose entire reason for existing is that it mounts none. The
 * endpoint is cacheable for five minutes, so the second request is served from cache rather than
 * reaching a database twice.
 */
function useLiveSponsor(): Sponsor | null {
  const [sponsor, setSponsor] = useState<Sponsor | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch(convertApi("/api/v1/sponsor"));
        if (!res.ok) return;
        const body = (await res.json()) as { sponsor: Sponsor | null };
        // Re-checked rather than trusted: the response is cacheable and a booking can end inside
        // that window. Same rule, same function, as the side that wrote it.
        if (live) setSponsor(activeSponsor(body.sponsor ? [body.sponsor] : [], new Date()));
      } catch {
        // No sponsor. A converter that cannot reach the API still converts, which is the point.
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  return sponsor;
}
