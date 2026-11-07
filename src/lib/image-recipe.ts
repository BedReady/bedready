// A shareable /image link: the SETTINGS that made a print, not the photo (which never leaves the
// visitor's browser). Somebody who liked a result can send "/image?mode=hueforge&size=120" and the
// recipient drops in their own photo with the same set-up.
//
//   mode   flat | relief | hueforge | hueforge-gray
//   size   longest side, mm (20–250)
//   colors flat/relief palette size (2–4)
//   base   plate thickness, mm (1–10)
//   depth  relief height above the base, mm (0.4–6, relief only)
//
// Every value is validated and clamped to the page's own control ranges; an unknown or malformed
// value is dropped, so a link can never put the page in a state its controls could not.

export type ImageMode = "flat" | "relief" | "hueforge" | "hueforge-gray";
export type ImageRecipe = { mode?: ImageMode; size?: number; colors?: number; base?: number; depth?: number };

const MODES: readonly ImageMode[] = ["flat", "relief", "hueforge", "hueforge-gray"];
const num = (s: string | null, min: number, max: number, step: number): number | undefined => {
  if (s == null || s.trim() === "") return undefined;
  const n = Number(s);
  if (!Number.isFinite(n)) return undefined;
  // Clamp, snap to the control's step, and drop float noise (2.4000000000000004).
  const snapped = Math.round(Math.min(max, Math.max(min, n)) / step) * step;
  return Math.round(snapped * 1000) / 1000;
};

export function parseImageRecipe(search: string): ImageRecipe {
  const q = new URLSearchParams(search);
  const r: ImageRecipe = {};
  const mode = q.get("mode");
  if (mode && (MODES as readonly string[]).includes(mode)) r.mode = mode as ImageMode;
  const size = num(q.get("size"), 20, 250, 1);
  if (size !== undefined) r.size = size;
  const colors = num(q.get("colors"), 2, 4, 1);
  if (colors !== undefined) r.colors = colors;
  const base = num(q.get("base"), 1, 10, 0.2);
  if (base !== undefined) r.base = base;
  const depth = num(q.get("depth"), 0.4, 6, 0.2);
  if (depth !== undefined) r.depth = depth;
  return r;
}

/** "?mode=…&size=…" for these settings; only the keys that apply to the mode are written. */
export function imageRecipeQuery(r: Required<Pick<ImageRecipe, "mode" | "size" | "base">> & Pick<ImageRecipe, "colors" | "depth">): string {
  const q = new URLSearchParams();
  q.set("mode", r.mode);
  q.set("size", String(r.size));
  if (r.mode === "flat" || r.mode === "relief") q.set("colors", String(r.colors ?? 4));
  q.set("base", String(r.base));
  if (r.mode === "relief" && r.depth !== undefined) q.set("depth", String(r.depth));
  return `?${q.toString()}`;
}
