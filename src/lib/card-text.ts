/**
 * Text for the share cards (next/og → satori), drawn right in Arabic.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────
 *
 * satori neither shapes nor reorders right-to-left text. Left to itself it fetched Noto Sans Arabic
 * for the Arabic glyphs and then threw on that font's contextual-substitution table ("lookupType: 5 -
 * substFormat: 3 is not yet supported"), so every Arabic card was a 500 — the /ar/ cards were drawn
 * in English to dodge it, and a design with an Arabic TITLE had no card in any locale.
 *
 * So the two jobs the renderer cannot do are done here, before it sees the text:
 *
 *   1. SHAPING. Each Arabic letter is swapped for its Unicode presentation form (isolated, final,
 *      initial or medial) from its neighbours' joining, and lam + alef becomes its ligature. The font
 *      the cards bundle (src/assets/og-fonts, Noto Sans Arabic with GSUB/GPOS removed) maps those
 *      code points directly, so no substitution table is needed and none is there to throw.
 *   2. ORDER. The text is cut into words, runs in the other direction are kept together, and each
 *      piece is put in visual order by bidi-js (the Unicode bidi algorithm, mirroring included). The
 *      card lays the pieces out with `row-reverse` + wrap for a right-to-left paragraph, so lines
 *      break and fill from the right the way Arabic reads; satori never reorders anything itself.
 *
 * Harakat (short-vowel marks) are dropped: with no GPOS they cannot be positioned, and drawn in the
 * reversed order they would sit on the wrong letter. Titles rarely carry them; the words read the same.
 *
 * The table below is generated from the Unicode decompositions of Arabic Presentation Forms-A/B
 * (`<isolated>/<final>/<initial>/<medial>`), [isolated, final, initial, medial], 0 = no such form.
 * A letter with an initial or medial form joins on both sides; one with only a final joins to the
 * letter before it; hamza joins to nothing.
 */
import bidiFactory from "bidi-js";

const FORMS: Record<number, readonly [number, number, number, number]> = {
  0x0621: [0xfe80, 0x0000, 0x0000, 0x0000],
  0x0622: [0xfe81, 0xfe82, 0x0000, 0x0000],
  0x0623: [0xfe83, 0xfe84, 0x0000, 0x0000],
  0x0624: [0xfe85, 0xfe86, 0x0000, 0x0000],
  0x0625: [0xfe87, 0xfe88, 0x0000, 0x0000],
  0x0626: [0xfe89, 0xfe8a, 0xfe8b, 0xfe8c],
  0x0627: [0xfe8d, 0xfe8e, 0x0000, 0x0000],
  0x0628: [0xfe8f, 0xfe90, 0xfe91, 0xfe92],
  0x0629: [0xfe93, 0xfe94, 0x0000, 0x0000],
  0x062a: [0xfe95, 0xfe96, 0xfe97, 0xfe98],
  0x062b: [0xfe99, 0xfe9a, 0xfe9b, 0xfe9c],
  0x062c: [0xfe9d, 0xfe9e, 0xfe9f, 0xfea0],
  0x062d: [0xfea1, 0xfea2, 0xfea3, 0xfea4],
  0x062e: [0xfea5, 0xfea6, 0xfea7, 0xfea8],
  0x062f: [0xfea9, 0xfeaa, 0x0000, 0x0000],
  0x0630: [0xfeab, 0xfeac, 0x0000, 0x0000],
  0x0631: [0xfead, 0xfeae, 0x0000, 0x0000],
  0x0632: [0xfeaf, 0xfeb0, 0x0000, 0x0000],
  0x0633: [0xfeb1, 0xfeb2, 0xfeb3, 0xfeb4],
  0x0634: [0xfeb5, 0xfeb6, 0xfeb7, 0xfeb8],
  0x0635: [0xfeb9, 0xfeba, 0xfebb, 0xfebc],
  0x0636: [0xfebd, 0xfebe, 0xfebf, 0xfec0],
  0x0637: [0xfec1, 0xfec2, 0xfec3, 0xfec4],
  0x0638: [0xfec5, 0xfec6, 0xfec7, 0xfec8],
  0x0639: [0xfec9, 0xfeca, 0xfecb, 0xfecc],
  0x063a: [0xfecd, 0xfece, 0xfecf, 0xfed0],
  0x0641: [0xfed1, 0xfed2, 0xfed3, 0xfed4],
  0x0642: [0xfed5, 0xfed6, 0xfed7, 0xfed8],
  0x0643: [0xfed9, 0xfeda, 0xfedb, 0xfedc],
  0x0644: [0xfedd, 0xfede, 0xfedf, 0xfee0],
  0x0645: [0xfee1, 0xfee2, 0xfee3, 0xfee4],
  0x0646: [0xfee5, 0xfee6, 0xfee7, 0xfee8],
  0x0647: [0xfee9, 0xfeea, 0xfeeb, 0xfeec],
  0x0648: [0xfeed, 0xfeee, 0x0000, 0x0000],
  0x0649: [0xfeef, 0xfef0, 0xfbe8, 0xfbe9],
  0x064a: [0xfef1, 0xfef2, 0xfef3, 0xfef4],
  0x0671: [0xfb50, 0xfb51, 0x0000, 0x0000],
  0x0677: [0xfbdd, 0x0000, 0x0000, 0x0000],
  0x0679: [0xfb66, 0xfb67, 0xfb68, 0xfb69],
  0x067a: [0xfb5e, 0xfb5f, 0xfb60, 0xfb61],
  0x067b: [0xfb52, 0xfb53, 0xfb54, 0xfb55],
  0x067e: [0xfb56, 0xfb57, 0xfb58, 0xfb59],
  0x067f: [0xfb62, 0xfb63, 0xfb64, 0xfb65],
  0x0680: [0xfb5a, 0xfb5b, 0xfb5c, 0xfb5d],
  0x0683: [0xfb76, 0xfb77, 0xfb78, 0xfb79],
  0x0684: [0xfb72, 0xfb73, 0xfb74, 0xfb75],
  0x0686: [0xfb7a, 0xfb7b, 0xfb7c, 0xfb7d],
  0x0687: [0xfb7e, 0xfb7f, 0xfb80, 0xfb81],
  0x0688: [0xfb88, 0xfb89, 0x0000, 0x0000],
  0x068c: [0xfb84, 0xfb85, 0x0000, 0x0000],
  0x068d: [0xfb82, 0xfb83, 0x0000, 0x0000],
  0x068e: [0xfb86, 0xfb87, 0x0000, 0x0000],
  0x0691: [0xfb8c, 0xfb8d, 0x0000, 0x0000],
  0x0698: [0xfb8a, 0xfb8b, 0x0000, 0x0000],
  0x06a4: [0xfb6a, 0xfb6b, 0xfb6c, 0xfb6d],
  0x06a6: [0xfb6e, 0xfb6f, 0xfb70, 0xfb71],
  0x06a9: [0xfb8e, 0xfb8f, 0xfb90, 0xfb91],
  0x06ad: [0xfbd3, 0xfbd4, 0xfbd5, 0xfbd6],
  0x06af: [0xfb92, 0xfb93, 0xfb94, 0xfb95],
  0x06b1: [0xfb9a, 0xfb9b, 0xfb9c, 0xfb9d],
  0x06b3: [0xfb96, 0xfb97, 0xfb98, 0xfb99],
  0x06ba: [0xfb9e, 0xfb9f, 0x0000, 0x0000],
  0x06bb: [0xfba0, 0xfba1, 0xfba2, 0xfba3],
  0x06be: [0xfbaa, 0xfbab, 0xfbac, 0xfbad],
  0x06c0: [0xfba4, 0xfba5, 0x0000, 0x0000],
  0x06c1: [0xfba6, 0xfba7, 0xfba8, 0xfba9],
  0x06c5: [0xfbe0, 0xfbe1, 0x0000, 0x0000],
  0x06c6: [0xfbd9, 0xfbda, 0x0000, 0x0000],
  0x06c7: [0xfbd7, 0xfbd8, 0x0000, 0x0000],
  0x06c8: [0xfbdb, 0xfbdc, 0x0000, 0x0000],
  0x06c9: [0xfbe2, 0xfbe3, 0x0000, 0x0000],
  0x06cb: [0xfbde, 0xfbdf, 0x0000, 0x0000],
  0x06cc: [0xfbfc, 0xfbfd, 0xfbfe, 0xfbff],
  0x06d0: [0xfbe4, 0xfbe5, 0xfbe6, 0xfbe7],
  0x06d2: [0xfbae, 0xfbaf, 0x0000, 0x0000],
  0x06d3: [0xfbb0, 0xfbb1, 0x0000, 0x0000],
};
const LAM_ALEF: Record<number, readonly [number, number]> = {
  0x0622: [0xfef5, 0xfef6],
  0x0623: [0xfef7, 0xfef8],
  0x0625: [0xfef9, 0xfefa],
  0x0627: [0xfefb, 0xfefc],
};

const bidi = bidiFactory();

const ZWJ = 0x200d;
const TATWEEL = 0x0640;

/** Short vowels and Quranic marks: dropped (see the header). */
const HARAKAT = /[ً-ٰٟۖ-ۭ]/g;
const ARABIC = /[؀-ۿﭐ-﷿ﹰ-﻿]/;

type Joining = "D" | "R" | "U";

function joining(cp: number): Joining {
  if (cp === TATWEEL || cp === ZWJ) return "D";
  const f = FORMS[cp];
  if (!f) return "U";
  if (f[2] || f[3]) return "D";
  if (f[1]) return "R";
  return "U";
}

/** Presentation forms for every Arabic letter in `text`, logical order kept. */
export function shapeArabic(text: string): string {
  const cps = Array.from(text.replace(HARAKAT, ""), (c) => c.codePointAt(0)!);
  const out: number[] = [];
  for (let i = 0; i < cps.length; i++) {
    const cp = cps[i];
    const f = FORMS[cp];
    if (!f) {
      out.push(cp);
      continue;
    }
    const prev = i > 0 ? joining(cps[i - 1]) : "U";
    const joinsBefore = prev === "D"; // the letter before reaches forward to this one
    // lam + alef → one ligature glyph, isolated or final by what comes before the lam.
    if (cp === 0x0644 && i + 1 < cps.length && LAM_ALEF[cps[i + 1]]) {
      out.push(LAM_ALEF[cps[i + 1]][joinsBefore ? 1 : 0]);
      i++;
      continue;
    }
    const next = i + 1 < cps.length ? joining(cps[i + 1]) : "U";
    const joinsAfter = joining(cp) === "D" && next !== "U";
    const want = joinsBefore ? (joinsAfter ? 3 : 1) : joinsAfter ? 2 : 0;
    // A letter without the form it wants falls back to the nearest one it has.
    out.push(f[want] || f[want === 3 ? 1 : 0] || f[0] || cp);
  }
  return String.fromCodePoint(...out);
}

export type CardDir = "rtl" | "ltr";

/** The paragraph's direction from its first strong letter (Arabic → rtl), else `fallback`. */
export function firstStrongDir(text: string, fallback: CardDir = "ltr"): CardDir {
  for (const ch of text) {
    const t = bidi.getBidiCharTypeName(ch);
    if (t === "R" || t === "AL") return "rtl";
    if (t === "L") return "ltr";
  }
  return fallback;
}

/**
 * A line of card text, ready for satori: `chunks` are in LOGICAL order and each is already in
 * visual order inside, so the card lays them out with `flexDirection: dir === "rtl" ? "row-reverse"
 * : "row"` and `flexWrap: "wrap"`. Plain LTR text with no Arabic comes back as one chunk, unchanged,
 * so English, German, Japanese and Chinese cards render exactly as before.
 */
export function cardText(text: string, dir?: CardDir): { dir: CardDir; chunks: string[] } {
  const para = dir ?? firstStrongDir(text);
  if (!ARABIC.test(text) && para === "ltr") return { dir: para, chunks: [text] };
  const shaped = shapeArabic(text);
  const words = shaped.split(/\s+/).filter(Boolean);
  // Each word's own direction: rtl, ltr, or null (digits and punctuation only).
  const own = words.map((w): CardDir | null => {
    for (const ch of w) {
      const t = bidi.getBidiCharTypeName(ch);
      if (t === "R" || t === "AL") return "rtl";
      if (t === "L") return "ltr";
    }
    return null;
  });
  // A neutral word between two words of the other direction belongs to their run (UAX #9 N1).
  const resolved = own.map((d, i) => {
    if (d) return d;
    const before = own.slice(0, i).reverse().find(Boolean) ?? para;
    const after = own.slice(i + 1).find(Boolean) ?? para;
    return before === after ? before : para;
  });
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i++) {
    let run = words[i];
    // Words against the paragraph stay together as one piece, so "Snapmaker U1" keeps its order.
    if (resolved[i] !== para) {
      while (i + 1 < words.length && resolved[i + 1] !== para) run += " " + words[++i];
    }
    const levels = bidi.getEmbeddingLevels(run, para);
    chunks.push(bidi.getReorderedString(run, levels));
  }
  return { dir: para, chunks };
}
