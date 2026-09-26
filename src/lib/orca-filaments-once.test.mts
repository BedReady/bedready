// The filament index renders its browser exactly once. Run: `npm test`.
//
// #4 ported the design review's page and left <OrcaFilaments /> in twice. Nothing failed: both
// copies worked, so the page simply carried the whole catalogue two times, two search boxes and
// 2,542 download buttons for 1,271 profiles, 164,000px tall on a desktop and 486,000px on a phone.
// Found in the 2026-09-26 UI review, not by any test. This is that test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("/orca-filaments renders <OrcaFilaments /> once", () => {
  const src = readFileSync("src/app/[locale]/(converter)/orca-filaments/page.tsx", "utf8").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  assert.equal((src.match(/<OrcaFilaments\b/g) ?? []).length, 1);
});
