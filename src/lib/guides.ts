// SEO guide articles. English content (the highest-search-volume terms are English); other locales
// fall back to this via the i18n layer. Keep GUIDE_SLUGS in sitemap.ts in sync with these slugs.
export type Guide = {
  slug: string;
  title: string;
  description: string;
  intro: string;
  sections: { h: string; p: string[] }[];
};

export const GUIDES: Guide[] = [
  {
    slug: "makerworld-multicolor-on-snapmaker-u1",
    title: "How to print a MakerWorld multicolor model on the Snapmaker U1",
    description:
      "Step-by-step: take any multicolor .3mf from MakerWorld and print it correctly on the Snapmaker U1 — colors intact, profile fixed, no manual repainting.",
    intro:
      "MakerWorld models are sliced for Bambu printers, so they don't drop straight onto a Snapmaker U1. Here's the fastest way to get one printing correctly — colors and all.",
    sections: [
      {
        h: "Why a MakerWorld file won't just work on the U1",
        p: [
          "Most MakerWorld multicolor files are Bambu Studio .3mf projects built around a Bambu AMS and a Bambu printer profile. Open one in Snapmaker Orca and you inherit settings tuned for the wrong machine — most importantly a prime/wipe tower that isn't set up for the U1, which is the #1 cause of failed multicolor prints.",
          "You also have to figure out which painted color goes into which of the U1's four slots, and trim anything above the U1's speed and acceleration limits.",
        ],
      },
      {
        h: "The one-click way",
        p: [
          "Download the .3mf from MakerWorld, then drop it into the free in-browser converter at bedready.io/convert. It swaps the foreign profile for the real Snapmaker U1 profile, maps the painted colors onto the U1's 4 slots, sets the prime tower to U1-safe defaults, and caps anything over the U1's limits.",
          "Nothing is uploaded — the whole conversion runs on your device. You get back a U1-ready .3mf with a plain-English summary of everything it changed.",
        ],
      },
      {
        h: "More than 4 colors?",
        p: [
          "The U1 has 4 slots. If a model uses more, the converter either reduces to the 4 closest colors, or — with Full Spectrum — mixes your 4 loaded filaments to approximate the extras. For files that change color by layer height, it can insert M600 spool-swap pauses so you keep every color by hand-swapping.",
        ],
      },
      {
        h: "Finishing in Snapmaker Orca",
        p: [
          "Open the converted file in Snapmaker Orca and re-slice it. The converter sets up the profile, colors, and pauses; Orca generates the actual G-code. Tip: don't use 'Split to objects/parts' or the Cut tool afterward — those drop painted colors.",
        ],
      },
    ],
  },
  {
    slug: "fix-geometry-only-snapmaker-orca",
    title: "Fix “not supported, loading geometry data only” in Snapmaker Orca",
    description:
      "Why Snapmaker Orca loads a .3mf as 'geometry only' and drops your colors — and how to fix it so the full multicolor project loads.",
    intro:
      "Importing a .3mf and seeing “not supported … loading geometry data only”? Your painted colors just got dropped. Here's what causes it and the quick fix.",
    sections: [
      {
        h: "What the message means",
        p: [
          "Snapmaker Orca (like OrcaSlicer and Bambu Studio) only fully imports a .3mf as a project — colors, painted segmentation, plate and object data — when the file's producer tag is on its whitelist (BambuStudio- or OrcaSlicer-). A file made by PrusaSlicer or Creality Print isn't recognized, so Orca falls back to importing bare geometry and discards the color data.",
        ],
      },
      {
        h: "Why repainting by hand isn't the answer",
        p: [
          "You could re-paint the model triangle by triangle in Orca, but you'll never match the original exactly and it takes ages — every time, for every file.",
        ],
      },
      {
        h: "The fix",
        p: [
          "Run the file through bedready.io/convert. It re-tags the file as a native Orca project so Snapmaker Orca loads the full color data, translates PrusaSlicer/Creality paint data into Orca's format, and adds the U1 profile. The colors come back, and the file opens as a proper multicolor project.",
        ],
      },
    ],
  },
  {
    slug: "prusaslicer-creality-to-snapmaker-u1",
    title: "Convert PrusaSlicer & Creality .3mf files for the Snapmaker U1",
    description:
      "PrusaSlicer and Creality Print multicolor .3mf files lose their colors in Snapmaker Orca. Here's how to convert them so they print correctly on the U1.",
    intro:
      "PrusaSlicer and Creality Print make great multicolor files — but they don't load cleanly on the Snapmaker U1. Here's how to bridge them.",
    sections: [
      {
        h: "The PrusaSlicer / Creality gap",
        p: [
          "Both store color differently from Bambu/Orca: PrusaSlicer paints under its own slic3rpe attributes and has no Orca-style project config; Creality Print is an OrcaSlicer fork but tags files with its own producer string. Either way, Snapmaker Orca imports them as geometry only and drops the colors.",
        ],
      },
      {
        h: "What the converter does",
        p: [
          "bedready.io/convert translates PrusaSlicer's paint data into Orca's format, synthesizes the project structure Orca needs, strips the Creality vendor marker, and re-tags the file as a native Orca project — then stamps the tested Snapmaker U1 profile. The painted colors map onto the U1's 4 slots, preserved exactly.",
          "It's verified against real Creality K2 Plus / CFS files and PrusaSlicer multicolor exports.",
        ],
      },
      {
        h: "Try it",
        p: [
          "Drop your PrusaSlicer or Creality .3mf into the converter, download the U1-ready file, and open it in Snapmaker Orca. It runs entirely in your browser — nothing is uploaded.",
        ],
      },
    ],
  },
];

export const guideBySlug = (slug: string) => GUIDES.find((g) => g.slug === slug);
