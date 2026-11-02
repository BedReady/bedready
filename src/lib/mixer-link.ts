// A shareable /mixer link: the four filaments in the query string, so "what can these four mix?" can
// be sent to someone, bookmarked, or opened from the converter with the colours already loaded.
//
//   /mixer?c=29ABE2,ED1E79,FCEE21,111111&n=Cyan,Magenta,Yellow,Black
//
// `c` is required and must be exactly four 6-digit hex colours, or the link is ignored (the page keeps
// its CMYK default) rather than half-applied. `n` is optional; a missing or empty name keeps the
// page's own. Names are trimmed and capped, and a comma cannot appear in one, because it is the separator.

export const MIXER_SLOTS = 4;
const NAME_MAX = 24;
const HEX = /^#?([0-9a-f]{6})$/i;

export type MixerBase = { hex: string; label?: string };

/** The bases a `/mixer` query string carries, or null when it carries none (or a malformed set). */
export function parseMixerQuery(search: string): MixerBase[] | null {
  const q = new URLSearchParams(search);
  const hexes = (q.get("c") ?? "").split(",").map((s) => s.trim());
  if (hexes.length !== MIXER_SLOTS) return null;
  const valid = hexes.map((h) => HEX.exec(h)?.[1]);
  if (valid.some((h) => !h)) return null;
  const names = (q.get("n") ?? "").split(",");
  return valid.map((h, i) => {
    const label = (names[i] ?? "").trim().slice(0, NAME_MAX);
    return label ? { hex: `#${h!.toUpperCase()}`, label } : { hex: `#${h!.toUpperCase()}` };
  });
}

/** The query string for these bases ("?c=…&n=…"); names are left out when none is given. */
export function mixerQuery(bases: MixerBase[]): string {
  const q = new URLSearchParams();
  q.set("c", bases.map((b) => b.hex.replace("#", "").toUpperCase()).join(","));
  // A name that is only the slot's own colour code says nothing the `c` list doesn't.
  const names = bases.map((b) => (b.label ?? "").replace(/,/g, " ").trim().slice(0, NAME_MAX)).map((n, i) =>
    n.replace("#", "").toUpperCase() === bases[i].hex.replace("#", "").toUpperCase() ? "" : n,
  );
  if (names.some(Boolean)) q.set("n", names.join(","));
  return `?${q.toString()}`;
}

/** "/mixer" with these four colours loaded, or plain "/mixer" while any of them is not a valid colour. */
export function mixerHref(hexes: string[]): string {
  const q = mixerQuery(hexes.map((hex) => ({ hex })));
  return parseMixerQuery(q) ? `/mixer${q}` : "/mixer";
}
