// A .3mf is an untrusted zip, and fflate's unzipSync inflates whatever an entry's stream holds, however
// small its header says it is. Every inflation goes through boundedUnzip (safeUnzip, or
// boundedUnzipOrThrow where the compressed-size cap must not apply). plates.ts once called unzipSync
// directly on a file safeUnzip had just refused (Nov 2026 review); this keeps it from coming back.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

// entrySizes reads headers only: its filter returns false for every entry, so nothing is inflated.
const ALLOWED = new Set(["plates.ts:entrySizes"]);

test("no source file inflates a zip with unzipSync", () => {
  const dirs = ["src/lib", "extension/src"];
  const found: string[] = [];
  for (const dir of dirs) {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".ts") || f.includes(".test.")) continue;
      const src = readFileSync(`${dir}/${f}`, "utf8");
      for (const m of src.matchAll(/\bunzipSync\(/g)) {
        const before = src.slice(0, m.index);
        const fn = [...before.matchAll(/function (\w+)/g)].pop()?.[1] ?? "?";
        if (!ALLOWED.has(`${f}:${fn}`)) found.push(`${dir}/${f} in ${fn}()`);
      }
    }
  }
  assert.deepEqual(found, [], "use boundedUnzipOrThrow / safeUnzip instead");
});
