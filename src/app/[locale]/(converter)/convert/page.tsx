"use client";

import { useTranslations, useFormatter } from "next-intl";
import { ldJson } from "@/lib/json-ld";
import { Link } from "@/i18n/navigation";
import { nextPaint } from "@/lib/next-paint";
import { peekPlates, extractPlate, type PlateInfo } from "@/lib/plates";
import { fitVerdict } from "@/lib/fit";
import { track } from "@vercel/analytics";
import { acquisitionProps } from "@/lib/acquisition";
import { stageConvertedFile } from "@/lib/convert-handoff";
import { convertApi } from "@/lib/convert-api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  analyzeThreeMF,
  ThreeMFError,
  reduceColors,
  normalizeHex,
  download,
  convertWarnings,
  bestMixMulti,
  bestPhysicalSet,
  subsetThreeMF,
  zipFiles,
  U1_BUILD_MM,
  U1_BUILD_Z_MM,
  type CleanTarget,
  type FilamentBrand,
  type Analysis,
  type DiffReport,
} from "@/lib/convert";
import { cleanThreeMFAsync } from "@/lib/convert-client";
import { MACHINES, RETARGET_MACHINES, configFamily, u1NozzleVariant, U1_NOZZLES, U1_TESTED_NOZZLE } from "@/lib/targets";
import { stlTo3MF } from "@/lib/stl";
import ConvertPresets, { type ConvertSettings } from "@/components/ConvertPresets";
import { SOURCE_REPO_URL } from "@/lib/links";
import NoticeIcon from "@/components/NoticeIcon";
import BeforeAfter from "@/components/BeforeAfter";

// Fire-and-forget global "converter used" counter. Goes through our own rate-limited route rather
// than calling the RPC directly, so `bump_counter` can be locked down to the service role — the
// homepage social-proof number was otherwise inflatable by anyone with a loop.
const bumpConvertCount = () => {
  try {
    void fetch(convertApi("/api/convert-count"), { method: "POST", keepalive: true }).catch(() => {});
  } catch {
    /* never block a conversion on the counter */
  }
};
import { mixRgb } from "@/lib/filament-mixer";

const hexToRgbArr = (h: string): [number, number, number] => {
  const s = h.replace("#", "").padEnd(6, "0");
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
};
const rgbArrHex = (rgb: [number, number, number]): string =>
  "#" + rgb.map((v) => Math.round(v).toString(16).padStart(2, "0").toUpperCase()).join("");
/** Hex of mixing two physical colours (1-based a/b into `physColours`) at mixBPercent% of b. */
const recipeHex = (physColours: string[], a: number, b: number, pct: number): string =>
  rgbArrHex(mixRgb(hexToRgbArr(physColours[a - 1]), hexToRgbArr(physColours[b - 1]), pct / 100));

type MixRecipe = { a: number; b: number; mixBPercent: number };
import { type MeshData, overhangReport } from "@/lib/paint";
import { extractMeshAsync } from "@/lib/mesh-client";
import { detectColorBandsForMesh } from "@/lib/color-bands";
import dynamic from "next/dynamic";
import ConvertCount from "@/components/ConvertCount";

// three.js lives only inside PaintPreview — load it on demand (after a mesh renders) so it stays out of
// the /convert initial bundle. ssr:false is fine: this page is client-only anyway.
const PaintPreview = dynamic(() => import("@/components/PaintPreview"), {
  ssr: false,
  loading: () => <div className="mt-4 aspect-square w-full animate-pulse rounded-lg border border-line bg-surface-2" />,
});
import ShareBedReady from "@/components/ShareBedReady";
import ContributeToLibrary from "@/components/ContributeToLibrary";
import ConvertCapture from "@/components/ConvertCapture";
import MyFilaments from "@/components/MyFilaments";
import { absoluteUrl } from "@/lib/origin";

type Status = "idle" | "ready" | "working" | "done" | "error";

// Pad/trim a colour array to exactly n slots (n = the selected target's toolhead count). For the U1
// and every other 4-slot target n === 4, so padN(arr, 4) is byte-identical to the old pad4.
function padN(arr: string[], n: number): string[] {
  const out = arr.slice(0, n).map(normalizeHex);
  while (out.length < n) out.push("#FFFFFF");
  return out;
}

// Above this a plate is worth flagging: extraction inflates it, re-zips it, then the normal path
// analyses the result — so the transient peak is a multiple of this number, and a 240 MB plate can
// take a tab (or the desktop app hosting it) down. Shown in amber so the cheap plates are obvious.
const HEAVY_PLATE = 120 * 1024 * 1024;

export default function ConvertPage() {
  const t = useTranslations("convert");
  const format = useFormatter();
  const [file, setFile] = useState<File | null>(null);
  // A picked plain .stl (geometry only). Kept in a distinct branch from the .3mf state machine — an STL
  // has no colours/profile, so it doesn't run analyze/convert; it just offers a one-click wrap-to-3MF.
  const [stlFile, setStlFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [mesh, setMesh] = useState<MeshData | null>(null);
  const [meshLoading, setMeshLoading] = useState(false);
  const [previewNote, setPreviewNote] = useState("");
  // Progress for long operations. null = indeterminate (one opaque burst); 0..1 = measured (splits).
  const [progress, setProgress] = useState<number | null>(null);
  // What the preview shows: "all", "plate:N" (a plate's parts together), or "part:i" (one part).
  const [sel, setSel] = useState<string>("all");
  // Split export: isolate parts into separate single-part files so each gets its own clean color setup.
  const [splitScope, setSplitScope] = useState<"part" | "plate">("plate");
  // True for models so large the browser may struggle (preview was skipped) — we proactively
  // offer the optional server converter as a more reliable path for these.
  const [bigFile, setBigFile] = useState(false);
  const [slots, setSlots] = useState<string[]>(["#FFFFFF", "#FFFFFF", "#FFFFFF", "#FFFFFF"]);
  const [assign, setAssign] = useState<number[]>([]);
  const [status, setStatus] = useState<Status>("idle");

  // ── The denominator for the done screen ───────────────────────────────────────────────────────
  //
  // `convert_success` fires from five places and is the count of CONVERSIONS. This counts the number
  // of times the done screen was actually SHOWN. Today the two are the same number; they stop being
  // the same the moment anything about this screen changes, and the whole point of measuring a
  // change is to compare against a denominator that did not move underneath it.
  //
  // On the transition into "done" only — a re-render must not inflate it, which is the ordinary way
  // a client-side view event ends up counting renders instead of views.
  const doneSeen = useRef(false);
  useEffect(() => {
    if (status !== "done") {
      doneSeen.current = false;
      return;
    }
    if (doneSeen.current) return;
    doneSeen.current = true;
    track("convert_done_view", { ...acquisitionProps() });
  }, [status]);
  // Chosen target printer. Default "u1" so nothing changes for existing users — the U1 stays the default.
  const [targetId, setTargetId] = useState<CleanTarget>("u1");
  // Which U1 nozzle the file is being prepared for. Defaults to the one we ship a real tested export
  // for, so the untouched path is byte-identical to before this existed.
  const [nozzle, setNozzle] = useState<number>(U1_TESTED_NOZZLE);
  const [message, setMessage] = useState("");
  const [reportSent, setReportSent] = useState<"idle" | "sending" | "done">("idle");
  const [warn, setWarn] = useState("");
  // A multi-plate project can be far too big to open whole while every individual plate is small.
  // When the whole-file read fails on size, we look at the plate layout (which costs ~80 KB and a few
  // ms, since nothing decompresses) and offer them one at a time instead of a dead end.
  const [plateOptions, setPlateOptions] = useState<PlateInfo[] | null>(null);
  const [plateBusy, setPlateBusy] = useState<number | null>(null);
  // NOTE: the archive bytes are deliberately NOT kept in state. Holding a 228 MB Uint8Array in a
  // React state slot pins it for as long as the picker is on screen, and it stacks with the plate
  // inflation and the re-analysis that follow — enough to take the whole tab down. `file` is just a
  // handle to disk, so re-reading at click time costs one read and frees immediately after.
  // How "Clean for U1" builds settings: preserve the creator's (identity-swap) or stamp our tested profile.
  const [profileMode, setProfileMode] = useState<"preserve" | "stamp">("preserve");
  // By-layer >4-colour files: keep all colours via M600 spool-swap pauses (experimental) vs merge to 4.
  const [swapPauses, setSwapPauses] = useState(false);
  // >4 colours: write every filament through untouched and let Orca ask which head each loads on.
  const [keepAllColours, setKeepAllColours] = useState(false);
  // Which library preset each slot is NAMED after. Naming only — no print setting changes.
  const [filamentBrand, setFilamentBrand] = useState<FilamentBrand>("source");
  const [swapPlan, setSwapPlan] = useState<{ label: string }[]>([]);
  // Painted, vertically colour-banded files: keep all colours EXACTLY via a few manual filament swaps
  // (auto-inserted M600 pauses) instead of Full Spectrum mixing. Mutually exclusive with Full Spectrum.
  const [bandSwap, setBandSwap] = useState(false);
  const [diff, setDiff] = useState<DiffReport | null>(null);
  const [pinned, setPinned] = useState<number[]>([]); // palette indices protected from >4 reduction
  const [fullSpectrum, setFullSpectrum] = useState(false); // approximate >4 colors by mixing the 4 filaments
  const [customFS, setCustomFS] = useState(false); // reproduce colors from a custom filament palette (CMYK)
  const [customBases, setCustomBases] = useState(["#29ABE2", "#ED1E79", "#FCEE21", "#111111"]); // default CMYK
  const [subdivide, setSubdivide] = useState(true); // Full Spectrum "Subdivide Mix Layer" — on by default
  const [keepVlhTower, setKeepVlhTower] = useState(false); // variable layers: keep the prime tower (advanced)
  const [physical, setPhysical] = useState<number[]>([]); // palette indices loaded on the 4 physical heads
  const [physicalHex, setPhysicalHex] = useState<Record<number, string>>({}); // per-main hex override (real filament ≠ model colour)
  const [mixOverrides, setMixOverrides] = useState<Record<number, MixRecipe>>({}); // manual mix edits
  const [mixedLayerHeight, setMixedLayerHeight] = useState(0); // Full Spectrum mix dither height (mm); 0 = Auto
  const [removedCount, setRemovedCount] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [copied, setCopied] = useState(false);
  // ── THE DELIVERED FILE ────────────────────────────────────────────────────────────────────────
  //
  // `download()` fires before the done screen renders — `ContributeToLibrary`'s header says so, and
  // uses it to argue that every ask on that screen is made of someone already leaving. The other
  // consequence was never handled: the screen said "Done" and then never mentioned the file again.
  // No name, no size, no way to get it a second time. A blocked download, a mis-clicked Save dialog
  // or a second monitor was an unrecoverable state on a page whose whole job is to hand you a file.
  const [result, setResult] = useState<{ blob: Blob; name: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Batch mode: convert many .3mf → U1 at once, download a ZIP. Fully isolated from the single-file flow
  // (its own state) so it never touches the review/done screen or the palette editor.
  const batchRef = useRef<HTMLInputElement>(null);
  const [batchState, setBatchState] = useState<"idle" | "working" | "done" | "error">("idle");
  const [batchMsg, setBatchMsg] = useState("");
  const [batchProgress, setBatchProgress] = useState(0);

  // Physical colour slots on the SELECTED target printer (U1/Bambu/Creality = 4, Prusa MK4+MMU3 = 5).
  // "current"/"generic" aren't in MACHINES → default 4. Used ONLY by the plain slot color-editor and its
  // backing slots/assign arrays; Full Spectrum stays 4 (U1-hardware feature) and the convert engine is
  // untouched. Because every 4-slot target keeps slotCount === 4, their layout + output are unchanged.
  const slotCount = MACHINES[targetId]?.toolheads ?? 4;

  // Keep the editable slot array sized to the selected target. For a 4-slot target this is a no-op (same
  // reference → no re-render), so the U1 path never changes; switching to a 5-slot target grows it to 5.
  useEffect(() => {
    setSlots((prev) => (prev.length === slotCount ? prev : padN(prev, slotCount)));
  }, [slotCount]);

  // Deep-link: /convert?to=bambu-x1c preselects a target printer (used by the reverse "U1 → X" landing
  // pages). Read once on mount from the URL and ignore unknown values so the default stays "u1".
  useEffect(() => {
    const to = new URLSearchParams(window.location.search).get("to");
    if (to && (to in MACHINES || to === "current" || to === "generic")) setTargetId(to as CleanTarget);
  }, []);

  // Saved presets capture only reusable settings (target + profile/color toggles), never file-specific
  // palette/slot state, so applying one is always safe. The targetId is validated on apply in case a
  // hand-edited localStorage carries an unknown value.
  const presetSettings: ConvertSettings = {
    targetId, profileMode, fullSpectrum, customFS, customBases, subdivide, swapPauses, bandSwap, keepVlhTower, mixedLayerHeight, keepAllColours, filamentBrand,
  };
  const applyPreset = (s: ConvertSettings) => {
    // Coerce every field — a hand-edited/corrupt localStorage preset must not inject a bad value
    // (e.g. profileMode leaks into the persisted bedready:profileMode key).
    if (s.targetId in MACHINES || s.targetId === "current" || s.targetId === "generic") setTargetId(s.targetId as CleanTarget);
    setProfileMode(s.profileMode === "stamp" ? "stamp" : "preserve");
    setFullSpectrum(!!s.fullSpectrum);
    setCustomFS(!!s.customFS);
    setCustomBases(Array.isArray(s.customBases) ? s.customBases : customBases);
    setSubdivide(!!s.subdivide);
    setSwapPauses(!!s.swapPauses);
    setKeepAllColours(!!s.keepAllColours);
    setFilamentBrand(s.filamentBrand === "generic" || s.filamentBrand === "snapmaker" ? s.filamentBrand : "source");
    setBandSwap(!!s.bandSwap);
    setKeepVlhTower(!!s.keepVlhTower);
    setMixedLayerHeight(typeof s.mixedLayerHeight === "number" ? s.mixedLayerHeight : 0);
  };

  // Remember the profile-mode preference across sessions (preserve vs stamp our tested profile).
  useEffect(() => {
    try {
      const v = localStorage.getItem("bedready:profileMode");
      if (v === "preserve" || v === "stamp") setProfileMode(v);
    } catch {
      /* localStorage unavailable — ignore */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("bedready:profileMode", profileMode);
    } catch {
      /* ignore */
    }
  }, [profileMode]);

  // Clear everything back to the initial drop-a-file state (keeps the profile-mode preference).
  function resetAll() {
    setFile(null);
    // `stlFile` is the OTHER thing a person can have picked, and leaving it set here strands them:
    // the file picker is gated on `!file && !stlFile`, so "Convert another" would return to a screen
    // with no way to choose another. Harmless until `wrapStl` started reaching "done" — which is the
    // shape of an omission that is invisible until an unrelated change makes it reachable, so
    // reset-clears-inputs.test.mts now asserts every picked-file state is cleared here.
    setStlFile(null);
    setAnalysis(null);
    setMesh(null);
    setMeshLoading(false);
    setPreviewNote("");
    setProgress(null);
    setSel("all");
    setBigFile(false);
    setSlots(["#FFFFFF", "#FFFFFF", "#FFFFFF", "#FFFFFF"]);
    setAssign([]);
    setStatus("idle");
    setTargetId("u1");
    setMessage("");
    setWarn("");
    setSwapPlan([]);
    setDiff(null);
    setPinned([]);
    setFullSpectrum(false);
    setCustomFS(false);
    setBandSwap(false);
    setSubdivide(true);
    setPhysical([]);
    setPhysicalHex({});
    setMixOverrides({});
    setMixedLayerHeight(0);
    setRemovedCount(0);
    setCopied(false);
    setResult(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  /**
   * Hand a finished file to the visitor, and remember that we did.
   *
   * Every path that produces a download goes through here rather than calling `download()` directly,
   * for the same reason `convert-handoff.ts` states its own rule in its header: there are six such
   * paths, and the one that mattered was the one that forgot. Recording the result is what lets the
   * done screen name the file, show its size, and offer it a second time — none of which it could do
   * while the bytes existed only inside the function that made them.
   */
  function deliver(blob: Blob, name: string) {
    setResult({ blob, name });
    download(blob, name);
  }

  // Plain-text version of the "what changed" report — for the copy-summary button (share / keep a record).
  function buildSummary(): string {
    const lines: string[] = [];
    if (diff) {
      lines.push(`${t("diffPrinterLabel")} ${diff.printerFrom ? `${diff.printerFrom} → ` : ""}${diff.printerTo}`);
      if (diff.towerSafety.length > 0) lines.push(t("diffTower"));
      if (diff.clamped.length > 0) lines.push(t("diffClamped", { count: diff.clamped.length }));
      if (diff.sentinelFixed.length > 0) lines.push(t("diffSentinel", { count: diff.sentinelFixed.length }));
      if (diff.droppedForeignKeys > 0) lines.push(t("diffDropped", { count: diff.droppedForeignKeys }));
      if (diff.vlhGuard) lines.push(t("diffVlh"));
      if (diff.bedShift) lines.push(t("diffBedShift", { dx: diff.bedShift.dx, dy: diff.bedShift.dy }));
      if (diff.prusaPaint) lines.push(t("diffPrusaPaint"));
      if (diff.foreignNative) lines.push(t("diffForeignNative"));
      if (diff.fullSpectrumMixes > 0) lines.push(t("diffFullSpectrum", { count: diff.fullSpectrumMixes }));
      if (diff.keptAllColours > 0) lines.push(t("diffKeptAll", { count: diff.keptAllColours }));
      if (diff.filamentBrand) lines.push(t("diffFilamentBrand", { brand: t(diff.filamentBrand === "snapmaker" ? "brandSnapmaker" : "brandGeneric") }));
      if (diff.nozzleFit.length > 0) lines.push(t("diffNozzleFit", { count: diff.nozzleFit.length }));
      if (diff.untestedProfile) lines.push(t("diffUntestedProfile"));
      if (diff.antiClobber) lines.push(t("diffAntiClobber"));
    }
    if (removedCount > 0) lines.push(t("diffStripped", { count: removedCount }));
    if (swapPlan.length > 0) lines.push(t("swapPlanTitle", { count: swapPlan.length }));
    return `BedReady — ${t("whatChanged")}\n${lines.map((l) => `• ${l}`).join("\n")}\n\nbedready.io/convert`;
  }

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(buildSummary());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — ignore */
    }
  }

  // Anonymous failure telemetry — stage + short reason, never the file or its contents.
  function trackFail(stage: string, e?: unknown) {
    const reason = e instanceof Error ? e.message.slice(0, 120) : "";
    track("convert_fail", { stage, reason });
  }

  // STRICTLY OPT-IN: only when the user clicks, send the actual .3mf so we can fix the edge case.
  // (The whole converter is otherwise zero-upload; this is the one place a file leaves the browser.)
  async function sendFailingFile(note: string) {
    if (!file) return;
    setReportSent("sending");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("error", message || "conversion problem");
      fd.append("note", note);
      await fetch(convertApi("/api/report-conversion"), { method: "POST", body: fd });
      track("convert_failure_sent", { note });
    } catch {
      /* best-effort */
    }
    setReportSent("done");
  }

  // Pull a single plate out of an over-sized archive and run it through the ordinary path. Only that
  // plate's geometry is inflated, so peak memory is the plate rather than the whole project.
  async function convertPlate(pl: PlateInfo) {
    if (!file) return;
    setPlateBusy(pl.index);
    await nextPaint();
    try {
      // Re-read rather than retain. Both of these go out of scope as soon as the File is built, so
      // the peak is one plate rather than archive + plate + output all alive at once.
      const raw = new Uint8Array(await file.arrayBuffer());
      const sub = extractPlate(raw, pl.index);
      const name = file.name.replace(/\.3mf$/i, "") + `-plate${pl.index}.3mf`;
      await pick(new File([sub as BlobPart], name, { type: "model/3mf" }));
    } catch (err) {
      console.error("[plate]", err);
      setStatus("error");
      setMessage(t("plateFailed", { index: pl.index }));
    } finally {
      setPlateBusy(null);
    }
  }

  async function pick(f: File | undefined) {
    if (!f) return;
    const lower = f.name.toLowerCase();
    if (lower.endsWith(".stl")) {
      // STL branch: geometry only. Reset the 3mf state machine and show the wrap-to-3MF panel instead.
      setStlFile(f);
      setFile(null);
      setAnalysis(null);
      setMesh(null);
      setStatus("idle");
      setMessage("");
      setWarn("");
      return;
    }
    if (!lower.endsWith(".3mf")) {
      setStatus("error");
      setMessage(t("msgChoose"));
      return;
    }
    setStlFile(null);
    setPlateOptions(null);
    setFile(f);
    setStatus("ready");
    setMessage(f.name);
    setWarn("");
    setMesh(null);
    setPreviewNote("");
    setBigFile(false);
    setDiff(null);
    setSwapPlan([]);
    setPinned([]);
    setFullSpectrum(false);
    setCustomFS(false);
    setBandSwap(false);
    setSubdivide(true);
    setPhysical([]);
    setPhysicalHex({});
    setMixOverrides({});
    // Show the working indicator right away and let it paint BEFORE the (main-thread) analyse, so picking a
    // big file never looks frozen. This runs locally in the browser — nothing is uploaded.
    setMeshLoading(true);
    await nextPaint(); // rAF alone never resolves in a hidden tab — see nextPaint()
    let a: Analysis;
    try {
      a = await analyzeThreeMF(f);
      setAnalysis(a);
    } catch (e) {
      console.error(e);
      trackFail("analyze", e);
      setMeshLoading(false); // <- was missing: the spinner ran forever after a failed read
      setAnalysis(null);
      setStatus("error");
      // Say what actually happened. A rejected-for-size file is not a corrupt file, and telling
      // someone with a legitimate 228 MB multi-plate model that we "couldn't read" it sends them
      // looking for a problem with their file that isn't there.
      setMessage(
        e instanceof ThreeMFError
          ? t(e.code === "too_large" ? "msgTooLarge" : "msgExpandsTooLarge", { size: e.sizeMB, cap: e.capMB })
          : t("msgReadFail"),
      );
      // Too big as one archive doesn't mean too big per plate. Reading the layout inflates only the
      // metadata entries, so this is safe even on a file we just refused to open.
      if (e instanceof ThreeMFError) {
        try {
          // peekPlates only inflates metadata (~80 KB), and `raw` is released on return.
          const found = peekPlates(new Uint8Array(await f.arrayBuffer())).filter((pl) => pl.bytes > 0);
          if (found.length > 1) setPlateOptions(found);
        } catch {
          /* not a plate-structured file — the plain size message stands */
        }
      }
      return;
    }

    // initial slot guess (refined once the mesh loads — but must stand on its own if the preview fails)
    if (a.colors.length > 4) {
      const r = reduceColors(a.colors, a.usage);
      setAssign(r.map);
      setSlots(padN(r.colors, slotCount));
      if (a.fullSpectrumFile) {
        // A ColorMix file already declares its 4 physical bases (palette 0-3) + mixes — use those as the
        // heads (never re-pick, or a virtual mix colour becomes a "filament") and turn Full Spectrum on.
        setPhysical([0, 1, 2, 3]);
        setFullSpectrum(true);
      } else if (a.painted) {
        // Seed the Full Spectrum physical set from the analysis so FS works even without a preview mesh
        // (a big/failed preview otherwise leaves `physical` empty → FS can't pick its 4 heads). Base = slot 1.
        setPhysical(bestPhysicalSet(a.colors, a.usage, [0]));
      }
    } else {
      setAssign(a.colors.map((_, i) => Math.min(i, slotCount - 1)));
      setSlots(padN(a.colors, slotCount));
    }

    // Load a colored 3D preview for ANY file. Failure must NOT block conversion.
    setMeshLoading(true);
    try {
      const m = await extractMeshAsync(f); // off the main thread — big models don't freeze the UI
      if (m.skipped) {
        setPreviewNote(
          t("previewNoteVeryLarge", { count: (m.triangleCount / 1e6).toFixed(1) }),
        );
        setBigFile(true);
      } else if (m.triangleCount === 0 || m.faceState.length === 0) {
        setPreviewNote(t("previewGeomFail"));
      } else {
        // Count colours ACTUALLY used by the geometry (painted states + base) — not the full
        // filament list, which often carries extra spools the model never paints.
        const usedCount = new Set([m.baseState, ...m.statesPresent].filter((s) => s >= 1 && s <= m.palette.length)).size;
        if (m.palette.length > 4) {
          // Collapse to 4 — this also drops any phantom/unused filaments, so a 4-colour model with a
          // 5-entry filament list maps cleanly to 4 slots.
          const r = reduceColors(m.palette, m.usage);
          setAssign(r.map);
          setSlots(padN(r.colors, slotCount));
          if (usedCount > 4) {
            // Genuinely >4 used → offer Full Spectrum. Default physical = the 4 colours a mix can least
            // reproduce (keeps un-mixable colours like white eyes physical, virtualises mixable ones
            // like a grey that's ≈ white+black), pinning the unpainted base so it's never virtualised.
            // Choose ONLY from colours the model actually paints (not the full filament list, which may
            // carry phantom/duplicate spools). Otherwise a default main could be a listed-but-unpainted
            // colour with no row in the pick list below — leaving the user unable to see/change the 4th.
            const usedIdx = [...new Set([m.baseState, ...m.statesPresent])]
              .filter((s) => s >= 1 && s <= m.palette.length)
              .map((s) => s - 1);
            const basePos = usedIdx.indexOf(m.baseState - 1);
            const pick = bestPhysicalSet(usedIdx.map((i) => m.palette[i]), usedIdx.map((i) => m.usage[i] ?? 0), basePos >= 0 ? [basePos] : []);
            setPhysical(pick.map((si) => usedIdx[si])); // map sub-indices back to palette indices
          }
        } else {
          setAssign(m.palette.map((_, i) => i));
          setSlots(padN(m.palette.length ? m.palette : ["#cccccc"], slotCount));
        }
        setMesh(m);
        // Start grouped by plate when the file has several; else on the first part; else whole model.
        setSel(m.plates.length > 1 ? "plate:0" : m.parts.length > 1 ? "part:0" : "all");
        if (m.sampled) {
          setPreviewNote(
            t("previewNoteSampled", { count: (m.triangleCount / 1e6).toFixed(1) }),
          );
        } else if (a.encoding === "by-layer") {
          setPreviewNote(t("previewByLayer"));
        }
      }
    } catch (e) {
      console.error("[preview]", e);
      setPreviewNote(t("previewRenderFail"));
    }
    setMeshLoading(false);
  }

  // Wrap the picked STL as a clean core-spec 3MF (geometry only) and download it. Self-contained: no
  // analyze/convert flow, no colours — just parse + zip in the browser.
  async function wrapStl() {
    if (!stlFile) return;
    try {
      const base = stlFile.name.replace(/\.stl$/i, "");
      const bytes = new Uint8Array(await stlFile.arrayBuffer());
      const out = stlTo3MF(bytes, base);
      const wrapped = new Blob([out as BlobPart], { type: "application/octet-stream" });
      deliver(wrapped, `${base}.3mf`);
      // A clean core-spec 3MF — the library's preferred format, and the third path found (by
      // convert-handoff-guard.test.mts) to produce one file without staging it.
      stageConvertedFile(new File([wrapped], `${base}.3mf`, { type: "model/3mf" }));
      bumpConvertCount();
      track("stl_to_3mf");
      // This path used to stop here, and the omission cost exactly what it looks like: every sibling
      // conversion lands on the done screen, and the done screen is the ONLY place the library is
      // ever mentioned. So the one path producing the library's preferred format was the one path
      // that never invited anyone to it — 5 visitors in the funnel window, none asked.
      //
      // Held back when staging was added, because it is a flow change rather than a line, and the
      // flow had a trap in it: `resetAll` did not clear `stlFile`. That was unreachable while this
      // path never reached "done" — and reachable the moment it did, stranding "Convert another" on
      // a screen whose file picker is gated on `!file && !stlFile`. Fixed there, guarded by
      // reset-clears-inputs.test.mts.
      //
      // `stl_to_3mf` is deliberately still the only event fired here — NOT `convert_success`.
      // Renaming what an existing counter counts mid-flight is how a funnel stops being comparable
      // to itself. `convert_done_view` will step up, and that is the metric working: this path now
      // genuinely shows the done screen.
      setStatus("done");
      setMessage(t("stlWrapDone"));
    } catch (e) {
      console.error(e);
      setStatus("error");
      setMessage(t("msgReadFail"));
    }
  }

  // Palette + per-colour usage that drive the colour editor and Full Spectrum. Prefer the preview mesh
  // (knows exactly what's painted); fall back to the analysis so a big/failed preview (e.g. a 27MB painted
  // file whose worker OOMs) still shows the colours and offers Full Spectrum. Conversion reads the full
  // file server-side regardless, so FS still works without a preview.
  // Memoized: a fresh array identity on every render invalidated every downstream useMemo that
  // depends on it, so the colour-editor work re-ran on unrelated state changes.
  const palette = useMemo(
    () => (mesh && mesh.palette.length ? mesh.palette : analysis?.colors ?? []),
    [mesh, analysis],
  );

  // The 4 colours loaded on the physical heads (Full Spectrum basis).
  const physicalColors = useMemo(
    () => physical.filter((i) => i >= 0 && i < palette.length).map((i) => physicalHex[i] || palette[i]),
    [palette, physical, physicalHex],
  );
  // Which plate(s) each editable slot maps to, for multi-plate "one colour per plate" files. The slots
  // are ordered by filament index, which often ISN'T plate order (plate 1 may use filament 2), so
  // editing a slot blind sends the colour to the wrong plate. Maps slot ← source state (a part's
  // extruder) ← plate, through `assign` so reorders stay correct.
  const slotPlates = useMemo<number[][]>(() => {
    if (!mesh || mesh.plates.length <= 1 || fullSpectrum) return [];
    const partState = mesh.parts.map((p) => {
      const counts = new Map<number, number>();
      for (const s of p.faceState) if (s >= 1) counts.set(s, (counts.get(s) ?? 0) + 1);
      let best = mesh.baseState, bc = -1;
      for (const [s, c] of counts) if (c > bc) { bc = c; best = s; }
      return best;
    });
    const res: number[][] = slots.map(() => []);
    mesh.plates.forEach((pl, pi) => {
      for (const st of new Set(pl.partIndices.map((j) => partState[j]))) {
        const slot = assign[st - 1] ?? st - 1;
        if (slot >= 0 && slot < res.length && !res[slot].includes(pi + 1)) res[slot].push(pi + 1);
      }
    });
    return res;
  }, [mesh, slots, assign, fullSpectrum]);
  // Full Spectrum: per source colour, null if it's a physical (main) colour, else its closest mix of the
  // 4 physical heads — 2- OR 3-filament (bestMixMulti), matching the converter. Shape mirrors customRecipes.
  const mixMatches = useMemo(
    () =>
      fullSpectrum && palette.length && physicalColors.length === 4
        ? palette.map((h, i) => {
            if (physical.includes(i)) return null;
            const ov = mixOverrides[i];
            if (ov) return { ids: [ov.a, ov.b], weights: [100 - ov.mixBPercent, ov.mixBPercent], hex: recipeHex(physicalColors, ov.a, ov.b, ov.mixBPercent), deltaE: 0, override: true };
            const m = bestMixMulti(h, physicalColors);
            return { ids: m.ids, weights: m.weights, hex: m.hex, deltaE: m.deltaE, override: false };
          })
        : null,
    [fullSpectrum, palette, physical, physicalColors, mixOverrides],
  );

  // Custom-palette (CMYK): per source colour, its recipe as a mix of the user's 4 filaments — the
  // converter's best 2-filament match, or the user's manual override. Drives both the editor + preview.
  const customRecipes = useMemo(
    () =>
      customFS && palette.length
        ? palette.map((h, i) => {
            const ov = mixOverrides[i];
            if (ov) return { ids: [ov.a, ov.b], weights: [100 - ov.mixBPercent, ov.mixBPercent], hex: recipeHex(customBases, ov.a, ov.b, ov.mixBPercent), deltaE: 0, override: true };
            const m = bestMixMulti(h, customBases);
            return { ids: m.ids, weights: m.weights, hex: m.hex, deltaE: m.deltaE, override: false };
          })
        : null,
    [customFS, palette, customBases, mixOverrides],
  );
  const customMix = useMemo(() => customRecipes?.map((r) => r.hex) ?? null, [customRecipes]);

  // Final display color for a given filament state (for the live preview).
  const colorForState = useCallback(
    (s: number) => {
      if (!mesh) return "#888888";
      const idx = s === 0 ? mesh.baseState - 1 : s - 1;
      if (idx >= 0 && idx < mesh.palette.length) {
        if (customMix) return customMix[idx] ?? mesh.palette[idx] ?? "#888888"; // CMYK-mixed approximation
        if (mixMatches) return mixMatches[idx]?.hex ?? mesh.palette[idx] ?? "#888888"; // mix, or the physical colour
        // A >4-colour model can't fit the 4 slots, so slots/assign holds a LOSSY 4-colour merge. Preview
        // the model's TRUE colours instead (the merge only applies if you don't enable Full Spectrum);
        // ≤4-colour files still reflect the editable slot mapping so remapping a slot updates the preview.
        if (mesh.palette.length > 4) return mesh.palette[idx] ?? "#888888";
        return slots[assign[idx] ?? 0] ?? "#888888";
      }
      return slots[0];
    },
    [mesh, slots, assign, mixMatches, customMix],
  );

  // Toggle a colour as a physical (main) Full Spectrum filament — exactly 4 allowed. Changing the
  // physical set invalidates manual mixes (they reference physical positions), so clear them.
  function togglePhysical(i: number) {
    setPhysical((prev) =>
      prev.includes(i) ? prev.filter((x) => x !== i) : prev.length >= 4 ? prev : [...prev, i],
    );
    setMixOverrides({});
  }

  // Pin/unpin a palette color so the >4→4 reducer won't merge it away; recompute the reduction.
  function togglePin(i: number) {
    if (!mesh) return;
    const has = pinned.includes(i);
    if (!has && pinned.length >= 4) return; // only 4 slots — can't protect more than 4 colors
    const next = has ? pinned.filter((x) => x !== i) : [...pinned, i];
    setPinned(next);
    const r = reduceColors(mesh.palette, mesh.usage, next);
    setAssign(r.map);
    setSlots(padN(r.colors, slotCount));
  }

  async function clean(target: CleanTarget) {
    if (!file) return;
    // A specific non-U1 target printer (retarget). U1/current/generic keep their exact existing behaviour.
    const targetMachine = target !== "u1" && target !== "current" && target !== "generic" ? MACHINES[target] : undefined;
    const isRetarget = !!targetMachine;
    // Same slicer family → the file's printer profile is rewritten; else it's saved as a Generic 3MF.
    const sameFamily =
      isRetarget && analysis?.flavour ? configFamily(analysis.flavour) === configFamily(targetMachine!.flavour) : false;
    setStatus("working");
    setProgress(null);
    setMessage(isRetarget ? t("retargeting", { name: targetMachine!.name }) : target === "u1" ? t("applyingProfile") : t("strippingProfile"));
    setWarn("");
    try {
      // Painted files only use the manual mapping when the preview loaded; otherwise
      // cleanThreeMF auto-reduces by painted area.
      const useManual = analysis && (analysis.encoding !== "painted" || mesh);
      const opts = { ...(useManual ? { slots, assign } : {}), mode: profileMode, swapPauses, bandSwap, fullSpectrum: fullSpectrum || customFS, physical, physicalHex: physicalColors, mixes: mixOverrides, mixedLayerHeight, subdivide, keepPrimeTowerVlh: keepVlhTower, ...(customFS ? { customPhysical: customBases } : {}), ...(target === "u1" && nozzle !== U1_TESTED_NOZZLE ? { machine: u1NozzleVariant(nozzle) } : {}), keepAllColours, filamentBrand };
      const res = await cleanThreeMFAsync(file, target, opts);
      setSwapPlan(res.swaps ?? []);
      setDiff(res.diff);
      setRemovedCount(res.removed.length);
      const suffix = target === "u1" ? ".u1.3mf" : target === "generic" ? ".generic.3mf" : isRetarget ? `.${target}.3mf` : ".import.3mf";
      const outName = file.name.replace(/\.3mf$/i, "") + suffix;
      deliver(res.blob, outName);
      // Hand the same bytes to /upload, so "Share it" on the done screen arrives with the file
      // already attached instead of an empty form and a trip to the downloads folder. In memory
      // only, cleared when read — see convert-handoff.ts.
      stageConvertedFile(new File([res.blob], outName, { type: "model/3mf" }));
      // Custom Vercel Analytics event — counts real conversions, not just /convert visits.
      track("convert_success", { ...acquisitionProps(),
        mode: target,
        profile: target === "u1" ? (res.preserved ? "preserve" : "stamp") : isRetarget ? (sameFamily ? "reprofile" : "generic") : "",
        reduced: res.reduced,
        colors: res.colorsTotal,
        // Feature-adoption tags — which advanced modes fired, so we can see what actually drives usage.
        fullSpectrum,
        customFS,
        bandSwap,
        swapPauses,
        keepAllColours,
      });
      bumpConvertCount();
      setStatus("done");
      setMessage(
        isRetarget
          ? sameFamily
            ? t("doneRetarget", { name: targetMachine!.name })
            : t("doneRetargetGeneric", { name: targetMachine!.name })
          : target === "u1"
            ? res.preserved
              ? t("donePreserve")
              : t("doneStamp")
            : target === "generic"
              ? t("doneGeneric")
              : t("doneCurrent"),
      );
    } catch (e) {
      console.error("[clean]", e);
      trackFail("clean", e);
      setStatus("error");
      // Surface our own clear guard messages (e.g. already-sliced file); fall back to a generic note.
      const msg = e instanceof Error ? e.message : "";
      setMessage(/already-sliced|editable 3D model/i.test(msg) ? msg : "Couldn't process that 3MF — it may be an unusual format.");
    }
  }

  // Rearrange which physical slot holds a colour — swap the two slot colours AND remap `assign`
  // by the same swap, so every painted region keeps its colour (the model looks identical) but the
  // colours load into different slots. Reuses the normal convert path; no engine change.
  function moveSlot(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= slots.length) return;
    setSlots((prev) => { const n = [...prev]; [n[i], n[j]] = [n[j], n[i]]; return n; });
    setAssign((prev) => prev.map((a) => (a === i ? j : a === j ? i : a)));
  }

  // Full Spectrum equivalent: reorder which physical head holds each main colour by swapping entries
  // in `physical` (the engine writes filament_colour in this order). Mixes reference physical positions
  // (a/b are 1-based into `physical`), so a reorder invalidates them — clear like togglePhysical does.
  function movePhysical(i: number, dir: -1 | 1) {
    const j = i + dir;
    setPhysical((prev) => {
      if (j < 0 || j >= prev.length) return prev;
      const n = [...prev];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
    setMixOverrides({});
  }

  // Split a multi-part file into separate single-part .3mf files. Each group is subset from the
  // ORIGINAL (removing the other parts' geometry), re-centered on the bed (multi-plate parts sit
  // off-bed on a global grid and the slicer rejects them), then converted on its own — so every
  // file gets its own reduced ≤4 palette (independent colors).
  async function splitExport() {
    if (!file || !mesh) return;
    setStatus("working");
    setProgress(0);
    setWarn("");
    try {
      const base = file.name.replace(/\.3mf$/i, "");
      const clean = (s: string) => (s || "").replace(/[^a-z0-9._-]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 40);

      // Build groups of object ids (deduped — instances of one object stay together).
      let groups: { name: string; ids: number[] }[];
      if (splitScope === "plate" && mesh.plates.length > 1) {
        groups = mesh.plates.map((pl, i) => ({
          name: `plate-${i + 1}`,
          ids: [...new Set(pl.partIndices.map((j) => mesh.parts[j].objectId))],
        }));
      } else {
        const ids = [...new Set(mesh.parts.map((p) => p.objectId))];
        groups = ids.map((id, i) => {
          const nm = mesh.parts.find((p) => p.objectId === id)?.name;
          return { name: `${String(i + 1).padStart(2, "0")}${nm ? "_" + clean(nm) : ""}`, ids: [id] };
        });
      }

      // Subset the ORIGINAL per group, re-center on the bed, then convert each independently.
      const bed = U1_BUILD_MM / 2;
      const centerXY = (ids: number[]): [number, number] => {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const p of mesh.parts) {
          if (!ids.includes(p.objectId)) continue;
          for (let i = 0; i < p.positions.length; i += 3) {
            const x = p.positions[i], y = p.positions[i + 1];
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
          }
        }
        return [(minX + maxX) / 2, (minY + maxY) / 2];
      };
      const orig = new Uint8Array(await file.arrayBuffer());
      const out: { name: string; bytes: Uint8Array }[] = [];
      for (let i = 0; i < groups.length; i++) {
        setProgress(i / groups.length);
        setMessage(t("splitProgress", { i: i + 1, n: groups.length }));
        const [cx, cy] = centerXY(groups[i].ids);
        // centerXY reads mesh.parts, which are MILLIMETRES; the offset is written into the original
        // document, whose coordinates are in its own unit. Equal for the usual millimetre file, and
        // off by 25.4 for an inch one — so convert back rather than assume they are the same space.
        const subBytes = subsetThreeMF(orig, new Set(groups[i].ids),
          [(bed - cx) / mesh.mmPerUnit, (bed - cy) / mesh.mmPerUnit]);
        const r = await cleanThreeMFAsync(new File([subBytes as BlobPart], `${groups[i].name}.3mf`), "u1", { mode: profileMode, swapPauses, fullSpectrum });
        out.push({ name: `${base}_${groups[i].name}.u1.3mf`, bytes: new Uint8Array(await r.blob.arrayBuffer()) });
      }
      deliver(new Blob([zipFiles(out) as BlobPart]), `${base}.u1.parts.zip`);
      setMessage(t("splitDone", { count: out.length }));
      track("convert_success", { ...acquisitionProps(), mode: "u1", profile: `split-${splitScope}`, colors: mesh.palette.length, reduced: true });
      bumpConvertCount();
      setStatus("done");
    } catch (e) {
      console.error("[splitExport]", e);
      trackFail("split", e);
      setStatus("error");
      setMessage(t("splitFail"));
    }
  }

  // Batch convert: run each dropped .3mf through the standard U1 conversion (creator's print settings
  // preserved) and hand back a single ZIP. Files that fail are skipped and named, not fatal to the rest.
  async function batchConvert(files: File[]) {
    const list = files.filter((f) => /\.3mf$/i.test(f.name));
    if (list.length === 0) {
      setBatchState("error");
      setBatchMsg(t("batchNoFiles"));
      return;
    }
    setBatchState("working");
    setBatchProgress(0);
    setBatchMsg("");
    track("batch_convert_start", { files: list.length });
    const out: { name: string; bytes: Uint8Array }[] = [];
    const failed: string[] = [];
    for (let i = 0; i < list.length; i++) {
      setBatchProgress(i / list.length);
      setBatchMsg(t("batchProgress", { i: i + 1, n: list.length, name: list[i].name }));
      try {
        const r = await cleanThreeMFAsync(list[i], "u1", { mode: profileMode, swapPauses, fullSpectrum });
        out.push({ name: list[i].name.replace(/\.3mf$/i, "") + ".u1.3mf", bytes: new Uint8Array(await r.blob.arrayBuffer()) });
        bumpConvertCount();
      } catch (e) {
        console.error("[batch]", list[i].name, e);
        failed.push(list[i].name);
      }
    }
    if (out.length === 0) {
      setBatchState("error");
      setBatchMsg(t("batchNoneConverted"));
      return;
    }
    setBatchProgress(1);
    deliver(new Blob([zipFiles(out) as BlobPart]), "bedready-batch.u1.zip");
    track("convert_success", { ...acquisitionProps(), mode: "u1", profile: "batch", colors: 0, reduced: false });
    setBatchState("done");
    setBatchMsg(
      failed.length
        ? t("batchDonePartial", { done: out.length, failed: failed.length, names: failed.join(", ") })
        : t("batchDone", { count: out.length }),
    );
  }

  // OPTIONAL fallback: convert on our server. The in-browser path above is the default
  // (private, free, no upload). This only exists for files the browser can't handle — it
  // uploads the file, converts in memory on the server (nothing stored), and downloads the result.
  async function serverConvert() {
    if (!file) return;
    setStatus("working");
    setProgress(null);
    setMessage(t("serverUploading"));
    setWarn("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const qs = new URLSearchParams({
        mode: profileMode,
        fullSpectrum: fullSpectrum ? "1" : "0",
        swapPauses: swapPauses ? "1" : "0",
      });
      const res = await fetch(`${convertApi("/api/convert")}?${qs}`, { method: "POST", body: fd });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Server returned ${res.status}.`);
      }
      const blob = await res.blob();
      const serverName = file.name.replace(/\.3mf$/i, "") + ".u1.3mf";
      deliver(blob, serverName);
      // Stage it, exactly as the in-browser path does. convert-handoff's own contract is "called the
      // moment a conversion produces A SINGLE DOWNLOADABLE FILE", and this produces the same artifact
      // the main path does — it just made it on the server because the file was too big for the tab.
      // Missing here meant the LARGEST files, the ones most worth having in a library, sent people to
      // an empty upload form to go and find it in their downloads folder.
      stageConvertedFile(new File([blob], serverName, { type: "model/3mf" }));
      track("convert_success", { ...acquisitionProps(), mode: "u1", profile: "server", colors: 0, reduced: false });
      bumpConvertCount();
      setStatus("done");
      setMessage(t("serverDone"));
    } catch (e) {
      console.error("[serverConvert]", e);
      trackFail("server", e);
      setStatus("error");
      setMessage(e instanceof Error ? e.message : t("serverFail"));
    }
  }

  async function toStl() {
    if (!file) return;
    setStatus("working");
    setProgress(null);
    setMessage(t("stlExtracting"));
    try {
      // Lazy-load the three-dependent STL exporter only when this rarely-used button is clicked, so
      // three.js stays out of the /convert initial bundle.
      const { threeMFToSTL } = await import("@/lib/convert-mesh");
      const stlBlob = await threeMFToSTL(file);
      const stlName = file.name.replace(/\.3mf$/i, "") + ".stl";
      deliver(stlBlob, stlName);
      // `design_files.file_type` accepts stl and /upload takes it, so this is a stageable single file
      // like the two above. The ZIP-producing paths (split, batch) are deliberately NOT staged: they
      // are archives of many parts, not one model, and /upload has nothing to do with them.
      stageConvertedFile(new File([stlBlob], stlName, { type: "model/stl" }));
      track("convert_success", { ...acquisitionProps(), mode: "stl" });
      bumpConvertCount();
      setStatus("done");
      setMessage(t("stlDone"));
    } catch (e) {
      trackFail("stl", e);
      setStatus("error");
      setMessage(t("stlReadFail"));
    }
  }

  // Which palette slots the model actually uses. Prefer the preview mesh (knows exactly which are painted),
  // but FALL BACK to the analysis when there's no usable mesh — a big/failed preview (e.g. a 27MB painted
  // file whose preview is skipped) must NOT hide the colour count or the Full Spectrum option, since
  // analyzeThreeMF already knows it's an N-colour painted file.
  const usedStates =
    mesh && mesh.statesPresent.length
      ? Array.from(new Set([mesh.baseState, ...mesh.statesPresent])).filter((s) => s >= 1 && s <= mesh.palette.length)
      : analysis?.painted
        ? analysis.colors.map((_, i) => i + 1) // no mesh → treat every declared colour as used
        : [];
  const totalFaces = mesh ? mesh.faceState.length : 0;
  const usedCount = usedStates.length; // colours actually used (not the full filament list)
  const colorKey = JSON.stringify([slots, assign, fullSpectrum, physical, customFS, customBases, mixOverrides, bandSwap]);
  const warnings = analysis ? convertWarnings(analysis, mesh ? usedCount : undefined) : [];
  // Overhang advisory: recommend supports only when the geometry actually has steep unsupported faces.
  // The converter keeps the source file's own support setting (preserve mode) — this just tells the user
  // whether this particular model is likely to need them. Skipped when the preview mesh is unavailable.
  // A file is in play: the page stops being an argument for the converter and becomes the converter.
  const busy = !!(file || stlFile);

  const overhang = useMemo(
    () => (mesh && !mesh.skipped && mesh.positions.length >= 9 ? overhangReport(mesh.positions) : null),
    [mesh],
  );

  // Vertical colour-banding: if the painted colours change only by height (every layer one colour), all of
  // them can print EXACTLY via a few filament-swap pauses instead of Full Spectrum's approximate mixing.
  // Only worth surfacing for >4 colours (≤4 already fit the 4 heads automatically) with ≤5 manual swaps.
  const bandPlan = useMemo(
    () =>
      mesh && !mesh.skipped && analysis?.painted && mesh.positions.length >= 9
        ? detectColorBandsForMesh(mesh, mesh.baseState)
        : null,
    [mesh, analysis],
  );
  const showBands = !!bandPlan?.banded && bandPlan.colorCount > 4 && bandPlan.manualSwaps >= 1 && bandPlan.manualSwaps <= 5;
  if (overhang) {
    warnings.push(
      overhang.needsSupport
        ? { level: "warn", key: "warnOverhangYes", params: { percent: Math.round(overhang.ratio * 100) } }
        : { level: "info", key: "warnOverhangNo" },
    );
  }

  // Bed-fit / oversize advisory, measured PER PLATE (see lib/fit.ts for why that matters — measuring
  // the whole file measures the layout, and told people with ordinary multi-plate projects that their
  // model was 454×516 mm). Two outcomes with two different fixes: a part bigger than the bed has to be
  // rescaled, a plate packed wider than the bed just has to be rearranged.
  const fit = useMemo(
    () => (mesh && !mesh.skipped && mesh.positions.length >= 9 ? fitVerdict(mesh, U1_BUILD_MM, U1_BUILD_Z_MM) : null),
    [mesh],
  );
  if (fit) {
    const r = (v: number) => Math.round(v);
    warnings.push(
      fit.kind === "part"
        ? {
            level: "warn",
            key: "warnTooBig",
            params: { x: r(fit.x), y: r(fit.y), z: r(fit.z), maxXY: U1_BUILD_MM, maxZ: U1_BUILD_Z_MM },
          }
        : { level: "warn", key: "warnLayoutTooBig", params: { x: r(fit.x), y: r(fit.y), maxXY: U1_BUILD_MM } },
    );
  }

  // Preview can show all parts, a whole plate, or one part. viewMesh must be referentially stable
  // per (mesh, sel) so PaintPreview only rebuilds the scene when the selection actually changes.
  const hasGroups = !!mesh && (mesh.parts.length > 1 || mesh.plates.length > 1);
  const [selKind, selIdx] = (() => {
    const [k, n] = sel.split(":");
    return [k, n ? parseInt(n, 10) : -1] as [string, number];
  })();
  const viewMesh = useMemo(() => {
    if (!mesh) return null;
    const k = sel.split(":")[0];
    const i = parseInt(sel.split(":")[1] ?? "-1", 10);
    if (k === "part" && mesh.parts[i]) {
      return { ...mesh, positions: mesh.parts[i].positions, faceState: mesh.parts[i].faceState };
    }
    if (k === "plate" && mesh.plates[i]) {
      const idxs = mesh.plates[i].partIndices;
      if (idxs.length === 1) {
        const p = mesh.parts[idxs[0]];
        return { ...mesh, positions: p.positions, faceState: p.faceState };
      }
      let nv = 0, nf = 0;
      for (const j of idxs) { nv += mesh.parts[j].positions.length; nf += mesh.parts[j].faceState.length; }
      const positions = new Float32Array(nv), faceState = new Uint8Array(nf);
      let vo = 0, fo = 0;
      for (const j of idxs) {
        positions.set(mesh.parts[j].positions, vo); vo += mesh.parts[j].positions.length;
        faceState.set(mesh.parts[j].faceState, fo); fo += mesh.parts[j].faceState.length;
      }
      return { ...mesh, positions, faceState };
    }
    return mesh; // "all"
  }, [mesh, sel]);
  const partLabel = (i: number) => {
    const n = mesh?.parts[i]?.name;
    return n ? `Part ${i + 1} — ${n}` : `Part ${i + 1}`;
  };
  // ← / → step within the active grouping (plates or parts); disabled on "all".
  const cycle = (delta: number) => {
    if (!mesh) return;
    if (selKind === "plate") setSel(`plate:${(selIdx + delta + mesh.plates.length) % mesh.plates.length}`);
    else if (selKind === "part") setSel(`part:${(selIdx + delta + mesh.parts.length) % mesh.parts.length}`);
  };

  return (
    <main className="page-read py-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: ldJson({
            "@context": "https://schema.org",
            "@type": "WebApplication",
            name: "BedReady 3MF → Snapmaker U1 Converter",
            url: absoluteUrl("/convert"),
            applicationCategory: "UtilitiesApplication",
            operatingSystem: "Web browser",
            offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
            description:
              "Free in-browser converter that turns multicolor .3mf files from MakerWorld, Bambu Studio, PrusaSlicer and Creality Print into Snapmaker U1-ready projects — colors preserved, nothing uploaded.",
          }),
        }}
      />
      {/* ── THE PITCH, AND WHEN IT STOPS BEING THE PITCH ──────────────────────────────────────────
          Measured on the live site: the drop zone's top edge sat at 748px on a 1280×720 desktop and
          1076px on a 390×844 phone — a screen and a half of scrolling, past an eyebrow, a headline,
          a seven-line lede, a privacy block, a chip row, three tips and three numbered steps, before
          the tool appeared at all. Every one of those blocks argues that the converter is
          trustworthy and capable. None of them is as persuasive as the converter being visible.

          So the argument now sits BELOW the thing it is arguing for, and disappears entirely once a
          file is picked: after that the page is a tool, and the marketing above it is 750px the
          visitor has already read and already acted on, in front of every subsequent adjustment. */}
      {!busy && <ConvertCount className="mb-3 font-mono text-xs text-fg-muted" />}
      <h1
        className={
          busy
            ? "text-lg font-semibold tracking-tight text-fg"
            : "text-3xl font-semibold tracking-tight text-fg sm:text-4xl"
        }
      >
        {t("title")}
      </h1>
      {!busy && <p className="mt-3 text-base leading-relaxed text-fg-muted">{t("intro")}</p>}
      {/* The claim, shown. See BeforeAfter for why it is drawn rather than photographed. */}
      {!busy && <BeforeAfter />}

      <div
        role="button"
        tabIndex={0}
        aria-label={t("dropAria")}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          pick(e.dataTransfer.files?.[0]);
        }}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        className={`mt-6 flex cursor-pointer flex-col items-center gap-3 rounded-lg border-2 border-dashed p-10 text-center transition focus:outline-none focus-visible:border-violet-400 focus-visible:ring-2 focus-visible:ring-violet-400/40 ${
          dragOver ? "border-violet-400 bg-violet-400/10" : "border-line hover:border-violet-400/50 hover:bg-surface-2"
        }`}
      >
        <span className={`flex h-14 w-14 items-center justify-center rounded-full transition ${dragOver || file || stlFile ? "brand-gradient text-white" : "bg-surface-3 text-fg-muted"}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6" aria-hidden="true">
            <path d="M12 16V4" />
            <path d="M8 8l4-4 4 4" />
            <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
          </svg>
        </span>
        <div>
          <p className="font-medium text-fg">{file ? file.name : stlFile ? stlFile.name : t("dropTitle")}</p>
          <p className="mt-1 text-sm text-fg-muted">{file ? t("dropReady") : stlFile ? t("stlReady") : t("dropSub")}</p>
          {!file && !stlFile && (
            <p className="mt-1 text-xs text-fg-subtle">{t("dropHint")}</p>
          )}
        </div>
        <input ref={inputRef} type="file" accept=".3mf,.stl" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
      </div>

      {/* ── THE REASSURANCE, NOW BELOW THE ACTION ────────────────────────────────────────────────
          Same blocks, same words, after the drop zone instead of in front of it. */}
      {!busy && (
        <>
          <div className="mt-8 border-t border-line pt-4">
            <p className="eyebrow">{t("privacyBadge")}</p>
            <p className="mt-1.5 text-base leading-relaxed text-fg-muted">{t("privacyDetail")}</p>
            {/* The evidence for the sentence above it. `COMPETITIVE-2026-08.md` §3.1 ranks "say
                'nothing is uploaded' louder" as the highest-ratio item in that document;
                `SPLIT-DECISION-2026-08.md` calls open source "the loudest available version of that,
                because it is the only one a sceptic can verify". The repository went public and this
                page never said so — while /compare-u1-converters linked four competitors' repos.

                It also states the claim in the form the README states it, rather than the stronger
                form this block used alone: there IS a server fallback, it is a button, and saying so
                here costs nothing and is the difference between a claim and a checkable one. */}
            <p className="mt-2 text-base leading-relaxed text-fg-subtle">
              {t.rich("privacySource", {
                link: (c) => (
                  <a
                    href={SOURCE_REPO_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-violet-300 hover:underline"
                  >
                    {c}
                  </a>
                ),
              })}
            </p>
          </div>

          {/* Supported sources — trust strip. Brand names, not translated. */}
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <span className="eyebrow">{t("worksWithLabel")}</span>
            {["MakerWorld", "Bambu Studio", "PrusaSlicer", "OrcaSlicer", "Creality Print"].map((n) => (
              <span key={n} className="rounded-full border border-line px-2.5 py-0.5 text-xs text-fg-muted">
                {n}
              </span>
            ))}
          </div>

          {/* Columns under a rule, matching the homepage's three-up — not three bordered boxes.
              The numbering stays because this genuinely IS a sequence (drop → convert → open), which
              is the only case where numbered markers carry information rather than decorate. It is a
              mono ordinal now rather than a filled violet disc: violet is the action colour on this
              page and the step numbers are not actions. */}
          <ol className="mt-8 grid gap-8 border-t border-line pt-6 sm:grid-cols-3">
            {[t("howStep1"), t("howStep2"), t("howStep3")].map((step, i) => (
              <li key={i}>
                <span className="eyebrow">{String(i + 1).padStart(2, "0")}</span>
                <p className="mt-2 text-base leading-relaxed text-fg-muted">{step}</p>
              </li>
            ))}
          </ol>

          <div className="mt-8 space-y-2 border-t border-line pt-4 text-base leading-relaxed text-fg-subtle">
            <p>{t("livePreview")}</p>
            <p>{t("targetsNote")}</p>
            <p>
              {t.rich("tip", {
                link: (c) => (
                  <Link href="/extension" className="text-violet-300 hover:underline">{c}</Link>
                ),
              })}
            </p>
          </div>
        </>
      )}

      {/* Batch convert — many .3mf → U1 at once, back as a ZIP. Idle only; single-file flow is untouched. */}
      {status === "idle" && !file && !stlFile && (
        <section className="mt-6 rounded-lg border border-line bg-surface-2 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-fg">{t("batchTitle")}</h2>
              <p className="mt-1 max-w-md text-sm text-fg-muted">{t("batchDesc")}</p>
            </div>
            <button
              onClick={() => batchRef.current?.click()}
              disabled={batchState === "working"}
              className="btn-secondary btn-md shrink-0"
            >
              {batchState === "working" ? t("batchConverting") : t("batchChoose")}
            </button>
          </div>
          <input
            ref={batchRef}
            type="file"
            accept=".3mf"
            multiple
            className="hidden"
            onChange={(e) => {
              const fs = e.target.files ? Array.from(e.target.files) : [];
              e.target.value = ""; // allow re-picking the same set
              if (fs.length) batchConvert(fs);
            }}
          />
          {batchState === "working" && (
            <div className="mt-3">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
                <div className="h-full bg-violet-600 transition-all" style={{ width: `${Math.round(batchProgress * 100)}%` }} />
              </div>
              <p className="mt-2 text-xs text-fg-muted">{batchMsg}</p>
            </div>
          )}
          {batchState === "done" && <p className="mt-3 text-xs font-medium text-green-300">{batchMsg}</p>}
          {batchState === "error" && <p className="mt-3 text-xs font-medium text-red-300">{batchMsg}</p>}
          <p className="mt-3 text-xs text-fg-subtle">{t("batchNote")}</p>
        </section>
      )}
      {status === "idle" && !file && !stlFile && (
        <Link
          href="/image"
          className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-2 p-5 transition hover:bg-surface-3"
        >
          <div>
            <h2 className="text-sm font-semibold text-fg">{t("photoCtaTitle")}</h2>
            <p className="mt-1 max-w-md text-sm text-fg-muted">{t("photoCtaBody")}</p>
          </div>
          <span className="shrink-0 text-sm font-semibold text-violet-300">{t("photoCtaOpen")}</span>
        </Link>
      )}

      {stlFile && (
        <section className="mt-6 rounded-lg border border-line bg-surface-2 p-5">
          <h2 className="text-sm font-semibold text-fg">{t("stlTitle")}</h2>
          <p className="mt-1 text-sm text-fg-muted">{t("stlNote")}</p>
          <button
            onClick={wrapStl}
            className="btn-primary btn-md mt-4"
          >
            {t("stlConvert")}
          </button>
          <p className="mt-3 text-xs text-fg-subtle">{t("stlNext")}</p>
        </section>
      )}

      {meshLoading && (
        <div className="mt-4 flex items-center gap-2 text-sm text-fg-muted">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-violet-400 border-t-transparent" />
          {t("readingColors")} <span className="text-fg-subtle">{t("readingLocal")}</span>
        </div>
      )}
      {/* A file that couldn't be READ fails here, right where the spinner was — not 900 lines further
          down. `!analysis` distinguishes it from a later conversion error, which still reports below
          next to the output buttons it belongs to, so the message is never shown twice. */}
      {status === "error" && !analysis && (
        <p role="alert" className="notice notice-warn mt-4">
          <NoticeIcon level="warn" />
          <span>{message}</span>
        </p>
      )}
      {plateOptions && plateOptions.length > 1 && (
        <section className="mt-4 rounded-lg border border-violet-400/30 bg-violet-400/[0.06] p-5">
          <h2 className="font-semibold text-fg">{t("platePickTitle", { count: plateOptions.length })}</h2>
          <p className="mt-1 text-sm text-fg-muted">{t("platePickBody")}</p>
          {plateOptions.some((pl) => pl.bytes > HEAVY_PLATE) && (
            <p className="mt-2 text-xs text-amber-300">{t("plateHeavyNote")}</p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {plateOptions.map((pl) => (
              <button
                key={pl.index}
                onClick={() => convertPlate(pl)}
                disabled={plateBusy !== null}
                className="rounded-lg border border-line bg-surface px-4 py-2 text-sm text-fg transition hover:bg-surface-3 disabled:opacity-50"
                // The two spans are only separated visually (ml-2), so the accessible name runs them
                // together: plate 1 at 2 MB announced as "Plate 12 MB", which reads as plate 12. An
                // explicit label keeps the number and the size distinct for anyone not seeing the gap.
                aria-label={`${t("plateN", { index: pl.index })} — ${(pl.bytes / 1048576).toFixed(0)} MB`}
              >
                <span className="font-semibold">{t("plateN", { index: pl.index })}</span>
                <span className={`ml-2 text-xs ${pl.bytes > HEAVY_PLATE ? "text-amber-300" : "text-fg-subtle"}`}>
                  {plateBusy === pl.index ? t("plateExtracting") : `${(pl.bytes / 1048576).toFixed(0)} MB`}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
      {previewNote && (
        <p className="notice notice-info mt-4">
          {previewNote}
        </p>
      )}

      {/* Fallback when the live preview couldn't load (a very large painted file OOMs the preview worker):
          still surface the color count + Full Spectrum, driven by the lightweight analysis. Conversion
          reads the full file, and `physical` is seeded from the analysis, so Full Spectrum still works. */}
      {!mesh && analysis?.painted && usedCount > 4 && (
        <section className="mt-6 rounded-lg border border-line bg-surface-2 p-5">
          <h2 className="text-sm font-semibold text-fg">{t("previewHeader", { count: usedCount })}</h2>
          <p className="mt-1 text-xs text-fg-muted">
            {t("previewTooLargeDesc")}
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {(analysis.colors ?? []).map((c, i) => (
              <span key={i} className="h-6 w-6 rounded border border-line" style={{ background: c }} title={c} />
            ))}
          </div>
          <label className="mt-4 flex cursor-pointer items-start gap-2 text-sm text-fg-muted">
            <input
              type="checkbox"
              checked={fullSpectrum}
              onChange={(e) => { setFullSpectrum(e.target.checked); if (e.target.checked) { setCustomFS(false); setBandSwap(false); } }}
              className="mt-0.5 h-4 w-4 accent-violet-500"
            />
            <span>
              <span className="font-medium text-fg">{t("fsLabel")}</span> {t("fsDesc1")}
              <span className="ml-1 rounded bg-amber-400/15 px-1.5 py-0.5 text-xs text-amber-200">{t("experimental")}</span>
              <span className="mt-1 block text-xs text-fg-subtle">{t("fsDesc2")}</span>
            </span>
          </label>
          {fullSpectrum && mixMatches && (() => {
            const bad = mixMatches.filter((m, i) => m && !physical.includes(i) && m.deltaE > 12).length;
            if (!bad) return null;
            return (
              <p className="mt-3 rounded-lg border border-red-400/25 bg-red-400/[0.07] px-3 py-2 text-xs leading-relaxed text-red-200">
                <strong className="text-red-100">Full Spectrum can&apos;t reproduce {bad} of these colors.</strong> Mixing can&apos;t
                make a color that isn&apos;t one of the 4 loaded heads, so a saturated set like this (distinct reds/greens/blues) shifts
                a lot. Full Spectrum suits blended palettes (skin tones, gradients) — not distinct primaries.
              </p>
            );
          })()}
        </section>
      )}

      {/* Live colored preview + (when >4 colors) per-color slot mapping */}
      {mesh && (
        <section className="mt-6 rounded-lg border border-line bg-surface-2 p-5">
          <h2 className="text-sm font-semibold text-fg">
            {usedCount > 4 ? t("previewHeader", { count: usedCount }) : t("previewHeaderShort")}
          </h2>
          <p className="mt-1 text-xs text-fg-muted">
            {usedCount > 4 ? t("previewNoteReduce") : t("previewNoteNormal")}
          </p>

          {hasGroups && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                onClick={() => cycle(-1)}
                disabled={selKind === "all"}
                className="rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-sm text-fg transition hover:bg-surface-3 disabled:opacity-40"
                aria-label="Previous"
              >
                ←
              </button>
              <select
                value={sel}
                onChange={(e) => setSel(e.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-sm text-fg"
              >
                <option value="all" className="bg-surface">
                  All {mesh.parts.length} parts{mesh.plates.length > 1 ? ` · ${mesh.plates.length} plates` : ""}
                </option>
                {mesh.plates.length > 1 && (
                  <optgroup label={t("byPlate")}>
                    {mesh.plates.map((pl, i) => (
                      <option key={i} value={`plate:${i}`} className="bg-surface">
                        Plate {i + 1}{pl.name ? ` — ${pl.name}` : ""} ({pl.partIndices.length} part{pl.partIndices.length > 1 ? "s" : ""})
                      </option>
                    ))}
                  </optgroup>
                )}
                {mesh.parts.length > 1 && (
                  <optgroup label={t("individualParts")}>
                    {mesh.parts.map((_, i) => (
                      <option key={i} value={`part:${i}`} className="bg-surface">{partLabel(i)}</option>
                    ))}
                  </optgroup>
                )}
              </select>
              <button
                onClick={() => cycle(1)}
                disabled={selKind === "all"}
                className="rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-sm text-fg transition hover:bg-surface-3 disabled:opacity-40"
                aria-label="Next"
              >
                →
              </button>
              <span className="text-xs text-fg-subtle">
                {selKind === "plate"
                  ? `Plate ${selIdx + 1} of ${mesh.plates.length}`
                  : selKind === "part"
                    ? `${selIdx + 1} of ${mesh.parts.length}`
                    : `${mesh.parts.length} parts`}
              </span>
            </div>
          )}

          <div className="mt-4">
            {viewMesh && <PaintPreview mesh={viewMesh} colorForState={colorForState} colorKey={colorKey} />}
          </div>

          {/* 4 slot editors. In Full Spectrum the slots ARE the physical heads (from `physical`); their
              colors come from the model and only their order is editable. Otherwise they're the 4
              reduced slot colors, editable and reorderable. */}
          {(() => {
            // Mode-aware view of the 4 slots: {color, editable} per slot, plus a length for bounds.
            const fsColors = physical.map((pi) => mesh.palette[pi] ?? "#888888");
            const view = fullSpectrum ? fsColors : slots;
            const last = view.length - 1;
            // Column count: Full Spectrum is always the U1's 4 physical heads; the plain editor follows the
            // selected target's slot count. Class names must be literal for Tailwind — toolheads are 4 or 5,
            // so 4-slot targets keep the exact "grid-cols-4" they render today. The 5-slot case drops to 3
            // columns on mobile so the pickers/buttons stay tappable instead of cramming 5 across a phone.
            const gridColsClass = (fullSpectrum ? 4 : slotCount) >= 5 ? "grid-cols-3 sm:grid-cols-5" : "grid-cols-4";
            const move = (i: number, dir: -1 | 1) => (fullSpectrum ? movePhysical(i, dir) : moveSlot(i, dir));
            return (
              <>
                <div className={`mt-5 grid ${gridColsClass} gap-3`}>
                  {view.map((c, i) => (
                    <label key={i} className="flex flex-col items-center gap-1 text-xs text-fg-muted">
                      Slot {i + 1}
                      {slotPlates[i]?.length > 0 && (
                        <span className="text-xs font-normal leading-tight text-violet-300">
                          {slotPlates[i].length === 1 ? `Plate ${slotPlates[i][0]}` : `Plates ${slotPlates[i].join(", ")}`}
                        </span>
                      )}
                      {/* A slot no colour maps to is padded to #FFFFFF, which on screen is a white
                          swatch — indistinguishable from "load white filament here". Say so instead.
                          `assign` is the colour→slot mapping and moveSlot remaps it, so this stays
                          correct after a reorder; Full Spectrum uses all four heads by definition. */}
                      {!fullSpectrum && assign.length > 0 && !assign.includes(i) && (
                        <span className="text-xs font-normal leading-tight text-fg-subtle">
                          {t("slotUnused")}
                        </span>
                      )}
                      <input
                        type="color"
                        value={c}
                        disabled={fullSpectrum}
                        onChange={(e) => !fullSpectrum && setSlots(slots.map((s, j) => (j === i ? e.target.value.toUpperCase() : s)))}
                        title={fullSpectrum ? t("mainColorTitle") : undefined}
                        className="h-9 w-full cursor-pointer rounded-lg border border-line bg-transparent disabled:cursor-default"
                      />
                      {/* The glyphs mirror in RTL. `move(i, -1)` moves a swatch toward index 0,
                          which renders on the RIGHT in Arabic — so an un-mirrored ◀ points away from
                          where the swatch is about to go. */}
                      <span className="flex justify-center gap-1 [&_button]:rtl:-scale-x-100">
                        <button
                          onClick={() => move(i, -1)}
                          disabled={i === 0}
                          title={t("movePrev")}
                          aria-label={t("movePrev")}
                          className="icon-btn"
                        >
                          ◀
                        </button>
                        <button
                          onClick={() => move(i, 1)}
                          disabled={i === last}
                          title={t("moveNext")}
                          aria-label={t("moveNext")}
                          className="icon-btn"
                        >
                          ▶
                        </button>
                      </span>
                    </label>
                  ))}
                </div>
                <p className="mt-2 text-xs text-fg-subtle">
                  {fullSpectrum
                    ? t("reorderHintFs")
                    : t("reorderHintNormal")}
                </p>
              </>
            );
          })()}

          {/* Vertical colour-banding advisory: exact colours via a few filament swaps beat Full Spectrum
              mixing when the model's colors change only by height. Detected from the painted mesh. */}
          {showBands && mesh && bandPlan && (
            <div className="mt-5 rounded-lg border border-emerald-400/25 bg-emerald-400/[0.06] p-4">
              <label className="flex cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  checked={bandSwap}
                  onChange={(e) => { setBandSwap(e.target.checked); if (e.target.checked) { setFullSpectrum(false); setCustomFS(false); } }}
                  className="mt-0.5 h-4 w-4 accent-emerald-500"
                />
                <span className="text-sm font-medium text-emerald-100">
                  Print all {bandPlan.colorCount} colors exactly with {bandPlan.manualSwaps} filament swap{bandPlan.manualSwaps === 1 ? "" : "s"}
                  <span className="ml-1 rounded bg-amber-400/15 px-1.5 py-0.5 text-xs text-amber-200">experimental</span>
                </span>
              </label>
              <p className="mt-1 pl-6 text-xs text-emerald-200">
                This model&apos;s colors change only by height ({bandPlan.bands.length} horizontal bands), so instead of Full
                Spectrum mixing you can keep every color <strong>exactly</strong>: load 4 filaments and swap{" "}
                {bandPlan.manualSwaps} time{bandPlan.manualSwaps === 1 ? "" : "s"} mid-print. Turning this on maps the colors to
                the 4 heads and <strong>auto-inserts an M600 pause</strong> at each swap height — you get the swap list after converting.
              </p>
              <ol className="mt-3 space-y-1 text-xs text-fg-muted">
                {bandPlan.bands.map((b, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="h-4 w-4 shrink-0 rounded border border-line" style={{ background: mesh.palette[b.state - 1] ?? "#888888" }} />
                    <span className="w-24 shrink-0 tabular-nums text-fg-muted">{b.z0.toFixed(1)}–{b.z1.toFixed(1)} mm</span>
                    <span className="text-fg-subtle">{mesh.palette[b.state - 1] ?? "?"}</span>
                    {i < 4 ? (
                      <span className="ml-auto text-fg-subtle">preload (no pause)</span>
                    ) : (
                      <span className="ml-auto rounded bg-amber-400/15 px-1 text-amber-200">pause &amp; swap at {b.z0.toFixed(1)} mm</span>
                    )}
                  </li>
                ))}
              </ol>
              <p className="mt-2 text-xs text-fg-subtle">
                Bands 1–4 load on the U1&apos;s four heads (automatic, no pause). Bands 5+ reuse a head — the printer pauses so
                you swap that spool. Tip: where you can, load light colors before dark ones — dark residue bleeds into a lighter
                color after a swap.
              </p>
            </div>
          )}

          {/* Custom-palette Full Spectrum (e.g. CMYK) — reproduce the model's colors as mixes of your OWN
              loaded filaments, at ANY color count. Mutually exclusive with the >4 palette-mixing below. */}
          {analysis?.painted && (
            <div className="mt-5 rounded-lg border border-line bg-surface-2 p-4">
              <label className="flex cursor-pointer items-start gap-2 text-sm text-fg-muted">
                <input
                  type="checkbox"
                  checked={customFS}
                  onChange={(e) => { setCustomFS(e.target.checked); if (e.target.checked) { setFullSpectrum(false); setBandSwap(false); } }}
                  className="mt-0.5 h-4 w-4 accent-violet-500"
                />
                <span>
                  <span className="font-medium text-fg">{t("customFsLabel")}</span>
                  <span className="ml-1 rounded bg-amber-400/15 px-1.5 py-0.5 text-xs text-amber-200">{t("experimental")}</span>
                  <span className="mt-1 block text-xs text-fg-subtle">{t("customFsDesc")}</span>
                </span>
              </label>
              {customFS && (
                <>
                  <p className="mt-3 text-xs text-fg-muted">{t("customFsSetLabel")}</p>
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {customBases.map((hex, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input
                          type="color"
                          value={/^#[0-9a-fA-F]{6}$/.test(hex) ? hex : "#000000"}
                          onChange={(e) => setCustomBases((b) => b.map((x, j) => (j === i ? e.target.value.toUpperCase() : x)))}
                          aria-label={`Slot ${i + 1} color picker`}
                          className="h-8 w-8 shrink-0 cursor-pointer rounded border border-line bg-transparent"
                        />
                        <span className="text-xs text-fg-subtle">Slot {i + 1}</span>
                        <input
                          type="text"
                          value={hex}
                          onChange={(e) => {
                            let v = e.target.value.trim().toUpperCase();
                            if (v && !v.startsWith("#")) v = "#" + v;
                            setCustomBases((b) => b.map((x, j) => (j === i ? v : x)));
                          }}
                          spellCheck={false}
                          maxLength={7}
                          aria-label={`Slot ${i + 1} hex code`}
                          className="w-24 rounded border border-line bg-surface-2 px-2 py-1 font-mono text-xs text-fg"
                          placeholder="#RRGGBB"
                        />
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <button onClick={() => setCustomBases(["#29ABE2", "#ED1E79", "#FCEE21", "#111111"])} className="rounded-lg border border-line px-2.5 py-1 text-xs text-fg-muted hover:bg-surface-3">{t("resetToCmyk")}</button>
                    <Link href="/mixer" className="text-xs text-violet-300 hover:underline">{t("previewGamut")}</Link>
                  </div>

                  {/* Per-colour recipe: the converter's best 2-filament match, editable. */}
                  {customRecipes && (
                    <>
                      <p className="mt-4 text-xs font-medium text-fg-muted">{t("eachColorMix")} <span className="font-normal text-fg-subtle">{t("eachColorMixHint")}</span></p>
                      <ul className="mt-2 space-y-2">
                        {usedStates.map((s) => {
                          const i = s - 1;
                          const r = customRecipes[i];
                          if (!r) return null;
                          const set = (next: MixRecipe) => setMixOverrides((o) => ({ ...o, [i]: next }));
                          const clearOv = () => setMixOverrides((o) => { const n = { ...o }; delete n[i]; return n; });
                          const sel = "rounded border border-line bg-surface-2 px-1 py-0.5 text-xs text-fg";
                          const three = r.ids.length === 3 && !r.override;
                          const a = r.ids[0], b = r.ids[1] ?? r.ids[0], pctB = r.weights[1] ?? 0;
                          return (
                            <li key={s} className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                              <span className="h-5 w-5 rounded border border-line" style={{ background: mesh.palette[i] }} title={`target ${mesh.palette[i]}`} />
                              <span className="text-fg-subtle">→</span>
                              {three ? (
                                <>
                                  <span className="text-fg-muted">{r.ids.map((id, k) => `S${id} ${r.weights[k]}%`).join(" + ")}</span>
                                  <span className="rounded bg-sky-400/15 px-1 text-sky-200" title="3-filament blend — a closer match than any 2">3-way</span>
                                  <button onClick={() => set({ a, b, mixBPercent: Math.round((100 * pctB) / ((r.weights[0] ?? 0) + pctB || 1)) })} className="text-fg-subtle hover:text-fg" title="Edit as a 2-filament mix instead">edit 2-way</button>
                                </>
                              ) : (
                                <>
                                  <select className={sel} value={a} onChange={(e) => set({ a: Number(e.target.value), b, mixBPercent: pctB })}>
                                    {customBases.map((h, k) => <option key={k} value={k + 1} className="bg-surface">{k + 1}: {h}</option>)}
                                  </select>
                                  +
                                  <select className={sel} value={b} onChange={(e) => set({ a, b: Number(e.target.value), mixBPercent: pctB })}>
                                    {customBases.map((h, k) => <option key={k} value={k + 1} className="bg-surface">{k + 1}: {h}</option>)}
                                  </select>
                                  <input type="range" min={0} max={100} value={pctB} onChange={(e) => set({ a, b, mixBPercent: Number(e.target.value) })} className="w-16 accent-violet-500" />
                                  <span className="w-8 tabular-nums">{pctB}%</span>
                                </>
                              )}
                              <span className="h-5 w-5 rounded border border-line" style={{ background: r.hex }} title={`result ${r.hex}`} />
                              {!r.override && r.ids.length >= 2 && Math.round(r.deltaE) > 12 && <span className="rounded bg-amber-400/15 px-1 text-amber-200" title="Even a 3-way mix can't reach this well — try a different base filament.">≈ off</span>}
                              {r.override && <button onClick={clearOv} className="text-fg-subtle hover:text-fg" title="Back to auto-match">auto</button>}
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3">
                    <label htmlFor="mlh-cfs" className="text-xs font-medium text-fg-muted">{t("mixedLayerHeightLabel")}</label>
                    <select
                      id="mlh-cfs"
                      value={mixedLayerHeight}
                      onChange={(e) => setMixedLayerHeight(Number(e.target.value))}
                      className="rounded-lg border border-line bg-surface-2 px-2 py-1 text-sm text-fg"
                    >
                      <option value={0} className="bg-surface">{t("mlhSame")}</option>
                      <option value={0.08} className="bg-surface">{t("mlhFinest")}</option>
                      <option value={0.1} className="bg-surface">{t("mlhFiner")}</option>
                      <option value={0.12} className="bg-surface">{t("mlhBalanced")}</option>
                      <option value={0.16} className="bg-surface">{t("mlhCoarser")}</option>
                    </select>
                    <span className="text-xs text-fg-subtle">
                      {mixedLayerHeight === 0 ? t("mlhNoteSame") : t("mlhNoteSet")}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-fg-subtle">
                    Uses the tested U1 profile with these 4 filaments; mixed colors print as dithered blends (2–3 filaments).
                  </p>
                </>
              )}
            </div>
          )}

          {/* Subdivide Mix Layer — applies to any Full Spectrum output. On by default. */}
          {(customFS || fullSpectrum) && (
            <label className="mt-4 flex cursor-pointer items-start gap-2 rounded-lg border border-line bg-surface-2 p-3 text-sm text-fg-muted">
              <input type="checkbox" checked={subdivide} onChange={(e) => setSubdivide(e.target.checked)} className="mt-0.5 h-4 w-4 accent-violet-500" />
              <span>
                <span className="font-medium text-fg">{t("subdivideLabel")}</span> <span className="text-fg-subtle">{t("subdivideRecommended")}</span>
                <span className="mt-1 block text-xs text-fg-subtle">
                  {t.rich("subdivideDesc", {
                    b: (c) => <strong className="text-fg-muted">{c}</strong>,
                  })}
                </span>
              </span>
            </label>
          )}

          {/* Full Spectrum reality check: blends are an optical illusion of thin alternating layers, so
              filament opacity and layer height decide whether they read as a color or as visible stripes. */}
          {(customFS || fullSpectrum) && (
            <p className="mt-3 rounded-lg border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2 text-xs leading-relaxed text-amber-200">
              {t.rich("blendTip", {
                lead: (c) => <strong className="text-amber-100">{c}</strong>,
                b: (c) => <strong>{c}</strong>,
              })}
            </p>
          )}

          {/* used colors, ranked by area, each assigned to a slot (only when reducing) */}
          {usedCount > 4 && (
          <div className="mt-5">
            <label className="flex cursor-pointer items-start gap-2 border-b border-line pb-3 text-sm text-fg-muted">
              <input
                type="checkbox"
                checked={fullSpectrum}
                onChange={(e) => { setFullSpectrum(e.target.checked); if (e.target.checked) { setCustomFS(false); setBandSwap(false); } }}
                className="mt-0.5 h-4 w-4 accent-violet-500"
              />
              <span>
                <span className="font-medium text-fg">{t("fsLabel")}</span> {t("fsDesc1")}
                <span className="ml-1 rounded bg-amber-400/15 px-1.5 py-0.5 text-xs text-amber-200">{t("experimental")}</span>
                <span className="mt-1 block text-xs text-fg-subtle">{t("fsDesc2")}</span>
              </span>
            </label>
            {fullSpectrum && mixMatches && mesh && (() => {
              // Colours Full Spectrum can't fake from the 4 heads (a mix can't manufacture a primary that
              // isn't loaded). ΔE > 12 is a clearly-visible shift. Warn instead of silently showing them wrong.
              const bad = mixMatches
                .map((m, i) => (m && !physical.includes(i) && m.deltaE > 12 ? { hex: mesh.palette[i], got: m.hex, dE: m.deltaE } : null))
                .filter((x): x is { hex: string; got: string; dE: number } => !!x)
                .sort((a, b) => b.dE - a.dE);
              if (!bad.length) return null;
              return (
                <p className="mt-3 rounded-lg border border-red-400/25 bg-red-400/[0.07] px-3 py-2 text-xs leading-relaxed text-red-200">
                  {/* The swatch pairs are the <ex> tag's children rather than a separate message, so a
                      translator can move the whole "(e.g. ▢ → ▢)" parenthetical to wherever it belongs
                      in their sentence instead of being pinned to the English word order. */}
                  {t.rich("fsUnreachable", {
                    count: bad.length,
                    b: (c) => <strong className="text-red-100">{c}</strong>,
                    ex: (c) => (
                      <>
                        {c}{" "}
                        {bad.slice(0, 2).map((x) => (
                          <span key={x.hex} className="whitespace-nowrap">
                            <span className="inline-block h-2.5 w-2.5 rounded-lg align-middle" style={{ background: x.hex }} />{" "}
                            {/* The arrow means "becomes", so it has to follow the reading direction. */}
                            <span className="inline-block rtl:-scale-x-100">→</span>{" "}
                            <span className="inline-block h-2.5 w-2.5 rounded-lg align-middle" style={{ background: x.got }} />{" "}
                          </span>
                        ))}
                      </>
                    ),
                  })}
                </p>
              );
            })()}
            <p className="mt-3 text-xs font-medium text-fg-muted">
              {fullSpectrum
                ? t("fsPickHeader", { chosen: physical.length })
                : t("usedColorsHeader")}
            </p>
            {fullSpectrum && (
              <p className="mt-2 rounded-lg border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2 text-xs leading-relaxed text-amber-200">
                {t("fsTip")}
              </p>
            )}
            {fullSpectrum && (
              <MyFilaments
                targets={physical.filter((i) => i >= 0 && i < palette.length).map((i) => ({ index: i, hex: physicalHex[i] ?? palette[i] }))}
                onApply={(picks) => setPhysicalHex((h) => ({ ...h, ...picks }))}
              />
            )}
            <ul className="mt-2 space-y-2">
              {usedStates
                .map((s) => ({ s, faces: s === mesh.baseState ? totalFaces : mesh.usage[s - 1] ?? 0 }))
                .sort((a, b) => b.faces - a.faces)
                .map(({ s }) => {
                  const i = s - 1;
                  const faces = mesh.usage[i] ?? 0;
                  const pct = totalFaces ? ((100 * faces) / totalFaces).toFixed(faces / totalFaces < 0.01 ? 2 : 0) : "0";
                  return (
                    <li key={s} className="flex items-center gap-3">
                      <span className="h-5 w-5 rounded border border-line" style={{ background: mesh.palette[i] }} />
                      <span className="text-xs text-fg-muted">{mesh.palette[i]}</span>
                      <span className="text-xs text-fg-subtle">
                        {pct}%{s === mesh.baseState ? ` · ${t("base")}` : ""}
                      </span>
                      {fullSpectrum ? (
                        <span className="ml-auto flex items-center gap-2 text-xs">
                          {physical.includes(i) ? (
                            <span className="flex items-center gap-1.5">
                              <span className="rounded bg-violet-400/20 px-2 py-1 text-violet-200">{t("mainColorBadge")}</span>
                              <input
                                type="text"
                                value={physicalHex[i] ?? mesh.palette[i]}
                                onChange={(e) => {
                                  let v = e.target.value.trim().toUpperCase();
                                  if (v && !v.startsWith("#")) v = "#" + v;
                                  setPhysicalHex((h) => ({ ...h, [i]: v }));
                                }}
                                spellCheck={false}
                                maxLength={7}
                                aria-label="Filament hex loaded on this head"
                                title="The filament you'll actually load here — override if it isn't the model's color"
                                className="w-[4.5rem] rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-fg"
                              />
                            </span>
                          ) : mixMatches && mixMatches[i] ? (
                            (() => {
                              const mm = mixMatches[i]!;
                              const setMix = (next: MixRecipe) => setMixOverrides((o) => ({ ...o, [i]: next }));
                              const sel = "rounded border border-line bg-surface-2 px-1 py-0.5 text-xs text-fg";
                              const three = mm.ids.length === 3 && !mm.override;
                              const a = mm.ids[0], b = mm.ids[1] ?? mm.ids[0], pctB = mm.weights[1] ?? 0;
                              return (
                                <span className="flex items-center gap-1 text-xs text-fg-muted">
                                  ≈
                                  {three ? (
                                    <>
                                      <span className="text-fg-muted">{mm.ids.map((id, k) => `S${id} ${mm.weights[k]}%`).join(" + ")}</span>
                                      <span className="rounded bg-sky-400/15 px-1 text-sky-200" title="3-filament blend — a closer match than any 2">3-way</span>
                                      <button type="button" onClick={() => setMix({ a, b, mixBPercent: Math.round((100 * pctB) / ((mm.weights[0] ?? 0) + pctB || 1)) })} className="text-fg-subtle hover:text-fg" title="Edit as a 2-filament mix instead">edit 2-way</button>
                                    </>
                                  ) : (
                                    <>
                                      <select className={sel} value={a} onChange={(e) => setMix({ a: Number(e.target.value), b, mixBPercent: pctB })}>
                                        {physical.map((p, k) => (
                                          <option key={k} value={k + 1} className="bg-surface">{k + 1}: {physicalColors[k] ?? mesh.palette[p]}</option>
                                        ))}
                                      </select>
                                      +
                                      <select className={sel} value={b} onChange={(e) => setMix({ a, b: Number(e.target.value), mixBPercent: pctB })}>
                                        {physical.map((p, k) => (
                                          <option key={k} value={k + 1} className="bg-surface">{k + 1}: {physicalColors[k] ?? mesh.palette[p]}</option>
                                        ))}
                                      </select>
                                      <input type="range" min={0} max={100} value={pctB} onChange={(e) => setMix({ a, b, mixBPercent: Number(e.target.value) })} className="w-14 accent-violet-500" />
                                      <span className="w-7 tabular-nums">{pctB}%</span>
                                    </>
                                  )}
                                  <span className="h-5 w-5 rounded border border-line" style={{ background: mm.hex }} title={t("approxResult")} />
                                </span>
                              );
                            })()
                          ) : null}
                          <button
                            type="button"
                            onClick={() => togglePhysical(i)}
                            disabled={!physical.includes(i) && physical.length >= 4}
                            className={`rounded-lg border px-2 py-1 ${
                              physical.includes(i)
                                ? "border-violet-400 bg-violet-400/10 text-violet-200"
                                : "border-line bg-surface-2 text-fg-muted hover:text-fg disabled:opacity-40"
                            }`}
                          >
                            {physical.includes(i) ? t("isMain") : t("makeMain")}
                          </button>
                        </span>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => togglePin(i)}
                            title={pinned.includes(i) ? t("pinnedTitle") : t("pinTitle")}
                            aria-label={pinned.includes(i) ? t("pinnedTitle") : t("pinTitle")}
                            aria-pressed={pinned.includes(i)}
                            className={`ms-auto rounded-lg border px-2 py-1 text-sm ${
                              pinned.includes(i)
                                ? "border-violet-400 bg-violet-400/20 text-violet-200"
                                : "border-line bg-surface-2 text-fg-muted hover:text-fg"
                            }`}
                          >
                            
                          </button>
                          <select
                            value={assign[i] ?? 0}
                            onChange={(e) => setAssign(assign.map((a, j) => (j === i ? Number(e.target.value) : a)))}
                            className="rounded-lg border border-line bg-surface-2 px-2 py-1 text-sm text-fg"
                          >
                            {Array.from({ length: slotCount }, (_, sl) => sl).map((sl) => (
                              <option key={sl} value={sl} className="bg-surface">
                                {t("slot", { n: sl + 1 })}
                              </option>
                            ))}
                          </select>
                        </>
                      )}
                    </li>
                  );
                })}
            </ul>
            {fullSpectrum && mixMatches?.some((m) => m && m.ids.length === 2 && ((m.weights[1] ?? 0) <= 25 || (m.weights[1] ?? 0) >= 75)) && (
              <p className="notice notice-info mt-3 text-xs">
                {t("lopsidedTip")}
              </p>
            )}
            {fullSpectrum && (
              <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
                <label htmlFor="mlh" className="text-xs font-medium text-fg-muted">
                  {t("mixedLayerHeightLabel")}
                </label>
                <select
                  id="mlh"
                  value={mixedLayerHeight}
                  onChange={(e) => setMixedLayerHeight(Number(e.target.value))}
                  className="rounded-lg border border-line bg-surface-2 px-2 py-1 text-sm text-fg"
                >
                  <option value={0} className="bg-surface">{t("mlhSame")}</option>
                  <option value={0.08} className="bg-surface">{t("mlhFinest")}</option>
                  <option value={0.1} className="bg-surface">{t("mlhFiner")}</option>
                  <option value={0.12} className="bg-surface">{t("mlhBalanced")}</option>
                  <option value={0.16} className="bg-surface">{t("mlhCoarser")}</option>
                </select>
                <span className="text-xs text-fg-subtle">
                  {mixedLayerHeight === 0 ? t("mlhNoteSame") : t("mlhNoteSet")}
                </span>
              </div>
            )}
          </div>
          )}
        </section>
      )}

      {/* ── WHY THESE STOPPED BEING ONE COLOUR ────────────────────────────────────────────────────
          `sky-500/10` carried both halves of this list. Stacked back to back on a real conversion it
          read: "don't use Split to objects — those drop painted colors" and "no significant
          overhangs, this likely prints without supports" — a caution and a piece of good news, in
          identical boxes with no icon between them. Whether a notice is telling you to act is the
          one thing a notice's appearance has to answer.

          `warnOverhangNo` is the only positive result the converter produces, so it takes the third
          style rather than being filed under "information". */}
      {warnings.length > 0 && (
        <div className="mt-6 space-y-2">
          {warnings.map((w, i) => {
            const level = w.level === "warn" ? "warn" : w.key === "warnOverhangNo" ? "ok" : "info";
            return (
              <p key={i} className={`notice notice-${level}`}>
                <NoticeIcon level={level} />
                <span>{t(w.key, w.params)}</span>
              </p>
            );
          })}
        </div>
      )}

      {file && (
        <div className="mt-6 rounded-lg border border-line bg-surface-2 p-4">
          <p className="text-sm font-medium text-fg-muted">{t("settingsTitle")}</p>
          <div className="mt-2 inline-flex flex-wrap rounded-lg border border-line bg-surface-2 p-1 text-sm">
            <button
              type="button"
              onClick={() => setProfileMode("preserve")}
              className={`rounded-lg px-3 py-1.5 ${profileMode === "preserve" ? "bg-violet-600 text-white" : "text-fg-muted hover:text-fg"}`}
            >
              {t("keepSettings")}
            </button>
            <button
              type="button"
              onClick={() => setProfileMode("stamp")}
              className={`rounded-lg px-3 py-1.5 ${profileMode === "stamp" ? "bg-violet-600 text-white" : "text-fg-muted hover:text-fg"}`}
            >
              {t("useTested")}
            </button>
          </div>
          <p className="mt-2 text-xs text-fg-subtle">
            {profileMode === "preserve" ? t("preserveDesc") : t("stampDesc", { nozzle: nozzle })}
          </p>

          {/* U1 nozzle. The U1 ships in four sizes and Snapmaker Orca has a preset for each, but we
              bundle a real export for only one of them — so this control has to say which is which
              rather than presenting four equal options. See targets.ts `u1NozzleVariant`. */}
          {targetId === "u1" && (
            <div className="mt-4 border-t border-line pt-4">
              <p className="text-sm font-medium text-fg-muted">{t("nozzleTitle")}</p>
              <div className="mt-2 inline-flex flex-wrap rounded-lg border border-line bg-surface-2 p-1 text-sm">
                {U1_NOZZLES.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setNozzle(n)}
                    className={`rounded-lg px-3 py-1.5 ${nozzle === n ? "bg-violet-600 text-white" : "text-fg-muted hover:text-fg"}`}
                  >
                    {format.number(n)} {t("nozzleUnit")}
                    {n === U1_TESTED_NOZZLE && (
                      <span className={`ms-1.5 text-xs ${nozzle === n ? "text-violet-100" : "text-fg-subtle"}`}>
                        {t("nozzleTested")}
                      </span>
                    )}
                  </button>
                ))}
              </div>
              {nozzle !== U1_TESTED_NOZZLE && (
                <p className="mt-2 rounded-lg border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2 text-xs leading-relaxed text-amber-200">
                  {t("nozzleDerivedNote", { nozzle: nozzle, tested: U1_TESTED_NOZZLE })}
                </p>
              )}

              {/* Filament preset NAMES. Nothing here changes how the file prints — it changes which
                  library preset Orca resolves each slot to, which is what a model repository checks. */}
              <p className="mt-4 text-sm font-medium text-fg-muted">{t("brandTitle")}</p>
              <div className="mt-2 inline-flex flex-wrap rounded-lg border border-line bg-surface-2 p-1 text-sm">
                {(["source", "generic", "snapmaker"] as const).map((b) => (
                  <button
                    key={b}
                    type="button"
                    onClick={() => setFilamentBrand(b)}
                    className={`rounded-lg px-3 py-1.5 ${filamentBrand === b ? "bg-violet-600 text-white" : "text-fg-muted hover:text-fg"}`}
                  >
                    {t(b === "source" ? "brandSource" : b === "generic" ? "brandGeneric" : "brandSnapmaker")}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-fg-subtle">
                {t(filamentBrand === "source" ? "brandSourceDesc" : filamentBrand === "generic" ? "brandGenericDesc" : "brandSnapmakerDesc")}
              </p>
            </div>
          )}

          {analysis?.encoding === "by-layer" && analysis.colors.length > 4 && (
            <label className="mt-4 flex cursor-pointer items-start gap-2 border-t border-line pt-4 text-sm text-fg-muted">
              <input
                type="checkbox"
                checked={swapPauses}
                onChange={(e) => setSwapPauses(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-violet-500"
              />
              <span>
                {t.rich("swapPausesDesc", {
                  count: analysis.colors.length,
                  b: (c) => <span className="font-medium text-fg">{c}</span>,
                })}
                <span className="ms-1 rounded bg-amber-400/15 px-1.5 py-0.5 text-xs text-amber-200">
                  {t("experimental")}
                </span>
                <span className="mt-1 block text-xs text-fg-subtle">{t("swapPausesNote")}</span>
              </span>
            </label>
          )}

          {/* Pass-through. Offered for every >4 encoding, because it is the one answer that works the
              same way for painted, object-assigned and by-layer files: change nothing, and let Orca
              ask. Turning it on clears the modes that would otherwise renumber the palette. */}
          {targetId === "u1" && (analysis?.colors.length ?? 0) > 4 && (
            <label className="mt-4 flex cursor-pointer items-start gap-2 border-t border-line pt-4 text-sm text-fg-muted">
              <input
                type="checkbox"
                checked={keepAllColours}
                onChange={(e) => {
                  setKeepAllColours(e.target.checked);
                  if (e.target.checked) { setFullSpectrum(false); setCustomFS(false); setBandSwap(false); setSwapPauses(false); }
                }}
                className="mt-0.5 h-4 w-4 accent-violet-500"
              />
              <span>
                {t.rich("keepAllLabel", {
                  count: analysis?.colors.length ?? 0,
                  b: (c) => <span className="font-medium text-fg">{c}</span>,
                })}
                <span className="ms-1 rounded bg-amber-400/15 px-1.5 py-0.5 text-xs text-amber-200">
                  {t("experimental")}
                </span>
                <span className="mt-1 block text-xs text-fg-subtle">{t("keepAllDesc")}</span>
              </span>
            </label>
          )}

          {analysis?.variableLayers && (
            <label className="mt-4 flex cursor-pointer items-start gap-2 border-t border-line pt-4 text-sm text-fg-muted">
              <input
                type="checkbox"
                checked={keepVlhTower}
                onChange={(e) => setKeepVlhTower(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-violet-500"
              />
              <span>
                {t.rich("vlhDesc", {
                  b: (c) => <span className="font-medium text-fg">{c}</span>,
                })}
                <span className="ms-1 rounded bg-amber-400/15 px-1.5 py-0.5 text-xs text-amber-200">{t("advanced")}</span>
                <span className="mt-1 block text-xs text-fg-subtle">{t("vlhNote")}</span>
              </span>
            </label>
          )}
        </div>
      )}

      {/* Save/reuse the target + color settings across files (localStorage; file-specific state excluded). */}
      {file && <ConvertPresets current={presetSettings} onApply={applyPreset} />}

      {/* Target-printer picker. Default = Snapmaker U1 so every existing flow is unchanged. Same-ecosystem
          printers keep their settings (the file's profile is retargeted); other ecosystems are saved as a
          clean Generic 3MF you assign to that printer in its own slicer. */}
      {file && (() => {
        const srcFam = analysis?.flavour ? configFamily(analysis.flavour) : null;
        const keeps = RETARGET_MACHINES.filter((m) => srcFam !== null && configFamily(m.flavour) === srcFam);
        const others = RETARGET_MACHINES.filter((m) => !keeps.includes(m));
        const chosen = targetId !== "u1" ? MACHINES[targetId] : undefined;
        const chosenSame = chosen && srcFam !== null && configFamily(chosen.flavour) === srcFam;
        return (
          <div className="mt-6 rounded-lg border border-line bg-surface-2 p-5">
            <label htmlFor="target-printer" className="text-sm font-semibold text-fg">{t("targetPrinterLabel")}</label>
            <select
              id="target-printer"
              value={targetId}
              onChange={(e) => setTargetId(e.target.value as CleanTarget)}
              className="mt-2 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg"
            >
              <option value="u1">{t("targetU1Default")}</option>
              {keeps.length > 0 && (
                <optgroup label={t("targetKeepGroup")}>
                  {keeps.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </optgroup>
              )}
              {others.length > 0 && (
                <optgroup label={t("targetGenericGroup")}>
                  {others.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </optgroup>
              )}
            </select>
            {chosen && (
              <p className="mt-2 text-xs text-fg-subtle">
                {chosenSame ? t("targetKeepNote", { name: chosen.name }) : t("targetGenericNote", { name: chosen.name })}
              </p>
            )}
            {chosen && (
              <button
                onClick={() => clean(targetId)}
                disabled={status === "working" || meshLoading}
                className="btn-secondary btn-md mt-4"
              >
                {t("convertForPrinter", { name: chosen.name })}
              </button>
            )}
          </div>
        );
      })()}

      {/* ── THE MOMENT THE WHOLE PAGE CONVERGES ON ────────────────────────────────────────────────
          These were four identical 144×218px tiles at the bottom of a 2,991px page. The primary one
          carried a faint lavender tint and nothing else: no fill, no download glyph, no size
          difference from the three escape hatches beside it. `globals.css` already owned a good
          primary button — /calibrate has it, all six SEO landing pages have it, `bg-violet-600`
          appears 15 times in this repository — and the one place the product actually converges on
          was the one place that did not use it.

          `button-primitive-guard.test.mts` could not see this, correctly: it fires on a solid fill
          paired with a brand hover, and these were `bg-violet-400/10` — the *quiet secondary*
          treatment, which is exactly the mistake. The primary action was drawn as a secondary one.

          One primary, three demoted to a labelled row. They are alternatives, not peers. */}
      {file && (
        <div className="mt-6">
          <button
            onClick={() => clean("u1")}
            disabled={status === "working" || meshLoading}
            className="btn-primary btn-lg w-full"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
              <path d="M12 4v12" />
              <path d="m8 12 4 4 4-4" />
              <path d="M4 20h16" />
            </svg>
            {t("cleanU1")}
          </button>
          <p className="mt-2 text-center text-sm text-fg-subtle">
            {profileMode === "preserve" ? t("cleanU1PreserveDesc") : t("cleanU1StampDesc")}
          </p>

          <p className="eyebrow mt-7">{t("otherOutputs")}</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <button onClick={() => clean("generic")} disabled={status === "working"} className="btn-secondary btn-sm flex-col items-start gap-0.5 px-4 py-3 text-start">
              <span className="font-medium text-fg">{t("genericStrip")}</span>
              <span className="text-xs font-normal leading-snug text-fg-subtle">{t("genericStripDesc")}</span>
            </button>
            <button onClick={() => clean("current")} disabled={status === "working"} className="btn-secondary btn-sm flex-col items-start gap-0.5 px-4 py-3 text-start">
              <span className="font-medium text-fg">{t("importCurrent")}</span>
              <span className="text-xs font-normal leading-snug text-fg-subtle">{t("importCurrentDesc")}</span>
            </button>
            <button onClick={toStl} disabled={status === "working"} className="btn-secondary btn-sm flex-col items-start gap-0.5 px-4 py-3 text-start">
              <span className="font-medium text-fg">{t("geometryStl")}</span>
              <span className="text-xs font-normal leading-snug text-fg-subtle">{t("geometryStlDesc")}</span>
            </button>
          </div>
        </div>
      )}

      {mesh && mesh.parts.length > 1 && (
        <details className="mt-4 rounded-lg border border-line bg-surface-2 p-5">
          <summary className="cursor-pointer text-sm font-semibold text-fg">
            {t("splitTitle")}{" "}
            <span className="font-normal text-fg-muted">{t("splitSub")}</span>
          </summary>
          <p className="mt-2 text-xs text-fg-muted">{t("splitDesc")}</p>

          {/* scope */}
          <div className="mt-4">
            <p className="eyebrow">{t("oneFilePer")}</p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {mesh.plates.length > 1 && (
                <button
                  onClick={() => setSplitScope("plate")}
                  className={`rounded-lg border px-3 py-1.5 text-sm transition ${splitScope === "plate" ? "border-violet-400/50 bg-violet-400/15 text-fg" : "border-line bg-surface-2 text-fg-muted hover:bg-surface-3"}`}
                >
                  {t("plate")} ({mesh.plates.length})
                </button>
              )}
              <button
                onClick={() => setSplitScope("part")}
                className={`rounded-lg border px-3 py-1.5 text-sm transition ${splitScope === "part" || mesh.plates.length <= 1 ? "border-violet-400/50 bg-violet-400/15 text-fg" : "border-line bg-surface-2 text-fg-muted hover:bg-surface-3"}`}
              >
                {t("part")} ({new Set(mesh.parts.map((p) => p.objectId)).size})
              </button>
            </div>
            <p className="mt-1.5 text-xs text-fg-subtle">
              {splitScope === "plate" && mesh.plates.length > 1
                ? t("splitScopePlate")
                : t("splitScopePart")}
            </p>
          </div>

          <button
            onClick={splitExport}
            disabled={status === "working" || meshLoading}
            className="btn-secondary btn-md mt-4"
          >
            {t("convertSplit")}
          </button>
        </details>
      )}

      {file && bigFile && status !== "working" && (
        <div className="mt-3 rounded-lg border border-line bg-surface-2 px-5 py-3 text-sm">
          <p className="text-fg-muted">
            {t("bigFileNote")}
          </p>
          <button
            onClick={serverConvert}
            className="btn-secondary btn-sm mt-2"
          >
            {t("convertOnServer")}
          </button>
          <span className="ml-2 text-xs text-fg-subtle">{t("serverOptionalNote")}</span>
        </div>
      )}

      {status === "working" && (
        <div className="mt-4" role="status" aria-live="polite">
          <div className="flex items-center justify-between text-sm text-fg-muted">
            <span>{message}…</span>
            {progress !== null && <span className="tabular-nums text-fg-subtle">{Math.round(progress * 100)}%</span>}
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
            {progress === null ? (
              <div className="br-indeterminate h-full w-1/3 rounded-full bg-violet-400" />
            ) : (
              <div
                className="h-full rounded-full bg-violet-400 transition-[width] duration-300"
                style={{ width: `${Math.max(4, Math.round(progress * 100))}%` }}
              />
            )}
          </div>
        </div>
      )}
      {/* ── THE ORDER OF THE DONE SCREEN, WHICH IS THE POINT OF IT ───────────────────────────────
          It used to run: green bar → library card → email capture → "result look wrong?" → convert
          another → and, last, collapsed and smallest, "what changed for your U1". Three asks in
          front of the one thing that proves the conversion did what it claimed.

          `ContributeToLibrary`'s own header already argued half of this — "three asks at one moment
          is zero asks", and "the moment was already spent: download() fires before this screen
          renders". The half it did not draw is that the screen never mentioned the FILE. No name, no
          size, no second chance at it. A blocked download had no recovery on a page whose entire job
          is to hand somebody a file.

          So: the file, then the proof, then the asks. */}
      {/* ── THE ORDER, RESTATED WHERE IT IS ACTUALLY BUILT ──────────────────────────────────────
          The file, then the proof it is right, then the asks, then the way out. The report used to
          be dead last — below the email capture and below "Convert another file" — which is where a
          screen puts the thing it does not expect anybody to read. It is the artefact that makes the
          conversion checkable, so it sits with the file it describes. */}
      {status === "done" && (
        <div role="status" aria-live="polite" className="notice notice-ok mt-6">
          <NoticeIcon level="ok" />
          <span>{message}</span>
        </div>
      )}
      {status === "done" && result && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface-2 px-5 py-4">
          <div className="min-w-0">
            <p className="eyebrow">{t("yourFile")}</p>
            <p className="mt-1 truncate font-medium text-fg" dir="ltr">{result.name}</p>
            <p className="mt-0.5 text-xs tabular-nums text-fg-subtle">
              {format.number(Math.max(1, Math.round(result.blob.size / 1024)))} KB
            </p>
          </div>
          <button onClick={() => download(result.blob, result.name)} className="btn-secondary btn-md shrink-0">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
              <path d="M12 4v12" />
              <path d="m8 12 4 4 4-4" />
              <path d="M4 20h16" />
            </svg>
            {t("downloadAgain")}
          </button>
        </div>
      )}
      {status === "done" && file && (
        reportSent === "done" ? (
          <p className="mt-3 text-xs text-green-300">{t("reportSentImprove")}</p>
        ) : (
          <p className="mt-3 text-xs text-fg-subtle">
            {t("resultLookWrong")}{" "}
            <button
              onClick={() => sendFailingFile("bad-result")}
              disabled={reportSent === "sending"}
              className="text-violet-300 underline hover:text-violet-200 disabled:opacity-50"
            >
              {reportSent === "sending" ? t("reportSending") : t("sendUsFile")}
            </button>{" "}
            {t("optInFix")}
          </p>
        )
      )}
      {status === "done" && diff && (
        <section className="mt-3 rounded-lg border border-line bg-surface-2 px-5 py-4 text-sm text-fg-muted">
          <h2 className="font-semibold text-fg">{t("whatChanged")}</h2>
          <ul className="mt-3 space-y-1.5 text-fg-muted">
            <li>
              {t("diffPrinterLabel")}{" "}
              {diff.printerFrom ? <>{t("diffSwapped")} <span className="text-fg-muted">{diff.printerFrom}</span> →{" "}</> : t("diffSetTo") + " "}
              <span className="font-medium text-fg">{diff.printerTo}</span>{" "}
              <span className="text-fg-subtle">
                ({diff.mode === "preserve" ? t("diffModePreserve") : t("diffModeStamp")})
              </span>
            </li>
            {diff.towerSafety.length > 0 && <li>{t("diffTower")}</li>}
            {diff.clamped.length > 0 && (
              <li>
                {t("diffClamped", { count: diff.clamped.length })}{" "}
                <span className="text-fg-muted">
                  {diff.clamped.slice(0, 3).map((c) => `${c.key.replace(/_/g, " ")} ${c.from}→${c.to}`).join(", ")}
                  {diff.clamped.length > 3 ? " " + t("diffMore", { count: diff.clamped.length - 3 }) : ""}
                </span>
              </li>
            )}
            {diff.sentinelFixed.length > 0 && <li>{t("diffSentinel", { count: diff.sentinelFixed.length })}</li>}
            {diff.droppedForeignKeys > 0 && <li>{t("diffDropped", { count: diff.droppedForeignKeys })}</li>}
            {diff.vlhGuard && <li>{t("diffVlh")}</li>}
            {diff.bedShift && <li>{t("diffBedShift", { dx: diff.bedShift.dx, dy: diff.bedShift.dy })}</li>}
            {diff.prusaPaint && <li>{t("diffPrusaPaint")}</li>}
            {diff.foreignNative && <li>{t("diffForeignNative")}</li>}
            {diff.fullSpectrumMixes > 0 && <li>{t("diffFullSpectrum", { count: diff.fullSpectrumMixes })}</li>}
            {/* Refitting extrusion widths is a change to what the printer physically lays down, so it
                belongs in the report rather than happening quietly. */}
            {diff.keptAllColours > 0 && <li>{t("diffKeptAll", { count: diff.keptAllColours })}</li>}
            {diff.filamentBrand && <li>{t("diffFilamentBrand", { brand: t(diff.filamentBrand === "snapmaker" ? "brandSnapmaker" : "brandGeneric") })}</li>}
            {diff.nozzleFit.length > 0 && <li>{t("diffNozzleFit", { count: diff.nozzleFit.length })}</li>}
            {diff.untestedProfile && <li>{t("diffUntestedProfile")}</li>}
            {diff.antiClobber && <li>{t("diffAntiClobber")}</li>}
            {removedCount > 0 && <li>{t("diffStripped", { count: removedCount })}</li>}
          </ul>
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-xs text-fg-subtle">{t("diffFooter")}</p>
            <button
              onClick={copySummary}
              className="btn-secondary btn-xs shrink-0"
            >
              {copied ? t("copied") : t("copySummary")}
            </button>
          </div>
        </section>
      )}
      {status === "done" && swapPlan.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/[0.06] px-5 py-4 text-sm text-amber-100">
          <p className="font-semibold">{t("swapPlanTitle", { count: swapPlan.length })}</p>
          <p className="mt-1 text-xs text-amber-200">{t("swapPlanNote")}</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            {swapPlan.map((s, i) => (
              <li key={i} className="text-amber-50">{s.label}</li>
            ))}
          </ol>
        </div>
      )}
      {status === "done" && <ContributeToLibrary />}
      {status === "done" && <ShareBedReady />}
      {status === "done" && <ConvertCapture />}
      {status === "done" && (
        <button
          onClick={resetAll}
          className="btn-secondary btn-md mt-3"
        >
          {t("convertAnother")}
        </button>
      )}
      {warn && (
        <p className="notice notice-warn mt-3"><NoticeIcon level="warn" />{warn}</p>
      )}
      {status === "error" && analysis && (
        <div className="mt-4">
          <p className="text-sm text-red-300">{message}</p>
          {file && (
            <button
              onClick={serverConvert}
              className="btn-secondary btn-sm mt-3"
            >
              {t("tryServerInstead")}
            </button>
          )}
          <p className="mt-2 text-xs text-fg-subtle">
            {t("serverFallbackNote")}
          </p>
          {file && (
            <div className="mt-3">
              {reportSent === "done" ? (
                <p className="text-xs text-green-300">{t("reportSentFix")}</p>
              ) : (
                <>
                  <button
                    onClick={() => sendFailingFile("convert-error")}
                    disabled={reportSent === "sending"}
                    className="btn-secondary btn-sm"
                  >
                    {reportSent === "sending" ? t("reportSendingCap") : t("sendUsFileFix")}
                  </button>
                  <p className="mt-1 text-xs text-fg-subtle">
                    {t("sendFileDebugNote")}
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </main>
  );
}
