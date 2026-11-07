// Where a converted file came from, as a model page MakerRun can look up — or nothing.
//
// The done screen offers "Find a verified profile" instead of "Save to my library" (Nov 2026, with
// MakerRun): most converted files are somebody else's MakerWorld model, and re-uploading them is a
// licence problem. MakerRun answers GET /api/v1/designs?source=<model URL> with any verified listing
// for that exact model, and /requests/new?source=… lets a visitor ask for one.
//
// Only real model pages on the three sites MakerRun supports are accepted, and only the parts that
// identify the model are kept: never a query string (MakerWorld adds tracking), never another site.

export type ModelSource = { site: "makerworld" | "printables" | "thingiverse"; url: string };

export function parseModelSource(input: string | null | undefined): ModelSource | null {
  if (!input) return null;
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  // makerworld.com/<lang>/models/<id>[-slug] — the profile hash names the print profile; keep it.
  if (host === "makerworld.com" || host === "makerworld.com.cn") {
    const m = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?models\/(\d+)/i.exec(u.pathname);
    if (!m) return null;
    const profile = /^#profileId-\d+$/.test(u.hash) ? u.hash : "";
    return { site: "makerworld", url: `https://${host}/en/models/${m[1]}${profile}` };
  }
  if (host === "printables.com") {
    const m = /^\/(?:[a-z]{2}\/)?model\/(\d+)/i.exec(u.pathname);
    return m ? { site: "printables", url: `https://www.printables.com/model/${m[1]}` } : null;
  }
  if (host === "thingiverse.com") {
    const m = /^\/thing:(\d+)/i.exec(u.pathname);
    return m ? { site: "thingiverse", url: `https://www.thingiverse.com/thing:${m[1]}` } : null;
  }
  return null;
}

/** MakerRun's "request a verified profile" page for this model, for the given printer brand. */
export function requestProfileUrl(libraryOrigin: string, source: ModelSource, brand?: string): string {
  const q = new URLSearchParams({ source: source.url });
  if (brand) q.set("brand", brand);
  return `${libraryOrigin.replace(/\/+$/, "")}/requests/new?${q.toString()}`;
}

/** The query for the converter's designs lookup (`convertApi("/api/v1/designs")` + this). */
export function designsLookupQuery(source: ModelSource): string {
  return `?${new URLSearchParams({ source: source.url, verified: "true" }).toString()}`;
}
