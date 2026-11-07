// Client entry to the converter's whole-archive work, run off the main thread via a Web Worker (falls
// back to sync where Worker is absent — SSR/tests). Kept separate from convert.ts so the worker (which
// imports convert.ts) and this module (which references the worker) form a clean DAG — no circular
// chunk dep. See clean.worker.ts for why reading, subsetting and plate extraction moved here too.
import {
  analyzeThreeMF,
  cleanThreeMF,
  subsetThreeMF,
  ThreeMFError,
  type Analysis,
  type CleanResult,
  type CleanTarget,
  type CleanOpts,
} from "./convert";
import { extractPlate } from "./plates";

type Reply = {
  ok: boolean;
  error?: string;
  three?: { code: ConstructorParameters<typeof ThreeMFError>[0]; sizeMB: number; capMB: number };
  bytes?: ArrayBuffer;
  rest?: Omit<CleanResult, "blob">;
  analysis?: Analysis;
};

/** Run one job in a fresh worker; the input buffer is transferred, not copied. */
function run(job: Record<string, unknown> & { buf: ArrayBuffer }): Promise<Reply> {
  return new Promise<Reply>((resolve, reject) => {
    const w = new Worker(new URL("./clean.worker.ts", import.meta.url));
    w.onmessage = (e: MessageEvent<Reply>) => {
      w.terminate();
      const d = e.data;
      if (d?.ok) return resolve(d);
      // Rebuild the typed error so the page can say "too large" rather than "couldn't read".
      if (d?.three) return reject(new ThreeMFError(d.three.code, d.three.sizeMB, d.three.capMB));
      reject(new Error(d?.error || "convert worker failed"));
    };
    w.onerror = (e) => {
      w.terminate();
      reject(new Error(e.message || "convert worker error"));
    };
    w.postMessage(job, [job.buf]);
  });
}

const hasWorker = () => typeof Worker !== "undefined";

export async function cleanThreeMFAsync(file: File, target: CleanTarget, opts?: CleanOpts): Promise<CleanResult> {
  if (!hasWorker()) return cleanThreeMF(file, target, opts);
  const d = await run({ kind: "clean", buf: await file.arrayBuffer(), name: file.name, target, opts });
  return { ...d.rest, blob: new Blob([d.bytes!], { type: "model/3mf" }) } as CleanResult;
}

/** analyzeThreeMF, off the main thread: picking a big file no longer freezes the page. */
export async function analyzeThreeMFAsync(file: File): Promise<Analysis> {
  if (!hasWorker()) return analyzeThreeMF(file);
  return (await run({ kind: "analyze", buf: await file.arrayBuffer(), name: file.name })).analysis!;
}

/** subsetThreeMF, off the main thread. `bytes` is transferred: the caller must not reuse it. */
export async function subsetThreeMFAsync(bytes: Uint8Array, keep: Set<number>, translateXY?: [number, number]): Promise<Uint8Array> {
  if (!hasWorker()) return subsetThreeMF(bytes, keep, translateXY);
  const buf = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? (bytes.buffer as ArrayBuffer) : (bytes.slice().buffer as ArrayBuffer);
  return new Uint8Array((await run({ kind: "subset", buf, keep: [...keep], translateXY })).bytes!);
}

/** extractPlate, off the main thread. */
export async function extractPlateAsync(file: File, plateIndex: number): Promise<Uint8Array> {
  if (!hasWorker()) return extractPlate(new Uint8Array(await file.arrayBuffer()), plateIndex);
  return new Uint8Array((await run({ kind: "extractPlate", buf: await file.arrayBuffer(), plateIndex })).bytes!);
}
