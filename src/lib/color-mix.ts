// Perceptual colour maths — ported from the BedReady desktop app's lib/color-mix.js so the web
// HueForge engine computes identical results to the app's.
//
// The site already had rgbToLab + a plain CIE76 deltaE buried inside convert.ts (fine for picking a
// filament out of four). HueForge needs CIEDE2000: it ranks thousands of candidate colours along a
// transmission gradient, where CIE76's well-known blue/saturation errors visibly pick the wrong
// layer height. Kept as its own module rather than widening convert.ts, since the image pipeline and
// the converter have no other reason to share code.
//
// Unchanged from the app on purpose: same formulae, same rounding, same D65 white point. If these
// two ever disagree, a file exported from the app and one from the site would print different
// colours from the same photo.

export type Rgb = { r: number; g: number; b: number };
export type Lab = { L: number; a: number; b: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function hexToRgb(hex: string | null | undefined): Rgb | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex ?? "").trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const to2 = (v: number) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0");
  return ("#" + to2(r) + to2(g) + to2(b)).toUpperCase();
}

// sRGB (0–255) → linear (0–1), and back. Blending must happen in linear light, or mixing two
// filaments gives a muddy result that doesn't match the print.
const srgbToLinear = (c: number) => {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};
const linearToSrgb = (c: number) => {
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return v * 255;
};

export { srgbToLinear, linearToSrgb };

/** {r,g,b} 0–255 → CIE-Lab (D65). */
export function rgbToLab({ r, g, b }: Rgb): Lab {
  const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b);
  let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  let y = (R * 0.2126 + G * 0.7152 + B * 0.0722) / 1.0;
  let z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  x = f(x); y = f(y); z = f(z);
  return { L: 116 * y - 16, a: 500 * (x - y), b: 200 * (y - z) };
}

export function hexToLab(hex: string | null | undefined): Lab | null {
  const rgb = hexToRgb(hex);
  return rgb ? rgbToLab(rgb) : null;
}

/** Perceptual distance between two hex colours (CIEDE2000). Invalid input → Infinity. */
export function deltaE(hexA: string | null | undefined, hexB: string | null | undefined): number {
  const l1 = hexToLab(hexA), l2 = hexToLab(hexB);
  if (!l1 || !l2) return Infinity;
  return ciede2000(l1, l2);
}

export function ciede2000(lab1: Lab, lab2: Lab): number {
  const { L: L1, a: a1, b: b1 } = lab1;
  const { L: L2, a: a2, b: b2 } = lab2;
  const rad = Math.PI / 180, deg = 180 / Math.PI;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const Cbar7 = Math.pow(Cbar, 7);
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + Math.pow(25, 7))));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const h1p = Math.atan2(b1, a1p) < 0 ? Math.atan2(b1, a1p) * deg + 360 : Math.atan2(b1, a1p) * deg;
  const h2p = Math.atan2(b2, a2p) < 0 ? Math.atan2(b2, a2p) * deg + 360 : Math.atan2(b2, a2p) * deg;

  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp: number;
  if (C1p * C2p === 0) dhp = 0;
  else if (Math.abs(h2p - h1p) <= 180) dhp = h2p - h1p;
  else dhp = h2p - h1p > 180 ? h2p - h1p - 360 : h2p - h1p + 360;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * rad) / 2);

  const Lbarp = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;
  let hbarp: number;
  if (C1p * C2p === 0) hbarp = h1p + h2p;
  else if (Math.abs(h1p - h2p) <= 180) hbarp = (h1p + h2p) / 2;
  else hbarp = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;

  const T = 1 - 0.17 * Math.cos((hbarp - 30) * rad) + 0.24 * Math.cos(2 * hbarp * rad)
    + 0.32 * Math.cos((3 * hbarp + 6) * rad) - 0.20 * Math.cos((4 * hbarp - 63) * rad);
  const dtheta = 30 * Math.exp(-Math.pow((hbarp - 275) / 25, 2));
  const Cbarp7 = Math.pow(Cbarp, 7);
  const Rc = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + Math.pow(25, 7)));
  const Sl = 1 + (0.015 * Math.pow(Lbarp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbarp - 50, 2));
  const Sc = 1 + 0.045 * Cbarp;
  const Sh = 1 + 0.015 * Cbarp * T;
  const Rt = -Math.sin(2 * dtheta * rad) * Rc;

  return Math.sqrt(
    Math.pow(dLp / Sl, 2) + Math.pow(dCp / Sc, 2) + Math.pow(dHp / Sh, 2)
    + Rt * (dCp / Sc) * (dHp / Sh),
  );
}

/** Rank candidates by colour distance to a target; closest first, each tagged with its deltaE. */
export function nearest<T extends Record<string, unknown>>(
  targetHex: string,
  candidates: T[] | null | undefined,
  opts: { key?: string; limit?: number } = {},
): (T & { deltaE: number })[] {
  const key = opts.key || "color";
  const out = (candidates || [])
    .map((c) => ({ item: c, deltaE: deltaE(targetHex, c?.[key] as string | undefined) }))
    .filter((x) => isFinite(x.deltaE))
    .sort((a, b) => a.deltaE - b.deltaE)
    .map((x) => ({ ...x.item, deltaE: x.deltaE }));
  return opts.limit ? out.slice(0, opts.limit) : out;
}

/** Mix two colours in linear light. t=0 → a, t=1 → b. */
export function blend(hexA: string, hexB: string, t?: number): string | null {
  const A = hexToRgb(hexA), B = hexToRgb(hexB);
  if (!A || !B) return null;
  const k = clamp(t == null ? 0.5 : t, 0, 1);
  const mix = (ca: number, cb: number) => linearToSrgb(srgbToLinear(ca) * (1 - k) + srgbToLinear(cb) * k);
  return rgbToHex(mix(A.r, B.r), mix(A.g, B.g), mix(A.b, B.b));
}

/** N-step gradient between two colours (endpoints included). steps ≥ 2. */
export function gradient(hexA: string, hexB: string, steps: number): string[] {
  const n = Math.max(2, Math.floor(steps || 2));
  const out: (string | null)[] = [];
  for (let i = 0; i < n; i++) out.push(blend(hexA, hexB, i / (n - 1)));
  return out.some((c) => c == null) ? [] : (out as string[]);
}
