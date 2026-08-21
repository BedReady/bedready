// End-to-end tests: drive the real pages in a real browser and check that the FILES they hand out
// match what they said they would.
//
// Why this exists alongside 170-odd unit tests: every defect this project shipped in the image and
// converter flows was invisible to them. The unit tests exercise the pipeline; the bugs lived in the
// wiring between the pipeline and the screen — a page displaying one palette while the download
// contained another, an archive our own parser read happily that no slicer would open. Both are only
// observable by pressing the button and opening the result, so that is what these do.
//
// Runs against a PRODUCTION build (`npm start`), not `next dev`: dev-mode hydration behaves
// differently enough that a page can sit there with no event handlers attached, which would make
// every one of these fail for a reason that has nothing to do with the code under test.
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3210);
const BASE = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // Builds the oversized multi-plate fixture once per run rather than once per worker — it is ~840 MB
  // of declared size and takes a few seconds to compress.
  globalSetup: "./e2e/global-setup.ts",
  // These build real 3MFs in the browser; a cold worker + parse is slower than a typical DOM test.
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  // The HTML report is what CI uploads on failure — with traces attached, so a red build can be
  // opened and replayed instead of re-run locally and hoped at.
  reporter: process.env.CI ? [["github"], ["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: BASE,
    acceptDownloads: true,
    trace: process.env.CI ? "retain-on-failure" : "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // `npm start` serves whatever is in .next — CI builds first, so this is the shipped bundle.
    command: `npm start -- -p ${PORT}`,
    url: BASE,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // No env is injected. The combined repository had to supply placeholder Supabase credentials
    // here, because the client constructor throws on empty env and would blank every page. This
    // build has no Supabase client at all — which is the same property that lets the repository be
    // public, and it shows up as this block being empty.
  },
});
