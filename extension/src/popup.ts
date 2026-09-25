// Popup: drag-drop / pick any .3mf and convert it for the U1. The always-works path (independent of
// site selectors). Reuses the website's conversion core, so behaviour matches /convert exactly.
//
// For a PAINTED file with >4 colours it offers Full Spectrum — keep every colour by dithering mixes of
// the 4 heads (2- and 3-filament) — instead of silently merging the extras into their nearest match.
// Simple files (≤4 colours or unpainted) stay drop-and-go: analyse, convert, done.
import { analyzeThreeMF, cleanThreeMF, convertWarnings, download, isWebKit, warningTextEn, OVER_FOUR_KEYS, type Analysis, type ConvertWarning } from "../../src/lib/convert";

declare const browser: any;
declare const chrome: any;
const api: any = typeof browser !== "undefined" ? browser : chrome;

// Base64-encode bytes in chunks (avoids arg-length limits on String.fromCharCode for big files).
function bytesToBase64(u8: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < u8.length; i += CHUNK) bin += String.fromCharCode(...u8.subarray(i, i + CHUNK));
  return btoa(bin);
}

// This function is injected into the ACTIVE TAB and runs in the page's origin. Safari honors the
// <a download> filename on a normal https page (unlike the extension-origin popup, where it saves a
// nameless blob), so this is how we get a correctly-named .u1.3mf on Safari.
function pageDownload(b64: string, name: string): boolean {
  try {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([u8], { type: "application/octet-stream" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 1500);
    return true;
  } catch {
    return false;
  }
}

// Save the converted file. Everywhere except Safari's extension popup, the shared download() names the
// file correctly. Safari's popup (extension origin) ignores the download-filename for blob AND won't
// download a data: URL, so there's NO way to save a named file from the popup itself — we inject the save
// into the active tab (page origin), where Safari names it. Falls back to the in-popup blob (nameless but
// saves something) if the tab can't be scripted (a restricted page, or older Safari without scripting).
async function saveResult(blob: Blob, filename: string): Promise<void> {
  if (!isWebKit()) {
    download(blob, filename);
    return;
  }
  try {
    const tabs = await api.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs?.[0]?.id;
    if (tabId == null) throw new Error("no active tab");
    const b64 = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
    const [res] = await api.scripting.executeScript({ target: { tabId }, func: pageDownload, args: [b64, filename] });
    if (!res?.result) throw new Error("injection returned false");
  } catch {
    download(blob, filename); // restricted page / no scripting → save nameless in the popup rather than nothing
  }
}

const input = document.getElementById("file") as HTMLInputElement;
const status = document.getElementById("status") as HTMLElement;
const opts = document.getElementById("opts") as HTMLElement;

type CleanResult = Awaited<ReturnType<typeof cleanThreeMF>>;

function resultText(r: CleanResult, fullSpectrum: boolean, warns: ConvertWarning[]): string {
  const mixes = r.diff?.fullSpectrumMixes ?? 0;
  const headline =
    fullSpectrum && mixes > 0
      ? `✓ Done — all ${r.colorsTotal} colours kept (4 filaments + ${mixes} Full Spectrum mix${mixes === 1 ? "" : "es"}).`
      : `✓ Done — ${r.colorsKept}/${r.colorsTotal} colours, ${r.preserved ? "kept the creator's settings" : "tested U1 profile"}.`;
  return [
    headline,
    r.diff?.bedShift ? `Nudged onto the U1 bed (+${r.diff.bedShift.dx}, +${r.diff.bedShift.dy}mm).` : "",
    r.diff && r.diff.clamped.length ? `Capped ${r.diff.clamped.length} speed setting(s) to U1 limits.` : "",
    r.diff?.vlhGuard ? "Disabled prime tower (variable layer height)." : "",
    ...warns.map((w) => `⚠ ${warningTextEn(w)}`),
  ]
    .filter(Boolean)
    .join("\n");
}

async function runConvert(f: File, fullSpectrum: boolean, analysis?: Analysis): Promise<void> {
  opts.innerHTML = "";
  status.textContent = "Converting in your browser…";
  try {
    const a = analysis ?? (await analyzeThreeMF(f));
    const r = await cleanThreeMF(f, "u1", { mode: "preserve", ...(fullSpectrum ? { fullSpectrum: true } : {}) });
    await saveResult(r.blob, f.name.replace(/\.3mf$/i, "") + ".u1.3mf");
    let warns = convertWarnings(a);
    // When Full Spectrum actually kept every colour, drop the "extra colours merge" advisory — it's the
    // no-mixing case's warning and would contradict the "all N colours kept" headline.
    if (fullSpectrum && (r.diff?.fullSpectrumMixes ?? 0) > 0)
      warns = warns.filter((w) => !OVER_FOUR_KEYS.includes(w.key));
    status.textContent = resultText(r, fullSpectrum, warns);
  } catch (e) {
    status.textContent = "Error: " + (e instanceof Error ? e.message : String(e));
  }
}

// >4 painted colours → let the user choose Full Spectrum (default on: keep all colours) vs merge.
function offerFullSpectrum(f: File, analysis: Analysis, colorCount: number): void {
  status.textContent = "";
  opts.innerHTML = "";
  const box = document.createElement("div");
  box.style.cssText = "margin-top:12px;padding:12px;border:1px solid #334155;border-radius:10px;background:#111c33";

  const info = document.createElement("p");
  info.style.cssText = "margin:0 0 8px;font-size:12px;color:#cbd5e1";
  info.textContent = `This file has ${colorCount} painted colours — more than the U1's 4 slots.`;
  box.appendChild(info);

  const lbl = document.createElement("label");
  lbl.style.cssText = "display:flex;gap:8px;align-items:flex-start;font-size:12px;color:#e2e8f0;cursor:pointer";
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = true;
  cb.style.marginTop = "2px";
  const span = document.createElement("span");
  span.textContent =
    "Keep every colour with Full Spectrum (mix the 4 filaments). Uncheck to merge the least-used extras into their nearest colour.";
  lbl.append(cb, span);
  box.appendChild(lbl);

  const btn = document.createElement("button");
  btn.textContent = "Convert for U1";
  btn.style.cssText =
    "margin-top:10px;width:100%;padding:8px;border:0;border-radius:8px;background:#f97316;color:#fff;font-size:13px;font-weight:600;cursor:pointer";
  btn.addEventListener("click", () => void runConvert(f, cb.checked, analysis));
  box.appendChild(btn);

  opts.appendChild(box);
}

async function handle(f: File): Promise<void> {
  if (!f.name.toLowerCase().endsWith(".3mf")) {
    status.textContent = "Please choose a .3mf file.";
    return;
  }
  opts.innerHTML = "";
  status.textContent = "Analysing…";
  let analysis: Analysis | undefined;
  try {
    analysis = await analyzeThreeMF(f);
  } catch {
    return runConvert(f, false); // unreadable metadata → just do the plain convert
  }
  // Only a painted file with >4 colours has a real choice to make; everything else is drop-and-go.
  if (analysis.painted && analysis.colors.length > 4) offerFullSpectrum(f, analysis, analysis.colors.length);
  else await runConvert(f, false, analysis);
}

input.addEventListener("change", () => {
  const f = input.files?.[0];
  if (f) void handle(f);
});

// Real drag-and-drop onto the drop zone (the primary path on Safari, where download-interception can't
// run). Highlight while dragging; convert the dropped .3mf.
const drop = document.getElementById("drop");
if (drop) {
  const stop = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  };
  (["dragenter", "dragover"] as const).forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      stop(e);
      drop.classList.add("dragging");
    }),
  );
  (["dragleave", "dragend"] as const).forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      stop(e);
      drop.classList.remove("dragging");
    }),
  );
  drop.addEventListener("drop", (e) => {
    stop(e);
    drop.classList.remove("dragging");
    const f = (e as DragEvent).dataTransfer?.files?.[0];
    if (f) void handle(f);
  });
}
