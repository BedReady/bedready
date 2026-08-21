// Which printer a .3mf says it is for.
//
// Every case here comes from building a real-shaped slicer file and reading what came back, after a
// hand-made PrusaSlicer 3mf returned `brand: null` for an MK4S — Prusa's current flagship. Run: `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { detectProfile } from "./convert.ts";

/** A PrusaSlicer .3mf: an INI at Metadata/Slic3r_PE.config. */
const prusa = (model: string, settingsId?: string) =>
  new File(
    [
      zipSync({
        "Metadata/Slic3r_PE.config": strToU8(
          `printer_model = ${model}\n` + (settingsId ? `printer_settings_id = ${settingsId}\n` : ""),
        ),
      }),
    ],
    "x.3mf",
  );

/** A Bambu/Orca/Snapmaker-Orca .3mf: JSON at Metadata/project_settings.config. */
const orca = (o: Record<string, unknown>) =>
  new File([zipSync({ "Metadata/project_settings.config": strToU8(JSON.stringify(o)) })], "x.3mf");

test("Prusa's current models are recognised, not just the older ones", async () => {
  // MK4S, MK4IS, MINIIS and COREONE all returned brand=null before: `\bmk[234]\b` needs a word
  // boundary straight after the digit, and "MK4S" has none. These are the machines people own now.
  for (const m of ["MK4S", "MK4IS", "MK3.9", "MK4", "XL", "MINIIS", "COREONE", "MINI+"]) {
    const r = await detectProfile(prusa(m, `Original Prusa ${m} 0.4 nozzle`));
    assert.equal(r.hasProfile, true, m);
    assert.equal(r.brand, "Prusa", `${m} resolved to ${r.brand}`);
    assert.equal(r.printer, m);
  }
});

test("the vendor is read from printer_settings_id when the model code alone is unknown", async () => {
  // printer_model is a bare code; printer_settings_id spells the vendor out. Keeping it means the
  // brand survives for a model this code has never heard of — the point of not being tied to one.
  const r = await detectProfile(prusa("SOMETHING-UNRELEASED-9000", "Original Prusa Something 0.4 nozzle"));
  assert.equal(r.hasProfile, true);
  assert.equal(r.brand, "Prusa");
});

test("a profile with no recognisable vendor still verifies, with no brand invented", async () => {
  const r = await detectProfile(prusa("WIDGETRON-1"));
  assert.equal(r.hasProfile, true, "it is still a real, print-ready profile");
  assert.equal(r.brand, null, "and a brand must not be guessed");
});

test("the U1 is unaffected by opening this up", async () => {
  const r = await detectProfile(orca({ printer_model: "Snapmaker U1" }));
  assert.equal(r.brand, "Snapmaker");
  assert.equal(r.isU1, true);
});

test("other brands still resolve", async () => {
  for (const [model, brand] of [
    ["Bambu Lab X1 Carbon", "Bambu"],
    ["Creality K1 Max", "Creality"],
    ["Elegoo Neptune 4", "Elegoo"],
    ["Anycubic Kobra 3", "Anycubic"],
  ] as const) {
    const r = await detectProfile(orca({ printer_model: model }));
    assert.equal(r.brand, brand, `${model} -> ${r.brand}`);
  }
});

test("a file with no slicer profile is not verifiable on any printer", async () => {
  // The actual quality bar, unchanged by the pivot: plain geometry is what makes multicolour prints
  // fail, and it fails everywhere.
  const bare = new File([zipSync({ "3D/3dmodel.model": strToU8("<model/>") })], "x.3mf");
  const r = await detectProfile(bare);
  assert.equal(r.hasProfile, false);
  assert.equal(r.brand, null);
});
