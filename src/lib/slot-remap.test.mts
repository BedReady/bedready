// One slot remap for every slot reference. Run: `npm test`.
//
// Only `key="extruder"` and the per-filament arrays moved with a slot swap or merge. The process keys
// that pick a FEATURE's filament (support, interface, walls, prime tower …) and their per-object
// overrides stayed behind, pointing at the wrong filament or past the last slot, and a merged slot took
// the first member's settings whatever colour it showed (2026-11-07 review, repros r2/r3).
import { test } from "node:test";
import assert from "node:assert/strict";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { cleanThreeMF } from "./convert.ts";

const MESH = `<vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles>`;
const file3mf = (entries: Record<string, string>): File =>
  new File([zipSync(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, strToU8(v)])), { level: 0 }) as BlobPart], "t.3mf");
const objModel = (ids: number[]) =>
  `<?xml version="1.0"?><model><metadata name="Application">BambuStudio-02.01</metadata><resources>${ids.map((i) => `<object id="${i}"><mesh>${MESH}</mesh></object>`).join("")}</resources><build>${ids.map((i) => `<item objectid="${i}" transform="1 0 0 0 1 0 0 0 1 ${20 * i} 128 0"/>`).join("")}</build></model>`;
const project = (o: Record<string, unknown>) =>
  JSON.stringify({ printer_settings_id: "Bambu Lab X1 Carbon 0.4 nozzle", printable_area: ["0x0", "256x0", "256x256", "0x256"], ...o });

async function read(blob: Blob): Promise<{ cfg: Record<string, unknown>; ms: string }> {
  const e = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  return { cfg: JSON.parse(strFromU8(e["Metadata/project_settings.config"])), ms: strFromU8(e["Metadata/model_settings.config"]) };
}
const objectSlots = (ms: string) => [...ms.matchAll(/key="extruder" value="(\d+)"/g)].map((m) => +m[1]);

test("slot remap: swapping slots 1 and 3 moves support_interface_filament and its per-object override with the support material", async () => {
  const ms = `<config><object id="1"><metadata key="extruder" value="1"/><metadata key="support_interface_filament" value="3"/></object><object id="2"><metadata key="extruder" value="3"/></object></config>`;
  const f = file3mf({
    "3D/3dmodel.model": objModel([1, 2]),
    "Metadata/model_settings.config": ms,
    "Metadata/project_settings.config": project({
      filament_colour: ["#FF0000", "#00FF00", "#FFFFFF"], filament_type: ["PLA", "PLA", "PLA-S"],
      support_interface_filament: "3", support_filament: "2", wall_filament: "1",
    }),
  });
  const r = await cleanThreeMF(f, "u1", { slots: ["#FFFFFF", "#00FF00", "#FF0000"], assign: [2, 1, 0] });
  const { cfg, ms: out } = await read(r.blob);
  assert.deepEqual((cfg.filament_type as string[]).slice(0, 3), ["PLA-S", "PLA", "PLA"]);
  assert.equal(cfg.support_interface_filament, "1", "the support material moved to slot 1, and so must the interface");
  assert.equal(cfg.support_filament, "2", "slot 2 did not move");
  assert.equal(cfg.wall_filament, "3", "red moved from slot 1 to slot 3");
  assert.match(out, /<object id="1"><metadata key="extruder" value="3"\/><metadata key="support_interface_filament" value="1"\/>/);
});

const SIX = ["#FF0000", "#00FF00", "#0000FF", "#FFFFFF", "#000000", "#FF8800"];
const sixFile = (perObject = "") =>
  file3mf({
    "3D/3dmodel.model": objModel([1, 2, 3, 4, 5, 6]),
    "Metadata/model_settings.config": `<config>${[1, 2, 3, 4, 5, 6].map((i) => `<object id="${i}"><metadata key="extruder" value="${i}"/>${i === 1 ? perObject : ""}</object>`).join("")}</config>`,
    "Metadata/project_settings.config": project({
      filament_colour: SIX, filament_type: SIX.map(() => "PLA"),
      support_filament: "6", support_interface_filament: "6", wall_filament: "5",
      nozzle_temperature: SIX.map((_, i) => String(200 + i)),
    }),
  });

test("slot remap: a 6→4 merge points every feature key at the slot its filament merged into", async () => {
  const { cfg, ms } = await read((await cleanThreeMF(sixFile(), "u1")).blob);
  const slotOf = objectSlots(ms);
  assert.equal(cfg.support_filament, String(slotOf[5]), "orange (source 6) objects and supports must share a slot");
  assert.equal(cfg.support_interface_filament, String(slotOf[5]));
  assert.equal(cfg.wall_filament, String(slotOf[4]), "black (source 5)");
});

test("slot remap: a merged slot takes its temperature from the member whose colour it shows", async () => {
  const { cfg } = await read((await cleanThreeMF(sixFile(), "u1")).blob);
  (cfg.filament_colour as string[]).forEach((col, s) => {
    const src = SIX.indexOf(col);
    assert.ok(src >= 0, `slot ${s + 1} shows ${col}, not a source colour`);
    assert.equal((cfg.nozzle_temperature as string[])[s], String(200 + src), `slot ${s + 1} shows ${col} but takes another member's temperature`);
  });
});

test("slot remap: a merged slot takes its type from the member whose colour it shows", async () => {
  const f = file3mf({
    "3D/3dmodel.model": objModel([1, 2, 3, 4, 5]),
    "Metadata/model_settings.config": `<config>${[1, 2, 3, 4, 5].map((i) => `<object id="${i}"><metadata key="extruder" value="${i}"/></object>`).join("")}</config>`,
    // Near-white PETG (source 1) merges with white PLA-S (source 5), which is used far more.
    "Metadata/project_settings.config": project({ filament_colour: ["#FEFEFE", "#FF0000", "#00FF00", "#0000FF", "#FFFFFF"], filament_type: ["PETG", "PLA", "PLA", "PLA", "PLA-S"] }),
  });
  const r = await cleanThreeMF(f, "u1", { slots: ["#FFFFFF", "#FF0000", "#00FF00", "#0000FF"], assign: [0, 1, 2, 3, 0] });
  const { cfg } = await read(r.blob);
  assert.equal(cfg.filament_colour && (cfg.filament_colour as string[])[0], "#FFFFFF");
  assert.equal((cfg.filament_type as string[])[0], "PLA-S", "slot 1 shows source 5's white, so it is source 5's material");
});

test("slot remap: Full Spectrum sends a feature whose filament became a mix to a filament on a head", async () => {
  const { cfg, ms } = await read((await cleanThreeMF(sixFile(), "u1", { fullSpectrum: true })).blob);
  for (const k of ["support_filament", "support_interface_filament", "wall_filament"]) {
    const v = +(cfg[k] as string);
    assert.ok(v >= 1 && v <= 4, `${k} = ${cfg[k]}: a feature must print from a filament on a head`);
  }
  // Objects keep their virtual mixes; only the feature keys are resolved to a head.
  assert.ok(objectSlots(ms).some((s) => s > 4));
});

test("slot remap: keep-all-colours renumbers nothing", async () => {
  const { cfg } = await read((await cleanThreeMF(sixFile(), "u1", { keepAllColours: true })).blob);
  assert.equal(cfg.support_filament, "6");
  assert.equal(cfg.wall_filament, "5");
});

test("slot remap: a same-family retarget merge remaps the feature keys, per-object overrides and per-slot settings", async () => {
  const r = await cleanThreeMF(sixFile(`<metadata key="wall_filament" value="6"/>`), "bambu-p1s");
  const { cfg, ms } = await read(r.blob);
  const slotOf = objectSlots(ms);
  assert.equal(cfg.support_filament, String(slotOf[5]));
  assert.equal(cfg.wall_filament, String(slotOf[4]));
  assert.match(ms, new RegExp(`key="wall_filament" value="${slotOf[5]}"`));
  (cfg.filament_colour as string[]).forEach((col, s) => assert.equal((cfg.nozzle_temperature as string[])[s], String(200 + SIX.indexOf(col))));
});

test("slot remap: auto (0) stays auto", async () => {
  const f = file3mf({
    "3D/3dmodel.model": objModel([1, 2]),
    "Metadata/model_settings.config": `<config><object id="1"><metadata key="extruder" value="1"/></object><object id="2"><metadata key="extruder" value="2"/></object></config>`,
    "Metadata/project_settings.config": project({ filament_colour: ["#FF0000", "#00FF00"], filament_type: ["PLA", "PLA"], support_filament: "0" }),
  });
  const r = await cleanThreeMF(f, "bambu-p1s", { slots: ["#00FF00", "#FF0000"], assign: [1, 0] });
  assert.equal((await read(r.blob)).cfg.support_filament, "0");
});
