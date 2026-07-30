# NEUVTO WOS — MVP Build Spec (Platform + Leave Management)

**Derived from:** `02_PRODUCT_PRINCIPLES.md`, `03_PLATFORM_ARCHITECTURE.md`, `04_MODULE_ROADMAP.md`, `06_LEAVE_MANAGEMENT.md`, `07_ROLES_PERMISSIONS.md` (all v1.0)
**Target:** Lovable project `neuvto` (`c74d04ee-25dd-4be1-a46e-f8973fe8c5d4`)
**Stack:** TanStack Start + TypeScript + Tailwind + shadcn/ui + Supabase (Lovable Cloud)
**Status:** Revised for platform-first — 28 Jul 2026

---

## Architectural stance

Per **Principle 1: Platform Before Features**, this build produces a **Platform Layer** and one **Business Module** that consumes it. Leave Management owns no capability that a second module would also need.

```
BUSINESS MODULE            Leave Management
                                  ↓ consumes
PLATFORM LAYER    Auth · Users · Org Structure · RBAC · Settings
                  Approval Engine · Notification Engine · Audit Log
                  Working Calendar · Module Registry
                                  ↓
INFRASTRUCTURE            Supabase (Postgres + Auth + Edge Functions)
```

### Platform services built in MVP

Authentication · User Management · Organization Service · Roles & Permissions · **Approval Engine** · **Notification Engine** · **Audit Log** · Organization Settings · **Working Calendar** · **Module Registry**

**Selection rule:** a service is built generically when Leave Management exercises it _and_ a roadmap module has a stated dependency on it. All six above are named dependencies of Attendance (Q4 2026, `04_MODULE_ROADMAP.md` lines 94–100).

### Platform services deferred

Workflow Engine (Approval Engine covers MVP state transitions) · Reports Service (module-local reports in MVP; generalise when a second module reports) · Documents Service · Search Service · Branding Service · Theme Service.

**Rationale:** no second consumer exists yet. Per Principle 5, an abstraction with zero consumers is speculative. Each is additive — none requires reworking the schema below.

---

## Scope decisions

These override the source docs where they conflict. Deviations are deliberate and recorded.

| #   | Decision                                                                                                                                                                               | Overrides                                                                                                                                                                           |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Responsive web app, mobile-first.** One codebase, PWA-installable.                                                                                                                   | PRD line 1362 (React Native/Flutter) — not buildable in Lovable                                                                                                                     |
| D2  | **Balance reserved on submission**, released on reject/cancel.                                                                                                                         | PRD Rules 3–4 — as written, employees can overdraw                                                                                                                                  |
| D3  | **Entitlement pro-rated within the financial year**, capped at max. FY start per-organization.                                                                                         | PRD Rule 1 — unbounded formula, no `joined_date` source                                                                                                                             |
| D4  | **Roles in a separate table** behind `SECURITY DEFINER` functions; enum not string arrays.                                                                                             | PRD line 436 (`roles UUID[]` on users) — privilege-escalation risk under RLS                                                                                                        |
| D5  | **Approval chains are data, not code.** L1 always; L2 when a configured condition matches. Default: days > 3.                                                                          | PRD Rules 6–7 — realises them as configuration per Principle: _configuration over customization_                                                                                    |
| D6  | Weekend/holiday exclusion **in MVP**. Email notifications **in MVP**. Attachments and escalation cron **deferred**.                                                                    | PRD scope list                                                                                                                                                                      |
| D7  | **Settings split:** typed columns for platform calendar/FY (integrity — they feed generated columns); JSONB key-value for module settings (new modules need no migration).             | `03` §12 pure key-value store                                                                                                                                                       |
| D8  | **Email OTP + Google OAuth.** No passwords.                                                                                                                                            | `03` §Security specifies OTP; current build uses passwords. Phone OTP deferred — needs an SMS provider and Indian DLT registration                                                  |
| D9  | **Per-organization timezone**, default `Asia/Kolkata`. All "today" comparisons resolve in org-local time.                                                                              | Not in any source doc — a genuine omission                                                                                                                                          |
| D10 | **Balance rows locked `FOR UPDATE`** inside the submission transaction.                                                                                                                | Not in any source doc — D2 alone stops sequential overdraw but not concurrent                                                                                                       |
| D11 | **CSV employee import and opening-balance entry in MVP.**                                                                                                                              | `03` §User Management lists bulk import; opening balances were unaddressed                                                                                                          |
| D12 | **Balance rows created lazily** on first read for a financial year, not by a scheduled job.                                                                                            | Nothing in the PRD creates next year's rows                                                                                                                                         |
| D13 | **Approval chain skips an approver who is the requester**, advancing to the next level; if no level resolves, the request fails with `APPROVER_UNRESOLVED` rather than auto-approving. | PRD does not define manager-applies-for-own-leave                                                                                                                                   |
| D14 | **Deactivating a user requires reassigning their reports and open approvals.**                                                                                                         | PRD does not define manager departure                                                                                                                                               |
| D15 | **Branding and Theme services deferred.** Per-org theming is additive because every colour resolves through a CSS variable.                                                            | Principle 9 (White-Label Ready) — deliberate deferral, confirmed 28 Jul 2026                                                                                                        |
| D16 | **Audit fields on every business table** — `created_at`, `updated_at`, `created_by`, `updated_by`, maintained by trigger, never by application code.                                   | Not in any source doc — `created_by` cannot be backfilled once data exists                                                                                                          |
| D17 | **Soft delete** — `deleted_at` on business tables, enforced **inside the RLS policy**, not by query convention.                                                                        | Not in any source doc — retrofitting means re-auditing every query and policy                                                                                                       |
| D18 | **Overlapping leave prevented by a Postgres exclusion constraint**, not only by the handler check.                                                                                     | PRD Rule 11 — the application check races; a constraint does not                                                                                                                    |
| D19 | **Explicit `ON DELETE` on every foreign key.** No Postgres defaults.                                                                                                                   | Not in any source doc                                                                                                                                                               |
| D20 | **Per-organization session policy** — idle and absolute timeouts; sessions revoked on role change or deactivation.                                                                     | `03` §Security mentions auto-logout but specifies nothing                                                                                                                           |
| D21 | **TOTP MFA required for `org_admin` and `hr_admin`**; employees use email OTP alone.                                                                                                   | Principle 7 names MFA; nothing specified it                                                                                                                                         |
| D22 | **RPO ≤ 5 min, RTO 4 h, quarterly restore drill** that runs the harness against the restored copy.                                                                                     | Not in any source doc                                                                                                                                                               |
| D23 | **`erase_employee()` anonymises personal data and retains leave history.**                                                                                                             | `03` §Compliance promises erasure; deleting the row would break every balance and report                                                                                            |
| D24 | **AI seams defined, no AI infrastructure built.** If retrieval is ever needed it is `pgvector` in the same database — never a separate vector service.                                 | Principle 6 anticipates AI; Principle 5 forbids building it with no consumer                                                                                                        |
| D25 | **Analytics events stored in-database**, not sent to a third-party SaaS.                                                                                                               | Not in any source doc — avoids adding a processor holding employee behavioural data                                                                                                 |
| D26 | **The emitter names the event; the engine names the recipients.** Modules emit `approval.submitted`, never "email the approver".                                                       | Not in any source doc — a module that named recipients would be edited every time an organisation wanted its HR admin copied in                                                     |
| D27 | **Values substituted into templates are HTML-escaped.**                                                                                                                                | Not in any source doc — a leave reason is user input landing in an HTML email a manager opens                                                                                       |
| D28 | **A notification never fails the transaction that caused it.** A missing template records a failed notification; it does not roll back the approval.                                   | Not in any source doc — mail is not worth losing somebody's approved leave over                                                                                                     |
| D29 | **A notification that failed for a reason that might not recur is retried with exponential backoff, up to a cap.** A reason that certainly will recur is terminal immediately.         | Not in any source doc — step 5 claimed this in a comment and did not implement it, so a momentary blip lost an approval email permanently                                           |
| D30 | **A module reacts to platform events with a trigger it defines itself**, on a platform table. The platform never names a module.                                                       | Not in any source doc — a hook inside approval_decide naming 'leave_request' would invert the dependency, and application code would move balances outside the decision transaction |
| D31 | **A balance cannot be overdrawn** — enforced by CHECK, not by remembering to look.                                                                                                     | Found by sabotage: two locks were defending an invariant nothing asserted, and removing both left available_days at -3                                                              |
| D32 | **Modules declare themselves; the platform reads manifests.** `src/modules/registry.ts` is the only file outside a module that names one, and CI proves a module can be deleted.       | Sada, 30 Jul 2026 — "only touch the individual module and not the entire code itself"                                                                                               |

**Companion standards:** `docs/standards/NEUVTO_DATA_STANDARDS.md` (D16–D19, D23) ·
`NEUVTO_SECURITY_POLICY.md` (D20–D22) · `NEUVTO_ANALYTICS.md` (D25) · `NEUVTO_AI_SEAMS.md` (D24)

### Contracts first

**Every build step opens by writing the Zod contracts for its endpoints** in
`src/modules/*/contracts/` — URL, request, response, auth, error codes, validation. Types
derive from the schema, so the contract cannot drift from the code. Per-endpoint specs are
not written upfront: endpoints whose shape is still moving produce documents that go stale.

### Roles in MVP

`org_admin` · `hr_admin` · `manager` · `employee`
Deferred: Co-Admin, Finance, Ops, custom roles.

### Also deferred

Parallel approval (Rule 9) · bulk approve · attachments · escalation cron (Rule 8) · SMS · push · offline drafts · carry-forward · encashment · Reports 2 and 5.

---

# PHASE 0 — Platform Layer: tenancy, identity, RBAC

### Enums

```sql
create type public.app_role as enum ('org_admin','hr_admin','manager','employee');
```

### Tables

**`organizations`** — `id uuid pk`, `name`, `slug unique`, `industry_type`, `created_at`

**`organization_settings`** — `organization_id uuid pk references organizations`

- `timezone text not null default 'Asia/Kolkata'` — **D9**. Every "is this date in the past" check resolves via `(now() at time zone timezone)::date`, never the server clock. A UTC server against an IST org is wrong about today's date for 5½ hours a day.
- `fy_start_month smallint not null default 4`, `fy_start_day smallint not null default 1`
- `weekend_days smallint[] not null default '{0,6}'` (0 = Sunday)
- `exclude_weekends boolean default true`, `exclude_holidays boolean default true`
- `allow_retroactive boolean default false`, `default_min_notice_days integer default 0`
- `notify_on_submit`, `notify_on_approve`, `notify_on_reject` `boolean default true`

**`module_settings`** — `(organization_id, module_key, setting_key)` pk, `value jsonb` — **D7**, module config without migrations

**`departments`** — `id`, `organization_id`, `name`, `parent_department_id` self-ref

**`profiles`** — `id uuid pk references auth.users on delete cascade`

- `organization_id not null`, `full_name`, `email not null`, `phone`
- `joined_date date not null default current_date` — required by D3
- `manager_id uuid references profiles(id)` — reporting line, drives approvals
- `department_id uuid references departments(id)`
- `is_active boolean default true`
- unique `(organization_id, email)`

**`user_roles`** — **D4**, deliberately separate from `profiles`
`id`, `user_id`, `organization_id`, `role app_role`, unique `(user_id, organization_id, role)`

**`modules`** — `key text pk` (`'leave'`, `'attendance'`…), `name`, `status`
**`organization_modules`** — `(organization_id, module_key)` pk, `enabled boolean default false`, `enabled_at`

### Security-definer functions

All `SECURITY DEFINER`, `STABLE`, `set search_path = public` — required to avoid RLS recursion.

```
current_org_id()                      → uuid
has_role(_user_id, _role)             → boolean
is_admin()                            → org_admin or hr_admin
is_manager_of(_employee_id)           → boolean
module_enabled(_module_key)           → boolean
```

### Universal column set — D16, D17

Every business table below carries, in addition to its own columns:

```sql
created_at timestamptz not null default now(),
updated_at timestamptz not null default now(),
created_by uuid references auth.users(id) on delete set null,
updated_by uuid references auth.users(id) on delete set null,
deleted_at timestamptz
```

Maintained by the `set_audit_fields()` trigger. `audit_logs` is exempt — insert-only, and
already carries actor and timestamp. Full rules in `docs/standards/NEUVTO_DATA_STANDARDS.md`.

**`analytics_events`** — `id`, `organization_id`, `user_id`, `event text`, `properties jsonb`,
`occurred_at`. Org-scoped under RLS, retained 90 days (D25).

### RLS baseline

RLS on every table. Every policy filters `organization_id = current_org_id()` **first**, then
`deleted_at is null` (D17), then role/scope. `user_roles` is writable only by `is_admin()` —
never by the user themselves.

Soft-delete filtering lives in the policy, never in application queries: one forgotten
`where deleted_at is null` otherwise leaks deleted employees into a report or a balance.

**Gate:** Org A cannot read one row of Org B through any query, as any role. An employee cannot insert their own `org_admin` row.

### Authentication — D8

- **Email OTP** (Supabase `signInWithOtp`) as the primary flow: email → 6-digit code → session. No password to set, forget, or reset — which also removes the missing password-reset gap.
- **Google OAuth** retained for admins, but moved behind our own `src/platform/auth/` wrapper. The current direct `lovable` import in `src/routes/auth.tsx` is the known portability violation and is fixed as part of this step.
- Password sign-in removed. Test accounts migrate by requesting an OTP on the same email.
- OTP expiry and session duration come from settings, never hardcoded.
- Phone OTP deferred: needs an SMS provider and Indian DLT template registration. The auth wrapper is written so adding it is one method.

### Deactivation — D14

Deactivating a user is a guarded operation, not a flag flip. Before `is_active` goes false:

1. Their direct reports must be reassigned to another manager
2. Their pending approval steps must be reassigned or escalated
3. Their own in-flight leave requests must be resolved or cancelled

Blocked with a clear error otherwise. A silently deactivated manager strands every approval routed to them.

---

# PHASE 1 — Platform services

## 1.1 Audit Log Service (`03` §8)

**`audit_logs`** — `id`, `organization_id`, `actor_id`, `action text` (`'leave.request.create'`), `entity_type`, `entity_id`, `before jsonb`, `after jsonb`, `ip_address`, `user_agent`, `created_at`

**Immutable:** RLS grants `INSERT` only. No `UPDATE` or `DELETE` policy exists for any role. Readable by `is_admin()` within org.

Written by trigger on every platform and module table that mutates business state. Modules never write audit rows directly.

## 1.2 Working Calendar Service (`03` lines 217–219)

**`holidays`** — `id`, `organization_id`, `name`, `holiday_date`, unique `(organization_id, holiday_date)`
_Platform-level: Attendance and Shift Management consume the same calendar._

```sql
get_financial_year(_org_id, _ref date) returns text
  -- reads fy_start_month/day → label like '2026-27'

calculate_working_days(_org_id, _from date, _to date) returns numeric
  -- excludes weekend_days when exclude_weekends
  -- excludes holidays when exclude_holidays
  -- returns 0 when the range contains no working day
```

## 1.3 Approval Engine (`03` §5) — **generic, entity-agnostic**

**`approval_chains`** — configuration, per org, per entity type

- `id`, `organization_id`, `entity_type text` (`'leave_request'`), `level smallint`
- `approver_rule text` — `'reporting_manager'` · `'manager_of_manager'` · `'role'`
- `approver_role app_role` (when rule = `'role'`)
- `condition_field text` (e.g. `'working_days'`), `condition_op text` (`'>'`), `condition_value numeric`
- `escalate_after_days integer` (stored now, acted on post-MVP)
- unique `(organization_id, entity_type, level)`

> **D5 realised:** the "more than 3 days needs two levels" rule is a row —
> `level=2, approver_rule='manager_of_manager', condition_field='working_days', condition_op='>', condition_value=3`.
> An org changes its threshold, or adds a third level, without a deploy.

**`approval_requests`** — `id`, `organization_id`, `entity_type`, `entity_id`, `requester_id`, `status`, `current_level`, `required_levels`, `context jsonb`, `created_at`, `completed_at`

**`approval_steps`** — `id`, `approval_request_id`, `level`, `approver_id`, `decision` (`pending`/`approved`/`rejected`), `comments`, `decided_at`

### Engine API (server functions)

```
approval_submit(entity_type, entity_id, context jsonb) → approval_request_id
  evaluates approval_chains against context, resolves approvers,
  creates request + level-1 step, emits 'approval.submitted'

  D13 — approver resolution rules, in order:
    • resolved approver = requester        → skip this level, try the next
    • resolved approver is inactive        → skip this level, try the next
    • no level resolves to a valid approver → raise APPROVER_UNRESOLVED
  Never auto-approve when a chain cannot be resolved. A manager applying for
  their own leave must escalate, not self-approve. An org with no managers
  configured must fail loudly at submission rather than silently approving
  everything.

approval_decide(approval_request_id, decision, comments)
  records step; advances to next level or completes;
  emits 'approval.decided'; on completion emits
  'approval.completed' with final status

approval_pending_for(user_id) → set of approval_requests
```

Leave Management calls these. It does not implement approval logic.

## 1.4 Notification Engine (`03` §6)

**`notification_templates`** — `id`, `organization_id` (null = system default), `event_key`, `channel` (`email`/`in_app`), `subject_template`, `body_template`, `is_active`
**`notifications`** — `id`, `organization_id`, `recipient_id`, `event_key`, `channel`, `payload jsonb`, `status` (`pending`/`sent`/`failed`), `sent_at`, `read_at`

```
notify(event_key, recipient_id, payload jsonb)
  → resolves org template (falls back to system default),
    renders, enqueues; edge function delivers via Resend
```

Modules emit events. They never call Resend.

**MVP event keys:** `approval.submitted` · `approval.decided` · `approval.completed`

**Gate:** the Approval Engine can drive a throwaway `entity_type` end to end with no leave tables present.

---

# PHASE 2 — Leave Management module

Registers itself in `modules` as `'leave'`. All screens and functions check `module_enabled('leave')`.

### Enums

```sql
create type public.leave_status as enum
  ('draft','pending_approval','approved','rejected','cancelled');
```

_Approval levels live in the Approval Engine, not in this enum._

### Tables

**`leave_types`** — `id`, `organization_id`, `name`, `description`, `max_days_per_year numeric`, `approval_required boolean default true`, `max_per_request numeric`, `min_notice_days integer`, `status` (`active`/`archived`), unique `(organization_id, name)`

**`leave_balances`** — unique `(organization_id, employee_id, leave_type_id, fy_label)`

- `fy_label text` from `get_financial_year()`
- `entitled_days`, `carryforward_days`, `used_days`, `reserved_days`, `pending_days` — all `numeric not null default 0`
- `available_days numeric generated always as (entitled_days + carryforward_days - used_days - reserved_days - pending_days) stored`

**`leave_requests`** — `id`, `organization_id`, `employee_id`, `leave_type_id`, `from_date`, `to_date`, `working_days numeric`, `reason`, `status leave_status`, `approval_request_id uuid references approval_requests`, `submitted_at`, `decided_at`, `rejection_reason`, timestamps
Indexes on `(organization_id, employee_id)` and `(organization_id, status)`.

**Overlap made impossible — D18.** The handler check (submission step 5) stays for the
friendly message, but correctness is enforced by the database:

```sql
create extension if not exists btree_gist;

alter table leave_requests add constraint no_overlapping_leave
  exclude using gist (
    employee_id with =,
    daterange(from_date, to_date, '[]') with &&
  ) where (status in ('pending_approval','approved') and deleted_at is null);
```

When it fires, catch it and return `OVERLAPPING_REQUEST` rather than a raw database error.
`'[]'` is inclusive at both ends — leave from the 1st to the 3rd occupies the 3rd.

### Module function

```sql
calculate_entitlement(_employee_id, _leave_type_id, _fy) returns numeric
  -- D3: months of the FY the employee is active, from joined_date
  -- round(max_days_per_year * active_months / 12, 1), capped at max, floored at 0

ensure_balance(_employee_id, _leave_type_id, _fy) returns leave_balances
  -- D12: lazily creates the row on first read for a financial year,
  -- seeding entitled_days from calculate_entitlement(). Idempotent.
  -- Called by every balance read and by the submission flow.
  -- Chosen over a scheduled rollover job: no cron to fail silently on
  -- 1 April, and a new hire mid-year gets a balance the moment they log in.
```

### Submission flow (transactional)

0. **`select ... from leave_balances where ... for update`** — **D10**. Lock the balance row _before_ validating. Without this, two concurrent submissions both read `available_days = 3`, both pass step 6, and both insert. Reservation alone prevents sequential overdraw, not simultaneous.
1. `to_date >= from_date`
2. Reject past dates unless `allow_retroactive`, comparing against **org-local today** (D9)
3. Enforce `min_notice_days` (type, falling back to org default)
4. `working_days = calculate_working_days(...)`; reject 0 → _"Weekend/holiday only: you cannot apply for non-working days only"_
5. Reject overlap with any `pending_approval` or `approved` request
6. Reject if `working_days > available_days` → _"You requested N days but have only M days available"_
7. Enforce `max_per_request`
8. Insert request; **`reserved_days += working_days`**
9. `approval_submit('leave_request', id, {working_days, leave_type_id, employee_id})` — engine decides levels via `approval_chains`
10. Audit trigger records `leave.request.create`

### Decision handling

Subscribes to `approval.completed` for `entity_type = 'leave_request'`:

- **approved** → status `approved`; `reserved_days -= days`; `pending_days += days` (or `used_days` if already past)
- **rejected** → status `rejected`; `reserved_days -= days`
- **cancelled by employee** before start → `cancelled`; release from whichever bucket holds the days

**Daily maturation:** approved requests past `to_date` move `pending_days → used_days`.

**Gate:** `available = entitled + carryforward − used − reserved − pending` holds after every operation, across multiple leave types.

---

# PHASE 3 — UI

### Employee (mobile-first, 48px targets, bottom tab nav)

- **Dashboard** — balance cards with used/available progress, pending count, next approved leave, Apply CTA, all above the fold
- **Apply Leave** — type selector, range picker (past dates disabled), live working-days calc, live balance line `Available: 8 | Requested: 3 | Remaining: 5`, reason (500 chars), submit disabled while invalid
- **My Leave** — filterable list, detail with approval timeline and comments, cancel before start
- **Calendar** — month view; approved blue, pending yellow, today grey

### Manager (web, sidebar nav)

- **Approvals** — queue from `approval_pending_for()`, showing employee, type, dates, days, days-waiting, level badge
- **Detail** — employee context, current balance, reason, full approval history, approve/reject with comment
- **Team calendar** — direct reports, colour-coded

### Admin (web)

- Leave types (archive, never delete)
- **Holiday calendar** (platform)
- **Approval chain editor** (platform) — levels, approver rule, condition, threshold
- **Org settings** — FY start month/day, weekend days, exclusion toggles, min notice, retroactive, notification toggles
- **Members** — invite, assign role, set `manager_id`, `joined_date`, department
- **Module registry** — enable/disable modules per org
- **CSV employee import** (D11) — upload, column mapping, dry-run preview showing what will be created and what will fail, per-row error reporting, partial success. Required columns: `email`, `full_name`, `joined_date`; optional: `manager_email`, `department`, `role`. Manager links resolve by email in a second pass so order in the file doesn't matter.
- **Opening balances** (D11) — for customers onboarding mid-year: per employee per leave type, set `used_days` and `carryforward_days` directly. Available as a column in the same CSV and as an inline edit on the balance report. Every override writes an audit row with the previous value — this is `leave:balance:override` from `07`, and it must be traceable.
- Reports 1, 3, 4 with CSV export

---

## Build sequence

**Progress as of 30 Jul 2026:** steps 0 through 5 are merged to `main`. The harness carries
100 RLS assertions and the invariant suite, passing locally and in CI, and is verified
non-vacuous — every guard has been watched to fail under deliberate sabotage. Step 6 is next.

| Status   | Step | Content                                                                            | Gate                                                                                                     |
| -------- | ---- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **done** | 0    | Vitest + GitHub Actions CI                                                         | Lint, typecheck, unit tests, and the SQL harness run on every push                                       |
| **done** | 1    | Phase 0 — schema, RLS, security-definer functions                                  | Cross-org isolation verified by SQL as each role                                                         |
| **done** | 2    | Phase 0 — email OTP auth, auth wrapper, app shell, role-aware nav, org signup      | Sign up → `/app` with correct nav per role; no `lovable` import outside the quarantine                   |
| **done** | 3    | Phase 1 — Audit Log + Working Calendar (incl. org timezone)                        | Day math matches PRD Case 4; audit rows immutable; org-local "today" correct across the IST/UTC boundary |
| **done** | 4    | Phase 1 — Approval Engine                                                          | Drives a dummy entity type end to end, no leave tables; self-approval skips to next level                |
| **done** | 5    | Phase 1 — Notification Engine + Resend                                             | Template renders, email delivers, `notifications` row marked sent                                        |
| **done** | 6    | Phase 2 — Module SDK + Leave schema, entitlement, lazy balances, locked submission | Balance invariant holds under **concurrent** submission; engine creates correct levels                   |
| next     | 7    | Phase 3 — Employee UI                                                              | PRD AC1–AC3, AC5, AC7                                                                                    |
| —        | 8    | Phase 3 — Manager UI + decision handling                                           | PRD AC4, AC6; Cases 1, 2, 3, 6                                                                           |
| —        | 9    | Phase 3 — Admin config incl. chain editor + guarded deactivation                   | PRD AC9; deactivating a manager with reports is blocked                                                  |
| —        | 10   | CSV employee import + opening balances                                             | 50-row import dry-run reports per-row errors; overrides audited                                          |
| —        | 11   | Reports 1, 3, 4 + CSV export                                                       | —                                                                                                        |

### Testing

**Vitest** for unit tests, **GitHub Actions** for CI. Required coverage regardless of percentage:

- Every handler's failure paths, not just the happy path
- `calculate_working_days` against the PRD's weekend and holiday cases
- `calculate_entitlement` for mid-year joiners and a non-April financial year
- Balance transitions across submit → approve → reject → cancel
- Approval resolution when the manager is missing, inactive, or is the requester
- **A concurrency test** issuing two simultaneous submissions against a balance that only covers one — this is the D10 regression guard and cannot be verified by hand

CI runs lint, typecheck, `vitest`, then the SQL harness. A red build blocks the next step.

### Verification gate

**Every step above is gated by `neuvto-harness/`** — seed, then `verify_rls.sql`, then `verify_invariants.sql`. Both raise on the first violation; silence is a pass. No step is considered complete until the harness passes against it.

There is no separate staging environment during the MVP: production (`neuvto-wos-prod`) is empty and serving nobody, so Lovable Cloud _is_ the pre-production environment. A dedicated `neuvto-wos-staging` project is created at cutover, when Pro is required anyway. The harness is written to run unchanged against all three.

---

## Infrastructure & scaling

### Database

Supabase Postgres throughout. Lovable Cloud _is_ managed Supabase, so there is no engine migration — only a change of which instance is owned.

| Environment | Project                                    | Region                  | Use                                  |
| ----------- | ------------------------------------------ | ----------------------- | ------------------------------------ |
| Development | Lovable Cloud (auto-provisioned)           | Lovable-managed         | MVP build                            |
| Production  | `neuvto-wos-prod` (`udrzhfgwqgolvyimbwto`) | **ap-south-1 (Mumbai)** | Cutover target                       |
| _Retired_   | `hmunuegliswufvfgxjmi`                     | ap-northeast-1          | Paused, empty — delete via dashboard |

Region chosen for Indian customer latency and data residency. **Supabase regions are immutable after creation.**

### Cutover plan

Trigger: **before the first paying customer**, while all users are still test accounts.

1. Upgrade `neuvto-wos-prod` to Pro — required for PITR and to stop 7-day auto-pause
2. Run `supabase/migrations/*.sql` against it in order
3. Swap `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`
4. Verify RLS as each role before pointing DNS

Migrating `auth.users` between Supabase projects is awkward — this is why the cutover happens before real users exist.

### Multi-tenancy model

**Shared schema + `organization_id` + RLS (pooled).** Correct to the low thousands of tenants. Rejected: schema-per-tenant (migration cost grows with customer count), database-per-tenant (operationally expensive). Because `organization_id` is on every table, a single enterprise tenant demanding physical isolation can be peeled out later without redesign.

### Capacity

100 customers × 200 employees ≈ 20k people ≈ 400k leave requests/year; with approval steps and audit rows ≈ 3–4M rows/year. Not a constraint on any Postgres tier. **Storage is not the scaling risk.**

### RLS performance — mandatory in every migration

The actual scaling risk. Required in all policies:

- Wrap `auth.uid()` as **`(select auth.uid())`** so Postgres evaluates it once as an InitPlan rather than per row
- All security-definer helpers declared **`STABLE`** so results cache within a statement
- Index `organization_id` on **every** table; composites on `(organization_id, employee_id)` and `(organization_id, status)`
- Policies filter `organization_id` **first**, then role/scope

Omitting these turns a million-row `leave_requests` scan into a per-row function call. This breaks around customer 20 and is a code defect, not an infrastructure one.

---

## Test scenarios before demo

1. Employee with 3 available days requests 5 → blocked, exact message
2. Employee submits 3 separate in-balance requests → third blocked by reservation (**the D2 bug**)
3. Fri–Mon with weekends excluded → 2 days, not 4
4. Request spanning a configured holiday → holiday not counted
5. 3-day request → 1 level; 4-day request → 2 levels
6. **Admin edits the chain threshold from 3 to 5 → a 4-day request now needs 1 level, no deploy** (D5 / platform-first)
7. Rejection at L2 → full reservation released
8. Cancel approved future leave → days returned
9. Org A admin queries Org B → zero rows
10. Employee inserts own `user_roles` row as `org_admin` → denied by RLS
11. Org sets FY start to 1 January → entitlement and `fy_label` both follow
12. Disable the `leave` module for an org → routes and functions refuse
13. Audit log `UPDATE`/`DELETE` attempted as `org_admin` → denied
14. **Two simultaneous submissions against a 3-day balance, each for 3 days → exactly one succeeds** (D10)
15. Employee at 23:00 IST applies for tomorrow → accepted, not rejected as retroactive (D9)
16. Manager applies for own leave → routed to their manager, never self-approved (D13)
17. Org with no manager configured submits → `APPROVER_UNRESOLVED`, never silently approved (D13)
18. First balance read on 1 April of a new financial year → row created with correct pro-rated entitlement (D12)
19. Deactivating a manager who still has direct reports → blocked with a clear error (D14)
20. CSV import where row 7 has a bad email → rows 1–6 and 8+ import, row 7 reported, no partial employee created

---

## Known gaps outside the build

Not blockers for the MVP, but unowned. Recorded so they are decisions rather than surprises.

| Gap                                                  | Why it matters                                                                                                                                                                                                      | When                             |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| **Billing / subscription model**                     | No document defines how customers pay. Per-employee/month is the obvious shape but nothing is specified.                                                                                                            | Before first paying customer     |
| **Verified email sending domain**                    | Resolved 30 Jul 2026 — `neuvto.com` is registered. DNS records still to be added in Resend before notifications can deliver. See `docs/operations/EMAIL_AND_DOMAINS.md`.                                            | During step 5                    |
| **Terms, Privacy Policy, DPA**                       | B2B buyers ask for a DPA at contract. India's **DPDP Act 2023** applies alongside the GDPR claim in `03` §Compliance.                                                                                               | Before first customer            |
| **Error monitoring**                                 | No Sentry or equivalent. Production failures will be invisible.                                                                                                                                                     | At cutover                       |
| **Customer data export**                             | `03` §Compliance promises it; DPDP and GDPR both require portability.                                                                                                                                               | Before first customer            |
| **Super Admin console**                              | `07` defines the role; nothing implements it. Provisioning customer #1 is manual SQL — fine, if deliberate.                                                                                                         | Post-MVP                         |
| **Rate limiting**                                    | API standards define `429`; nothing enforces it.                                                                                                                                                                    | Post-MVP                         |
| **Hosted email template lacks `{{ .Token }}`**       | Supabase's default template sends a magic link only, so the 6-digit code flow cannot complete on the hosted database. Configured locally in `supabase/templates/`; the hosted one is set in the Supabase dashboard. | **Before any customer signs in** |
| **Half-day leave**                                   | `working_days` is `numeric`, so it is structurally supported. UI and validation deferred.                                                                                                                           | Phase 2                          |
| **Attachments, escalation cron, SMS, carry-forward** | Deferred per D6.                                                                                                                                                                                                    | Phase 2                          |
