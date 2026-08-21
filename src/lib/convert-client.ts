// Client entry to the converter that runs off the main thread via a Web Worker (falls back to sync
// where Worker is absent — SSR/tests). Kept separate from convert.ts so the worker (which imports
// convert.ts) and this module (which references the worker) form a clean DAG — no circular chunk dep.
import { cleanThreeMF, type CleanResult, type CleanTarget, type CleanOpts } from "./convert";

export async function cleanThreeMFAsync(file: File, target: CleanTarget, opts?: CleanOpts): Promise<CleanResult> {
  if (typeof Worker === "undefined") return cleanThreeMF(file, target, opts);
  const buf = await file.arrayBuffer();
  return new Promise<CleanResult>((resolve, reject) => {
    const w = new Worker(new URL("./clean.worker.ts", import.meta.url));
    w.onmessage = (e: MessageEvent) => {
      w.terminate();
      const d = e.data;
      if (!d || !d.ok) return reject(new Error(d?.error || "convert worker failed"));
      resolve({ ...d.rest, blob: new Blob([d.bytes], { type: "model/3mf" }) } as CleanResult);
    };
    w.onerror = (e) => { w.terminate(); reject(new Error(e.message || "convert worker error")); };
    w.postMessage({ buf, name: file.name, target, opts }, [buf]);
  });
}
