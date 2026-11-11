// The lithophane page's crop window and time estimate. Pure: no DOM, no React — the page and its
// tests both call these, so the arithmetic behind a drag on the preview is checked without a browser.
//
// THE CROP. planLithophane stretches whatever source rectangle it is given to the printed
// width × height, so the rectangle must already have the print's aspect or the photo comes out
// squashed. The window is therefore stored as a CENTRE in the photo (0..1 on each axis) and the
// rectangle is derived: the largest one of the print's aspect that fits inside the photo ("cover"),
// placed at that centre and pushed back inside the photo where it would overhang. A centre survives
// a change of width or height; a stored rectangle would not.

export type CropRect = { x: number; y: number; w: number; h: number };
export type CropCentre = { cx: number; cy: number };

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** The largest rectangle of aspect `aspect` (= width / height) inside imgW × imgH, centred on `c`. */
export function coverCrop(imgW: number, imgH: number, aspect: number, c: CropCentre = { cx: 0.5, cy: 0.5 }): CropRect {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  let w = imgW, h = imgW / a;
  if (h > imgH) { h = imgH; w = imgH * a; }
  const x = clamp(c.cx * imgW - w / 2, 0, imgW - w);
  const y = clamp(c.cy * imgH - h / 2, 0, imgH - h);
  return { x, y, w, h };
}

/** The centre a rectangle sits at, as fractions of the photo. */
export function centreOf(r: CropRect, imgW: number, imgH: number): CropCentre {
  return { cx: (r.x + r.w / 2) / imgW, cy: (r.y + r.h / 2) / imgH };
}

/**
 * Move the window after the photo was dragged by (dx, dy) screen pixels on a preview `viewW` pixels
 * wide. Dragging the photo right shows more of its left side, so the window moves the other way.
 * The result is clamped: the centre a window cannot reach is never stored, so dragging back moves it
 * at once instead of first unwinding an overshoot.
 */
export function panCrop(imgW: number, imgH: number, aspect: number, c: CropCentre, dx: number, dy: number, viewW: number): CropCentre {
  const r = coverCrop(imgW, imgH, aspect, c);
  const scale = viewW > 0 ? r.w / viewW : 0; // photo pixels per screen pixel
  const moved: CropRect = {
    ...r,
    x: clamp(r.x - dx * scale, 0, imgW - r.w),
    y: clamp(r.y - dy * scale, 0, imgH - r.h),
  };
  return centreOf(moved, imgW, imgH);
}

/** One arrow-key press moves the window by this share of its own size. */
export const NUDGE_SHARE = 0.05;

/** Arrow keys on the focused preview: the key moves the WINDOW, like scrolling the photo under it. */
export function nudgeCrop(imgW: number, imgH: number, aspect: number, c: CropCentre, key: string): CropCentre | null {
  const r = coverCrop(imgW, imgH, aspect, c);
  const sx = r.w * NUDGE_SHARE, sy = r.h * NUDGE_SHARE;
  const d: Record<string, [number, number]> = { ArrowLeft: [-sx, 0], ArrowRight: [sx, 0], ArrowUp: [0, -sy], ArrowDown: [0, sy] };
  const step = d[key];
  if (!step) return null;
  return centreOf({ ...r, x: clamp(r.x + step[0], 0, imgW - r.w), y: clamp(r.y + step[1], 0, imgH - r.h) }, imgW, imgH);
}

/**
 * A rough print time, hours: 0.8 h per 2500 mm² of picture at 0.1 mm layers. It is a shape for the
 * number, not a slicer's estimate (the page says a test print is the real check). Never below 1.
 */
export function estimateHours(widthMm: number, heightMm: number): number {
  const w = Number(widthMm), h = Number(heightMm);
  if (!(w > 0) || !(h > 0)) return 1;
  return Math.max(1, Math.round((0.8 * w * h) / 2500));
}

/** Width and height inputs accept 10–270 mm: 270 is the U1's bed. */
export const LITHO_SIZE_MM = { min: 10, max: 270 } as const;

/** A typed size in mm, clamped to the bed; the fallback when the field is empty or not a number. */
export function clampSizeMm(v: unknown, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return clamp(n, LITHO_SIZE_MM.min, LITHO_SIZE_MM.max);
}
