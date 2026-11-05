import { defineConfig, devices } from "@playwright/test";
import { execFileSync } from "node:child_process";

/**
 * Phone tests, run the way a phone reaches the app (D119).
 *
 *   bash scripts/device-lab.sh up      once: the device lab's own database
 *   bun run e2e:devices                every phone width, iPhone (WebKit), then Android if an emulator is running
 *
 * Against the DEVICE LAB, never the usual local stack: these tests re-seed and
 * change data, and the usual stack holds what Sada is testing by hand.
 *
 * Through this Mac's Wi-Fi address, never localhost. Browsers treat localhost
 * as a secure page and a plain-http Wi-Fi address as not secure, and some
 * browser features exist only on secure pages: an upload that passed every
 * test on localhost failed on Sada's phone (D118).
 *
 * Projects:
 *   phone-360/390/430   Chrome at the narrow, common and large phone widths (doc 11.7)
 *   iphone              WebKit, Safari's engine, at iPhone size: Safari's own rules, not Chrome's
 *   android             real Chrome on the Android Emulator (e2e/devices/android.spec.ts); skipped without one
 *
 * The iOS Simulator's own Safari is covered by `bun run e2e:ios`
 * (e2e/devices/ios-simulator.ts), which this file does not run.
 */
const lab = labEnv();
Object.assign(process.env, lab);

const phone = (width: number) => ({
  ...devices["Pixel 7"],
  channel: "chrome",
  viewport: { width, height: 844 },
  isMobile: true,
  hasTouch: true,
});

export default defineConfig({
  testDir: "./e2e/devices",
  globalSetup: "./e2e/devices/setup.ts",
  outputDir: "./reports/devices/results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 300_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { outputFolder: "reports/devices/html", open: "never" }]],
  use: {
    baseURL: lab.E2E_BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "phone-360", testMatch: /phone\.spec\.ts/, use: phone(360) },
    { name: "phone-390", testMatch: /(phone|flows)\.spec\.ts/, use: phone(390) },
    { name: "phone-430", testMatch: /phone\.spec\.ts/, use: phone(430) },
    {
      name: "iphone",
      testMatch: /(phone|flows)\.spec\.ts/,
      use: { ...devices["iPhone 15"], browserName: "webkit" },
    },
    { name: "android", testMatch: /android\.spec\.ts/ },
  ],
  webServer: {
    command: "bash scripts/device-lab.sh dev",
    url: lab.E2E_BASE_URL,
    reuseExistingServer: true,
    timeout: 180_000,
    stdout: "ignore",
  },
});

/** The device lab's addresses, from the script that runs it, so there is one source. */
function labEnv(): Record<string, string> {
  const out = execFileSync("bash", ["scripts/device-lab.sh", "env"], { encoding: "utf8" });
  const env: Record<string, string> = {};
  for (const m of out.matchAll(/^export (\w+)=(.*)$/gm)) env[m[1]] = m[2];
  if (!env.VITE_SUPABASE_PUBLISHABLE_KEY)
    throw new Error("The device lab is not running. Start it: bash scripts/device-lab.sh up");
  return env;
}
