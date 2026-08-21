// Web Worker: parses a .3mf into preview mesh data off the main thread, so big models never freeze
// the UI. Receives the file bytes (transferred in), returns typed arrays (transferred out).
import { extractMeshFromBuffer } from "./paint";

self.onmessage = (e: MessageEvent<{ buf: ArrayBuffer; maxFaces?: number }>) => {
  try {
    const m = extractMeshFromBuffer(new Uint8Array(e.data.buf), e.data.maxFaces);
    // Transfer the array buffers (zero-copy). positions/faceState are distinct allocations.
    (self as unknown as Worker).postMessage(m, [m.positions.buffer, m.faceState.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ error: err instanceof Error ? err.message : String(err) });
  }
};

