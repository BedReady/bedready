// Background download interception (the primary, selector-free mechanism). Detects a .3mf download from
// MakerWorld / Printables / Thingiverse, converts it in-place using the SAME engine as the site (nothing
// is uploaded), and saves the file for the printer picked in the popup (settings.ts; the U1 by default). Works regardless of how the page's download button is built.
// Runs as a service worker in Chrome and as a non-persistent event page in Firefox (see the two manifests).
//
// Tested installed in real Chrome by `extension/installed-test.mjs` (a faked MakerWorld download: convert,
// retarget + keep original, already-set-up file left alone). Not covered there: real MakerWorld CDN
// redirects and Firefox — for those, open the background console (Chrome: chrome://extensions →
// "service worker"; Firefox: about:debugging → Inspect) and read the [BedReady] logs.
import { cleanThreeMF, detectProfile } from "../../src/lib/convert";
import { loadSettings, machineOf, quickOpts, shortName, suffixOf, isOurOutput, alreadyFor, type Settings } from "./settings";
import { checkFit } from "../../src/lib/fit-check";
import { stash, take, sweep, keptSource, SWEEP_ALARM, editorUrl, bytesToBase64 } from "./handoff";
import { sourcePage } from "../../src/lib/source-page";
import { t } from "./i18n";

// Cross-browser API handle: Firefox exposes `browser` (promise-based); Chrome MV3's `chrome` is also
// promise-based. `browser ?? chrome` yields a promise-returning API in both, so `await`/`.catch()` work.
declare const browser: any;
declare const chrome: any;
const api: any = typeof browser !== "undefined" ? browser : chrome;

const MAX_OUTPUT_BYTES = 80 * 1024 * 1024; // cap the converted output we inline as a base64 data: URL
const SITE_RE = /(^|\.)(makerworld\.com(\.cn)?|printables\.com|thingiverse\.com)$/i;
// Hosts that actually serve the .3mf *bytes* for the sites above. The download often lands via a
// cross-origin redirect to a CDN, and depending on the site's Referrer-Policy the referrer can be
// dropped — leaving only the CDN host to go on. MakerWorld files come from *.bblmw.com (Bambu's
// MakerWorld CDN, exclusively their infra — a .3mf there is always a MakerWorld model), which is NOT
// a SITE_RE domain, so without this a referrer-less MakerWorld download is silently skipped. Printables
// (files/media.printables.com) and Thingiverse (cdn.thingiverse.com) file hosts are subdomains of the
// site domains, so SITE_RE already covers those. Keep in sync with host_permissions (bblmw.com is there).
const CDN_RE = /(^|\.)bblmw\.(com|cn)$/i;
const MAKERWORLD_RE = /(^|\.)makerworld\.com(\.cn)?$/i;
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
async function toast(state: "working" | "done" | "error", text: string, action?: "edit") {
  try {
    const tabs = await api.tabs.query({ active: true, currentWindow: true });
    const id = tabs?.[0]?.id;
    if (id != null) api.tabs.sendMessage(id, { type: "bedready-toast", state, text, action }).catch(() => {});
  } catch { /* no active tab / no content script */ }
}
// The active tab's address. Readable only for sites in host_permissions (no `tabs` permission), which
// are exactly the model sites; anything else reads as undefined.
async function activeTabUrl(): Promise<string | undefined> {
  try {
    const tabs = await api.tabs.query({ active: true, currentWindow: true });
    return typeof tabs?.[0]?.url === "string" ? tabs[0].url : undefined;
  } catch {
    return undefined;
  }
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
  if (isOurOutput(base)) return;
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
  // Read on every event, never cached in a variable: a service worker is torn down between downloads.
  const settings = await loadSettings();
  if (!settings.autoConvert) return; // the popup's "Convert downloads automatically" switch is off

  const key = url.split("?")[0]; // ignore expiring query params
  if (inFlight.has(key)) {
    await api.downloads.cancel(item.id).catch(() => {}); // a duplicate click — already converting this file
    return;
  }
  inFlight.add(key);
  try {
    // NB: we do NOT cancel the user's original download yet. We convert first and only cancel it on
    // success (right before saving the converted file) — so if anything fails, the user still gets their
    // real .3mf instead of nothing. (If the original finishes before we do, the cancel is a harmless
    // no-op and the user simply keeps both files.)
    console.log("[BedReady] intercepting .3mf:", url, "(from", from + ")");
    // The model page, for the editor's `src`: the referrer when it is one, else the active tab when
    // that is a model page (a MakerWorld download's referrer is often just the site's origin).
    const src = sourcePage(item.referrer) ?? sourcePage(await activeTabUrl());
    await convertRemote(url, base, settings, async () => {
      if (!settings.keepOriginal) await api.downloads.cancel(item.id).catch(() => {});
    }, src);
  } finally {
    inFlight.delete(key);
  }
});

/**
 * Fetch a model file, convert it for the chosen printer and save the result, with the badge, toast and
 * notification along the way. Shared by download interception and the in-page MakerWorld button.
 * `beforeSave` runs only once the conversion has succeeded (interception cancels the original there).
 */
async function convertRemote(url: string, base: string, settings: Settings, beforeSave?: () => Promise<void>, src?: string | null): Promise<void> {
  const who = shortName(settings);
  setBadge("…", "#f97316"); // instant feedback: we caught the file and are working on it
  toast("working", t("toastWorking", { file: base, printer: who }));
  notify(t("notifyWorkingTitle"), t("notifyWorking", { file: base, printer: who }));
  try {
    // SW fetch bypasses CORS for hosts in host_permissions — if this blocks, the download host (often a
    // CDN like *.bblmw.com / files.printables.com) isn't covered; the logged URL says which to add.
    // No credentials: these are public presigned URLs (auth is in the query string), and sending
    // credentials breaks against a wildcard ACAO response.
    const res = await fetch(url);
    if (!res.ok) throw new Error("download fetch " + res.status);
    const name = base.toLowerCase().endsWith(".3mf") ? base : base + ".3mf";
    const file = new File([await res.arrayBuffer()], name);
    // Keep the ORIGINAL for the toast's "Edit colours" link: the editor should start from the
    // creator's file, not from our one-click result. Best-effort — a full disk only loses the link.
    const kept = await stash(file, name, src).catch(() => false);
    // Already set up for this printer (a creator who published a U1 profile, say) → converting again
    // would only rewrite what is there. Leave the user's own download untouched and say so.
    const info = await detectProfile(file).catch(() => null);
    if (info && alreadyFor(settings, info)) {
      setBadge("✓", "#16a34a", 6000);
      toast("done", t("toastAlready", { file: base, printer: who }));
      console.log("[BedReady] already for target, left alone:", base, info.printer);
      return;
    }
    // No UI to ask, so default to keeping every colour: pass fullSpectrum, which the engine applies
    // ONLY to painted files with >4 colours (dithered 2-/3-filament mixes of the 4 heads) and ignores
    // otherwise. So ≤4-colour and unpainted files convert exactly as before.
    const out = await cleanThreeMF(file, settings.target, quickOpts(settings));
    const outBytes = new Uint8Array(await out.blob.arrayBuffer());
    // A data: URL holds the output ~1.33× as base64; guard very large outputs rather than risk a failed/
    // memory-heavy save. Leave the original download in place and point to the popup.
    if (outBytes.length > MAX_OUTPUT_BYTES) {
      setBadge("!", "#dc2626", 8000);
      toast("error", t("toastTooLarge", { file: base }));
      notify(t("notifyTooLargeTitle"), t("notifyTooLarge", { file: base }));
      return;
    }
    // Success — now replace the original with the converted file.
    await beforeSave?.();
    const outName = name.replace(/\.3mf$/i, "") + suffixOf(settings.target);
    await api.downloads.download({ url: bytesToDataUrl(outBytes), filename: outName, saveAs: false });
    const fsMixes = out.diff?.fullSpectrumMixes ?? 0;
    const colorNote = fsMixes > 0 ? " " + t("fullSpectrumNote", { total: out.colorsTotal }) : "";
    setBadge("✓", "#16a34a", 6000);
    toast("done", t("toastDone", { out: outName, printer: who }) + colorNote, kept ? "edit" : undefined);
    notify(t("notifyDoneTitle"), t("notifyDone", { out: outName, printer: who }) + colorNote);
    console.log("[BedReady] converted →", outName);
  } catch (e) {
    // The original was never cancelled, so the user still has their real .3mf — point to the popup.
    console.error("[BedReady] conversion failed (original left intact):", e);
    setBadge("!", "#dc2626", 8000);
    toast("error", t("toastFailed", { file: base }));
    notify(t("notifyFailedTitle"), t("toastFailed", { file: base }));
  }
}

// ---------- the in-page MakerWorld button (content.ts) ----------
// The content script asks MakerWorld for the signed file link (that call needs the user's MakerWorld
// session, so it runs in the page) and hands the link here: the bytes live on Bambu's CDN, which only
// the extension's host permission can fetch without CORS. Only a MakerWorld tab may ask, and only for
// a CDN or MakerWorld URL, so a message can never point this at some other host.
api?.runtime?.onMessage?.addListener((msg: { type?: string; url?: string; name?: string }, sender: { tab?: { url?: string } }) => {
  if (msg?.type !== "bedready-convert-url" || typeof msg.url !== "string") return;
  if (!MAKERWORLD_RE.test(host(sender?.tab?.url || ""))) return;
  const h = host(msg.url);
  if (!(CDN_RE.test(h) || MAKERWORLD_RE.test(h)) || !msg.url.startsWith("https://")) return;
  const base = (typeof msg.name === "string" && msg.name.trim() ? msg.name.trim() : "model.3mf").replace(/[\\/:*?"<>|]/g, "_");
  const key = msg.url.split("?")[0];
  if (inFlight.has(key)) return;
  inFlight.add(key);
  void (async () => {
    try {
      await convertRemote(msg.url!, base, await loadSettings(), undefined, sender?.tab?.url);
    } finally {
      inFlight.delete(key);
    }
  })();
});

// ---------- "Check fit" on a MakerWorld page (content.ts) ----------
// Same route as the button above — the page gets the signed link, the bytes come from the CDN here —
// but nothing is saved: the file is read with the converter's own analysis (lib/fit-check.ts) and
// one line goes back. Only ever on the user's click; the page never asks on its own. The bytes are
// kept for "Open in BedReady" exactly as the toast's "Edit colours" keeps them (handoff.ts: one file,
// 30 minutes at most).
api?.runtime?.onMessage?.addListener(
  (msg: { type?: string; url?: string; name?: string }, sender: { tab?: { url?: string } }, sendResponse: (r: unknown) => void) => {
    if (msg?.type !== "bedready-check-fit" || typeof msg.url !== "string") return;
    if (!MAKERWORLD_RE.test(host(sender?.tab?.url || ""))) return;
    const h = host(msg.url);
    if (!(CDN_RE.test(h) || MAKERWORLD_RE.test(h)) || !msg.url.startsWith("https://")) return;
    const base = (typeof msg.name === "string" && msg.name.trim() ? msg.name.trim() : "model.3mf").replace(/[\\/:*?"<>|]/g, "_");
    const name = base.toLowerCase().endsWith(".3mf") ? base : base + ".3mf";
    void (async () => {
      try {
        const res = await fetch(msg.url!);
        if (!res.ok) throw new Error("download fetch " + res.status);
        const file = new File([await res.arrayBuffer()], name);
        const kept = await stash(file, name, sender?.tab?.url).catch(() => false);
        const s = await loadSettings();
        const line = await checkFit(file, { machine: machineOf(s), isU1: s.target === "u1", printer: shortName(s) });
        sendResponse(line ? { ok: true, line, kept } : { ok: false });
      } catch (e) {
        console.error("[BedReady] check fit failed:", e);
        sendResponse({ ok: false });
      }
    })();
    return true; // answering asynchronously
  },
);

// ---------- the editor handoff (handoff.ts) ----------
// The toast's "Edit colours" link: open /convert for the chosen printer, with our id so the page can
// fetch the file kept above. Opened from here, not the content script, because only the extension can
// name its own id and open a tab without the host page's popup blocker in the way.
api?.runtime?.onMessage?.addListener((msg: { type?: string }) => {
  if (msg?.type !== "bedready-open-editor") return;
  void (async () => {
    const s = await loadSettings();
    await api.tabs.create({ url: editorUrl(api, s.target, true, await keptSource().catch(() => null)) });
  })();
});

// bedready.io/convert asking for that file. `externally_connectable` already limits who can call;
// the origin is checked again so a future manifest edit cannot quietly widen it. One take, then gone.
api?.runtime?.onMessageExternal?.addListener(
  (msg: { type?: string }, sender: { url?: string; origin?: string }, sendResponse: (r: unknown) => void) => {
    let origin = sender?.origin || "";
    try { origin ||= new URL(sender?.url || "").origin; } catch { /* no url */ }
    if (origin !== "https://bedready.io" || msg?.type !== "bedready-take-file") return;
    void (async () => {
      try {
        const got = await take();
        if (!got) return sendResponse({ ok: false });
        sendResponse({ ok: true, name: got.name, b64: bytesToBase64(new Uint8Array(await got.blob.arrayBuffer())) });
      } catch {
        sendResponse({ ok: false });
      }
    })();
    return true; // answering asynchronously
  },
);

// ---------- makerworld.com.cn, opt-in (popup.ts) ----------
// Adding a site to the REQUIRED host permissions disables the extension for everyone who has it until
// they approve the new site (Chrome's rule for a permission warning added in an update). So the Chinese
// MakerWorld and its CDN are optional: the popup asks for them, and the content script is registered
// here only while they are granted. Run on every start, not just install: idempotent, and Firefox does
// not keep a registration across browser restarts the way Chrome does.
const CN_ORIGINS = ["https://makerworld.com.cn/*", "https://*.bblmw.cn/*"];
const CN_SCRIPT = "bedready-makerworld-cn";
async function syncCnScript(): Promise<void> {
  try {
    const granted = await api.permissions.contains({ origins: CN_ORIGINS });
    const registered = (await api.scripting.getRegisteredContentScripts({ ids: [CN_SCRIPT] })).length > 0;
    if (granted && !registered) {
      await api.scripting.registerContentScripts([{ id: CN_SCRIPT, matches: ["https://makerworld.com.cn/*"], js: ["dist/content.js"], runAt: "document_idle" }]);
    } else if (!granted && registered) {
      await api.scripting.unregisterContentScripts({ ids: [CN_SCRIPT] });
    }
  } catch (e) {
    console.log("[BedReady] makerworld.com.cn script not synced:", e);
  }
}
void syncCnScript();
// The kept original never outlives TTL_MS (see handoff.ts): on the alarm each stash sets, and on
// every wake of this worker in case the browser was closed when the alarm was due.
api?.alarms?.onAlarm?.addListener?.((a: { name?: string }) => {
  if (a?.name === SWEEP_ALARM) void sweep().catch(() => {});
});
void sweep().catch(() => {});

api?.permissions?.onAdded?.addListener?.(() => void syncCnScript());
api?.permissions?.onRemoved?.addListener?.(() => void syncCnScript());
