// Web Worker: plans a full-colour print and writes its 3MF off the main thread (a 100 mm photo is
// ~250×250 cells × 165 slab combinations plus a million-triangle mesh — seconds of work that would
// freeze the page). Pixels in (transferred), preview + 3MF bytes out (transferred).
import { planFullColour, type FullColourOptions } from "./fullcolour";
import { fullColourTo3MF } from "./fullcolour-3mf";

type In = { data: ArrayBuffer; width: number; height: number; opts: FullColourOptions; name: string; withFile: boolean };

self.onmessage = (e: MessageEvent<In>) => {
  try {
    const { data, width, height, opts, name, withFile } = e.data;
    const plan = planFullColour({ data: new Uint8ClampedArray(data), width, height }, opts);
    const bytes = withFile ? fullColourTo3MF(plan, { name }) : null;
    const preview = plan.preview;
    const out = { preview, gw: plan.gw, gh: plan.gh, meanDeltaE: plan.meanDeltaE, sizeMm: { x: plan.gw * plan.cellMm, y: plan.gh * plan.cellMm, z: plan.baseMm + plan.colourLayers * plan.layerH }, bytes };
    (self as unknown as Worker).postMessage(out, bytes ? [preview.buffer, bytes.buffer] : [preview.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ error: err instanceof Error ? err.message : String(err) });
  }
};
