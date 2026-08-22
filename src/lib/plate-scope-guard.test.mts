// One rule, asserted over the whole tree: a plate-sensitive analysis is never handed a whole file.
//
// ── WHY THIS IS A TEST ──────────────────────────────────────────────────────────────────────────
// paint.ts applies every build-item transform, so mesh.positions holds the project's LAYOUT — a
// four-plate job spans about two bed-widths. Two separate analyses independently assumed those
// vertices described one model, and neither looked wrong while being written:
//
//   • the bed-fit check told someone their "model is 454×516×49 mm" when every part fit
//   • band detection returned a confident swap height belonging to whichever plate had the most
//     area, and convert.ts rewrote the output file around it
//
// Both were one line reading `mesh.positions`. The fix was per-plate grouping (lib/print-groups.ts),
// but grouping only helps the callers that remember it exists, and the next analysis that wants
// geometry will reach for the same obvious field. So the rule is asserted here instead of hoped for.
//
// If you're adding a genuinely plate-insensitive analysis, add it to PLATE_INSENSITIVE below with
// the reason — overhangReport is there because face normals don't change when a plate is moved.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.mts$/.test(e.name)) out.push(full);
  }
  return out;
}

/** Analyses whose answer changes when parts sit at different places on (or across) the bed. */
const PLATE_SENSITIVE = ["detectColorBands"];

/** Exempt, with the reason it's exempt. */
const PLATE_INSENSITIVE: Record<string, string> = {
  overhangReport: "per-face normals — invariant under the translation that separates plates",
};

const sources = [...walk("src")].filter((f) => !f.endsWith("print-groups.ts"));

test("no plate-sensitive analysis is called with a whole file's geometry", () => {
  const offences: string[] = [];
  for (const file of sources) {
    readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      if (line.trimStart().startsWith("//") || line.trimStart().startsWith("*")) return;
      for (const fn of PLATE_SENSITIVE) {
        // The whole-file form is `fn(mesh.positions, …)`; the per-plate form takes the mesh itself.
        if (new RegExp(`\\b${fn}\\s*\\(\\s*(\\w+\\.)?positions\\b`).test(line)) {
          offences.push(`${file}:${i + 1}  ${line.trim()}`);
        }
      }
    });
  }
  assert.deepEqual(
    offences,
    [],
    "these call a plate-sensitive analysis with a whole file's vertices — a multi-plate project will\n" +
      "measure the layout instead of the model. Use the per-mesh entry point (detectColorBandsForMesh),\n" +
      "or group with printGroups() from lib/print-groups.ts:\n  " + offences.join("\n  "),
  );
});

test("nothing aliases the aggregate vertex array to scan it", () => {
  // The bed-fit bug's exact shape: bind the whole file's vertices to a local, then stride it.
  //
  //     const p = mesh.positions;
  //     for (let i = 0; i < p.length; i += 3) { ... }
  //
  // Matching that alias is deliberately narrow. A looser heuristic — "a file containing both
  // mesh.positions and an `i += 3` loop" — was tried first and immediately flagged centerXY() in
  // convert/page.tsx, which is correct code that already iterates one group at a time. A guard that
  // fails on correct code gets deleted, so this one only fires on the pattern that was actually
  // wrong. Reading `.length`, or handing the array to a renderer, is untouched.
  const offences: string[] = [];
  for (const file of sources) {
    readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      if (line.trimStart().startsWith("//") || line.trimStart().startsWith("*")) return;
      if (/(?:const|let|var)\s+\w+\s*=\s*\w+\.positions\s*;/.test(line) && !/\bparts?\b|\bplate/.test(line)) {
        offences.push(`${file}:${i + 1}  ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(
    offences,
    [],
    "this aliases a whole file's vertices to scan them; on a multi-plate project that measures the\n" +
      "layout. Iterate printGroups(mesh) from lib/print-groups.ts instead:\n  " + offences.join("\n  "),
  );
});

test("the exemption list explains itself", () => {
  // A bare name on the exempt list is how a real bug gets waved through later.
  for (const [fn, why] of Object.entries(PLATE_INSENSITIVE)) {
    assert.ok(why.length > 20, `${fn} is exempt without a reason anyone can check`);
  }
});

test("the guard is pointed at real code", () => {
  // A typo'd path or an over-narrow filter would make every assertion above pass vacuously.
  assert.ok(statSync("src/lib/print-groups.ts").isFile(), "the grouping module this rule points to must exist");
  assert.ok(sources.length > 50, `expected to scan the tree, scanned ${sources.length} files`);
  assert.ok(
    sources.some((f) => f.endsWith("convert.ts")),
    "convert.ts is where the wrong band plan reached the output file — it must be in scope",
  );
  // And the detector must actually fire on the shape it's meant to catch.
  const badCall = "  bandPlan = detectColorBands(mesh.positions, mesh.faceState, mesh.baseState);";
  assert.ok(
    new RegExp(`\\bdetectColorBands\\s*\\(\\s*(\\w+\\.)?positions\\b`).test(badCall),
    "the call pattern no longer matches the bug it was written for",
  );
  const badAlias = "    const p = mesh.positions;";
  assert.ok(
    /(?:const|let|var)\s+\w+\s*=\s*\w+\.positions\s*;/.test(badAlias) && !/\bparts?\b|\bplate/.test(badAlias),
    "the alias pattern no longer matches the bug it was written for",
  );
});
