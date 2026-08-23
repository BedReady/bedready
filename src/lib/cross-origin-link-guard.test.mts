// A path this site does not own must not be rendered by next/link.
//
// ── WHY THIS IS A TEST ──────────────────────────────────────────────────────────────────────────
// After the split, a dozen paths in this site's own header and footer — /verified, /designs, /app,
// /help, /feedback, /changelog, /privacy, /terms, /licenses — belong to makerrun.com and get there
// through a 301. They were still written as `next/link`, and next/link prefetches. So every page
// load fired a prefetch at a path that redirects off-origin, and the browser refused the follow-up:
//
//   Connecting to 'https://makerrun.com/verified' violates the following Content Security Policy
//   directive: "connect-src 'self' …". The action has been blocked.
//   Failed to fetch RSC payload for https://bedready.io/verified. Falling back to browser navigation.
//
// Twenty-eight such links, two console errors each, on every page — and nothing visibly broken,
// because the fallback works. That is why it survived a design review: the only symptom was in a
// console nobody had open.
//
// The rule cannot be "don't link to /verified" — the links are correct, the component was wrong.
// So it is stated as ownership: ask origin.ts who owns the path, and if it is not this site, the
// link goes through SiteLink (a plain <a>, no prefetch, no redirect hop, locale prefix re-applied).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { originFor, CONVERTER_ORIGIN } from "./origin.ts";

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const f = join(dir, e.name);
    if (e.isDirectory()) walk(f, out);
    else if (f.endsWith(".tsx")) out.push(f);
  }
  return out;
}

const TAG = /<(Link|NavLink)\b[\s\S]*?>/g;          // whole tag: href is often on its own line
const HREF = /href=(?:"([^"]+)"|\{"([^"]+)"\})/;
const DATA = /\bhref:\s*"([^"]+)"/g;                 // nav data arrays render through <Link> too
const IMPORTS_NEXT_LINK = /import\s*\{[^}]*\bLink\b[^}]*\}\s*from\s*"@\/i18n\/navigation"/;

const files = walk("src").filter((f) => !f.endsWith("SiteLink.tsx"));

function offenders(): string[] {
  const hits: string[] = [];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    // Only a prefetching next/link is a problem; SiteLink already renders these as plain <a>.
    if (!IMPORTS_NEXT_LINK.test(src)) continue;
    const lineOf = (i: number) => src.slice(0, i).split("\n").length;
    for (const m of src.matchAll(TAG)) {
      const h = m[0].match(HREF);
      const href = h?.[1] ?? h?.[2];
      if (href?.startsWith("/") && originFor(href) !== CONVERTER_ORIGIN) {
        hits.push(`${f}:${lineOf(m.index!)} — <${m[1]} href="${href}"> belongs to ${originFor(href)}`);
      }
    }
    for (const m of src.matchAll(DATA)) {
      if (m[1].startsWith("/") && originFor(m[1]) !== CONVERTER_ORIGIN) {
        hits.push(`${f}:${lineOf(m.index!)} — { href: "${m[1]}" } belongs to ${originFor(m[1])}`);
      }
    }
  }
  return hits;
}

test("no next/link points at a path this site does not own", () => {
  const hits = offenders();
  assert.deepEqual(
    hits,
    [],
    "these prefetch a path that 301s off-origin, which CSP then blocks. Import Link from\n" +
      "@/components/SiteLink instead — it renders cross-site paths as a plain <a> and keeps the\n" +
      "locale prefix:\n  " + hits.join("\n  "),
  );
});

test("SiteLink re-applies the locale, because the 301 it replaces did", () => {
  // bedready.io/de/privacy 301s to makerrun.com/de/privacy. An absolute URL built from the bare
  // path would land a German reader on the English page — a worse bug than the one being fixed.
  const src = readFileSync("src/components/SiteLink.tsx", "utf8");
  assert.match(src, /useLocale\(\)/, "SiteLink must know the active locale");
  assert.match(src, /locale === "en" \? href : `\/\$\{locale\}\$\{href\}`/, "…and prefix all but the default");
});

test("the guard is looking at real code and can still fail", () => {
  assert.ok(files.length > 50, `expected to scan the tree, scanned ${files.length} files`);
  assert.ok(files.some((f) => f.endsWith("SiteFooter.tsx")), "the footer carried nine of these — it must be in scope");
  // The detectors must still match the shapes they were written for.
  assert.ok(IMPORTS_NEXT_LINK.test('import { Link, usePathname } from "@/i18n/navigation";'));
  assert.ok(!IMPORTS_NEXT_LINK.test('import Link from "@/components/SiteLink";'));
  assert.equal('<Link\n  href="/verified"\n  className="x">'.match(TAG)?.[0].match(HREF)?.[1], "/verified");
  // And origin.ts must still consider these someone else's, or the rule is vacuous.
  assert.notEqual(originFor("/verified"), CONVERTER_ORIGIN);
  assert.equal(originFor("/convert"), CONVERTER_ORIGIN);
});
