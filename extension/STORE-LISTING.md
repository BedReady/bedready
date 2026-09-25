# Chrome Web Store — listing kit

**The extension is already published.** This is the copy of record for the listing, and the steps for
shipping an update.

- Live: https://chromewebstore.google.com/detail/empadffogehgmbleajehbplobfajddnh
- Published version: **0.2.0** · in this repo: **0.3.0** — an update is pending upload.

Firefox is a separate submission with its own artifact; see "Package". Safari is its own store
entirely — `STORE-LISTING-SAFARI.md`.

---

## Package (what you upload)
One command builds and packages both stores' artifacts — it writes the zips itself, so there is no
manual `zip` step:
```
node extension/build.mjs
```
- `public/bedready-extension.zip` → **Chrome & Edge** (uses `manifest.json`, background = service worker)
- `public/bedready-firefox.zip` → **Firefox / AMO** (uses `manifest.firefox.json`, background = event page)

Both are served from the site as the load-unpacked fallback (`/bedready-extension.zip`,
`/bedready-firefox.zip`), so shipping a build also updates what `/extension` hands out.

To publish an update: Chrome Web Store Developer Dashboard → the existing item → **Package → Upload
new package**. Bump `version` in `extension/manifest.json` *and* `manifest.firefox.json` first — the
stores reject a re-used version number.

## Store listing fields

**Name:** BedReady — 3MF → Snapmaker U1

**Summary (≤132 chars):**
Convert MakerWorld & Bambu multicolor 3MF files to print on the Snapmaker U1 — right from the download page. Free, private.

**Category:** Productivity *(alt: Functionality & UI)*

**Language:** English

**Privacy policy URL (required):** https://makerrun.com/privacy

> Not `bedready.io/privacy` — that 301s cross-domain to this same page, and a required policy URL
> that redirects to another origin is worth neither the review risk nor the argument. The converter
> deliberately doesn't render its own copy; makerrun.com is where the policy actually lives.

**Detailed description:**
```
The most complete way to make multicolor 3D-print files work on the Snapmaker U1.

When you download a .3mf from MakerWorld, Bambu, Printables, or Thingiverse, it's sliced for a
different printer — drop it into Snapmaker Orca and you get the wrong profile, scrambled color
slots, and broken filament-change pauses. BedReady fixes all of that in one click, right on the
download page. Most converters stop at swapping the profile and mapping colors. BedReady keeps going:

• Swaps the foreign printer profile for the real Snapmaker U1 profile
• Maps painted multicolor onto the U1's 4 slots — colors kept exactly, including text & logos
• KEEPS the creator's print settings (layer height, walls, infill, speeds) — not just the colors
• MORE THAN 4 COLORS: Full Spectrum reproduces extra colors by dithering 2- and 3-filament mixes
• Mix from your own filaments (CMYK or any 4), with color matching tuned to what the U1 really prints
• Detects height-banded models and tells you the exact filament-swap heights
• Fixes the spool-swap pauses and the prime tower (the #1 cause of failed multicolor prints)

It runs ENTIRELY in your browser — your file is never uploaded to a server. Free, no account.

Prefer not to install? The same converter, plus a library of files with profiles tested to print on
a U1, is free at bedready.io.

Works on MakerWorld, Bambu Lab, Printables, and Thingiverse.

Not affiliated with, endorsed by, or sponsored by Snapmaker, Bambu Lab, or MakerWorld.
"Snapmaker" and "U1" are trademarks of their respective owners.
```

## Privacy tab (required to pass review)

**Single purpose:**
Convert .3mf 3D-print files downloaded from model sites so they print correctly on the Snapmaker U1.

**Permission justifications:**
- **downloads** — to read the .3mf the user is downloading and save the converted file back.
- **notifications** — to tell the user when a conversion finishes.
- **host permissions (makerworld.com, bblmw.com, printables.com, thingiverse.com)** — the content
  script only runs on these model sites to detect .3mf downloads and offer in-page conversion. The
  extension does nothing on any other site.

**Data usage — declare ALL of these as "No":** the extension collects/transmits **no** user data.
Conversion is 100% local (in the browser); nothing is sent to any server. Check the certification
boxes: not sold to third parties, not used/transferred for purposes unrelated to the single purpose,
not used to determine creditworthiness/lending.

## Graphics checklist
- [x] Icon 128×128 — `extension/icon128.png` (already in the package)
- [x] Screenshots (1280×800) — **`extension/store-screenshots/screenshot-1..3.png`**, ready to upload:
      1. Popup + value prop · 2. The in-page "→ U1" button · 3. Before/after colors
      Regenerate anytime: `node extension/make-screenshots.mjs`
- [ ] Small promo tile 440×280 (optional) — BedReady logo + "3MF → U1". Nice-to-have, not required.

Note: the screenshots are designed promo scenes that accurately depict the extension (the real
popup UI + what the content script adds). If you'd rather use literal captures, install the
extension and screenshot the popup + a live MakerWorld page at 1280×800 — but these pass review fine.

## After an update goes live
- Nothing to change on the site for a version bump: `/extension` links to the store listing, not to a
  version, and the load-unpacked zips are rebuilt by `build.mjs`.
- The store URLs are constants at the top of `src/app/[locale]/(converter)/extension/page.tsx`. Each
  is gated — an empty string renders the "pending" note instead of the install button. Only
  `SAFARI_APPSTORE_URL` is still empty; set it when the Mac App Store approves.
