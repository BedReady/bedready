# BedReady — the converter

A free, in-browser converter for multicolour 3D-print files. It re-targets a `.3mf` from one
slicer's printer to another's, keeps the painted colours, and hands you a file the target slicer
opens without complaint.

Live at **[bedready.io](https://bedready.io)**. No account, no sign-up, no paywall.

---

## "Nothing is uploaded" — precisely

This is the claim the project leads with, so it is worth stating exactly rather than warmly.

**By default, your model never leaves the browser.** Conversion runs in a Web Worker on your own
machine: the file is read, parsed, re-targeted and re-packaged locally, and the result is handed
straight to a download. There is no upload step, and this repository is public so that claim is
checkable rather than merely asserted — the conversion path is `src/lib/convert.ts`, driven by
`src/lib/convert-client.ts` and its worker.

**There is one exception, and it is opt-in.** Some files defeat the in-browser parser. For those,
`/convert` offers a *server-side fallback* behind an explicit button. Choosing it uploads that file,
converts it in memory, returns the result and stores nothing. It is never the default and it never
runs unless you press it. See `serverConvert()` in the `/convert` page.

So the honest form of the claim is **"nothing is uploaded unless you ask for it"**, not "the code
cannot upload". If you would rather it could not, the fallback is one button and one call site.

### What this build talks to

Four small anonymous endpoints, all listed in `src/lib/convert-api.ts` — the only file in the
repository that reaches a server:

| Endpoint | What it is |
|---|---|
| `/api/convert-count` | the "N files converted" number. Decorative. |
| `/api/report-conversion` | opt-in: *"this came out wrong, take my file"* |
| `/api/convert` | the opt-in server fallback described above |
| `/api/waitlist` | the notify-me box on the capture panel |

None require an account. There is **no database client, no authentication and no Supabase
dependency anywhere in this repository** — `src/lib/convert-backend-free.test.mts` fails the build
if one is reintroduced.

---

## What it does

- **Re-target between printers** — Bambu, Prusa, Creality, Orca and Snapmaker profiles in, a
  print-ready file for your machine out
- **Keep painted multicolour** — per-face colour survives the trip, which is the part plain
  geometry export loses and the reason this exists
- **More than four colours** — Full Spectrum mixing, `M600` swap pauses and band swaps
- **STL ⇄ 3MF**, batch conversion, and a live coloured 3D preview
- **Image → relief** at `/image`, and a filament mixer at `/mixer`
- **Orca filament profiles** at `/orca-filaments`, installable into your slicer
- Seven languages

## Quick start

```bash
npm install
npm run dev
```

Then open <http://localhost:3000> — it redirects to `/convert`, which is the front page.

```bash
npm test          # unit tests
npm run test:e2e  # Playwright, against a production build
npm run build     # production build — needs no credentials at all
```

## Configuration

Everything is optional. With no environment set, the app runs standalone and the four endpoints
above resolve same-origin.

| Variable | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_CONVERT_API_ORIGIN` | *same-origin* | where the four endpoints live |
| `NEXT_PUBLIC_CONVERTER_ORIGIN` | `https://bedready.io` | canonical URLs for this site |
| `NEXT_PUBLIC_LIBRARY_ORIGIN` | `https://makerrun.com` | where library links point |

If you set `NEXT_PUBLIC_CONVERT_API_ORIGIN`, the Content-Security-Policy names it automatically
(`next.config.mjs`). That is deliberate: a policy that does not name the API origin refuses those
calls **in the browser**, with nothing server-side to show for it.

## Layout

```
src/app/[locale]/(converter)/   the pages — /convert, /image, /mixer, /guides, …
src/lib/convert.ts              the engine: parse, re-target, repackage
src/lib/convert-client.ts       worker plumbing
src/lib/convert-api.ts          the only seam to a server
src/lib/origin.ts               which host owns which path
messages/                       seven locales
e2e/                            Playwright, asserting on real generated files
```

The route group `(converter)` is not decoration — it is what lets the layout mount a shell with no
account controls and no database client.

## Tests

Many of the tests here assert on **files this app produces**, not on the code that produces them —
that a generated `.3mf` is a package a slicer will actually open, that a download's colours match
what the page displayed, that an extracted plate lands on the bed. The E2E suite runs against a
production build for the same reason: development-mode hydration differs enough that a page can
render with no handlers attached.

There is also a `lib3mf` validation step in the upstream project's CI, using the 3MF Consortium's
own reference implementation as an independent opinion — because every other structural check in
this repository is one we wrote ourselves.

## The library is elsewhere

BedReady used to be a converter *and* a design library. The library — published designs, verified
print profiles, creator accounts — is now **[MakerRun](https://makerrun.com)**, and it is a separate,
closed-source project. That split is why this repository has no database.

Links from here to the library are ordinary cross-site links. Nothing here reads or writes
MakerRun's data.

## Contributing

Issues and pull requests are welcome. Two things worth knowing before you open one:

- **The no-upload property is load-bearing.** A change that moves conversion work to a server, or
  adds a fifth endpoint to `convert-api.ts`, is a change to what this project *is* — worth
  discussing in an issue first. The guard test will tell you before CI does.
- **Prefer a test that inspects the output file.** The bug that motivated most of this suite was a
  package our own parser read happily and Snapmaker Orca refused.

## Licence

MIT — see [LICENSE](LICENSE).
