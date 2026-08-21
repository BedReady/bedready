import type { MetadataRoute } from "next";
import { CONVERTER_ORIGIN } from "@/lib/origin";

/**
 * ── THIS FILE NAMED THE WRONG SITE, AND SAID SO TO EVERY CRAWLER ────────────────────────────────
 *
 * Carved from the library's copy, it kept `LIBRARY_ORIGIN` for both `sitemap` and `host` — correct
 * there, and the exact inversion of the truth here. Live on `bedready.io` it announced MakerRun as
 * this site's preferred host and pointed crawlers at MakerRun's sitemap, while this site's own 473
 * URLs went unannounced. Google largely disregards a sitemap reference to another host, so the
 * effect was not a redirect but a deletion: the converter's entire URL set lost its declared entry
 * point on the day the domain moved, which is the day re-crawling actually happens.
 *
 * `sitemap.ts` next door has always used `CONVERTER_ORIGIN`. That the two files disagreed about
 * which site they belong to is the whole bug, and it is why `robots-origin.test.mts` asserts they
 * agree rather than asserting either one in isolation — pinning a literal here would have passed
 * just as happily while the two pointed at different hosts.
 *
 * ── AND THE DISALLOW LIST BLOCKED THE REDIRECTS IT SHOULD HAVE FED ──────────────────────────────
 *
 * It listed `/login`, `/admin`, `/upload`, `/account`, `/saves`, `/following` and `/notifications`
 * — every one a library path, none of which exists in this repository. They are not merely dead
 * entries: those paths now 301 to MakerRun, and disallowing a URL stops Googlebot fetching it, so
 * it never sees the 301 and never passes the signal on. A rule written to keep personal pages out
 * of one index was, after the split, quietly withholding ranking signal from the other site.
 *
 * What replaces it is `/api/`, which is the one thing here that genuinely should not be indexed:
 * `bedready.io/api/*` is a rewrite of MakerRun's API kept alive for existing clients, so every
 * response under it is duplicate content served from a second host. Nothing else is excluded,
 * because on a converter with no accounts there is nothing else to exclude.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // The compatibility alias, not canonical content. Not locale-prefixed: the middleware returns
      // route handlers before next-intl can rewrite them, so there is no `/de/api/…` to cover.
      disallow: ["/api/"],
    },
    sitemap: `${CONVERTER_ORIGIN}/sitemap.xml`,
    host: CONVERTER_ORIGIN,
  };
}
