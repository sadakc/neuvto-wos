# Neuvto WOS

A multi-tenant **Workforce Operating System**. Leave Management is the first
module; Attendance, Payroll and the rest follow on the same foundations.

**Platform first.** Approvals, notifications, audit, the working calendar and
RBAC are shared services that know nothing about leave. The test is deliberately
awkward and it is enforced: the Approval Engine is driven end to end by a
non-leave entity type, with zero leave tables in existence. A service testable
only through the module it was written for is not a service.

---

## Read this first

**→ [docs/README.md](docs/README.md)** — the map of everything written down.

|                                        |                                                                                |
| -------------------------------------- | ------------------------------------------------------------------------------ |
| What is being built, and what is done  | [docs/product/NEUVTO_MVP_BUILD_SPEC.md](docs/product/NEUVTO_MVP_BUILD_SPEC.md) |
| Running it locally                     | [docs/operations/LOCAL_DEVELOPMENT.md](docs/operations/LOCAL_DEVELOPMENT.md)   |
| Getting a migration to the hosted site | [docs/operations/DEPLOYMENT.md](docs/operations/DEPLOYMENT.md)                 |
| The rules code must follow             | [docs/standards/](docs/standards/)                                             |

---

## Getting started

```bash
bun install
supabase start        # needs Docker running
supabase db reset     # applies every migration to a clean database
bun run dev           # http://localhost:8080
```

> **Create `.env.local` before `bun run dev`.** The committed `.env` points at
> the **shared hosted database** that also serves the live site, so a plain
> `bun run dev` will create real users and send real email.
> [LOCAL_DEVELOPMENT.md](docs/operations/LOCAL_DEVELOPMENT.md) has the file to
> write.

## Checks

```bash
bun run lint && bun run typecheck && bun run test && bun run harness
```

`bun run harness` seeds two deliberately different organisations — one Indian on
an April financial year with a Saturday/Sunday weekend, one Gulf on January with
Friday/Saturday — then asserts tenant isolation and data integrity against a
real Postgres. It refuses to run against a non-local database, because the seed
truncates.

All four run in CI on every push and gate merges to `main`.

---

## How it is built

- **TanStack Start** · React · TypeScript · Tailwind
- **Supabase** — Postgres with row-level security as the isolation boundary
- **Multi-tenant on a shared schema** — `organization_id` on every table, RLS
  policies rather than application-layer filtering
- **Lovable** for UI iteration, synced through this repository

Architecture diagrams: [docs/architecture/](docs/architecture/).

## Repository layout

```
docs/          everything written down — start at docs/README.md
src/
  platform/    shared services; must not import from any module
  modules/     business modules; must not import each other
  routes/      TanStack Start file routes
supabase/
  migrations/  the schema, in order — the source of truth for the database
neuvto-harness/  SQL tenant-isolation and data-integrity suite
.claude/agents/  the diagnostic agents and their safety tiers
AGENTS.md        instructions for Lovable's agent
```

Both import rules above are enforced by CI, not by good intentions.
