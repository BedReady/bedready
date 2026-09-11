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

// ── THE HANDOFF THAT CROSSES ORIGINS ────────────────────────────────────────────────────────────
//
// Everything above this line watches the WRITE: every conversion producing a single file must call
// `stageConvertedFile`. That rule held perfectly while the thing it fed stopped working, because the
// READER moved to the other side of the 2026-08-21 carve and no test on either side saw the pair.
// Measured before the fix: convert on bedready.io, click "Save to my library", land on
// makerrun.com/upload, and the store reads null. IndexedDB is scoped to an origin.
//
// The bytes go through the tab now — `openLibraryWithHandoff` on the done screen,
// `receiveHandoffFromOpener` on /upload. These assert the properties that make that safe and that
// make it free when it does not fire.
import {
  HANDOFF_FILE,
  HANDOFF_READY,
  HANDOFF_TIMEOUT_MS,
  openLibraryWithHandoff,
  receiveHandoffFromOpener,
} from "./convert-handoff.ts";

const HANDOFF_SRC = readFileSync("src/lib/convert-handoff.ts", "utf8");
/** Comments stripped — the header explains the origin checks at length, and a scan that cannot tell
 *  an explanation from the code reports its own documentation. */
const HANDOFF_CODE = HANDOFF_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function bodyOf(name: string): string {
  const at = HANDOFF_CODE.indexOf(`export function ${name}`);
  assert.ok(at >= 0, `${name} is gone — this whole block is reading an empty string`);
  const rest = HANDOFF_CODE.slice(at);
  const end = rest.indexOf("\n}\n");
  return rest.slice(0, end === -1 ? rest.length : end);
}

// A `message` listener hears everything: extensions, embeds, other frames, anything that can reach
// a window handle. `event.origin` is the only thing that says who spoke, and it has to be consulted
// BEFORE the payload is touched — a check further down is a check that runs after the damage.
test("neither side reads a message before it has checked who sent it", () => {
  for (const fn of ["openLibraryWithHandoff", "receiveHandoffFromOpener"]) {
    const body = bodyOf(fn);
    const originAt = body.search(/e\.origin !== \w+/);
    assert.ok(originAt >= 0, `${fn} never compares event.origin — it will act on any message`);
    const dataAt = body.search(/e\.data/);
    assert.ok(dataAt >= 0, `${fn} does not read e.data at all — has the handshake moved?`);
    assert.ok(originAt < dataAt, `${fn} touches e.data before checking e.origin`);
  }
});

// postMessage's second argument is the only thing that stops a payload being delivered to whoever
// happens to be in that window. "*" would broadcast a visitor's model file to any site that managed
// to get itself navigated there.
test("nothing is ever posted to a wildcard origin", () => {
  const posts = [...HANDOFF_CODE.matchAll(/postMessage\([\s\S]*?\)/g)].map((m) => m[0]);
  assert.ok(posts.length >= 2, "expected a send on each side; found " + posts.length);
  for (const p of posts) {
    assert.ok(!/["'`]\*["'`]/.test(p), `postMessage to a wildcard origin: ${p.slice(0, 80)}`);
    assert.match(p, /,\s*\w*[Oo]rigin\s*\)/, `postMessage without a named target origin: ${p.slice(0, 80)}`);
  }
});

// The handoff is an accelerator, never a dependency — the rule the module has carried since it was
// written, now spanning two origins. A popup the browser blocked must leave the click to navigate
// normally, and an absent opener must cost one unheard message and nothing else.
test("it costs nothing when it cannot happen", () => {
  const open = bodyOf("openLibraryWithHandoff");
  assert.match(open, /if \(!w\) return null/, "a blocked popup must be reported so the caller can let the click through");
  const receive = bodyOf("receiveHandoffFromOpener");
  assert.match(receive, /if \(!opener\) return \(\) => \{\}/, "no opener must be a no-op, not a throw");
  // Both sides stop listening. A page that keeps a listener forever is a page that acts on a message
  // arriving long after the moment it belonged to.
  for (const fn of ["openLibraryWithHandoff", "receiveHandoffFromOpener"]) {
    assert.match(bodyOf(fn), /setTimeout\(stop, HANDOFF_TIMEOUT_MS\)/, `${fn} listens forever`);
    assert.match(bodyOf(fn), /removeEventListener\("message"/, `${fn} never detaches its listener`);
  }
  assert.ok(HANDOFF_TIMEOUT_MS >= 5_000 && HANDOFF_TIMEOUT_MS <= 60_000, "the window must fit a cold document, and end");
});

// Both halves must agree on the words, and they are in one module precisely so they cannot drift —
// which matters more here than usual, because the two halves ship from two repositories.
test("the two message names are distinct, namespaced and versioned", () => {
  assert.notEqual(HANDOFF_READY, HANDOFF_FILE);
  for (const k of [HANDOFF_READY, HANDOFF_FILE]) {
    assert.match(k, /^bedready:/, `${k} is not namespaced — it will collide with someone else's message`);
    assert.match(k, /\/\d+$/, `${k} carries no version — the two sites deploy separately and can be a release apart`);
  }
});

test("the sender and receiver exist as functions, not as intentions", () => {
  assert.equal(typeof openLibraryWithHandoff, "function");
  assert.equal(typeof receiveHandoffFromOpener, "function");
  // No window in node: both must answer rather than throw, which is also what a prerender does.
  assert.equal(openLibraryWithHandoff("https://example.com/upload", "https://example.com"), null);
  assert.equal(typeof receiveHandoffFromOpener("https://example.com", () => {}), "function");
});

// ── AND THE CLICK ITSELF ────────────────────────────────────────────────────────────────────────
//
// The done screen's link is the converter's single most important call to action, and it now does
// something before navigating. Two ways that could quietly cost more than it gains, both asserted
// here rather than remembered.
test("the share link still behaves like a link", () => {
  const src = readFileSync("src/components/ContributeToLibrary.tsx", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

  // A modified click belongs to the browser. Intercepting ⌘/ctrl/shift/alt or a middle button would
  // break open-in-new-tab, open-in-new-window and copy-link on the one link that matters most.
  assert.match(
    src,
    /if \(e\.metaKey \|\| e\.ctrlKey \|\| e\.shiftKey \|\| e\.altKey \|\| e\.button !== 0\) return;/,
    "the handler must hand a modified click straight back to the browser",
  );

  // preventDefault ONLY once a window is actually open. The other order — prevent, then try to open
  // — turns a blocked popup into a click that does nothing at all, which is worse than the empty
  // form it replaced.
  assert.match(src, /const w = openLibraryWithHandoff\(/, "the handoff must be attempted from the click");
  assert.match(src, /if \(w\) e\.preventDefault\(\);/, "a blocked popup must be allowed to navigate normally");
  const openAt = src.indexOf("openLibraryWithHandoff(");
  const preventAt = src.indexOf("e.preventDefault()");
  assert.ok(openAt < preventAt, "preventDefault runs before the window is known to exist");

  // The gesture is spent by an await. Opening the tab has to happen in the click's own task.
  const fn = src.slice(src.indexOf("function onShare"), src.indexOf("\n  }", src.indexOf("function onShare")));
  assert.ok(!/\bawait\b/.test(fn), "an await before window.open spends the user gesture and the popup is blocked");
});

// ── THE OTHER HALF OF THE ONLY MEASUREMENT THE BRIDGE HAS ───────────────────────────────────────
//
// The library counts arrivals that carry a file (`upload_handoff_received`). This side counts the
// clicks. The gap between the two IS the bridge's failure rate — blocked popups, severed openers,
// tabs closed mid-handshake — and it is the only way either domain can see it, because they share no
// analytics session.
//
// So the click event is load-bearing now, not just a funnel nicety: without it the library's number
// has no denominator and a drop in deliveries cannot be told from a drop in interest.
test("the share click is still counted, because it is the denominator", () => {
  const src = readFileSync("src/components/ContributeToLibrary.tsx", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(src, /track\("convert_to_library"/, "the done screen's click is no longer counted");
  // Before the early return, so a modified click — which opens the library just as surely, by the
  // browser's own route — is not silently dropped from the count.
  const trackAt = src.indexOf('track("convert_to_library"');
  const returnAt = src.indexOf("e.button !== 0) return;");
  assert.ok(trackAt >= 0 && returnAt >= 0 && trackAt < returnAt,
    "a modified click must still be counted — it reaches the library too, and dropping it would " +
      "understate the denominator exactly where the bridge cannot deliver");
});
