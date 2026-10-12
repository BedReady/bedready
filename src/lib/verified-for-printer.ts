/**
 * Which MakerRun files to show on the done screen: ones already verified for the machine the visitor
 * just converted for.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────
 *
 * Read 2026-10-06 on makerrun.com: the converter had run ~6,600 times and sent ~150 visitors to the
 * library in the previous 30 days. The done screen's only library link is a generic "Browse
 * MakerRun". Somebody who has just converted a multicolour file for a U1 is the exact person a
 * U1-verified file is for, so the strip names that machine and shows the files.
 *
 * Pure and separate from the component so the matching rule is tested without a browser: the rule
 * that matters is "nothing matches → show nothing", because an empty box asking for attention is
 * worse than no box.
 */

/** The slice of MakerRun's DesignDTO (docs/API.md there) this strip reads. */
export type VerifiedDesign = {
  slug: string;
  title: string;
  url: string;
  nsfw: boolean;
  colorCount: number | null;
  cover: { url: string | null } | null;
  verification: { badge: boolean; printer: { brand: string | null; model: string | null } | null } | null;
};

/** Query string for `/api/v1/designs`. 25 is the API default and more than the library holds verified. */
export const VERIFIED_QUERY = "?verified=true&limit=25";

/**
 * Up to `max` verified, safe-for-work designs whose profile names `printerModel`, with a cover first.
 *
 * Matched on the model string MakerRun's file check detected ("Snapmaker U1"), which is the same
 * vendor `printer_model` this repo's MACHINES carry. No model (the "current" or "generic" target) →
 * nothing, rather than a guess.
 */
export function pickVerifiedFor(designs: VerifiedDesign[], printerModel: string | null | undefined, max = 3): VerifiedDesign[] {
  if (!printerModel) return [];
  const want = printerModel.trim().toLowerCase();
  return designs
    .filter((d) => d.verification?.badge === true && !d.nsfw)
    .filter((d) => (d.verification?.printer?.model ?? "").trim().toLowerCase() === want)
    .sort((a, b) => Number(!!b.cover?.url) - Number(!!a.cover?.url))
    .slice(0, max);
}

/**
 * A thumbnail-sized cover. MakerRun's covers are full-size originals (PNGs of several MB); its own
 * homepage serves them through its Next image optimizer, which already allows this storage host, so
 * the strip asks the same endpoint for a small rendition instead of pulling the original three times
 * (measured 2026-10-12: 22 KB WebP at 320 against a 6.4 MB PNG).
 *
 * The width MUST be one makerrun's next.config allows (IMAGE_SIZES 64/128/320, DEVICE_SIZES 640/…);
 * any other answers 400 INVALID_IMAGE_OPTIMIZE_REQUEST and the card shows a broken image.
 */
export function thumbnail(coverUrl: string, libraryOrigin: string, width: 64 | 128 | 320 | 640 = 320): string {
  return `${libraryOrigin}/_next/image?url=${encodeURIComponent(coverUrl)}&w=${width}&q=70`;
}

/** "Snapmaker U1 (0.4 nozzle)" → "Snapmaker U1": the nozzle is part of the preset, not the printer. */
export function printerLabel(name: string): string {
  return name.replace(/\s*\([^)]*nozzle\)\s*$/i, "").trim();
}

/**
 * The library URL with attribution, so makerrun.com's analytics can count what this strip sends.
 * (The converter's own Vercel project records nothing on its own — the click event below is a bonus,
 * the UTM tag is the measurement.)
 */
export function withAttribution(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set("utm_source", "bedready");
    u.searchParams.set("utm_medium", "converter-done");
    return u.toString();
  } catch {
    return url;
  }
}
