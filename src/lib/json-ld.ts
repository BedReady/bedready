/**
 * Serialise JSON-LD for embedding in a raw-text `<script>`.
 *
 * ── WHY THIS CANNOT BE `JSON.stringify` ──────────────────────────────────────────────────────────
 *
 * `<script type="application/ld+json">` is a raw-text element: the browser reads it verbatim until
 * it meets `</script`. JSON.stringify does not escape `<`, `>` or `&`, so any string in the object
 * containing `</script>` closes the block early and everything after it is parsed as HTML. With a
 * user-controlled value in there — a design title, a maker's display name — that is stored XSS.
 *
 * Escaping the three characters as `\uXXXX` keeps the JSON byte-for-byte valid (JSON parsers decode
 * the escapes) while making the breakout impossible to express.
 *
 * ── WHY IT LIVES HERE, AND WHY A TEST ENFORCES IT ────────────────────────────────────────────────
 *
 * On 2026-08-12 an audit of every `dangerouslySetInnerHTML` in the app found **21 sinks, of which 15
 * passed raw `JSON.stringify`**. Nothing was exploitable: the two blocks carrying user-controlled
 * data — the design page and /verified — were among the six that did escape. The other fifteen were
 * safe because their data happened to be static.
 *
 * That is not a property anyone can rely on. The escaping had been written THREE separate times — two
 * copies of a local `ldJson` helper in different files and one inline chain in /verified — so the
 * rule existed in the codebase without existing anywhere a new page would inherit it. The next
 * JSON-LD block to include a title from the database would have been unescaped by default.
 *
 * ── AND THE CSP DOES NOT COVER FOR IT ────────────────────────────────────────────────────────────
 *
 * `next.config.mjs` keeps `script-src 'unsafe-inline'` deliberately, because nonces would force every
 * page dynamic and break the ISR the site depends on. That trade-off is reasonable, and it is written
 * down — but its stated justification is *"the stored-XSS sinks are escaped"*. This module is what
 * makes that sentence true rather than aspirational.
 */

/**
 * JSON for a `<script type="application/ld+json">` body, safe against `</script>` breakout.
 *
 * Use this for EVERY JSON-LD block, including ones whose data is static today — `json-ld.test.mts`
 * asserts that, and the point is that "static today" is not a property of the code.
 */
export function ldJson(obj: unknown): string {
  return JSON.stringify(obj)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}
