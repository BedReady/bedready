// Hands the file in the popup (or the one just intercepted) to bedready.io/convert's full editor.
//
// ── WHY ──────────────────────────────────────────────────────────────────────────────────────────
// The popup converts in one step; choosing which colour goes in which slot, Full Spectrum bases, M600
// swaps and the 3D preview all live on /convert. Until 0.5.0 the popup's link opened that page EMPTY,
// so a visitor holding the file had to go and find it in Downloads again. The competing U1 extension's
// strongest feature is exactly that colour mapping; rebuilding it in a 320px popup would be a second
// editor to keep in step. Handing the file over gets the whole editor for one function.
//
// ── HOW, AND WHY THIS WAY ────────────────────────────────────────────────────────────────────────
// The bytes are kept in THIS extension's IndexedDB (popup and background share the extension origin),
// then bedready.io/convert?ext=<our id> opens and the PAGE asks for them with
// `runtime.sendMessage(id, …)` — allowed by `externally_connectable` for https://bedready.io only.
// That costs no permission and no install warning, where a content script on bedready.io would add a
// host permission and make Chrome disable the extension until every user re-approved it.
//
// One file, one take: `take` deletes the entry, and an entry older than TTL_MS is never handed out.
// Firefox has no `externally_connectable`, so there the page simply opens empty, as it did before.

const DB = "bedready-handoff";
const STORE = "file";
const KEY = "pending";
export const TTL_MS = 30 * 60 * 1000;
// Extension messages are JSON in Chrome (64 MB cap); base64 is 4/3 of the bytes. Stay well under it.
export const MAX_HANDOFF_BYTES = 40 * 1024 * 1024;

type Entry = { name: string; blob: Blob; at: number };

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/** Keep `file` for the editor. Returns false when it is too large to hand over by message. */
export async function stash(file: Blob, name: string): Promise<boolean> {
  if (file.size > MAX_HANDOFF_BYTES) return false;
  await run("readwrite", (s) => s.put({ name, blob: file, at: Date.now() } satisfies Entry, KEY));
  return true;
}

/** The kept file, once, if it is fresh. */
export async function take(now = Date.now()): Promise<{ name: string; blob: Blob } | null> {
  const e = (await run<Entry | undefined>("readonly", (s) => s.get(KEY))) ?? null;
  await run("readwrite", (s) => s.delete(KEY));
  if (!e || !(e.blob instanceof Blob) || now - e.at > TTL_MS) return null;
  return { name: e.name, blob: e.blob };
}

/** Does this build let bedready.io ask for the file? (Chrome/Edge/Safari yes, Firefox no.) */
export function canHandOff(api: any): boolean {
  try {
    return !!api?.runtime?.getManifest?.()?.externally_connectable;
  } catch {
    return false;
  }
}

/** The editor's address: the chosen printer, plus our id when the page can fetch the file from us. */
export function editorUrl(api: any, target: string, withFile: boolean): string {
  const u = new URL("https://bedready.io/convert");
  u.searchParams.set("to", target);
  if (withFile && canHandOff(api) && api?.runtime?.id) u.searchParams.set("ext", api.runtime.id);
  return u.toString();
}

export function bytesToBase64(u8: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < u8.length; i += CHUNK) bin += String.fromCharCode(...u8.subarray(i, i + CHUNK));
  return btoa(bin);
}
