# Purging test data from production

**Version:** 1.2 · **Status:** Active · **Updated:** 9 Aug 2026

Neuvto is being tested **in production**, on purpose — it is the only environment
that proves the real thing works. Sada's instruction, 8 Aug 2026:

> Any data that I'd add now might be a hard delete later. I might ask you to do a
> hard delete later, once all my testing is done.

This document is what makes that possible in one command instead of a forensic
exercise. It was written while production still held one organisation, because
the cheap moment to prepare for a deletion is before the data exists.

> ## ⚠️ Which workspaces are which, as of 9 Aug 2026
>
> | Workspace                                                     | Marked                          |
> | ------------------------------------------------------------- | ------------------------------- |
> | **Acme Services** (`acme`)                                    | **test** — "End to End Testing" |
> | **Extreme Security Solutions** (`extreme-security-solutions`) | **NO — a real customer**        |
>
> Confirmed by Sada on 9 Aug 2026 and verified in the database, not inferred.
> **Nothing may ever delete Extreme Security Solutions.** It is unmarked, so the
> registry already refuses it; this note exists so that nobody "helpfully" marks
> it later on the strength of the word "Security" looking like a test fixture.

---

## The part that expires — now closed

Until 8 Aug 2026 there was **no marker on test data**: nothing in the schema said
which organisation was real and which was a rehearsal. That cost nothing while
production held exactly **one** organisation — "delete the test data" and "delete
everything" were the same sentence — and would have become unanswerable at the
second, because from then on every day of testing adds rows only memory can
classify.

`20260821100000_a_test_workspace_says_so.sql` closes it. The marker now lands
**before** the second organisation, which was the whole point of doing it that
week rather than in October. What it deliberately does **not** include is a purge
function: a registry with no purge is inert and safe, a purge with no registry is
the accident.

### Done, and the margin was one day

**The existing production workspace was marked on 9 Aug 2026.** The migration
performed no backfill, on purpose — a migration cannot tell whether a real
customer was provisioned between the day it was written and the day it was
applied, and the failure that would cause is a customer silently joining the
allow-list a purge deletes from.

That was not a theoretical worry. **Extreme Security Solutions was provisioned
while this change was being built** — between the analysis that found "production
holds exactly one organisation" and the deploy that shipped the marker. A backfill
written the day before would have enrolled a paying customer in the purge list,
and nothing would have said so.

A person looks at the list instead:

```sql
select id, name, slug, created_at from public.organizations where deleted_at is null;
```

**Do it from the console, not in SQL.** Open the customer list, press **Mark as
test** on the row, and type what it is being used for. Nothing else is needed.

The reason field is not ceremony: marking is the direction that puts a workspace
on the purge allow-list, so it asks for a typed answer rather than accepting a
single click. Removing a marking — **Not a test** — is one click, because that
can only make a purge refuse more.

**Read the row before you press it** rather than trusting the table at the top of
this page. The whole reason there is no backfill is that this document cannot
know what was provisioned after it was written — which is exactly what happened
between its two versions.

For any workspace created from now on, tick **This is an internal test
workspace** while provisioning instead — it marks in the same transaction and
needs no follow-up.

The SQL equivalent, for a database with no console in front of it:

```sql
select public.platform_mark_test_organization(
  '<organization-uuid>', 'Sada''s own testing, Aug 2026');
```

---

## What a hard delete has to touch

### `delete from public.organizations` does not work

The foreign keys are deliberately built to stop it. Three of the nineteen tables
that point at `organizations` refuse the delete rather than following it:

| Table           | `on delete` | Effect                |
| --------------- | ----------- | --------------------- |
| `profiles`      | `restrict`  | **blocks the delete** |
| `departments`   | `restrict`  | **blocks the delete** |
| `client_errors` | `no action` | **blocks the delete** |
| the other 16    | `cascade`   | follows it            |

This is D19 working as designed — an employee with leave history must not
evaporate because somebody removed a row. It means a purge is an ordered
sequence, not a statement.

### Two tables are not reachable from an organisation at all

| Table           | Why it is missed                                                |
| --------------- | --------------------------------------------------------------- |
| `audit_logs`    | has `organization_id` but **no foreign key** to `organizations` |
| `demo_requests` | has no `organization_id` — a prospect belongs to no workspace   |

`audit_logs` would be left pointing at an organisation id that no longer exists. `demo_requests` is worse in kind: it holds **real strangers'
names and email addresses** from the landing page, is subject to the 24-month
retention in `NEUVTO_DATA_STANDARDS.md` §2, and has nothing to do with test data.
Deleting test rows must not touch it; deleting it needs its own reason.

### `auth.users` survives everything

Deleting a profile does not delete the person's sign-in identity — 49 foreign
keys point at `auth.users`, and none of them run the other way. Purge the
organisation and its members can still sign in, landing in a workspace that no
longer exists.

The harness already knows this and handles it by email suffix:

```sql
delete from auth.users where email like '%@acme.test';
```

Production has no such suffix to filter on, which is the second argument for the
marker.

---

## The order

Child to parent, every statement scoped `where organization_id = _org`. This is
the harness's ordering (`neuvto-harness/seed/seed_test_data.sql`) adapted from
`truncate ... cascade`, which cannot be scoped to one tenant:

```
leave_requests → leave_balances → leave_types
approval_steps → approval_requests → approval_chains
notifications → notification_templates → audit_logs → holidays
analytics_events → user_roles → profiles → departments
invitations → client_errors → report_schedules
organization_modules → module_settings → organization_settings
organizations
```

then the members' `auth.users` rows, and only those who belong to no surviving
organisation.

> ⚠️ **`notification_templates` must be filtered by `organization_id = _org`, not
> emptied.** The rows with `organization_id is null` are installed by migrations —
> they are schema, not data. Removing them on 7 Aug 2026 left a database where
> Leave's scheduled email could not be rendered, and every check still passed.
> The full account is in the header of the harness seed. Scoping by organisation
> avoids it by construction; do not "simplify" it back to a bare delete.

---

## What was built (D64)

**A platform-side registry, not a column on `organizations`.**

```sql
create table public.platform_test_organizations (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  reason          text not null,   -- non-blank, enforced by CHECK
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id) on delete set null
);
```

- **Not `organizations.is_test`,** because a flag sitting on a customer table
  invites a second code path — `if is_test then don't send the email` — and a
  test workspace that behaves differently from a real one tests nothing. Nothing
  in the product may ever read this table.
- **The reason must contain a letter or a digit** — `reason ~ '[[:alnum:]]'`, in
  both the CHECK and the function guard. Not `btrim`, which strips ASCII space
  and nothing else: a reason of one TAB satisfied it, and so did an NBSP and a
  zero-width space, each rendering as an empty tooltip beside a workspace on the
  purge list. In October the question will not be "is this a test" but "what was
  I testing".
- **It is platform metadata about a tenant, not tenant data** (D42): RLS on, no
  policy, no grant, and an explicit `revoke all ... from anon, authenticated`,
  because Supabase's stock default privileges hand TRUNCATE to every signed-in
  session on any table created without one.

| Function                                         | Who      | Does                                    |
| ------------------------------------------------ | -------- | --------------------------------------- |
| `provision_organization(..., _is_test => true)`  | platform | marks in the creating transaction       |
| `platform_mark_test_organization(_org, _reason)` | platform | marks an existing workspace             |
| `platform_unmark_test_organization(_org)`        | platform | for a rehearsal that became real        |
| `platform_list_organizations()`                  | platform | now returns `is_test` and `test_reason` |

All four are `SECURITY DEFINER`, check `is_platform_admin()`, and are granted to
`authenticated` **and revoked from `public` and `anon`** — Postgres grants EXECUTE
to PUBLIC on every new function and `anon` inherits it, which this migration got
wrong once before the harness caught it.

The console shows a **Test** badge on marked rows, so the list Sada reads before
asking for a purge says which are his own.

Three invariants in `verify_invariants.sql` hold the shape, each watched failing
before it was trusted: the registry is unreachable from any session (checked with
`has_table_privilege`, because the obvious `grantee in ('anon','authenticated')`
form is blind to a grant made to PUBLIC — which is how a real defect got through
this same migration); exactly four functions read the table, so a product query
that joins it fails the harness; and no marking carries an unreadable reason.

### A marking is hard to remove, and that is the sharp edge

`platform_unmark_test_organization` is the **only** way a marking goes away. The
`on delete cascade` cannot help: `profiles` and `departments` are `RESTRICT`, so
any workspace with a member refuses a hard delete entirely. And
`platform_list_organizations` filters `deleted_at is null`, so a workspace that
is both marked and soft-deleted appears on no list and can be reviewed by
nothing.

Practical consequence: **if the checkbox is ticked for a real customer, notice it
before they are soft-deleted.** While they are still on the list, **Not a test**
fixes it in one click. After a soft delete the row is on no list, and the fix is
raw SQL against production.

---

## Still to come: the purge itself

`platform_purge_test_organization(_org uuid)` — `security definer`, platform-admin
only, and **refuses any organisation not in the registry**. That refusal is the
whole safety property: the function cannot be pointed at a customer, however it
is called. It deletes in the order above, then the members' `auth.users` rows.

Not written yet, deliberately. It is wanted in October, it is an hour's work
against a registry that now exists, and every week it does not exist is a week
nothing can delete a customer by accident.

---

## Until then

Production data is safe to accumulate, and now accumulates labelled.
