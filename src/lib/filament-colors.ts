// Ordinary filament colours with generic names — what /image shows next to a colour so a maker
// knows what to load. Its own module, not in hueforge-palette.ts, because the page imports it
// directly while the relief engine behind hueforge-palette.ts loads only on demand.
import * as KC from "./color-mix";

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

/** The listed colour nearest `hex` (CIEDE2000), as its message key; null for an unparseable hex. */
export function nearestFilament(hex: string): string | null {
  const lab = KC.hexToLab(hex);
  if (!lab) return null;
  let best: string | null = null, bd = Infinity;
  for (const f of FILAMENTS) {
    const d = KC.ciede2000(lab, KC.hexToLab(f.hex)!);
    if (d < bd) { bd = d; best = f.key; }
  }
  return best;
}
