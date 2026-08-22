/**
 * Off-site addresses the site links to by name, in one place.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────────────────────────
 *
 * The same reason `origin.ts` exists. `https://bedready.io` was written into 64 places behind seven
 * constants before it became one function; these are the same shape of literal, caught earlier. The
 * repository URL in particular is about to appear in the header, the footer, the converter's privacy
 * block and the converter comparison — four places that must never disagree about which repository
 * backs the "nothing is uploaded" claim.
 *
 * ── AND WHY THE REPOSITORY IS ON THE SITE AT ALL ────────────────────────────────────────────────
 *
 * `COMPETITIVE-2026-08.md` §3.1 ranks *"say 'nothing is uploaded' louder"* as the highest-ratio item
 * in the document and the converter's best remaining edge; `SPLIT-DECISION-2026-08.md` then calls
 * open-sourcing *"the loudest available version of that, because it is the only one a sceptic can
 * verify"*. The repository went public on 2026-08-21 and the site did not mention it — while
 * `/compare-u1-converters` linked four competitors' repositories on the same page where it claimed
 * the privacy advantage. The evidence for the claim was public, and unlinked.
 */

/** The converter's public source. The no-upload claim's evidence. */
export const SOURCE_REPO_URL = "https://github.com/BedReady/bedready";

/** Where the desktop app's builds are published. */
export const APP_RELEASES_URL = "https://github.com/KhaytApp/bedready/releases";

/** The community. */
export const REDDIT_URL = "https://www.reddit.com/r/BedReady/";

/** Funding. */
export const SPONSOR_URL = "https://github.com/sponsors/Alballaa";

/** Khayt — the print-shop app, MakerRun's official desktop client. */
export const KHAYT_URL = "https://khaytapp.com/?utm_source=bedready&utm_medium=referral";
