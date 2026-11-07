// Web Worker: every whole-archive job the converter does, off the main thread.
//
// It started as the conversion alone (cleanThreeMF), so converting a big painted file never froze the
// UI. Reading the file was still on the main thread: the Nov 7 review timed a 162 MB, 8.6M-triangle
// file at one 6.1 s long task right after the pick (analyzeThreeMF inflates the whole archive), and
// split-per-plate (subsetThreeMF) and the per-plate escape hatch (extractPlate) did the same. They
// all run here now, chosen by `kind`. Bytes are transferred in and out, never copied.
//
// Errors keep their type: a ThreeMFError (too large, expands too large, not a 3MF…) crosses as its
// fields and convert-client rebuilds it, because the page words its message from `code`.
import { analyzeThreeMF, cleanThreeMF, subsetThreeMF, ThreeMFError, type CleanTarget, type CleanOpts } from "./convert";
import { extractPlate } from "./plates";

export type WorkerJob =
  | { kind?: "clean"; buf: ArrayBuffer; name: string; target: CleanTarget; opts?: CleanOpts }
  | { kind: "analyze"; buf: ArrayBuffer; name: string }
  | { kind: "subset"; buf: ArrayBuffer; keep: number[]; translateXY?: [number, number] }
  | { kind: "extractPlate"; buf: ArrayBuffer; plateIndex: number };

const post = (msg: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);
const copyOut = (u8: Uint8Array): ArrayBuffer =>
  u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength ? (u8.buffer as ArrayBuffer) : (u8.slice().buffer as ArrayBuffer);

self.onmessage = async (e: MessageEvent<WorkerJob>) => {
  const job = e.data;
  try {
    if (job.kind === "analyze") {
      post({ ok: true, analysis: await analyzeThreeMF(new File([job.buf], job.name)) });
    } else if (job.kind === "subset") {
      const bytes = copyOut(subsetThreeMF(new Uint8Array(job.buf), new Set(job.keep), job.translateXY));
      post({ ok: true, bytes }, [bytes]);
    } else if (job.kind === "extractPlate") {
      const bytes = copyOut(extractPlate(new Uint8Array(job.buf), job.plateIndex));
      post({ ok: true, bytes }, [bytes]);
    } else {
      const r = await cleanThreeMF(new File([job.buf], job.name), job.target, job.opts);
      const bytes = await r.blob.arrayBuffer();
      // Strip `blob` — it can't be structured-cloned back; the caller rebuilds it from `bytes`.
      const rest = { ...r, blob: undefined };
      post({ ok: true, bytes, rest }, [bytes]);
    }
  } catch (err) {
    const three = err instanceof ThreeMFError ? { code: err.code, sizeMB: err.sizeMB, capMB: err.capMB } : undefined;
    post({ ok: false, error: err instanceof Error ? err.message : String(err), three });
  }
};
