# Documentation

Everything written about Neuvto WOS lives here. The repository root holds only
what a tool insists on finding there.

**Rule:** if a decision, a procedure, or a piece of hard-won knowledge matters
beyond the conversation it happened in, it belongs in a file in this folder. A
thing that exists only in a chat log does not exist.

---

## Start here

| If you want to know                                  | Read                                                                 |
| ---------------------------------------------------- | -------------------------------------------------------------------- |
| What is being built, in what order, and what is done | [product/NEUVTO_MVP_BUILD_SPEC.md](product/NEUVTO_MVP_BUILD_SPEC.md) |
| Why something was built differently from the PRD     | the **D1–D25** decision table in the same file                       |
| How to run the thing on your own machine             | [operations/LOCAL_DEVELOPMENT.md](operations/LOCAL_DEVELOPMENT.md)   |
| How code and schema reach the hosted site            | [operations/DEPLOYMENT.md](operations/DEPLOYMENT.md)                 |
| How the system is shaped, for an investor or advisor | [architecture/](architecture/)                                       |

---

## What is in each folder

### [product/](product/)

**[NEUVTO_MVP_BUILD_SPEC.md](product/NEUVTO_MVP_BUILD_SPEC.md)** — the single
source of truth. Schema, the build sequence with its status column, the
verification gate for every step, and the **D1–D25 decision table** recording
every deliberate deviation from the PRD with its reason. Its "Known gaps"
section is the live list of launch blockers; there is no separate blockers file,
because two lists of blockers means one of them is wrong.

Read the D-table before concluding something is a bug. Several things that look
wrong are decisions.

### [architecture/](architecture/)

Eight Mermaid diagrams (`diagrams/*.mmd`) and the rendered investor-facing page.
Platform stack, reuse economics, tenant isolation, request flow, components,
leave submission, the approval state machine, and the data model.

### [standards/](standards/)

The rules code must follow. CI enforces the mechanically checkable ones.

| File                         | Covers                                                          |
| ---------------------------- | --------------------------------------------------------------- |
| `NEUVTO_DATA_STANDARDS.md`   | audit columns, soft delete, constraints, erasure (D16–D19, D23) |
| `NEUVTO_SECURITY_POLICY.md`  | RLS, roles, sessions, MFA                                       |
| `NEUVTO_CODING_STANDARDS.md` | module boundaries, the Lovable quarantine                       |
| `NEUVTO_API_STANDARDS.md`    | handler and error shapes                                        |
| `NEUVTO_DESIGN_SYSTEM.md`    | tokens, dark mode, touch targets                                |
| `NEUVTO_ANALYTICS.md`        | the event taxonomy (D25)                                        |
| `NEUVTO_AI_SEAMS.md`         | where AI could attach later (D24)                               |

### [operations/](operations/)

| File                                                              | Covers                                                                                      |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [LOCAL_DEVELOPMENT.md](operations/LOCAL_DEVELOPMENT.md)           | running locally, and the `.env` trap that points at the shared database                     |
| [DEPLOYMENT.md](operations/DEPLOYMENT.md)                         | the three environments, why `db push` cannot work, applying migrations to Lovable Cloud     |
| [EMAIL_AND_DOMAINS.md](operations/EMAIL_AND_DOMAINS.md)           | sign-in addresses vs the `neuvto.com` sending domain, Resend setup, where the API key lives |
| [FIRST_CUSTOMER_RUNBOOK.md](operations/FIRST_CUSTOMER_RUNBOOK.md) | what a real customer must do to go live — and every gap that stops them                     |
| [AUTOSAVE.md](operations/AUTOSAVE.md)                             | why work reaches git on its own, and the credential guard that stops it doing harm          |

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
