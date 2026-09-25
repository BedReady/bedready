# Mac App Store (Safari) — submission kit

Paste-ready App Store Connect metadata for the BedReady Safari extension. Tailored to Safari, which
has **no auto-convert-on-download** (no `downloads` API) — on Safari it's **drag-drop popup + the
in-page "→ U1" button**, not automatic. Don't claim auto-on-download here.

The build is already uploaded via Xcode. This covers the listing fields + submit.

## App information
- **Name:** `BedReady: 3MF Converter`  (store display name; the bundle stays `BedReady`)
- **Subtitle (≤30):** `Multicolor 3MF → Snapmaker U1`
- **Primary category:** Developer Tools  *(matches LSApplicationCategoryType)*
- **Secondary category (optional):** Graphics & Design
- **Age rating:** 4+
- **Copyright:** `2026 BedReady`
- **Support URL (required):** `https://bedready.io/extension`
- **Marketing URL (optional):** `https://bedready.io`
- **Privacy Policy URL (required):** `https://makerrun.com/privacy`  
  *(not `bedready.io/privacy` — it 301s cross-domain to exactly this page, and App Store Connect
  validates the URL it is given)*

## Keywords (≤100, comma-separated, no spaces after commas)
```
3mf,snapmaker,u1,makerworld,bambu,multicolor,converter,orca,3d print,prusa,printables,slicer
```

## Promotional text (≤170, editable anytime without review)
```
Turn multicolor MakerWorld & Bambu .3mf files into U1-ready prints — right in Safari. Keeps every color and the creator’s print settings. 100% local, nothing uploaded.
```

## Description
```
The most complete way to make multicolor 3D-print files work on the Snapmaker U1 — now in Safari.

A .3mf you download from MakerWorld, Bambu, Printables, or Thingiverse is sliced for a different
printer. Drop it into Snapmaker Orca and you get the wrong profile, scrambled color slots, and broken
filament-change pauses. BedReady fixes all of that. Most converters stop at swapping the profile and
mapping colors. BedReady keeps going:

• Swaps the foreign printer profile for the real Snapmaker U1 profile
• Maps painted multicolor onto the U1's 4 slots — colors kept exactly, including text & logos
• KEEPS the creator's print settings (layer height, walls, infill, speeds) — not just the colors
• MORE THAN 4 COLORS: Full Spectrum reproduces the extras by dithering 2- and 3-filament mixes
• Mix from your own filaments (CMYK or any 4), with color matching tuned to what the U1 really prints
• Detects height-banded models and tells you the exact filament-swap heights
• Fixes the spool-swap pauses and the prime tower (the #1 cause of failed multicolor prints)

How it works in Safari: open the toolbar popup and drag any .3mf in, or click the "→ U1" button that
appears next to files on MakerWorld, Printables, and Thingiverse. The converted, U1-ready file saves
to your Downloads.

It runs ENTIRELY in your browser — your file is never uploaded to a server. Free, no account.

Prefer the web? The same converter, plus a library of files with profiles tested to print on a U1, is
free at bedready.io.

Not affiliated with, endorsed by, or sponsored by Snapmaker, Bambu Lab, or MakerWorld.
"Snapmaker" and "U1" are trademarks of their respective owners.
```

## App Privacy ("App Privacy" section → answer the questionnaire)
- **Data collection:** select **"Data Not Collected."** Conversion is 100% local; nothing is sent to
  any server, no analytics, no account.
- If asked per-type, all No. This matches the browser privacy policy at makerrun.com/privacy.

## Screenshots (macOS — required, at least 1)
- Valid sizes: 1280×800, 1440×900, 2560×1600, 2880×1800. **`extension/store-screenshots/screenshot-1..3.png`
  are 1280×800 → upload as-is.** (Regenerate: `node extension/make-screenshots.mjs`.)
  1. Popup + value prop · 2. The in-page "→ U1" button · 3. Before/after colors

## Review notes (App Review → "Notes")
```
BedReady converts .3mf 3D-print files so they slice correctly on the Snapmaker U1. All conversion runs
locally in the browser via WebAssembly-free JS — no server, no account, no data collected.

To test: click the toolbar icon to open the popup, then drag any .3mf file into it (a sample is at
https://bedready.io/convert). The converted .u1.3mf saves to Downloads. Optionally, on a MakerWorld/
Printables/Thingiverse model page, a "→ U1" button appears next to the file.

Safari note: Safari has no downloads API, so unlike the Chrome/Firefox versions there is no
auto-convert-on-download; the popup drag-drop and the in-page button are the entry points. The
scripting + activeTab permissions are used only to save the converted file via the active tab (Safari
won't name a download from the extension popup's own origin).
```

## Permission justifications (if asked)
- **scripting + activeTab** — Safari drops the download filename for files saved from the extension
  popup's origin, so the popup runs the save in the active tab (page origin) where the name is honored.
- **host permissions (makerworld/printables/thingiverse + bblmw.com CDN)** — the in-page "→ U1" button
  runs only on these model sites; the extension does nothing elsewhere.
- **notifications** — conversion-finished feedback (no-op on Safari where interception is off).

## Submit
1. My Apps → **BedReady: 3MF Converter** → the **1.0** version.
2. Fill the fields above, attach the uploaded build (Build section → +), set App Privacy, add screenshots.
3. **Add for Review** → **Submit for Review.**
