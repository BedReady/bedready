// The light-mode accent rule in globals.css matches EXACT utility classes — `html:not(.dark)
// .text-violet-300`. Tailwind emits an opacity modifier as a different class (`text-violet-300/80`
// → `.text-violet-300\/80`), which that selector does not match, so any accent text carrying an
// alpha silently keeps its dark-mode colour on a white page.
//
// That is not theoretical. `text-violet-300/80` on the design page's "More like this" row measured
// **1.62:1** in light mode — found only by auditing a real, populated page on a preview deployment,
// after four separate contrast sweeps had reported zero failures. The sweeps were honest; the pages
// they ran on were empty, and every fixture I wrote happened to use unmodified classes.
//
// So the rule is: accent TEXT never carries an opacity modifier. If something needs to be quieter,
// use a lower shade or `--fg-muted`/`--fg-subtle`, both of which are theme-aware by construction.
// Run: `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const HUES = "violet|sky|emerald|green|red|amber|yellow|rose|pink|purple|cyan|lime|blue|teal|indigo|orange|fuchsia";
/** e.g. `text-violet-300/80` — an accent text shade with an alpha. */
const PATTERN = `\\btext-(?:${HUES})-(?:50|100|200|300|400)/\\d+\\b`;
/** Fresh instances, never shared: a `/g` regex carries `lastIndex` between calls, so reusing one
 *  across assertions makes every other check fail. (This test caught exactly that in itself.) */
const scanner = () => new RegExp(PATTERN, "g");
const matcher = () => new RegExp(PATTERN);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(full, out);
    else if (e.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

test("accent text never carries an opacity modifier — it escapes the light-mode rule", () => {
  const hits: string[] = [];
  for (const f of walk("src")) {
    const src = readFileSync(f, "utf8");
    for (const line of src.split("\n")) {
      // Comments in this repo quote these class names when explaining the rule.
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
      for (const m of line.matchAll(scanner())) hits.push(`${f}: ${m[0]}`);
    }
  }
  assert.deepEqual(
    hits,
    [],
    "these keep their dark-mode colour on a white page — globals.css cannot match a class with an " +
      "alpha suffix:\n  " + hits.join("\n  "),
  );
});

test("the guard would actually catch the bug it was written for", () => {
  // The exact string that shipped, so a future refactor of the regex cannot quietly stop matching.
  assert.match("text-xs text-violet-300/80", matcher());
  assert.match("text-amber-100/80", matcher());
  // And does not fire on the forms that are fine.
  assert.doesNotMatch("text-violet-300", matcher());
  assert.doesNotMatch("bg-violet-400/10", matcher());
  assert.doesNotMatch("border-violet-400/30", matcher());
  assert.doesNotMatch("text-violet-600/80", matcher()); // 600 is dark enough in both themes
});
