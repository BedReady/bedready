// What prints together.
//
// A .3mf's mesh arrives in PLATE-LAYOUT space: paint.ts walks build items through components applying
// every transform, so the vertices of a four-plate project are spread across four bed-widths. Any
// analysis that treats the file as one model therefore analyses the arrangement instead — and there
// are several such analyses, which is why the grouping lives here rather than inside any one of them.
//
// The first casualty was the bed-fit check, which told someone with ordinary small parts that their
// "model is 454×516×49 mm". The second was band detection: two plates that are each cleanly colour-
// banded look, combined, like one model whose layers are two-coloured.
//
// A plate is the unit that prints at one time, so a plate is the unit these questions are asked about.

export type GroupPart = { positions: ArrayLike<number>; faceState?: ArrayLike<number> };

export type PrintGroup = {
  /** Plate name when the file is plate-structured; empty when there's nothing to name. */
  name: string;
  parts: GroupPart[];
};

export type GroupableMesh = {
  positions: ArrayLike<number>;
  faceState?: ArrayLike<number>;
  parts: { name?: string; positions: ArrayLike<number>; faceState?: ArrayLike<number> }[];
  plates: { name?: string; partIndices: number[] }[];
};

/** One entry per plate. Files without plate metadata yield a single group holding everything: no
 *  plates recorded means every build item goes down on the same bed, so they still print together. */
export function printGroups(mesh: GroupableMesh): PrintGroup[] {
  if (mesh.plates.length > 1) {
    return mesh.plates
      .map((pl) => ({
        name: pl.name ?? "",
        parts: pl.partIndices.map((i) => mesh.parts[i]).filter(Boolean) as GroupPart[],
      }))
      .filter((g) => g.parts.length > 0);
  }
  if (mesh.parts.length) return [{ name: mesh.plates[0]?.name ?? "", parts: mesh.parts as GroupPart[] }];
  return [{ name: "", parts: [{ positions: mesh.positions, faceState: mesh.faceState }] }];
}

/** A group's parts as one contiguous pair of arrays, so a whole plate can be measured at once.
 *  Returns the part's own arrays untouched when there's only one — the common case, and zero-copy. */
export function flattenGroup(group: PrintGroup): { positions: ArrayLike<number>; faceState: ArrayLike<number> } {
  const parts = group.parts;
  if (parts.length === 1) return { positions: parts[0].positions, faceState: parts[0].faceState ?? new Uint8Array(0) };

  const posLen = parts.reduce((n, p) => n + p.positions.length, 0);
  const stLen = parts.reduce((n, p) => n + (p.faceState?.length ?? 0), 0);
  const positions = new Float32Array(posLen);
  const faceState = new Uint8Array(stLen);
  let pi = 0, si = 0;
  for (const p of parts) {
    for (let i = 0; i < p.positions.length; i++) positions[pi++] = p.positions[i];
    if (p.faceState) for (let i = 0; i < p.faceState.length; i++) faceState[si++] = p.faceState[i];
  }
  return { positions, faceState };
}
