/**
 * The message namespaces the browser needs, and nothing else.
 *
 * `NextIntlClientProvider` with no `messages` prop hands the client the ENTIRE catalogue: about
 * 105 KB of JSON serialized into the payload of every page, in every locale, most of it library and
 * account copy this site never renders, plus the server-rendered pages' own text a second time.
 * Server components read their messages on the server and need none of it shipped.
 *
 * A namespace belongs here when a client component (a "use client" file, or anything it imports)
 * calls `useTranslations("<namespace>")`. client-messages.test.mts walks that import graph and fails
 * on a namespace missing from this list, so a new client component cannot render raw keys in
 * production because its messages were never sent, and on a listed one nothing uses any more.
 */
export const CLIENT_NAMESPACES = [
  "calibrate",
  "convert",
  "egress",
  "error",
  "image",
  "lang",
  "lithophane",
  "mixer",
  "nav",
  "notFound",
  "orca",
  "sponsor",
] as const;

export function pickClientMessages<T extends Record<string, unknown>>(all: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const ns of CLIENT_NAMESPACES) if (ns in all) out[ns] = all[ns];
  return out as Partial<T>;
}
