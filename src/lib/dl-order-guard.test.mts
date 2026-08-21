// A `<dl>` must put the term before its definition. HTML requires it, and a screen reader uses the
// order to pair the two — reversed, the number announces with nothing tying it to its label.
//
// This is easy to get wrong because the DESIRED LAYOUT IS THE REVERSE OF THE REQUIRED MARKUP. Every
// stat block on this site wants the big number on top and its caption underneath, and writing
// `<dd>` then `<dt>` produces exactly that with no CSS. It looks right, so nothing draws attention
// to it. The fix is `flex-col-reverse` on the wrapper: correct order in the markup, desired order on
// screen.
//
// It shipped twice — the creator dashboard's totals and the /verified stat row — written months
// apart by the same hand, which is what a rule that needs a guard rather than a fix looks like.
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

/**
 * Returns true when a `<dd>` appears before any `<dt>` inside the block.
 *
 * Deliberately dumb: it reads tag order in source text, not a parsed tree. A `<dl>` whose items come
 * from a component this cannot see through is simply not checked — a miss, which costs nothing,
 * rather than a false positive, which would train someone to skip the failure.
 */
export function ddPrecedesDt(block: string): boolean {
  let seenDt = false;
  for (const m of block.matchAll(/<(dt|dd)\b/g)) {
    if (m[1] === "dd" && !seenDt) return true;
    if (m[1] === "dt") seenDt = true;
  }
  return false;
}

test("every <dl> puts its <dt> before its <dd>", () => {
  const hits: string[] = [];
  for (const f of walk("src")) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/<dl\b[\s\S]*?<\/dl>/g)) {
      if (ddPrecedesDt(m[0])) hits.push(`${f}:${src.slice(0, m.index).split("\n").length}`);
    }
  }
  assert.deepEqual(
    hits,
    [],
    "a <dd> before its <dt> — the value announces with nothing tying it to its label. Put the <dt> " +
      "first and add `flex-col-reverse` to the wrapper if the number should still sit on top:\n  " +
      hits.join("\n  "),
  );
});

test("the guard would actually catch the two that shipped", () => {
  // The creator dashboard's totals, as written.
  assert.equal(ddPrecedesDt('<div><dd className="text-2xl">{s.v}</dd><dt>{s.k}</dt></div>'), true);
  // And /verified's stat row.
  assert.equal(ddPrecedesDt('<dd className="text-3xl tabular-nums">{s.v}</dd><dt>{t(s.k)}</dt>'), true);
  // The corrected shape passes.
  assert.equal(ddPrecedesDt('<div className="flex flex-col-reverse"><dt>{s.k}</dt><dd>{s.v}</dd></div>'), false);
  // Several pairs in a row are fine.
  assert.equal(ddPrecedesDt("<dt>a</dt><dd>1</dd><dt>b</dt><dd>2</dd>"), false);
  // One good pair does not excuse a later bad one.
  assert.equal(ddPrecedesDt("<dt>a</dt><dd>1</dd><dd>2</dd>"), false); // multiple <dd> per <dt> is legal
  // A <dl> with no items at all is not a failure.
  assert.equal(ddPrecedesDt("<dl></dl>"), false);
});
