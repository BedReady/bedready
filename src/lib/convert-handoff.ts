/**
 * Hands the file someone just converted from `/convert` to `/upload`.
 *
 * ── THE PROBLEM THIS SOLVES ──────────────────────────────────────────────────────────────────────
 *
 * The converter's done screen says "You just made a U1-ready file — Share it", and the link went to
 * an EMPTY upload form. The visitor was holding the artifact, the browser was holding the artifact,
 * and the site asked them to go and find it in their downloads folder. Every step between wanting to
 * share and having shared is a place to give up, and this one existed for no reason at all.
 *
 * ── WHY IT IS BOTH IN MEMORY AND IN INDEXEDDB ───────────────────────────────────────────────────
 *
 * Memory alone was the original design, and its stated reason was that a module variable "survives a
 * client-side route change, which is exactly the lifetime wanted and no longer". That was true of the
 * lifetime and wrong about the journey. `/upload` shows a sign-in gate to anyone not signed in, and
 * converting needs no account — so the common path is: convert, click Share it, hit the gate, type an
 * email, LEAVE THE SITE for a mail client, come back through /auth/callback on a full page load. The
 * module is re-evaluated and the file is gone. #79's commit message claimed the file "survives the
 * round trip in memory"; for the only journey that matters, it never did.
 *
 * The original note rejected persistence on the grounds that "this is someone's model file. Writing
 * it to disk to save one file-picker interaction is a bad trade." That reasoning does not survive
 * contact with what the converter already does: it DOWNLOADS the converted file to the visitor's
 * disk. The bytes are already there, put there deliberately, seconds earlier. Keeping a copy in the
 * same browser's storage for half an hour protects nothing that has not already been decided.
 *
 * sessionStorage is still the wrong tool — it holds strings, so a .3mf would need base64 (a third
 * larger) against a ~5 MB quota that real files exceed; one file here is 44 MB. IndexedDB stores a
 * Blob natively with no size ceiling worth worrying about.
 *
 * So: memory for the same-tab hop, IndexedDB for the round trip, the SAME 30-minute staleness rule
 * on both, and the record deleted the moment it is read. A hard reload with no staged file behaves
 * exactly as before — the handoff is an accelerator, never a dependency, and nothing downstream may
 * assume it fired.
 */

type Staged = { file: File; stagedAt: number };

let staged: Staged | null = null;

/**
 * How long a staged file stays useful. Someone who converts, wanders off, and comes back an hour
 * later should not silently upload a file they have forgotten converting — by then re-picking it is
 * the clearer action. Generous, because the intended journey is a few seconds.
 */
const STALE_AFTER_MS = 30 * 60 * 1000;

// ── IndexedDB, the durable half ─────────────────────────────────────────────────────────────────
//
// One database, one store, one record. Everything is best-effort: private browsing, a disabled
// storage API or a full disk must degrade to memory-only rather than break the upload form.

const DB_NAME = "bedready-handoff";
const STORE = "staged";
const KEY = "converted";

function idb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return idb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null);
        try {
          const t = db.transaction(STORE, mode);
          const req = run(t.objectStore(STORE));
          req.onsuccess = () => resolve(req.result as T);
          req.onerror = () => resolve(null);
          t.oncomplete = () => db.close();
        } catch {
          resolve(null);
        }
      }),
  );
}

/** Called by /convert the moment a conversion produces a single downloadable file. */
export function stageConvertedFile(file: File) {
  staged = { file, stagedAt: Date.now() };
  // Fire and forget: the memory copy already works for the same-tab hop, and a storage failure must
  // never surface as a converter error.
  void tx("readwrite", (s) => s.put({ file, name: file.name, type: file.type, stagedAt: Date.now() }, KEY));
}

/**
 * Called once by /upload on mount. Returns the file and immediately forgets it — from memory AND
 * from storage — so a second visit does not silently re-attach a model the visitor already dealt
 * with, and so nothing is left on disk after it has served its purpose.
 */
export async function takeConvertedFile(): Promise<File | null> {
  const s = staged;
  staged = null;
  if (s) {
    void tx("readwrite", (st) => st.delete(KEY));
    return Date.now() - s.stagedAt > STALE_AFTER_MS ? null : s.file;
  }

  const rec = (await tx<{ file: Blob; name: string; type: string; stagedAt: number } | undefined>(
    "readonly",
    (st) => st.get(KEY),
  )) as { file: Blob; name: string; type: string; stagedAt: number } | null;
  // Read-then-delete regardless of staleness: a stale record is exactly the thing that should not
  // linger, and leaving it would make every later visit pay to read it again.
  void tx("readwrite", (st) => st.delete(KEY));
  if (!rec?.file) return null;
  if (Date.now() - rec.stagedAt > STALE_AFTER_MS) return null;
  return new File([rec.file], rec.name, { type: rec.type });
}

/**
 * Is there a live staged file — WITHOUT consuming it.
 *
 * Separate from takeConvertedFile because the analytics call on /upload needs to know whether the
 * visitor arrived from the converter, and must not be the thing that clears the file out from under
 * the effect that actually attaches it. Same staleness rule, so a measurement never counts a handoff
 * the form would refuse to use.
 */
export async function hasConvertedFile(): Promise<boolean> {
  if (staged) return Date.now() - staged.stagedAt <= STALE_AFTER_MS;
  const rec = (await tx<{ stagedAt: number } | undefined>("readonly", (st) => st.get(KEY))) as
    | { stagedAt: number }
    | null;
  return !!rec && Date.now() - rec.stagedAt <= STALE_AFTER_MS;
}

/** Discard without consuming — for a caller that navigates away from the flow. */
export function clearConvertedFile() {
  staged = null;
  void tx("readwrite", (s) => s.delete(KEY));
}

/** Exposed for tests: the staleness window both layers share. */
export const HANDOFF_STALE_AFTER_MS = STALE_AFTER_MS;
