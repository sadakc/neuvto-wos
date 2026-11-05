import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests: a real browser drives the app against the LOCAL stack.
 *
 *   bun run e2e            every test, in Chrome
 *   bun run e2e:ui         Playwright's window: watch each step, re-run one test
 *
 * Local only. global-setup refuses to start unless the app's database is the
 * local Docker one, then re-seeds it, so tests always begin from the same data.
 * The tests change that data, which is why they run one at a time.
 *
 * Uses the Chrome already installed on the machine (`channel: "chrome"`)
 * rather than downloading Playwright's own browsers.
 */
export default defineConfig({
  testDir: "./e2e/tests",
  globalSetup: "./e2e/global-setup.ts",
  outputDir: "./reports/e2e/results",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { outputFolder: "reports/e2e/html", open: "never" }]],
  use: {
    baseURL: "http://localhost:8080",
    channel: "chrome",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      // The flows that change data run once, at laptop size.
      name: "laptop",
      use: {
        ...devices["Desktop Chrome"],
        channel: "chrome",
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      // Every screen again at the width Sada tests on, but only the checks
      // that read: running the flows twice would trip over their own data.
      name: "phone",
      testMatch: /screens\.spec\.ts/,
      use: { channel: "chrome", viewport: { width: 390, height: 844 }, hasTouch: true },
    },
  ],
  webServer: {
    command: "bun run dev",
    url: "http://localhost:8080",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
