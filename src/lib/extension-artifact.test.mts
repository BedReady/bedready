// The extension zips the site hands out are built from this repository's source. Run: `npm test`.
//
// ── WHERE THE SOURCE LIVES ──────────────────────────────────────────────────────────────────────
//
// Until 2026-09-25 the extension's SOURCE lived in the private library repo (BedReady/makerrun) and
// only the built zips were here. That repo stopped carrying the converter, so the source moved here,
// next to the engine it inlines. This test came with it, unchanged in purpose.
//
// ── THE ENGINE HAS MORE THAN ONE CONSUMER ───────────────────────────────────────────────────────
//
// `extension/src/{content,popup,background}.ts` all import from `../../src/lib/convert`, esbuild
// inlines it, and the result is committed as `public/bedready-extension.zip` and
// `public/bedready-firefox.zip`. So a change to the engine stales the zips without touching
// `extension/` at all.
//
// That copy is frozen at whatever moment somebody last ran the build. Measured on 2026-09-11: the
// committed zips were built on 2026-08-22 and `src/lib/convert.ts` had changed EIGHT times since,
// including #280 — "Two deployments run one converter engine, and it had drifted both ways", the
// commit that created the drift watch. Rebuilding from source moved every bundle by ~4.8 KB.
//
// Nothing about the zip said so. `manifest.json` reads 0.3.0 before and after, because the version
// belongs to the extension and the drift was in a module it inlines — so the served file announced
// the same version while its engine was three weeks behind.
//
// ── WHY A BUILD-AND-COMPARE AND NOT A HASH IN A FILE ────────────────────────────────────────────
//
// A recorded hash is another thing to update by hand, and the hand is what failed. This builds the
// artifact from the tree and compares it with the committed one, so the only way to pass is for the
// committed file to be what this source produces.
//
// It is only possible because the build was made byte-reproducible in the same change — `zipSync`
// stamped entries with the clock, so three builds a minute apart produced three different files. See
// FIXED_MTIME in extension/build.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ZIPS = ["bedready-extension.zip", "bedready-firefox.zip"];

test("the committed extension zips are what this source builds", () => {
  const out = mkdtempSync(join(tmpdir(), "ext-artifact-"));
  // Built into a temp directory, NOT over the committed files: a check that overwrites the thing it
  // is checking passes by having just written the answer.
  execFileSync("node", ["extension/build.mjs"], {
    env: { ...process.env, EXT_OUT_DIR: out },
    stdio: "pipe",
  });

  for (const name of ZIPS) {
    const fresh = readFileSync(join(out, name));
    const committed = readFileSync(join("public", name));
    assert.ok(
      fresh.equals(committed),
      `public/${name} is not what extension/build.mjs produces from the current source ` +
        `(committed ${committed.length} bytes, fresh ${fresh.length}).\n` +
        "The extension inlines src/lib/convert.ts, so a change to the shared converter engine " +
        "stales this artifact without touching extension/ at all — which is exactly how it came to " +
        "be three weeks and eight commits behind. Run `npm run build:ext` and commit the result.",
    );
  }
});

/**
 * ── THE HALF-FIX THIS TEST EXISTS TO STOP COMING BACK ───────────────────────────────────────────
 *
 * The first attempt at reproducibility gave `zipSync` a fixed `mtime` and stopped there. Two builds
 * a second apart then matched, so it looked done — and CI failed on the very first run with
 * "committed 175641 bytes, fresh 175641": the same LENGTH and different bytes, differing at byte 12.
 *
 * fflate derives its DOS timestamp from the Date's LOCAL parts, so a fixed mtime is only fixed
 * within one timezone. The artifact was packed in Riyadh and checked in UTC. `build.mjs` pins
 * `process.env.TZ` now, and this varies the zone rather than only the clock, because a check that
 * builds twice in the same environment cannot see an environment-dependent build.
 */
test("the build is byte-reproducible — across time AND across timezones", () => {
  const outs = ["UTC", "Asia/Riyadh", "America/Los_Angeles"].map((tz) => {
    const dir = mkdtempSync(join(tmpdir(), "ext-repro-"));
    execFileSync("node", ["extension/build.mjs"], { env: { ...process.env, TZ: tz, EXT_OUT_DIR: dir }, stdio: "pipe" });
    return { tz, dir };
  });
  for (const name of ZIPS) {
    const first = readFileSync(join(outs[0]!.dir, name));
    for (const { tz, dir } of outs.slice(1)) {
      assert.ok(
        readFileSync(join(dir, name)).equals(first),
        `${name} built under ${tz} differs from one built under ${outs[0]!.tz}. The zip's DOS ` +
          "timestamp follows the LOCAL clock, so whoever commits the artifact bakes their own zone " +
          "into it and everyone else's check fails. build.mjs must pin process.env.TZ.",
      );
    }
  }
});

test("the extension really does inline the shared engine, which is why this file exists", () => {
  // If it ever stopped, the rule above would be guarding a dependency that no longer exists — and
  // the interesting half (a convert.ts change staling the zip) would have gone with it.
  const importers = ["content", "popup", "background"].filter((f) =>
    /from "\.\.\/\.\.\/src\/lib\/convert"/.test(readFileSync(`extension/src/${f}.ts`, "utf8")),
  );
  assert.deepEqual(importers, ["content", "popup", "background"],
    "the extension no longer imports the shared converter engine in every entry point");
  assert.ok(existsSync("src/lib/convert.ts"), "the engine the extension inlines lives in this repository");
});
