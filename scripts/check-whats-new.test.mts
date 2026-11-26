// The "every user-visible PR adds a What's new line" check. Run: `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isUserVisible, optedOut, verdict, DATA_FILE } from "./check-whats-new.mjs";

test("user-visible: pages, components, engine, extension and translations; not tests, scripts or docs", () => {
  for (const p of ["src/app/[locale]/(converter)/convert/page.tsx", "src/components/SiteFooter.tsx", "src/lib/convert.ts", "src/lib/u1-profile.json", "extension/src/background.ts", "extension/manifest.json", "messages/de.json"]) {
    assert.ok(isUserVisible(p), p);
  }
  for (const p of ["src/lib/convert.test.mts", "scripts/slicer-golden.mjs", "README.md", ".github/workflows/ci.yml", "e2e/convert.spec.ts", "extension/STORE-LISTING.md", DATA_FILE]) {
    assert.ok(!isUserVisible(p), p);
  }
});

test("a user-visible PR passes with an entry, or with \"What's new: none\", and fails with neither", () => {
  const files = ["src/lib/convert.ts"];
  assert.equal(verdict({ files: [...files, DATA_FILE] }).ok, true);
  assert.equal(verdict({ files, body: "Refactor.\n\nWhat's new: none\n" }).ok, true);
  assert.equal(verdict({ files, body: "What’s new: none — internal only" }).ok, true, "a curly apostrophe counts");
  const v = verdict({ files, body: "Fixes the thing." });
  assert.equal(v.ok, false);
  assert.match(v.why, /src\/lib\/whats-new\.ts/);
});

test("the opt-out is a line of its own, not a phrase buried in prose", () => {
  assert.equal(optedOut("We discussed whether What's new: none applies here"), false);
  assert.equal(optedOut(undefined), false);
});

test("PRs with nothing user-visible, and bot PRs, pass without an entry", () => {
  assert.equal(verdict({ files: ["src/lib/convert.test.mts", "README.md"] }).ok, true);
  assert.equal(verdict({ files: ["src/lib/convert.ts"], author: "dependabot[bot]" }).ok, true);
});
