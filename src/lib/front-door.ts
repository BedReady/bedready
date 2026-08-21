/**
 * `/` is the converter.
 *
 * ── WHY THIS IS NOT THE RULE THE COMBINED REPOSITORY USES ───────────────────────────────────────
 *
 * MakerRun carries `converterHomePathFor`, which answers the same question but has to ask two more
 * first: are the two origins actually different yet, and is this request even on the converter's
 * host? It needs both because one deployment serves both sites there — `/` is the library's
 * homepage on `makerrun.com`, and was the whole site's homepage before the split.
 *
 * Neither guard survives the carve, and copying them across would be worse than useless:
 *
 *   · The origin comparison would be **false** here (`bedready.io` vs `makerrun.com`), so the rule
 *     would return null and `/` would 404 — which is exactly the state this fixes.
 *   · The host check would be **false in development**, because `localhost` is not `bedready.io`.
 *     `npm run dev` and every preview deployment would 404 on their own front page while production
 *     worked, which is the worst possible place for a difference to live.
 *
 * So this repository's version is unconditional, and that is not a simplification — it is the
 * accurate statement. There is no other site here. `/` has exactly one meaning.
 *
 * ── STILL A REDIRECT, NOT A PAGE AT `/` ─────────────────────────────────────────────────────────
 *
 * `/convert` keeps the canonical URL, and it keeps it for the reason recorded in MakerRun's
 * middleware: `/convert` carries this project's entire organic search position — 128 of 290
 * visitors in the 2026-08-14 → 21 window. Serving the converter at `/` instead is a real SEO
 * migration with its own redirects to write and its own risk to accept. It is the right end state
 * for a converter-only site and it is a separate decision, deliberately not taken here.
 */

/** Non-default locales. `en` is unprefixed. Mirrors `i18n/routing.ts`. */
const LOCALES = ["de", "es", "fr", "zh", "ja", "ar"];

/**
 * The path a front-door request should be sent to, or `null` to serve it normally.
 *
 * A bare locale root is a front door too: `/de` is where the language switcher lands, so leaving it
 * out fixes English and leaves six locales broken — a fix that looks finished and is not.
 */
export function frontDoorPath(pathname: string): string | null {
  if (pathname === "/") return "/convert";
  const m = pathname.match(/^\/([a-z]{2})\/?$/);
  if (m && LOCALES.includes(m[1]!)) return `/${m[1]}/convert`;
  return null;
}
