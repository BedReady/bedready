// /convert — the rescue path for projects too big to open whole.
//
// This is the flow with the worst history in the repo. A multi-plate project (the real one was 228 MB
// compressed, 1.14 GB inflated) can't be opened in a tab, so the page offers to pull out one plate at
// a time. The first version of that produced files our own parser read perfectly and Snapmaker Orca
// refused outright — "The file does not contain any geometry data" — because the extracted package
// still advertised thumbnails that had been dropped from the zip. The mesh was never the problem.
//
// So these tests check the package the way a slicer does, and they run against the real UI: an
// oversized upload, the picker that appears only on failure, and the file that comes out the far end.
import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { openDownload, danglingRels, missingPartRefs, json, text, type Archive } from "./lib/threemf";
import { OVERSIZED_FIXTURE } from "./global-setup";

// Headroom for the heaviest path in the suite — upload, peek 9 plates, inflate one, run the full
// converter — on a CI runner slower than a laptop. These finish in about 6 s locally.
//
// Not a flake fix. An earlier fixture padded plate 1 with 60,000 unreferenced vertices, and parsing
// those swung this spec from 6 s to over 3 minutes; raising the timeout only made it fail slower.
// The padding moved to inert trailing bytes instead. Recording that here because "add time" is the
// tempting response to a slow test and it would have hidden a fixture that was 30x too expensive.
test.describe.configure({ timeout: 120_000 });

const fixture = () => readFileSync(OVERSIZED_FIXTURE);

// The picker renders "Plate N" and a size label as adjacent spans. Their text content runs together
// ("Plate 1" + "2 MB" -> "Plate 12 MB"), which is why the button now carries an explicit aria-label
// with a separator — the ambiguity was found by this test and fixed in the page, not worked around
// here. Selectors still index positionally, since the visible text remains concatenated.
const plateButtons = (page: Page) => page.getByRole("button", { name: /^Plate \d+/ });

/** Upload the oversized project and wait for the plate picker to appear. */
async function openPicker(page: Page) {
  await page.goto("/convert");
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "big-project.3mf",
    mimeType: "model/3mf",
    buffer: fixture(),
  });
  await expect(page.getByRole("heading", { name: /convert them one at a time/i })).toBeVisible();
}

test("an oversized project offers its plates instead of just refusing", async ({ page }) => {
  await page.goto("/convert");
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "big-project.3mf",
    mimeType: "model/3mf",
    buffer: fixture(),
  });

  // The refusal has to state the real expanded size, not the cap — "over the limit" without a number
  // reads as a bug in the site rather than a fact about the file.
  const message = page.getByText(/unpacks to \d+ MB, over the \d+ MB limit/i);
  await expect(message).toBeVisible();
  expect(Number((await message.innerText()).match(/unpacks to (\d+) MB/i)?.[1])).toBeGreaterThan(800);

  // And then the actual point: a way forward, not a dead end.
  await expect(page.getByRole("heading", { name: /convert them one at a time/i })).toBeVisible();
  await expect(plateButtons(page).nth(0).getByText("Plate 1", { exact: true })).toBeVisible();
  // The label must not read as a different plate number once the size is appended.
  await expect(plateButtons(page).nth(0)).toHaveAttribute("aria-label", /^Plate 1 —/);
});

/**
 * Extract plate 1 and download it as a U1 file.
 *
 * Waits for the converter's own ready line before clicking rather than only for the button to be
 * enabled, which made the two older tests in this file stable. It did NOT make this one stable, and
 * the remaining intermittency is unexplained — see the note on the retry loop below.
 */
async function extractAndConvertPlate1(page: Page): Promise<Archive> {
  await openPicker(page);
  await plateButtons(page).nth(0).click();
  await expect(page.getByText(/Ready — choose an output below/i)).toBeVisible({ timeout: 90_000 });
  const convert = page.getByRole("button", { name: /Clean for U1/i });
  await expect(convert).toBeEnabled();

  // The first click here occasionally yields no download, only under full-suite load — never when
  // this spec runs alone, and never at four concurrent copies of this same flow. So it needs the
  // relief tests' CPU pressure alongside it, which points at the conversion worker rather than the
  // click.
  //
  // I previously "diagnosed" this as a click lost to a React re-render, on the grounds that the page
  // still read "Ready — choose an output below". That was wrong: `dropReady` renders whenever a file
  // is loaded and never changes during conversion, so it said nothing about whether clean() ran.
  // The retry below is a stabiliser, NOT an explanation — so when the first attempt comes up empty it
  // prints what the page was actually doing, and that record is the next lead.
  for (let attempt = 1; ; attempt++) {
    const dl = await Promise.all([
      page.waitForEvent("download", { timeout: 45_000 }).catch(() => null),
      convert.click(),
    ]).then(([d]) => d);
    if (dl) return openDownload(dl);
    if (attempt >= 2) throw new Error("Clean for U1 produced no download after two clicks");
    const seen = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")]
        .find((x) => /Clean for U1/i.test(x.textContent ?? "")) as HTMLButtonElement | undefined;
      const t = document.body.innerText;
      return {
        buttonDisabled: b?.disabled ?? null,
        // If this is true, clean() DID run and the conversion itself stalled — the opposite of a lost click.
        converting: /Applying your U1 profile/i.test(t),
        status: (t.match(/(Applying|Reading|Building|Preparing|Couldn|failed)[^\n]*/i) ?? [])[0] ?? null,
      };
    });
    console.log(`[e2e] first Clean-for-U1 click produced no download: ${JSON.stringify(seen)}`);
  }
}

test("extracting a plate yields a package a slicer will open", async ({ page }) => {
  // Extraction feeds the plate back through the ordinary converter path, so the normal actions return.
  const archive = await extractAndConvertPlate1(page);

  // THE BUG THIS FILE EXISTS FOR. Every relationship target must be a part that is actually present;
  // a package that fails this is malformed even when the geometry is perfect, and no slicer opens it.
  expect(danglingRels(archive)).toEqual([]);
  // Broader than the .rels check above, because this defect has now appeared in three different
  // files: nothing anywhere in the package may name a part that was left out.
  expect(missingPartRefs(archive)).toEqual([]);
  // Geometry lives in a separate part in this layout — the root model only carries <components
  // p:path> pointers — so look for vertices across the package rather than in 3dmodel.model.
  const models = Object.keys(archive).filter((n) => n.endsWith(".model"));
  expect(models.some((n) => /<vertex\b/.test(text(archive, n))), `no vertices in ${models}`).toBe(true);
  expect(json<{ printer_model?: string }>(archive, "Metadata/project_settings.config").printer_model)
    .toBe("Snapmaker U1");
});

test("the extracted file carries one plate, not the whole project", async ({ page }) => {
  const archive = await extractAndConvertPlate1(page);

  // If the other plates' geometry came along, the extraction did nothing and the output is as
  // unopenable as the input — which the assertions above would not notice, because a package can be
  // perfectly well-formed and still be 840 MB.
  const geometry = Object.keys(archive).filter((n) => /^3D\/Objects\/.*\.model$/i.test(n));
  expect(geometry.length).toBeLessThanOrEqual(1);
  const total = Object.values(archive).reduce((n, b) => n + b.length, 0);
  expect(total, "one plate should be kilobytes, not the whole project").toBeLessThan(5 * 1024 * 1024);
});

test("the picker lists every plate the project declares", async ({ page }) => {
  await openPicker(page);
  const heading = await page.getByRole("heading", { name: /convert them one at a time/i }).innerText();
  const declared = Number(heading.match(/has (\d+) plates/i)?.[1]);
  expect(declared).toBeGreaterThan(1);
  // A plate that resolves to no geometry is filtered out before the list is shown, so the count in
  // the heading and the number of buttons must agree — a mismatch means the object_id -> part
  // mapping slipped, which is silent and makes plates measure 0 MB.
  await expect(plateButtons(page)).toHaveCount(declared);
});

// THE BUG A REAL FILE FOUND, and this suite did not. Plates in a multi-plate project are laid out
// across one world space, so an extracted plate keeps a position that is nowhere near the bed of the
// file it now lives in. On Small Spiderman colored.3mf plate 6 that meant Y -287.5..-68.4 against a
// printable Y of 1..271: valid package, complete geometry, every relationship resolved, and nothing
// on the plate to slice. The fixture used to place every plate at the origin, which is precisely why
// the tests above passed while the product shipped a file that could not print.
test("the extracted plate lands on the bed, not where it sat in the layout", async ({ page }) => {
  const archive = await extractAndConvertPlate1(page);
  const root = text(archive, "3D/3dmodel.model");
  const t = root.match(/<item\b[^>]*transform="([^"]+)"/)?.[1]?.split(/\s+/).map(Number);
  expect(t, "the build item should carry a transform").toBeTruthy();
  const [tx, ty] = [t![9], t![10]];
  // The fixture parks plate 1 at (900, -450). Anything still out there never reached the bed.
  expect(tx, `X translation ${tx} is outside the printable area`).toBeGreaterThan(0);
  expect(tx).toBeLessThan(271);
  expect(ty, `Y translation ${ty} is outside the printable area`).toBeGreaterThan(0);
  expect(ty).toBeLessThan(271);
});
