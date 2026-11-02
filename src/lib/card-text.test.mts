import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cardText, shapeArabic, firstStrongDir } from "./card-text.ts";

const hex = (s: string) => Array.from(s, (c) => c.codePointAt(0)!.toString(16)).join(" ");

test("letters take their joined forms: سلام", () => {
  // س initial, ل+ا → lam-alef final ligature, م isolated (alef does not join forward).
  assert.equal(hex(shapeArabic("سلام")), "feb3 fefc fee1");
});

test("a right-joining letter breaks the word: دار", () => {
  // د, ا and ر join only to the letter before them, so none of the three is joined: all isolated.
  assert.equal(hex(shapeArabic("دار")), "fea9 fe8d fead");
});

test("medial forms in a run of dual joiners: بيت", () => {
  assert.equal(hex(shapeArabic("بيت")), "fe91 fef4 fe96");
});

test("harakat are dropped, Latin is untouched", () => {
  assert.equal(shapeArabic("الرِّزن"), shapeArabic("الرزن"));
  assert.equal(shapeArabic("Snapmaker U1"), "Snapmaker U1");
});

test("an Arabic paragraph is rtl; words reversed inside, Latin runs kept whole", () => {
  const { dir, chunks } = cardText("جاهز لـ Snapmaker U1");
  assert.equal(dir, "rtl");
  assert.equal(chunks.length, 3);
  assert.equal(chunks[2], "Snapmaker U1");
  // جاهز: ج initial, ا final, ه initial (alef never reaches forward), ز final; reversed for drawing.
  assert.equal(hex(chunks[0]), "feb0 feeb fe8e fe9f");
});

test("a word mixing scripts reads right: وCNC", () => {
  const { chunks } = cardText("الليزر وCNC");
  assert.equal(chunks[1].startsWith("CNC"), true);
});

test("plain LTR text is one chunk, unchanged", () => {
  assert.deepEqual(cardText("Ready for the Snapmaker U1"), { dir: "ltr", chunks: ["Ready for the Snapmaker U1"] });
  assert.deepEqual(cardText("スナップメーカー U1"), { dir: "ltr", chunks: ["スナップメーカー U1"] });
});

test("an English title with an Arabic word keeps ltr and shapes the word", () => {
  const { dir, chunks } = cardText("Logo سلام v2");
  assert.equal(dir, "ltr");
  assert.equal(chunks[0], "Logo");
  assert.equal(hex(chunks[1]), "fee1 fefc feb3");
});

test("firstStrongDir", () => {
  assert.equal(firstStrongDir("123 سلام"), "rtl");
  assert.equal(firstStrongDir("123"), "ltr");
  assert.equal(firstStrongDir("123", "rtl"), "rtl");
});

test("the bundled Arabic font has a glyph for every presentation form the shaper emits", () => {
  // Read the TrueType cmap (format 4/12) of the shipped font and check every form in FORMS/LAM_ALEF.
  const src = readFileSync(new URL("./card-text.ts", import.meta.url), "utf8");
  const forms = new Set<number>();
  for (const m of src.matchAll(/0x(f[b-e][0-9a-f]{2})/g)) forms.add(parseInt(m[1], 16));
  const font = readFileSync(new URL("../assets/og-fonts/NotoSansArabic-400.ttf", import.meta.url));
  const cmap = readCmap(font);
  const missing = [...forms].filter((c) => !cmap.has(c)).map((c) => c.toString(16));
  assert.deepEqual(missing, []);
});

function readCmap(buf: Buffer): Set<number> {
  const n = buf.readUInt16BE(4);
  let off = -1;
  for (let i = 0; i < n; i++) if (buf.toString("latin1", 12 + i * 16, 16 + i * 16) === "cmap") off = buf.readUInt32BE(12 + i * 16 + 8);
  const set = new Set<number>();
  const count = buf.readUInt16BE(off + 2);
  for (let i = 0; i < count; i++) {
    const sub = off + buf.readUInt32BE(off + 4 + i * 8 + 4);
    const fmt = buf.readUInt16BE(sub);
    if (fmt === 4) {
      const segX2 = buf.readUInt16BE(sub + 6);
      const ends = sub + 14, starts = ends + segX2 + 2;
      for (let s = 0; s < segX2; s += 2) {
        const e = buf.readUInt16BE(ends + s), st = buf.readUInt16BE(starts + s);
        for (let c = st; c <= e && c !== 0xffff; c++) set.add(c);
      }
    } else if (fmt === 12) {
      const groups = buf.readUInt32BE(sub + 12);
      for (let g = 0; g < groups; g++) {
        const st = buf.readUInt32BE(sub + 16 + g * 12), e = buf.readUInt32BE(sub + 20 + g * 12);
        for (let c = st; c <= e; c++) set.add(c);
      }
    }
  }
  return set;
}
