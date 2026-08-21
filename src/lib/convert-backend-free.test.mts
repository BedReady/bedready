// This repository must stay credential-free and backend-free.
// Run: `npm test`.
//
// ── WHY THIS IS THE MOST IMPORTANT TEST HERE ────────────────────────────────────────────────────
//
// Everything else in this repository is about producing correct files. This one is about the
// property that lets the repository be PUBLIC at all.
//
// The converter used to live in the same codebase as a design library, and every page carried a
// Supabase client. Carving it out removed all of that — no database, no auth, no keys. Nothing
// enforces that except this file. A single `import { createClient } from "@/lib/supabase/client"`
// added by someone solving a reasonable problem would put a project URL and an anon key into a
// public repository, and would make "nothing is uploaded" a harder sentence to say rather than an
// easier one.
//
// The version of this test in the upstream repository also asserted on a CORS helper that stayed
// with the library. This one is narrower and stricter, because here there is no backend to be
// careful about — there is simply none.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function sourceFiles(dir = "src"): string[] {
  let out: string[] = [];
  for (const e of readdirSync(dir)) {
    const f = join(dir, e);
    if (statSync(f).isDirectory()) out = out.concat(sourceFiles(f));
    else if (/\.(tsx?|mts)$/.test(f)) out.push(f);
  }
  return out;
}

test("the scan finds the source tree — an empty set would pass everything below", () => {
  assert.ok(sourceFiles().length > 50, `only ${sourceFiles().length} source files found`);
});

test("no file imports a database or auth client", () => {
  // Guard tests are skipped: this file names the forbidden import in prose to explain it, and a
  // check that cannot tell an explanation from a violation fails on its own documentation. It did,
  // on its first run.
  const offenders = sourceFiles()
    .filter((f) => !f.endsWith(".test.mts"))
    .filter((f) => /from ["']@\/lib\/supabase|from ["']@supabase\//.test(readFileSync(f, "utf8")));
  assert.deepEqual(
    offenders,
    [],
    "this repository is PUBLIC and ships no credentials. A Supabase client here puts a project URL " +
      "and anon key into it, and every fork writes to that project:\n  " + offenders.join("\n  "),
  );
});

test("package.json declares no database dependency", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  const bad = deps.filter((d) => /supabase|prisma|drizzle|pg$|mysql|mongo/.test(d));
  assert.deepEqual(bad, [], `a database dependency reappeared: ${bad.join(", ")}`);
});

test("no bare /api path in a fetch — every call goes through convertApi()", () => {
  // A bare path resolves to this deployment, which serves no API. It 404s in production and passes
  // every test, because in a test the two are the same origin.
  const offenders: string[] = [];
  for (const f of sourceFiles()) {
    if (f.endsWith("convert-api.ts")) continue;
    for (const m of readFileSync(f, "utf8").matchAll(/fetch\(\s*["'`](\/api\/[^"'`]*)/g)) {
      offenders.push(`${f} → fetch("${m[1]}")`);
    }
  }
  assert.deepEqual(offenders, [], "wrap it: fetch(convertApi(\"/api/…\")).\n  " + offenders.join("\n  "));
});

test("convert-api.ts pins the list of things this app asks a server for", () => {
  const src = readFileSync("src/lib/convert-api.ts", "utf8");
  const union = src.match(/export type ConvertApiPath =([^;]+);/);
  assert.ok(union, "ConvertApiPath is gone — nothing constrains what this app calls any more");
  const paths = [...union[1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!).sort();
  assert.deepEqual(
    paths,
    ["/api/convert", "/api/convert-count", "/api/report-conversion", "/api/waitlist"],
    "the backend dependency list changed. That is allowed, but it is a decision about how much an " +
      "open-source in-browser converter should need a server for — and the README states this list " +
      "to the people who trust it. Change both, deliberately.",
  );
});

test("the README's endpoint table matches the code", () => {
  // The claim in the README is the one users check the repository against. If the two drift, the
  // documentation is worse than none — it is a promise the code no longer keeps.
  const readme = readFileSync("README.md", "utf8");
  for (const p of ["/api/convert-count", "/api/report-conversion", "/api/convert", "/api/waitlist"]) {
    assert.ok(readme.includes(p), `README does not mention ${p}, which this app calls`);
  }
});
