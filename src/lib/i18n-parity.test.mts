// Every message key a call site asks for exists, in every locale.
// Run: `npm test`.
//
// ── WHY THIS REPOSITORY HAD NO SUCH CHECK, AND WHY THAT MATTERS MORE HERE ───────────────────────
//
// The carve brought the messages across and left this guard behind. So the repository that renders
// six languages nobody on the team reads is the one with nothing asserting those languages resolve.
// A missing key is not a compile error and not a lint error: next-intl throws at render, or emits
// the raw dotted path into the page, and neither shows up until somebody loads `/ja/convert`.
//
// It is not hypothetical. Porting the design review into this repository added nine new keys across
// seven locales. In the repository that still HAS this test, the equivalent change failed it twice
// on the first run — `nav.mixer` and `nav.calibrate` were used by a component and existed in no
// locale. Here, the same mistake would have shipped.
//
// ── WHAT THIS IS NOT ────────────────────────────────────────────────────────────────────────────
//
// It is a subset of `i18n-parity.test.mts` in the library's repository, not a copy. That file also
// carries rules about the upload flow, a by-fact exemption list and a dynamic-key registry — all of
// which describe screens that do not exist here. Copying them across would ship four hundred lines
// asserting things about pages this repository does not have, which is how a test becomes furniture.
//
// Two rules, both load-bearing:
//
//   1. every locale carries exactly the key set `en` carries
//   2. every key a call site names resolves in `en`
//
// They are different claims. Parity is satisfied by seven locales that are all missing the same key.
//
// ── AND THE LIMIT, WHICH COST SOMETHING TO LEARN ────────────────────────────────────────────────
//
// For an ARRAY of content — `features.groups[].items[]` — these rules check that the positions
// exist, and nothing checks that position 2 means the same thing in every locale. When this guard
// first ran it reported eighteen keys missing from `features.groups`, which was true; the inference
// drawn from it was not. The counts differed because the locales carried the SAME bullets in a
// DIFFERENT ORDER, each missing a different one — not because three bullets were untranslated.
//
// Appending three translations to the end made every count match, satisfied this test, and shipped
// six languages a page that stated three claims twice while still omitting the three it never had.
// The lesson is not about arrays: it is that a length is not a diff, and "the counts differ, so the
// tail is missing" is an assumption that positional data invites and never justifies.
//
// **Before adding a key to fix a parity failure, read the items.**
//
// ── AND THE DURABLE FIX, NOW MADE ───────────────────────────────────────────────────────────────
//
// `features.groups` was that array and is now an object keyed by name — `groups.colors.items.
// prusaPaint` instead of `groups.1.items.3`. Parity over names IS the semantic check, because a
// German page missing `prusaPaint` now fails rule 1 by name rather than passing it by count.
//
// Rule 3 below covers the half rule 2 cannot: the page addresses those keys through template
// literals built from a const in the component, and the call-site scanner only reads string
// literals. Without it the most structured content on the site would be the least checked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const LOCALES = ["en", "de", "es", "fr", "zh", "ja", "ar"];

/** Every .ts/.tsx under a directory, tests excluded — they quote keys while explaining them. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\./.test(entry)) out.push(full);
  }
  return out;
}

/** Every leaf path in a message tree, arrays included — `help.sections.0.q` is a real key. */
export function leafKeys(node: unknown, prefix = ""): string[] {
  if (typeof node === "string") return [prefix];
  if (Array.isArray(node)) return node.flatMap((v, i) => leafKeys(v, `${prefix}.${i}`));
  if (node && typeof node === "object") {
    return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
      leafKeys(v, prefix ? `${prefix}.${k}` : k),
    );
  }
  return [];
}

/**
 * Blank out comments and string bodies so a key quoted in prose is not read as a call.
 *
 * Character-wise rather than by regex: a `//` inside a URL and a `/*` inside a template literal both
 * defeat the obvious pattern, and this file's whole job is to be trusted about what the source says.
 */
function stripComments(src: string): string {
  let out = "";
  for (let i = 0; i < src.length; i++) {
    const two = src.slice(i, i + 2);
    if (two === "//") {
      const end = src.indexOf("\n", i);
      i = end === -1 ? src.length : end - 1;
      continue;
    }
    if (two === "/*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 1;
      continue;
    }
    out += src[i];
  }
  return out;
}

/** Which namespace each `useTranslations`/`getTranslations` result is bound to, per file. */
function translatorNamespaces(src: string): Map<string, string> {
  const ns = new Map<string, string>();
  const decl =
    /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\s*\(\s*(?:"([^"]*)"|'([^']*)'|\{[^}]*namespace:\s*"([^"]*)"[^}]*\})?\s*\)/g;
  for (const m of src.matchAll(decl)) ns.set(m[1]!, m[2] ?? m[3] ?? m[4] ?? "");
  return ns;
}

/**
 * Whether a dotted path resolves in the message tree.
 *
 * `t()`, `t.rich()` and `t.markup()` all render a message, so the node has to BE a string. `t.raw()`
 * is the exception, used deliberately for list content — `help.sections`, `extension.steps` — so
 * requiring a string there would flag every one of them as broken when none is.
 */
function resolves(messages: unknown, path: string, anyType = false): boolean {
  let node: unknown = messages;
  for (const part of path.split(".").filter(Boolean)) {
    if (node === null || typeof node !== "object" || !(part in (node as Record<string, unknown>))) return false;
    node = (node as Record<string, unknown>)[part];
  }
  return anyType ? node !== undefined : typeof node === "string";
}

// ────────────────────────────────────────────────────────────────────────────────────────────────

test("every locale carries the same keys as English", () => {
  const en = new Set(leafKeys(JSON.parse(readFileSync("messages/en.json", "utf8"))));
  const problems: string[] = [];
  for (const loc of LOCALES.filter((l) => l !== "en")) {
    const keys = new Set(leafKeys(JSON.parse(readFileSync(`messages/${loc}.json`, "utf8"))));
    for (const k of en) if (!keys.has(k)) problems.push(`${loc}: missing ${k}`);
    for (const k of keys) if (!en.has(k)) problems.push(`${loc}: has ${k}, English does not`);
  }
  assert.deepEqual(
    problems.slice(0, 40),
    [],
    `${problems.length} key(s) differ between locales. A key present in English and absent elsewhere ` +
      "renders as the raw dotted path — or throws — on that locale's pages, and nothing else here looks.",
  );
});

test("every message key a call site names exists — which parity does not check", () => {
  // Parity is satisfied by seven locales that are all missing the same key. This is the rule that
  // caught `nav.mixer` and `nav.calibrate` in the library's repository: used by a component,
  // present in no locale, and invisible to every other check in the suite.
  const en = JSON.parse(readFileSync("messages/en.json", "utf8"));
  const missing: string[] = [];

  for (const file of sourceFiles("src")) {
    const src = stripComments(readFileSync(file, "utf8"));
    for (const [v, namespace] of translatorNamespaces(src)) {
      const call = new RegExp(`\\b${v}(\\.(?:rich|markup|raw))?\\(\\s*(?:"([^"]+)"|'([^']+)')`, "g");
      for (const m of src.matchAll(call)) {
        const literal = m[2] ?? m[3];
        if (literal === undefined) continue;
        const path = namespace ? `${namespace}.${literal}` : literal;
        if (!resolves(en, path, m[1] === ".raw")) missing.push(`${file}: ${v}("${literal}") → ${path}`);
      }
    }
  }
  assert.deepEqual(missing, [], "a call site names a message key that exists in no locale");
});

test("both rules would fire, and neither fires on a correct tree", () => {
  // A guard that cannot fail is indistinguishable from a passing one — and these two fail on
  // different things, which is the entire reason there are two.
  const tree = { nav: { makerrun: "MakerRun" }, help: { steps: ["a", "b"] } };
  assert.equal(resolves(tree, "nav.makerrun"), true);
  assert.equal(resolves(tree, "nav.missing"), false);
  // `t.raw` reads the array itself; `t` would correctly refuse it.
  assert.equal(resolves(tree, "help.steps", true), true);
  assert.equal(resolves(tree, "help.steps"), false);
  // Array members are real keys, or a locale could drop one and still look at parity.
  assert.deepEqual(leafKeys(tree).sort(), ["help.steps.0", "help.steps.1", "nav.makerrun"]);
  // Prose that quotes a key is not a call site.
  assert.equal(stripComments('// t("nav.ghost")\nconst x = 1;').includes("nav.ghost"), false);
});

test("/features asks for keys that exist, in every locale", () => {
  // The page builds its keys from a `GROUPS` const rather than writing them out — `t(`groups.${g.key}
  // .items.${k}`)` — which the scanner in rule 2 cannot follow, because it reads string literals only.
  // So the const is read here and resolved directly. This is the check that would have caught the
  // 2026-08-22 duplicate-bullet mistake at the point it was made, rather than three passes later.
  const page = readFileSync("src/app/[locale]/(converter)/features/page.tsx", "utf8");
  const block = page.slice(page.indexOf("const GROUPS = ["), page.indexOf("] as const;") + 10);
  const groups = [...block.matchAll(/\{\s*key:\s*"([^"]+)",\s*items:\s*\[([^\]]*)\]/g)].map((m) => ({
    key: m[1]!,
    items: [...m[2]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!),
  }));
  assert.ok(groups.length >= 5, `GROUPS not parsed from the page — found ${groups.length}`);

  const missing: string[] = [];
  for (const loc of LOCALES) {
    const m = JSON.parse(readFileSync(`messages/${loc}.json`, "utf8"));
    for (const g of groups) {
      if (!resolves(m, `features.groups.${g.key}.title`)) missing.push(`${loc}: groups.${g.key}.title`);
      for (const k of g.items) {
        if (!resolves(m, `features.groups.${g.key}.items.${k}`)) missing.push(`${loc}: groups.${g.key}.items.${k}`);
      }
    }
  }
  assert.deepEqual(missing, [], "the /features structure names keys that do not exist");
});

test("…and no locale carries a feature bullet the page never renders", () => {
  // The other direction. A key nobody asks for is a translation somebody paid for and no reader will
  // ever see — and, after the duplicate-bullet episode, the likeliest shape of a leftover.
  const page = readFileSync("src/app/[locale]/(converter)/features/page.tsx", "utf8");
  const known = new Set([...page.matchAll(/"([a-zA-Z0-9]+)"/g)].map((m) => m[1]!));
  const orphans: string[] = [];
  for (const loc of LOCALES) {
    const g = JSON.parse(readFileSync(`messages/${loc}.json`, "utf8")).features.groups;
    for (const [gk, grp] of Object.entries(g as Record<string, { items: Record<string, string> }>)) {
      if (!known.has(gk)) orphans.push(`${loc}: groups.${gk}`);
      for (const ik of Object.keys(grp.items)) if (!known.has(ik)) orphans.push(`${loc}: groups.${gk}.items.${ik}`);
    }
  }
  assert.deepEqual(orphans, [], "these feature strings are translated and never rendered");
});

/**
 * Browsers, each as the Latin name English would use and every form a locale might.
 *
 * ── THE ASYMMETRY THAT HAS TO BE HANDLED, NOT IGNORED ───────────────────────────────────────────
 *
 * English is always Latin; a locale may transliterate. The first version of this rule tested BOTH
 * sides with the same alternation, so `كروم` in Arabic was compared against `كروم` in English —
 * which can never match — and every Arabic mention read as a locale inventing a browser. It also
 * failed the other way round: the Latin-only sweep that FOUND this drift reported Arabic as clean
 * while Arabic said `إضافة كروم` on all six of the same keys.
 *
 * So each browser is a pair: `en` is what English writes, `any` is what any locale might, and the
 * comparison runs one against the other.
 */
const BROWSERS = [
  { en: /chrome/i, any: /chrome|كروم|クローム|谷歌浏览器/i },
  { en: /firefox/i, any: /firefox|فَيَرفُكس|فايرفوكس|ファイアフォックス|火狐/i },
  { en: /safari/i, any: /safari|سفاري|サファリ/i },
  { en: /\bedge\b/i, any: /\bedge\b|إيدج|エッジ/i },
];

/**
 * Keys that are ABOUT one browser, where naming it is the point.
 *
 * `extension.safariPending` sits under the page's "Safari (Mac)" card and says the Safari build is
 * in review; English phrases it as "the Mac App Store" and several locales name Safari outright.
 * Both are correct. Listed by fact rather than silenced by a looser rule, so the next reader sees a
 * decision.
 */
const ABOUT_ONE_BROWSER = /^extension\.(safari|chrome|firefox)/;

test("no locale names a browser that English does not", () => {
  // The extension was Chrome-only when six locales were translated. It ships for Chrome, Edge,
  // Firefox and Safari now; English was updated and the locales were not, so `nav.extension`,
  // `footer.extension`, `privacy.extTitle`, `help.sections.5.title`, `convert.tip` and `features.note`
  // all said "Chrome extension" in six languages — the footer one on every page of the site.
  //
  // Nothing could see it. The strings existed, were translated, and parity was perfect: a locale
  // NARROWING a claim English leaves general is invisible to every check that compares key sets.
  const en = new Map(leafKeys(JSON.parse(readFileSync("messages/en.json", "utf8")))
    .map((k) => [k, resolveString(JSON.parse(readFileSync("messages/en.json", "utf8")), k)]));
  const narrowed: string[] = [];
  for (const loc of LOCALES.filter((l) => l !== "en")) {
    const m = JSON.parse(readFileSync(`messages/${loc}.json`, "utf8"));
    for (const k of leafKeys(m)) {
      const v = resolveString(m, k), e = en.get(k);
      if (typeof v !== "string" || typeof e !== "string") continue;
      if (ABOUT_ONE_BROWSER.test(k)) continue;
      for (const b of BROWSERS) {
        if (b.any.test(v) && !b.en.test(e)) { narrowed.push(`${loc}: ${k} — names ${b.en.source}, English does not`); break; }
      }
    }
  }
  assert.deepEqual(
    narrowed,
    [],
    "a locale names a specific browser where English is general — it under-sells a shipped capability " +
      "in a language nobody on the team reads, and key-set parity cannot see it",
  );
});

/** The string at a dotted path, or undefined. Arrays are addressed by index, as `leafKeys` emits them. */
function resolveString(node: unknown, path: string): string | undefined {
  let cur: unknown = node;
  for (const part of path.split(".")) {
    if (Array.isArray(cur)) cur = cur[Number(part)];
    else if (cur && typeof cur === "object") cur = (cur as Record<string, unknown>)[part];
    else return undefined;
  }
  return typeof cur === "string" ? cur : undefined;
}
