import { chromium, type FullConfig } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { assertLocalOnly, seed, signIn, sql } from "./support/local";
import { PEOPLE, sessionFile, type Role } from "./support/people";

/**
 * Before any test: refuse a non-local database, re-seed it, and sign each test
 * person in once. Seeding first matters, because the seed replaces the auth users
 * and so ends every session made before it.
 */
export default async function globalSetup(config: FullConfig) {
  assertLocalOnly();
  seed();
  // The seed grants Leave only. Employee is granted here as Neuvto grants it
  // to a customer (platform_set_module): on, for Acme alone.
  sql(`insert into public.organization_modules (organization_id, module_key, enabled, enabled_at)
       values ('00000000-0000-0000-0000-0000000000a0', 'employee', true, now())
       on conflict (organization_id, module_key) do update set enabled = true, deleted_at = null`);

  mkdirSync("e2e/.auth", { recursive: true });
  const baseURL = config.projects[0].use.baseURL;
  const browser = await chromium.launch({ channel: "chrome" });
  for (const role of ["hr", "employee", "manager", "colleague", "superAdmin"] as Role[]) {
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    await signIn(page, PEOPLE[role].email);
    await context.storageState({ path: sessionFile(role) });
    await context.close();
  }
  await browser.close();
}
