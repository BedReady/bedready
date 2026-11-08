"use client";

import type { ReactNode } from "react";
import { useLocale } from "next-intl";
import { usePathname } from "@/i18n/navigation";
import { CONVERTER_ORIGIN, originFor } from "@/lib/origin";

/**
 * The footer's "Feedback" link, carrying the page the visitor was on.
 *
 * The form lives on makerrun.com/feedback and serves both sites. Since makerrun#454 it records
 * `?from=` (else document.referrer) to tell bedready.io feedback from makerrun.com feedback, and
 * keeps only our own hosts, origin + path (makerrun src/lib/feedback-source.ts). A referrer is
 * usually trimmed to the origin cross-site, so without `from` every row would say "bedready.io"
 * and nothing more.
 *
 * `from` is a FULL URL, not a bare path: makerrun resolves a bare path against the referrer and
 * falls back to makerrun.com when there is none (a noreferrer browser), which would file BedReady
 * feedback as MakerRun's. The path is the browser path, locale prefix included, never a query
 * string — makerrun drops queries anyway, and a query can carry anything.
 *
 * A client component only because a static footer cannot know its page. next-intl's usePathname,
 * not next/navigation's: English is prerendered at /en/… and served at /… (as-needed prefixing), so
 * the raw pathname differs between the static render and the browser, and React keeps the server's
 * attribute on a mismatch. The locale-free path is the same on both, and the prefix is re-applied
 * by the same rule SiteLink uses.
 */
export default function FeedbackLink({ className, children }: { className?: string; children: ReactNode }) {
  const locale = useLocale();
  const pathname = usePathname() || "/";
  const target = originFor("/feedback");
  const prefix = locale === "en" ? "" : `/${locale}`;
  const from = encodeURIComponent(`${CONVERTER_ORIGIN}${prefix}${pathname === "/" && prefix ? "" : pathname}`);
  return (
    <a href={`${target}${prefix}/feedback?from=${from}`} className={className}>
      {children}
    </a>
  );
}
