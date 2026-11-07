// bedready.io describes itself as bedready.io. Run: `npm test`.
//
// The converter layout's Organization JSON-LD carried MakerRun's description ("Machine-agnostic
// 3D-print files with slicer profiles checked by our server…") from before the split. This site has
// no file library and no server that checks anything, so search engines were told it was a
// different product.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("the converter's Organization description is BedReady's, not MakerRun's", () => {
  const src = readFileSync("src/app/[locale]/(converter)/layout.tsx", "utf8");
  const m = src.match(/const DESCRIPTION =\s*"([^"]+)"/);
  assert.ok(m, "DESCRIPTION is a string literal");
  const d = m[1];
  assert.doesNotMatch(d, /checked by our server|machine-agnostic 3D-print files|verified|library/i);
  assert.match(d, /in-browser/i);
  assert.match(d, /\.3mf/);
});
