// /image — does the file match what the page said?
//
// This is the bug class that unit tests could not see. The HueForge pipeline was verified three
// separate ways in Node and every check passed; meanwhile the page displayed the flat quantiser's
// four colours and the download contained four different ones, because relief mode picks its own
// filaments. Four colours the user never saw, in a file whose whole purpose is telling you which
// spools to load. Nothing catches that except pressing the button and opening the result.
//
// ONE INVARIANT PER TEST, deliberately. The first draft asserted the headings, the filaments and the
// package integrity inside a single relief test; re-introducing all three bugs at once then produced
// exactly one failure, because the first assertion masked the other two. A suite that under-reports
// what is broken is only marginally better than no suite.
import { test, expect, type Page } from "@playwright/test";
import {
  openDownload, filamentColours, layerBands, danglingRels, json, gradientPng, type Archive,
} from "./lib/threemf";

const hexes = (s: string) => (s.match(/#[0-9A-Fa-f]{6}/g) ?? []).map((h) => h.toUpperCase());
const printerModel = (a: Archive) =>
  json<{ printer_model?: string }>(a, "Metadata/project_settings.config").printer_model;

async function uploadGradient(page: Page) {
  await page.goto("/image");
  await page.locator('input[type="file"]').setInputFiles({
    name: "gradient.png",
    mimeType: "image/png",
    buffer: gradientPng(),
  });
  await expect(page.getByTestId("flat-palette")).toBeVisible();
}

/** Upload, switch to relief mode, download the relief, and hand back the archive. */
async function reliefArchive(page: Page): Promise<Archive> {
  await uploadGradient(page);
  await page.getByRole("checkbox", { name: /HueForge relief/i }).check();
  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /Download HueForge relief/i }).click(),
  ]);
  return openDownload(dl);
}

test.describe("flat plate", () => {
  test("the U1 file contains the colours the page displays", async ({ page }) => {
    await uploadGradient(page);
    const shown = hexes(await page.getByTestId("flat-palette").innerText());
    expect(shown.length).toBeGreaterThanOrEqual(2);

    const [dl] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /Download U1 file/i }).click(),
    ]);
    const archive = await openDownload(dl);

    expect(filamentColours(archive).slice(0, shown.length)).toEqual(shown);
    expect(printerModel(archive)).toBe("Snapmaker U1");
  });

  test("the U1 file is a package a slicer will open", async ({ page }) => {
    await uploadGradient(page);
    const [dl] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /Download U1 file/i }).click(),
    ]);
    // A relationship pointing at a part that isn't in the zip makes the package malformed. Orca
    // reports that as "The file does not contain any geometry data", which sends you to the mesh —
    // and the mesh is fine. Our own parser reads these files happily either way.
    expect(danglingRels(await openDownload(dl))).toEqual([]);
  });
});

test.describe("relief", () => {
  test("ships the filaments it shows", async ({ page }) => {
    await uploadGradient(page);
    const flatPalette = hexes(await page.getByTestId("flat-palette").innerText());
    await page.getByRole("checkbox", { name: /HueForge relief/i }).check();
    const [dl] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /Download HueForge relief/i }).click(),
    ]);
    const inFile = filamentColours(await openDownload(dl));

    const shown = hexes(await page.getByTestId("relief-filaments").innerText());
    expect(shown.length).toBeGreaterThanOrEqual(2);
    expect(inFile.slice(0, shown.length)).toEqual(shown);

    // If these ever coincide, the fixture has stopped being able to tell the two quantisers apart and
    // the assertion above proves nothing — so fail loudly rather than pass forever for the wrong reason.
    expect(shown, "gradient fixture must still split the two quantisers")
      .not.toEqual(flatPalette.slice(0, shown.length));
  });

  test("labels the flat panels as flat", async ({ page }) => {
    await uploadGradient(page);
    await page.getByRole("checkbox", { name: /HueForge relief/i }).check();
    // With relief on, the panels above must say which file they describe. They render the FLAT plate
    // and always did — the headings just didn't admit it, so two unrelated palettes sat on screen
    // with nothing to tell them apart.
    await expect(page.getByTestId("flat-palette")).toContainText(/flat plate/i);
    await expect(page.getByText(/3D preview .* not the relief/i)).toBeVisible();
  });

  test("is a package a slicer will open", async ({ page }) => {
    const archive = await reliefArchive(page);
    expect(danglingRels(archive)).toEqual([]);
    expect(printerModel(archive)).toBe("Snapmaker U1");
  });

  test("colour swaps tile the height without gaps", async ({ page }) => {
    const bands = layerBands(await reliefArchive(page));
    expect(bands.length).toBeGreaterThanOrEqual(2);
    expect(bands[0].z0).toBe(0); // the first band starts at the bed, not one layer up
    // A gap is a height with no head assigned; an overlap is two heads claiming the same layer.
    // Either one still slices and still prints — just with the colours in the wrong places.
    for (let i = 1; i < bands.length; i++) expect(bands[i].z0).toBeCloseTo(bands[i - 1].z1, 4);
    expect(bands.map((b) => b.head)).toEqual(bands.map((_, i) => String(i + 1)));
  });

  test("reports a loose colour match in words, not just a number", async ({ page }) => {
    await uploadGradient(page);
    await page.getByRole("checkbox", { name: /HueForge relief/i }).check();
    await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /Download HueForge relief/i }).click(),
    ]);
    // A full-spectrum gradient cannot be matched by four filaments; ΔE lands near 17. Nobody knows
    // what ΔE 17 means, so the page has to say it plainly.
    const quality = await page.getByText(/Colou?r match ΔE/).innerText();
    expect(Number(quality.match(/ΔE\s*([\d.]+)/)?.[1])).toBeGreaterThan(10);
    await expect(page.getByText(/loose match/i)).toBeVisible();
  });
});
