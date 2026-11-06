// Does a multi-plate file fit the printer one plate at a time?
//
// A Bambu project often uses more colours than a 4-slot printer has, while every one of its plates
// uses only a few: Grendizer.3mf is 8 colours over 9 plates, one colour each. Converted whole, the
// page told that file its colours would be merged, and the export that keeps them all — one file per
// plate — sat in a closed section further down (Nov 2026: a separate tool was built for exactly this).
// This is the check that lets the page offer the split first.
//
// Counts come from the preview mesh. On a large file that mesh is SAMPLED (every Nth triangle), so a
// colour painted on a handful of faces can be missed and a 5-colour plate counted as 4. That plate
// is still converted on its own when split and reduced there, so the cost of a miss is one plate
// merged, not a wrong file — acceptable for a suggestion.

export type PlateColourMesh = {
  palette: string[];
  baseState: number;
  parts: { faceState: ArrayLike<number> }[];
  plates: { partIndices: number[] }[];
};

/** Colours each plate uses: palette states (1-based), base faces counted as the base colour. */
export function coloursPerPlate(mesh: PlateColourMesh): number[][] {
  return mesh.plates.map((pl) => {
    const used = new Set<number>();
    for (const j of pl.partIndices) {
      const fs = mesh.parts[j]?.faceState;
      if (!fs) continue;
      for (let i = 0; i < fs.length; i++) {
        const s = fs[i] || mesh.baseState;
        if (s >= 1 && s <= mesh.palette.length) used.add(s);
      }
    }
    return [...used].sort((a, b) => a - b);
  });
}

/**
 * The number of plates, when the file needs more than `slots` colours as a whole but every plate
 * needs `slots` or fewer — the case where one file per plate keeps every colour. Otherwise null.
 */
export function platesFitSlots(mesh: PlateColourMesh, slots: number): number | null {
  if (mesh.plates.length < 2) return null;
  const per = coloursPerPlate(mesh);
  const all = new Set(per.flat());
  if (all.size <= slots) return null;
  return per.every((c) => c.length <= slots) ? per.length : null;
}
