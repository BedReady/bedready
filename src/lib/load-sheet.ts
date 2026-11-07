// The printable "load sheet" for a converted file: which filament goes in which toolhead, the
// pauses to swap spools, and the file it belongs to. Read from the OUTPUT archive's own
// project_settings.config, so the sheet says what the slicer will load — not what the UI guessed.
import { strFromU8 } from "fflate";
import { boundedUnzip } from "./paint";

export type LoadSheetRow = { head: number; hex: string; type: string; preset: string };

const HEX = /^#[0-9a-f]{6}$/i;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Rows from a converted 3MF, or [] when it carries no Bambu/Orca project settings. */
export function loadSheetRows(bytes: Uint8Array): LoadSheetRow[] {
  // Bounded like every unzip here, and only the one small entry is inflated.
  let entries: Record<string, Uint8Array>;
  try {
    const r = boundedUnzip(bytes, 16 * 1024 * 1024, () => 16 * 1024 * 1024, (name) => name.toLowerCase().endsWith("project_settings.config"));
    if (r.overflow || r.entryOverflow) return [];
    entries = r.out;
  } catch {
    return [];
  }
  const data = Object.values(entries)[0];
  if (!data) return [];
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(strFromU8(data));
  } catch {
    return [];
  }
  const arr = (k: string) => (Array.isArray(o[k]) ? (o[k] as unknown[]).map(String) : []);
  const colors = arr("filament_colour");
  const types = arr("filament_type");
  const presets = arr("filament_settings_id");
  return colors.map((c, i) => ({
    head: i + 1,
    hex: HEX.test(c) ? c.toUpperCase() : "#FFFFFF",
    type: types[i] ?? "",
    preset: presets[i] ?? "",
  }));
}

export type LoadSheetCopy = {
  lang: string;
  dir: "ltr" | "rtl";
  title: string;
  printer: string;
  head: string;
  color: string;
  material: string;
  preset: string;
  swapsTitle: string;
  footer: string;
};

/** A complete, self-contained HTML document for printing. Everything interpolated is escaped. */
export function loadSheetHtml(o: { fileName: string; printerName: string; rows: LoadSheetRow[]; swaps: string[]; copy: LoadSheetCopy; date: string }): string {
  const { copy } = o;
  const rows = o.rows
    .map(
      (r) =>
        `<tr><td class="n">T${r.head}</td><td><span class="sw" style="background:${esc(r.hex)}"></span><code>${esc(r.hex)}</code></td><td>${esc(r.type)}</td><td>${esc(r.preset)}</td></tr>`,
    )
    .join("");
  const swaps = o.swaps.length
    ? `<h2>${esc(copy.swapsTitle)}</h2><ol>${o.swaps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>`
    : "";
  return `<!doctype html><html lang="${esc(copy.lang)}" dir="${copy.dir}"><head><meta charset="utf-8"><title>${esc(copy.title)} — ${esc(o.fileName)}</title>
<style>
body{font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#111;background:#fff;margin:24px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:20px 0 6px}
.meta{color:#555;margin:0 0 16px}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:8px 10px;text-align:start;vertical-align:middle}
th{background:#f2f2f2}.n{font-weight:700;width:3.5em}
.sw{display:inline-block;width:28px;height:28px;border:1px solid #888;border-radius:4px;vertical-align:middle;margin-inline-end:10px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
code{font:13px ui-monospace,Menlo,monospace}footer{margin-top:24px;color:#777;font-size:12px}
@page{margin:14mm}
</style></head><body>
<h1>${esc(copy.title)}</h1>
<p class="meta"><strong>${esc(o.fileName)}</strong> · ${esc(copy.printer)}: ${esc(o.printerName)} · ${esc(o.date)}</p>
<table><thead><tr><th>${esc(copy.head)}</th><th>${esc(copy.color)}</th><th>${esc(copy.material)}</th><th>${esc(copy.preset)}</th></tr></thead><tbody>${rows}</tbody></table>
${swaps}
<footer>${esc(copy.footer)}</footer>
</body></html>`;
}
