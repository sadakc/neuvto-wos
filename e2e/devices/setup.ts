import { chromium, type FullConfig } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { assertLocalOnly, DB_URL, signIn } from "../support/local";
import { PEOPLE, sessionFile, type Role } from "../support/people";

/**
 * Before the device tests: refuse anything but the device lab, re-seed it, and
 * sign each test person in once, at the Wi-Fi address the tests use.
 */
export default async function setup(config: FullConfig) {
  if (process.env.DEVICE_LAB !== "1" || !DB_URL.includes(":55322/")) {
    throw new Error(
      `REFUSING TO RUN. The device tests re-seed their database, and ${DB_URL} is not the device lab.\n` +
        "Run them with: bun run e2e:devices",
    );
  }
  assertLocalOnly();
  execFileSync("bash", ["scripts/device-lab.sh", "seed"], { stdio: "pipe" });

  mkdirSync("e2e/.auth-lab", { recursive: true });
  const baseURL = config.projects[0].use.baseURL;
  const browser = await chromium.launch({ channel: "chrome" });
  for (const role of Object.keys(PEOPLE) as Role[]) {
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    await signIn(page, PEOPLE[role].email);
    await context.storageState({ path: sessionFile(role) });
    await context.close();
  }
  await browser.close();
}
