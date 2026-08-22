// Every conversion that produces ONE file must hand that file to /upload.
//
// ── WHY THIS IS A TEST ──────────────────────────────────────────────────────────────────────────
//
// `lib/convert-handoff.ts` states the rule in its own docstring:
//
//     Called by /convert the moment a conversion produces A SINGLE DOWNLOADABLE FILE.
//
// On 2026-08-15 the converter had SIX paths that call `download()` and exactly one called
// `stageConvertedFile`. Three of the five misses produced a single model file and should have staged
// it — and the third was found by this test rather than by reading, which is the argument for it:
//
//   · the SERVER convert — the fallback for files too big for the tab, so the largest models, the
//     ones most worth having in a library
//   · 3MF → STL — `design_files.file_type` accepts stl and /upload takes it
//   · `wrapStl` (STL → 3MF) — a clean core-spec 3MF, the library's PREFERRED format. This one was
//     missed twice over: it never sets status to "done" either, so the done screen and its invitation
//     to the library are never shown for it at all. The window that motivated this work recorded
//     `stl_to_3mf` for 5 visitors, none of whom were ever asked.
//
// The symptom was invisible from the converter: everything succeeded, the file downloaded, and the
// visitor who then clicked "Save to my library" landed on an EMPTY form and was asked to go and find
// the file in their downloads folder. The handoff module's whole purpose — quoting itself again —
// is that "every step between wanting to share and having shared is a place to give up, and this one
// existed for no reason at all."
//
// The other two paths (split, batch) produce ZIP ARCHIVES of many parts. They are correctly not
// staged, and this test must not ask them to be — flagging them would teach the next person to
// silence it rather than read it.
//
// ── THE CALL IT WATCHES MOVED, AND THAT IS AN IMPROVEMENT ───────────────────────────────────────
//
// `/convert` now hands every finished file over through `deliver()`, a single function that records
// the result before calling `download()` — so the done screen can name the file, show its size and
// offer it a second time, none of which it could do while the bytes lived only inside the function
// that made them.
//
// That renaming tripped this test's own detector-rot assertion on the first run, which is the
// behaviour it was written for. The rule is unchanged and the guard is now stronger: `deliver` is a
// choke point, so `download()` outside it is itself a finding — and the last test below says so,
// with the one legitimate exception spelled out rather than assumed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

//  is a library helper the carve did not bring across, and this repository has exactly one
// route group, so the path is a literal rather than a lookup.
const PAGE = "src/app/[locale]/(converter)/convert/page.tsx";

/**
 * A `download(...)` call and the filename expression handed to it.
 *
 * Matching the ARGUMENT rather than the surrounding function is what makes this robust: the rule is
 * about what the call produces, and the filename is where that is decided.
 */
/** A CALL to `deliver(...)` — never its declaration, which the same shape otherwise matches. */
const DELIVER = /(?<!function )\bdeliver\(\s*([^;]*?)\)\s*;/g;
/** Every `download(...)`, including the ones inside `deliver` itself. */
const DOWNLOAD = /\bdownload\(\s*([^;]*?)\)\s*;/g;

test("every single-file download is staged for /upload", () => {
  const src = readFileSync(PAGE, "utf8");
  const lines = src.split("\n");

  const calls = [...src.matchAll(DELIVER)].map((m) => ({
    args: m[1],
    line: src.slice(0, m.index).split("\n").length,
  }));

  // Detector rot: if this stops finding the calls it passes for the wrong reason, exactly as the
  // stat-kinds guard did before it was rewritten.
  assert.ok(calls.length >= 4, `expected at least 4 deliver() calls in ${PAGE}, found ${calls.length}`);

  const unstaged: string[] = [];
  for (const c of calls) {
    // A .zip is an archive of many parts, not one model. /upload has nothing to do with it.
    if (/\.zip/i.test(c.args)) continue;

    // The window is deliberately generous, and the first version was not: at ±8 lines it failed a
    // path that stages correctly, because an explanatory comment sat between the two calls. A guard
    // that punishes people for writing down WHY teaches them to delete the comment. Wide enough to
    // survive prose, still local enough that an unrelated stage elsewhere in a 2,000-line file
    // cannot satisfy it.
    const near = lines.slice(Math.max(0, c.line - 10), c.line + 22).join("\n");
    if (!/stageConvertedFile\s*\(/.test(near)) {
      unstaged.push(`${PAGE}:${c.line} — deliver(${c.args.trim().slice(0, 60)}…)`);
    }
  }

  assert.deepEqual(
    unstaged,
    [],
    "these conversion paths hand the visitor a single file and do NOT stage it for /upload — so " +
      "clicking through from the done screen lands on an empty form and asks them to go and find it " +
      "in their downloads folder, which is the one thing lib/convert-handoff exists to prevent",
  );
});

test("the ZIP paths are deliberately excluded, and there are some", () => {
  // The exclusion above is load-bearing: without it this test would demand that batch and split stage
  // an archive. Asserting the archives EXIST stops the exclusion quietly becoming dead code that
  // hides a real miss the day a path stops producing a zip.
  const src = readFileSync(PAGE, "utf8");
  const zips = [...src.matchAll(DELIVER)].filter((m) => /\.zip/i.test(m[1]));
  assert.ok(zips.length >= 2, `expected the batch and split paths to still download archives, found ${zips.length}`);
});

test("nothing hands over a file behind deliver()'s back", () => {
  // `deliver` is what makes the done screen able to name the file and offer it again. A path that
  // calls `download()` directly still works and still downloads — and silently produces the state
  // this whole screen was rebuilt to remove: a conversion finished, and a screen that cannot say
  // which file it produced.
  //
  // The one legitimate direct call is the re-download control, which hands over the file `deliver`
  // already recorded. It is recognisable by its argument naming that record, not by its line number.
  const src = readFileSync(PAGE, "utf8");
  const lines = src.split("\n");
  const stray: string[] = [];
  for (const m of src.matchAll(DOWNLOAD)) {
    const line = src.slice(0, m.index).split("\n").length;
    // Prose quotes these names when explaining the rule — the same exemption the other guards in
    // this repository carry, and for the same reason: a check that punishes writing down WHY
    // teaches people to delete the comment.
    if (/^\s*(\/\/|\*|\/\*)/.test(lines[line - 1] ?? "")) continue;
    if (/\bresult\./.test(m[1])) continue; // re-handing the recorded result
    const near = lines.slice(Math.max(0, line - 8), line).join("\n");
    if (/function deliver\b/.test(near)) continue; // the choke point's own call
    stray.push(`${PAGE}:${line} — download(${m[1].trim().slice(0, 60)}…)`);
  }
  assert.deepEqual(
    stray,
    [],
    "these call download() directly, so the file they produce is never recorded — the done screen " +
      "cannot name it, size it, or offer it again. Call deliver() instead.",
  );
});
