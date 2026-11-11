// Client entry to the full-colour planner: runs it in a Web Worker (fullcolour.worker.ts), falling
// back to the main thread where Worker is absent (tests). Kept apart from fullcolour.ts so the
// worker and this module form a clean import DAG, like mesh-client.ts.
import type { FullColourOptions } from "./fullcolour";

export type FullColourResult = {
  preview: Uint8ClampedArray; gw: number; gh: number; meanDeltaE: number;
  sizeMm: { x: number; y: number; z: number };
  /** The U1 3MF, when asked for (withFile). */
  bytes: Uint8Array | null;
};

export async function planFullColourAsync(img: ImageData | { data: Uint8ClampedArray; width: number; height: number }, opts: FullColourOptions, name: string, withFile: boolean): Promise<FullColourResult> {
  // Copy: the caller keeps its pixels (they back the page's canvases); the copy is transferred.
  const data = img.data.slice().buffer;
  if (typeof Worker === "undefined") {
    const [{ planFullColour }, { fullColourTo3MF }] = await Promise.all([import("./fullcolour"), import("./fullcolour-3mf")]);
    const plan = planFullColour({ data: new Uint8ClampedArray(data), width: img.width, height: img.height }, opts);
    return { preview: plan.preview, gw: plan.gw, gh: plan.gh, meanDeltaE: plan.meanDeltaE, sizeMm: { x: plan.gw * plan.cellMm, y: plan.gh * plan.cellMm, z: plan.baseMm + plan.colourLayers * plan.layerH }, bytes: withFile ? fullColourTo3MF(plan, { name }) : null };
  }
  return new Promise<FullColourResult>((resolve, reject) => {
    const w = new Worker(new URL("./fullcolour.worker.ts", import.meta.url));
    w.onmessage = (e: MessageEvent) => {
      w.terminate();
      if (e.data && e.data.error) reject(new Error(e.data.error));
      else resolve(e.data as FullColourResult);
    };
    w.onerror = (e) => { w.terminate(); reject(new Error(e.message || "full colour worker failed")); };
    w.postMessage({ data, width: img.width, height: img.height, opts, name, withFile }, [data]);
  });
}
