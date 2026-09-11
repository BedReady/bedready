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
 * ── ⚠️ STORAGE CANNOT CROSS THE CARVE, AND FOR THREE WEEKS NOTHING DID ──────────────────────────
 *
 * Everything above describes ONE origin. On 2026-08-21 the writer and the reader stopped sharing
 * one. Measured end to end on 2026-09-11, following the journey a visitor takes:
 *
 *   1. convert a file on bedready.io — 28.5 MB staged into `bedready-handoff` on THAT origin
 *   2. click "Save to my library", the converter's own main call to action
 *   3. land on makerrun.com/upload
 *   4. the form shows "Model files (required) — Drag and drop, or browse", empty
 *   5. read the store from makerrun.com: null
 *
 * IndexedDB is scoped to an origin. `/convert` is a CONVERTER route and `/upload` is a LIBRARY one;
 * `makerrun.com/convert` 301s away, so no same-origin path was left in which the two halves could
 * meet. The module went on writing to a store nothing read.
 *
 * Neither repo's guard could see it. `convert-handoff-guard.test.mts` asserts that every conversion
 * producing a single file calls `stageConvertedFile`, and every one does — it checks the WRITE. The
 * read did not disappear, it emigrated.
 *
 * ── SO THE BYTES TRAVEL THROUGH THE TAB, NOT THROUGH STORAGE ────────────────────────────────────
 *
 * `openLibraryWithHandoff` and `receiveHandoffFromOpener` below. The done screen's link opens the
 * library in a new tab with a real user gesture; the new tab announces itself to `window.opener`;
 * the converter answers with the File. Structured clone carries a File across origins, so the bytes
 * never touch a server and never touch storage the other side cannot read.
 *
 * ── THE TWO ROUTES THIS IS NOT ──────────────────────────────────────────────────────────────────
 *
 * **Not a server hop.** Uploading the file somewhere anonymous and handing over a token is the path
 * `upload-draft.ts` rejects at length: an unauthenticated write into storage means spam listings,
 * a disk filled by anyone with curl, and unlawful content with no accountable uploader, on a site
 * whose moderation is one person. Nothing here reaches a server; there is no new write path at all.
 *
 * **Not a hidden iframe.** The usual cross-origin storage bridge — frame the other origin, read its
 * IndexedDB, postMessage the result up — is broken by design in the browsers that matter: Safari
 * partitions third-party storage, so the frame would read an empty store belonging to nobody, and
 * Chrome is moving the same way. A tab the visitor opened by clicking is first-party on both sides.
 *
 * ── WHY THE HANDSHAKE IS RECEIVER-FIRST ─────────────────────────────────────────────────────────
 *
 * `postMessage` has no queue. A file sent before the new tab is listening is simply gone, and the
 * sender cannot know when that is — the new document parses, hydrates and mounts on its own
 * schedule. So the RECEIVER speaks first, the moment its effect runs, and the sender answers. The
 * sender holds its listener for HANDOFF_TIMEOUT_MS and then stops; the receiver does the same.
 *
 * ── AND WHY IT MAY NOT FIRE, WHICH MUST COST NOTHING ────────────────────────────────────────────
 *
 * A blocked popup, a middle-click, an opener the browser has severed, a tab closed before the
 * handshake — every one of those ends with the upload form exactly as it is today, empty, with no
 * notice claiming otherwise. The rule from the header above is unchanged and now spans two origins:
 * the handoff is an accelerator, never a dependency, and nothing downstream may assume it fired.
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

/**
 * One IndexedDB operation, resolved when the TRANSACTION settles rather than when the request does.
 *
 * ── THE SAME REPAIR AS upload-draft.ts, WHICH IS WHERE THIS CAME FROM ───────────────────────────
 *
 * This helper and that one are the same twenty lines, and they carried the same defect: a request
 * succeeds BEFORE its transaction commits, so resolving in `req.onsuccess` reports a write the
 * commit may still refuse. Measured in a browser, with a put whose transaction aborts after the
 * request succeeded: the helper returned success, and nothing was stored.
 *
 * This copy was the worse of the two. It had no `t.onabort` at all, so the only thing that could
 * report a failed transaction was a request-level error — and it closed the connection on
 * `oncomplete` alone, leaving it open on every unhappy path.
 *
 * What it costs here is milder than in the draft, and worth saying so: a lost staging degrades to
 * an empty upload form, which the header above calls acceptable — "the handoff is an accelerator,
 * never a dependency". Nothing lies to anybody. It is fixed because it is the same rule, one file
 * away, over a 44 MB model file — exactly the size that reaches a storage limit.
 *
 * A READ may still be answered from its request; a value that was read is valid whether or not the
 * transaction goes on to commit. It is writes that must wait, and both are handled here at the same
 * point because one settle path is easier to keep right than two.
 */
function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return idb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null);
        try {
          const t = db.transaction(STORE, mode);
          const req = run(t.objectStore(STORE));
          let result: T | null = null;
          // Captured, NOT resolved: a write is not durable until the transaction commits below.
          req.onsuccess = () => {
            result = (req.result ?? null) as T | null;
          };
          // Handled so a failure is not also an uncaught error event; the transaction answers.
          req.onerror = () => {};
          const settle = (value: T | null) => {
            db.close();
            resolve(value);
          };
          t.oncomplete = () => settle(result);
          t.onabort = () => settle(null);
          t.onerror = () => settle(null);
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

/**
 * The staged file WITHOUT consuming it — memory first, then the durable copy.
 *
 * Separate from `takeConvertedFile` because the SENDER needs it: the converter tab hands the bytes
 * to a library tab and must still be holding them if the visitor comes back and shares again. Same
 * staleness rule, so a file too old to attach is too old to send.
 */
export async function peekConvertedFile(): Promise<File | null> {
  if (staged) return Date.now() - staged.stagedAt > STALE_AFTER_MS ? null : staged.file;
  const rec = (await tx<{ file: Blob; name: string; type: string; stagedAt: number } | undefined>(
    "readonly",
    (st) => st.get(KEY),
  )) as { file: Blob; name: string; type: string; stagedAt: number } | null;
  if (!rec?.file) return null;
  if (Date.now() - rec.stagedAt > STALE_AFTER_MS) return null;
  return new File([rec.file], rec.name, { type: rec.type });
}

// ── THE CROSS-ORIGIN HANDOFF ────────────────────────────────────────────────────────────────────
//
// Namespaced and version-tagged. Both sides check `event.origin` before reading anything, so these
// strings are not a security boundary — they are how a message from our own other tab is told apart
// from the ordinary traffic any page's `message` event carries (extensions, embeds, dev tooling).
export const HANDOFF_READY = "bedready:handoff-ready/1";
export const HANDOFF_FILE = "bedready:handoff-file/1";

/**
 * How long each side waits. Long enough for a cold document on a slow connection to parse, hydrate
 * and run an effect; short enough that a tab the visitor abandoned is not still listening minutes
 * later. Nothing is lost when it expires — the form is simply the empty one it would have been.
 */
export const HANDOFF_TIMEOUT_MS = 15_000;

/** A filename that cannot escape a directory or smuggle control characters into a notice. */
function safeHandoffName(name: unknown): string {
  const raw = typeof name === "string" ? name : "";
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, "").replace(/[\\/]/g, "-").trim();
  return cleaned.slice(0, 120) || "converted.3mf";
}

/**
 * SENDER. Open the library in a new tab and hand it the staged file.
 *
 * Must be called synchronously from a click: `window.open` outside a user gesture is blocked, and
 * reading the file first would spend the gesture on an `await`. So the tab is opened immediately and
 * the file is resolved afterwards, which the receiver-first handshake makes safe — nothing is sent
 * until the other side asks.
 *
 * Returns the window, or `null` when the popup was blocked. A null return means the caller must let
 * the click navigate normally: an ordinary same-tab trip to an empty form, which is what happened
 * before any of this existed.
 *
 * The opener is deliberately NOT severed. `noopener` would make the channel impossible, and the
 * usual reason for it — reverse tabnabbing — is about handing an opener to a site you do not
 * control. This one is ours, named exactly, and it is the only origin either side will talk to.
 */
export function openLibraryWithHandoff(url: string, libraryOrigin: string): Window | null {
  if (typeof window === "undefined") return null;
  const w = window.open(url, "_blank");
  if (!w) return null;

  const onMessage = (e: MessageEvent) => {
    if (e.origin !== libraryOrigin) return;
    if ((e.data as { type?: string } | null)?.type !== HANDOFF_READY) return;
    stop();
    void (async () => {
      const file = await peekConvertedFile();
      if (!file) return; // nothing staged — the tab is open on an empty form, as before
      try {
        w.postMessage({ type: HANDOFF_FILE, name: file.name, mime: file.type, file }, libraryOrigin);
      } catch {
        /* tab closed between asking and answering */
      }
    })();
  };
  const timer = setTimeout(stop, HANDOFF_TIMEOUT_MS);
  function stop() {
    window.removeEventListener("message", onMessage);
    clearTimeout(timer);
  }
  window.addEventListener("message", onMessage);
  return w;
}

/**
 * RECEIVER. Ask whoever opened this tab whether they are holding a converted file.
 *
 * Speaks first, because postMessage has no queue — see the handshake note in the header. Returns a
 * cleanup function for the caller's effect.
 *
 * `window.opener` is present on any tab opened from anywhere, so the request goes out addressed to
 * the converter's origin alone: a different opener never receives it, and a reply from anywhere else
 * is dropped on the `e.origin` check.
 */
export function receiveHandoffFromOpener(converterOrigin: string, onFile: (file: File) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const opener = window.opener as Window | null;
  if (!opener) return () => {};

  const onMessage = (e: MessageEvent) => {
    if (e.origin !== converterOrigin) return;
    const data = e.data as { type?: string; name?: unknown; mime?: unknown; file?: unknown } | null;
    if (!data || data.type !== HANDOFF_FILE) return;
    const blob = data.file;
    // Structured clone rebuilds the File in THIS realm, so this is a real instance check and not a
    // duck-type. Anything else is ignored rather than coerced.
    if (!(blob instanceof Blob)) return;
    stop();
    const name = safeHandoffName(blob instanceof File ? blob.name : data.name);
    const type = typeof data.mime === "string" ? data.mime : blob.type;
    // Re-wrapped even when it already is a File: the name is the one thing that reaches a notice and
    // a form, and it arrived from another document. Blob parts are referenced, not copied.
    onFile(new File([blob], name, { type }));
  };

  window.addEventListener("message", onMessage);
  try {
    opener.postMessage({ type: HANDOFF_READY }, converterOrigin);
  } catch {
    /* opener severed — nothing to ask */
  }
  const timer = setTimeout(stop, HANDOFF_TIMEOUT_MS);
  function stop() {
    window.removeEventListener("message", onMessage);
    clearTimeout(timer);
  }
  return stop;
}

/** Discard without consuming — for a caller that navigates away from the flow. */
export function clearConvertedFile() {
  staged = null;
  void tx("readwrite", (s) => s.delete(KEY));
}

/** Exposed for tests: the staleness window both layers share. */
export const HANDOFF_STALE_AFTER_MS = STALE_AFTER_MS;
