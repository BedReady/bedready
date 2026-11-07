/**
 * What left this page: a live record of every network request /convert makes after it loads.
 *
 * ── WHY ──────────────────────────────────────────────────────────────────────────────────────────
 *
 * The converter's claim is that your file stays on the page. A sentence saying so is the weakest
 * form of that claim; the source link is stronger; this is the strongest one that fits on the page
 * itself — the visitor watches the requests go out and reads their sizes. "File bytes sent: 0" is
 * then a measurement, not a promise.
 *
 * ── HOW IT SEES REQUESTS ────────────────────────────────────────────────────────────────────────
 *
 * Three sources, because no single one sees everything with a body size:
 *
 *   · `window.fetch`, `navigator.sendBeacon` and `XMLHttpRequest#send` are wrapped. They record
 *     method, address and request-body size, then call the original with the same `this` and the
 *     same arguments and return its result untouched. The wrappers never read a body in a way that
 *     consumes it: a `ReadableStream` body is recorded as "size unknown" rather than teed, and a
 *     `Request` object is measured from a CLONE.
 *   · A `PerformanceObserver` for "resource" entries catches what the page downloads without those
 *     calls — scripts, styles, fonts, images, worker code. Those carry no request body. Entries whose
 *     initiator is fetch/beacon/XHR are skipped; the wrappers already have them, with sizes.
 *
 * What it cannot see, said plainly so the panel never overclaims: requests made from inside a Web
 * Worker or a cross-origin iframe. The converter's workers make none (they receive bytes by
 * postMessage), and the only iframe is the spam check on the email box.
 *
 * The address is recorded as origin + path. The query string is dropped so a token in it is never
 * put on screen; the one thing taken from it is whether it is Next.js's `_rsc` page-data marker.
 */

/** A request body larger than this is counted as file bytes. Every request the converter makes on
 *  its own carries a body far smaller (the counter carries none; an analytics event is ~100 B). */
export const FILE_BYTES_THRESHOLD = 4096;

export type EgressVia = "fetch" | "sendBeacon" | "xhr" | "resource";

/** What a request is, as far as this page knows. Each has a plain-language line in the panel. */
export type EgressKind =
  | "counter"
  | "counterRead"
  | "analytics"
  | "sponsor"
  | "verified"
  | "serverFallback"
  | "report"
  | "waitlist"
  | "pageData"
  | "pageCode"
  | "image"
  | "other";

/** Kinds that only exist because the visitor pressed a button that says it sends their file. */
export const CHOSEN_UPLOAD_KINDS: readonly EgressKind[] = ["serverFallback", "report"];

export type EgressEntry = {
  id: number;
  method: string;
  /** origin + pathname, never the query string. */
  url: string;
  origin: string;
  path: string;
  /** Request body bytes; null when the body is a stream whose size cannot be known without reading it. */
  bodyBytes: number | null;
  via: EgressVia;
  kind: EgressKind;
  /** ms since the time origin, for ordering. */
  at: number;
};

// ── Pure helpers (unit-tested) ───────────────────────────────────────────────────────────────────

const utf8 = (s: string): number => {
  // TextEncoder exists in every browser and in Node; the fallback keeps this pure if it does not.
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s).byteLength;
  return s.length;
};

/**
 * The size of a request body in bytes, measured without consuming it. `0` for no body; `null` for a
 * stream (reading it would change the request). FormData is the sum of its parts — field values as
 * UTF-8 and files by size — without the multipart envelope, which is boundary text, not content.
 */
export function bodySize(body: unknown): number | null {
  if (body == null) return 0;
  if (typeof body === "string") return utf8(body);
  if (typeof Blob !== "undefined" && body instanceof Blob) return body.size;
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) return utf8(body.toString());
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    let n = 0;
    for (const [k, v] of body.entries()) {
      n += utf8(k);
      n += typeof v === "string" ? utf8(v) : (v as Blob).size;
    }
    return n;
  }
  if (typeof ReadableStream !== "undefined" && body instanceof ReadableStream) return null;
  // A Document (XHR) or anything else: its string form is what goes on the wire.
  try {
    return utf8(String(body));
  } catch {
    return null;
  }
}

/** origin + path of an address, resolved against `base`, with the query and fragment dropped.
 *  `null` for addresses that never reach the network (blob:, data:, about:). */
export function describeUrl(
  input: string,
  base: string,
): { origin: string; path: string; url: string; rsc: boolean } | null {
  let u: URL;
  try {
    u = new URL(input, base);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  return { origin: u.origin, path: u.pathname, url: u.origin + u.pathname, rsc: u.searchParams.has("_rsc") };
}

/** Which known request this is. Paths match `convert-api.ts`, whose list is the whole of what the
 *  converter is allowed to ask a server for. */
export function classify(
  path: string,
  opts: { method?: string; rsc?: boolean; initiator?: string } = {},
): EgressKind {
  if (path === "/api/convert-count") return opts.method === "GET" ? "counterRead" : "counter";
  // The analytics script itself is a download like any other page code; its events are not.
  if (path.startsWith("/_vercel/insights") && !/\.js$/.test(path)) return "analytics";
  if (path === "/api/v1/sponsor") return "sponsor";
  if (path === "/api/v1/designs") return "verified";
  if (path === "/api/convert") return "serverFallback";
  if (path === "/api/report-conversion") return "report";
  if (path === "/api/waitlist") return "waitlist";
  if (opts.rsc) return "pageData";
  if (opts.initiator === "img" || opts.initiator === "css-image" || /\.(png|jpe?g|webp|avif|gif|svg|ico)$/i.test(path)) {
    return "image";
  }
  if (path.startsWith("/_next/") || /\.(m?js|css|woff2?|wasm|json)$/i.test(path)) return "pageCode";
  return "other";
}

/** The panel's headline figure: bytes in requests whose body crossed the threshold. */
export function summarize(entries: readonly EgressEntry[]): {
  fileBytes: number;
  chosen: EgressEntry[];
  unexpected: EgressEntry[];
  unknownBodies: number;
} {
  const big = entries.filter((e) => (e.bodyBytes ?? 0) > FILE_BYTES_THRESHOLD);
  return {
    fileBytes: big.reduce((n, e) => n + (e.bodyBytes ?? 0), 0),
    chosen: big.filter((e) => CHOSEN_UPLOAD_KINDS.includes(e.kind)),
    unexpected: big.filter((e) => !CHOSEN_UPLOAD_KINDS.includes(e.kind)),
    unknownBodies: entries.filter((e) => e.bodyBytes === null).length,
  };
}

// ── The store ────────────────────────────────────────────────────────────────────────────────────

/** Enough for a long session; past it the oldest go, so a page left open cannot grow without bound. */
const MAX_ENTRIES = 500;

let entries: readonly EgressEntry[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

export function getEntries(): readonly EgressEntry[] {
  return entries;
}
const EMPTY: readonly EgressEntry[] = [];
export function getServerEntries(): readonly EgressEntry[] {
  return EMPTY;
}
export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function push(e: Omit<EgressEntry, "id" | "at">): EgressEntry {
  const entry: EgressEntry = { ...e, id: nextId++, at: typeof performance !== "undefined" ? performance.now() : 0 };
  const next = entries.length >= MAX_ENTRIES ? entries.slice(1) : entries.slice();
  next.push(entry);
  entries = next;
  for (const fn of listeners) fn();
  return entry;
}

function setSize(id: number, bodyBytes: number | null) {
  entries = entries.map((e) => (e.id === id ? { ...e, bodyBytes } : e));
  for (const fn of listeners) fn();
}

function record(method: string, rawUrl: string, bodyBytes: number | null, via: EgressVia, initiator?: string) {
  const d = describeUrl(rawUrl, location.href);
  if (!d) return null;
  return push({
    method: method.toUpperCase(),
    url: d.url,
    origin: d.origin,
    path: d.path,
    bodyBytes,
    via,
    kind: classify(d.path, { method: method.toUpperCase(), rsc: d.rsc, initiator }),
  });
}

// ── Installing the recorders ─────────────────────────────────────────────────────────────────────

type Installed = {
  fetch: typeof fetch;
  beacon: Navigator["sendBeacon"] | undefined;
  beaconOwn: boolean;
  xhrOpen: XMLHttpRequest["open"];
  xhrSend: XMLHttpRequest["send"];
  wrappedOpen: XMLHttpRequest["open"];
  wrappedSend: XMLHttpRequest["send"];
  observer: PerformanceObserver | null;
  wrappedFetch: typeof fetch;
};
let installed: Installed | null = null;

/**
 * Starts recording. Idempotent, a no-op on the server, and every recorder is wrapped in try/catch so
 * a fault in the log can never stop a request — the original call happens regardless.
 */
export function installEgressLog(): void {
  if (typeof window === "undefined" || installed) return;

  const origFetch = window.fetch;
  const wrappedFetch = function (this: unknown, ...args: Parameters<typeof fetch>) {
    try {
      const [input, init] = args;
      if (input instanceof Request) {
        const entry = record(init?.method ?? input.method, input.url, init && "body" in init ? bodySize(init.body) : 0, "fetch");
        // A Request's body is only readable asynchronously; measure a clone so the original is untouched.
        if (entry && !(init && "body" in init) && input.body && !input.bodyUsed) {
          input
            .clone()
            .arrayBuffer()
            .then((b) => setSize(entry.id, b.byteLength))
            .catch(() => setSize(entry.id, null));
        }
      } else {
        record(init?.method ?? "GET", String(input), bodySize(init?.body), "fetch");
      }
    } catch {
      /* the log never blocks a request */
    }
    return origFetch.apply(this, args);
  } as typeof fetch;

  const nav = navigator as Navigator & { sendBeacon?: Navigator["sendBeacon"] };
  const origBeacon = nav.sendBeacon;
  const beaconOwn = Object.prototype.hasOwnProperty.call(nav, "sendBeacon");
  if (origBeacon) {
    nav.sendBeacon = function (url: string | URL, data?: BodyInit | null) {
      try {
        record("POST", String(url), bodySize(data), "sendBeacon");
      } catch {
        /* see above */
      }
      // eslint-disable-next-line prefer-rest-params
      return origBeacon.apply(nav, arguments as unknown as [string | URL, BodyInit | null | undefined]);
    };
  }

  const xhrMeta = new WeakMap<XMLHttpRequest, { method: string; url: string }>();
  const XP = XMLHttpRequest.prototype;
  const origOpen = XP.open;
  const origSend = XP.send;
  XP.open = function (this: XMLHttpRequest, method: string, url: string | URL) {
    try {
      xhrMeta.set(this, { method, url: String(url) });
    } catch {
      /* see above */
    }
    // eslint-disable-next-line prefer-rest-params
    return (origOpen as (...a: unknown[]) => void).apply(this, arguments as unknown as unknown[]);
  } as XMLHttpRequest["open"];
  XP.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    try {
      const m = xhrMeta.get(this);
      if (m) record(m.method, m.url, bodySize(body), "xhr");
    } catch {
      /* see above */
    }
    // eslint-disable-next-line prefer-rest-params
    return (origSend as (...a: unknown[]) => void).apply(this, arguments as unknown as unknown[]);
  } as XMLHttpRequest["send"];

  let observer: PerformanceObserver | null = null;
  try {
    observer = new PerformanceObserver((list) => {
      for (const e of list.getEntries() as PerformanceResourceTiming[]) {
        // These three are already recorded above, with a body size the timing entry does not have.
        if (e.initiatorType === "fetch" || e.initiatorType === "beacon" || e.initiatorType === "xmlhttprequest") continue;
        try {
          record("GET", e.name, 0, "resource", e.initiatorType);
        } catch {
          /* see above */
        }
      }
    });
    observer.observe({ type: "resource" });
  } catch {
    observer = null;
  }

  window.fetch = wrappedFetch;
  installed = {
    fetch: origFetch,
    beacon: origBeacon,
    beaconOwn,
    xhrOpen: origOpen,
    xhrSend: origSend,
    wrappedOpen: XP.open,
    wrappedSend: XP.send,
    observer,
    wrappedFetch,
  };
}

/** Stops recording and puts the originals back, unless something else has wrapped them since —
 *  in which case unwrapping would remove that wrapper too, so ours stays (it is transparent). */
export function uninstallEgressLog(): void {
  if (typeof window === "undefined" || !installed) return;
  const i = installed;
  if (window.fetch === i.wrappedFetch) window.fetch = i.fetch;
  const nav = navigator as Navigator & { sendBeacon?: Navigator["sendBeacon"] };
  if (i.beacon) {
    if (i.beaconOwn) nav.sendBeacon = i.beacon;
    else delete (nav as { sendBeacon?: unknown }).sendBeacon;
  }
  const XP = XMLHttpRequest.prototype;
  if (XP.open === i.wrappedOpen) XP.open = i.xhrOpen;
  if (XP.send === i.wrappedSend) XP.send = i.xhrSend;
  i.observer?.disconnect();
  installed = null;
  // The log describes one visit to the page; coming back starts a new one.
  entries = [];
  for (const fn of listeners) fn();
}
