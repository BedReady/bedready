import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * The converter engine exists twice: in TypeScript here, and in plain JS inside the
 * Bed Ready / Khayt desktop app (KhaytApp/Khayt `lib/`). Improvements have been ported
 * BOTH directions by hand — website→app in that repo's #367, app→web in this repo's #31 —
 * and nothing has ever checked that the two still agree.
 *
 * That is the actual risk. Not that they are duplicated (they are, and merging them is a
 * separate, larger job — see docs/CONVERTER-CORE-EXTRACTION.md in the app repo), but that
 * they can drift APART SILENTLY and hand the same user different answers depending on
 * whether they used the website or the app. There is no error, no warning, and no test
 * that would notice.
 *
 * This runs both implementations over identical inputs and fails when they disagree. It
 * moves no code and is worth having even if the extraction never happens.
 *
 * WHERE THE APP SOURCE COMES FROM: set KHAYT_LIB to the app repo's `lib/` directory.
 * Without it the test SKIPS rather than fails — a contributor who has only cloned the
 * website should not get a red build for a repo they do not have. CI passes the path
 * explicitly (see .github/workflows), so the check genuinely runs there rather than
 * quietly skipping forever, which would be worse than not having it.
 */

function findAppLib(): string | null {
  const candidates = [
    process.env.KHAYT_LIB,
    path.join(os.homedir(), "Khayt", "Khayt", "lib"),
    path.join(os.homedir(), "khayt", "lib"),
  ].filter(Boolean) as string[];
  // Require EVERY file the tests load, not just the first. A directory holding some of them
  // would otherwise pass this check and then fail deep inside loadApp with a confusing
  // ENOENT, turning "the app repo isn't here" into what looks like a parity break.
  const needed = ["color-mix.js", "color-bands.js"];
  for (const c of candidates) {
    if (needed.every((f) => fs.existsSync(path.join(c, f)))) return c;
  }
  return null;
}

const APP_LIB = findAppLib();
const skip = APP_LIB
  ? false
  : "app lib not found — set KHAYT_LIB=/path/to/Khayt/lib to run the engine parity check";

/**
 * The app's modules are browser globals with a CommonJS fallback:
 *   global.KhaytColor = ...   /   global.KhaytColorBands = ...
 * Evaluating the file is enough to expose them, so no build step or import shim is needed.
 */
function loadApp(file: string, globalName: string): any {
  const code = fs.readFileSync(path.join(APP_LIB!, file), "utf8");
  new Function(code)();
  return (globalThis as any)[globalName];
}

const HEXES = ["#DA2618", "#F1F2FE", "#000000", "#FFFFFF", "#FFFF00", "#3355AA", "#22CC88", "#7F3F1F", "#C0FFEE", "#123456"];

test("colour maths agrees between the website and the app", { skip }, async () => {
  const web = await import("./color-mix.ts");
  const app = loadApp("color-mix.js", "KhaytColor");

  // Same public surface. A function appearing on one side only is drift in its own right:
  // it means one product grew a capability the other silently lacks.
  const webNames = ["blend", "ciede2000", "deltaE", "gradient", "hexToLab", "hexToRgb", "nearest", "rgbToHex", "rgbToLab"];
  for (const n of webNames) {
    assert.equal(typeof (web as any)[n], "function", `website is missing ${n}`);
    assert.equal(typeof app[n], "function", `app is missing ${n} — the two engines have diverged in surface`);
  }

  let compared = 0;
  for (const a of HEXES) {
    for (const b of HEXES) {
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        assert.equal(
          String((web as any).blend(a, b, t)).toLowerCase(),
          String(app.blend(a, b, t)).toLowerCase(),
          `blend(${a}, ${b}, ${t}) differs`,
        );
        compared++;
      }
      // ΔE drives which filament the converter picks, so a disagreement here changes the
      // colours a user is told to load — the most user-visible thing in this file.
      const wd = (web as any).deltaE(a, b), ad = app.deltaE(a, b);
      assert.ok(Math.abs(wd - ad) < 1e-9, `deltaE(${a}, ${b}) differs: web=${wd} app=${ad}`);
      compared++;
    }
    assert.deepEqual(
      (web as any).nearest(a, HEXES.slice(0, 4)),
      app.nearest(a, HEXES.slice(0, 4)),
      `nearest(${a}) differs`,
    );
    compared++;
  }
  assert.ok(compared >= 600, `expected a broad sweep, only compared ${compared}`);
});

test("band detection agrees between the website and the app", { skip }, async () => {
  const web = await import("./color-bands.ts");
  const app = loadApp("color-bands.js", "KhaytColorBands");

  // A stack of triangles climbing in Z, coloured in horizontal bands — the shape this
  // function exists to recognise (a model printable with filament swaps instead of an AMS).
  function mesh(faces: number, bands: number) {
    const pos = new Float32Array(faces * 9);
    const st = new Uint8Array(faces);
    for (let f = 0; f < faces; f++) {
      const z = (f / faces) * 10;
      for (let v = 0; v < 3; v++) {
        pos[f * 9 + v * 3] = v;
        pos[f * 9 + v * 3 + 1] = v * 0.5;
        pos[f * 9 + v * 3 + 2] = z;
      }
      st[f] = Math.floor((f / faces) * bands);
    }
    return { pos, st };
  }

  let compared = 0;
  for (const faces of [30, 120, 600]) {
    for (const bands of [1, 2, 3, 4, 6]) {
      for (const binHeight of [0.2, 0.5, 1]) {
        const { pos, st } = mesh(faces, bands);
        assert.deepEqual(
          (web as any).detectColorBands(pos, st, 0, { binHeight }),
          app.detectColorBands(pos, st, 0, { binHeight }),
          `detectColorBands differs at faces=${faces} bands=${bands} binHeight=${binHeight}`,
        );
        compared++;
      }
    }
  }
  assert.equal(compared, 45);
});
