# NEUVTO WOS — Verification harness

Catches the bugs a manual click-through won't: cross-tenant leaks, balance drift,
broken approval chains. Runs against **any** environment, unchanged.

## Files

| File                          | Purpose                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------ |
| `seed/seed_test_data.sql`     | Two orgs with deliberately different config, full role spread, edge-case employees   |
| `tests/verify_rls.sql`        | Tenant isolation, scope enforcement, privilege escalation, audit immutability        |
| `tests/verify_invariants.sql` | Balance arithmetic, reservation reconciliation, approval integrity, cross-tenant FKs |

Both verify scripts **raise an exception on the first violation**. Silence means pass.

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

**During MVP (Lovable Cloud):** run through the Lovable database tool — that backend
is Lovable-managed and not reachable from the Supabase dashboard.

**After cutover (your own Supabase):** run against `neuvto-wos-prod`
(`udrzhfgwqgolvyimbwto`, ap-south-1) or staging, via the SQL editor or MCP.

Order matters:

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
