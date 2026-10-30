// Popup: drag-drop / pick any .3mf and convert it for the printer picked at the top (the U1 by default),
// and set what the background does with downloads (settings.ts). The always-works path (independent of
// site selectors). Reuses the website's conversion core, so behaviour matches /convert exactly.
//
// For a PAINTED file with >4 colours it offers Full Spectrum — keep every colour by dithering mixes of
// the 4 heads (2- and 3-filament) — instead of silently merging the extras into their nearest match.
// Simple files (≤4 colours or unpainted) stay drop-and-go: analyse, convert, done.
import { analyzeThreeMF, cleanThreeMF, convertWarnings, detectProfile, download, isWebKit, OVER_FOUR_KEYS, type Analysis, type ConvertWarning } from "../../src/lib/convert";
import { configFamily, U1_NOZZLES, U1_TESTED_NOZZLE } from "../../src/lib/targets";
import { stash, canHandOff, editorUrl, bytesToBase64 } from "./handoff";
import { t, warningText, localizeDocument } from "./i18n";
import { TARGETS, loadSettings, saveSettings, machineOf, quickOpts, shortName, suffixOf, alreadyFor, DEFAULTS, type Settings } from "./settings";

declare const browser: any;
declare const chrome: any;
const api: any = typeof browser !== "undefined" ? browser : chrome;

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
const targetSel = document.getElementById("target") as HTMLSelectElement;
const nozzleSel = document.getElementById("nozzle") as HTMLSelectElement;
const nozzleField = document.getElementById("nozzle-field") as HTMLElement;
const nozzleNote = document.getElementById("nozzle-note") as HTMLElement;
const autoBox = document.getElementById("auto") as HTMLInputElement;
const keepBox = document.getElementById("keep") as HTMLInputElement;
const prefs = document.getElementById("prefs") as HTMLElement;
const title = document.getElementById("title") as HTMLElement;
const siteLink = document.getElementById("site") as HTMLAnchorElement;

let settings: Settings = { ...DEFAULTS };
const editBtn = document.getElementById("edit") as HTMLButtonElement;
let current: File | null = null; // the file last chosen, for "Edit colours on bedready.io"

// Open the full editor with the ORIGINAL file (not our converted copy), for the chosen printer.
editBtn.addEventListener("click", () => {
  void (async () => {
    if (!current) return;
    const handed = canHandOff(api) && (await stash(current, current.name).catch(() => false));
    await api.tabs.create({ url: editorUrl(api, settings.target, handed) });
    if (!handed) status.textContent = t("openedSite", { file: current.name });
  })();
});

// ---------- settings UI ----------
// Grouped by vendor, as the website's picker is; the list is the engine's own registry (settings.ts).
function fillPicker(): void {
  const groups = new Map<string, typeof TARGETS>();
  for (const t of TARGETS) groups.set(t.vendor, [...(groups.get(t.vendor) ?? []), t]);
  for (const [vendor, list] of groups) {
    const g = document.createElement("optgroup");
    g.label = vendor;
    for (const t of list) g.append(new Option(t.label, t.id));
    targetSel.append(g);
  }
  for (const n of U1_NOZZLES) nozzleSel.append(new Option(t(n === U1_TESTED_NOZZLE ? "nozzleTested" : "nozzleSize", { size: n }), String(n)));
}

function reflect(): void {
  targetSel.value = settings.target;
  nozzleSel.value = String(settings.nozzle);
  autoBox.checked = settings.autoConvert;
  keepBox.checked = settings.keepOriginal;
  nozzleField.hidden = settings.target !== "u1";
  // Say which nozzle values are arithmetic rather than a real export — the site's rule (targets.ts).
  nozzleNote.hidden = settings.nozzle === U1_TESTED_NOZZLE;
  nozzleNote.textContent = t("nozzleNote", { size: U1_TESTED_NOZZLE });
  const m = machineOf(settings);
  title.textContent = t("title", { printer: settings.target === "generic" ? t("anySlicer") : m?.name.replace(/\s*\(.*\)$/, "") ?? shortName(settings) });
  siteLink.href = `https://bedready.io/convert?to=${encodeURIComponent(settings.target)}`;
}

async function update(patch: Partial<Settings>): Promise<void> {
  settings = { ...settings, ...patch };
  reflect();
  opts.replaceChildren(); // a half-made Full Spectrum choice was for the old printer
  await saveSettings(settings);
}

localizeDocument();
fillPicker();
targetSel.addEventListener("change", () => void update({ target: targetSel.value as Settings["target"] }));
nozzleSel.addEventListener("change", () => void update({ nozzle: Number(nozzleSel.value) }));
autoBox.addEventListener("change", () => void update({ autoConvert: autoBox.checked }));
keepBox.addEventListener("change", () => void update({ keepOriginal: keepBox.checked }));
// No downloads API (Safari) → interception cannot run, so its switches would promise nothing.
prefs.hidden = !api?.downloads;
reflect();
void (async () => {
  settings = await loadSettings();
  reflect();
})();

type CleanResult = Awaited<ReturnType<typeof cleanThreeMF>>;

function resultText(r: CleanResult, fullSpectrum: boolean, warns: ConvertWarning[], a?: Analysis, already = false): string {
  if (settings.target !== "u1") return retargetText(a, warns, already);
  const mixes = r.diff?.fullSpectrumMixes ?? 0;
  const headline =
    fullSpectrum && mixes > 0
      ? t("doneFullSpectrum", { total: r.colorsTotal, mixes })
      : t(r.preserved ? "doneKept" : "doneTested", { kept: r.colorsKept, total: r.colorsTotal });
  return [
    headline,
    already ? t("alreadySetUp", { printer: "U1" }) : "",
    r.diff?.bedShift ? t("bedShift", { dx: r.diff.bedShift.dx, dy: r.diff.bedShift.dy }) : "",
    r.diff && r.diff.clamped.length ? t("clamped", { count: r.diff.clamped.length }) : "",
    r.diff?.vlhGuard ? t("vlhGuard") : "",
    ...warns.map((w) => `⚠ ${warningText(w)}`),
  ]
    .filter(Boolean)
    .join("\n");
}

async function runConvert(f: File, fullSpectrum: boolean, analysis?: Analysis): Promise<void> {
  opts.innerHTML = "";
  status.textContent = t("converting");
  try {
    const a = analysis ?? (await analyzeThreeMF(f));
    const info = await detectProfile(f).catch(() => null);
    const already = !!info && alreadyFor(settings, info);
    // The popup asks before Full Spectrum; quickOpts turns it on unconditionally, so override it here.
    const o = settings.target === "u1" ? { ...quickOpts(settings), fullSpectrum } : quickOpts(settings);
    if (!o.fullSpectrum) delete o.fullSpectrum;
    const r = await cleanThreeMF(f, settings.target, o);
    await saveResult(r.blob, f.name.replace(/\.3mf$/i, "") + suffixOf(settings.target));
    let warns = convertWarnings(a);
    // When Full Spectrum actually kept every colour, drop the "extra colours merge" advisory — it's the
    // no-mixing case's warning and would contradict the "all N colours kept" headline.
    if (fullSpectrum && (r.diff?.fullSpectrumMixes ?? 0) > 0)
      warns = warns.filter((w) => !OVER_FOUR_KEYS.includes(w.key));
    status.textContent = resultText(r, fullSpectrum, warns, a, already);
  } catch (e) {
    status.textContent = t("error", { message: e instanceof Error ? e.message : String(e) });
  }
}

// A non-U1 target: same slicer family → the printer profile was rewritten; otherwise the file became a
// clean generic 3MF, because a Bambu config means nothing to PrusaSlicer. Say which, as /convert does.
function retargetText(a: Analysis | undefined, warns: ConvertWarning[], already: boolean): string {
  const m = machineOf(settings);
  const n = a?.colors.length ?? 0;
  const lines: string[] = [];
  if (!m) lines.push(t("doneGeneric"));
  else if (a?.flavour && configFamily(a.flavour) === configFamily(m.flavour)) lines.push(t("doneRewritten", { printer: m.name }));
  else lines.push(t("doneOtherSlicer", { printer: m.name }));
  if (already) lines.push(t("alreadySetUp", { printer: m?.name ?? shortName(settings) }));
  if (m && n > m.toolheads) lines.push("⚠ " + t("tooManyColors", { count: n, printer: m.name, heads: m.toolheads }));
  // The over-four advisories are U1 sentences (4 heads); everything else applies to any printer.
  lines.push(...warns.filter((w) => !OVER_FOUR_KEYS.includes(w.key)).map((w) => `⚠ ${warningText(w)}`));
  return lines.join("\n");
}

// >4 painted colours → let the user choose Full Spectrum (default on: keep all colours) vs merge.
function offerFullSpectrum(f: File, analysis: Analysis, colorCount: number): void {
  status.textContent = "";
  opts.innerHTML = "";
  const box = document.createElement("div");
  box.className = "choice";

  const info = document.createElement("p");
  info.textContent = t("fsIntro", { count: colorCount });
  box.appendChild(info);

  const lbl = document.createElement("label");
  lbl.className = "toggle";
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = true;
  const span = document.createElement("span");
  span.textContent = t("fsToggle");
  lbl.append(cb, span);
  box.appendChild(lbl);

  const btn = document.createElement("button");
  btn.textContent = t("fsButton");
  btn.className = "btn";
  btn.addEventListener("click", () => void runConvert(f, cb.checked, analysis));
  box.appendChild(btn);

  opts.appendChild(box);
}

async function handle(f: File): Promise<void> {
  if (!f.name.toLowerCase().endsWith(".3mf")) {
    status.textContent = t("chooseFile");
    return;
  }
  opts.innerHTML = "";
  current = f;
  editBtn.hidden = !api?.tabs; // outside an extension (the smoke-test page) there is nothing to open
  status.textContent = t("analysing");
  let analysis: Analysis | undefined;
  try {
    analysis = await analyzeThreeMF(f);
  } catch {
    return runConvert(f, false); // unreadable metadata → just do the plain convert
  }
  // Only a painted file with >4 colours, going to the U1 (the one target with Full Spectrum), has a real
  // choice to make; everything else is drop-and-go.
  if (settings.target === "u1" && analysis.painted && analysis.colors.length > 4) offerFullSpectrum(f, analysis, analysis.colors.length);
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
