// Helpers for looking inside a .3mf the site just handed us, plus fixtures to feed it.
//
// The assertions here are deliberately the ones a SLICER would make, not the ones our own parser
// makes. `analyzeThreeMF` read the broken per-plate exports fine; Snapmaker Orca refused them,
// because an OPC package whose relationships point at parts that aren't in the archive is malformed
// regardless of whether the mesh is intact. So: check the package, not just the geometry.
import { readFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";
import type { Download } from "@playwright/test";

export type Archive = Record<string, Uint8Array>;

/** Read a Playwright download into memory and unzip it. */
export async function openDownload(dl: Download): Promise<Archive> {
  const path = await dl.path();
  if (!path) throw new Error(`download "${dl.suggestedFilename()}" produced no file`);
  return unzipSync(new Uint8Array(await readFile(path)));
}

export const text = (a: Archive, name: string): string => {
  const e = a[name];
  if (!e) throw new Error(`missing entry ${name}; archive has: ${Object.keys(a).join(", ")}`);
  return strFromU8(e);
};

export const json = <T = Record<string, unknown>>(a: Archive, name: string): T => JSON.parse(text(a, name)) as T;

/**
 * Every `Target=` in every .rels file must name a part that is actually in the package.
 *
 * This is the exact check that would have caught the extracted-plate bug: thumbnails were dropped
 * from the zip but `_rels/.rels` still advertised them, and Orca reported it as "The file does not
 * contain any geometry data" — a message that sends you looking at the mesh, which was fine.
 */
export function danglingRels(a: Archive): string[] {
  const names = new Set(Object.keys(a));
  const out: string[] = [];
  for (const rel of Object.keys(a).filter((n) => n.endsWith(".rels"))) {
    for (const m of strFromU8(a[rel]).matchAll(/Target="\/?([^"]+)"/g)) {
      if (!names.has(m[1].replace(/^\/+/, ""))) out.push(`${rel} -> ${m[1]}`);
    }
  }
  return out;
}

/**
 * ANY reference, in any entry, to a part the package does not contain.
 *
 * The generalisation of danglingRels, written after the same defect surfaced a THIRD time. It was
 * fixed in _rels/.rels, then reappeared in model_settings.config, then in the root model's own
 * Thumbnail_Middle / Thumbnail_Small metadata — each fix scoped to the file where it was found
 * rather than to the rule, so the bug moved one file over and the check never saw it.
 *
 * Skips the geometry parts: they are hundreds of MB and contain no path references.
 */
export function missingPartRefs(a: Archive): string[] {
  const names = new Set(Object.keys(a));
  const re = /["\'>\s](\/?(?:Metadata|3D)\/[A-Za-z0-9_\-./]+\.(?:png|model|config|xml|gcode|rels))/g;
  const out: string[] = [];
  for (const entry of Object.keys(a)) {
    if (/Objects\/.*\.model$/i.test(entry)) continue;
    for (const m of strFromU8(a[entry]).matchAll(re)) {
      const p = m[1].replace(/^\/+/, "");
      const ref = `${entry} -> ${p}`;
      if (!names.has(p) && !out.includes(ref)) out.push(ref);
    }
  }
  return out;
}

/** Colours in print order, as the U1 profile declares them. */
export function filamentColours(a: Archive): string[] {
  const cfg = json<{ filament_colour?: string[] }>(a, "Metadata/project_settings.config");
  return (cfg.filament_colour ?? []).map((c) => c.toUpperCase());
}

/** Extruder per Z band from layer_config_ranges.xml, in file order. */
export function layerBands(a: Archive): { head: string; z0: number; z1: number }[] {
  const xml = text(a, "Metadata/layer_config_ranges.xml");
  const blocks = [...xml.matchAll(/<range\b[^>]*min_z="([\d.]+)"[^>]*max_z="([\d.]+)"[\s\S]*?<\/range>/g)];
  return blocks.map((b) => ({
    z0: Number(b[1]),
    z1: Number(b[2]),
    head: b[0].match(/opt_key="extruder">(\d+)</)?.[1] ?? "",
  }));
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** CRC-32, for the PNG chunks below. */
function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(strToU8(type), 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/**
 * A deterministic RGB gradient PNG, generated rather than committed as a binary.
 *
 * A gradient specifically: it is what relief mode is for, and it defeats the flat quantiser badly
 * enough that the two modes pick visibly different palettes — which is the condition under which the
 * page previously showed one set of colours and shipped another.
 */
export function gradientPng(w = 32, h = 32): Buffer {
  const raw = new Uint8Array(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 3);
    raw[row] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      const p = row + 1 + x * 3;
      raw[p] = Math.round((x / (w - 1)) * 255);
      raw[p + 1] = Math.round((y / (h - 1)) * 255);
      raw[p + 2] = 255 - Math.round((x / (w - 1)) * 128);
    }
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(pngChunk("IHDR", ihdr)),
    // IDAT is ZLIB-wrapped deflate (RFC 1950), not raw deflate — a raw stream produces a file every
    // decoder rejects, and the page then shows nothing at all rather than an error.
    Buffer.from(pngChunk("IDAT", new Uint8Array(deflateSync(Buffer.from(raw), { level: 6 })))),
    Buffer.from(pngChunk("IEND", new Uint8Array(0))),
  ]);
}

/**
 * A minimal painted Bambu-style .3mf: one object, four painted colour states, a foreign printer
 * profile. Enough for the converter to have real work to do — remap paint to U1 heads, swap the
 * printer profile — without shipping somebody else's model into the repo.
 */
export function paintedThreeMF(): Buffer {
  const mesh = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <resources>
  <object id="1" type="model">
   <mesh>
    <vertices>
     <vertex x="0" y="0" z="0"/><vertex x="20" y="0" z="0"/><vertex x="20" y="20" z="0"/>
     <vertex x="0" y="20" z="0"/><vertex x="10" y="10" z="15"/>
    </vertices>
    <triangles>
     <triangle v1="0" v2="1" v3="4" paint_color="4"/>
     <triangle v1="1" v2="2" v3="4" paint_color="8"/>
     <triangle v1="2" v2="3" v3="4" paint_color="0C"/>
     <triangle v1="3" v2="0" v3="4" paint_color="1C"/>
     <triangle v1="0" v2="2" v3="1"/><triangle v1="0" v2="3" v3="2"/>
    </triangles>
   </mesh>
  </object>
 </resources>
 <build><item objectid="1"/></build>
</model>`;
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`,
    ),
    "_rels/.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`,
    ),
    "3D/3dmodel.model": strToU8(mesh),
    "Metadata/project_settings.config": strToU8(
      JSON.stringify({
        printer_model: "Bambu Lab P1S",
        filament_colour: ["#FF0000", "#00FF00", "#0000FF", "#FFFF00"],
        filament_type: ["PLA", "PLA", "PLA", "PLA"],
        layer_height: "0.2",
      }),
    ),
    "Metadata/model_settings.config": strToU8(
      `<?xml version="1.0"?><config><object id="1"><metadata key="name" value="e2e-fixture"/></object><plate><metadata key="plater_id" value="1"/><metadata key="plater_name" value="Plate 1"/><model_instance><metadata key="object_id" value="1"/></model_instance></plate></config>`,
    ),
  };
  return Buffer.from(zipSync(files, { level: 6 }));
}
