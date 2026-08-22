// The four rules the 2026-08-22 design review turned into code, asserted over the whole tree.
// Run: `npm test`.
//
// ── WHY THESE ARE TESTS AND NOT A STYLE GUIDE ───────────────────────────────────────────────────
//
// Every one of them was already written down. `globals.css` says the spectrum sweep "is not what a
// call to action should be"; it explains why `.btn-lg/md/sm` exist ("the 74 sites carried nine
// different pairs of px/py values"); `Panel.tsx` records that one card "was written 40-odd times with
// `rounded-md` and `rounded-lg` mixed". The rules were correct, documented, and drifting anyway,
// because nothing about writing `rounded-md` looks wrong while you are writing it.
//
// The review measured what the drift had cost: 251 `rounded-md` against 206 `rounded-lg` — a
// two-pixel difference no user reads as a system and every user reads as inattention; a primary
// action drawn in the quiet secondary treatment at the one place the whole product converges on; and
// `sky-500/10` carrying both a caution and a piece of good news, stacked, in identical boxes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";

function walk(dir: string, ext: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(full, ext, out);
    else if (e.name.endsWith(ext)) out.push(full);
  }
  return out;
}

/**
 * Source lines with the prose stripped.
 *
 * Comments quote these class names and these spellings when explaining the rules, so a guard that
 * reads them has hundreds of findings and gets deleted. Block comments have to be tracked across
 * lines rather than matched per line: this repository's reasoning runs to twenty-line `/* … *\/`
 * headers, and only the first of those lines starts with a marker.
 */
function codeLines(file: string): [number, string][] {
  const out: [number, string][] = [];
  let inBlock = false;
  readFileSync(file, "utf8").split("\n").forEach((line, i) => {
    const opens = /\{?\/\*/.test(line);
    const closes = /\*\//.test(line);
    if (inBlock) {
      if (closes) inBlock = false;
      return; // the closing line is still comment text
    }
    if (opens && !closes) { inBlock = true; return; }
    if (/^\s*(\/\/|\*|\{?\/\*)/.test(line)) return;
    out.push([i + 1, line]);
  });
  return out;
}

/**
 * The surfaces this rule covers.
 *
 * In the repository this was ported from, this list existed to EXCLUDE the library's screens — about
 * eighteen more hand-rolled notices behind a sign-in that pass could not drive. Here it excludes
 * nothing: every surface in this repository is a converter surface. It is kept as a list rather than
 * simplified to "all of src" so the two repositories' guards stay recognisably the same rule, and so
 * a component added under src/components is a deliberate addition here rather than a silent one.
 */
const CONVERTER_SURFACES = [
  "src/app/[locale]/(converter)",
  "src/components/ConverterHeader.tsx",
  "src/components/SiteFooter.tsx",
  "src/components/MobileNav.tsx",
  "src/components/OrcaFilaments.tsx",
  "src/components/ContributeToLibrary.tsx",
  "src/components/ShareBedReady.tsx",
  "src/components/ConvertCapture.tsx",
  "src/components/ConvertPresets.tsx",
  "src/components/BeforeAfter.tsx",
  "src/components/NotFoundBody.tsx",
];

/** Every .tsx under the converter's surfaces. */
function converterFiles(): string[] {
  return CONVERTER_SURFACES.flatMap((p) =>
    statSync(p).isDirectory() ? walk(p, ".tsx") : [p],
  );
}

// ────────────────────────────────────────────────────────────────────────────────────────────────

test("there is one corner radius, plus the pill", () => {
  // `rounded-lg` for everything with a corner, `rounded-full` for pills and swatches. `rounded-md`
  // differs from `rounded-lg` by two pixels: too small to read as a decision, exactly large enough
  // to read as carelessness when a button and the card it sits in disagree.
  const hits: string[] = [];
  for (const f of walk("src", ".tsx")) {
    for (const [n, line] of codeLines(f)) {
      for (const m of line.matchAll(/\brounded-(none|sm|md|xl|2xl|3xl)\b/g)) {
        hits.push(`${f}:${n} — ${m[0]}`);
      }
    }
  }
  assert.deepEqual(hits, [], "use rounded-lg (or rounded-full for a pill):\n  " + hits.join("\n  "));
});

test("type sizes come from the scale, and the scale starts at 12px", () => {
  // The review counted 310 elements at 14px or smaller against ONE at 16px, and 49 sizes written as
  // arbitrary values — `text-[9px]`, `[10px]`, `[11px]` — that belong to no scale at all. Nothing
  // failed a contrast check, because the colours had been measured properly. It still read as a page
  // you lean toward, and it flattened hierarchy: when the gaps between levels are one pixel, there
  // are no levels.
  //
  // `text-[11px]` is the one worth naming. It was 46 uses — the single most repeated size on the
  // site after 12 and 14 — and one pixel is not a decision. Every arbitrary size here was somebody
  // reaching past the scale for a value the scale already had, or nearly had.
  //
  // RELATIVE sizes are deliberately allowed: `text-[0.85em]` on the `↗` that marks an off-site link
  // scales with whatever it sits inside, which is the opposite failure mode — it has no fixed size
  // to drift. The rule is about px values written outside the scale, not about every bracket.
  const hits: string[] = [];
  for (const f of walk("src", ".tsx")) {
    for (const [n, line] of codeLines(f)) {
      for (const m of line.matchAll(/\btext-\[\d+px\]/g)) hits.push(`${f}:${n} — ${m[0]}`);
    }
  }
  assert.deepEqual(
    hits,
    [],
    "use the scale: text-xs (12) / text-sm (14) / text-base (16) / text-lg / text-xl / text-2xl+:\n  " +
      hits.join("\n  "),
  );
});

test("every button primitive carries a size, because the primitive has no padding of its own", () => {
  // `.btn-primary` sets colour, weight and radius; `.btn-lg/md/sm/xs` set padding. Written alone it
  // renders a fill with the text touching its edges — which is what shipped on the done screen's
  // "Save to my library", the single most important call to action the converter has.
  const hits: string[] = [];
  for (const f of walk("src", ".tsx")) {
    for (const [n, line] of codeLines(f)) {
      for (const m of line.matchAll(/className=[`"]([^"`]*)[`"]/g)) {
        const cls = m[1];
        if (/\bbtn-(primary|secondary|affirm)\b/.test(cls) && !/\bbtn-(lg|md|sm|xs)\b/.test(cls)) {
          hits.push(`${f}:${n} — ${cls.trim().slice(0, 70)}`);
        }
      }
    }
  }
  assert.deepEqual(hits, [], "these render with no padding at all:\n  " + hits.join("\n  "));
});

test("a notice uses the primitive, so its three states look like three states", () => {
  // The failure was not duplication. `sky-500/10` carried the caution "don't use Split to objects —
  // those drop painted colors" AND the reassurance "no significant overhangs, this likely prints
  // without supports", stacked, identical, no icon. Whether a notice is telling you to act is the
  // one thing its appearance has to answer.
  const TINT = /\bbg-(sky|yellow|amber|green|emerald|red|rose)-\d{3}\/(\[[\d.]+\]|\d+)\b/;
  const hits: string[] = [];
  for (const f of converterFiles()) {
    for (const [n, line] of codeLines(f)) {
      for (const m of line.matchAll(/className=[`"]([^"`]*)[`"]/g)) {
        const cls = m[1];
        // A tint plus a border is the shape of a notice. A tint alone is a badge, a chip or a
        // progress fill, and a tinted border on a BUTTON is the destructive treatment — none of
        // those are notices, and flagging them would teach people to silence this rather than
        // read it.
        if (/\bbtn-/.test(cls)) continue;
        if (TINT.test(cls) && /\bborder-(sky|yellow|amber|green|emerald|red|rose)-\d{3}\//.test(cls) && !/\bnotice\b/.test(cls)) {
          hits.push(`${f}:${n} — ${cls.trim().slice(0, 70)}`);
        }
      }
    }
  }
  assert.deepEqual(hits, [], "use .notice with .notice-info / .notice-warn / .notice-ok:\n  " + hits.join("\n  "));
});

/** The tokens of a className string, so a rule matches `page-read` without also matching
 *  `console-page-read` — \b would, because a hyphen is not a word character. */
function classes(attr: string): string[] {
  return attr.trim().split(/\s+/);
}

function usesPageRead(src: string): boolean {
  return [...src.matchAll(/className="([^"]*)"/g)].some((m) => classes(m[1]).includes("page-read"));
}

test("there are only two page measures, and both are named for what they hold", () => {
  // The names are the point. `.shell` and `.breakout` said where the rule sat in the stylesheet,
  // not what it was for, and the converter site and the library site had drifted into calling the
  // same 48rem measure by different names — so copy moved between the two repositories arrived
  // wearing a class that did not exist. `page-*` is the shared vocabulary: page-read holds body
  // copy, page-breakout escapes it for a figure. A third measure is a design decision, so it
  // should cost a line in this list rather than appearing quietly in a diff.
  const css = readFileSync("src/app/globals.css", "utf8");
  const declared = [...css.matchAll(/^\.(page-[a-z-]+)\s*\{([^}]*)\}/gm)]
    .filter((m) => /(^|[\s;])(max-)?width\s*:/.test(m[2]))
    .map((m) => m[1])
    .sort();
  assert.deepEqual(declared, ["page-breakout", "page-read"]);
});

test("every converter page uses .page-read, so the logo and the headline share a left edge", () => {
  // They did not. The header and footer were `max-w-5xl` (1024) while pages were 2xl, 3xl, 4xl or
  // 5xl depending on the route — on /convert that put the logo's left edge at 152px and the first
  // line of body copy at 328px, with nothing bridging the 176px between them.
  const group = "src/app/[locale]/(converter)";
  const hits: string[] = [];
  for (const f of walk(group, ".tsx")) {
    if (!f.endsWith("/page.tsx")) continue;
    const src = readFileSync(f, "utf8");
    // Both spellings: `className="…"` and `className={`…`}`. NotFoundBody is written the second
    // way, so a rule that only reads the first would have called a page compliant by not reading
    // it at all — and a page with no <main> at all is a miss, not a pass, hence no `continue`.
    const main = src.match(/<main[^>]*className=(?:"([^"]*)"|\{`([^`$]*))/);
    if (!main) {
      hits.push(`${f} — no <main className> this rule can read`);
      continue;
    }
    const cls = main[1] ?? main[2];
    if (!classes(cls).includes("page-read")) hits.push(`${f} — <main className="${cls}">`);
  }
  assert.deepEqual(hits, [], "these set their own width instead of using .page-read:\n  " + hits.join("\n  "));
});

test(".page-read is also what the chrome uses, or the pages align with nothing", () => {
  // Half a fix is the failure mode here: every page could agree with every other page and still
  // disagree with the header above them all.
  // No SiteHeader here: that component is the library's and the carve left it behind. This
  // repository serves one product, so the converter's header and the shared footer are the chrome.
  for (const f of ["src/components/ConverterHeader.tsx", "src/components/SiteFooter.tsx"]) {
    const src = readFileSync(f, "utf8");
    assert.ok(usesPageRead(src), `${f} does not use .page-read`);
    assert.ok(
      !/\bmax-w-\dxl\b/.test(src.replace(/^\s*(\/\/|\*|\/\*).*$/gm, "")),
      `${f} still sets its own container width`,
    );
  }
});

test("English copy spells things one way", () => {
  // /calibrate was written entirely in British English and /compare-u1-converters in first person;
  // the two spellings then collided INSIDE single pages — "your AMS colours land in the wrong slots"
  // three lines from "your AMS-painted colors", and "Live coloured 3D preview" one table row from
  // "Keeps painted multicolor".
  //
  // Comments are deliberately out of scope. They are the author's notes, not copy, and this
  // repository's reasoning is written in British English throughout — normalising that would rewrite
  // thousands of lines of argument to fix a user-visible inconsistency that is not in them.
  const BRITISH = /\b(colours?|coloured|colouring|behaviour|centre|catalogue|licence|optimise[d]?|normalise[d]?|recognise[d]?|analyse[d]?|greys?)\b/i;
  const hits: string[] = [];

  const en = JSON.parse(readFileSync("messages/en.json", "utf8"));
  const leaves = (o: unknown, p = ""): [string, string][] =>
    typeof o === "string"
      ? [[p, o]]
      : o && typeof o === "object"
        ? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => leaves(v, p ? `${p}.${k}` : k))
        : [];
  for (const [k, v] of leaves(en)) {
    const m = v.match(BRITISH);
    if (m) hits.push(`messages/en.json ${k} — "${m[0]}"`);
  }

  for (const f of converterFiles()) {
    for (const [n, line] of codeLines(f)) {
      // Only the halves of a line that are prose: a trailing `// …` is a note, not copy.
      const head = line.split(/\s\/\/\s/)[0]!;
      const m = head.match(BRITISH);
      if (m) hits.push(`${f}:${n} — "${m[0]}"`);
    }
  }

  assert.deepEqual(hits, [], "user-visible English copy, in two spellings:\n  " + hits.join("\n  "));
});

test("the spelling guard would fire, and does not fire on the codebase's own voice", () => {
  // Both halves: a guard that cannot fail is indistinguishable from a passing one, and a guard that
  // fires on comments would have 2,000 findings and be deleted within the day.
  const BRITISH = /\b(colours?|coloured|behaviour|centre)\b/i;
  assert.ok(BRITISH.test("Live coloured 3D preview"));
  assert.ok(!BRITISH.test("Live colored 3D preview"));
  // And the block-comment tracker. The line that trips a naive per-line filter is the CONTINUATION
  // of a `{/* … */}` block, which starts with an ordinary word — convert/page.tsx has one reading
  // "mono ordinal now rather than a filled violet disc: violet is the action colour on this page",
  // and a per-line filter reports it as British copy.
  const page = "src/app/[locale]/(converter)/convert/page.tsx";
  const raw = readFileSync(page, "utf8").split("\n");
  assert.ok(
    raw.some((l) => /mono ordinal now rather than a filled violet disc/.test(l)),
    "the fixture line this asserts against has been edited away — pick another block comment",
  );
  assert.deepEqual(
    codeLines(page).filter(([, l]) => /mono ordinal now rather than/.test(l)),
    [],
    "codeLines returned the middle of a block comment",
  );
});

test("the site names its sister, and links its own source", () => {
  // Neither was true before. "MakerRun" appeared in NO user-visible string on either site — only in
  // code comments — while middleware.ts was already 301ing half the paths to makerrun.com. And the
  // public repository, which `SPLIT-DECISION-2026-08.md` calls "the loudest available version" of
  // the no-upload claim "because it is the only one a sceptic can verify", was linked nowhere —
  // on a site whose comparison page links four COMPETITORS' repositories.
  const strings = JSON.parse(readFileSync("messages/en.json", "utf8"));
  const flat = JSON.stringify(strings);
  assert.ok(flat.includes("MakerRun"), "no user-visible string names MakerRun");

  const footer = readFileSync("src/components/SiteFooter.tsx", "utf8");
  assert.ok(/SOURCE_REPO_URL/.test(footer), "the footer does not link the source");
  assert.ok(/sisterIntro/.test(footer), "the footer does not explain what MakerRun is");

  const header = readFileSync("src/components/ConverterHeader.tsx", "utf8");
  assert.ok(/t\("makerrun"\)/.test(header), "the converter header does not name MakerRun");

  // One place holds the addresses, for the same reason origin.ts holds the origins.
  const hardcoded: string[] = [];
  for (const f of walk("src", ".tsx")) {
    if (f.endsWith("links.ts")) continue;
    for (const [n, line] of codeLines(f)) {
      if (/["']https:\/\/github\.com\/BedReady\//.test(line)) hardcoded.push(`${f}:${n}`);
    }
  }
  assert.deepEqual(hardcoded, [], "import SOURCE_REPO_URL from lib/links instead:\n  " + hardcoded.join("\n  "));
});
