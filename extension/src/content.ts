// Content script: on MakerWorld / Printables / Thingiverse, find .3mf download links and add a
// "→ U1" button that converts the file in-page (nothing uploaded) and downloads the U1-ready result.
// This reuses the SAME conversion core as the website (../../src/lib/convert) — bundled in by esbuild.
//
// ⚠️ Selectors below catch direct <a href="*.3mf"> links. Several of these sites trigger downloads via
// JS/buttons rather than plain anchors — those need per-site selector tuning (see README). The popup
// (drag-drop a downloaded file) is the always-works fallback.
import { cleanThreeMF, download } from "../../src/lib/convert";
// import { initMakerWorldColors } from "./makerworld-colors"; // paused — see note at the call site below

// Cross-browser: Firefox exposes `browser`, Chrome exposes `chrome`; either works for runtime.onMessage.
declare const browser: any;
declare const chrome: any;
const api: any = typeof browser !== "undefined" ? browser : chrome;

const HOSTS = /makerworld\.com|printables\.com|thingiverse\.com/;

// In-page toast — the universal feedback channel (works on any OS, no notification permission needed).
// The background worker messages us on intercept start/done/fail; we render it right on the page in a
// shadow root so the host site's CSS can't touch it.
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function showToast(state: "working" | "done" | "error", text: string) {
  let hostEl = document.getElementById("bedready-toast");
  if (!hostEl) {
    hostEl = document.createElement("div");
    hostEl.id = "bedready-toast";
    (document.body || document.documentElement).appendChild(hostEl);
  }
  let root = (hostEl as unknown as { _r?: ShadowRoot })._r;
  if (!root) root = (hostEl as unknown as { _r?: ShadowRoot })._r = hostEl.attachShadow({ mode: "open" });
  // Site tokens, not the extension's old orange: violet-600 is the action colour everywhere on
  // bedready.io, and emerald/red are what `.notice-ok` / a failure use there.
  const c = { working: "#7c3aed", done: "#059669", error: "#dc2626" }[state];
  // Drawn, not emoji. `⏳` and `⚠️` render as a different typeface on every OS — and this toast
  // appears on somebody else's page, which makes it the least controlled surface the product has.
  const icon = {
    working: '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 2.4v3.2"/><path d="M8 10.4v3.2" opacity=".35"/><path d="M13.6 8h-3.2" opacity=".6"/><path d="M5.6 8H2.4" opacity=".85"/></svg>',
    done: '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m3.2 8.4 3.1 3.1 6.5-6.9"/></svg>',
    error: '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.6 14.4 13.4H1.6L8 2.6Z"/><path d="M8 6.6v3"/><path d="M8 11.5h.01"/></svg>',
  }[state];
  // Static chrome only via innerHTML (icon/colour are from fixed internal maps). The dynamic `text`
  // (derived from a third-party download filename) is set via textContent so markup can't be injected.
  root.innerHTML = `<div style="position:fixed;top:16px;right:16px;z-index:2147483647;font:13px/1.45 ui-sans-serif,system-ui,-apple-system,sans-serif;background:#0f172a;color:#fff;border:1px solid ${c};border-left:4px solid ${c};border-radius:10px;padding:10px 14px;max-width:320px;box-shadow:0 8px 28px rgba(0,0,0,.4)"><b style="color:${c};display:inline-flex;align-items:center;gap:6px">${icon}BedReady</b><div class="bd-msg" style="margin-top:3px;color:#e2e8f0"></div></div>`;
  const msgEl = root.querySelector(".bd-msg");
  if (msgEl) msgEl.textContent = text;
  clearTimeout(toastTimer);
  if (state !== "working") toastTimer = setTimeout(() => hostEl?.remove(), 5000);
}
try {
  api.runtime?.onMessage?.addListener((msg: { type?: string; state?: "working" | "done" | "error"; text?: string }) => {
    // Validate state against the known set before it indexes the colour/icon maps (defensive — messages
    // only come from our own background worker, but never trust a message field blindly).
    if (msg?.type === "bedready-toast" && (msg.state === "working" || msg.state === "done" || msg.state === "error"))
      showToast(msg.state, msg.text || "");
  });
} catch { /* not in an extension context (e.g. the smoke-test page) */ }

async function convertUrl(url: string, name: string): Promise<void> {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`download failed (${res.status})`);
  const fname = name.toLowerCase().endsWith(".3mf") ? name : `${name}.3mf`;
  const file = new File([await res.arrayBuffer()], fname);
  // One-click button, no UI to ask — keep every colour by default (Full Spectrum applies only to painted
  // files with >4 colours, no-op otherwise), matching the download-interception path.
  const out = await cleanThreeMF(file, "u1", { mode: "preserve", fullSpectrum: true });
  download(out.blob, fname.replace(/\.3mf$/i, "") + ".u1.3mf");
}

function injectButton(anchor: HTMLAnchorElement): void {
  if (anchor.dataset.u1 === "1") return;
  anchor.dataset.u1 = "1";
  const btn = document.createElement("button");
  // No emoji. This button is the most-seen piece of the product — it appears on MakerWorld,
  // Printables and Thingiverse, pages we do not control — and `✨` rendered as a different glyph on
  // every OS. The site dropped 203 emoji on 2026-08-22; this was the one still out in the world.
  btn.textContent = "→ U1";
  btn.title = "Convert this .3mf for the Snapmaker U1 — in your browser, nothing uploaded";
  // SOLID violet, not a tint. The old button was `#f97316` text on a 10% orange wash, which assumes
  // a light host page: on a dark one it was orange-on-near-black at roughly 3:1. A filled
  // violet-600 with white text is 5.70:1 against its own fill and therefore legible on ANY
  // background, which is the only guarantee available when the page belongs to somebody else.
  Object.assign(btn.style, {
    marginLeft: "8px", padding: "3px 10px", fontSize: "12px", lineHeight: "1.4",
    fontWeight: "500", borderRadius: "8px", border: "0", background: "#7c3aed",
    color: "#fff", cursor: "pointer", verticalAlign: "middle",
  });
  btn.addEventListener("mouseenter", () => { btn.style.background = "#6d28d9"; });
  btn.addEventListener("mouseleave", () => { btn.style.background = "#7c3aed"; });
  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    btn.textContent = "converting…";
    try {
      await convertUrl(anchor.href, anchor.getAttribute("download") || "model.3mf");
      btn.textContent = "✓ U1 ready";
    } catch (err) {
      console.error("[BedReady]", err);
      btn.textContent = "open bedready.io →";
      btn.onclick = () => window.open("https://bedready.io/convert", "_blank");
    }
  });
  anchor.insertAdjacentElement("afterend", btn);
}

function scan(): void {
  // Case-insensitive, and also catch links that name a .3mf via the download attribute (their href is
  // often a signed/blob URL with no .3mf in it). Interception (background.ts) is still the primary,
  // selector-free path — this button is the visible affordance when a plain link is present.
  document
    .querySelectorAll<HTMLAnchorElement>('a[href$=".3mf" i], a[href*=".3mf?" i], a[download$=".3mf" i]')
    .forEach(injectButton);
}

if (HOSTS.test(location.host)) {
  scan();
  // initMakerWorldColors(): PAUSED — MakerWorld's grid feed carries no filament/colour data (it lives only
  // in each model's print profile on the detail page), so grid badging isn't achievable without a
  // per-model fetch. Left in the tree for a possible hover-prefetch redesign. See makerworld-colors.ts.
  // Debounce: a busy (or hostile) page can fire many mutations a second — coalesce them so we don't run a
  // full-document querySelectorAll on every one.
  let scanTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleScan = () => {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 300);
  };
  new MutationObserver(scheduleScan).observe(document.documentElement, { childList: true, subtree: true });
}
