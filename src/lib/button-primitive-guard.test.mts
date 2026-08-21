// Buttons use the primitives — `.btn-primary`, `.btn-secondary`, `.btn-affirm` — not a hand-rolled
// fill-plus-hover pair.
//
// This has regrown twice. globals.css records the first round: 74 sites carrying nine different
// px/py pairs for what were meant to be the same two buttons. By the time of this guard it was back
// to 27, and the drift that mattered was not the padding but `disabled:`, written as opacity-40,
// -50 and -60 against the primitive's 0.6 — the same button fading by different amounts depending on
// which screen you were on. Nothing catches that by looking; the two are never on screen together.
//
// The affirmative buttons were worse than inconsistent. All four failed AA — white on `green-600` is
// 3.22:1, and on `green-600/80` over a light surface 2.63:1, against the 4.5:1 that 11px and 14px
// text need — and every one hovered to `green-500`, i.e. LIGHTER, so the worst contrast was the
// state under the cursor. That is the specific mistake `whiteOnFailingGreen` below exists to stop
// coming back, since the fix is invisible: the button looks fine, it is just unreadable.
//
// Each rule needs BOTH halves to fire. A fill colour alone is legitimate: the notification count,
// the "new" badges, the two verified pills and the upload progress bar all use one and correctly
// have no hover, because they are not buttons. It is the pairing with the brand hover that means
// "someone rebuilt a primitive here". Alpha fills are excluded for the same reason —
// `hover:bg-violet-600/10` is the quiet secondary treatment, not a primary.
// Run: `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(full, out);
    else if (e.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/** `bg-violet-600` but not `bg-violet-600/80` — an alpha tint is a surface, not a button fill. */
const solid = (shade: string) => new RegExp(`\\bbg-${shade}(?![/\\w-])`);

const RULES: { primitive: string; fill: RegExp; hover: RegExp }[] = [
  { primitive: "btn-primary", fill: solid("violet-600"), hover: /\bhover:bg-violet-700\b/ },
  { primitive: "btn-affirm", fill: solid("emerald-700"), hover: /\bhover:bg-emerald-800\b/ },
];

/** The primitive this class string re-implements by hand, or null. */
export function handRolled(cls: string): string | null {
  for (const r of RULES) {
    if (r.fill.test(cls) && r.hover.test(cls) && !new RegExp(`\\b${r.primitive}\\b`).test(cls)) {
      return r.primitive;
    }
  }
  return null;
}

/** The exact combination that shipped unreadable: white on a green that cannot carry it. */
export function whiteOnFailingGreen(cls: string): boolean {
  return /\bbg-green-(500|600)(\/\d+)?\b/.test(cls) && /\btext-white\b/.test(cls);
}

test("no button re-implements a primitive by hand", () => {
  const hits: string[] = [];
  for (const f of walk("src")) {
    readFileSync(f, "utf8").split("\n").forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return; // comments quote these names when explaining the rule
      for (const m of line.matchAll(/className=[`"]([^"`]*)[`"]/g)) {
        const p = handRolled(m[1]);
        if (p) hits.push(`${f}:${i + 1} — should be .${p}`);
      }
    });
  }
  assert.deepEqual(hits, [], "each of these picks its own disabled opacity and radius:\n  " + hits.join("\n  "));
});

test("no white text on a green that cannot carry it", () => {
  const hits: string[] = [];
  for (const f of walk("src")) {
    readFileSync(f, "utf8").split("\n").forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      for (const m of line.matchAll(/className=[`"]([^"`]*)[`"]/g)) {
        if (whiteOnFailingGreen(m[1])) hits.push(`${f}:${i + 1}`);
      }
    });
  }
  assert.deepEqual(
    hits,
    [],
    "white on green-500/600 is 3.22:1 or worse — below the 4.5:1 small text needs. Use .btn-affirm " +
      "(emerald-700, 5.37:1):\n  " + hits.join("\n  "),
  );
});

test("the guards fire on what actually shipped, and not on what is fine", () => {
  // Verbatim from the buttons these replaced.
  assert.equal(handRolled("rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-40"), "btn-primary");
  assert.equal(handRolled("hidden rounded-md bg-violet-600 px-3 py-1.5 font-medium text-white transition hover:bg-violet-700 sm:inline-flex"), "btn-primary");
  assert.equal(handRolled("rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-800 disabled:opacity-60"), "btn-affirm");
  // The green that failed AA, in both the solid and the alpha form.
  assert.equal(whiteOnFailingGreen("rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500"), true);
  assert.equal(whiteOnFailingGreen("rounded-lg bg-green-600/80 px-3 py-1.5 text-sm font-medium text-white"), true);

  // Not buttons: a badge, the upload progress bar, and the two verified pills — all correctly hoverless.
  assert.equal(handRolled("rounded bg-violet-600 px-1.5 py-0.5 text-[10px] font-medium text-white"), null);
  assert.equal(handRolled("h-full rounded bg-violet-600 transition-all"), null);
  assert.equal(handRolled("inline-flex items-center gap-1 rounded-full bg-emerald-700 px-2 py-0.5 text-xs font-semibold text-white shadow-sm"), null);
  // Green as a tint behind green text is a different thing entirely, and passes.
  assert.equal(whiteOnFailingGreen("rounded-full bg-green-500/15 px-2 py-0.5 text-xs font-semibold text-green-300"), false);
  // The homepage's quiet secondary: a tint on hover, not a fill.
  assert.equal(handRolled("border border-violet-600/40 text-violet-300 hover:border-violet-600 hover:bg-violet-600/10"), null);
  // The primitives themselves never trip it.
  assert.equal(handRolled("btn-primary btn-xs mt-1 w-full"), null);
  assert.equal(handRolled("btn-affirm btn-md"), null);
});
