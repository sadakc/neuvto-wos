#!/usr/bin/env node
//
// Neuvto WOS — finish the Worker config that Nitro generates, and refuse a bad one
//
//   bun scripts/cloudflare-worker-config.mjs            patch .output/server/wrangler.json
//   bun scripts/cloudflare-worker-config.mjs --check    verify only, write nothing
//
// `bun`, not `node`: the deploy workflow sets up bun and nothing else, so a
// `node` invocation here fails in CI with 'command not found'. Caught by running
// the pipeline's steps locally in order before opening the PR.
//
// WHY THIS EXISTS
//
// Nitro writes `.output/server/wrangler.json` on every build. It is a build
// artefact, so it cannot be edited in the repository and cannot be reviewed in a
// diff — but two things in it decide what the world sees, and both have already
// gone wrong once.
//
// 1 · WHICH HOSTNAMES THE WORKER ANSWERS ON
//
// Nitro does not know about them, so a freshly generated config has no routes at
// all and `wrangler deploy` publishes to nothing but a workers.dev URL. Setting
// them in the Cloudflare dashboard instead works exactly once and is then
// invisible: nothing in the repository records which domains point at this
// Worker, and nobody can review a change to them.
//
// `CUSTOM_DOMAINS` below is that record. A Custom Domain — as opposed to a
// route — makes Cloudflare create the DNS record AND issue the certificate. A
// bare route does neither, which is why `*wos.neuvto.com/*` sat there
// configured and doing nothing on 17 Aug 2026: the hostname did not resolve, so
// no request ever reached Cloudflare for the route to match.
//
// 2 · THE COMPATIBILITY DATE, WHICH IS WHY THE CHECK BELOW EXISTS
//
// Nitro defaults it to "today" as computed from the BUILD MACHINE'S LOCAL CLOCK.
// Cloudflare validates it against UTC and rejects anything in the future:
//
//     Can't set compatibility date in the future: 2026-08-18  [code: 10021]
//
// India is UTC+5:30, so every build run between 00:00 and 05:30 IST produces a
// date Cloudflare refuses. It failed exactly that way at 01:31 IST on 18 Aug
// 2026. CI runners are UTC and would never see it, which is what makes it
// dangerous: it is invisible to the pipeline and reproducible only on the
// machine of whoever is awake late.
//
// `NITRO_COMPATIBILITY_DATE` in the build environment pins it. This script is
// the belt to that braces — it fails the build if the date is in the future
// rather than letting the deploy fail after the artefact has been verified.
//
// A compatibility date that floats with the calendar is wrong for a second
// reason anyway: it silently changes the Workers runtime's behaviour between two
// builds of identical source.

import { readFileSync, writeFileSync } from "node:fs";

/**
 * Every hostname this Worker serves.
 *
 * THE HOSTNAME MUST HAVE NO DNS RECORD BEFORE IT IS ADDED HERE. A Custom
 * Domain creates the record and issues the certificate itself, so Cloudflare
 * refuses to attach one to a hostname that already has a hand-made record:
 *
 *     Hostname 'neuvto.com' already has externally managed DNS records
 *     (A, CNAME, etc). Delete them first.            [code: 100117]
 *
 * There is no atomic swap and no override. Every apex cutover therefore has a
 * window where the hostname does not resolve at all. On 18 Aug 2026 that
 * window was ten minutes for `neuvto.com`. Sequence it as: merge the hostname
 * here, delete the existing DNS record, trigger the deploy immediately.
 *
 * Do NOT create the Custom Domain in the dashboard instead. Its `Add Domain`
 * field takes the subdomain LABEL and appends the zone, so typing `neuvto.com`
 * creates `neuvto.com.neuvto.com` — a live record under a nonsense hostname,
 * discovered while the apex was down. This list is exact hostnames and has no
 * such ambiguity.
 *
 * Rollback is NOT to Netlify — those sites were deleted on 19 Aug 2026 and
 * there is nothing to point DNS back at. Roll a bad release back through
 * Workers -> Deployments, which restores a previous version in one click and
 * touches no DNS. That is the better rollback anyway: DNS is on Cloudflare's
 * nameservers, so any failure big enough to need a host switch would have taken
 * DNS with it.
 *
 * `www.neuvto.com` is deliberately absent and adding it here will not work:
 * Custom Domains match the hostname exactly, so a Worker on the apex never sees
 * `www`. It is handled by a Cloudflare Redirect Rule instead — zone config, not
 * code, which is why ENVIRONMENTS.md records it under "The www redirect".
 */
const CUSTOM_DOMAINS = ["neuvto.com", "wos.neuvto.com"];

const CONFIG = ".output/server/wrangler.json";

const config = JSON.parse(readFileSync(CONFIG, "utf8"));
const problems = [];

// ── the compatibility date must not be in the future, in UTC
//
// Compared as strings against a UTC date, which is the comparison Cloudflare
// itself makes. `toISOString` is always UTC regardless of the machine's zone —
// using a local-time date here would reproduce the very bug this catches.
const todayUtc = new Date().toISOString().slice(0, 10);
const date = config.compatibility_date;

if (!date) {
  problems.push("compatibility_date is missing entirely");
} else if (date > todayUtc) {
  problems.push(
    `compatibility_date ${date} is in the future (UTC today is ${todayUtc}). ` +
      `Nitro took it from the local clock. Set NITRO_COMPATIBILITY_DATE in the build environment.`,
  );
}

if (!config.name) problems.push("worker name is missing");
if (!config.compatibility_flags?.includes("nodejs_compat")) {
  problems.push("nodejs_compat is not enabled — the Supabase client needs it");
}

if (problems.length) {
  console.error("cloudflare-worker-config: REFUSED\n");
  for (const p of problems) console.error(`  • ${p}`);
  process.exit(1);
}

const checkOnly = process.argv.includes("--check");

if (checkOnly) {
  const declared = JSON.stringify(config.routes?.map((r) => r.pattern) ?? []);
  console.log(`cloudflare-worker-config: ok — ${config.name}, ${date}, routes ${declared}`);
  process.exit(0);
}

config.routes = CUSTOM_DOMAINS.map((pattern) => ({ pattern, custom_domain: true }));

// Explicit rather than left to wrangler's defaults, which flip depending on
// whether `routes` is present and warn about it on every deploy.
config.workers_dev = false;

writeFileSync(CONFIG, JSON.stringify(config, null, 2));

console.log(`cloudflare-worker-config: ${config.name} @ ${date}`);
for (const d of CUSTOM_DOMAINS) console.log(`  custom domain  ${d}`);
