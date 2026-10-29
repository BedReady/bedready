/**
 * Receives a file from the BedReady browser extension when it opens /convert with `?ext=<its id>`.
 *
 * The extension's popup and its download toast both offer "Edit colours on bedready.io". Before this,
 * that link opened the converter EMPTY and the visitor had to find the file in Downloads again. Now the
 * extension keeps the original file and this page asks for it — `runtime.sendMessage(id, …)`, which a
 * page may call only because the extension lists https://bedready.io in `externally_connectable`. See
 * extension/src/handoff.ts for the other half and why it is not a content script.
 *
 * Nothing touches a server. A missing extension, Firefox (no `externally_connectable`), a second load
 * of the same URL (the extension hands a file over once) or a timeout all end in the empty converter,
 * exactly as before, with nothing claiming otherwise.
 */

const TIMEOUT_MS = 5000;
// Chrome store ids are 32 letters a–p; unpacked, Edge and Safari ids differ, so accept any short,
// plain id rather than a list that would break the next store. The id only selects WHICH installed
// extension is asked; an extension that answers could have put a file in Downloads anyway.
const ID_RE = /^[\w.\- ()]{1,128}$/;
const NAME_RE = /\.(3mf|stl)$/i;
export const MAX_RECEIVE_BYTES = 40 * 1024 * 1024;

type Reply = { ok?: boolean; name?: unknown; b64?: unknown };

/** The `ext` parameter, when it is shaped like an extension id. */
export function handoffId(search: string): string | null {
  const id = new URLSearchParams(search).get("ext");
  return id && ID_RE.test(id) ? id : null;
}

/** Turn the extension's reply into a File, refusing anything that is not a model file of sane size. */
export function fileFromReply(r: unknown): File | null {
  const o = (r && typeof r === "object" ? r : {}) as Reply;
  if (!o.ok || typeof o.name !== "string" || typeof o.b64 !== "string") return null;
  const name = o.name.split(/[\\/]/).pop() ?? "";
  if (!NAME_RE.test(name) || name.length > 200) return null;
  if (o.b64.length > Math.ceil(MAX_RECEIVE_BYTES / 3) * 4) return null;
  let bin: string;
  try {
    bin = atob(o.b64);
  } catch {
    return null;
  }
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new File([u8], name, { type: "model/3mf" });
}

/** Ask the extension named in the URL for its file. Resolves null on any failure. */
export async function receiveFromExtension(search: string): Promise<File | null> {
  const id = handoffId(search);
  if (!id) return null;
  const g = globalThis as unknown as {
    chrome?: { runtime?: { sendMessage?: (...a: unknown[]) => unknown } };
    browser?: { runtime?: { sendMessage?: (...a: unknown[]) => unknown } };
  };
  const send = g.chrome?.runtime?.sendMessage ?? g.browser?.runtime?.sendMessage;
  if (typeof send !== "function") return null;
  const ask = new Promise<unknown>((resolve) => {
    try {
      // Chrome takes a callback; Safari returns a promise. Accept whichever arrives.
      const p = send(id, { type: "bedready-take-file" }, (r: unknown) => resolve(r));
      if (p && typeof (p as Promise<unknown>).then === "function") (p as Promise<unknown>).then(resolve, () => resolve(null));
    } catch {
      resolve(null);
    }
  });
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS));
  return fileFromReply(await Promise.race([ask, timeout]));
}
