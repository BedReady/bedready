// The filament-catalogue generator must refuse a source it cannot read BEFORE it touches the
// committed catalogue. OrcaSlicer 2.5.1 packs each vendor as a binary <Vendor>.opc, and the old
// script (default source: the installed app, every parse error swallowed) would have rebuilt
// public/orca-filaments/ with almost nothing in it and exited 0.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SCRIPT = path.join(process.cwd(), "scripts/build-orca-filaments.mjs");
const MANIFEST = path.join(process.cwd(), "public/orca-filaments/manifest.json");

function run(env: Record<string, string>) {
  return spawnSync(process.execPath, [SCRIPT], { env: { ...process.env, ...env }, encoding: "utf8" });
}

function fixture(build: (dir: string) => void): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-src-"));
  build(dir);
  return dir;
}

test("refuses an installed OrcaSlicer >= 2.5.1 (.opc bundles) and leaves the catalogue alone", () => {
  const before = fs.readFileSync(MANIFEST);
  const src = fixture((d) => fs.writeFileSync(path.join(d, "Afinia.opc"), "ZCRO"));
  const r = run({ ORCA_PROFILES_DIR: src });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /\.opc/);
  assert.deepEqual(fs.readFileSync(MANIFEST), before);
});

test("refuses a source with too few filament files", () => {
  const before = fs.readFileSync(MANIFEST);
  const src = fixture((d) => {
    fs.mkdirSync(path.join(d, "Acme", "filament"), { recursive: true });
    fs.writeFileSync(path.join(d, "Acme", "filament", "Acme PLA.json"), "﻿" + JSON.stringify({ type: "filament", name: "Acme PLA" }));
  });
  const r = run({ ORCA_PROFILES_DIR: src });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Only 1 filament \.json/);
  assert.deepEqual(fs.readFileSync(MANIFEST), before);
});

test("refuses to run with no source set", () => {
  const r = run({ ORCA_PROFILES_DIR: "" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /ORCA_PROFILES_DIR/);
});
