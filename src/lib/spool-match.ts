// "These are the spools I have loaded — make the file fit them."
//
// The converter's default runs the other way: it reads the model's colours and proposes slot colours
// from them (`reduceColors`), so the slots end up holding whatever the creator painted with. That is
// right when you are about to go and load those colours. It is backwards when the printer is already
// loaded and you want to print NOW with what is on it — which is the question PaintPort starts from,
// and the one this module answers.
//
// Pure and framework-free, like my-filaments.ts, whose ΔE76 distance it reuses so the two features can
// never disagree about which colour is "closest".

import { colorDistance } from "./my-filaments";

/**
 * Past this ΔE76 a colour has no spool that resembles it. ~2.3 is just-noticeable and ~10 is "clearly a
 * different shade"; 25 is where a print stops looking like the picture (a red rendered in orange). It
 * flags, never blocks: the mapping still happens, and the caller decides whether to suggest mixing.
 */
export const FAR_MATCH = 25;

export type SpoolMatch = {
  /** For each palette colour, the slot index it prints from. Same shape as the converter's `assign`. */
  map: number[];
  /** ΔE76 between each palette colour and the slot it was matched to. */
  distance: number[];
  /** Palette indices whose best slot is still `FAR_MATCH` or further away. */
  far: number[];
};

/**
 * Map every model colour to the nearest loaded slot. Unlike `assignFilaments`, slots MAY be shared:
 * five reds on a model with one red spool should all print red. Ties go to the lower slot, so the
 * result is deterministic.
 *
 * `usable` marks the slots that really hold a spool (see planColorMix); unmarked placeholder slots are
 * never matched. Omitted, or nothing marked, every slot counts.
 */
export function matchToSpools(palette: string[], slots: string[], usable?: boolean[]): SpoolMatch {
  const anyUsable = !!usable && slots.some((_, j) => usable[j]);
  const map: number[] = [];
  const distance: number[] = [];
  const far: number[] = [];
  if (!slots.length) return { map: palette.map(() => 0), distance: palette.map(() => Infinity), far: palette.map((_, i) => i) };
  palette.forEach((hex, i) => {
    let best = 0;
    let bestD = Infinity;
    slots.forEach((s, j) => {
      if (anyUsable && !usable![j]) return;
      const d = colorDistance(hex, s);
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    });
    map.push(best);
    distance.push(bestD);
    if (bestD >= FAR_MATCH) far.push(i);
  });
  return { map, distance, far };
}
