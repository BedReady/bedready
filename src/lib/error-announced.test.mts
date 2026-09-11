// An error a screen reader is never told about. Run: `npm test`.
//
// ── HOW THIS WAS FOUND, WHICH IS THE ARGUMENT FOR THE TEST ──────────────────────────────────────
//
// Not by an audit. BedReady/makerrun's `engine-drift.mjs` was extended to compare shared COMPONENTS
// as well as `src/lib`, and `ConvertCapture.tsx` came back divergent by two lines. One of them:
//
//     here:      <p className="mt-2 text-xs text-red-300">{message}</p>
//     makerrun:  <p role="alert" className="mt-2 text-xs text-red-300">{message}</p>
//
// The same component, on two sites, and only one of them announced its failure. Reading the rest of
// this repo found four more: the conversion-failure message on /convert — the product's primary
// failure, the one a visitor most needs to hear — plus the batch error beside it, /calibrate's, and
// the filament catalog's load failure. `role="alert"` appeared exactly once in the whole repo.
//
// ── WHY IT MATTERS MORE HERE THAN ON MOST SITES ────────────────────────────────────────────────
//
// These messages replace nothing. They appear, silently, somewhere on a long page, after an action
// whose result is otherwise invisible — a file that did not convert looks exactly like a file still
// converting to somebody who cannot see the page. Without a live region the reader is left waiting
// for something that already failed.
//
// ── AND WHAT IS DELIBERATELY NOT AN ALERT ──────────────────────────────────────────────────────
//
// `role="alert"` is assertive: it interrupts. A message that is always on the page interrupts on
// every load, which teaches people to ignore the role. The exemptions below are exactly those, each
// with the reason, and each re-checked so the list cannot outlive it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

/**
 * Messages styled as an error or a warning that are NOT announced, each because announcing them
 * would be wrong rather than because nobody got to them.
 */
const NOT_ALERTS: { file: string; needle: string; why: string }[] = [
  {
    file: "src/app/[locale]/(converter)/image/page.tsx",
    needle: 'notice-warn" : status === "done"',
    why:
      "One element for three states — info, done and error — so its className is computed. Marking " +
      "it assertive would announce every success as an alert. It wants a polite live region, which " +
      "is a separate change and a different decision from this one.",
  },
  {
    file: "src/app/[locale]/(converter)/convert/page.tsx",
    needle: '<p className="notice notice-warn mt-3"><NoticeIcon level="warn" />{warn}</p>',
    why:
      "A warning ABOUT a conversion that succeeded, rendered beside its result — the visitor is " +
      "already being told the outcome. Assertive would interrupt that; polite is the right register " +
      "and is not what this rule is for.",
  },
];

/** Every tracked .tsx. Derived, so a new page is covered without anybody remembering. */
function tsxFiles(): string[] {
  return execFileSync("git", ["ls-files", "src"], { encoding: "utf8" })
    .split("\n")
    .filter((f) => f.endsWith(".tsx"));
}

/**
 * Paragraphs that are a failure MESSAGE, as opposed to red prose.
 *
 * ── THE FIRST VERSION MATCHED ON THE COLOUR, AND THAT WAS WRONG ─────────────────────────────────
 *
 * "A red `<p>`" caught five real cases and three that are not errors at all: two panels on /convert
 * explaining that Full Spectrum cannot reproduce a saturated palette. Those render BESIDE a
 * successful result, as part of it — the visitor is already being told the outcome, and interrupting
 * them to read an explanation is not what an alert is for. A rule with five exemptions is a rule
 * somebody deletes.
 *
 * What actually separates them is the CONTENT. A failure message is a state variable and nothing
 * else — `{message}`, `{error}`, `{batchMsg}`, `{err}` — optionally behind an icon. Advisory prose
 * is a sentence, or a `t()` call with arguments. So the detector reads the children, and the
 * exemption list drops from five to two.
 */
function errorParagraphs(src: string): { tag: string; el: string }[] {
  const out: { tag: string; el: string }[] = [];
  for (const m of src.matchAll(/<p\s[^>]*>[\s\S]*?<\/p>/g)) {
    const el = m[0];
    const tag = el.slice(0, el.indexOf(">") + 1);
    // `<p>` only, and never a control: a red `<button>` or a `hover:text-red-300` link is something
    // you press, not something you are told. A rule that flagged those is a rule somebody turns off.
    if (!/text-red-\d00|notice-warn/.test(tag)) continue;
    if (/hover:/.test(tag)) continue;
    // The children, with an optional icon and wrapper stripped. What is left must be one
    // interpolated identifier — the shape of a message held in state.
    const inner = el
      .slice(el.indexOf(">") + 1, el.lastIndexOf("</p>"))
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/<NoticeIcon[^>]*\/>/g, "")
      .replace(/<\/?span[^>]*>/g, "")
      .trim();
    if (!/^\{[A-Za-z_$][\w$]*\}$/.test(inner)) continue;
    out.push({ tag, el });
  }
  return out;
}

test("every error message a visitor is shown is announced to a screen reader", () => {
  const offenders: string[] = [];
  for (const file of tsxFiles()) {
    const src = readFileSync(file, "utf8");
    for (const { tag, el } of errorParagraphs(src)) {
      if (/role="alert"/.test(tag)) continue;
      // Matched against the whole ELEMENT: the two exemptions are told apart by what they render,
      // not by their opening tag — which is the same distinction the detector itself turns on.
      if (NOT_ALERTS.some((e) => e.file === file && el.replace(/\s+/g, " ").includes(e.needle))) continue;
      offenders.push(`${file}: ${tag.slice(0, 110)}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "an error message renders with no live region, so a screen reader is never told the action " +
      "failed — it looks exactly like the action still running.\n  " + offenders.join("\n  "),
  );
});

test("every exemption still points at something, and still carries its reason", () => {
  // An exemption nobody re-checks is indistinguishable from a rule nobody enforces.
  for (const e of NOT_ALERTS) {
    const src = readFileSync(e.file, "utf8");
    assert.ok(src.replace(/\s+/g, " ").includes(e.needle), `${e.file} no longer contains ${e.needle.slice(0, 50)} — drop the exemption`);
    assert.ok(e.why.length > 60, "an exemption without a reason is just an exception");
  }
});

test("the scan can tell a message from a control", () => {
  // The rule survives only while it stays quiet about buttons. Both of these are real shapes in the
  // tree: a delete control tinted red, and a link that turns red on hover.
  assert.deepEqual(errorParagraphs('<button className="text-red-300">Delete</button>'), []);
  assert.deepEqual(errorParagraphs('<p className="hover:text-red-300">x</p>'), []);
  assert.equal(errorParagraphs('<p className="mt-2 text-xs text-red-300">{message}</p>').length, 1);
  assert.equal(errorParagraphs('<p role="alert" className="notice notice-warn">{err}</p>').length, 1);
  // Red PROSE is not a failure message, which is the distinction the first version got wrong: the
  // Full Spectrum panels on /convert explain a limitation beside a result that succeeded.
  assert.deepEqual(errorParagraphs('<p className="text-red-200">Full Spectrum can\'t reproduce 3 of these colors.</p>'), []);
  assert.deepEqual(errorParagraphs('<p className="notice notice-warn"><span>{t("quitFirstWarning")}</span></p>'), []);
});
