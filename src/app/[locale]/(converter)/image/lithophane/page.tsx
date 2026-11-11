"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import PlateHeads from "@/components/PlateHeads";
import NoticeIcon from "@/components/NoticeIcon";
import { download } from "@/lib/convert";
import { DEFAULT_CMYW, LITHO_DEFAULTS, type LithoOptions } from "@/lib/lithophane";
import type { LithoFrameKind } from "@/lib/lithophane-frame";
import { createLithoClient, type LithoClient, type LithoPreview } from "@/lib/lithophane-client";
import {
  coverCrop, panCrop, nudgeCrop, estimateHours, clampSizeMm, LITHO_SIZE_MM, type CropCentre as CropCenter,
} from "@/lib/lithophane-crop";

// Colour lithophane (Figma jVaEwz4pUB5vTXwh5vxXev, page "Lithophane"). The converter's tool split:
// settings in one column, the predicted print beside it, sticky. The planning and the 3MF both run in
// a Web Worker (lithophane-client.ts): a full-size plan is seconds of solver work.

/** The photo is read at most this many pixels on its longest side: several times the finest print
 *  grid the core allows (maxCells), so a crop never runs out of source pixels. */
const SOURCE_PX = 1600;
/** Settle time after an edit before re-planning. The plan is slow; a drag commits on release. */
const REPLAN_MS = 350;

type Status = "idle" | "loading" | "ready" | "building" | "error";
type Mode = "color" | "classic"; // the core spells it "colour" (LithoMode)
type FrameChoice = "none" | Exclude<LithoFrameKind, "none">;

async function pixelsFromFile(file: File, maxSide: number): Promise<{ px: Uint8ClampedArray; w: number; h: number }> {
  const bmp = await createImageBitmap(file);
  try {
    const s = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * s));
    const h = Math.max(1, Math.round(bmp.height * s));
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(bmp, 0, 0, w, h);
    return { px: ctx.getImageData(0, 0, w, h).data, w, h };
  } finally {
    bmp.close();
  }
}

/** A row of mutually exclusive buttons, styled as the converter's (convert/page.tsx, nozzle row). */
function Segmented<T extends string | number>({
  label, options, value, onChange, hideLabel = false,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  hideLabel?: boolean;
}) {
  const id = useId();
  return (
    <div>
      <p id={id} className={hideLabel ? "sr-only" : "text-sm font-medium text-fg"}>{label}</p>
      <div role="group" aria-labelledby={id} className="mt-2 inline-flex flex-wrap rounded-lg border border-line bg-surface p-1 text-sm">
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={value === o.value}
            onClick={() => onChange(o.value)}
            className={`rounded-lg px-3 py-1.5 ${value === o.value ? "bg-violet-600 text-on-accent" : "text-fg-muted hover:text-fg"}`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A number in mm, label inside the box (Figma: "Width  100 mm"). Commits a clamped value on blur or
 *  Enter, and while typing whenever the text is already a value in range. */
function MmField({
  label, unit, value, min, max, step, decimals = 0, onCommit,
}: {
  label: string; unit: string; value: number; min: number; max: number; step: number; decimals?: number; onCommit: (v: number) => void;
}) {
  const show = (v: number) => (decimals ? v.toFixed(decimals) : String(v));
  const [text, setText] = useState(show(value));
  // Follow the value when it changes from outside (or is clamped), never mid-typing: "1.25" must
  // not be rewritten to "1.3" while the visitor is still on the field.
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    if (Number(text) !== value) setText(show(value));
  }
  const commit = () => {
    const n = Number(text);
    const v = Number.isFinite(n) && text.trim() !== "" ? Math.min(max, Math.max(min, n)) : value;
    setText(show(v));
    if (v !== value) onCommit(v);
  };
  return (
    <label className="flex min-w-0 items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg-muted focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--accent)]">
      <span className="shrink-0">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value.trim() !== "" && Number.isFinite(n) && n >= min && n <= max) onCommit(n);
        }}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); }}
        className="w-full min-w-[4ch] bg-transparent text-fg tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <span className="shrink-0" aria-hidden="true">{unit}</span>
    </label>
  );
}

export default function LithophanePage() {
  const t = useTranslations("lithophane");
  const format = useFormatter();
  const hintId = useId();

  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [fileName, setFileName] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [photo, setPhoto] = useState<{ w: number; h: number; key: number } | null>(null);

  const [mode, setMode] = useState<Mode>("color");
  const [widthMm, setWidthMm] = useState<number>(LITHO_DEFAULTS.widthMm);
  const [heightMm, setHeightMm] = useState<number>(LITHO_DEFAULTS.heightMm);
  const [minMm, setMinMm] = useState<number>(LITHO_DEFAULTS.minMm);
  const [maxMm, setMaxMm] = useState<number>(LITHO_DEFAULTS.maxMm);
  const [frame, setFrame] = useState<FrameChoice>("none");
  const [colourCellMm, setColourCellMm] = useState<0.4 | 0.8>(0.4);
  const [whiteFrontMm, setWhiteFrontMm] = useState<0 | 0.2>(0);
  const [center, setCenter] = useState<CropCenter>({ cx: 0.5, cy: 0.5 });

  const [preview, setPreview] = useState<LithoPreview | null>(null);
  const [planning, setPlanning] = useState(false);
  const [lightOn, setLightOn] = useState(true);
  // Screen-pixel shift of the shown preview while (and just after) the photo is dragged: the plan
  // only re-runs on release, so the old picture follows the pointer until the new one arrives.
  const [shift, setShift] = useState<{ x: number; y: number } | null>(null);

  const client = useRef<LithoClient | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const drag = useRef<{ id: number; x: number; y: number; start: CropCenter } | null>(null);

  useEffect(() => () => { client.current?.dispose(); client.current = null; }, []);

  const aspect = widthMm / heightMm;

  const opts: LithoOptions | null = useMemo(() => {
    if (!photo) return null;
    const crop = coverCrop(photo.w, photo.h, aspect, center);
    return {
      mode: mode === "classic" ? "classic" : undefined, // undefined = the core's default, colour
      widthMm,
      heightMm,
      crop: { x: Math.round(crop.x * 100) / 100, y: Math.round(crop.y * 100) / 100, w: Math.round(crop.w * 100) / 100, h: Math.round(crop.h * 100) / 100 },
      minMm,
      maxMm,
      filaments: DEFAULT_CMYW,
      colourCellMm,
      whiteFrontMm,
    };
  }, [photo, aspect, center, mode, widthMm, heightMm, minMm, maxMm, colourCellMm, whiteFrontMm]);

  // Re-plan once the settings have been still for a moment. `photo.key` is in `opts` through the
  // crop, and a new photo resets the center, so a new file always plans.
  useEffect(() => {
    const c = client.current;
    if (!opts || !c) return;
    let live = true;
    const timer = setTimeout(() => {
      setPlanning(true);
      c.plan(opts).then(
        (p) => {
          if (!live || !p) return; // superseded: a newer plan is on its way
          setPreview(p);
          setShift(null);
          setPlanning(false);
        },
        (e) => {
          if (!live) return;
          console.error("[lithophane]", e);
          setPlanning(false);
          setStatus("error");
          setError(t("error"));
        },
      );
    }, REPLAN_MS);
    return () => { live = false; clearTimeout(timer); };
  }, [opts, t]);

  // Paint the preview. The canvas is the plan's own grid (one pixel per cell) and CSS scales it.
  useEffect(() => {
    const cv = canvas.current;
    if (!cv || !preview) return;
    cv.width = preview.gw;
    cv.height = preview.gh;
    const px = lightOn ? preview.backlit : preview.frontlit;
    cv.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(px), preview.gw, preview.gh), 0, 0);
  }, [preview, lightOn]);

  const onFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    if (!/^image\//.test(file.type)) { setStatus("error"); setError(t("error")); return; }
    setStatus("loading"); setError(""); setFileName(file.name);
    try {
      const { px, w, h } = await pixelsFromFile(file, SOURCE_PX);
      if (!client.current) client.current = createLithoClient();
      await client.current.setImage(px, w, h);
      setPreview(null);
      setShift(null);
      setCenter({ cx: 0.5, cy: 0.5 });
      setPhoto((p) => ({ w, h, key: (p?.key ?? 0) + 1 }));
      setStatus("ready");
    } catch (e) {
      console.error("[lithophane]", e);
      setStatus("error");
      setError(t("error"));
    }
  }, [t]);

  async function onDownload() {
    const c = client.current;
    if (!opts || !c) return;
    setStatus("building"); setError("");
    try {
      const base = fileName.replace(/\.[^.]+$/, "") || "lithophane";
      const { preview: p, bytes } = await c.exportFile(opts, base, frame === "none" ? undefined : { kind: frame });
      setPreview(p);
      download(new Blob([bytes as BlobPart], { type: "model/3mf" }), `${base}.lithophane.u1.3mf`);
      setStatus("ready");
    } catch (e) {
      console.error("[lithophane]", e);
      setStatus("error");
      setError(t("error"));
    }
  }

  // ── Crop by dragging the preview (Pointer Events + capture) or with the arrow keys ──────────────
  function viewWidth() {
    return canvas.current?.getBoundingClientRect().width ?? 0;
  }
  /** The screen shift the window really moved by: clamped at the photo's edges, so the picture
   *  stops where the crop stops instead of sliding past it. */
  function shiftFor(from: CropCenter, to: CropCenter) {
    if (!photo) return { x: 0, y: 0 };
    const a = coverCrop(photo.w, photo.h, aspect, from), b = coverCrop(photo.w, photo.h, aspect, to);
    const s = viewWidth() / a.w;
    return { x: -(b.x - a.x) * s, y: -(b.y - a.y) * s };
  }
  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!photo || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, start: center };
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || !photo || d.id !== e.pointerId) return;
    const to = panCrop(photo.w, photo.h, aspect, d.start, e.clientX - d.x, e.clientY - d.y, viewWidth());
    setShift(shiftFor(d.start, to));
  }
  function endDrag(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || !photo || d.id !== e.pointerId) return;
    drag.current = null;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) { setShift(null); return; }
    setCenter(panCrop(photo.w, photo.h, aspect, d.start, dx, dy, viewWidth()));
  }
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!photo) return;
    const to = nudgeCrop(photo.w, photo.h, aspect, center, e.key);
    if (!to) return;
    e.preventDefault();
    setCenter(to);
  }

  const mm = (v: number) => t("mm", { value: format.number(v) });
  const unit = t("mm", { value: "" }).trim();
  const busy = status === "loading" || status === "building";

  return (
    <main className={`page-read py-10${photo ? " tool-split" : ""}`}>
      <h1 className="text-2xl font-bold text-fg">{t("title")}</h1>
      <p className="mt-1 text-sm text-fg-muted">{t("subtitle")}</p>

      {/* The plate: T1–T4 in the loaded colours, and the drop zone until (and after) a photo is in. */}
      <label
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); onFile(e.dataTransfer.files?.[0]); }}
        data-over={dragOver || undefined}
        data-classic={mode === "classic" || undefined}
        style={Object.fromEntries(DEFAULT_CMYW.map((f, i) => [`--slot-${i + 1}`, f.hex]))}
        className="plate mt-6 flex cursor-pointer flex-col items-center gap-5 px-6 pb-8 pt-6 text-center focus-within:outline focus-within:outline-3 focus-within:outline-offset-3 focus-within:outline-[var(--slot-3)] data-[classic]:[&_.plate-head:nth-child(-n+3)]:opacity-30"
      >
        <input type="file" accept="image/*" className="sr-only" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
        <PlateHeads />
        <span className="sr-only">
          {t("filaments")}: T1 {t("slotCyan")}, T2 {t("slotMagenta")}, T3 {t("slotYellow")}, T4 {t("slotWhite")}
        </span>
        <span className="text-xl font-semibold text-[#eeece6]" style={{ fontStretch: "112%" }}>{fileName || t("dropPhoto")}</span>
        <span className="-mt-3 text-sm text-[#d2cec5]">
          {fileName ? t("plateHint", { w: format.number(widthMm), h: format.number(heightMm) }) : t("dropPhotoOr")}
        </span>
      </label>

      {/* The preview comes straight after the plate in the source, so on a phone it sits under it;
          from 80rem `.tool-aside` lifts it into the second column (globals.css, "The tool split"). */}
      {photo && (
        <section className="tool-aside mt-6 rounded-lg border border-line bg-surface-2 p-5" aria-busy={planning || undefined}>
          <h2 className="text-sm font-semibold text-fg">{t("preview")}</h2>
          <p className="mt-1 text-xs text-fg-muted">{t("previewHint")}</p>
          <div
            tabIndex={0}
            role="img"
            aria-label={t("preview")}
            aria-describedby={hintId}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={onKeyDown}
            className="relative mt-4 cursor-grab touch-none select-none overflow-hidden rounded-lg bg-surface-3 active:cursor-grabbing focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            style={{ aspectRatio: `${widthMm} / ${heightMm}` }}
          >
            <canvas
              ref={canvas}
              data-testid="litho-preview"
              data-ready={preview ? "true" : undefined}
              className={`block h-full w-full transition-opacity ${planning && !shift ? "opacity-60" : ""}`}
              style={shift ? { transform: `translate(${shift.x}px, ${shift.y}px)` } : undefined}
            />
            {!preview && (
              <span className="absolute inset-0 flex items-center justify-center text-sm text-fg-subtle">{t("building")}</span>
            )}
          </div>
          <div className="mt-4">
            <Segmented
              label={t("preview")}
              hideLabel
              options={[{ value: "on", label: t("lightOn") }, { value: "off", label: t("lightOff") }]}
              value={lightOn ? "on" : "off"}
              onChange={(v) => setLightOn(v === "on")}
            />
          </div>
          <p className="mt-3 text-xs text-fg-muted">{t("estimate", { hours: format.number(estimateHours(widthMm, heightMm)) })}</p>
        </section>
      )}

      {/* Size */}
      <section className="mt-4 rounded-lg border border-line bg-surface-2 p-4">
        <h2 className="text-sm font-medium text-fg">{t("size")}</h2>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <MmField label={t("width")} unit={unit} value={widthMm} min={LITHO_SIZE_MM.min} max={LITHO_SIZE_MM.max} step={1} onCommit={(v) => setWidthMm(clampSizeMm(v, LITHO_DEFAULTS.widthMm))} />
          <MmField label={t("height")} unit={unit} value={heightMm} min={LITHO_SIZE_MM.min} max={LITHO_SIZE_MM.max} step={1} onCommit={(v) => setHeightMm(clampSizeMm(v, LITHO_DEFAULTS.heightMm))} />
        </div>
        <p id={hintId} className="mt-2 text-xs text-fg-subtle">{t("cropHint")}</p>
      </section>

      {/* Style, thickness, frame */}
      <section className="mt-4 space-y-4 rounded-lg border border-line bg-surface-2 p-4">
        <div>
          <Segmented
            label={t("style")}
            options={[{ value: "color", label: t("styleColour") }, { value: "classic", label: t("styleClassic") }]}
            value={mode}
            onChange={setMode}
          />
          <p className="mt-2 text-xs text-fg-subtle">{t("styleNote")}</p>
        </div>
        <div>
          <h3 className="text-sm font-medium text-fg">{t("thickness")}</h3>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <MmField label={t("thinnest")} unit={unit} value={minMm} min={0.4} max={5} step={0.1} decimals={1} onCommit={setMinMm} />
            <MmField label={t("thickest")} unit={unit} value={maxMm} min={0.8} max={10} step={0.1} decimals={1} onCommit={setMaxMm} />
          </div>
        </div>
        <Segmented
          label={t("frame")}
          options={[
            { value: "none", label: t("frameNone") },
            { value: "stand", label: t("frameStand") },
            { value: "hanger", label: t("frameHanger") },
          ]}
          value={frame}
          onChange={setFrame}
        />
      </section>

      {/* Defaults, and the two test-print options */}
      <section className="mt-4 space-y-4 rounded-lg border border-line bg-surface-2 p-4">
        <p className="text-sm text-fg-muted">{t("defaults")}</p>
        <div>
          <h3 className="text-sm font-medium text-fg">{t("testOptions")}</h3>
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-3">
            <Segmented
              label={t("colourGrid")}
              options={[{ value: 0.4, label: mm(0.4) }, { value: 0.8, label: mm(0.8) }]}
              value={colourCellMm}
              onChange={(v) => setColourCellMm(v as 0.4 | 0.8)}
            />
            <Segmented
              label={t("whiteFront")}
              options={[{ value: 0, label: t("whiteFrontOff") }, { value: 0.2, label: t("whiteFrontOn") }]}
              value={whiteFrontMm}
              onChange={(v) => setWhiteFrontMm(v as 0 | 0.2)}
            />
          </div>
        </div>
      </section>

      {error && (
        <p className="notice notice-warn mt-4" role="alert">
          <NoticeIcon level="warn" />
          <span>{error}</span>
        </p>
      )}

      <button
        type="button"
        onClick={onDownload}
        disabled={!photo || busy}
        className="btn-primary btn-lg mt-4 w-full justify-center"
      >
        {status === "building" ? t("building") : t("download")}
      </button>
    </main>
  );
}
