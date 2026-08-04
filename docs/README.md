# Documentation

Everything written about Neuvto WOS lives here. The repository root holds only
what a tool insists on finding there.

**Rule:** if a decision, a procedure, or a piece of hard-won knowledge matters
beyond the conversation it happened in, it belongs in a file in this folder. A
thing that exists only in a chat log does not exist.

---

## Start here

**What Neuvto is:** a platform that customers are provisioned onto, with modules
deployed onto it multi-tenant. Leave Management is the first module, not the
point. If a document here reads as though the leave product is the product, it
predates 31 Jul 2026 and is wrong.

| If you want to know                                  | Read                                                                          |
| ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| What is being built, in what order, and what is done | [product/NEUVTO_MVP_BUILD_SPEC.md](product/NEUVTO_MVP_BUILD_SPEC.md)          |
| Why something was built differently from the PRD     | the **D1–D46** decision table in the same file                                |
| Whether the platform itself is finished              | the **platform acceptance criteria** (PA1–PA10) in the same file              |
| How to run the thing on your own machine             | [operations/LOCAL_DEVELOPMENT.md](operations/LOCAL_DEVELOPMENT.md)            |
| How code and schema reach the hosted site            | [operations/DEPLOYMENT.md](operations/DEPLOYMENT.md)                          |
| Where the backups are, and whether they restore      | [operations/BACKUPS.md](operations/BACKUPS.md)                                |
| Why email works in one environment and not another   | the **Vault** section of [operations/DEPLOYMENT.md](operations/DEPLOYMENT.md) |
| How the system is shaped, for an investor or advisor | [architecture/](architecture/)                                                |

---

## What is in each folder

### [product/](product/)

**[NEUVTO_MVP_BUILD_SPEC.md](product/NEUVTO_MVP_BUILD_SPEC.md)** — the single
source of truth. The platform and its services, the module contract, the build
sequence with its status column, the verification gate for every step, and the
**D1–D46 decision table** recording every deliberate deviation from the PRD with
its reason. Its "Known gaps" section is the live list of launch blockers; there
is no separate blockers file, because two lists of blockers means one of them is
wrong.

Read the D-table before concluding something is a bug. Several things that look
wrong are decisions.

### [architecture/](architecture/)

Eight Mermaid diagrams (`diagrams/*.mmd`) and the rendered investor-facing page.
Platform stack, reuse economics, tenant isolation, request flow, components,
leave submission, the approval state machine, and the data model.

### [standards/](standards/)

The rules code must follow. CI enforces the mechanically checkable ones.

| File                           | Covers                                                          |
| ------------------------------ | --------------------------------------------------------------- |
| `NEUVTO_DATA_STANDARDS.md`     | audit columns, soft delete, constraints, erasure (D16–D19, D23) |
| `NEUVTO_SECURITY_POLICY.md`    | RLS, roles, sessions, MFA                                       |
| `NEUVTO_CODING_STANDARDS.md`   | module boundaries, the Lovable quarantine                       |
| `NEUVTO_API_STANDARDS.md`      | handler and error shapes                                        |
| `NEUVTO_DESIGN_SYSTEM.md`      | tokens, dark mode, touch targets                                |
| `NEUVTO_ANALYTICS.md`          | the event taxonomy (D25)                                        |
| `NEUVTO_AI_SEAMS.md`           | where AI could attach later (D24)                               |
| `NEUVTO_NATIVE_TRANSLATION.md` | React Native/Expo, and how a token becomes a native style       |

### [operations/](operations/)

| File                                                                    | Covers                                                                                      |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [LOCAL_DEVELOPMENT.md](operations/LOCAL_DEVELOPMENT.md)                 | running locally, and the `.env` trap that points at the shared database                     |
| [DEPLOYMENT.md](operations/DEPLOYMENT.md)                               | the three environments, why `db push` cannot work, applying migrations to Lovable Cloud     |
| [EMAIL_AND_DOMAINS.md](operations/EMAIL_AND_DOMAINS.md)                 | sign-in addresses vs the `neuvto.com` sending domain, Resend setup, where the API key lives |
| [FIRST_CUSTOMER_RUNBOOK.md](operations/FIRST_CUSTOMER_RUNBOOK.md)       | what a real customer must do to go live — and every gap that stops them                     |
| [BACKUPS.md](operations/BACKUPS.md)                                     | the Free plan has none — how to take one, how to prove it restores, and what it leaves out  |
| [AUTOSAVE.md](operations/AUTOSAVE.md)                                   | why work reaches git on its own, and the credential guard that stops it doing harm          |
| [REVIEWING_LOVABLE_CHANGES.md](operations/REVIEWING_LOVABLE_CHANGES.md) | what Lovable may never do, what needs your approval, and why it is not CODEOWNERS           |

### [agents/](agents/)

| File                                                            | Covers                                                                |
| --------------------------------------------------------------- | --------------------------------------------------------------------- |
| [AGENT_PROTOCOL.md](agents/AGENT_PROTOCOL.md)                   | the three safety tiers and what each agent may do                     |
| [TIER_MODEL_VERIFICATION.md](agents/TIER_MODEL_VERIFICATION.md) | evidence the tiers actually hold — re-run it after changing any agent |

The agent definitions themselves are in `.claude/agents/`, where Claude Code
requires them.

---

## What stays outside this folder, and why

| Path              | Why it cannot move                                              |
| ----------------- | --------------------------------------------------------------- |
| `AGENTS.md`       | Lovable's agent reads it from the repository root by convention |
| `README.md`       | GitHub's front page                                             |
| `.claude/agents/` | Claude Code loads agents from this exact path                   |
| `neuvto-harness/` | referenced by `scripts/harness.sh`, `package.json` and CI       |
| `supabase/`       | the Supabase CLI's fixed layout                                 |

---

## Files that look unused and are not

A repository audit on 4 Aug 2026 went looking for idle files. Almost everything
it flagged was a false positive, and each one would have broken something if
acted on. Recorded so the next audit is shorter, and so nobody "tidies" these.

| Looks idle because                                  | Actually                                                                                                                  |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `scripts/lovable-gate.test.ts` — nothing imports it | vitest finds tests by glob, not by import. It runs, and it is 27 of the 262 tests.                                        |
| `src/components/ui/*` — 31 files nothing imports    | the shadcn library, managed by `components.json`. Meant to sit there until a screen needs one; the CLI re-adds deletions. |
| `public/icon-192.png`, `icon-512.png`               | referenced by `manifest.webmanifest`, which is itself inside `public/` — easy to miss when a search excludes that folder. |
| `public/robots.txt`, `public/llms.txt`              | fetched by URL, by crawlers and agents. Nothing in the codebase should reference them.                                    |
| `src/integrations/supabase/auth-middleware.ts`      | generated by the Lovable Supabase integration. See below.                                                                 |
| `brand/neuvto-mark-source.png`                      | the 1024px master every icon in `public/` is generated from — see `standards/NEUVTO_NATIVE_TRANSLATION.md`.               |

`auth-middleware.ts` deserves its own note, because it is the one that is
genuinely unreferenced. It exports `requireSupabaseAuth`, a server-side
middleware the integration offers and Neuvto does not use — authorisation here
lives in the database, in RLS and `SECURITY DEFINER` RPCs, not in a middleware
layer. Its sibling `auth-attacher.ts` **is** used, from `src/start.ts`, and the
two are easy to confuse. Both carry "This file is automatically generated",
so deleting the unused one buys a regenerated copy on the next Lovable sync and
a confusing diff. Leave it.

The general lesson: in this repository, "nothing references it" is evidence, not
a verdict. Glob-discovered tests, file-based routes, statically served assets and
generated integration files are all reachable by mechanisms a grep cannot see.
