// The origin module is the only place that decides which host owns a path.
// Run: `npm test`.
//
// ── WHAT THIS PROTECTS ──────────────────────────────────────────────────────────────────────────
//
// `https://bedready.io` was hardcoded in 64 places across 30 files behind SEVEN separate constants,
// only one of which read an environment variable. That was survivable while the site was one
// origin; it stops being survivable when the library moves to `makerrun.com`, because then the
// right origin depends on the path (`docs/SPLIT-DECISION-2026-08.md`).
//
// Two things have to keep holding, and neither is visible in any single file:
//
//   1. **The converter route list matches the filesystem.** `origin.ts` runs in the browser and on
//      the edge, so it cannot `readdirSync` the route group — the list must be static, and a static
//      list of routes is exactly the thing that goes stale. This test is what makes it not stale.
//   2. **Nobody reintroduces a literal.** The seven constants did not arrive by decision; each was
//      one person needing an origin in a file that did not have one. Nothing stops an eighth except
//      a check.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { CONVERTER_ROUTES, CONVERTER_ORIGIN, LIBRARY_ORIGIN, originFor, absoluteUrl } from "./origin.ts";

const CONVERTER_GROUP = "src/app/[locale]/(converter)";

test("CONVERTER_ROUTES matches the (converter) route group on disk", () => {
  const onDisk = readdirSync(CONVERTER_GROUP)
    .filter((d) => statSync(join(CONVERTER_GROUP, d)).isDirectory())
    .sort();
  assert.deepEqual(
    [...CONVERTER_ROUTES].sort(),
    onDisk,
    "the converter's routes and origin.ts have drifted apart. A route in the group but not in the " +
      "list gets the LIBRARY's origin — so after the split its canonical tag, OpenGraph url and " +
      "share links all name the wrong domain, on a page that otherwise works perfectly.",
  );
});

test("a converter path resolves to the converter origin, at every locale", () => {
  assert.equal(originFor("/convert"), CONVERTER_ORIGIN);
  assert.equal(originFor("/guides/fix-geometry-only-snapmaker-orca"), CONVERTER_ORIGIN);
  // The locale prefix must not change the owner. Without stripping it, every non-English converter
  // URL would be attributed to the library — six locales' canonicals pointing at the wrong domain,
  // and only after the split, when there is a wrong domain to point at.
  for (const l of ["de", "es", "fr", "zh", "ja", "ar"]) {
    assert.equal(originFor(`/${l}/convert`), CONVERTER_ORIGIN, `/${l}/convert went to the library`);
  }
});

test("everything else, including the homepage, resolves to the library origin", () => {
  for (const p of ["/", "/designs", "/upload", "/account", "/verified", "/de/designs"]) {
    assert.equal(originFor(p), LIBRARY_ORIGIN, `${p} did not resolve to the library`);
  }
});

test("a two-letter path segment that is not a locale is not mistaken for one", () => {
  // `/ar` is Arabic, but a route could plausibly be named with two letters. The guard is that only
  // the known locale list is stripped — anything else is a real first segment.
  assert.equal(originFor("/xy/convert"), LIBRARY_ORIGIN, "an unknown 2-letter prefix was stripped");
});

test("absoluteUrl normalises the way canonical tags need", () => {
  // A trailing slash makes locale alternates `/de/`, which 308-redirect — canonical and hreflang
  // must name the final 200 URL.
  assert.equal(absoluteUrl("/"), LIBRARY_ORIGIN);
  assert.equal(absoluteUrl("/designs/"), `${LIBRARY_ORIGIN}/designs`);
  assert.equal(absoluteUrl("/convert"), `${CONVERTER_ORIGIN}/convert`);
});

test("no module outside origin.ts hardcodes the production origin in code", () => {
  const offenders: string[] = [];
  const skip = new Set(["src/lib/origin.ts"]);

  function walk(dir: string) {
    for (const e of readdirSync(dir)) {
      const full = join(dir, e);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(full) || /\.test\.mts$/.test(full) || skip.has(full)) continue;
      readFileSync(full, "utf8")
        .split("\n")
        .forEach((line, i) => {
          // Comments and prose are fine — this is about generated URLs. So is `docs.bedready.io`,
          // which is a distinct host handled by `docs-site.ts`, and `@bedready.io`, an email domain.
          const code = line.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "");
          if (/https:\/\/bedready\.io/.test(code)) offenders.push(`${full}:${i + 1}`);
        });
    }
  }
  walk("src");

  assert.deepEqual(
    offenders,
    [],
    "use `absoluteUrl(path)`, or CONVERTER_ORIGIN / LIBRARY_ORIGIN from @/lib/origin. Seven separate " +
      "constants grew this way, one file at a time, and after the split each one is a URL naming the " +
      "wrong domain:\n  " + offenders.join("\n  "),
  );
});
