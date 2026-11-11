// Client-side entry to the lithophane worker (lithophane.worker.ts). Kept apart from the worker the
// way mesh-client.ts is kept apart from mesh.worker.ts: this module references the worker, the
// worker imports the core, and nothing imports back.
//
// One long-lived worker per page, because it holds the photo. Plans are COALESCED: while one is
// solving, a newer request replaces any still waiting (the waiting one resolves null), so a burst of
// edits costs at most the plan in flight plus the latest — never a queue of stale solves.
import type { LithoOptions } from "./lithophane";
import type { LithoExportOpts } from "./lithophane-3mf";
import type { LithoPreview, LithoWorkerRequest, LithoWorkerResponse } from "./lithophane.worker";

export type { LithoPreview };

type Pending = { resolve: (r: LithoWorkerResponse) => void };
type Distribute<T> = T extends unknown ? Omit<T, "id"> : never;
type Body = Distribute<LithoWorkerRequest>;

export type LithoClient = {
  setImage(px: Uint8ClampedArray, width: number, height: number): Promise<void>;
  /** The preview for these options, or null when a newer plan request superseded this one. */
  plan(opts: LithoOptions): Promise<LithoPreview | null>;
  exportFile(opts: LithoOptions, name: string, frame?: LithoExportOpts["frame"]): Promise<{ preview: LithoPreview; bytes: Uint8Array }>;
  dispose(): void;
};

export function createLithoClient(): LithoClient {
  const worker = new Worker(new URL("./lithophane.worker.ts", import.meta.url));
  const waiting = new Map<number, Pending>();
  let nextId = 1;
  let planBusy = false;
  let queuedPlan: { opts: LithoOptions; resolve: (p: LithoPreview | null) => void; reject: (e: Error) => void } | null = null;

  worker.onmessage = (e: MessageEvent<LithoWorkerResponse>) => {
    const p = waiting.get(e.data.id);
    if (!p) return;
    waiting.delete(e.data.id);
    p.resolve(e.data);
  };
  worker.onerror = (e) => {
    const err: LithoWorkerResponse = { id: 0, ok: false, error: e.message || "lithophane worker failed" };
    for (const p of waiting.values()) p.resolve(err);
    waiting.clear();
  };

  function send(body: Body, transfer: Transferable[] = []): Promise<LithoWorkerResponse> {
    const id = nextId++;
    return new Promise((resolve) => {
      waiting.set(id, { resolve });
      worker.postMessage({ ...body, id } as LithoWorkerRequest, transfer);
    });
  }

  function unwrap(r: LithoWorkerResponse) {
    if (!r.ok) throw new Error(r.error);
    return r;
  }

  async function runPlan(opts: LithoOptions, resolve: (p: LithoPreview | null) => void, reject: (e: Error) => void) {
    planBusy = true;
    try {
      const r = unwrap(await send({ type: "plan", opts }));
      resolve(r.preview ?? null);
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    } finally {
      planBusy = false;
      const q = queuedPlan;
      queuedPlan = null;
      if (q) void runPlan(q.opts, q.resolve, q.reject);
    }
  }

  return {
    async setImage(px, width, height) {
      // A copy is transferred, so the caller's pixels stay usable (the page keeps them for nothing
      // today, but a detached buffer is a confusing thing to hand back).
      const buf = px.slice().buffer;
      unwrap(await send({ type: "image", data: buf, width, height }, [buf]));
    },
    plan(opts) {
      return new Promise((resolve, reject) => {
        if (!planBusy) { void runPlan(opts, resolve, reject); return; }
        queuedPlan?.resolve(null);
        queuedPlan = { opts, resolve, reject };
      });
    },
    async exportFile(opts, name, frame) {
      const r = unwrap(await send({ type: "export", opts, name, frame }));
      if (!r.preview || !r.bytes) throw new Error("export returned nothing");
      return { preview: r.preview, bytes: r.bytes };
    },
    dispose() {
      worker.terminate();
      queuedPlan?.resolve(null);
      queuedPlan = null;
      for (const p of waiting.values()) p.resolve({ id: 0, ok: false, error: "disposed" });
      waiting.clear();
    },
  };
}
