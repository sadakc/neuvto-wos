# NEUVTO WOS — Verification harness

Catches the bugs a manual click-through won't: cross-tenant leaks, balance drift,
broken approval chains. Runs against **any** environment, unchanged.

## Files

| File                             | Purpose                                                                                  |
| -------------------------------- | ---------------------------------------------------------------------------------------- |
| `seed/seed_test_data.sql`        | Two orgs with deliberately different config, full role spread, edge-case employees       |
| `tests/verify_rls.sql`           | Tenant isolation, scope enforcement, privilege escalation, storage and module boundaries |
| `tests/verify_invariants.sql`    | Balance arithmetic, reservation reconciliation, approval integrity, cross-tenant FKs     |
| `tests/verify_first_run.sql`     | An organisation built the way the product builds one, then used                          |
| `tests/verify_concurrency.sh`    | D10 — two submissions racing for a balance that covers one                               |
| `tests/verify_scheduled_work.sh` | D43 — the work that is supposed to happen on its own actually happens                    |

The SQL scripts **raise an exception on the first violation**. Silence means pass.

## The one that invokes nothing

`verify_scheduled_work.sh` is the odd one out, and the reason it exists belongs
in front of anyone editing this directory.

Every other check here asks the product to do something and inspects what
happened. All of them passed while **nothing in this repository ran on a
schedule** — no cron, no scheduled function, nothing. Invitations were rendered
correctly, queued correctly, and sat in `notifications` forever. The dispatcher's
own comment said "Invoked on a schedule", and that comment was the only
occurrence of the word in the codebase. It survived four build steps because
every assertion invoked the dispatcher by hand first.

**A queue nobody drains is indistinguishable from a queue with nothing in it.**
Telling them apart means refusing to invoke anything and waiting, so this file
queues work and watches. It takes up to a minute, deliberately.

Where delivery is configured it asserts the queue drains unattended. Where it is
not — CI has no Vault secrets by design — it asserts the run *says so out loud*,
because silent success is the exact shape of the original fault.

## Why two organizations

Tenant isolation is untestable with one tenant. Most seed scripts create one company
and prove nothing. Org B (Vertex) also runs a **January financial year** and a
**Friday/Saturday weekend** with a **single-level approval chain** — so if anything
was hardcoded to Org A's April FY, Sat/Sun weekend, or two-level approvals, Org B breaks.

Edge cases seeded on purpose:

- `newjoiner.emp@acme.test` — joined October, mid-FY. Pro-rated entitlement must be ~half.
- `nomanager.emp@acme.test` — no `manager_id`. Approval resolution must fail gracefully, not crash.
- `priya.emp@acme.test` — only 3 days available. Requesting 5 must be blocked.
- `ghost@orphan.test` — authenticated but has **no profile row**. Must see nothing, anywhere.
- One `archived` leave type — must not appear in the apply form.

## Running

**Locally — the normal case:**

```bash
supabase start          # Docker must be running
bun run harness
```

The runner finds `psql` itself (Homebrew installs it keg-only, off `PATH`) and defaults to
the local stack. It **skips cleanly** when no Neuvto schema exists yet, and every block
guards itself on table existence — so it verifies whatever the current build phase has
created rather than requiring a finished schema.

**In CI:** the `database` job applies every migration to a clean Supabase stack and runs
this suite on each push. That is the only place it runs automatically.

**Against a remote database:** the runner **refuses** a non-local target unless
`--allow-remote` is passed, because the seed truncates. Never pass it against production.

Order matters when running the files by hand:

```
1. seed/seed_test_data.sql
2. tests/verify_rls.sql
3. tests/verify_invariants.sql
```

## When to run

After **every** build step, per the sequence in `../NEUVTO_MVP_BUILD_SPEC.md`.
A regression caught at the step that caused it takes minutes to fix; caught four
steps later it takes an afternoon to locate.

Scripts reference tables that later phases create. Sections guard themselves with
`information_schema` checks where the table may not exist yet, so early runs
verify what exists and skip the rest.

## Safety

`seed_test_data.sql` **truncates tables and deletes auth users**. Test environments only.
It only removes users on `@acme.test`, `@vertex.test`, and `@orphan.test` domains, but the
`truncate` is unconditional. Never point it at an environment holding real customer data.
