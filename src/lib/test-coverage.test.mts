// Does the test script actually run every test file in the repo?
//
// It did not. `npm test` globbed `src/lib/*.test.mts`, which does not match subdirectories, so twelve
// tests under src/lib/api/ passed locally and were invisible to the suite — green CI on a suite that
// silently excluded a file. Then the first fix ("src/lib/**/*.test.mts", quoted) was passed through
// to the runner literally and could not be resolved at all, which at least failed loudly.
//
// A test script that omits tests is the same class of bug this project keeps finding: a check that
// reports success while measuring a smaller set than the one it is trusted to cover. So this asserts
// the script's patterns against what is actually on disk.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "src/lib";

function findTestFiles(dir: string, depth = 0): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...findTestFiles(full, depth + 1));
    else if (entry.endsWith(".test.mts")) out.push(full);
  }
  return out;
}

/** Expand the shell globs in the npm test script, without a shell. */
function matches(pattern: string, path: string): boolean {
  const rx = new RegExp(
    "^" + pattern.split("/").map((seg) => seg.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")).join("/") + "$",
  );
  return rx.test(path);
}

test("every test file on disk is covered by the npm test script", () => {
  const script = JSON.parse(readFileSync("package.json", "utf8")).scripts.test as string;
  const patterns = script.split(/\s+/).filter((a) => a.includes("*.test.mts"));
  assert.ok(patterns.length, `no glob patterns found in test script: ${script}`);

  const files = findTestFiles(ROOT);
  assert.ok(files.length > 1, "expected to find test files");

  const missed = files.filter((f) => !patterns.some((p) => matches(p, f)));
  assert.deepEqual(
    missed,
    [],
    `these test files exist but the npm test script would not run them:\n  ${missed.join("\n  ")}\n` +
      `script: ${script}\nAdd a pattern that covers them.`,
  );
});

test("the script's patterns do not rely on globstar, which CI's shell did not expand", () => {
  const script = JSON.parse(readFileSync("package.json", "utf8")).scripts.test as string;
  assert.ok(!script.includes("**"), "`**` was passed to the runner literally on CI and matched nothing");
});
