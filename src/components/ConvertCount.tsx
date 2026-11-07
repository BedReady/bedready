"use client";

import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { convertApi } from "@/lib/convert-api";

// Live "N files converted" social proof. Renders nothing until the number is meaningful — weak
// social proof ("3 files converted") reads worse than none.
//
// ── READ THROUGH THE API, NOT THE TABLE — CHANGED 2026-08-21 ─────────────────────────────────────
//
// This used to `select("count").from("counters")` with the browser Supabase client. `counters` is
// public and the read needed no login, so it was never a registration gate — but it was the last
// Supabase client on the converter surface, and the converter is becoming a public open-source repo
// that ships no credentials. `GET /api/convert-count` returns the same number without them.
//
// The route is CDN-cached for a minute, so this costs a database read per minute site-wide rather
// than one per visitor.
const MIN_TO_SHOW = 25;

export default function ConvertCount({ className }: { className?: string }) {
  const t = useTranslations("convert");
  const format = useFormatter();
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(convertApi("/api/convert-count"))
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (data: { count?: number | null } | null) => {
          if (alive && data?.count != null) setCount(Number(data.count));
        },
        () => {},
      );
    return () => {
      alive = false;
    };
  }, []);

  // The line is RESERVED, not inserted. Returning null here put the counter in after hydration,
  // above the headline, and pushed the headline, the drop zone and everything under it down 36px —
  // the converter's whole layout shift (Lighthouse, Nov 7: 0.034 of the home page's 0.07). A blank
  // line costs nothing when the number never comes; a page that jumps under the cursor costs a
  // misplaced click on the drop zone.
  if (count == null || count < MIN_TO_SHOW) {
    return (
      <p className={className} aria-hidden="true">
        {" "}
      </p>
    );
  }
  return (
    <p className={className}>
      <span className="font-semibold text-fg-muted">{format.number(count)}</span> {t("convertedCount")}
    </p>
  );
}
