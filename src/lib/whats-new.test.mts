// The /changes data (whats-new.ts). Run: `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { WHATS_NEW, WHATS_NEW_AREAS, whatsNewByDay } from "./whats-new.ts";

test("what's new: every entry has a real calendar date, a known area and some words", () => {
  for (const e of WHATS_NEW) {
    assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/, `date ${e.date} is not YYYY-MM-DD`);
    const [y, m, d] = e.date.split("-").map(Number);
    const back = new Date(Date.UTC(y, m - 1, d));
    assert.equal(back.toISOString().slice(0, 10), e.date, `${e.date} is not a day on the calendar`);
    assert.ok((WHATS_NEW_AREAS as readonly string[]).includes(e.area), `unknown area ${e.area}`);
    assert.ok(e.text.trim().length >= 20, `entry on ${e.date} is too short to say what changed`);
    assert.ok(!/[<>]/.test(e.text), "entries are plain text");
  }
});

test("what's new: newest first, so a new entry goes on top", () => {
  for (let i = 1; i < WHATS_NEW.length; i++) {
    assert.ok(WHATS_NEW[i - 1].date >= WHATS_NEW[i].date, `${WHATS_NEW[i - 1].date} is listed above the newer ${WHATS_NEW[i].date}`);
  }
});

test("what's new: no date in the future and no line twice", () => {
  // A day of slack: an entry is dated where its author is, and Riyadh is a day ahead of UTC late at night.
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  for (const e of WHATS_NEW) assert.ok(e.date <= tomorrow, `${e.date} has not happened yet`);
  const texts = WHATS_NEW.map((e) => e.text);
  assert.equal(new Set(texts).size, texts.length);
});

test("what's new: extension entries name the version the store shows", () => {
  for (const e of WHATS_NEW.filter((x) => x.area === "extension")) {
    assert.match(e.text, /\(\d+\.\d+\.\d+\)$/, `"${e.text}" should end with its version, e.g. (0.6.9)`);
  }
});

test("whatsNewByDay groups consecutive entries of one day, keeping their order", () => {
  const days = whatsNewByDay([
    { date: "2026-11-26", area: "converter", text: "a".repeat(20) },
    { date: "2026-11-26", area: "extension", text: "b".repeat(20) },
    { date: "2026-11-20", area: "image", text: "c".repeat(20) },
  ]);
  assert.deepEqual(days.map((d) => [d.date, d.entries.length]), [["2026-11-26", 2], ["2026-11-20", 1]]);
  assert.equal(days[0].entries[1].area, "extension");
});
