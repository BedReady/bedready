"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import dynamic from "next/dynamic";
import { quantize, buildPanelMesh, buildImage3MF, type Quantized, type PanelMesh } from "@/lib/image-model";
import { cleanThreeMFAsync } from "@/lib/convert-client";
import { download } from "@/lib/convert";
import type { MeshData } from "@/lib/paint";
import NoticeIcon from "@/components/NoticeIcon";

// three.js only loads once a preview mesh exists (matches the converter's on-demand PaintPreview).
const PaintPreview = dynamic(() => import("@/components/PaintPreview"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[380px] w-full items-center justify-center rounded-lg border border-line bg-surface-2 text-sm text-fg-subtle">
      Loading 3D preview…
    </div>
  ),
});

// Wrap a generated panel mesh as the MeshData shape PaintPreview consumes (it only reads positions +
// faceState + colorForState). base faces (state 0) count toward the base slot in usage.
function panelToMeshData(panel: PanelMesh, baseState = 1): MeshData {
  const usage: number[] = new Array(panel.palette.length).fill(0);
  const present = new Set<number>();
  for (const s of panel.faceState) {
    const idx = (s === 0 ? baseState : s) - 1;
    if (idx >= 0 && idx < usage.length) usage[idx]++;
    if (s > 0) present.add(s);
  }
  const triangleCount = panel.positions.length / 9;
  return {
    positions: panel.positions,
    faceState: panel.faceState,
    palette: panel.palette,
    usage,
    statesPresent: [...present].sort((a, b) => a - b),
    baseState,
    triangleCount,
    skipped: false,
    sampled: false,
    parts: [{ name: "image", objectId: 1, positions: panel.positions, faceState: panel.faceState, triangleCount }],
    plates: [],
  };
}

// Image → U1 color print (flat-panel beta). Turn a photo/logo/artwork into a flat multicolor plate the
// Snapmaker U1 can print: quantize to ≤4 colors, paint the top surface per color, and hand it to the same
// converter engine the rest of the site uses (nothing is uploaded — it all runs in your browser).

type Status = "idle" | "ready" | "working" | "done" | "error";

// Draw an image file onto a canvas downsampled so the LONGEST side is `grid` px, and read its RGBA.
async function pixelsFromFile(file: File, grid: number): Promise<{ px: Uint8ClampedArray; w: number; h: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("image-decode-failed")); // internal; the UI shows t("errRead")
      el.src = url;
    });
    const scale = grid / Math.max(img.naturalWidth, img.naturalHeight);
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, w, h);
    return { px: ctx.getImageData(0, 0, w, h).data, w, h };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function ImagePage() {
  const t = useTranslations("image");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [fileName, setFileName] = useState("");
  const [q, setQ] = useState<Quantized | null>(null);
  const [preview, setPreview] = useState<MeshData | null>(null);
  const [colors, setColors] = useState(4);
  const [sizeMM, setSizeMM] = useState(100);
  const [thickness, setThickness] = useState(2.4);
  const detail = 140; // grid px on the longest side (fixed for the MVP — keeps triangle count sane)
  const [dither, setDither] = useState(true); // error-diffusion — much better on photos
  const [relief, setRelief] = useState(false); // raise the top by brightness → a 3D relief
  const [reliefDepth, setReliefDepth] = useState(2); // mm of relief above the base
  const [dragOver, setDragOver] = useState(false);
  // HueForge relief is a different technique from the flat panel above, not a variant of it: the
  // surface HEIGHT varies per pixel and the filaments swap at global Z heights, so colour comes from
  // light transmitted through the stack. That's what gets photographic gradients out of four spools.
  const [hueforge, setHueforge] = useState(false);
  // Includes the filaments, because relief mode picks its OWN — they are not the palette shown in
  // "Colors used", which comes from the flat-panel quantiser. Downloading a file containing four
  // colours the page never displayed is a good way to lose someone's trust in the output.
  const [hfQuality, setHfQuality] = useState<
    { deltaE: number; colors: number; automatic: boolean; filaments: string[] } | null
  >(null);
  const rawPixels = useRef<{ px: Uint8ClampedArray; w: number; h: number } | null>(null);
  const lumaRef = useRef<Float32Array | null>(null); // per-cell brightness 0..1 for relief height
  const previewCanvas = useRef<HTMLCanvasElement | null>(null);

  // Re-quantize the currently-loaded image at the current settings and paint the 2D preview.
  const requantize = useCallback((k: number, d: boolean) => {
    const raw = rawPixels.current;
    if (!raw) return;
    const quant = quantize(raw.px, raw.w, raw.h, k, { dither: d });
    setQ(quant);
    const cv = previewCanvas.current;
    if (cv) {
      const scale = Math.max(1, Math.floor(360 / Math.max(quant.width, quant.height)));
      cv.width = quant.width * scale;
      cv.height = quant.height * scale;
      const ctx = cv.getContext("2d")!;
      for (let y = 0; y < quant.height; y++) {
        for (let x = 0; x < quant.width; x++) {
          ctx.fillStyle = quant.palette[quant.indices[y * quant.width + x]] ?? "#000000";
          ctx.fillRect(x * scale, y * scale, scale, scale);
        }
      }
    }
  }, []);

  const onFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    if (!/^image\//.test(file.type)) { setStatus("error"); setMessage(t("errNotImage")); return; }
    setStatus("working"); setMessage(t("reading")); setFileName(file.name);
    try {
      const raw = await pixelsFromFile(file, detail);
      rawPixels.current = raw;
      // Per-cell brightness (Rec.709 luma) for the optional relief height map.
      const luma = new Float32Array(raw.w * raw.h);
      for (let i = 0; i < luma.length; i++) luma[i] = (0.2126 * raw.px[i * 4] + 0.7152 * raw.px[i * 4 + 1] + 0.0722 * raw.px[i * 4 + 2]) / 255;
      lumaRef.current = luma;
      requantize(colors, dither);
      setStatus("ready"); setMessage("");
    } catch {
      // The decoder's own message ("image-decode-failed") is internal — always show the translated one.
      setStatus("error"); setMessage(t("errRead"));
    }
  }, [detail, colors, dither, requantize, t]);

  function setColorsAndPreview(k: number) { setColors(k); requantize(k, dither); }
  function setDitherAndPreview(d: boolean) { setDither(d); requantize(colors, d); }

  // Build the 3D preview mesh when the colors or relief change (a fixed preview size keeps three.js from
  // rebuilding on every size/thickness tweak — those don't change how it looks, only the output scale).
  useEffect(() => {
    if (!q) { setPreview(null); return; }
    const panel = buildPanelMesh(q, {
      widthMM: 80,
      thicknessMM: 2.4,
      ...(relief && lumaRef.current ? { reliefMM: reliefDepth, luma: lumaRef.current } : {}),
    });
    setPreview(panelToMeshData(panel));
  }, [q, relief, reliefDepth]);

  const colorForState = useCallback((s: number) => {
    const pal = q?.palette ?? [];
    return pal[(s === 0 ? 1 : s) - 1] ?? pal[0] ?? "#cccccc";
  }, [q]);
  const colorKey = (q?.palette.join(",") ?? "") + (relief ? `-r${reliefDepth}` : "");

  /** Photo -> relief -> Orca-ready U1 3MF. Uses the full-resolution pixels, not the quantised map. */
  async function makeHueForge() {
    const px = rawPixels.current;
    if (!px) return;
    setStatus("working");
    setMessage(t("hfBuilding"));
    setHfQuality(null);
    try {
      const base = fileName.replace(/\.[^.]+$/, "") || "image";
      // Loaded on demand: the relief engine plus the 572-key U1 settings template are dead weight
      // for everyone who only wants the flat panel.
      const { imageToHueForgeU1 } = await import("@/lib/hueforge-pipeline");
      const r = imageToHueForgeU1({ data: px.px, width: px.w, height: px.h }, {
        maxColors: colors,
        widthMm: sizeMM,
        smooth: 1, // one despeckle round: raw solves sprout 1-pixel towers on busy photos
        name: base,
      });
      if (!r) { setStatus("error"); setMessage(t("hfFailed")); return; }
      setHfQuality({
        deltaE: r.meanDeltaE,
        colors: r.plan.colorCount,
        automatic: r.plan.automatic,
        filaments: r.filaments.map((f) => f.hex),
      });
      download(new Blob([r.bytes as BlobPart], { type: "model/3mf" }), `${base}.hueforge.u1.3mf`);
      setStatus("done");
      setMessage(t("hfDone"));
    } catch (e) {
      console.error("[hueforge]", e);
      setStatus("error");
      setMessage(t("hfFailed"));
    }
  }

  async function makeAndDownload(u1: boolean) {
    if (!q) return;
    setStatus("working");
    setMessage(u1 ? t("buildingU1") : t("buildingPainted"));
    try {
      const mesh = buildPanelMesh(q, {
        widthMM: sizeMM,
        thicknessMM: thickness,
        ...(relief && lumaRef.current ? { reliefMM: reliefDepth, luma: lumaRef.current } : {}),
      });
      const bytes = buildImage3MF(mesh, fileName.replace(/\.[^.]+$/, "") || "image");
      const base = (fileName.replace(/\.[^.]+$/, "") || "image");
      if (!u1) {
        download(new Blob([bytes as BlobPart], { type: "model/3mf" }), `${base}.painted.3mf`);
        setStatus("done"); setMessage("Downloaded a painted .3mf — opens in any slicer with the colors intact.");
        return;
      }
      // Hand the painted panel to the same engine the converter uses → stamp the tested U1 profile.
      const inFile = new File([bytes as BlobPart], `${base}.3mf`, { type: "model/3mf" });
      const res = await cleanThreeMFAsync(inFile, "u1", { mode: "stamp" });
      download(res.blob, `${base}.u1.3mf`);
      setStatus("done"); setMessage(t("doneU1"));
    } catch (e) {
      console.error(e);
      setStatus("error");
      setMessage(t("errBuild"));
    }
  }

  return (
    <main className="shell py-10">
      <h1 className="text-3xl font-semibold tracking-tight text-fg">
        {t("heading")} <span className="ml-2 rounded bg-violet-400/15 px-1.5 py-0.5 align-middle text-xs font-semibold uppercase tracking-wide text-violet-300">{t("beta")}</span>
      </h1>
      <p className="mt-2 max-w-2xl text-fg-muted">
        {t("intro", { colors })}
      </p>

      {/* Dropzone */}
      <label
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); onFile(e.dataTransfer.files?.[0]); }}
        className={`mt-6 flex cursor-pointer flex-col items-center gap-3 rounded-lg border-2 border-dashed p-10 text-center transition ${dragOver ? "border-violet-400 bg-violet-400/10" : "border-line hover:border-violet-400/50 hover:bg-surface-2"}`}
      >
        <input type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
        <span className={`flex h-14 w-14 items-center justify-center rounded-full transition ${dragOver || fileName ? "brand-gradient text-white" : "bg-surface-3 text-fg-muted"}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6" aria-hidden="true">
            <path d="M12 16V4" />
            <path d="M8 8l4-4 4 4" />
            <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
          </svg>
        </span>
        <span className="font-medium text-fg">{fileName || t("dropzone")}</span>
        <span className="text-sm text-fg-subtle">{t("dropzoneHint")}</span>
      </label>

      {message && (
        <p className={`notice mt-4 ${status === "error" ? "notice-warn" : status === "done" ? "notice-ok" : "notice-info"}`}>
          <NoticeIcon level={status === "error" ? "warn" : status === "done" ? "ok" : "info"} />
          <span>{message}</span>
        </p>
      )}

      {q && (
        <>
          {/* Preview + palette */}
          <div className="mt-6 grid gap-5 sm:grid-cols-[1fr_auto]">
            <div className="rounded-lg border border-line bg-surface-2 p-3">
              <canvas ref={previewCanvas} className="mx-auto max-h-[360px] w-auto rounded-lg [image-rendering:pixelated]" />
            </div>
            {/* This palette is the FLAT quantiser's, and it is computed the moment an image loads —
                relief mode never uses it. Turning relief on used to leave four unrelated swatches
                sitting under a bare "Colors used" heading, above a relief file containing four
                different ones. Not hidden, because the flat downloads stay available in relief mode:
                scoped instead, so each palette says which file it belongs to. */}
            {/* data-testid: the e2e suite compares these swatches against the bytes of the file the
                buttons actually produce — see e2e/image-downloads.spec.ts. */}
            <div className="flex flex-col gap-2" data-testid="flat-palette">
              <p className="text-xs font-medium text-fg-muted">{hueforge ? t("colorsUsedFlat") : t("colorsUsed")}</p>
              {q.palette.map((hex, i) => (
                <span key={i} className="inline-flex items-center gap-2 text-xs text-fg-muted">
                  <span className="h-5 w-5 rounded border border-line" style={{ background: hex }} /> {hex}{i === 0 ? " · " + t("base") : ""}
                </span>
              ))}
              {hueforge && <p className="mt-1 max-w-[16rem] text-xs text-fg-subtle">{t("hfFlatNote")}</p>}
            </div>
          </div>

          {/* 3D preview — shows the actual plate, including relief height. */}
          {preview && (
            <div className="mt-5">
              {/* Same scoping as the palette: this mesh is the flat plate. A HueForge relief has its
                  own geometry, which we do not render — so say what is on screen rather than let it
                  be read as a preview of the file the relief button produces. */}
              <p className="mb-1.5 text-xs font-medium text-fg-muted">
                {hueforge ? t("preview3dFlat") : relief ? t("preview3dRelief") : t("preview3d")}
              </p>
              <PaintPreview mesh={preview} colorForState={colorForState} colorKey={colorKey} />
            </div>
          )}

          {/* Controls */}
          <div className="mt-5 grid gap-4 rounded-lg border border-line bg-surface-2 p-4 sm:grid-cols-3">
            <label className="text-xs text-fg-muted">
              {t("labelColors")}
              <select value={colors} onChange={(e) => setColorsAndPreview(Number(e.target.value))} className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg">
                {[2, 3, 4].map((k) => <option key={k} value={k} className="bg-surface">{t("nColors", { count: k })}</option>)}
              </select>
            </label>
            <label className="text-xs text-fg-muted">
              {t("labelSize")}
              <input type="number" min={20} max={250} value={sizeMM} onChange={(e) => setSizeMM(Math.max(20, Math.min(250, Number(e.target.value) || 100)))} className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg" />
            </label>
            <label className="text-xs text-fg-muted">
              {t("labelThickness")}
              <input type="number" min={1} max={10} step={0.2} value={thickness} onChange={(e) => setThickness(Math.max(1, Math.min(10, Number(e.target.value) || 2.4)))} className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg" />
            </label>
            <label className="flex items-center gap-2 text-xs text-fg-muted sm:col-span-3">
              <input type="checkbox" checked={dither} onChange={(e) => setDitherAndPreview(e.target.checked)} className="h-4 w-4 rounded border-line" />
              {t("labelDither")}
            </label>
            <label className="flex items-center gap-2 text-xs text-fg-muted sm:col-span-3">
              <input type="checkbox" checked={relief} onChange={(e) => setRelief(e.target.checked)} className="h-4 w-4 rounded border-line" />
              {t("labelRelief")}
            </label>
            {relief && (
              <label className="text-xs text-fg-muted sm:col-span-3">
                {t("labelReliefDepth", { value: reliefDepth.toFixed(1) })}
                <input type="range" min={0.4} max={6} step={0.2} value={reliefDepth} onChange={(e) => setReliefDepth(Number(e.target.value))} className="mt-1 w-full accent-violet-500" />
              </label>
            )}
          </div>

          {/* Actions */}
          {/* Relief is its own output, so it gets its own control rather than changing what the
              existing buttons do. */}
          <label className="mt-5 flex items-start gap-2 rounded-lg border border-violet-400/25 bg-violet-400/[0.06] p-4 text-sm text-fg-muted">
            <input
              type="checkbox"
              checked={hueforge}
              onChange={(e) => { setHueforge(e.target.checked); setHfQuality(null); }}
              className="mt-0.5 h-4 w-4 rounded border-line accent-violet-500"
            />
            <span>
              <span className="font-medium text-fg">{t("hfLabel")}</span>
              <span className="ml-1 rounded bg-amber-400/15 px-1.5 py-0.5 text-xs text-amber-200">{t("hfExperimental")}</span>
              <span className="mt-1 block text-xs text-fg-subtle">{t("hfDesc")}</span>
            </span>
          </label>

          {hfQuality && (
            <div className="mt-3 rounded-lg border border-line bg-surface-2 px-4 py-3 text-xs text-fg-muted">
              <p>
                {t("hfQuality", { deltaE: hfQuality.deltaE.toFixed(1), colors: hfQuality.colors })}{" "}
                {hfQuality.automatic ? t("hfAutomatic") : t("hfReload")}
              </p>
              {/* The filaments actually IN the file — bottom of the stack first, which is the order
                  they have to be loaded in for the transmission maths to hold. */}
              <p className="mt-2 flex flex-wrap items-center gap-2" data-testid="relief-filaments">
                <span>{t("hfFilaments")}</span>
                {hfQuality.filaments.map((hex, i) => (
                  <span key={hex + i} className="inline-flex items-center gap-1">
                    <span className="h-4 w-4 rounded border border-line" style={{ background: hex }} aria-hidden />
                    <span className="tabular-nums">{hex}</span>
                  </span>
                ))}
              </p>
              {/* Above ~10 a colour difference is plainly visible, so say so rather than printing a
                  number whose scale nobody knows. */}
              {hfQuality.deltaE > 10 && <p className="mt-2 text-amber-300">{t("hfLooseMatch")}</p>}
            </div>
          )}

          <div className="mt-5 flex flex-wrap gap-3">
            {hueforge && (
              <button
                onClick={makeHueForge}
                disabled={status === "working"}
                className="btn-primary btn-lg"
              >
                {status === "working" ? t("building") : t("hfDownload")}
              </button>
            )}
            <button
              onClick={() => makeAndDownload(true)}
              disabled={status === "working"}
              className="btn-primary btn-lg"
            >
              {status === "working" ? t("building") : t("downloadU1")}
            </button>
            <button
              onClick={() => makeAndDownload(false)}
              disabled={status === "working"}
              className="rounded-lg border border-line bg-surface-2 px-5 py-3 text-sm font-medium text-fg transition hover:bg-surface-3 disabled:opacity-60"
            >
              {t("downloadPainted")}
            </button>
          </div>

          <p className="mt-4 text-xs text-fg-subtle">
            {t("betaNote")}
          </p>
        </>
      )}
    </main>
  );
}
