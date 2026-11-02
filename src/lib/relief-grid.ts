// The relief is printed, so its grid follows the nozzle, not the preview: one cell per 0.4 mm line
// width across the plate. It was built from the 140 px preview grid, so a 100 mm relief had 0.71 mm
// cells, coarser than the nozzle can draw (Nov 2026 review). Capped because the solve and the mesh
// grow with the cell count: 250 px builds in ~0.75 s and 400 px in ~2 s; 500 px takes 3.3 s.
const RELIEF_PITCH_MM = 0.4;
const RELIEF_MAX_PX = 400;
export function reliefGrid(widthMm: number, w: number, h: number, previewGrid: number): number {
  const acrossWidth = widthMm / RELIEF_PITCH_MM;
  const longest = acrossWidth * (Math.max(w, h) / Math.max(1, w));
  return Math.round(Math.min(RELIEF_MAX_PX, Math.max(previewGrid, longest)));
}
