// A Latin file extension inside Arabic text keeps its leading dot on the left.
// Run: `npm test`.
//
// ── THE BUG, WHICH WAS LIVE AND INVISIBLE TO EVERYONE WHO SHIPPED IT ────────────────────────────
//
// `.3mf` is a left-to-right run — except for the dot, which is neutral. Unicode's bidi algorithm
// resolves a neutral by its surroundings, so inside Arabic the dot joins the RIGHT-to-left run
// beside it and renders on the other side of the extension. The reader sees `3mf.`
//
// Somebody knew this: 24 Arabic strings already carried a U+200E LEFT-TO-RIGHT MARK before the dot,
// and rendered correctly. Eighteen did not, and rendered backwards — including the converter's own
// drop-zone hint and the batch button. Measured on the live site by reading the glyph positions out
// of the DOM rather than by eye, because at 12px the difference is one dot moving four pixels:
//
//     convert.dropTitle   guarded    →  .3mf   ✓
//     convert.dropHint    unguarded  →  3mf.   ✗
//     convert.batchChoose unguarded  →  3mf.   ✗
//
// ── WHY THIS IS A TEST AND NOT A FIXED LIST OF STRINGS ──────────────────────────────────────────
//
// The eighteen are fixed. That is not the interesting part: the guard is a per-string convention,
// and a per-string convention drifts every time somebody writes a new string or edits an old one —
// which is exactly how it came to be applied to 24 strings and not the other 18. Nothing about
// writing `.3mf` in Arabic suggests a mark is needed, and nothing about omitting it looks wrong in
// the JSON.
//
// So the rule is asserted over the whole file rather than the instances being fixed one at a time.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const LRM = "‎";
const ARABIC = /[؀-ۿ]/;
/** A file extension, not preceded by the mark that keeps its dot on the left. */
const UNGUARDED = /(?<!‎)\.(3mf|stl|zip|svg|png|jpg|jpeg|webp|gcode|json)\b/i;

/** Every leaf string in a messages file, with its dotted key. */
export function leaves(obj: unknown, prefix = ""): [string, string][] {
  if (typeof obj === "string") return [[prefix, obj]];
  if (!obj || typeof obj !== "object") return [];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    leaves(v, prefix ? `${prefix}.${k}` : k),
  );
}

/** The keys in an RTL message file whose file extensions would render with the dot on the wrong side. */
export function unguardedExtensions(messages: unknown): string[] {
  return leaves(messages)
    .filter(([, v]) => ARABIC.test(v) && UNGUARDED.test(v))
    .map(([k]) => k);
}

test("every Arabic string writes a file extension with its dot marked left-to-right", () => {
  const ar = JSON.parse(readFileSync("messages/ar.json", "utf8"));
  assert.deepEqual(
    unguardedExtensions(ar),
    [],
    "these render as `3mf.` rather than `.3mf` in Arabic. Put a U+200E LEFT-TO-RIGHT MARK\n" +
      "immediately before the dot — it is invisible in the JSON and in the rendered page, and it is\n" +
      "the only thing keeping the dot on the correct side.",
  );
});

test("the guard detects the failure it exists for, and does not fire on the fix", () => {
  // Both halves matter. A check that never fires is indistinguishable from a passing one.
  assert.deepEqual(unguardedExtensions({ a: "أفلت ملف .3mf هنا" }), ["a"]);
  assert.deepEqual(unguardedExtensions({ a: `أفلت ملف ${LRM}.3mf هنا` }), []);
});

test("the guard is scoped to RTL, so English keeps writing extensions plainly", () => {
  // The mark is only load-bearing where the surrounding run is right-to-left. Requiring it in
  // English would put an invisible character into 900 strings for no reason, and the first person
  // to copy one into a filename would get a bug nobody could see.
  assert.deepEqual(unguardedExtensions({ a: "Drop a .3mf or .stl file here" }), []);
});

test("every locale is checked, not just the one that has the problem today", () => {
  // Arabic is the only RTL locale now. `ARABIC.test` is what decides, not the filename — so a
  // Hebrew or Persian locale added later is covered by this same assertion the day its file lands,
  // rather than by somebody remembering this file exists.
  for (const loc of ["en", "de", "es", "fr", "zh", "ja", "ar"]) {
    const m = JSON.parse(readFileSync(`messages/${loc}.json`, "utf8"));
    assert.deepEqual(unguardedExtensions(m), [], `messages/${loc}.json`);
  }
});
