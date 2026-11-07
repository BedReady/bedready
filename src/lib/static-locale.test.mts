// Every server-rendered converter page tells next-intl its locale. Run: `npm test`.
//
// A server page that renders the locale-aware <Link> (or anything else that asks next-intl for the
// locale) without calling setRequestLocale() makes next-intl read the locale from the request
// headers, and reading headers turns the page dynamic. /guides did exactly that until Nov 2026: the
// build listed it as prerendered with no revalidate, and production served it with
// `cache-control: private, no-store`, rendered from scratch on every request.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function pages(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) pages(full, out);
    else if (e === "page.tsx") out.push(full);
  }
  return out;
}

test("server pages that use next-intl call setRequestLocale()", () => {
  const missing: string[] = [];
  for (const f of pages("src/app/[locale]")) {
    const src = readFileSync(f, "utf8");
    if (/^\s*["']use client["']/.test(src)) continue; // client pages render inside the layout's locale
    const usesIntl = /from\s+["'](@\/i18n\/navigation|next-intl\/server|next-intl)["']/.test(src);
    if (usesIntl && !/\bsetRequestLocale\(/.test(src)) missing.push(f);
  }
  assert.deepEqual(missing, []);
});
