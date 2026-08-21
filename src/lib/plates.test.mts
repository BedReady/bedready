// Per-plate extraction, for projects too big to open whole.
//
// The mapping is the part that's easy to get wrong: a <plate>'s model_instance object_id refers to a
// ROOT object id, whose <components p:path> then names the geometry part. Reading the plate's
// object_id as if it were the object_N.model filename silently mismaps — on my first pass at the real
// 18-plate file it made half the plates measure 0 MB. These tests pin the indirection.
import { test } from "node:test";
import assert from "node:assert/strict";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { peekPlates, extractPlate, pruneRels, pruneMissingThumbnails } from "./plates.ts";

/** Root ids deliberately differ from part numbers, so a wrong mapping can't accidentally pass. */
function project(): Uint8Array {
  const objs = [
    { rootId: 20, part: "3D/Objects/object_1.model" },
    { rootId: 40, part: "3D/Objects/object_2.model" },
    { rootId: 60, part: "3D/Objects/object_3.model" },
  ];
  const root = `<?xml version="1.0"?><model unit="millimeter">
 <resources>
${objs.map((o) => `  <object id="${o.rootId}" type="model"><components><component p:path="/${o.part}" objectid="1"/></components></object>`).join("\n")}
 </resources>
 <build>
${objs.map((o) => `  <item objectid="${o.rootId}"/>`).join("\n")}
 </build></model>`;
  const settings = `<?xml version="1.0"?><config>
${objs.map((o) => `  <object id="${o.rootId}"><metadata key="name" value="obj${o.rootId}"/></object>`).join("\n")}
${objs.map((o, i) => `  <plate><metadata key="plater_id" value="${i + 1}"/><metadata key="plater_name" value="P${i + 1}"/><model_instance><metadata key="object_id" value="${o.rootId}"/></model_instance></plate>`).join("\n")}
</config>`;
  const mesh = (n: number) => `<?xml version="1.0"?><model unit="millimeter"><resources><object id="1" type="model"><mesh>
  <vertices>${Array.from({ length: 4 }, (_, i) => `<vertex x="${i * n}" y="0" z="0"/>`).join("")}</vertices>
  <triangles><triangle v1="0" v2="1" v3="2" paint_color="4"/></triangles>
</mesh></object></resources><build/></model>${" ".repeat(n * 500)}`; // pad so sizes differ measurably
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0"?><Types/>`),
    "_rels/.rels": strToU8(`<?xml version="1.0"?><Relationships/>`),
    "3D/3dmodel.model": strToU8(root),
    "3D/_rels/3dmodel.model.rels": strToU8(
      `<?xml version="1.0"?><Relationships>${objs.map((o, i) => `<Relationship Target="/${o.part}" Id="rel-${i + 1}" Type="t"/>`).join("")}</Relationships>`,
    ),
    "Metadata/model_settings.config": strToU8(settings),
    "Metadata/project_settings.config": strToU8(JSON.stringify({ printer_model: "Bambu Lab P1S" })),
    "Metadata/plate_1.png": strToU8("x".repeat(3000)), // thumbnails must never be counted or shipped
  };
  objs.forEach((o, i) => (files[o.part] = strToU8(mesh(i + 1))));
  return zipSync(files, { level: 0 });
}

test("peekPlates maps each plate through the root object to its geometry part", () => {
  const plates = peekPlates(project());
  assert.equal(plates.length, 3);
  assert.deepEqual(plates.map((p) => p.index), [1, 2, 3]);
  // The indirection: plate 2 -> root object 40 -> object_2.model (NOT object_40.model).
  assert.deepEqual(plates[1].objectIds, [40]);
  assert.deepEqual(plates[1].paths, ["3D/Objects/object_2.model"]);
  // Every plate must resolve to real geometry, and sizes must be per-plate, not the whole archive.
  assert.ok(plates.every((p) => p.bytes > 0), "each plate should report its own size");
  assert.ok(plates[2].bytes > plates[0].bytes, "bigger part -> bigger reported size");
});

test("extractPlate yields a standalone .3mf with only that plate", () => {
  const src = project();
  const out = extractPlate(src, 2);
  const e = unzipSync(out);
  assert.ok(e["3D/Objects/object_2.model"], "keeps its own geometry");
  assert.ok(!e["3D/Objects/object_1.model"], "drops other plates' geometry");
  assert.ok(!e["3D/Objects/object_3.model"], "drops other plates' geometry");
  assert.ok(!e["Metadata/plate_1.png"], "drops thumbnails");
  assert.ok(e["[Content_Types].xml"] && e["_rels/.rels"], "keeps package structure");

  const root = strFromU8(e["3D/3dmodel.model"]);
  assert.ok(root.includes('id="40"'), "keeps its own object");
  assert.ok(!root.includes('id="20"') && !root.includes('id="60"'), "drops other objects");
  assert.ok(root.includes('objectid="40"'), "keeps its build item");

  const ms = strFromU8(e["Metadata/model_settings.config"]);
  assert.ok(ms.includes('value="P2"'), "keeps its own plate block");
  assert.ok(!ms.includes('value="P1"') && !ms.includes('value="P3"'), "drops other plate blocks");
  // Renumbered: the surviving plate is the first plate of the new project, whatever it used to be.
  // Extracting plate 6 previously produced a project whose only plate called itself the sixth.
  assert.match(ms, /key="plater_id"\s+value="1"/, "the surviving plate is renumbered to 1");

  const rels = strFromU8(e["3D/_rels/3dmodel.model.rels"]);
  assert.ok(rels.includes("object_2.model") && !rels.includes("object_1.model"), "prunes relationships");
});

test("extractPlate rejects a plate that isn't there", () => {
  assert.throws(() => extractPlate(project(), 99), /not found/);
});

// THE BUG THIS PINS: extractPlate dropped the plate thumbnails but left _rels/.rels still pointing
// at them. Our own parser read the result fine and the geometry was intact — but an OPC package with
// dangling relationship targets is malformed, so Snapmaker Orca refused it with "The file does not
// contain any geometry data." Reading the mesh back is NOT enough of a check; the package has to be
// internally consistent or no slicer will open it.
test("extractPlate leaves no relationship pointing at a part it dropped", () => {
  const e = unzipSync(extractPlate(project(), 2));
  const names = new Set(Object.keys(e));
  const dangling: string[] = [];
  for (const rel of [...names].filter((n) => n.endsWith(".rels"))) {
    for (const m of strFromU8(e[rel]).matchAll(/Target="\/?([^"]+)"/g)) {
      if (!names.has(m[1].replace(/^\/+/, ""))) dangling.push(`${rel} -> ${m[1]}`);
    }
  }
  assert.deepEqual(dangling, [], "every relationship target must exist in the package");
});

test("pruneRels keeps present targets and drops missing ones", () => {
  const xml = `<?xml version="1.0"?><Relationships>`
    + `<Relationship Target="/3D/3dmodel.model" Id="a" Type="t"/>`
    + `<Relationship Target="/Metadata/gone.png" Id="b" Type="t"/>`
    + `<Relationship Target="3D/Objects/object_2.model" Id="c" Type="t"/>`
    + `</Relationships>`;
  const out = pruneRels(xml, new Set(["3D/3dmodel.model", "3D/Objects/object_2.model"]));
  assert.ok(out.includes("3dmodel.model"), "keeps a present, absolute target");
  assert.ok(out.includes("object_2.model"), "keeps a present, relative target");
  assert.ok(!out.includes("gone.png"), "drops the missing target");
});

// THE BUG THIS PINS: an extracted plate kept the world position it had in the multi-plate layout.
// Measured on the real file (Small Spiderman colored.3mf, plate 6): the model came out at
// Y -287.5..-68.4 against a printable Y of 1..271 — entirely behind the bed. Nothing was malformed;
// every structural check passed; Orca opened it and had nothing on the plate to slice. Position is
// invisible to package-level validation, which is exactly why it survived so long.
test("extractPlate re-seats the plate on the bed", () => {
  const src = offsetProject();
  const root = strFromU8(unzipSync(extractPlate(src, 1))["3D/3dmodel.model"]);
  const t = root.match(/<item\b[^>]*transform="([^"]+)"/)?.[1]?.split(/\s+/).map(Number);
  assert.ok(t, "the build item should carry a transform");
  // The mesh spans 0..10 locally, so a centred plate puts its middle (5 + tx) at the bed centre.
  assert.ok(Math.abs(t![9] + 5 - 135.5) < 0.51, `X centre should land on the bed, got ${t![9] + 5}`);
  assert.ok(Math.abs(t![10] + 5 - 136) < 0.51, `Y centre should land on the bed, got ${t![10] + 5}`);
});

test("extractPlate leaves an already-centred plate alone", () => {
  // Sub-millimetre nudges would rewrite transforms on every file for no benefit.
  const src = offsetProject(130.5, 131);
  const root = strFromU8(unzipSync(extractPlate(src, 1))["3D/3dmodel.model"]);
  assert.match(root, /transform="1 0 0 0 1 0 0 0 1 130\.5 131 0"/, "transform should be untouched");
});

test("extractPlate drops thumbnail metadata naming files it removed", () => {
  const ms = strFromU8(unzipSync(extractPlate(offsetProject(), 1))["Metadata/model_settings.config"]);
  // Plain metadata values, not OPC relationships — pruneRels cannot see these, so they survived and
  // pointed a slicer at Metadata/plate_6.png in a package that no longer contained it.
  for (const k of ["thumbnail_file", "thumbnail_no_light_file", "top_file", "pick_file"]) {
    assert.ok(!ms.includes(k), `stale ${k} metadata should be dropped`);
  }
});

/** One plate parked far off the bed, mirroring how a multi-plate project lays plates out in world space. */
function offsetProject(tx = 900, ty = -450): Uint8Array {
  const part = "3D/Objects/object_1.model";
  const root = `<?xml version="1.0"?><model unit="millimeter">
 <metadata name="Thumbnail_Middle">/Metadata/plate_1.png</metadata>
 <metadata name="Thumbnail_Small">/Metadata/plate_1_small.png</metadata>
 <resources><object id="20" type="model"><components><component p:path="/${part}" objectid="1"/></components></object></resources>
 <build><item objectid="20" transform="1 0 0 0 1 0 0 0 1 ${tx} ${ty} 0"/></build></model>`;
  const settings = `<?xml version="1.0"?><config>
 <object id="20"><metadata key="name" value="obj"/></object>
 <plate><metadata key="plater_id" value="1"/><metadata key="plater_name" value="P1"/>`
    + `<metadata key="thumbnail_file" value="Metadata/plate_6.png"/>`
    + `<metadata key="thumbnail_no_light_file" value="Metadata/plate_no_light_6.png"/>`
    + `<metadata key="top_file" value="Metadata/top_6.png"/>`
    + `<metadata key="pick_file" value="Metadata/pick_6.png"/>`
    + `<model_instance><metadata key="object_id" value="20"/></model_instance></plate>
</config>`;
  const mesh = `<?xml version="1.0"?><model unit="millimeter"><resources><object id="1" type="model"><mesh>`
    + `<vertices><vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="10" y="10" z="0"/><vertex x="0" y="10" z="5"/></vertices>`
    + `<triangles><triangle v1="0" v2="1" v3="2"/></triangles>`
    + `</mesh></object></resources><build/></model>`;
  return zipSync({
    "[Content_Types].xml": strToU8(`<?xml version="1.0"?><Types/>`),
    "_rels/.rels": strToU8(`<?xml version="1.0"?><Relationships/>`),
    "3D/3dmodel.model": strToU8(root),
    "3D/_rels/3dmodel.model.rels": strToU8(
      `<?xml version="1.0"?><Relationships><Relationship Target="/${part}" Id="r1" Type="t"/></Relationships>`),
    "Metadata/model_settings.config": strToU8(settings),
    // A real U1 printable area, so bedCentre has something to read.
    "Metadata/project_settings.config": strToU8(JSON.stringify({
      printer_model: "Snapmaker U1",
      printable_area: ["0.5x1", "270.5x1", "270.5x271", "0.5x271"],
    })),
    [part]: strToU8(mesh),
  }, { level: 0 });
}

// THE BUG THIS PINS, and it is the same bug for the THIRD time. An extracted package must not name a
// part it does not contain. Fixed first in _rels/.rels, then in model_settings.config, then here — in
// the root model's own Thumbnail_Middle / Thumbnail_Small pointers, which are plain metadata and so
// survived both earlier fixes. Reported by a user whose converted plate 6 still would not open after
// the re-seating fix: every relationship resolved, and the root model still advertised two PNGs that
// were not in the zip.
test("extractPlate drops root-model thumbnail pointers to files it removed", () => {
  const e = unzipSync(extractPlate(offsetProject(), 1));
  const root = strFromU8(e["3D/3dmodel.model"]);
  assert.ok(!root.includes("Thumbnail_Middle"), "stale Thumbnail_Middle should be dropped");
  assert.ok(!root.includes("Thumbnail_Small"), "stale Thumbnail_Small should be dropped");

  // The general rule, asserted across the WHOLE package rather than one file at a time: nothing may
  // reference a part that is absent. Scoping this check to .rels is what let the bug move twice.
  const names = new Set(Object.keys(e));
  const missing: string[] = [];
  for (const n of Object.keys(e)) {
    if (/Objects\/.*\.model$/.test(n)) continue;
    for (const m of strFromU8(e[n]).matchAll(/["'>\s](\/?(?:Metadata|3D)\/[A-Za-z0-9_\-./]+\.(?:png|model|config|xml|rels))/g)) {
      const p = m[1].replace(/^\/+/, "");
      if (!names.has(p)) missing.push(`${n} -> ${p}`);
    }
  }
  assert.deepEqual(missing, [], "no entry may reference a part the package does not contain");
});

test("pruneMissingThumbnails keeps pointers whose target is present", () => {
  const xml = `<model><metadata name="Thumbnail_Middle">/Metadata/here.png</metadata>`
    + `<metadata name="Thumbnail_Small">/Metadata/gone.png</metadata></model>`;
  const out = pruneMissingThumbnails(xml, new Set(["Metadata/here.png"]));
  assert.ok(out.includes("here.png"), "a present thumbnail is kept");
  assert.ok(!out.includes("gone.png"), "a missing one is dropped");
});

// THE BUG THAT ACTUALLY BROKE ORCA — found only after the user reported that the original file opens
// fine while every extraction failed, including one with the geometry inlined into the root and one
// with the root rewritten from scratch. Both still failed, which meant Orca was giving up BEFORE it
// reached any geometry. It was model_settings' <assemble> section: it lists every object in the
// ORIGINAL project as <assemble_item object_id="N"/> — a different tag and a different attribute
// name from <object id="N">, so filterBlocks never saw it. An extracted plate declared an assembly
// of all 18 objects while containing one; Orca resolved that list, found nothing, and reported
// "The file does not contain any geometry data".
test("extractPlate drops assemble items for objects it removed", () => {
  const ms = strFromU8(unzipSync(extractPlate(assembledProject(), 1))["Metadata/model_settings.config"]);
  assert.ok(ms.includes('object_id="20"'), "keeps the assemble item for the surviving object");
  for (const gone of ["40", "60"]) {
    assert.ok(!ms.includes(`object_id="${gone}"`), `assemble item for removed object ${gone} must go`);
  }
});

test("extractPlate removes an assemble block left with nothing in it", () => {
  // An empty <assemble></assemble> is not obviously harmful, but it is a lie about the project and
  // the surrounding code already treats "declares something it does not have" as the failure mode.
  const ms = strFromU8(unzipSync(extractPlate(assembledProject(true), 1))["Metadata/model_settings.config"]);
  assert.ok(!ms.includes("<assemble>"), "an assemble block with no surviving items is dropped");
});

// EVERY object_id referenced anywhere in model_settings must be an object the package still defines.
// This is the same invariant as missingPartRefs, one level up: paths were checked, ids were not.
test("an extracted plate references no object it does not contain", () => {
  const e = unzipSync(extractPlate(assembledProject(), 1));
  const root = strFromU8(e["3D/3dmodel.model"]);
  const defined = new Set([...root.matchAll(/<object\s+id="(\d+)"/g)].map((m) => m[1]));
  const ms = strFromU8(e["Metadata/model_settings.config"]);
  const referenced = [...ms.matchAll(/\bobject_id="(\d+)"/g)].map((m) => m[1]);
  assert.ok(referenced.length > 0, "the plate should reference its own object");
  assert.deepEqual(referenced.filter((id) => !defined.has(id)), [], "no dangling object ids");
});

/** Three plates whose model_settings carries an <assemble> listing all of them, as Bambu writes it. */
function assembledProject(onlyOthersInAssemble = false): Uint8Array {
  const objs = [
    { rootId: 20, part: "3D/Objects/object_1.model" },
    { rootId: 40, part: "3D/Objects/object_2.model" },
    { rootId: 60, part: "3D/Objects/object_3.model" },
  ];
  const root = `<?xml version="1.0"?><model unit="millimeter">
 <resources>${objs.map((o) => `<object id="${o.rootId}" type="model"><components><component p:path="/${o.part}" objectid="1"/></components></object>`).join("")}</resources>
 <build>${objs.map((o) => `<item objectid="${o.rootId}" transform="1 0 0 0 1 0 0 0 1 130 131 0"/>`).join("")}</build></model>`;
  const inAssemble = onlyOthersInAssemble ? objs.slice(1) : objs;
  const settings = `<?xml version="1.0"?><config>
${objs.map((o) => `  <object id="${o.rootId}"><metadata key="name" value="obj${o.rootId}"/></object>`).join("\n")}
${objs.map((o, i) => `  <plate><metadata key="plater_id" value="${i + 1}"/><metadata key="plater_name" value="P${i + 1}"/><model_instance><metadata key="object_id" value="${o.rootId}"/></model_instance></plate>`).join("\n")}
  <assemble>
${inAssemble.map((o) => `   <assemble_item object_id="${o.rootId}" instance_id="0" transform="1 0 0 0 1 0 0 0 1 0 0 0" offset="0 0 0" />`).join("\n")}
  </assemble>
</config>`;
  const mesh = `<?xml version="1.0"?><model unit="millimeter"><resources><object id="1" type="model"><mesh>`
    + `<vertices><vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="10" y="10" z="0"/></vertices>`
    + `<triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources><build/></model>`;
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0"?><Types/>`),
    "_rels/.rels": strToU8(`<?xml version="1.0"?><Relationships/>`),
    "3D/3dmodel.model": strToU8(root),
    "3D/_rels/3dmodel.model.rels": strToU8(
      `<?xml version="1.0"?><Relationships>${objs.map((o, i) => `<Relationship Target="/${o.part}" Id="r${i}" Type="t"/>`).join("")}</Relationships>`),
    "Metadata/model_settings.config": strToU8(settings),
    "Metadata/project_settings.config": strToU8(JSON.stringify({
      printer_model: "Snapmaker U1", printable_area: ["0.5x1", "270.5x1", "270.5x271", "0.5x271"],
    })),
  };
  objs.forEach((o) => (files[o.part] = strToU8(mesh)));
  return zipSync(files, { level: 0 });
}
