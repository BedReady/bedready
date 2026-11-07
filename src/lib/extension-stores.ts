/**
 * Where each browser gets the BedReady extension, and which browsers it can honestly be said to
 * run in.
 *
 * ── WHY THIS IS A MODULE, NOT THREE CONSTANTS IN THE PAGE ───────────────────────────────────────
 *
 * The Safari listing is not live, yet four pieces of copy in seven languages said "Available for
 * Chrome, Edge, Firefox, and Safari" (Nov 2026 review). The copy and the URL were two separate facts
 * that nobody kept in step. Now the copy that names browsers takes an ICU `select` on `safari`, and
 * that argument comes from here, so setting SAFARI_APPSTORE_URL changes the wording everywhere at
 * once and leaving it empty cannot claim Safari.
 */
export const CHROME_WEBSTORE_URL =
  "https://chromewebstore.google.com/detail/bedready-%E2%80%94-3mf-%E2%86%92-snapmake/empadffogehgmbleajehbplobfajddnh";
export const FIREFOX_AMO_URL = "https://addons.mozilla.org/firefox/addon/bedready-3mf-snapmaker-u1/"; // live on AMO
export const SAFARI_APPSTORE_URL = ""; // set once approved on the Mac App Store

export const SAFARI_LIVE = SAFARI_APPSTORE_URL !== "";

/** The ICU argument every browser-naming message takes: `{safari, select, live {…} other {…}}`. */
export const safariArg: { safari: "live" | "soon" } = { safari: SAFARI_LIVE ? "live" : "soon" };

/** Which install the hero's primary button offers. "other" means "show me every browser". */
export type InstallTarget = "chrome" | "edge" | "firefox" | "safari" | "other";

/**
 * The install that fits this browser, from its user-agent string.
 *
 * Phones and tablets get "other": no store on them installs this extension, and the page says so.
 * Edge is checked before Chrome because Edge's UA also contains "Chrome/". Other Chromium browsers
 * (Brave, Opera, Vivaldi) install from the Chrome Web Store, so they count as Chrome. Safari gets
 * its own target only once the App Store listing is live.
 */
export function installTargetFor(ua: string): InstallTarget {
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return "other";
  if (/Firefox\//.test(ua)) return "firefox";
  if (/Edg\//.test(ua)) return "edge";
  if (/Chrome\/|Chromium\//.test(ua)) return "chrome";
  if (/Safari\//.test(ua)) return SAFARI_LIVE ? "safari" : "other";
  return "other";
}
