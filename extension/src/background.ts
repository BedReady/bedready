// Background download interception (the primary, selector-free mechanism). Detects a .3mf download from
// MakerWorld / Printables / Thingiverse, converts it in-place using the SAME engine as the site (nothing
// is uploaded), and saves the U1-ready file. Works regardless of how the page's download button is built.
// Runs as a service worker in Chrome and as a non-persistent event page in Firefox (see the two manifests).
//
// ⚠️ UNTESTED in a live browser — verify manually: load unpacked, download a real .3mf, then open the
// background console (Chrome: chrome://extensions → "service worker"; Firefox: about:debugging → Inspect)
// to see the [BedReady] logs / any errors.
import { cleanThreeMF } from "../../src/lib/convert";

// Cross-browser API handle: Firefox exposes `browser` (promise-based); Chrome MV3's `chrome` is also
// promise-based. `browser ?? chrome` yields a promise-returning API in both, so `await`/`.catch()` work.
declare const browser: any;
declare const chrome: any;
const api: any = typeof browser !== "undefined" ? browser : chrome;

const MAX_OUTPUT_BYTES = 80 * 1024 * 1024; // cap the converted output we inline as a base64 data: URL
const SITE_RE = /(^|\.)(makerworld\.com|printables\.com|thingiverse\.com)$/i;
// Hosts that actually serve the .3mf *bytes* for the sites above. The download often lands via a
// cross-origin redirect to a CDN, and depending on the site's Referrer-Policy the referrer can be
// dropped — leaving only the CDN host to go on. MakerWorld files come from *.bblmw.com (Bambu's
// MakerWorld CDN, exclusively their infra — a .3mf there is always a MakerWorld model), which is NOT
// a SITE_RE domain, so without this a referrer-less MakerWorld download is silently skipped. Printables
// (files/media.printables.com) and Thingiverse (cdn.thingiverse.com) file hosts are subdomains of the
// site domains, so SITE_RE already covers those. Keep in sync with host_permissions (bblmw.com is there).
const CDN_RE = /(^|\.)bblmw\.com$/i;
const is3mf = (s: string) => /\.3mf(\?|$)/i.test(s || "");
const host = (u: string) => { try { return new URL(u).hostname; } catch { return ""; } };

// Service workers have no URL.createObjectURL, so hand api.downloads a base64 data: URL.
function bytesToDataUrl(u8: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < u8.length; i += CHUNK) bin += String.fromCharCode(...u8.subarray(i, i + CHUNK));
  return "data:model/3mf;base64," + btoa(bin);
}
// Primary feedback: an in-page toast rendered by the content script — works on any OS, no permission.
async function toast(state: "working" | "done" | "error", text: string) {
  try {
    const tabs = await api.tabs.query({ active: true, currentWindow: true });
    const id = tabs?.[0]?.id;
    if (id != null) api.tabs.sendMessage(id, { type: "bedready-toast", state, text }).catch(() => {});
  } catch { /* no active tab / no content script */ }
}
// Secondary, best-effort: a desktop notification (only if the OS/Chrome allows it).
let notifId = 0;
function notify(title: string, message: string) {
  try {
    api.notifications.create(`bedready-${notifId++}`, { type: "basic", iconUrl: api.runtime.getURL("icon128.png"), title, message });
  } catch { /* notifications permission/OS may be off */ }
}

let badgeTimer: ReturnType<typeof setTimeout> | undefined;
function setBadge(text: string, color: string, clearAfter = 0) {
  try {
    clearTimeout(badgeTimer);
    api.action.setBadgeBackgroundColor({ color });
    api.action.setBadgeText({ text });
    if (clearAfter) badgeTimer = setTimeout(() => api.action.setBadgeText({ text: "" }), clearAfter);
  } catch { /* best-effort */ }
}

// Dedupe: each click mints a fresh signed URL (changing query params), so key by the path only.
// While one is converting, suppress duplicate clicks of the same file instead of stacking conversions.
const inFlight = new Set<string>();

// Download interception needs the `downloads` API, which Safari does NOT implement. Optional-chain the
// registration so the background loads cleanly there instead of throwing — the popup (drag-drop) and the
// in-page "→ U1" button don't use this API, so the extension still works on Safari, just without
// auto-convert-on-download. (No-op on Chrome/Firefox, which have downloads.)
if (!api?.downloads?.onCreated) {
  console.log("[BedReady] downloads API unavailable (e.g. Safari) — auto-conversion on download is off; use the popup or the in-page button.");
}
api?.downloads?.onCreated?.addListener?.(async (item: { id: number; url?: string; finalUrl?: string; filename?: string; referrer?: string }) => {
  const url = item.finalUrl || item.url || "";
  const base = (item.filename || url).split(/[\\/?#]/).pop() || "model.3mf";
  // Our own converted output ends in .u1.3mf and is saved via a data: URL (no site referrer, so the
  // check below would already skip it) — but guard explicitly so we can never loop on our own download.
  if (/\.u1\.3mf$/i.test(base)) return;
  if (!is3mf(base) && !is3mf(url)) return;
  // Only act on downloads tied to the target sites, so we don't touch unrelated .3mf. Check every signal
  // we have — the referrer, the pre-redirect URL (item.url, e.g. thingiverse.com/download:..), and the
  // post-redirect bytes host (finalUrl) — and also accept a known model-site CDN host (bblmw) for the
  // case where the redirect to the CDN strips the referrer. Any one match is enough.
  const refHost = host(item.referrer || "");
  const srcHost = host(item.url || "");   // pre-redirect
  const urlHost = host(url);              // post-redirect (where the bytes live)
  const from = refHost || urlHost || srcHost;
  const fromSite = SITE_RE.test(refHost) || SITE_RE.test(srcHost) || SITE_RE.test(urlHost);
  const fromCdn = CDN_RE.test(srcHost) || CDN_RE.test(urlHost);
  if (!fromSite && !fromCdn) return;

  const key = url.split("?")[0]; // ignore expiring query params
  if (inFlight.has(key)) {
    await api.downloads.cancel(item.id).catch(() => {}); // a duplicate click — already converting this file
    return;
  }
  inFlight.add(key);
  setBadge("…", "#f97316"); // instant feedback: we caught the download and are working on it
  toast("working", `Converting ${base} for your U1… the U1-ready file will download automatically.`);
  notify("BedReady — converting…", `Making ${base} U1-ready in your browser. The converted file will download automatically.`);
  console.log("[BedReady] intercepting .3mf:", url, "(from", from + ")");
  try {
    // NB: we do NOT cancel the user's original download yet. We convert first and only cancel it on
    // success (right before saving the converted file) — so if anything fails, the user still gets their
    // real .3mf instead of nothing. (If the original finishes before we do, the cancel is a harmless
    // no-op and the user simply keeps both files.)
    // SW fetch bypasses CORS for hosts in host_permissions — if this blocks, the download host (often a
    // CDN like *.bblmw.com / files.printables.com) isn't covered; the logged URL says which to add.
    // No credentials: these are public presigned URLs (auth is in the query string), and sending
    // credentials breaks against a wildcard ACAO response.
    const res = await fetch(url);
    if (!res.ok) throw new Error("download fetch " + res.status);
    const name = base.toLowerCase().endsWith(".3mf") ? base : base + ".3mf";
    const file = new File([await res.arrayBuffer()], name);
    // Interception has no UI to ask, so default to keeping every colour: pass fullSpectrum, which the
    // engine applies ONLY to painted files with >4 colours (dithered 2-/3-filament mixes of the 4 heads)
    // and ignores otherwise. So ≤4-colour and unpainted files convert exactly as before.
    const out = await cleanThreeMF(file, "u1", { mode: "preserve", fullSpectrum: true });
    const outBytes = new Uint8Array(await out.blob.arrayBuffer());
    // A data: URL holds the output ~1.33× as base64; guard very large outputs rather than risk a failed/
    // memory-heavy save. Leave the original download in place and point to the popup.
    if (outBytes.length > MAX_OUTPUT_BYTES) {
      setBadge("!", "#dc2626", 8000);
      toast("error", `${base} converted but is too large to auto-save. Your original downloaded — convert it via the popup or bedready.io/convert.`);
      notify("BedReady — file too large to auto-save", `${base}: your original downloaded; convert it via the popup.`);
      return;
    }
    // Success — now replace the original with the converted file.
    await api.downloads.cancel(item.id).catch(() => {});
    const outName = name.replace(/\.3mf$/i, "") + ".u1.3mf";
    await api.downloads.download({ url: bytesToDataUrl(outBytes), filename: outName, saveAs: false });
    const fsMixes = out.diff?.fullSpectrumMixes ?? 0;
    const colorNote = fsMixes > 0 ? ` Kept all ${out.colorsTotal} colours via Full Spectrum.` : "";
    setBadge("✓U1", "#16a34a", 6000);
    toast("done", `Converted — ${outName} saved to Downloads, ready to slice on your U1.${colorNote}`);
    notify("BedReady ✓ Converted", `${outName} saved to Downloads — ready to slice on your U1.${colorNote}`);
    console.log("[BedReady] converted →", outName);
  } catch (e) {
    // We never cancelled the original, so the user still has their real .3mf — just point to the popup.
    console.error("[BedReady] interception failed (original download left intact):", e);
    setBadge("!", "#dc2626", 8000);
    toast("error", `Couldn't convert ${base}. Your original .3mf downloaded — convert it via the popup.`);
    notify("BedReady — conversion failed", `Couldn't convert ${base}. Your original .3mf downloaded — convert it via the popup.`);
  } finally {
    inFlight.delete(key);
  }
});
