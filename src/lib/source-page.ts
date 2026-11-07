// The model page a file came from, as the extension passes it to bedready.io/convert (`src=`), so the
// done screen can look up a verified MakerRun profile for that model.
//
// Only a model page on the three sites, and only its address: the query and hash are dropped (they
// can carry tracking or session bits), except MakerWorld's `#profileId-<id>`, which names the print
// profile. Anything else — another site, a search page, http, a CDN link — gives null, and the
// caller leaves `src` out. This is the one gate every `src` goes through.

const MODEL_PATH: { hosts: RegExp; path: RegExp; keepProfileHash?: boolean }[] = [
  // makerworld.com/en/models/1092486-benchy, makerworld.com.cn/zh/models/123
  { hosts: /^makerworld\.com(\.cn)?$/, path: /^\/(?:[a-z]{2}(?:-[a-z]{2,4})?\/)?models\/\d+(?:[-\w%.]*)?(?:\/[-\w%.]*)*\/?$/i, keepProfileHash: true },
  // www.printables.com/model/123456-benchy (optionally /files, /comments…), with or without a locale
  { hosts: /^(www\.)?printables\.com$/, path: /^\/(?:[a-z]{2}\/)?model\/\d+(?:[-\w%.]*)?(?:\/[-\w%.]*)*\/?$/i },
  // www.thingiverse.com/thing:123456 (optionally /files)
  { hosts: /^(www\.)?thingiverse\.com$/, path: /^\/thing:\d+(?:\/[-\w%.]*)*\/?$/i },
];

/** The cleaned model-page URL, or null when `raw` is not a model page on one of the three sites. */
export function sourcePage(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string" || raw.length > 2048) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  const rule = MODEL_PATH.find((r) => r.hosts.test(u.hostname));
  if (!rule || !rule.path.test(u.pathname)) return null;
  const profile = rule.keepProfileHash ? /^#profileId-\d+$/.exec(u.hash)?.[0] ?? "" : "";
  return `https://${u.hostname}${u.pathname}${profile}`;
}
