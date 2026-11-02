/**
 * What both share cards (next/og) need to draw any locale: the bundled fonts, and a line of text
 * laid out from lib/card-text.ts so Arabic is shaped and reads right to left.
 *
 * The fonts are Noto Sans (Latin, 400 + 800) and Noto Sans Arabic (400 + 800) with its substitution
 * tables stripped — see card-text.ts for why. Passing `fonts` replaces next/og's built-in Noto Sans,
 * so Latin is bundled here too (and the cards' 800 weight is real bold now, not the regular face).
 * Japanese and Chinese still come from next/og's on-demand Google Fonts fallback, as before.
 *
 * Each path is a literal so file tracing can see it; next.config.mjs also pins the folder for both
 * opengraph-image routes.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CSSProperties } from "react";
import { cardText, type CardDir } from "./card-text";

type Weight = 400 | 800;
type Font = { name: string; data: Buffer; weight: Weight; style: "normal" };

let fontsPromise: Promise<Font[]> | null = null;

export function cardFonts(): Promise<Font[]> {
  fontsPromise ??= Promise.all([
    readFile(join(process.cwd(), "src/assets/og-fonts/NotoSans-400.ttf")),
    readFile(join(process.cwd(), "src/assets/og-fonts/NotoSans-800.ttf")),
    readFile(join(process.cwd(), "src/assets/og-fonts/NotoSansArabic-400.ttf")),
    readFile(join(process.cwd(), "src/assets/og-fonts/NotoSansArabic-800.ttf")),
  ]).then(([l4, l8, a4, a8]) => [
    { name: "Noto Sans", data: l4, weight: 400, style: "normal" },
    { name: "Noto Sans", data: l8, weight: 800, style: "normal" },
    { name: "Noto Sans Arabic", data: a4, weight: 400, style: "normal" },
    { name: "Noto Sans Arabic", data: a8, weight: 800, style: "normal" },
  ]);
  // A failed read must not be cached for the life of the instance.
  fontsPromise.catch(() => {
    fontsPromise = null;
  });
  return fontsPromise;
}

export const CARD_FONT_FAMILY = '"Noto Sans", "Noto Sans Arabic"';

/**
 * One line (or wrapped paragraph) of card text. `dir` is the paragraph direction — the locale's for
 * the card's own words, or left out to follow the text (a design title). Words are separate flex
 * items so satori can wrap between them; a right-to-left paragraph fills from the right.
 */
export function CardLine({ text, dir, style }: { text: string; dir?: CardDir; style?: CSSProperties }) {
  const t = cardText(text, dir);
  const gap = typeof style?.fontSize === "number" ? Math.round(style.fontSize * 0.26) : 8;
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        flexDirection: t.dir === "rtl" ? "row-reverse" : "row",
        columnGap: gap,
        ...style,
        // Spacing out letters pulls joined Arabic apart.
        ...(t.dir === "rtl" ? { letterSpacing: 0, textTransform: "none" } : null),
      }}
    >
      {t.chunks.length === 1 ? t.chunks[0] : t.chunks.map((c, i) => <span key={i}>{c}</span>)}
    </div>
  );
}
