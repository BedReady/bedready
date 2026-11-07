// /convert — "What left this page" has to tell the truth about a real conversion.
//
// The panel is the page checking its own claim, so this checks the panel against the browser: a
// file goes in, a converted file comes out, and both the panel AND Playwright's own view of the
// network must agree that no request carried more than 4 KB. If the panel ever said 0 while a
// request body was large, the second assertion catches it; if the converter ever started uploading,
// the first one does.
import { test, expect } from "@playwright/test";
import { paintedThreeMF } from "./lib/threemf";

const FILE_BYTES_THRESHOLD = 4096;

test("a conversion sends 0 file bytes, and the panel says so", async ({ page }) => {
  // Playwright's own record of every request body, independent of the code under test.
  const bodies: { url: string; bytes: number }[] = [];
  page.on("request", (r) => {
    bodies.push({ url: r.url().split("?")[0]!, bytes: r.postDataBuffer()?.byteLength ?? 0 });
  });

  await page.goto("/convert");
  // Before a file: the panel sits under the privacy claim and has nothing to report.
  const idle = page.locator("[data-egress-panel]");
  await expect(idle).toHaveCount(1);
  await expect(idle.locator("[data-egress-file-bytes]")).toHaveAttribute("data-egress-file-bytes", "0");

  await page.locator('input[type="file"]').first().setInputFiles({
    name: "painted-fixture.3mf",
    mimeType: "model/3mf",
    buffer: paintedThreeMF(),
  });
  const convert = page.getByRole("button", { name: /Clean for U1/i });
  await expect(convert).toBeEnabled({ timeout: 60_000 });

  // Headless Chromium renders the 3D preview in software GL and can keep the main thread busy for
  // several seconds after a pick; a DOM click dispatched from the page lands regardless, where a
  // synthetic mouse click can time out waiting for the element to be "stable".
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 60_000 }),
    convert.evaluate((el: HTMLElement) => el.click()),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.3mf$/i);

  // The done screen carries its own panel.
  const panel = page.locator("[data-egress-panel]");
  await expect(panel).toHaveCount(1);
  // Opened from the page, not clicked, for the same reason as the convert button above.
  await panel.evaluate((d: HTMLDetailsElement) => { d.open = true; }, null, { timeout: 60_000 });
  await expect(panel.locator("[data-egress-file-bytes]")).toHaveAttribute("data-egress-file-bytes", "0");
  await expect(panel.locator(":scope > summary")).toContainText(/File bytes sent: 0\b/);

  // The conversion counter fired and was recorded, with an empty body — proof the recorder is live,
  // so the 0 above is a measurement rather than an empty list.
  const counter = panel.locator('[data-egress-kind="counter"]').filter({ hasText: "POST /api/convert-count" });
  await expect(counter).toHaveCount(1);
  await expect(counter).toHaveAttribute("data-egress-bytes", "0");

  // Every row the panel lists stays under the threshold.
  const rowBytes = await panel.locator("[data-egress-bytes]").evaluateAll((els) =>
    els.map((e) => e.getAttribute("data-egress-bytes")),
  );
  for (const b of rowBytes) {
    expect(b, "a request of unknown size").not.toBe("");
    expect(Number(b)).toBeLessThanOrEqual(FILE_BYTES_THRESHOLD);
  }
  await expect(panel).not.toContainText(/upload you chose|unexpected upload/i);

  // And the browser agrees: no request body anywhere in the session crossed it.
  const big = bodies.filter((b) => b.bytes > FILE_BYTES_THRESHOLD);
  expect(big, "a request body over 4 KB left the page").toEqual([]);
});
