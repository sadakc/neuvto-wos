# scripts/

**Version:** 1.0 · **Status:** Active · **Updated:** 13 Oct 2026

Every script here explains itself at the top of the file. This page is the map: what each is for, and whether it can touch anything beyond this Mac.

**⚠ Production** marks a script that can read or change the live site or its database. Run those only when Sada has said to.

## Every day

| Script                | Run with                    | What it does                                                                                                         |
| --------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `guard-dev-target.sh` | (runs before `bun run dev`) | Refuses to start the dev server if `.env.local` is missing and the app would talk to production                      |
| `harness.sh`          | `bun run harness`           | The SQL test suite: seeds two companies, then checks tenant isolation, balances and every module's rules. Local only |
| `generate-tokens.ts`  | `bun run tokens`            | Writes the colour and spacing block of `src/styles.css` from `src/platform/design/tokens.ts`. Never edit the CSS     |
| `dev-lan.sh`          | `bun run dev:lan`           | Runs the app so a phone on the same Wi-Fi can open it                                                                |
| `dev-mail.sh`         | `bash scripts/dev-mail.sh`  | Makes product email work on this Mac, through the local mail catcher                                                 |

## Guardrails (CI runs these on every push)

| Script                      | What it proves                                                                                                 |
| --------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `verify-functions-wired.sh` | Every database function the migrations define is called by something                                           |
| `verify-module-removal.sh`  | A module's folder can be deleted without touching anything else                                                |
| `lovable-gate.mjs`          | Whether a pull request written by Lovable may merge. Tested by `lovable-gate.test.ts`                          |
| `lovable-gate-ci.mjs`       | Gathers the facts for the gate in CI. Kept thin; the decision is in `lovable-gate.mjs`                         |
| `review-lovable-change.sh`  | `bash scripts/review-lovable-change.sh 42`: the same facts about a Lovable PR, gathered for a person to review |

## Deploying and the live site

| Script                         | What it does                                                                                    |
| ------------------------------ | ----------------------------------------------------------------------------------------------- |
| `cloudflare-worker-config.mjs` | Finishes the Cloudflare Worker config after a build, and refuses a bad one (used by CI)         |
| `verify-deploy.sh`             | Asks the deployed site which database it talks to. Reads only                                   |
| `prod-cutover.sh`              | **⚠ Production.** Brings a Supabase project up to this repo's schema. `--check` changes nothing |
| `apply-auth-email-config.sh`   | **⚠ Production.** Applies the sign-in email settings to a hosted project                        |

## Backups

| Script                       | What it does                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `backup-prod.sh`             | **⚠ Production (reads).** Takes a backup of production and proves it restores. `--local` backs up this Mac instead |
| `backup-staleness-check.sh`  | Raises an alarm when the newest backup is more than two days old                                                   |
| `install-backup-schedule.sh` | Installs the daily backup and its alarm on this Mac (`--status`, `--remove`)                                       |

## Housekeeping

| Script                    | What it does                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `autosave.sh`             | Commits and pushes at the end of each Claude Code turn, with a credential guard. See `docs/operations/AUTOSAVE.md` |
| `generate-social-card.py` | Rebuilds `public/social-card.png`, the picture shown when neuvto.com is shared                                     |
