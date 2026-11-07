// The load sheet reads the converted file, and nothing in it can inject markup. Run: `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { loadSheetRows, loadSheetHtml } from "./load-sheet.ts";

const archive = (cfg: unknown) => zipSync({ "3D/3dmodel.model": strToU8("<model/>"), "Metadata/project_settings.config": strToU8(JSON.stringify(cfg)) });

test("rows come from the output's own filament settings, one per head", () => {
  const rows = loadSheetRows(archive({ filament_colour: ["#ff0000", "#00FF00"], filament_type: ["PLA", "PETG"], filament_settings_id: ["Generic PLA", "Generic PETG"] }));
  assert.deepEqual(rows, [
    { head: 1, hex: "#FF0000", type: "PLA", preset: "Generic PLA" },
    { head: 2, hex: "#00FF00", type: "PETG", preset: "Generic PETG" },
  ]);
});

test("no project settings, a bad archive or bad JSON give no rows rather than throwing", () => {
  assert.deepEqual(loadSheetRows(zipSync({ "3D/3dmodel.model": strToU8("<model/>") })), []);
  assert.deepEqual(loadSheetRows(new TextEncoder().encode("not a zip")), []);
  assert.deepEqual(loadSheetRows(zipSync({ "Metadata/project_settings.config": strToU8("{oops") })), []);
});

test("a hostile color, preset or file name cannot inject markup", () => {
  const rows = loadSheetRows(archive({ filament_colour: ["red;background:url(x)"], filament_type: ["<b>"], filament_settings_id: ['"><script>alert(1)</script>'] }));
  assert.equal(rows[0].hex, "#FFFFFF", "a non-hex color never reaches the style attribute");
  const html = loadSheetHtml({
    fileName: "<img src=x onerror=alert(1)>.3mf", printerName: "U1", rows, swaps: ["<i>pause</i>"], date: "2026-11-07",
    copy: { lang: "en", dir: "ltr", title: "Load sheet", printer: "Printer", head: "Head", color: "Color", material: "Material", preset: "Preset", swapsTitle: "Swaps", footer: "bedready.io" },
  });
  assert.ok(!/<script|<img|<b>|<i>/.test(html.replace(/<\/?(html|head|meta|title|style|body|h1|h2|p|strong|table|thead|tbody|tr|th|td|span|code|ol|li|footer)\b[^>]*>/g, "")));
});
