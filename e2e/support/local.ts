/**
 * Everything the browser tests need from the machine: the guard that keeps them
 * off any real database, the local database itself, and the local mail catcher
 * that holds sign-in codes.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import type { Page } from "@playwright/test";

export const DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
export const MAIL_URL = "http://127.0.0.1:54324";

const LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/;

/**
 * `bun run dev:lan` points the app at this Mac's own Wi-Fi address so a phone
 * can reach it. That is still the local stack: an address that belongs to one
 * of this machine's own network interfaces, and nothing else, is accepted too.
 */
export function isLocalTarget(url: string) {
  return LOCAL.test(url) || isThisMachine(url);
}

function isThisMachine(url: string) {
  const m = /^https?:\/\/([0-9.]+)(:\d+)?(\/|$)/.exec(url);
  if (!m) return false;
  return Object.values(networkInterfaces())
    .flat()
    .some((i) => i?.family === "IPv4" && i.address === m[1]);
}

/**
 * Refuses unless the app's database is local Docker. Resolves the URL as Vite
 * does (`.env.local` wins over `.env`): the dev server these tests drive reads
 * it the same way, so this is the database the clicks would reach.
 */
export function assertLocalOnly() {
  const read = (file: string) =>
    existsSync(file)
      ? readFileSync(file, "utf8")
          .split("\n")
          .filter((l) => /^\s*VITE_SUPABASE_URL=/.test(l))
          .map((l) => l.replace(/^[^=]*=/, "").replace(/^["']|["']\s*$/g, ""))
          .pop()
      : undefined;
  const url = read(".env.local") ?? read(".env") ?? "";
  if (!isLocalTarget(url)) {
    throw new Error(
      `REFUSING TO RUN. The app would talk to ${url || "nothing"}, which is not the local stack.\n` +
        "These tests re-seed the database and change its data. Start the local stack\n" +
        "(supabase start) and make sure .env.local points at http://127.0.0.1:54321.",
    );
  }
}

function psqlPath() {
  const candidates = [
    process.env.PSQL,
    "/opt/homebrew/opt/libpq/bin/psql",
    "/usr/local/opt/libpq/bin/psql",
    "/opt/homebrew/bin/psql",
    "/usr/local/bin/psql",
  ];
  const found = candidates.find((c) => c && existsSync(c));
  if (!found) throw new Error("psql not found. Install libpq (brew install libpq) or set PSQL.");
  return found;
}

/** Runs SQL against the local database and returns the first column of each row. */
export function sql(query: string): string[] {
  const out = execFileSync(psqlPath(), [DB_URL, "-Atq", "-v", "ON_ERROR_STOP=1", "-c", query], {
    encoding: "utf8",
  });
  return out.split("\n").filter(Boolean);
}

export function seed() {
  execFileSync(
    psqlPath(),
    [DB_URL, "-q", "-v", "ON_ERROR_STOP=1", "-f", "neuvto-harness/seed/seed_test_data.sql"],
    {
      stdio: "pipe",
    },
  );
}

/** The six-digit code most recently mailed to `email` after `since`. */
async function codeFor(email: string, since: number): Promise<string> {
  for (let i = 0; i < 60; i++) {
    const res = await fetch(
      `${MAIL_URL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}&limit=1`,
    );
    const msg = ((await res.json()) as { messages: { Created: string; Snippet: string }[] })
      .messages[0];
    if (msg && Date.parse(msg.Created) >= since - 1000) {
      const code = /\b\d{6}\b/.exec(msg.Snippet)?.[0];
      if (code) return code;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No sign-in code reached the local mail catcher for ${email}.`);
}

/** Signs in through the real screen: email, then the code from the mail catcher. */
export async function signIn(page: Page, email: string) {
  await page.goto("/auth");
  await page.getByLabel("Work email").fill(email);
  const since = Date.now();
  await page.getByRole("button", { name: "Email me a code" }).click();
  await page.getByLabel("6-digit code").fill(await codeFor(email, since));
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(/\/app(\/|$)/);
}

export { codeFor };
