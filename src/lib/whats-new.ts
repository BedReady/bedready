/**
 * What changed for people who use bedready.io, newest first. The page at /changes renders it.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────────────────────────
 *
 * A pull request that changes something a user can see or feel adds its entry HERE, in the same pull
 * request. That means a new feature, a fix to a converted file, an extension release, or a page that
 * behaves differently. CI enforces it (scripts/check-whats-new.mjs). A change with nothing a user
 * would notice (tests, CI, refactors, docs) says so with "What's new: none" in the PR description.
 *
 * ── HOW TO WRITE AN ENTRY ───────────────────────────────────────────────────────────────────────
 *
 * - One sentence or two, plain language, about what the USER gets: "Converted Bambu Lab files slice
 *   in Snapmaker Orca again", not "print_compatible_printers is an identity key".
 * - English. The page's own words are translated (messages/<locale>.json, `changes`); entries are
 *   not, because seven languages of every line would trail the code by days. The page marks them
 *   lang="en" so screen readers and translation tools know.
 * - `date` is the day it went live (merged to main), as YYYY-MM-DD: a calendar date, not an instant.
 * - Extension entries name the version in brackets, e.g. "(0.6.9)", since that is what the store
 *   shows.
 * - Add to the TOP. whats-new.test.mts checks the order, the dates and the areas.
 */

export const WHATS_NEW_AREAS = ["converter", "image", "extension"] as const;
export type WhatsNewArea = (typeof WHATS_NEW_AREAS)[number];

export type WhatsNewEntry = {
  /** Calendar date it went live, YYYY-MM-DD. */
  date: string;
  area: WhatsNewArea;
  /** What changed, for the person using it. English. */
  text: string;
  /** The pull request on BedReady/bedready, when there is one. */
  pr?: number;
};

export const WHATS_NEW: WhatsNewEntry[] = [
  {
    date: "2026-11-26",
    area: "converter",
    text: "Converted files retract and wipe the way the U1 does for your nozzle, not the way the source printer did: a Bambu A1 file on a 0.6 mm U1 retracts 1.4 mm instead of 0.8. A creator’s own filament retraction settings are still kept.",
    pr: 143,
  },
  {
    date: "2026-11-26",
    area: "converter",
    text: "Filaments set up for another printer (“Bambu PLA Matte @BBL X1C”) arrive as the U1 library’s Generic preset of that material, with the creator’s temperatures and flow kept. A clear filament shows as white instead of black.",
    pr: 142,
  },
  {
    date: "2026-11-26",
    area: "converter",
    text: "Converting for a U1 with a 0.2, 0.6 or 0.8 mm nozzle uses Snapmaker’s own retraction, wipe and nozzle type for that nozzle. The 0.6 is stainless steel and retracts 1.4 mm; the 0.2 retracts 0.4 mm.",
    pr: 141,
  },
  {
    date: "2026-11-26",
    area: "converter",
    text: "PrusaSlicer files keep the creator’s layer height, walls, top and bottom layers, infill, supports and temperatures. They used to take the U1’s defaults.",
    pr: 140,
  },
  {
    date: "2026-11-26",
    area: "converter",
    text: "This page: what changed on bedready.io, newest first. Every change you’ll notice gets a line here when it goes live.",
  },
  {
    date: "2026-11-26",
    area: "converter",
    text: "Converted Bambu Lab files open and slice in Snapmaker Orca again. Some stopped with “process not compatible with printer”, because the file still listed the Bambu printers as the only ones its settings fit.",
    pr: 137,
  },
  {
    date: "2026-11-26",
    area: "converter",
    text: "U1 files carry Snapmaker Orca 2.4.1’s own start, end and tool-change G-code: the chamber purifier, pre-extrusion and the chamber-temperature wait. Heads that are not printing now cool down while they wait, as on the U1’s own profiles.",
    pr: 138,
  },
  {
    date: "2026-11-26",
    area: "extension",
    text: "Converted MakerWorld downloads are named after the model instead of a random file key. (0.6.8)",
    pr: 136,
  },
  {
    date: "2026-11-20",
    area: "extension",
    text: "Restarting Chrome no longer converts every model you downloaded before, or fills the screen with pop-ups. (0.6.7)",
    pr: 134,
  },
  {
    date: "2026-11-19",
    area: "converter",
    text: "The filament catalogue follows OrcaSlicer 2.5.1. Every old filament link still works.",
    pr: 132,
  },
  {
    date: "2026-11-19",
    area: "converter",
    text: "The language menu shows each language’s name in that language.",
    pr: 133,
  },
  {
    date: "2026-11-12",
    area: "image",
    text: "Full color: see how the print looks in room light before you download it.",
    pr: 130,
  },
  {
    date: "2026-11-11",
    area: "image",
    text: "Color lithophanes for the U1, with a hanging frame or a stand, plus test-print options to dial in your filaments first.",
    pr: 129,
  },
  {
    date: "2026-11-11",
    area: "image",
    text: "HueForge “Full color (CMY + white)”: a front-lit print with color in every pixel.",
    pr: 128,
  },
  {
    date: "2026-11-08",
    area: "converter",
    text: "After converting, “Send to Khayt” opens the file as a new job in Khayt for Mac.",
    pr: 121,
  },
  {
    date: "2026-11-07",
    area: "converter",
    text: "After converting, print a load sheet that says which filament goes in which head.",
    pr: 116,
  },
  {
    date: "2026-11-07",
    area: "converter",
    text: "The converter lists every request that left the page, and its size, so you can see your file was not uploaded.",
    pr: 115,
  },
  {
    date: "2026-11-07",
    area: "image",
    text: "Photo tools: share a link to your settings. The link never includes the photo.",
    pr: 117,
  },
  {
    date: "2026-11-07",
    area: "image",
    text: "HueForge exports for the U1 print PLA at PLA temperatures. They were set to ABS temperatures (270 °C nozzle, 90 °C bed).",
    pr: 100,
  },
  {
    date: "2026-11-07",
    area: "converter",
    text: "Converting to another Bambu Lab or Creality printer names that printer’s real preset and drops the original printer’s start G-code.",
    pr: 106,
  },
  {
    date: "2026-11-07",
    area: "extension",
    text: "“Check fit” on MakerWorld model pages says how many colors a profile uses and whether it fits your printer, before you download. (0.6.6)",
    pr: 118,
  },
  {
    date: "2026-11-07",
    area: "extension",
    text: "The original file kept for “Edit colors” is deleted after 30 minutes, as the privacy policy says. (0.6.5)",
    pr: 109,
  },
  {
    date: "2026-11-06",
    area: "converter",
    text: "A file with several plates can be split into one file per plate when every plate fits your printer’s filament slots.",
    pr: 93,
  },
  {
    date: "2026-11-03",
    area: "converter",
    text: "bedready.io has a new look, built around the build plate.",
    pr: 74,
  },
  {
    date: "2026-11-02",
    area: "converter",
    text: "High Flow hot end option for the U1 with a 0.4 mm nozzle.",
    pr: 65,
  },
  {
    date: "2026-11-02",
    area: "extension",
    text: "A “Download for U1” button on MakerWorld model pages. (0.6.3)",
    pr: 66,
  },
];

/** The entries grouped by day, newest day first, in the order they are listed. */
export function whatsNewByDay(entries: WhatsNewEntry[] = WHATS_NEW): { date: string; entries: WhatsNewEntry[] }[] {
  const days: { date: string; entries: WhatsNewEntry[] }[] = [];
  for (const e of entries) {
    const last = days[days.length - 1];
    if (last && last.date === e.date) last.entries.push(e);
    else days.push({ date: e.date, entries: [e] });
  }
  return days;
}
