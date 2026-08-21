// Client-side entry to the mesh extractor. Kept separate from paint.ts so the worker (which imports
// paint.ts) and this module (which references the worker) form a clean DAG — no circular chunk dep.
import { extractMeshFromBuffer, type MeshData } from "./paint";

/** Parse a .3mf File off the main thread via a Web Worker (falls back to sync where Worker is absent,
 *  e.g. SSR/tests). The big-model parse never blocks the UI. */
export async function extractMeshAsync(file: File, maxFaces?: number): Promise<MeshData> {
  const buf = await file.arrayBuffer();
  if (typeof Worker === "undefined") return extractMeshFromBuffer(new Uint8Array(buf), maxFaces);
  return new Promise<MeshData>((resolve, reject) => {
    const w = new Worker(new URL("./mesh.worker.ts", import.meta.url));
    w.onmessage = (e: MessageEvent) => {
      w.terminate();
      const d = e.data;
      if (d && d.error) reject(new Error(d.error));
      else resolve(d as MeshData);
    };
    w.onerror = (e) => { w.terminate(); reject(new Error(e.message || "mesh worker failed")); };
    w.postMessage({ buf, maxFaces }, [buf]); // transfer the file bytes (zero-copy)
  });
}
