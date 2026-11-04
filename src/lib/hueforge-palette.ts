// Picks the filaments a HueForge relief is printed with, from the photo.
//
// ── WHY NOT hueforge.ts's suggestFilaments ─────────────────────────────────────────────────────────
// That one runs k-means with K = the number of heads and boosts the centroids' saturation. K-means
// spends its clusters where the PIXELS are, and a portrait's pixels are mostly skin, so it returns
// three shades of the same tan plus a black (measured on the King Faisal portrait: #140408 #5D344A
// #87908E #E4EAE6 — and on 5-fahd: three browns). A relief doesn't need that: it MAKES the in-between
// tones by stacking translucent layers, so what it needs from the filaments is RANGE — a dark to build
// shadows on, a light for highlights, and the photo's distinct hues (the red of a shemagh), each one a
// colour you can actually buy. The desktop app found this in July 2026 (memory: palette auto-pick v2)
// and prototyped it; this is that approach, written fresh for the site:
//
//   1. over-cluster the photo in Lab (12 clusters, so small but distinct areas get a cluster of their own),
//   2. anchor the darkest and the lightest cluster,
//   3. fill the remaining heads farthest-first — the cluster most unlike everything picked so far,
//      weighted by its area (a stray pixel isn't a colour), a little by its chroma (a hue is worth
//      more than another grey) and down for dark colours (the black base makes those), skipping
//      anything within ΔE 12 of a pick,
//   4. snap each to the nearest colour in FILAMENTS, a short list of colours sold as ordinary PLA.
//
// Grayscale picks evenly spaced lightness steps from the neutral filaments instead: for a busy photo it
// reads better than four colours that don't agree, and it is what most printed portraits use.
//
// hueforge.ts is a mechanical port of the desktop app and stays one; this file is the site's own.
import * as KC from "./color-mix";
import { defaultTd, suggestLayers, orderByOpacity, DEFAULT_LAYER_H } from "./hueforge";

type ImageLike = { data: Uint8ClampedArray | number[]; width: number; height: number };
/** `name` is a key into the `image.filamentNames` messages (the page shows it translated). */
export type PickedFilament = { hex: string; name: string; td: number; layers: number };

/** Ordinary PLA colours, as approximate sRGB. Generic colour names (messages: image.filamentNames), not any brand's. */
export const FILAMENTS: { key: string; hex: string; neutral?: true }[] = [
  { key: "black", hex: "#161616", neutral: true },
  { key: "charcoal", hex: "#3A3A3C", neutral: true },
  { key: "darkGray", hex: "#5A5B5D", neutral: true },
  { key: "gray", hex: "#8B8C8E", neutral: true },
  { key: "lightGray", hex: "#BDBEC0", neutral: true },
  { key: "white", hex: "#F4F4F2", neutral: true },
  { key: "ivory", hex: "#EDE6D3" },
  { key: "beige", hex: "#D9C4A2" },
  { key: "peach", hex: "#D7A684" },
  { key: "tan", hex: "#B08458" },
  { key: "brown", hex: "#6E4527" },
  { key: "darkBrown", hex: "#3F2819" },
  { key: "red", hex: "#C8211B" },
  { key: "crimson", hex: "#8E1B2A" },
  { key: "orange", hex: "#F0701E" },
  { key: "yellow", hex: "#F6D21C" },
  { key: "gold", hex: "#C99B2E" },
  { key: "olive", hex: "#6B7330" },
  { key: "green", hex: "#2E8B3A" },
  { key: "darkGreen", hex: "#1F4A2C" },
  { key: "teal", hex: "#00808A" },
  { key: "skyBlue", hex: "#5AB4E5" },
  { key: "blue", hex: "#1F4FBF" },
  { key: "navy", hex: "#1C2A4D" },
  { key: "purple", hex: "#5B2C86" },
  { key: "magenta", hex: "#C2185B" },
  { key: "pink", hex: "#F29CC2" },
];

const OVER_CLUSTER = 12;
const MIN_APART = 12; // ΔE2000 under which two picks are the same colour to the eye

type Cluster = { lab: KC.Lab; weight: number };

/** Lab samples of the opaque pixels, at most ~4096 of them. */
function samples(img: ImageLike): KC.Lab[] {
  const { data, width, height } = img;
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 4096)));
  const out: KC.Lab[] = [];
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const o = (y * width + x) * 4;
      if (data[o + 3] < 8) continue;
      out.push(KC.rgbToLab({ r: data[o], g: data[o + 1], b: data[o + 2] }));
    }
  }
  return out;
}

/** K-means in Lab (Euclidean — cheap, and fine for grouping), seeded across lightness. */
function clusters(pts: KC.Lab[], k: number): Cluster[] {
  const sorted = pts.slice().sort((p, q) => p.L - q.L);
  const cent = Array.from({ length: Math.min(k, sorted.length) }, (_, i) => ({ ...sorted[Math.floor(((i + 0.5) / k) * (sorted.length - 1))] }));
  const count = new Array(cent.length).fill(0);
  for (let iter = 0; iter < 10; iter++) {
    const sum = cent.map(() => ({ L: 0, a: 0, b: 0 }));
    count.fill(0);
    for (const p of pts) {
      let bi = 0, bd = Infinity;
      for (let c = 0; c < cent.length; c++) {
        const d = (p.L - cent[c].L) ** 2 + (p.a - cent[c].a) ** 2 + (p.b - cent[c].b) ** 2;
        if (d < bd) { bd = d; bi = c; }
      }
      sum[bi].L += p.L; sum[bi].a += p.a; sum[bi].b += p.b; count[bi]++;
    }
    for (let c = 0; c < cent.length; c++) {
      if (count[c]) cent[c] = { L: sum[c].L / count[c], a: sum[c].a / count[c], b: sum[c].b / count[c] };
    }
  }
  return cent.map((lab, i) => ({ lab, weight: count[i] / pts.length })).filter((c) => c.weight > 0);
}

/** The listed filament nearest a colour, among `pool`, skipping ones already used. */
function snap(lab: KC.Lab, pool: typeof FILAMENTS, used: Set<string>) {
  let best: (typeof FILAMENTS)[number] | null = null, bd = Infinity;
  for (const f of pool) {
    if (used.has(f.hex)) continue;
    const d = KC.ciede2000(lab, KC.hexToLab(f.hex)!);
    if (d < bd) { bd = d; best = f; }
  }
  return best;
}

function finish(picked: (typeof FILAMENTS)[number][]): PickedFilament[] {
  return orderByOpacity(
    picked.map((f) => {
      const td = defaultTd(f.hex);
      return { hex: f.hex, name: f.key, td, layers: suggestLayers(td, DEFAULT_LAYER_H) };
    }),
  ) as PickedFilament[];
}

/**
 * Up to `count` filaments for this photo, bottom of the stack first (opaque → translucent, the order
 * planPainting expects). `grayscale` restricts the pick to the neutral filaments.
 */
export function pickFilaments(img: ImageLike, count: number, opts: { grayscale?: boolean } = {}): PickedFilament[] {
  const n = Math.max(2, Math.min(FILAMENTS.length, Math.round(count) || 4));
  const pts = samples(img);
  if (!pts.length) return [];

  if (opts.grayscale) {
    // Evenly spaced lightness between the photo's own darkest and lightest (2nd/98th percentile, so
    // a single specular glint doesn't set the top), each snapped to a neutral.
    const Ls = pts.map((p) => p.L).sort((p, q) => p - q);
    const lo = Ls[Math.floor(Ls.length * 0.02)], hi = Ls[Math.floor(Ls.length * 0.98)];
    const neutrals = FILAMENTS.filter((f) => f.neutral);
    const used = new Set<string>();
    const picked: (typeof FILAMENTS)[number][] = [];
    for (let i = 0; i < Math.min(n, neutrals.length); i++) {
      // Stretch to the full range at the ends: a relief needs a real black base and a real white top.
      const L = i === 0 ? 0 : i === n - 1 ? 100 : lo + ((hi - lo) * i) / (n - 1);
      const f = snap({ L, a: 0, b: 0 }, neutrals, used);
      if (f) { used.add(f.hex); picked.push(f); }
    }
    return finish(picked);
  }

  const cl = clusters(pts, OVER_CLUSTER);
  const byL = cl.slice().sort((p, q) => p.lab.L - q.lab.L);
  const chosen: KC.Lab[] = [byL[0].lab];
  if (byL.length > 1) chosen.push(byL[byL.length - 1].lab);
  while (chosen.length < n) {
    let best: Cluster | null = null, bs = 0;
    for (const c of cl) {
      const apart = Math.min(...chosen.map((x) => KC.ciede2000(c.lab, x)));
      if (apart < MIN_APART) continue;
      // A dark colour is cheap: a few layers of any filament over the black base already make it.
      // Without this a portrait spent a head on dark brown and lost the skin tone (5-fahd: grey face).
      const dark = Math.min(1, Math.max(0.3, c.lab.L / 35));
      const chroma = Math.hypot(c.lab.a, c.lab.b);
      const s = apart * dark * Math.sqrt(c.weight) * (1 + 0.06 * chroma);
      if (s > bs) { bs = s; best = c; }
    }
    if (!best) break; // the photo has fewer distinct colours than heads — use fewer
    chosen.push(best.lab);
  }

  // Snap the anchors first so the dark end stays dark and the light end light, then the hues.
  const used = new Set<string>();
  const picked: (typeof FILAMENTS)[number][] = [];
  for (const lab of chosen) {
    const f = snap(lab, FILAMENTS, used);
    if (f) { used.add(f.hex); picked.push(f); }
  }
  return finish(picked);
}

