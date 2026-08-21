// Build the oversized multi-plate fixture ONCE per run, not once per worker.
//
// The plate picker is only reachable through failure: /convert shows it when safeUnzip throws, which
// needs a file whose entries declare more than 800 MB uncompressed. That is not something a test can
// fake — the cap is checked against originalSize in the zip headers, so the bytes have to be real.
//
// Two tricks keep it cheap. The filler plates all point at ONE shared buffer, so the declared total
// costs ~105 MB resident rather than 830 MB; and only plate 1 carries geometry that has to survive a
// round trip, because peekPlates reads headers without inflating and extractPlate inflates only the
// plate you pick. The filler is never decompressed by anything in the test.
//
// Result: a 2 MB .3mf on disk that declares ~830 MB, built in about 7 seconds. The exact declared
// figure is measured and asserted below rather than estimated — if it ever dips under the cap the
// picker silently stops appearing, and every test here would fail for the wrong reason.
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { zipSync, strToU8 } from "fflate";

export const OVERSIZED_FIXTURE = "test-results/.fixtures/oversized-plates.3mf";

/** Plates 2..N: bulk, never inflated, present only to push the declared total past the cap. */
const FILLER_PLATES = 8;
const FILLER_VERTS = 4_000_000; // ~105 MB per entry

/**
 * Plate 1: real geometry, and the only plate any test extracts.
 *
 * Padded to a couple of MB deliberately. At a few hundred bytes the picker rendered it as "0 MB",
 * which is indistinguishable from the symptom of the object_id -> part mapping bug that once made
 * half the plates of a real project measure zero — a fixture shouldn't imitate the failure it is
 * meant to detect.
 */
function realPlate(): string {
  const painted = [
    `<triangle v1="0" v2="1" v3="4" paint_color="4"/>`,
    `<triangle v1="1" v2="2" v3="4" paint_color="8"/>`,
    `<triangle v1="2" v2="3" v3="4" paint_color="0C"/>`,
    `<triangle v1="3" v2="0" v3="4"/>`,
    `<triangle v1="0" v2="2" v3="1"/><triangle v1="0" v2="3" v3="2"/>`,
  ].join("");
  // Padding goes AFTER the root element as inert bytes, not as extra vertices.
  //
  // The first version padded with 60,000 unreferenced <vertex> elements. That reported a believable
  // size, but every extraction then had to parse them and build a preview mesh from them, and under
  // parallel load one test swung from 6 seconds to over three minutes. The bytes are what this
  // fixture needs; the geometry is not. Trailing bytes past </model> are what the existing unit-test
  // fixture in plates.test.mts uses for the same purpose.
  const pad = " ".repeat(2 * 1024 * 1024);
  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <resources>
  <object id="1" type="model">
   <mesh>
    <vertices>
     <vertex x="0" y="0" z="0"/><vertex x="20" y="0" z="0"/><vertex x="20" y="20" z="0"/>
     <vertex x="0" y="20" z="0"/><vertex x="10" y="10" z="12"/>
    </vertices>
    <triangles>${painted}</triangles>
   </mesh>
  </object>
 </resources>
 <build><item objectid="1"/></build>
</model>${pad}`;
}

/** Uncompressed bytes the finished archive declares — the number safeUnzip's cap is measured against. */
export let declaredBytes = 0;

export function buildOversizedFixture(): Uint8Array {
  const plates = [
    { rootId: 20, part: "3D/Objects/object_1.model" },
    ...Array.from({ length: FILLER_PLATES }, (_, i) => ({
      // Root ids deliberately unrelated to the part numbers: a plate's model_instance object_id names
      // a ROOT object, whose <components p:path> then names the geometry part. Reading one as the
      // other mismaps plates silently, which is how half of them once measured 0 MB.
      rootId: 40 + i * 20,
      part: `3D/Objects/object_${i + 2}.model`,
    })),
  ];

  const root = `<?xml version="1.0"?><model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">
 <resources>
${plates.map((p) => `  <object id="${p.rootId}" type="model"><components><component p:path="/${p.part}" objectid="1"/></components></object>`).join("\n")}
 </resources>
 <build>
${plates.map((p, i) => `  <item objectid="${p.rootId}" transform="1 0 0 0 1 0 0 0 1 ${900 + i * 300} -450 0"/>`).join("\n")}
 </build></model>`;

  const settings = `<?xml version="1.0"?><config>
${plates.map((p) => `  <object id="${p.rootId}"><metadata key="name" value="obj${p.rootId}"/></object>`).join("\n")}
${plates.map((p, i) => `  <plate><metadata key="plater_id" value="${i + 1}"/><metadata key="plater_name" value="Plate ${i + 1}"/><model_instance><metadata key="object_id" value="${p.rootId}"/></model_instance></plate>`).join("\n")}
</config>`;

  // ONE buffer, referenced by every filler entry. fflate compresses each independently but never
  // holds more than this single copy of the input.
  const filler = strToU8(
    `<?xml version="1.0"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1" type="model"><mesh>`
      + `<vertices>${'<vertex x="1" y="2" z="3"/>'.repeat(FILLER_VERTS)}</vertices>`
      + `<triangles><triangle v1="0" v2="1" v3="2"/></triangles>`
      + `</mesh></object></resources><build/></model>`,
  );

  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(
      `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`,
    ),
    "_rels/.rels": strToU8(
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`,
    ),
    "3D/3dmodel.model": strToU8(root),
    "3D/_rels/3dmodel.model.rels": strToU8(
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${plates.map((p, i) => `<Relationship Target="/${p.part}" Id="rel-p${i + 1}" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>`).join("")}</Relationships>`,
    ),
    "Metadata/model_settings.config": strToU8(settings),
    "Metadata/project_settings.config": strToU8(
      JSON.stringify({
        printer_model: "Bambu Lab P1S",
        // Plates are parked far off this area on purpose: a multi-plate project lays its plates out
        // across one world space, and an extracted plate that keeps that position lands off the bed.
        printable_area: ["0.5x1", "270.5x1", "270.5x271", "0.5x271"],
        filament_colour: ["#FF0000", "#00FF00", "#0000FF", "#FFFF00"],
        filament_type: ["PLA", "PLA", "PLA", "PLA"],
      }),
    ),
    // Thumbnails: dropped by extractPlate. _rels/.rels must not be left advertising them — that is
    // exactly the dangling-relationship bug Orca rejected, and what these tests exist to catch.
    "Metadata/plate_1.png": strToU8("x".repeat(2048)),
    "3D/Objects/object_1.model": strToU8(realPlate()),
  };
  for (let i = 0; i < FILLER_PLATES; i++) files[`3D/Objects/object_${i + 2}.model`] = filler;

  // Measured, not estimated: this must exceed MAX_ZIP_INFLATED (800 MB) or the picker never appears
  // and every test in plate-picker.spec.ts fails for a reason that has nothing to do with the code.
  declaredBytes = Object.values(files).reduce((n, b) => n + b.length, 0);
  if (declaredBytes <= 800 * 1024 * 1024) {
    throw new Error(
      `fixture declares only ${(declaredBytes / 1048576).toFixed(0)} MB — under the 800 MB cap, so the `
      + `plate picker will not appear. Raise FILLER_PLATES or FILLER_VERTS.`,
    );
  }
  return zipSync(files, { level: 6 });
}

export default function globalSetup() {
  if (existsSync(OVERSIZED_FIXTURE)) return; // reuse across local re-runs
  const started = Date.now();
  const zip = buildOversizedFixture();
  mkdirSync(dirname(OVERSIZED_FIXTURE), { recursive: true });
  writeFileSync(OVERSIZED_FIXTURE, zip);
  console.log(
    `[e2e] oversized fixture: ${(zip.length / 1048576).toFixed(1)} MB on disk, `
      + `${(declaredBytes / 1048576).toFixed(0)} MB declared, built in ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
}
