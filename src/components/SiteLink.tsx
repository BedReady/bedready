import type { ComponentProps, ReactNode } from "react";
import { useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import { CONVERTER_ORIGIN, originFor } from "@/lib/origin";

/**
 * A link that knows which of the two sites owns the path it points at.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────
 * After the split, half the paths in this site's own header and footer — /verified, /designs, /app,
 * /help, /privacy, /terms, /licenses — belong to makerrun.com and reach it through a 301. They were
 * still written as `next/link`, and next/link prefetches. So every page load fired a prefetch at a
 * path that redirects off-origin, and the browser refused the follow-up:
 *
 *     Connecting to 'https://makerrun.com/verified' violates the following Content Security Policy
 *     directive: "connect-src 'self' …". The action has been blocked.
 *     Failed to fetch RSC payload for https://bedready.io/verified. Falling back to browser navigation.
 *
 * Two console errors per cross-site link, on every page, plus a wasted request each. Nothing was
 * visibly broken — the fallback works — which is exactly why it sat there.
 *
 * A cross-site link is an ordinary <a>: no prefetch to refuse, and no redirect hop to pay on click.
 *
 * ── THE PART THAT IS EASY TO GET WRONG ──────────────────────────────────────────────────────────
 * The 301 preserves the locale prefix — /de/privacy lands on makerrun.com/de/privacy. An absolute
 * URL built from the bare path would drop it and send a German reader to the English page, which is
 * a worse bug than the one being fixed. So the locale is re-applied here, matching next-intl's
 * "as-needed" prefixing: English is unprefixed, every other locale is /<locale><path>.
 */
export default function SiteLink({
  href,
  children,
  ...rest
}: { href: string; children: ReactNode } & Omit<ComponentProps<"a">, "href">) {
  const locale = useLocale();
  // Decide ownership on the BARE path — originFor knows the route table, not the locale prefixes.
  if (href.startsWith("/") && originFor(href) !== CONVERTER_ORIGIN) {
    const path = locale === "en" ? href : `/${locale}${href}`;
    return (
      <a href={`${originFor(href)}${path}`} {...rest}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} {...rest}>
      {children}
    </Link>
  );
}
