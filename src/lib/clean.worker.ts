// Web Worker: runs the .3mf conversion (cleanThreeMF) off the main thread so converting a big
// painted file never freezes the UI. Receives the file bytes (transferred in) + target/opts, returns
// the converted bytes (transferred out) + the rest of the CleanResult (diff, swaps, counts).
import { cleanThreeMF, type CleanTarget, type CleanOpts } from "./convert";

self.onmessage = async (e: MessageEvent<{ buf: ArrayBuffer; name: string; target: CleanTarget; opts?: CleanOpts }>) => {
  try {
    const { buf, name, target, opts } = e.data;
    const r = await cleanThreeMF(new File([buf], name), target, opts);
    const bytes = await r.blob.arrayBuffer();
    // Strip `blob` — it can't be structured-cloned back; the caller rebuilds it from `bytes`.
    const rest = { ...r, blob: undefined };
    (self as unknown as Worker).postMessage({ ok: true, bytes, rest }, [bytes]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
