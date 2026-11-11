// Web Worker: plans a lithophane and writes its 3MF off the main thread. A full-size plan is one to
// several seconds of solver work and the export as much again, which on the main thread would freeze
// the page — every drag on the preview would stall the pointer.
//
// The photo is posted once ("image", transferred) and kept here, so a re-plan after a crop drag or
// a size change sends only the options. The last plan is kept too: "Download" right after the
// preview settled reuses it instead of solving the same thing twice.
import { planLithophane, type LithoOptions, type LithoPlan, type LithoImage } from "./lithophane";
import { lithophaneTo3MF, type LithoExportOpts } from "./lithophane-3mf";

export type LithoWorkerRequest =
  | { id: number; type: "image"; data: ArrayBuffer; width: number; height: number }
  | { id: number; type: "plan"; opts: LithoOptions }
  | { id: number; type: "export"; opts: LithoOptions; name: string; frame?: LithoExportOpts["frame"] };

export type LithoPreview = { gw: number; gh: number; meanDeltaE: number; backlit: Uint8ClampedArray; frontlit: Uint8ClampedArray };

export type LithoWorkerResponse =
  | { id: number; ok: true; preview?: LithoPreview; bytes?: Uint8Array }
  | { id: number; ok: false; error: string };

const post = (m: LithoWorkerResponse, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

let image: LithoImage | null = null;
let last: { key: string; plan: LithoPlan } | null = null;

function planFor(opts: LithoOptions): LithoPlan {
  if (!image) throw new Error("no image");
  const key = JSON.stringify(opts);
  if (last && last.key === key) return last.plan;
  const plan = planLithophane(image, opts);
  last = { key, plan };
  return plan;
}

/** Copies, so the cached plan keeps its own buffers after these are transferred away. */
function previewOf(plan: LithoPlan): LithoPreview {
  return { gw: plan.gw, gh: plan.gh, meanDeltaE: plan.meanDeltaE, backlit: plan.backlit.slice(), frontlit: plan.frontlit.slice() };
}

/** The backlit preview as a PNG for the 3MF's plate thumbnail; none where OffscreenCanvas is missing. */
async function thumbnail(plan: LithoPlan): Promise<Uint8Array | undefined> {
  if (typeof OffscreenCanvas === "undefined") return undefined;
  try {
    const src = new OffscreenCanvas(plan.gw, plan.gh);
    src.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(plan.backlit), plan.gw, plan.gh), 0, 0);
    const s = Math.min(1, 512 / Math.max(plan.gw, plan.gh));
    const out = new OffscreenCanvas(Math.max(1, Math.round(plan.gw * s)), Math.max(1, Math.round(plan.gh * s)));
    out.getContext("2d")!.drawImage(src, 0, 0, out.width, out.height);
    const blob = await out.convertToBlob({ type: "image/png" });
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    return undefined; // a missing thumbnail costs a grey tile in the slicer, not the file
  }
}

self.onmessage = async (e: MessageEvent<LithoWorkerRequest>) => {
  const m = e.data;
  try {
    if (m.type === "image") {
      image = { data: new Uint8ClampedArray(m.data), width: m.width, height: m.height };
      last = null;
      post({ id: m.id, ok: true });
      return;
    }
    const plan = planFor(m.opts);
    const preview = previewOf(plan);
    const transfer: Transferable[] = [preview.backlit.buffer, preview.frontlit.buffer];
    if (m.type === "plan") {
      post({ id: m.id, ok: true, preview }, transfer);
      return;
    }
    const bytes = lithophaneTo3MF(plan, { name: m.name, frame: m.frame, thumbnailPng: await thumbnail(plan) });
    if (!bytes) throw new Error("export failed");
    post({ id: m.id, ok: true, preview, bytes }, [...transfer, bytes.buffer as ArrayBuffer]);
  } catch (err) {
    post({ id: m.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
