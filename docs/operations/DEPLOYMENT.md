# Deployment — how code and schema actually reach each environment

**The single most important fact:** merging to `main` deploys **code** and not
**schema**. Nothing about a green CI run or a successful Lovable sync tells you
the hosted database has your migration. Applying it is a separate, manual,
deliberate step, and forgetting it is the failure mode that produces a working
build against a broken database.

---

## The three environments

| Environment           | Project ref            | Reached by                                                      | Contains                       |
| --------------------- | ---------------------- | --------------------------------------------------------------- | ------------------------------ |
| **Local**             | —                      | `supabase start` · `.env.local` · `bun run harness`             | Whatever your migrations build |
| **Lovable Cloud**     | `vkyvzhgigncranprhidn` | `neuvto.lovable.app` and `bun run dev` **without** `.env.local` | Real data — treat as shared    |
| **`neuvto-wos-prod`** | ap-south-1 (Mumbai)    | nothing yet                                                     | Cutover target, still empty    |

Because production is empty and serving nobody, **Lovable Cloud is the
pre-production environment** for the MVP. A dedicated staging project is created
at cutover, when the Supabase Pro plan is needed anyway. The harness is written
to run unchanged against all three.

See [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md) for the `.env` / `.env.local`
trap — the default `.env` points at the **shared** database.

---

## Why `supabase db push` does not work here

The Lovable Cloud project is not in Sada's own Supabase organisation. The CLI
cannot authenticate against it, so `supabase link` + `supabase db push` — the
normal path, and the one assumed by every Supabase tutorial — is unavailable.

Migrations reach Lovable Cloud one way only: **executing the SQL through
Lovable's own database tool**, then recording that it happened.

---

## Applying a migration to Lovable Cloud

Do this only after the migration is merged to `main` and CI is green. CI applies
every migration to a clean database from scratch, which is the real proof it
works.

**1 · Execute the DDL, in batches.** Split a large migration into several calls
rather than one. Large single statements intermittently return
`499 request_cancelled` — see the warning below.

**2 · Verify the objects exist.** Never assume success from the absence of an
error, or failure from its presence:

```sql
select table_name from information_schema.tables
where table_schema = 'public' order by table_name;

select routine_name from information_schema.routines
where routine_schema = 'public' order by routine_name;
```

**3 · Record the migration** so Lovable's agent does not later regenerate it:

```sql
insert into supabase_migrations.schema_migrations (version, name)
values ('20260729100425', '20260729100425_approval_engine')
on conflict (version) do nothing;
```

The `version` is the filename's timestamp prefix; `name` is the filename without
`.sql`. `statements` is left null for migrations applied this way — rows written
by Lovable's own agent populate it, ours do not, and the difference is harmless.
It is the `version` that prevents re-application.

**4 · Confirm the published site still loads.** `neuvto.lovable.app` — the
landing page uses `demo_requests`, which no platform migration touches, so a
broken landing page means something unexpected happened.

---

## ⚠️ `499 request_cancelled` does not mean the SQL failed

This has now happened twice, and both times **the DDL had executed** despite the
error. The tool call timed out; Postgres did not.

**Never retry a `499` blindly.** A blind retry re-runs DDL that already
succeeded — at best noisy errors, at worst duplicate or partially-applied
objects. Always `SELECT` against `information_schema` first and retry only the
part that is genuinely missing.

---

## ⚠️ Lovable's agent must never author migrations

Asked once to "apply" an existing migration, Lovable's agent wrote a **new
migration file with the same content** instead — which then broke
`supabase db reset` locally, because the schema was created twice.

`AGENTS.md` at the repo root now forbids this explicitly. That file is the
instruction set Lovable's agent reads, and it is the only lever available for
constraining it. Keeping `supabase_migrations.schema_migrations` in sync (step 3
above) is the second line of defence: an already-recorded migration is one the
agent has no reason to recreate.

---

## Branch protection, and the hole in it

`main` requires all three CI checks to pass before a merge. **Lovable's own
commits bypass this**, because Lovable pushes as the repository owner and
GitHub's branch protection exempts administrators unless "Do not allow
bypassing" is set — which would also lock out the Lovable integration entirely.

This is a documented, accepted risk rather than a closed one. The mitigation is
that Lovable is used for UI work, not schema, and that the harness runs on the
next push regardless of who made the previous one.

---

## Release checklist

Run before merging any step:

```bash
bun run lint && bun run typecheck && bun run test && bun run harness
```

Then, after the merge:

- [ ] CI green on `main`
- [ ] Migration applied to Lovable Cloud and verified by `SELECT`
- [ ] Row present in `supabase_migrations.schema_migrations`
- [ ] `neuvto.lovable.app` loads
- [ ] Build-sequence table in
      [../product/NEUVTO_MVP_BUILD_SPEC.md](../product/NEUVTO_MVP_BUILD_SPEC.md)
      marked `**done**`
