/**
 * Remember which channel brought someone here, so outcomes can be attributed to it.
 *
 * ── THE GAP THIS FILLS ───────────────────────────────────────────────────────────────────────────
 *
 * 1,373 conversions, and the site knows nothing about any of them but the count. The `conversions`
 * table has four rows, all from July, because it is only written by the OPTIONAL server converter;
 * the in-browser converter — which is essentially all of them — POSTs to a counter that stores a
 * single integer.
 *
 * ROADMAP §Status lists this as unknown and worth finding out: *"where those conversions came from
 * (no referrer data is reachable)"*. Distribution is the one item on that list that is not
 * engineering, and it is also the one nobody can steer, because there is no signal telling you which
 * channel is working.
 *
 * ── WHY NOT JUST READ VERCEL'S REFERRER REPORT ───────────────────────────────────────────────────
 *
 * Vercel Web Analytics does report referrers for PAGE VIEWS, and that already answers "where does
 * traffic land". It cannot answer the question that decides where to spend effort: which channel
 * produced a conversion, an upload, a contributor. A custom event records the page it fired on, not
 * the referrer of the visit that led to it — by the time someone converts, they are on /convert and
 * the referrer is bedready.io or nothing at all.
 *
 * So this captures the source ONCE, on arrival, and hands it back later to be attached to the events
 * that matter. It is the join Vercel cannot make, and nothing else about their reporting is
 * duplicated here.
 *
 * ── WHAT IS AND IS NOT KEPT ──────────────────────────────────────────────────────────────────────
 *
 * The referrer HOST, never the full URL. A path can be private — a link posted in a closed Discord,
 * a company wiki, someone's password-protected forum thread — and the host is the whole of what
 * "which channel" means. utm_* values are kept as given, because they exist for exactly this and are
 * chosen by whoever posted the link.
 *
 * No identifier of any kind is generated or stored. There is nothing here that distinguishes one
 * visitor from another, so this cannot follow anybody anywhere. It is a channel label attached to
 * events that already exist.
 *
 * FIRST touch wins and is kept for 30 days: someone who arrives from Reddit, comes back a week later
 * by typing the address, and only then uploads, was brought here by Reddit. Last-touch would credit
 * that upload to "direct" and quietly make every channel look worthless.
 */

const KEY = "bedready:acq";
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type Acquisition = {
  /** utm_source when given, else the referring host, else "direct". */
  src: string;
  medium: string | null;
  campaign: string | null;
  /** The path they landed on — which page is doing the work. */
  landing: string;
  at: number;
};

/** Flattened for analytics properties, which take scalars only. */
export type AcquisitionProps = {
  src: string;
  medium?: string;
  campaign?: string;
  landing?: string;
};

function read(): Acquisition | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const a = JSON.parse(raw) as Acquisition;
    if (!a?.src || typeof a.at !== "number") return null;
    if (Date.now() - a.at > TTL_MS) return null;
    return a;
  } catch {
    return null;
  }
}

/** Host of a referrer, or null when it is missing, unparseable, or this same site. */
export function referrerHost(referrer: string, selfHost: string): string | null {
  if (!referrer) return null;
  try {
    const h = new URL(referrer).hostname.toLowerCase().replace(/^www\./, "");
    if (!h) return null;
    // An internal referrer is not a channel. Without this, the second page of every visit would
    // overwrite the real source with "bedready.io" and every arrival would look direct.
    if (h === selfHost.toLowerCase().replace(/^www\./, "")) return null;
    return h;
  } catch {
    return null;
  }
}

/**
 * Work out the source for this arrival. Exported for tests — the browser wrapper is `capture()`.
 * utm_source wins over the referrer, because it is deliberate and the referrer is incidental.
 */
export function deriveAcquisition(
  params: URLSearchParams,
  referrer: string,
  selfHost: string,
  path: string,
  now: number,
): Acquisition {
  const utm = (k: string) => {
    const v = params.get(k);
    // Bounded: these end up as analytics labels, and an unbounded query value would make a mess of
    // the reports without telling anyone anything.
    return v ? v.trim().slice(0, 40) || null : null;
  };
  const host = referrerHost(referrer, selfHost);
  return {
    src: utm("utm_source") ?? host ?? "direct",
    medium: utm("utm_medium"),
    campaign: utm("utm_campaign"),
    landing: path.slice(0, 120),
    at: now,
  };
}

/**
 * Record the source on first arrival. Safe to call on every page view — it only writes when nothing
 * live is stored, which is what makes it first-touch.
 */
export function captureAcquisition(): void {
  if (typeof window === "undefined") return;
  try {
    if (read()) return;
    const a = deriveAcquisition(
      new URLSearchParams(window.location.search),
      document.referrer,
      window.location.hostname,
      window.location.pathname,
      Date.now(),
    );
    // A direct arrival is still worth storing: it stops a later internal navigation being mistaken
    // for a first touch, and "direct" is a real answer that should not be inferred from absence.
    localStorage.setItem(KEY, JSON.stringify(a));
  } catch {
    /* private mode, disabled storage — attribution is a nice-to-have, never a blocker */
  }
}

/** Properties to merge into an analytics event. Empty object when nothing is known. */
export function acquisitionProps(): AcquisitionProps | Record<string, never> {
  const a = read();
  if (!a) return {};
  const out: AcquisitionProps = { src: a.src };
  if (a.medium) out.medium = a.medium;
  if (a.campaign) out.campaign = a.campaign;
  if (a.landing) out.landing = a.landing;
  return out;
}
