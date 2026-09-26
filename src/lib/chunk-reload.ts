// A tab opened before a deploy asks for a JS chunk the new deploy no longer serves. The error
// boundary's "Try again" re-renders into the same missing file, so it can never recover — only a full
// reload, which fetches the new build's chunk map, can. This is the only error in production logs
// (`ChunkLoadError: Loading chunk 1567 failed`, on bedready.io and makerrun.com alike).
//
// Vercel's Skew Protection solves this at the platform, but it is not on the Hobby plan, so the
// boundary does it: reload ONCE per URL. The guard matters as much as the reload — if the chunk is
// genuinely broken rather than stale, an unguarded reload loops forever. A second failure inside the
// window falls through to the normal error page.

const KEY = "chunk-reload-at";
const WINDOW_MS = 10_000;

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

export function isChunkLoadError(error: { name?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return (
    error.name === "ChunkLoadError" ||
    /Loading (CSS )?chunk [\w-]+ failed/i.test(error.message ?? "") ||
    // Safari and Firefox word a failed dynamic import differently from webpack's own message.
    /Failed to fetch dynamically imported module|error loading dynamically imported module/i.test(error.message ?? "")
  );
}

/**
 * Whether to reload for this error, recording the attempt so a second failure does not reload again.
 * Pure over its inputs so it can be tested without a browser; `reloadOnceForChunkError` wires it up.
 */
export function shouldReload(
  error: { name?: string; message?: string } | null | undefined,
  url: string,
  storage: Storage | null,
  now: number,
): boolean {
  if (!isChunkLoadError(error) || !storage) return false;
  try {
    const last = JSON.parse(storage.getItem(KEY) ?? "null") as { url: string; at: number } | null;
    if (last && last.url === url && now - last.at < WINDOW_MS) return false;
    storage.setItem(KEY, JSON.stringify({ url, at: now }));
    return true;
  } catch {
    // Storage blocked or full: reloading without a guard risks a loop, so do not.
    return false;
  }
}

/** Reloads the page and returns true for a stale-chunk error seen for the first time; false otherwise. */
export function reloadOnceForChunkError(error: { name?: string; message?: string }): boolean {
  let storage: Storage | null = null;
  try {
    storage = window.sessionStorage;
  } catch {
    storage = null;
  }
  if (!shouldReload(error, location.href, storage, Date.now())) return false;
  location.reload();
  return true;
}
