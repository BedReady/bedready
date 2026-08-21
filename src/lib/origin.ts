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

/** Non-default locales, which may prefix any path. `en` is unprefixed. */
const LOCALES = ["de", "es", "fr", "zh", "ja", "ar"];

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

/*
 * ── THE CROSS-ORIGIN REDIRECTS ARE NOT HERE ─────────────────────────────────────────────────────
 *
 * `SHARED_ROUTES`, `crossOriginRedirect` and `redirectTargetFor` stayed with MakerRun. They decide
 * where a path arriving on the WRONG host should go, and this deployment only ever answers for
 * converter routes — a library path reaches a 404, not a redirect. The host that serves both is the
 * library's, so the rule lives there.
 *
 * What remains is the half this repository actually needs: which origin owns a path, so canonical
 * tags, hreflang alternates and share links name the right site.
 */
