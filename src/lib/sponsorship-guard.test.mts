// The promises the sponsorship slot makes on this site. Run: `npm test`.
//
// ── WHY THESE ARE TESTS ─────────────────────────────────────────────────────────────────────────
//
// This repository compares printers and tells the reader it is independent. Selling a slot on it —
// to a manufacturer, potentially one of the printers being compared — is only honest while a few
// specific things stay true, and every one of them is a single edit from being false. None fails
// visibly: an unlabelled banner still renders, an unqualified paid link still works, and a page
// that lost its disclosure still reads perfectly well.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { SPONSORSHIP_NOTE, SPONSOR_LABEL, SPONSOR_LINK_REL } from "./sponsor.ts";

const SLOT_SRC = readFileSync("src/components/SponsorSlot.tsx", "utf8");
/**
 * With block comments stripped. The badge check below looks for a ✓, "Verified" and emerald — and
 * the header of SponsorSlot.tsx NAMES all three, because that is where the rule is written down.
 * Scanning raw source fails on the documentation of the rule it enforces. Only block comments go;
 * `//` is left alone because stripping it would eat the `https://` in a URL.
 */
const SLOT = SLOT_SRC.replace(/\/\*[\s\S]*?\*\//g, "");
const LOCALES = ["en", "de", "es", "fr", "zh", "ja", "ar"];

function pages(dir = "src/app"): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...pages(p));
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

test("no page still claims the site is not sponsored", () => {
  // Every page here said "not affiliated with, endorsed by, or sponsored by <manufacturer>", and the
  // printer comparison said "not sponsored by any manufacturer". A manufacturer may now buy the
  // slot, so a surviving copy is a claim disproved by the banner directly above it.
  const offenders = pages().filter((f) => /sponsored by/i.test(readFileSync(f, "utf8")));
  assert.deepEqual(offenders, [], "these pages still promise they are not sponsored");
});

test("no TRANSLATION still claims it either", () => {
  // The miss that mattered on the other side of this port was a translation, not a page: the footer
  // is one i18n string and renders on every page. Each language says it differently, so one English
  // pattern finds none of them.
  const CLAIMS: [string, RegExp][] = [
    ["en", /sponsored by/i],
    ["de", /gesponsert/i],
    ["fr", /sponsoris|parrainage/i],
    ["es", /patrocinio|patrocinad/i],
    ["ja", /スポンサー関係/],
    ["zh", /或赞助|认可或赞助/],
    ["ar", /مموّل|مدعوم من/],
  ];
  const offenders: string[] = [];
  for (const [locale, claim] of CLAIMS) {
    const walk = (node: unknown, path: string) => {
      if (typeof node === "string") {
        // Three keys mention sponsorship on purpose and are not claims of absence: the replacement
        // promise; `footer.sponsor`, the label on the GitHub Sponsors link; and `library.promoted`,
        // the label on MakerRun's paid design slot, which German and French render as "Gesponsert"
        // and "Sponsorisé". Worth knowing while reading this: in those two languages a promoted
        // DESIGN and the site SPONSOR are one word apart, for genuinely different products. If that
        // ever reads as one thing, it is the promoted label that should change, not this exclusion.
        if (path.endsWith(".sponsorshipNote") || path.endsWith(".sponsor") || path.endsWith(".promoted")) return;
        if (claim.test(node)) offenders.push(`${locale}${path}`);
      } else if (Array.isArray(node)) node.forEach((v, i) => walk(v, `${path}[${i}]`));
      else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`);
    };
    walk(JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")), "");
  }
  assert.deepEqual(offenders, [], "a translation still promises the site is not sponsored");
});

test("every locale carries the replacement promise and the footer renders it", () => {
  for (const l of LOCALES) {
    const m = JSON.parse(readFileSync(`messages/${l}.json`, "utf8")) as { footer: Record<string, string> };
    assert.ok(m.footer?.sponsorshipNote?.trim(), `${l} has no footer.sponsorshipNote`);
  }
  assert.match(readFileSync("src/components/SiteFooter.tsx", "utf8"), /t\("sponsorshipNote"\)/);
  assert.match(SPONSORSHIP_NOTE, /labelled/i);
  assert.match(SPONSORSHIP_NOTE, /never affects/i);
});

test("both slots are labelled, from one constant", () => {
  assert.equal((SLOT.match(/<Label\s*\/>/g) ?? []).length, 2, "top and bottom must each carry the label");
  assert.ok(SLOT.includes("{SPONSOR_LABEL}"));
  assert.ok(SPONSOR_LABEL.trim().length > 0);
});

test("nothing in the slot is styled like MakerRun's verified badge", () => {
  // Evidence that money can buy is not evidence. A tick or the badge's colour in a paid banner
  // borrows the one claim on the other site that cannot be bought.
  assert.ok(!SLOT.includes("✓"), "a tick in a paid slot reads as the verified badge");
  assert.ok(!/emerald/.test(SLOT));
  assert.ok(!/\bVerified\b/.test(SLOT));
});

test("every sponsor link is qualified as paid", () => {
  // Google's link-spam policy penalises the site that SELLS an unqualified paid link.
  const anchors = SLOT.match(/<a\b[\s\S]*?>/g) ?? [];
  assert.ok(anchors.length >= 2, "expected a link in each slot");
  for (const a of anchors) assert.match(a, /rel=\{SPONSOR_LINK_REL\}/, `unqualified sponsor link: ${a.slice(0, 50)}`);
  assert.match(SPONSOR_LINK_REL, /\bsponsored\b/);
});

test("the shell mounts a slot top AND bottom", () => {
  // Four mounts in one file, any of which a refactor can drop without a single other test noticing.
  const shell = readFileSync("src/app/[locale]/(converter)/layout.tsx", "utf8").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  assert.match(shell, /<ConverterSponsorBar\s*\/>/, "no sponsor bar at the top");
  assert.match(shell, /<ConverterSponsorStrip\s*\/>/, "no sponsor strip at the bottom");
});

test("the slot reaches the API and never a database", () => {
  // The property this whole repository is built to keep. convert-backend-free.test.mts owns it
  // generally; restated here because sponsorship is the feature most likely to break it — the row
  // it renders lives in a database that this code must never hold a key to.
  const client = readFileSync("src/components/ConverterSponsorSlots.tsx", "utf8");
  assert.ok(!/supabase/i.test(client), "the slot must not reach a database directly");
  assert.match(client, /convertApi\("\/api\/v1\/sponsor"\)/, "it must go through the one permitted seam");
});

test("the window is half-open, matching the constraint on the other side", () => {
  const lib = readFileSync("src/lib/sponsor.ts", "utf8");
  assert.match(lib, /t >= start && t < end/, "end must be EXCLUSIVE, or back-to-back bookings overlap");
});
