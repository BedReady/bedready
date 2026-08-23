/**
 * Which origin owns a path.
 *
 * ── THE PROBLEM ──────────────────────────────────────────────────────────────────────────────────
 *
 * `https://bedready.io` was written into 64 places across 30 files, behind SEVEN independent
 * constants — `seo.ts:BASE`, `sitemap.ts:BASE`, `email.ts:SITE`, `sale-link.ts:SITE`,
 * `api/dto.ts:SITE`, `admin/broadcast:SITE` and `hooks/notify:SITE` — of which exactly one read an
 * environment variable. That was survivable while the site was one origin. It stops being
 * survivable the moment the library moves to `makerrun.com`, because then **the correct origin
 * depends on the path**: a design's canonical URL, its OpenGraph image, the unsubscribe link in a
 * notification about it and its tagged `sale_url` must all say `makerrun.com`, while the converter's
 * canonical, its share link and its guides must still say `bedready.io`.
 *
 * Seven constants cannot express that. One function can.
 *
 * ── NOTHING CHANGES UNTIL IT IS CONFIGURED ──────────────────────────────────────────────────────
 *
 * Both origins default to `https://bedready.io`, so today every answer is identical to the literal
 * it replaced. The split is then an environment change on two deployments rather than an edit
 * across thirty files — and, as with `convert-api.ts`, the seam runs in production long before the
 * day it has to be right.
 *
 * ── THE ROUTE LIST IS CHECKED AGAINST THE FILESYSTEM, NOT TRUSTED ───────────────────────────────
 *
 * `CONVERTER_ROUTES` has to be a static array: this module runs in the browser and on the edge,
 * where there is no `readdirSync`. A static list of routes is exactly the thing that goes stale —
 * so `origin-allocation.test.mts` asserts it matches the `(converter)` route group on disk. Add a
 * converter route without listing it here and the test fails, naming it.
 *
 * That is the same arrangement the route groups already gave us: the directory is the truth, and
 * anything that must duplicate it is verified against it rather than maintained by hand.
 */

/**
 * The converter's origin — `bedready.io`, the public open-source repo.
 *
 * `NEXT_PUBLIC_` because canonical tags, share links and JSON-LD are all rendered in components that
 * may run on the client. The value is a public hostname; nothing here is secret.
 */
export const CONVERTER_ORIGIN = process.env.NEXT_PUBLIC_CONVERTER_ORIGIN || "https://bedready.io";

/**
 * The library's origin — MakerRun.
 *
 * The default is `makerrun.com` here, where it was `bedready.io` in the repository this was carved
 * from. There, both origins defaulted to the same string so that every seam stayed inert until the
 * split was configured. **In this repository the split is not a future event, it is the reason the
 * repository exists** — a link to the library is always cross-site, so a default of `bedready.io`
 * would just be wrong, and wrong in the quiet way: every cross-link would point back at the
 * converter's own domain and 404.
 */
export const LIBRARY_ORIGIN = process.env.NEXT_PUBLIC_LIBRARY_ORIGIN || "https://makerrun.com";

/**
 * Top-level path segments the converter owns, from the allocation in
 * `docs/SPLIT-DECISION-2026-08.md`. Kept sorted so a diff against the directory listing reads
 * cleanly.
 *
 * `guides` is here and it surprises people: all three guides are converter guides ("Fix 'not
 * supported, loading geometry data only' in Snapmaker Orca"), so they are converter SEO content.
 */
export const CONVERTER_ROUTES = [
  "bambu-to-snapmaker-u1",
  "calibrate",
  "compare-multicolor-printers",
  "compare-u1-converters",
  "convert",
  "creality-to-snapmaker-u1",
  "extension",
  "features",
  "guides",
  "image",
  "makerworld-to-snapmaker-u1",
  "mixer",
  "orca-filaments",
  "printables-to-snapmaker-u1",
  "prusaslicer-to-snapmaker-u1",
  "stickers",
  "u1-to-bambu",
  "u1-to-creality",
  "u1-to-prusa",
] as const;

/**
 * Every locale segment that can appear in a URL — including `en`.
 *
 * English is unprefixed in the links this site WRITES, which is why `en` was left out. But it is
 * not absent from URLs this site EMITS: Next resolves an `opengraph-image` route with the active
 * locale segment, so every social-preview image on the converter is
 * `/en/guides/<slug>/opengraph-image-…`. Crawlers, bookmarks and hand-typed URLs produce `/en/…`
 * too.
 *
 * With `en` missing, `withoutLocale("/en/convert")` returned it unchanged, no converter route
 * matched, and the path was attributed to the library — so `bedready.io/en/convert` 301'd to
 * `makerrun.com/en/convert`, and every og:image on this site redirected to the sister domain. It
 * still rendered an image, which is why nobody noticed: the other site serves the same route.
 *
 * The comment this replaces already described the failure — "every non-English converter URL would
 * be attributed to the library" — and then omitted the one locale that makes it true for English.
 */
const LOCALES = ["en", "de", "es", "fr", "zh", "ja", "ar"];

/**
 * Strip a leading locale segment so `/de/convert` and `/convert` resolve to the same owner.
 *
 * Without this every non-English converter URL would be attributed to the library, which is the
 * kind of bug that shows up as six locales' canonical tags pointing at the wrong domain — and only
 * after the split, when there is a wrong domain to point at.
 */
function withoutLocale(path: string): string {
  const m = path.match(/^\/([a-z]{2})(?=\/|$)/);
  return m && LOCALES.includes(m[1]!) ? path.slice(m[0].length) || "/" : path;
}

/**
 * The origin that owns `path`.
 *
 * Everything not owned by the converter belongs to the library — including `/`, which moves to
 * MakerRun. A default of "library" rather than "converter" is deliberate: the converter's routes are
 * a closed, enumerated set that a test pins to the filesystem, while the library's grow. A new
 * library route added by someone who never reads this file gets the right origin by default; a new
 * converter route fails a test until it is listed.
 */
export function originFor(path: string): string {
  return ownerOrigin(path, CONVERTER_ORIGIN, LIBRARY_ORIGIN);
}

/** `originFor`, with the two origins passed in rather than read from the environment. */
/**
 * The paths the LIBRARY owns, mirrored from its repo.
 *
 * ── WHY THIS SITE NEEDS THE OTHER SITE'S LIST ───────────────────────────────────────────────────
 * `ownerOrigin` answers "converter route? then ours, else theirs", which is right for every path
 * that exists and wrong for every path that does not. A typo on this domain was not a 404 here — it
 * was a 301 to makerrun.com, where the visitor met a different brand's 404:
 *
 *     bedready.io/no-such-page  ->  301  ->  makerrun.com/no-such-page  (404)
 *
 * The library repo already fixed the mirror of this and recorded why: "serving it here means a 404
 * on the domain the visitor typed, with that site's own header, footer and 404 page — rather than a
 * 301 onto the other brand". Only its half shipped; this is the other one.
 *
 * Kept in sync by hand, and cheap to be wrong about in one direction only: a library path missing
 * from this list 404s here instead of redirecting, which is visible. A path listed here that the
 * library does not serve redirects to their 404, which is what happens today for everything.
 */
export const LIBRARY_ROUTES = [
  "account", "admin", "age", "app", "app-link", "changelog", "collections", "designs", "feedback",
  "following", "help", "licenses", "login", "makers", "notifications", "privacy", "saves", "terms",
  "upload", "verified",
] as const;

/** A storefront is `/@handle` — a rewrite, not a directory, so it can never be enumerated. */
const isStorefront = (segment: string) => segment.startsWith("@");

/**
 * Segments belonging to neither group, served by whichever host is asked. `/docs` has its own host,
 * `/api` and `/auth` are not pages, and `""` is the site root, which each host answers for itself.
 */
const UNALLOCATED_BUT_REAL = ["", "docs", "api", "auth"];

function ownerOrigin(path: string, converterOrigin: string, libraryOrigin: string): string {
  const segment = withoutLocale(path).split("/")[1] ?? "";
  return (CONVERTER_ROUTES as readonly string[]).includes(segment) ? converterOrigin : libraryOrigin;
}

/**
 * Absolute URL for a path, on whichever origin owns it.
 *
 * Pass a path with a leading slash, or "" for a site root. Trailing slashes are stripped so callers
 * can pass "/" or "/foo/" harmlessly: a trailing slash makes locale alternates `/de/`, which
 * 308-redirect, and canonical/hreflang must point at the final 200 URL.
 */
export function absoluteUrl(path: string): string {
  const p = path === "/" ? "" : path.replace(/\/+$/, "");
  return `${originFor(p || "/")}${p}`;
}

/**
 * Nothing is served on both hosts from here — which is why there is no `SHARED_ROUTES` list.
 *
 * MakerRun carries one: `privacy`, `terms`, `licenses` and `age` are exempt from the 301 there,
 * because while one deployment served both sites those four pages genuinely existed on both, and
 * redirecting a page a host already serves is a pointless hop.
 *
 * This repository has none of them. Copying the exemption across produced the worst of both
 * outcomes — the rule declined to redirect them, and there was no page to serve, so all four 404\'d
 * on a host where they return 200 today. A converter with no privacy policy is not a thing that can
 * ship, and a 404 is a worse answer than MakerRun\'s copy.
 *
 * So they redirect, like every other library path. **If this repository ever grows its own legal
 * pages, they must be exempted here on the day they land** — otherwise the 301 will shadow them and
 * the new pages will be unreachable.
 */

/**
 * Where a request for `pathname` on `host` should be 301'd, or `null` to serve it here.
 *
 * ── WHY THIS CAME BACK, HAVING ONCE BEEN DELIBERATELY LEFT OUT ──────────────────────────────────
 *
 * This file used to carry a note saying the rule belonged to MakerRun, because "this deployment only
 * ever answers for converter routes — a library path reaches a 404, not a redirect. The host that
 * serves both is the library\'s, so the rule lives there."
 *
 * Every clause of that was true, and it stopped being true at the cutover. `bedready.io` is served
 * by THIS deployment now, and it is no longer a host that serves both. Nothing else is left to
 * forward a library path, so the 404 that used to be a shrug is now the terminus for every link
 * ever published to `bedready.io/designs` — and the library lived at that host until the day of the
 * split, so those links are the entire pre-split web.
 *
 * A 301 rather than a 404 is also what moves the ranking signal to MakerRun instead of discarding
 * it. That is the whole reason the private repository shipped this rule months before it could fire.
 *
 * ── IT ONLY ACTS ON THE TWO HOSTS IT KNOWS ──────────────────────────────────────────────────────
 *
 * A host matching neither origin is served as-is: `localhost` has no match, and every Vercel preview
 * deployment has a generated hostname. Redirecting an unrecognised host would send `npm start` and
 * every preview to production the moment they were asked for a library path — the kind of failure
 * that only appears on the one branch nobody tests on.
 *
 * Note what this means here, and it is worth stating because it is a real gap: on this repository
 * the rule cannot be exercised end-to-end by visiting the deployment\'s own `.vercel.app` URL, since
 * that host is neither origin. `redirectTargetFor` is a pure function precisely so the behaviour can
 * be proven without one.
 */
export function crossOriginRedirect(host: string | null | undefined, pathname: string): string | null {
  return redirectTargetFor(host, pathname, CONVERTER_ORIGIN, LIBRARY_ORIGIN);
}

/**
 * `crossOriginRedirect` with the origins passed in — the whole rule, as a pure function.
 *
 * Exported for tests. The module reads its origins from the environment at import time, so a test
 * using the module constants can only ever exercise whatever configuration the test runner happens
 * to have. Passing them in makes every configuration an ordinary call, on any Node version.
 *
 * ── THE EQUALITY CHECK IS NOT DEAD CODE HERE, THOUGH IT LOOKS IT ────────────────────────────────
 *
 * In this repository the two origins differ by default (`bedready.io` and `makerrun.com`), so unlike
 * MakerRun — where they default to the same string and this rule stays inert until the day of the
 * cutover — the first line never fires in production. It is kept because the rule is a statement
 * about two origins rather than about this deployment: hand it one origin twice and the honest
 * answer is "nothing to redirect", not a 301 from a host to itself. That self-redirect is a total
 * outage, and it is the first case the tests pin.
 *
 * Both directions are implemented, though only one can fire here: `makerrun.com` does not route to
 * this deployment, so the library-host branch is unreachable in production. It stays because the
 * rule the two repositories share is the same rule, and a half-copy is the thing that drifts.
 */
export function redirectTargetFor(
  host: string | null | undefined,
  pathname: string,
  converterOrigin: string,
  libraryOrigin: string,
): string | null {
  if (converterOrigin === libraryOrigin) return null; // single origin: nothing to redirect
  if (!host) return null;

  // Neither site owns it, so neither site should be handed it: answer here, with this domain's own
  // 404, instead of sending someone who mistyped our URL to the other brand. See LIBRARY_ROUTES.
  const segment = withoutLocale(pathname).split("/")[1] ?? "";
  const known =
    (CONVERTER_ROUTES as readonly string[]).includes(segment) ||
    (LIBRARY_ROUTES as readonly string[]).includes(segment) ||
    UNALLOCATED_BUT_REAL.includes(segment) ||
    isStorefront(segment);
  if (!known) return null;

  // Compare bare hostnames: the request header carries no scheme, and may carry a port.
  const bare = host.split(":")[0]!.toLowerCase();
  const converterHost = new URL(converterOrigin).hostname.toLowerCase();
  const libraryHost = new URL(libraryOrigin).hostname.toLowerCase();

  const owner = ownerOrigin(pathname, converterOrigin, libraryOrigin);
  if (bare === libraryHost && owner === converterOrigin) return converterOrigin;
  if (bare === converterHost && owner === libraryOrigin) return libraryOrigin;
  return null;
}
