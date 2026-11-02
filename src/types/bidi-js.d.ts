// bidi-js ships no types. Only what src/lib/card-text.ts uses is declared.
declare module "bidi-js" {
  interface EmbeddingLevels {
    levels: Uint8Array;
    paragraphs: { start: number; end: number; level: number }[];
  }
  interface Bidi {
    getEmbeddingLevels(text: string, direction?: "ltr" | "rtl" | "auto"): EmbeddingLevels;
    getReorderedString(text: string, levels: EmbeddingLevels, start?: number, end?: number): string;
    getBidiCharTypeName(char: string): string;
  }
  export default function bidiFactory(): Bidi;
}
