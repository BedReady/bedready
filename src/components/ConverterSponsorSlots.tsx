"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { activeSponsor, type Sponsor } from "@/lib/sponsor";
import { SponsorBarView, SponsorStripView, type SponsorCopy } from "./SponsorSlot";

/**
 * The sponsor slots, rendered from the sponsor the SERVER read (`src/lib/sponsor-feed.ts`).
 *
 * Until Nov 7 2026 these fetched the sponsor in an effect after hydration, so the top bar arrived
 * after first paint and pushed the page down. The layout now reads it on the server and passes it
 * in, so it is in the HTML and nothing moves.
 *
 * What stays on the client is the window check: the server's copy can be up to a day old (see SPONSOR_REVALIDATE_SECONDS), and
 * a booking may end inside that. On mount each slot re-runs `activeSponsor()` against the visitor's
 * clock and drops an expired sponsor — in an effect, not in render, so hydration still matches.
 */
export default function ConverterSponsorBar({ sponsor }: { sponsor: Sponsor | null }) {
  return <SponsorBarView sponsor={useCurrentSponsor(sponsor)} copy={useSponsorCopy()} />;
}

export function ConverterSponsorStrip({ sponsor }: { sponsor: Sponsor | null }) {
  return <SponsorStripView sponsor={useCurrentSponsor(sponsor)} copy={useSponsorCopy()} />;
}

/** The slot chrome in the page's language. `visit` keeps `{name}` raw: the view fills it in. */
function useSponsorCopy(): SponsorCopy {
  const t = useTranslations("sponsor");
  return { label: t("label"), visit: t.raw("visit") as string };
}

/** The server's sponsor, unless its booking has ended since the page was rendered. */
function useCurrentSponsor(initial: Sponsor | null): Sponsor | null {
  const [sponsor, setSponsor] = useState(initial);
  useEffect(() => {
    setSponsor(activeSponsor(initial ? [initial] : [], new Date()));
  }, [initial]);
  return sponsor;
}
