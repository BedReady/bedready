/**
 * The converter's ONLY seam to a backend.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────────
 *
 * The converter is being split into its own **public, open-source** repo on `bedready.io`, while the
 * library becomes MakerRun on `makerrun.com` and keeps this Supabase project
 * (`docs/SPLIT-DECISION-2026-08.md`). Two constraints fall out of that, and they are different
 * constraints that were briefly conflated:
 *
 *   · **No registration.** Decided 2026-08-21: converting is free and anonymous, forever. That is
 *     what removed cloud presets from `ConvertPresets` — they were the only thing on the whole
 *     converter surface that required an account.
 *   · **No credentials in a public repo.** An anonymous read of a public counter never needed a
 *     login, so it survives the first constraint — but a public repo shipping a Supabase URL and
 *     anon key means every fork reads and writes THIS project's tables, and it makes "nothing is
 *     uploaded" harder to say rather than easier. So the converter holds no Supabase client at all.
 *
 * What is left is four anonymous HTTP calls, listed below, and this module is the one place that
 * decides where they go. `convert-backend-free.test.mts` asserts the converter surface reaches a
 * backend through here and nowhere else — and it earned its keep immediately, catching two of those
 * four within the hour of being written.
 *
 * ── WHY AN ORIGIN RATHER THAN A HARDCODED HOST ──────────────────────────────────────────────────
 *
 * Today the converter and the API are the same deployment, so same-origin is correct and this
 * returns a bare path. After the split they are two deployments and the converter must name
 * MakerRun explicitly. Both states are the same code with a different environment, which is what
 * makes the carve a configuration change instead of an edit — and it means the seam is exercised in
 * production BEFORE the split, rather than being first tried on the day it matters.
 *
 * `NEXT_PUBLIC_` because these calls are made from the browser. Nothing secret is involved: the
 * value is a public hostname, and every endpoint behind it is anonymous and rate-limited.
 *
 * Not to be used for anything else. This is not a general HTTP helper — it is the list of things the
 * converter is allowed to ask a server for. Adding to it means deciding, deliberately, that an
 * open-source in-browser converter should depend on a server for one more thing.
 */

/**
 * The calls the converter is permitted to make. Anonymous, all of them.
 *
 * Two are invisible to the visitor and two are things they explicitly ask for:
 *
 *   · `/api/convert-count`     — bump and read the social-proof counter. Decorative.
 *   · `/api/report-conversion` — opt-in: "this came out wrong, take my file and fix it".
 *   · `/api/convert`           — the OPTIONAL server-side fallback for files the browser cannot
 *                                handle. The in-browser path is the default and always tried first;
 *                                this uploads, converts in memory and stores nothing. It is the one
 *                                call that qualifies "nothing is uploaded", so the claim has to be
 *                                worded as what happens by default, not as what the code can never
 *                                do — see `COMPETITIVE-2026-08.md` §1d on getting exactly this
 *                                distinction right.
 *   · `/api/waitlist`          — the capture panel's notify-me box (Turnstile + rate limit).
 *
 * This list was three entries long when it was written, and `convert-backend-free.test.mts` caught
 * the other two the same hour. That is the argument for the test, not a footnote to it.
 */
export type ConvertApiPath =
  | "/api/convert-count"
  | "/api/report-conversion"
  | "/api/convert"
  | "/api/waitlist";

/**
 * Where the converter's backend lives.
 *
 * Empty string means same-origin, which is both the default and the current production state.
 * Trailing slashes are stripped so `https://makerrun.com/` and `https://makerrun.com` cannot
 * produce a double slash and a 404 that only appears in one environment.
 */
function origin(): string {
  const raw = process.env.NEXT_PUBLIC_CONVERT_API_ORIGIN ?? "";
  return raw.trim().replace(/\/+$/, "");
}

/**
 * Absolute URL for one of the converter's backend calls, or a bare path when same-origin.
 *
 * Returning a path rather than `location.origin + path` in the same-origin case keeps this callable
 * during SSR, where `location` does not exist — `ConvertCount` renders on the server before its
 * effect runs.
 */
export function convertApi(path: ConvertApiPath): string {
  return `${origin()}${path}`;
}
