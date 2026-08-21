// Every JSON-LD block on the site must escape for `<script>` embedding. Run: `npm test`.
//
// ── THE AUDIT THAT PRODUCED THIS ─────────────────────────────────────────────────────────────────
//
// 2026-08-12, sweeping every `dangerouslySetInnerHTML` in the app: **21 sinks, 15 of them passing raw
// `JSON.stringify`**. Nothing was exploitable — the only two blocks carrying user-controlled data,
// the design page and /verified, were among the six that did escape. The other fifteen were safe
// because their data happened to be static.
//
// "Happens to be static" is not a security property. The escaping had been implemented THREE times —
// two copies of a local `ldJson` in different files, one inline chain in /verified — so the rule
// existed in the codebase without existing anywhere a new page would inherit it.
//
// ── AND THE CSP IS EXPLICITLY RELYING ON IT ──────────────────────────────────────────────────────
//
// `next.config.mjs` keeps `script-src 'unsafe-inline'` on purpose, because nonces would force every
// page dynamic and break ISR. The comment justifying that says the policy is enough "given the
// stored-XSS sinks are escaped". This test is what makes that clause true. If it ever fails, the
// documented reasoning behind the CSP has quietly stopped holding.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ldJson } from "./json-ld.ts";

function tsxFiles(dir = "src"): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsxFiles(full));
    else if (full.endsWith(".tsx") && !full.includes(".test.")) out.push(full);
  }
  return out;
}

test("ldJson makes a </script> breakout impossible to express", () => {
  // The actual attack: a design title containing a closing tag.
  const evil = { name: '</script><script>alert(1)</script>', bio: "a & b < c > d" };
  const out = ldJson(evil);
  assert.ok(!out.includes("</script"), "a raw closing tag survived — this is the whole bug");
  assert.ok(!out.includes("<"), "no bare < may survive");
  assert.ok(!out.includes(">"), "no bare > may survive");
  assert.ok(!out.includes("&"), "no bare & may survive");
  // Still valid JSON, and still the same data once parsed — escaping must not corrupt the payload.
  assert.deepEqual(JSON.parse(out), evil);
});

test("raw JSON.stringify would NOT be safe, which is why this module exists", () => {
  // Pins the premise. If a future JS runtime started escaping these, this test says so loudly
  // rather than leaving a module in place for a reason that no longer applies.
  const raw = JSON.stringify({ name: "</script>" });
  assert.ok(raw.includes("</script>"), "JSON.stringify is expected to leave the tag intact");
});

test("every JSON-LD block in the app goes through the shared helper", () => {
  const offenders: string[] = [];
  let sinks = 0;

  for (const file of tsxFiles()) {
    const src = readFileSync(file, "utf8");
    if (!src.includes("application/ld+json")) continue;
    // Each ld+json script element and the expression feeding its __html.
    const rx = /application\/ld\+json"[\s\S]{0,120}?__html:\s*([A-Za-z0-9_$.]+)\s*\(?/g;
    for (let m = rx.exec(src); m; m = rx.exec(src)) {
      sinks++;
      const expr = m[1];
      // Either a direct ldJson(...) call, or a variable — in which case that variable must have been
      // assigned from ldJson somewhere in the file.
      const direct = expr === "ldJson";
      const viaVar = new RegExp(`(?:const|let)\\s+${expr}\\s*=\\s*ldJson\\(`).test(src);
      if (!direct && !viaVar) offenders.push(`${file}: __html fed by \`${expr}\``);
    }
  }

  // Floor recalibrated for this repository. It was 15, counted against the combined site, where the
  // design, guide and breadcrumb blocks on the library's pages made up most of the surface. Those
  // pages are MakerRun's now and the converter carries 12. The number is a guard against the scan
  // silently finding NOTHING and passing — it is not a target, so it tracks what is actually here.
  assert.ok(sinks >= 10, `expected to find the JSON-LD surface, found ${sinks} sinks`);
  assert.deepEqual(
    offenders,
    [],
    "a JSON-LD block is not escaped — `</script>` in any string value breaks out and executes",
  );
});

test("the escaping is defined once, not copied back into pages", () => {
  // The failure mode that produced the original 15: a local helper, so the rule lives in a file
  // rather than in the app. A page defining its own is how the two drift apart again.
  const copies = tsxFiles().filter((f) => /function\s+ldJson\s*\(/.test(readFileSync(f, "utf8")));
  assert.deepEqual(copies, [], "ldJson must be imported from @/lib/json-ld, never redefined in a page");

  // And no page should be hand-rolling the escape chain either.
  const inline = tsxFiles().filter((f) => readFileSync(f, "utf8").includes("\\\\u003c"));
  assert.deepEqual(inline, [], "an inline \\u003c escape chain is a third copy of the same rule");
});
