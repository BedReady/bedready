// "My Filaments" — a lightweight, client-side inventory of the spools you actually own, so the
// converter's Full Spectrum picker can load your real colours onto the 4 heads (and match a model's
// colours to the closest spool you have). Storage mirrors the anonymous path of ConvertPresets:
// localStorage only (no account required). Cloud-sync for signed-in users is a later follow-up
// (would need a `user_filaments` table, same shape as `user_presets`).
//
// Pure + framework-free so it can be unit-tested and reused anywhere.

export type Filament = {
  id: string;
  name: string; // free text, e.g. "Polymaker Galaxy Black"
  hex: string; // normalized #RRGGBB
  material?: string; // PLA | PETG | ABS | TPU | ASA | other (free-form; optional)
};

const KEY = "bedready:my-filaments";

/** Normalize any hex-ish input to #RRGGBB uppercase; returns "" if it can't. */
export function normHex(input: string): string {
  let v = (input || "").trim().replace(/^#/, "").toUpperCase();
  if (/^[0-9A-F]{3}$/.test(v)) v = v.split("").map((c) => c + c).join(""); // #abc → #aabbcc
  return /^[0-9A-F]{6}$/.test(v) ? "#" + v : "";
}

// --- storage (client-only; safe no-ops when localStorage is unavailable) ---

export function loadFilaments(): Filament[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    // Defensive: keep only well-formed entries (a corrupted store shouldn't crash the picker).
    return arr
      .filter((f) => f && typeof f.hex === "string")
      .map((f) => ({ id: String(f.id ?? ""), name: String(f.name ?? ""), hex: normHex(f.hex), material: f.material ? String(f.material) : undefined }))
      .filter((f) => f.hex && f.id);
  } catch {
    return [];
  }
}

export function saveFilaments(list: Filament[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage blocked (private mode / quota) — inventory is best-effort */
  }
}

/** Lowest free "fN" id (reuses gaps after deletes). No Date.now()/random — fine for a local list. */
export function newId(existing: Filament[]): string {
  const ids = new Set(existing.map((f) => f.id));
  let n = 1;
  while (ids.has("f" + n)) n++;
  return "f" + n;
}

// --- colour matching (nearest owned spool to a target colour) ---

function hexToRgb(hex: string): [number, number, number] {
  const h = normHex(hex) || "#000000";
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

// sRGB (0–255) → CIE-Lab (D65). Good enough for "which spool is closest"; ΔE76 distance below.
function rgbToLab([r, g, b]: [number, number, number]): [number, number, number] {
  const lin = (c: number) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const R = lin(r), G = lin(g), B = lin(b);
  // sRGB → XYZ (D65)
  let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  let y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  let z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  x = f(x); y = f(y); z = f(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/** Perceptual distance (ΔE76) between two hex colours. 0 = identical; ~2.3 = just-noticeable. */
export function colorDistance(a: string, b: string): number {
  const [l1, a1, b1] = rgbToLab(hexToRgb(a));
  const [l2, a2, b2] = rgbToLab(hexToRgb(b));
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/** The owned filament closest to `hex`, or null if the inventory is empty. */
export function nearestFilament(hex: string, inventory: Filament[]): Filament | null {
  let best: Filament | null = null;
  let bestD = Infinity;
  for (const f of inventory) {
    const d = colorDistance(hex, f.hex);
    if (d < bestD) { bestD = d; best = f; }
  }
  return best;
}

export type Assignment = { index: number; filament: Filament; distance: number; reused: boolean };

/**
 * Assign owned spools to the heads — each spool used at most once.
 *
 * Matching each head independently with nearestFilament() is wrong here: a single spool would get
 * assigned to two heads, which you physically cannot load, and for Full Spectrum it quietly shrinks
 * the mixing basis (two heads nominally holding the same colour = fewer real primaries to mix from).
 *
 * Greedy over globally-sorted pairs: repeatedly take the closest (head, spool) pair where neither is
 * spoken for. Not optimal in the Hungarian sense, but it's O(n·m log) and predictable — the best
 * single match always wins, which is what someone eyeballing the result expects.
 *
 * If the inventory is smaller than the number of heads, the leftover heads fall back to their nearest
 * spool WITH reuse (flagged `reused`), because at that point there is genuinely nothing better.
 */
export function assignFilaments(targets: { index: number; hex: string }[], inventory: Filament[]): Assignment[] {
  if (!targets.length || !inventory.length) return [];

  const pairs: { ti: number; fi: number; d: number }[] = [];
  targets.forEach((t, ti) => {
    inventory.forEach((f, fi) => pairs.push({ ti, fi, d: colorDistance(t.hex, f.hex) }));
  });
  // Ties broken by (target, filament) order so the result is deterministic.
  pairs.sort((a, b) => a.d - b.d || a.ti - b.ti || a.fi - b.fi);

  const out: Assignment[] = [];
  const usedTarget = new Set<number>();
  const usedFilament = new Set<number>();
  for (const p of pairs) {
    if (usedTarget.has(p.ti) || usedFilament.has(p.fi)) continue;
    usedTarget.add(p.ti);
    usedFilament.add(p.fi);
    out.push({ index: targets[p.ti].index, filament: inventory[p.fi], distance: p.d, reused: false });
    if (usedTarget.size === targets.length) break;
  }

  // Fewer spools than heads → the rest reuse their nearest, and say so.
  for (let ti = 0; ti < targets.length; ti++) {
    if (usedTarget.has(ti)) continue;
    const f = nearestFilament(targets[ti].hex, inventory);
    if (f) out.push({ index: targets[ti].index, filament: f, distance: colorDistance(targets[ti].hex, f.hex), reused: true });
  }

  return out.sort((a, b) => a.index - b.index);
}
