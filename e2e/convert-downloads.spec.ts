// /convert — the converted file has to be a file a slicer will open.
//
// The converter's own tests all read the output back with our own parser, which is exactly how a
// malformed package got shipped: the geometry was intact, our reader was happy, and Snapmaker Orca
// refused the archive outright because relationships pointed at parts that were no longer in it.
// These assertions are the package-level ones a slicer makes before it ever looks for a mesh.
import { test, expect } from "@playwright/test";
import { openDownload, danglingRels, json, text, paintedThreeMF } from "./lib/threemf";

async function uploadFixture(page: import("@playwright/test").Page) {
  await page.goto("/convert");
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "painted-fixture.3mf",
    mimeType: "model/3mf",
    buffer: paintedThreeMF(),
  });
  await expect(page.getByRole("button", { name: /Clean for U1/i })).toBeEnabled();
}

test("Clean for U1 produces a valid package stamped for the U1", async ({ page }) => {
  await uploadFixture(page);

  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /Clean for U1/i }).click(),
  ]);
  expect(dl.suggestedFilename()).toMatch(/\.3mf$/i);

  const archive = await openDownload(dl);
  // OPC basics — a slicer reads these before the mesh, and rejects the file if they're wrong.
  expect(Object.keys(archive)).toEqual(expect.arrayContaining(["[Content_Types].xml", "_rels/.rels"]));
  expect(danglingRels(archive)).toEqual([]);
  expect(text(archive, "3D/3dmodel.model")).toMatch(/<vertex\b/);

  const cfg = json<{ printer_model?: string; filament_colour?: string[] }>(
    archive, "Metadata/project_settings.config",
  );
  expect(cfg.printer_model).toBe("Snapmaker U1");
  // The fixture's four painted states must survive the profile swap — losing one silently is the
  // failure that costs someone a whole print.
  expect(cfg.filament_colour?.length).toBeGreaterThanOrEqual(4);
});

test("the generic export drops the vendor profile without breaking the package", async ({ page }) => {
  await uploadFixture(page);
  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /Generic 3MF/i }).click(),
  ]);
  const archive = await openDownload(dl);
  expect(danglingRels(archive)).toEqual([]);
  expect(text(archive, "3D/3dmodel.model")).toMatch(/<vertex\b/);
  const cfg = archive["Metadata/project_settings.config"];
  if (cfg) {
    expect(json<{ printer_model?: string }>(archive, "Metadata/project_settings.config").printer_model)
      .not.toMatch(/bambu/i);
  }
});

test("a file the converter cannot read fails loudly, next to the button", async ({ page }) => {
  await page.goto("/convert");
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "not-really.3mf",
    mimeType: "model/3mf",
    buffer: Buffer.from("this is not a zip archive"),
  });
  // The error has to be where the user is looking. It used to render far below the fold while the
  // status at the top still read "Reading colors & geometry…", so the page looked busy, not broken.
  const error = page.getByText(/could not|couldn.t|not a valid|unreadable|failed/i).first();
  await expect(error).toBeVisible();
  await expect(page.getByText(/Reading colors/i)).toHaveCount(0);
});
