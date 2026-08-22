"use client";

// Browse a pre-baked catalog of OrcaSlicer filament profiles and install them into Snapmaker Orca.
// The profiles are static, ready-to-install files (see /public/orca-filaments) — this component never
// parses or transforms them; it fetches the file and writes it verbatim as "<name>.json".
//
// Two install paths, feature-detected at runtime:
//  1. File System Access API (Chrome/Edge) → pick the filament folder once (handle persisted in
//     IndexedDB), then one-click write.
//  2. Fallback (Safari/Firefox) → download the file + show a manual import guide.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { zipSync, strToU8 } from "fflate";
import { Link } from "@/i18n/navigation";
import NoticeIcon from "@/components/NoticeIcon";

// Shared rich-text tags for the install copy. Passed to t.rich so translators mark up emphasis and
// literal paths (folder names, "File → Import") inline instead of us splitting sentences — which
// never survives translation into languages with different word order.
const b = (c: ReactNode) => <span className="font-semibold text-fg">{c}</span>;
const code = (c: ReactNode) => <code className="text-violet-300">{c}</code>;

type Profile = { id: string; name: string; vendor: string; type: string; nozzleTemp: number; bedTemp: number; file: string };
type Manifest = { machine: string; vendors: string[]; types: string[]; profiles: Profile[] };

const BASE = "/orca-filaments/";
const WARNED_KEY = "bedready.orca-filaments.warned";

const OS_PATHS: { os: string; path: string }[] = [
  { os: "Windows", path: "%APPDATA%\\Snapmaker_Orca\\user\\default\\filament" },
  { os: "macOS", path: "~/Library/Application Support/Snapmaker_Orca/user/default/filament" },
  { os: "Linux", path: "~/.config/Snapmaker_Orca/user/default/filament" },
];

function detectOs(): string {
  if (typeof navigator === "undefined") return "macOS";
  const ua = navigator.userAgent;
  // Android/ChromeOS UAs also contain "Linux"/"CrOS" — check them first so they don't get the (desktop)
  // Linux direct-write path or the ~/.config hint (Snapmaker Orca is desktop-only anyway).
  if (/Android/i.test(ua)) return "Android";
  if (/CrOS/i.test(ua)) return "ChromeOS";
  if (/Win/i.test(ua)) return "Windows";
  if (/Mac/i.test(ua)) return "macOS";
  if (/Linux|X11/i.test(ua)) return "Linux";
  return "macOS";
}

// ── IndexedDB: persist the chosen directory handle so the user picks their filament folder only once ──
const IDB = { db: "bedready-orca", store: "handles", key: "filamentDir" };
function idbGet(): Promise<any> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB.db, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB.store);
      req.onsuccess = () => {
        try {
          const g = req.result.transaction(IDB.store, "readonly").objectStore(IDB.store).get(IDB.key);
          g.onsuccess = () => resolve(g.result ?? null);
          g.onerror = () => resolve(null);
        } catch { resolve(null); }
      };
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}
function idbSet(val: any): Promise<void> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB.db, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB.store);
      req.onsuccess = () => {
        try {
          const tx = req.result.transaction(IDB.store, "readwrite");
          tx.objectStore(IDB.store).put(val, IDB.key);
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        } catch { resolve(); }
      };
      req.onerror = () => resolve();
    } catch { resolve(); }
  });
}

// A profile name must be a legal single filename (no path separators / reserved chars).
function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim() || "filament";
}

// De-duplicate filenames within a batch: many catalog profiles share a display name ("Generic PETG"
// across 10 vendors), so a plain "<name>.json" key would silently overwrite. Disambiguate collisions
// with the unique profile id so every one is written/zipped.
function fileNameFor(p: Profile, used: Set<string>): string {
  let name = safeName(p.name) + ".json";
  if (used.has(name)) name = `${safeName(p.name)}-${p.id}.json`;
  used.add(name);
  return name;
}

export default function OrcaFilaments({ initialVendor = "", initialType = "" }: { initialVendor?: string; initialType?: string }) {
  const t = useTranslations("orca");
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [err, setErr] = useState("");
  const [vendor, setVendor] = useState(initialVendor); // brand landing pages pre-filter to their vendor
  const [type, setType] = useState(initialType); // material landing pages pre-filter to their type
  const [query, setQuery] = useState("");
  const [supportsFs, setSupportsFs] = useState(false);
  const [os] = useState(detectOs);
  const [toast, setToast] = useState<{ msg: string; kind: "ok" | "warn" | "err" } | null>(null);
  const [pending, setPending] = useState<Profile | "bulk" | null>(null); // one-time "quit Orca" modal (single or bulk)
  const [busy, setBusy] = useState<string | null>(null); // id of the profile currently installing
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null); // bulk install progress
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    const fsApi = typeof window !== "undefined" && "showDirectoryPicker" in window;
    setSupportsFs(fsApi);
    // Chromium blocks writing into macOS ~/Library and Windows %APPDATA% (where the folder lives), so
    // direct install only works on Linux. Open the import guide by default everywhere else, so the
    // reliable download + import path is visible.
    if (!fsApi || detectOs() !== "Linux") setShowGuide(true);
    fetch(BASE + "manifest.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("no manifest"))))
      .then((m: Manifest) => setManifest(m))
      .catch(() => setErr(t("catalogError")));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount; `t` is stable per locale
  }, []);

  // Can we write straight into the filament folder? Needs the API AND a non-blocked location. Chromium's
  // File System Access API blocks its "sensitive" dirs — macOS ~/Library AND Windows %APPDATA% (both
  // kBlockAllChildren) — which is exactly where Snapmaker Orca's config lives. So direct write only works
  // on Linux (~/.config); macOS and Windows fall back to download + import (a picked folder there just
  // errors with "choose a different folder").
  const directInstall = supportsFs && os === "Linux";

  function flash(msg: string, kind: "ok" | "warn" | "err" = "ok") {
    setToast({ msg, kind });
    window.setTimeout(() => setToast((t) => (t && t.msg === msg ? null : t)), 5000);
  }

  const shown = useMemo(() => {
    const list = manifest?.profiles ?? [];
    const q = query.trim().toLowerCase();
    return list.filter(
      (p) =>
        (!vendor || p.vendor === vendor) &&
        (!type || p.type === type) &&
        (!q || p.name.toLowerCase().includes(q) || p.vendor.toLowerCase().includes(q)),
    );
  }, [manifest, vendor, type, query]);

  async function download(p: Profile) {
    try {
      const res = await fetch(BASE + p.file);
      if (!res.ok) throw new Error();
      const blob = new Blob([await res.text()], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = safeName(p.name) + ".json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      flash(t("downloadFailed"), "err");
    }
  }

  async function ensurePermission(handle: any): Promise<boolean> {
    const opts = { mode: "readwrite" as const };
    try {
      if ((await handle.queryPermission?.(opts)) === "granted") return true;
      if ((await handle.requestPermission?.(opts)) === "granted") return true;
    } catch { /* older handle / denied */ }
    return false;
  }

  async function pickDir(): Promise<any> {
    const saved = await idbGet();
    if (saved && (await ensurePermission(saved))) return saved;
    try {
      const handle = await (window as any).showDirectoryPicker({ mode: "readwrite", id: "snapmaker-orca-filament" });
      if (handle) await idbSet(handle);
      return handle;
    } catch {
      return null; // user cancelled the picker
    }
  }

  async function doInstall(p: Profile) {
    setBusy(p.id);
    try {
      const dir = await pickDir();
      if (!dir) { setBusy(null); return; } // cancelled — no toast
      if (!String(dir.name || "").toLowerCase().includes("filament")) {
        flash(t("wrongFolder", { name: dir.name }), "warn");
      }
      const res = await fetch(BASE + p.file);
      if (!res.ok) throw new Error("fetch");
      const text = await res.text();
      const fh = await dir.getFileHandle(safeName(p.name) + ".json", { create: true });
      const w = await fh.createWritable();
      await w.write(text);
      await w.close();
      flash(t("installedOne", { name: p.name }), "ok");
    } catch {
      // Blocked/denied/stale folder — clear the saved handle so the next attempt re-picks, then don't
      // dead-end: download + show the guide.
      try { await idbSet(null); } catch { /* ignore */ }
      download(p);
      setShowGuide(true);
      flash(t("writeFailed", { file: safeName(p.name) + ".json" }), "warn");
    }
    setBusy(null);
  }

  // Bulk download as a single .zip — the automation path where direct write isn't possible (macOS,
  // Safari/Firefox). The user unzips it into their filament folder in one go.
  async function downloadAllZip(list: Profile[]) {
    setBulk({ done: 0, total: list.length });
    const files: Record<string, Uint8Array> = {};
    const used = new Set<string>();
    for (let i = 0; i < list.length; i++) {
      setBulk({ done: i, total: list.length });
      try {
        const res = await fetch(BASE + list[i].file);
        if (res.ok) files[fileNameFor(list[i], used)] = strToU8(await res.text());
      } catch { /* skip this one */ }
    }
    setBulk(null);
    const count = Object.keys(files).length;
    if (!count) { flash(t("downloadFailed"), "err"); return; }
    const url = URL.createObjectURL(new Blob([zipSync(files, { level: 6 })], { type: "application/zip" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "snapmaker-orca-filaments.zip";
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setShowGuide(true);
    flash(t("zipDone", { count }), "ok");
  }

  // Install every currently-shown profile with a SINGLE folder pick — the main time-saver (add a whole
  // brand/material set at once instead of clicking each). Skipped/failed items are counted, not fatal.
  async function doInstallAll(list: Profile[]) {
    const dir = await pickDir();
    if (!dir) return; // cancelled
    if (!String(dir.name || "").toLowerCase().includes("filament")) {
      flash(t("wrongFolder", { name: dir.name }), "warn");
    }
    let ok = 0;
    const failed: string[] = [];
    const used = new Set<string>();
    setBulk({ done: 0, total: list.length });
    for (let i = 0; i < list.length; i++) {
      setBulk({ done: i, total: list.length });
      try {
        const res = await fetch(BASE + list[i].file);
        if (!res.ok) throw new Error();
        const text = await res.text();
        const fh = await dir.getFileHandle(fileNameFor(list[i], used), { create: true });
        const w = await fh.createWritable();
        await w.write(text);
        await w.close();
        ok++;
      } catch {
        failed.push(list[i].name);
      }
    }
    setBulk(null);
    // If every write failed the saved folder handle is probably stale (folder moved/deleted) — clear it so
    // the next attempt re-prompts instead of silently failing forever.
    if (ok === 0 && failed.length) { try { await idbSet(null); } catch { /* ignore */ } }
    flash(
      failed.length
        ? t("installedPartial", { ok, total: list.length, failed: failed.length })
        : t("installedAll", { count: ok }),
      failed.length ? "warn" : "ok",
    );
  }

  function onAdd(p: Profile) {
    if (!directInstall) {
      // Can't write directly (macOS ~/Library block, or Safari/Firefox) → download + import in Orca.
      download(p);
      setShowGuide(true);
      flash(t("downloadedImport", { file: safeName(p.name) + ".json" }), "ok");
      return;
    }
    let warned = false;
    try { warned = localStorage.getItem(WARNED_KEY) === "1"; } catch { /* private mode */ }
    if (!warned) { setPending(p); return; } // one-time warning before the first add
    doInstall(p);
  }

  function installAll() {
    if (shown.length === 0 || bulk) return;
    if (!directInstall) { downloadAllZip(shown); return; } // no direct write → one .zip to unzip
    let warned = false;
    try { warned = localStorage.getItem(WARNED_KEY) === "1"; } catch { /* private mode */ }
    if (!warned) { setPending("bulk"); return; }
    doInstallAll(shown);
  }

  function confirmWarning() {
    try { localStorage.setItem(WARNED_KEY, "1"); } catch { /* private mode */ }
    const p = pending;
    setPending(null);
    if (p === "bulk") doInstallAll(shown);
    else if (p) doInstall(p);
  }

  const activePath = OS_PATHS.find((o) => o.os === os) ?? OS_PATHS[1];

  if (err) return <p className="notice notice-warn mt-8"><NoticeIcon level="warn" />{err}</p>;
  if (!manifest) return <p className="mt-8 text-sm text-fg-muted">{t("loading")}</p>;

  return (
    <div className="mt-8">
      {/* Where the folder is + how install works on this browser */}
      <div className="rounded-lg border border-line bg-surface-2 p-4 text-sm">
        <p className="text-fg-muted">
          {directInstall
            ? t.rich("modeDirect", { b })
            : os === "macOS" || os === "Windows"
              ? t.rich("modeDownloadImport", {
                  b,
                  code,
                  os,
                  dir: os === "macOS" ? "~/Library" : "%APPDATA%",
                  app: (c) => <Link href="/app" className="text-violet-300 hover:underline">{c}</Link>,
                })
              : t.rich("modeBrowserDownload", { b })}
        </p>
        <p className="mt-2 text-xs text-fg-subtle">
          {t("folderLabel", { os: activePath.os })}{" "}
          <code className="rounded bg-surface px-1.5 py-0.5 text-violet-300">{activePath.path}</code>
        </p>
        <p className="mt-1 text-xs text-fg-subtle">
          {t.rich("folderVaries", { code })}
        </p>
      </div>

      {/* Quit-first warning — profiles load at startup */}
      <p className="notice notice-warn mt-3 text-xs">
        <NoticeIcon level="warn" />
        <span>{t("quitFirstWarning")}</span>
      </p>

      {/* Filters */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchLabel")}
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-violet-400/50 focus:outline-none"
        />
        <select value={vendor} onChange={(e) => setVendor(e.target.value)} aria-label={t("brandLabel")} className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-fg">
          <option value="">{t("allBrands")}</option>
          {manifest.vendors.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label={t("materialLabel")} className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-fg">
          <option value="">{t("allMaterials")}</option>
          {manifest.types.map((ty) => <option key={ty} value={ty}>{ty}</option>)}
        </select>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-fg-subtle">
          {t("profileCount", { count: shown.length })} · {t("builtFor", { machine: manifest.machine })}
        </p>
        {shown.length > 1 && (
          <button
            onClick={installAll}
            disabled={!!bulk}
            className="btn-primary btn-sm"
          >
            {bulk
              ? directInstall
                ? t("bulkInstalling", { done: bulk.done, total: bulk.total })
                : t("bulkZipping", { done: bulk.done, total: bulk.total })
              : directInstall
                ? t("installAll", { count: shown.length })
                : t("downloadAll", { count: shown.length })}
          </button>
        )}
      </div>

      {/* ── WHY THE CARDS ARE NOT PRIMARY ─────────────────────────────────────────────────────────
          Every one of 1,271 cards carried `.btn-primary` — a saturated violet fill repeated down the
          whole page — while the genuinely primary action, "install/download all N", was a quiet
          tinted button above them. A grid in which everything is emphasised is a grid in which
          nothing is, and the one action that saves real time was the faintest thing on screen.

          Exactly inverted now: one primary above the grid, secondary in each card. */}
      {/* Grid */}
      {shown.length === 0 ? (
        <p className="mt-8 text-sm text-fg-muted">{t("noMatch")}</p>
      ) : (
        <div className="breakout mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((p) => (
            <div key={p.id} className="flex flex-col rounded-lg border border-line bg-surface-2 p-5">
              <h3 className="font-semibold text-fg">{p.name}</h3>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-xs text-fg-muted">{p.vendor}</span>
                <span className="rounded-full border border-violet-400/40 bg-violet-400/10 px-2 py-0.5 text-xs text-violet-300">{p.type}</span>
              </div>
              <p className="mt-3 text-xs text-fg-subtle">{t("temps", { nozzle: p.nozzleTemp, bed: p.bedTemp })}</p>
              <div className="mt-4 flex flex-col gap-2">
                {directInstall ? (
                  <>
                    <button
                      onClick={() => onAdd(p)}
                      disabled={busy === p.id}
                      className="btn-secondary btn-sm"
                    >
                      {busy === p.id ? t("installing") : t("addToOrca")}
                    </button>
                    <button
                      onClick={() => download(p)}
                      className="btn-secondary btn-sm"
                    >
                      {t("downloadJson")}
                    </button>
                  </>
                ) : (
                  // No direct write (macOS ~/Library block, or Safari/Firefox): download → import in Orca.
                  <button
                    onClick={() => onAdd(p)}
                    className="btn-secondary btn-sm"
                  >
                    {t("downloadForOrca")}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Manual import guide (always available; auto-opened on fallback download) */}
      <div className="mt-10 rounded-lg border border-line bg-surface-2 p-5">
        <button onClick={() => setShowGuide((s) => !s)} className="flex w-full items-center justify-between text-left focus:outline-none" aria-expanded={showGuide}>
          <span className="font-semibold text-fg">{t("guideTitle")}</span>
          <span className="text-fg-subtle" aria-hidden>{showGuide ? "▲" : "▼"}</span>
        </button>
        {showGuide && (
          <div className="mt-3 text-sm text-fg-muted">
            <p className="font-medium text-fg">{t("guideImportTitle")}</p>
            <p className="mt-1">
              {t.rich("guideImportBody", { b, code })}
            </p>
            <p className="mt-3 font-medium text-fg">{t("guideFolderTitle")}</p>
            <p className="mt-1">
              {t.rich("guideFolderBody", { code })}
            </p>
            <ul className="mt-1 space-y-0.5 text-xs text-fg-subtle">
              {OS_PATHS.map((o) => (
                <li key={o.os}><span className={o.os === os ? "font-medium text-fg-muted" : ""}>{o.os}:</span> <code className="text-violet-300">{o.path}</code></li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* One-time "quit Orca first" modal before the first install */}
      {pending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-6" onClick={() => setPending(null)}>
          <div className="w-full max-w-sm rounded-lg border border-line bg-surface p-5 text-sm shadow-xl" onClick={(e) => e.stopPropagation()}>
            <p className="font-semibold text-fg">{t("modalTitle")}</p>
            <p className="mt-2 text-fg-muted">
              {t("modalBody")}
            </p>
            <p className="mt-2 text-xs text-fg-subtle">
              {t("modalPickOnce")}{" "}
              {pending === "bulk" ? t("modalBulk", { count: shown.length }) : t("modalSingle", { name: pending.name })}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setPending(null)} className="rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-sm text-fg transition hover:bg-surface-3">{t("cancel")}</button>
              <button onClick={confirmWarning} className="btn-primary btn-sm">{t("continueClosed")}</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          role="status"
          className={`fixed bottom-4 left-1/2 z-50 max-w-[92vw] -translate-x-1/2 rounded-lg border px-4 py-2.5 text-sm shadow-lg ${
            toast.kind === "ok"
              ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200"
              : toast.kind === "warn"
                ? "border-amber-400/40 bg-amber-400/10 text-amber-200"
                : "border-red-400/40 bg-red-400/10 text-red-200"
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}
