// /image/lithophane — a photo in, a preview on screen, and a U1 project out that uses all four heads.
//
// The planning and the 3MF both run in a Web Worker, which no unit test loads: a worker URL that the
// bundler did not emit, or a message shape the page and the worker disagree on, shows up only here.
import { test, expect } from "@playwright/test";
import { openDownload, text, danglingRels, gradientPng } from "./lib/threemf";

// A full plan plus export is seconds of solver work, more on a loaded machine.
test.setTimeout(240_000);

test("a photo becomes a preview and a four-head U1 lithophane", async ({ page }) => {
  await page.goto("/image/lithophane");
  // Small print: the solver's time scales with the grid, and this is about the wiring.
  for (const [label, value] of [["Width", "40"], ["Height", "30"]] as const) {
    const field = page.getByRole("spinbutton", { name: label, exact: true });
    await field.fill(value);
    await field.blur();
  }
  await page.locator('input[type="file"]').setInputFiles({
    name: "gradient.png",
    mimeType: "image/png",
    buffer: gradientPng(48, 36),
  });

  // The preview canvas is painted from the worker's backlit buffer.
  await expect(page.getByTestId("litho-preview")).toHaveAttribute("data-ready", "true", { timeout: 120_000 });
  await expect(page.getByText(/About \d+ h on the U1/)).toBeVisible();

  const [dl] = await Promise.all([
    page.waitForEvent("download", { timeout: 180_000 }),
    page.getByRole("button", { name: /Download lithophane for U1/i }).click(),
  ]);
  expect(dl.suggestedFilename()).toMatch(/\.3mf$/);
  const archive = await openDownload(dl);

  const settings = text(archive, "Metadata/model_settings.config");
  const extruders = new Set([...settings.matchAll(/key="extruder" value="(\d+)"/g)].map((m) => Number(m[1])));
  expect([...extruders].sort()).toEqual([1, 2, 3, 4]);
  expect(danglingRels(archive)).toEqual([]);
});

test("the light toggle and the frame choice are buttons that report their state", async ({ page }) => {
  await page.goto("/image/lithophane");
  const stand = page.getByRole("button", { name: "Border + stand" });
  await stand.click();
  await expect(stand).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "None", exact: true }).first()).toHaveAttribute("aria-pressed", "false");
});
