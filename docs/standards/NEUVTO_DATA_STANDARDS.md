# NEUVTO WOS — Data Standards

**Version:** 1.0 · **Status:** Active · **Applies to:** every migration, every table

Covers decisions **D16–D19** and **D23**. These are the rules that are cheap to apply now
and expensive to retrofit: `created_by` cannot be reconstructed once rows exist, and adding
`deleted_at` later means re-auditing every query and every policy in the codebase.

---

## 1 · Audit fields (D16)

Every business table carries four columns:

```sql
created_at  timestamptz not null default now(),
updated_at  timestamptz not null default now(),
created_by  uuid references auth.users(id) on delete set null,
updated_by  uuid references auth.users(id) on delete set null
```

### Exemptions — the complete list

"Every business table" needs an explicit list of what is not one, or the standard is untrue
as written and a future reader treats each exception as a bug to fix.

| Table              | Exempt from                                                                       | Why                                                                                                                                                                                                                                                                                                         |
| ------------------ | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `audit_logs`       | all audit fields, `deleted_at`                                                    | Insert-only and already records actor, action and time. Soft-deleting an audit row would defeat the point of having one.                                                                                                                                                                                    |
| `analytics_events` | all audit fields, `deleted_at`                                                    | Append-only event stream. `occurred_at` is its timestamp, `user_id` its actor. Events are never edited, so there is nothing for `updated_by` to mean. Removal happens by the 90-day retention purge, not by soft delete.                                                                                    |
| `modules`          | `created_by`, `updated_by`, `deleted_at`                                          | Global registry with no tenant and no user authorship — rows are seeded by migration. Retiring a module sets `status = 'retired'`, which is the soft delete for this table.                                                                                                                                 |
| `demo_requests`    | `updated_at`, `created_by`, `updated_by`, `deleted_at`, **and `organization_id`** | See below.                                                                                                                                                                                                                                                                                                  |
| `notifications`    | the `write_audit_log` trigger only — it keeps every audit column                  | A delivery queue whose rows already record recipient, content, status and time. Auditing it would copy the table into `audit_logs` at the same volume to learn nothing. `notification_templates` **is** audited, because that is configuration and a changed template changes what every customer receives. |

**`demo_requests` is the only table without `organization_id`, and that is correct.** It
captures leads from the public landing page, submitted by people who are not yet customers
and belong to no tenant. Adding an `organization_id` would mean inventing one, and the
column would be null for every row that matters.

It is therefore also the one table whose RLS cannot filter by tenant; it is protected by
being insert-only for `anon` with no read policy at all. **Do not "fix" this by adding a
tenant column** — a future agent scanning for tenancy violations will want to, and it would
be wrong.

Pure join tables carrying no independent state are also exempt.

### Maintained by trigger, never by application code

```sql
create or replace function public.set_audit_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    -- The authenticated user always wins; the fallback covers system contexts
    -- only. The reverse order would let a caller forge authorship by sending
    -- created_by in the request payload.
    new.created_by := coalesce((select auth.uid()), new.created_by);
  else
    new.created_at := old.created_at;   -- immutable
    new.created_by := old.created_by;   -- immutable
  end if;
  new.updated_at := now();
  new.updated_by := (select auth.uid());
  return new;
end $$;
```

Attached `before insert or update` on every table carrying the columns.

**Why a trigger rather than application code.** A value the application can write is a value
the application can get wrong — and an audit field that is sometimes wrong is worse than no
audit field, because it is trusted. The trigger also overwrites `created_at`/`created_by` on
update from the previous row, so history cannot be rewritten by a crafted request.

`created_by` is nullable only because system-initiated inserts (seeds, migrations, scheduled
jobs) have no authenticated user. Nothing else may leave it null.

---

## 2 · Soft delete (D17)

```sql
deleted_at timestamptz
```

on every business table. Present means deleted.

### The filter lives in the RLS policy, not in queries

```sql
create policy "read own org, not deleted"
on public.leave_requests for select
using (
  organization_id = current_org_id()
  and deleted_at is null
  and ( employee_id = (select auth.uid()) or is_manager_of(employee_id) or is_admin() )
);
```

**This is the whole point of the decision.** A `where deleted_at is null` written in
application code has to be remembered in every query forever — and the one place it gets
forgotten leaks deleted employees into a report or a balance calculation. In the policy, it
cannot be forgotten. Same reasoning as tenant isolation: enforce it where forgetting is
impossible.

### Reaching deleted rows

Admins never see deleted rows by relaxing a policy. They use an explicit function:

```sql
-- security definer, is_admin() checked inside, org-scoped
select * from public.list_deleted('leave_requests');
```

Restoring is `deleted_at = null` through a dedicated function that re-checks constraints —
a restored leave request must not violate the overlap constraint against something approved
in the meantime.

> **Not built yet.** `list_deleted()` and the restore function are specified here but do not
> exist as of Phase 0. They land with the admin screens in build step 9, which is the first
> point anything needs them. Until then there is no supported way to view a soft-deleted
> row, which is acceptable because nothing soft-deletes yet.
>
> Recorded explicitly because a standard describing a function nobody wrote is a trap: the
> next reader assumes it exists and builds on it.

### Retention

Soft delete is not forever. Hard deletion happens on a documented schedule:

| Data                                             | Retained after soft delete          | Why                                       |
| ------------------------------------------------ | ----------------------------------- | ----------------------------------------- |
| `leave_requests`, `leave_balances`, `approval_*` | **7 years**                         | Payroll and statutory record-keeping      |
| `audit_logs`                                     | **7 years**, never soft-deleted     | Immutable by policy                       |
| `profiles`                                       | 7 years, anonymised at erasure (§4) | Leave history depends on the row existing |
| `notifications`, `analytics_events`              | **90 days**                         | Operational only                          |
| `demo_requests`                                  | **24 months**                       | Sales pipeline                            |

Purging runs as a scheduled job **after** the MVP. Until then rows simply accumulate, which
is correct and safe.

---

## 3 · Constraints (D18, D19)

Business rules that must hold regardless of application code belong in the database.
Application checks race; constraints do not.

### The one that matters most — overlapping leave

```sql
create extension if not exists btree_gist;

alter table public.leave_requests
  add constraint no_overlapping_leave
  exclude using gist (
    employee_id with =,
    daterange(from_date, to_date, '[]') with &&
  )
  where (status in ('pending_approval','approved') and deleted_at is null);
```

Double-booked leave becomes **impossible to insert**, whatever the application does and
however many requests arrive at once.

The handler's overlap check (submission step 5) stays — but its job is now producing a
friendly message (_"You already have approved leave on 3–4 August"_), not guaranteeing
correctness. When the constraint fires, catch it and return `OVERLAPPING_REQUEST` rather
than a raw database error.

Note `'[]'` — the range is inclusive at both ends, because a leave request from the 1st to
the 3rd occupies the 3rd.

### CHECK constraints

```sql
-- leave_requests
check (to_date >= from_date)
check (working_days > 0)

-- leave_balances  (available_days stays a generated column)
check (entitled_days     >= 0)
check (carryforward_days >= 0)
check (used_days         >= 0)
check (reserved_days     >= 0)
check (pending_days      >= 0)

-- organization_settings
check (fy_start_month between 1 and 12)
check (fy_start_day   between 1 and 31)
check (session_idle_minutes  > 0)
check (session_absolute_hours > 0)

-- approval_chains / approval_steps
check (level > 0)
check (condition_op is null or condition_op in ('>','>=','<','<=','='))

-- leave_types
check (max_days_per_year >= 0)
check (max_per_request is null or max_per_request > 0)
```

Non-negative balance buckets matter more than they look: the harness asserts the same thing,
but the constraint stops a bad write ever landing, rather than telling you afterwards.

### Foreign keys — explicit `ON DELETE` everywhere (D19)

Never rely on the Postgres default. State the intent:

| Relationship                                             | Behaviour  | Reason                                                             |
| -------------------------------------------------------- | ---------- | ------------------------------------------------------------------ |
| `profiles.id → auth.users`                               | `cascade`  | Auth record is the identity                                        |
| `profiles.manager_id → profiles`                         | `set null` | Manager leaving must not delete reports — D14 handles reassignment |
| `profiles.organization_id → organizations`               | `restrict` | An org with employees cannot be dropped                            |
| `user_roles.user_id → auth.users`                        | `cascade`  | Roles are meaningless without the user                             |
| `leave_requests.employee_id → profiles`                  | `restrict` | Leave history must survive; use erasure instead                    |
| `leave_requests.leave_type_id → leave_types`             | `restrict` | Archive types, never delete them                                   |
| `approval_steps.approval_request_id → approval_requests` | `cascade`  | Steps are owned by the request                                     |
| `*.created_by / updated_by → auth.users`                 | `set null` | Audit outlives the account                                         |

`restrict` on `leave_requests.employee_id` is deliberate and is what forces §4 to exist.

---

## 4 · Erasure (D23)

An employee cannot simply be deleted. Their leave history carries balances, approvals, and
audit entries, and the foreign keys above prevent it by design.

```sql
-- security definer; requires is_admin(); writes an audit row
select public.erase_employee('<profile-uuid>');
```

**What it does:** overwrites `full_name` with `'Erased employee'`, `email` with a
non-routable tombstone (`erased+<id>@invalid`), clears `phone`, sets `is_active = false` and
`deleted_at = now()`, and revokes all sessions and roles.

**What it preserves:** every `leave_request`, `leave_balance`, `approval_step`, and
`audit_log` row, still linked to the tombstoned profile.

**Why this is the defensible position.** DPDP and GDPR require erasure of personal data, not
destruction of business records. The organisation retains a lawful basis to keep leave and
payroll history for statutory periods; what must go is the identification. Anonymising
satisfies the right while keeping balances reconcilable — deleting the row outright would
break every historical report and leave the audit trail pointing at nothing.

`erase_employee` must exist **before the first customer**, not be improvised during their
first erasure request.

---

## 5 · Table checklist

Every new table, without exception:

- [ ] `organization_id` present, indexed, and first in every RLS policy
- [ ] Audit fields present, trigger attached
- [ ] `deleted_at` present, and `deleted_at is null` in the read policy
- [ ] RLS enabled **in the same migration** that creates the table
- [ ] Policies use `(select auth.uid())`, never bare `auth.uid()`
- [ ] Every foreign key states `on delete`
- [ ] CHECK constraints for anything the application also validates
- [ ] Composite indexes for the queries that will actually run
