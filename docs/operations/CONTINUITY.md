# Continuity

**Version:** 1.1 · **Status:** Active · **Updated:** 19 Aug 2026

**The question this answers:** Neuvto is currently built and operated largely
through Claude Code. If that stops — a lapsed subscription, a different machine,
a different week — what still works, what does not, and what are the options?

The short answer is that **most of the platform is already independent of it.**
That is not luck. The console exists so that operating Neuvto is not an
engineering task, and the standing rule that every decision goes into `docs/`
rather than a chat log exists for exactly this scenario. This file is the
inventory that makes the claim checkable.

---

## 1. "Managing neuvto.com" is four jobs, and one of them needs a developer

| Job                                                                                                                                                    | How it is done                                                                                                      | Needs an AI or a developer?         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| **Run the business** — provision a customer, turn a module on, check whether email is working, read the week's client errors, mark a workspace as test | `/neuvto-hq`, in a browser                                                                                          | **No.** Point and click             |
| **Ship code that already exists**                                                                                                                      | `git push` to `main` → `.github/workflows/deploy.yml` → live                                                        | **No**                              |
| **Prove a change is safe**                                                                                                                             | `.github/workflows/ci.yml` — lint, typecheck, 595 tests, the SQL harness, architecture guardrails, the Lovable gate | **No.** It runs itself              |
| **Apply a schema change**                                                                                                                              | migrations in `supabase/migrations/`, then `scripts/prod-cutover.sh`                                                | A terminal, not an AI               |
| **Write new code, or diagnose a hard fault**                                                                                                           | today: Claude Code                                                                                                  | **Yes — this is the only real gap** |

Everything above the last row keeps working with nobody's help. The rest of this
document is about that last row, and about the three things that break for
reasons that have nothing to do with tooling (§4).

---

## 2. What the console already does without a developer

`/neuvto-hq` is the platform console. Sada is the only platform admin (D42), and
platform admins never read tenant data. It covers:

| Task                                    | Backed by                                              |
| --------------------------------------- | ------------------------------------------------------ |
| See every customer workspace            | `listOrganizations`                                    |
| Provision a new customer and its admin  | `provisionOrganization`                                |
| Turn a module on or off for a customer  | `listOrganizationModules`, `setOrganizationModule`     |
| Mark / unmark a workspace as a test one | `markTestOrganization`, `unmarkTestOrganization` (D64) |
| Check whether outbound email is healthy | `getMailHealth`                                        |
| Read the last 7 days of client errors   | `getClientErrors`                                      |

All of it goes through `SECURITY DEFINER` RPCs that check `is_platform_admin()`.
There is no self-serve signup by design (D39), so **provisioning a customer is a
console task, not a code task.** That is the single most important line in this
file: onboarding a new customer tomorrow requires no engineer at all.

---

## 3. Options for writing code without Claude Code

Ranked by how well each fits this repository, not by general quality.

### 3.1 Claude Code, somewhere else — the likeliest non-problem

Claude Code is not only a terminal program. The same tool runs in the desktop
app, at `claude.ai/code`, and as VS Code and JetBrains extensions. If "no Claude
Code" means "not this CLI on this machine", there is nothing to solve.

Note that `.claude/agents/` must stay where it is — Claude Code loads agents from
that exact path, and the specialist agents (`db-guardian`, `screen-prover`,
`refusal-prover`, `release-gate`, and the rest) are a real part of how this
codebase is kept honest. `docs/agents/AGENT_PROTOCOL.md` describes their tiers.

### 3.2 Lovable — already connected, already fenced

Lovable writes to this repository today. It is not a new integration to set up.
Its guardrails already exist:

- `scripts/lovable-gate.mjs` and `lovable-gate-ci.mjs` run in CI
- `scripts/review-lovable-change.sh` for a local review
- `docs/operations/REVIEWING_LOVABLE_CHANGES.md` states what it may never do
- `NEUVTO_CODING_STANDARDS.md` defines the Lovable quarantine

**Good for:** landing-page copy, marketing sections, component styling.
**Keep it away from:** migrations, RLS policies, grants, the approval engine.
It once scaffolded a conflicting email system here, which is why the gate exists.

**Cost:** the free tier is thin. Check the current plan before depending on it —
nothing is paid until the MVP ships.

### 3.3 A general AI IDE — Cursor, Copilot, Windsurf

They read `CLAUDE.md` and `AGENTS.md` the same way Claude Code does, so the house
rules travel. They will not run the harness or the tier model on their own; run
`bun run harness` and the CI gate yourself.

### 3.4 A contract developer

This repository is more handoff-ready than most funded startups. A competent
engineer has, on day one:

- **23 documents** covering standards, operations and architecture
- the **D1–D66 decision table**, every deviation recorded with its reasoning —
  read it before concluding something is a bug, because several things that look
  wrong are decisions
- a **SQL harness** that proves tenant isolation rather than asserting it
- **595 tests** and a CI gate that blocks a bad merge

Hand them `docs/README.md` and `docs/product/NEUVTO_MVP_BUILD_SPEC.md`, in that
order.

### 3.5 Yourself, with the docs

`LOCAL_DEVELOPMENT.md`, `DEPLOYMENT.md` and `FIRST_CUSTOMER_RUNBOOK.md` were
written for a person, not for an agent.

### Recommendation

Console for operations. Lovable for cosmetic changes. A contractor for anything
that touches the database. **The CI gate is what makes any of these safe** —
whoever writes the code, lint, typecheck, 595 tests and the harness still have to
pass before it can merge.

---

## 4. What actually breaks tomorrow, and none of it is about tooling

### 4.1 There are no backups — this is the one that could cost the company

Supabase's Free plan has no automatic backups. Not short retention — **none**.
Production holds a real customer's data (Extreme Security Solutions). The only
backups that can exist are the ones `scripts/backup-prod.sh` writes, and they
exist only on the machine that ran it.

See `BACKUPS.md`. This is unresolved and does not depend on Claude Code in any
way.

### 4.2 Every secret exists only with one person

The database password, the Resend API key and the service role key are held by
Sada alone. That is correct under D42 — staff never read tenant data, and no
agent has ever handled a secret here — and it is simultaneously a single point of
failure. If Sada is unavailable, **nobody can operate the platform**, regardless
of which tool they have.

Worth deciding: a sealed record of where each secret lives (not the values) so a
trusted second person could recover access.

### 4.3 ~~The Netlify deploy budget is a clock~~ — resolved 18 Aug 2026

`neuvto.com` is served by Cloudflare Workers, which meters no deploys at any
tier. The clock this section described — 300 credits a month at 15 per deploy,
twenty publishes before the project paused — is gone, and the Netlify sites were
deleted on 19 Aug 2026.

Kept rather than removed because it is the clearest example of the risk this
whole document is about: **a free tier with a hard limit is a deadline nobody put
in a calendar.** The replacement has its own limits — Workers' free tier is
100,000 requests a day and a 3 MB compressed script, against a bundle currently
at about 0.7 MB. Neither is close, and both should be checked before they are
assumed. See `ENVIRONMENTS.md`.

---

## 5. If a handover happened tomorrow

In order:

1. **Take a backup first.** `scripts/backup-prod.sh`, and prove it restores.
   `BACKUPS.md` has the procedure.
2. **Give the successor the docs, not a tour.** `docs/README.md` is the index and
   is kept current.
3. **Do not let them start with a migration.** Have them run the app locally
   (`LOCAL_DEVELOPMENT.md`), then `bun run harness`, and watch it pass — then
   break something deliberately and watch it fail. A green suite nobody has seen
   fail is not evidence.
4. **Point them at the D-table before the code.** It is the difference between
   "this is wrong" and "this was decided".
5. **Keep the CI gate.** It is the only thing standing between a well-meaning
   change and a tenant-isolation defect.

---

## Related

| Document                                                         | Why                                                      |
| ---------------------------------------------------------------- | -------------------------------------------------------- |
| [BACKUPS.md](BACKUPS.md)                                         | the unresolved risk named in §4.1                        |
| [ENVIRONMENTS.md](ENVIRONMENTS.md)                               | the Cloudflare migration that clears §4.3                |
| [DEPLOYMENT.md](DEPLOYMENT.md)                                   | how code and schema actually reach production            |
| [FIRST_CUSTOMER_RUNBOOK.md](FIRST_CUSTOMER_RUNBOOK.md)           | what a customer must do to go live                       |
| [REVIEWING_LOVABLE_CHANGES.md](REVIEWING_LOVABLE_CHANGES.md)     | the fence around §3.2                                    |
| [../agents/AGENT_PROTOCOL.md](../agents/AGENT_PROTOCOL.md)       | what each agent may do, and the tiers                    |
| [../architecture/PORTABILITY.md](../architecture/PORTABILITY.md) | the other continuity question — leaving Supabase for AWS |
