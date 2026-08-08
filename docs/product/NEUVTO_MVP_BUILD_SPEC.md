# NEUVTO WOS — Build Spec

**Version:** 1.3 · **Status:** Active · **Updated:** 8 Aug 2026

## The platform is the product

**Derived from:** `02_PRODUCT_PRINCIPLES.md`, `03_PLATFORM_ARCHITECTURE.md`, `04_MODULE_ROADMAP.md`, `06_LEAVE_MANAGEMENT.md`, `07_ROLES_PERMISSIONS.md` (all v1.0)
**Target:** Lovable project `neuvto` (`c74d04ee-25dd-4be1-a46e-f8973fe8c5d4`)
**Stack:** TanStack Start + TypeScript + Tailwind + shadcn/ui + Supabase (Lovable Cloud)
**Status:** Rewritten platform-first — 31 Jul 2026

---

## What is being built

**Neuvto is a platform that customers are provisioned onto, and modules are
deployed onto it multi-tenant.** Leave Management is the first module. It is an
instance of a contract, not the destination.

That sentence is the whole reframe, and this document was written the other way
round until 31 Jul 2026 — as a leave product that happened to have a platform
underneath. The build followed the spec, so the platform was built as far as
Leave happened to exercise it and no further. What that cost, concretely:

- Three capabilities were written to run **on a schedule**, and nothing in the
  repository ran on a schedule. Every email the product sends was affected.
- The **module boundary** filtered routes and not functions, so a company with
  Leave switched off could still submit leave through the API.
- A provisioned customer had **no way to say who they were** — no display name,
  no logo — and no path through setting their workspace up.

None of those are leave defects. All three were found the week the product was
first used by somebody who was not building it.

### The shape

```
MODULES            Leave  ·  Attendance (Q4)  ·  Payroll (2027)
                              ↓ deployed onto, per customer
PLATFORM           Tenancy · Provisioning · Invitations · Identity · RBAC
                   Approval Engine · Notification Engine · Audit Log
                   Working Calendar · Module Registry · Scheduled Work
                              ↓
INFRASTRUCTURE     Supabase (Postgres + Auth + Edge Functions + Storage)
```

**Two jobs, and they belong to different people.** Neuvto provisions a customer
and decides which modules they are entitled to (D39/D42/D44). The customer's own
administrator configures their workspace, switches those modules on, and invites
their people — with no SQL run by anyone, which is what the platform acceptance
criteria below actually assert.

### Platform services built in MVP

Authentication · User Management · Organization Service · Roles & Permissions · **Approval Engine** · **Notification Engine** · **Audit Log** · Organization Settings · **Working Calendar** · **Module Registry**

**Selection rule:** a service is built generically when Leave Management exercises it _and_ a roadmap module has a stated dependency on it. All six above are named dependencies of Attendance (Q4 2026, `04_MODULE_ROADMAP.md` lines 94–100).

### Platform services deferred

Workflow Engine (Approval Engine covers MVP state transitions) · Reports Service (module-local reports in MVP; generalise when a second module reports) · Documents Service · Search Service · Branding Service · Theme Service.

**Rationale:** no second consumer exists yet. Per Principle 5, an abstraction with zero consumers is speculative. Each is additive — none requires reworking the schema below.

---

## Scope decisions

These override the source docs where they conflict. Deviations are deliberate and recorded.

| #   | Decision                                                                                                                                                                                                          | Overrides                                                                                                                                                                                                                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Responsive web app, mobile-first.** One codebase, PWA-installable.                                                                                                                                              | PRD line 1362 (React Native/Flutter) — not buildable in Lovable                                                                                                                                                                                                                  |
| D2  | **Balance reserved on submission**, released on reject/cancel.                                                                                                                                                    | PRD Rules 3–4 — as written, employees can overdraw                                                                                                                                                                                                                               |
| D3  | **Entitlement pro-rated within the financial year**, capped at max. FY start per-organization.                                                                                                                    | PRD Rule 1 — unbounded formula, no `joined_date` source                                                                                                                                                                                                                          |
| D4  | **Roles in a separate table** behind `SECURITY DEFINER` functions; enum not string arrays.                                                                                                                        | PRD line 436 (`roles UUID[]` on users) — privilege-escalation risk under RLS                                                                                                                                                                                                     |
| D5  | **Approval chains are data, not code.** L1 always; L2 when a configured condition matches. Default: days > 3.                                                                                                     | PRD Rules 6–7 — realises them as configuration per Principle: _configuration over customization_                                                                                                                                                                                 |
| D6  | Weekend/holiday exclusion **in MVP**. Email notifications **in MVP**. Attachments and escalation cron **deferred**.                                                                                               | PRD scope list                                                                                                                                                                                                                                                                   |
| D7  | **Settings split:** typed columns for platform calendar/FY (integrity — they feed generated columns); JSONB key-value for module settings (new modules need no migration).                                        | `03` §12 pure key-value store                                                                                                                                                                                                                                                    |
| D8  | **Email OTP + Google OAuth.** No passwords.                                                                                                                                                                       | `03` §Security specifies OTP; current build uses passwords. Phone OTP deferred — needs an SMS provider and Indian DLT registration                                                                                                                                               |
| D9  | **Per-organization timezone**, default `Asia/Kolkata`. All "today" comparisons resolve in org-local time.                                                                                                         | Not in any source doc — a genuine omission                                                                                                                                                                                                                                       |
| D10 | **Balance rows locked `FOR UPDATE`** inside the submission transaction.                                                                                                                                           | Not in any source doc — D2 alone stops sequential overdraw but not concurrent                                                                                                                                                                                                    |
| D11 | **CSV employee import and opening-balance entry in MVP.**                                                                                                                                                         | `03` §User Management lists bulk import; opening balances were unaddressed                                                                                                                                                                                                       |
| D12 | **Balance rows created lazily** on first read for a financial year, not by a scheduled job.                                                                                                                       | Nothing in the PRD creates next year's rows                                                                                                                                                                                                                                      |
| D13 | **Approval chain skips an approver who is the requester**, advancing to the next level; if no level resolves, the request fails with `APPROVER_UNRESOLVED` rather than auto-approving.                            | PRD does not define manager-applies-for-own-leave                                                                                                                                                                                                                                |
| D14 | **Deactivating a user requires reassigning their reports and open approvals.**                                                                                                                                    | PRD does not define manager departure                                                                                                                                                                                                                                            |
| D15 | **Branding and Theme services deferred.** Per-org theming is additive because every colour resolves through a CSS variable.                                                                                       | Principle 9 (White-Label Ready) — deliberate deferral, confirmed 28 Jul 2026                                                                                                                                                                                                     |
| D16 | **Audit fields on every business table** — `created_at`, `updated_at`, `created_by`, `updated_by`, maintained by trigger, never by application code.                                                              | Not in any source doc — `created_by` cannot be backfilled once data exists                                                                                                                                                                                                       |
| D17 | **Soft delete** — `deleted_at` on business tables, enforced **inside the RLS policy**, not by query convention.                                                                                                   | Not in any source doc — retrofitting means re-auditing every query and policy                                                                                                                                                                                                    |
| D18 | **Overlapping leave prevented by a Postgres exclusion constraint**, not only by the handler check.                                                                                                                | PRD Rule 11 — the application check races; a constraint does not                                                                                                                                                                                                                 |
| D19 | **Explicit `ON DELETE` on every foreign key.** No Postgres defaults.                                                                                                                                              | Not in any source doc                                                                                                                                                                                                                                                            |
| D20 | **Per-organization session policy** — idle and absolute timeouts; sessions revoked on role change or deactivation.                                                                                                | `03` §Security mentions auto-logout but specifies nothing                                                                                                                                                                                                                        |
| D21 | **TOTP MFA required for `org_admin` and `hr_admin`**; employees use email OTP alone.                                                                                                                              | Principle 7 names MFA; nothing specified it                                                                                                                                                                                                                                      |
| D22 | **RPO ≤ 5 min, RTO 4 h, quarterly restore drill** that runs the harness against the restored copy.                                                                                                                | Not in any source doc                                                                                                                                                                                                                                                            |
| D23 | **`erase_employee()` anonymises personal data and retains leave history.**                                                                                                                                        | `03` §Compliance promises erasure; deleting the row would break every balance and report                                                                                                                                                                                         |
| D24 | **AI seams defined, no AI infrastructure built.** If retrieval is ever needed it is `pgvector` in the same database — never a separate vector service.                                                            | Principle 6 anticipates AI; Principle 5 forbids building it with no consumer                                                                                                                                                                                                     |
| D25 | **Analytics events stored in-database**, not sent to a third-party SaaS.                                                                                                                                          | Not in any source doc — avoids adding a processor holding employee behavioural data                                                                                                                                                                                              |
| D26 | **The emitter names the event; the engine names the recipients.** Modules emit `approval.submitted`, never "email the approver".                                                                                  | Not in any source doc — a module that named recipients would be edited every time an organisation wanted its HR admin copied in                                                                                                                                                  |
| D27 | **Values substituted into templates are HTML-escaped.**                                                                                                                                                           | Not in any source doc — a leave reason is user input landing in an HTML email a manager opens                                                                                                                                                                                    |
| D28 | **A notification never fails the transaction that caused it.** A missing template records a failed notification; it does not roll back the approval.                                                              | Not in any source doc — mail is not worth losing somebody's approved leave over                                                                                                                                                                                                  |
| D29 | **A notification that failed for a reason that might not recur is retried with exponential backoff, up to a cap.** A reason that certainly will recur is terminal immediately.                                    | Not in any source doc — step 5 claimed this in a comment and did not implement it, so a momentary blip lost an approval email permanently                                                                                                                                        |
| D30 | **A module reacts to platform events with a trigger it defines itself**, on a platform table. The platform never names a module.                                                                                  | Not in any source doc — a hook inside approval_decide naming 'leave_request' would invert the dependency, and application code would move balances outside the decision transaction                                                                                              |
| D31 | **A balance cannot be overdrawn** — enforced by CHECK, not by remembering to look.                                                                                                                                | Found by sabotage: two locks were defending an invariant nothing asserted, and removing both left available_days at -3                                                                                                                                                           |
| D32 | **Modules declare themselves; the platform reads manifests.** `src/modules/registry.ts` is the only file outside a module that names one, and CI proves a module can be deleted.                                  | Sada, 30 Jul 2026 — "only touch the individual module and not the entire code itself"                                                                                                                                                                                            |
| D33 | **Cancellation releases days from whichever bucket actually holds them**, and exactly one thing moves them.                                                                                                       | Found by sabotage: the cancel branch decremented `reserved_days` unconditionally, so cancelling APPROVED leave subtracted from an empty bucket and stranded the days in `pending_days` forever                                                                                   |
| D34 | **Next year's leave does not exist until shortly before next year.** A per-organisation setting, default one month.                                                                                               | Sada, 31 Jul 2026 — two unlabelled "Casual" cards read as a duplicate, because to an employee that is what they are                                                                                                                                                              |
| D35 | **The approval timeline discloses the approver's NAME and nothing else about them.**                                                                                                                              | Employees cannot read an approver's profile, so the timeline said "Level 1 Approver"; widening the profiles policy would have handed over email, joined date, manager and department to fix a name                                                                               |
| D36 | **A balance materialises when it is READ** — which is what D12 always said. Current financial year only, so D34 still holds.                                                                                      | `ensure_balance` was commented "created lazily on first read" and its only caller was `leave_submit`. Nothing read, so a configured workspace still showed "no leave balance yet"                                                                                                |
| D37 | **An organisation is created with a default approval chain** — L1 reporting manager, L2 HR above three days.                                                                                                      | Sada's first request died with APPROVER_UNRESOLVED, rendered as "ask your administrator" — to the administrator. Test scenario 6 had always assumed a chain existed                                                                                                              |
| D38 | **`leave_types.approval_required = false` means approved on submission**, with no approval request and nothing emitted.                                                                                           | The column shipped in step 6 and was read by nothing. A one-person workspace cannot book a day otherwise: D13 forbids self-approval and no level resolves                                                                                                                        |
| D39 | **A workspace is entered by invitation only.** Neuvto provisions it and names the first administrator; there is no self-serve signup.                                                                             | Sada, 31 Jul 2026 — "let me decide who can be the admin for that particular workspace". Every sign-in was a signup, so an uninvited employee would create a rival tenant                                                                                                         |
| D40 | **A duplicate inside the organisation is named to the admin; a clash across organisations is never disclosed to them.** The invitee is told, at acceptance.                                                       | Answering "already in another workspace" at invite time makes the invite box a staff-directory oracle — type addresses, watch which come back duplicate, enumerate a competitor's payroll                                                                                        |
| D41 | **Phone is stored and unique within an organisation, and is NOT an identity key.**                                                                                                                                | The goal (one human, not one address) is right and phone is the correct key, but an admin types it and nothing verifies it. Real enforcement needs phone OTP, which D8 defers                                                                                                    |
| D42 | **Platform admins provision and never read tenant data.** `platform_admins` has RLS on, no policy and no grant; bootstrap is one manual INSERT.                                                                   | Support access was considered and declined. It falls out of the design — staff have no profile, so `current_org_id()` is null and every tenant policy already refuses them                                                                                                       |
| D43 | **Work that has to happen on a schedule is scheduled in a migration**, in `pg_cron`, with its credentials in Vault. A module schedules its own work in its own migration.                                         | Nothing in the repository ran on a schedule for four build steps, and three capabilities were written for one. A schedule clicked into a dashboard cannot be reviewed, cannot be restored after a rebuild, and cannot be found by the next person wondering why no email arrived |
| D44 | **A module is granted by Neuvto and switched on by the customer** — two levels, both on `organization_modules`. Enforced by `module_enabled_for()` **inside the module's own functions**, not only in the router. | Test scenario 12 has said "routes _and functions_ refuse" since the first draft. Routes refused; `module_enabled()` was called by nothing at all, so a company with Leave switched off could still submit leave                                                                  |
| D45 | **A customer's identity is theirs to set** — display name, logo, industry — and it appears in the shell and in the emails their own people receive. The logo bucket is private and org-scoped.                    | A provisioned workspace had no way to say who it was. A public bucket would make every customer's identity enumerable by anyone who can count, so reads go through short-lived signed URLs                                                                                       |
| D46 | **Onboarding completion is derived from the data, never from a stored step counter.** `organizations.onboarding_completed_at` records only that they chose to stop being asked.                                   | A counter and the data it describes drift, and it is the counter that lies — parking somebody forever on a step they finished, or waving through one they never saw                                                                                                              |

| D47 | **A queue answers only for the person asking.** `approval_queue()` takes no user id and discloses the requester's **name** and nothing else about them. `approval_pending_for(_user_id)` is dropped. | It was SECURITY DEFINER, granted to `authenticated`, and took whose queue to return as an argument. Every caller omitted it, so it read as "my queue" for four build steps — while any employee could pass their manager's id, which is on their own profile, and read a colleague's leave request in full |
| D48 | **An approver is shown the balance for the leave type being requested, and no other.** | D35's rule applied to the other direction: disclose the answer to the question actually asked. Days of sick leave taken is a health signal, and an approver two levels up has no claim on it |

| D49 | **A module declares how it is named to a human**, in `approval_entity_labels`, and the platform adds that label to any event carrying an `entity_type`. An unregistered type falls back to the generic "request", never to the type name. | Approval emails read "Approval needed: leave_request" — a database column in a subject line. D30 forbids the platform naming a module and `entity_type` was the only thing to hand, so the module names itself in a row |

| D50 | **`profiles` is written per column.** `authenticated` may change `full_name` and `phone` about themselves; everything an administrator edits about somebody else goes through a `SECURITY DEFINER` function, and reporting lines refuse cycles. | An employee could rewrite their own `joined_date` — the number entitlement is calculated from — and a mid-year joiner turned 6 days into 12 in one statement. Grants are per role and policies filter rows, so a column grant cannot say "admins only" |
| D51 | **Deactivation names a successor and moves everything in one transaction** — reports, pending approvals, and any level the successor would then hold twice. Their pending leave is cancelled by the module's own trigger; approved leave stands. | D14 made the reassignment a precondition, leaving an administrator to move eight people by hand before the button works. One decision, atomically, means nobody is ever half-deactivated |

| D52 | **Access follows `is_active`.** `current_org_id()` returns null for a deactivated person, so every RLS policy refuses them; their token stays valid and buys nothing. `reactivate_employee` restores **access only**. The last administrator cannot be deactivated. | Deactivation removed their work and not their access — after being deactivated, a person read their profile, read their balances, and submitted a leave request. Session rows in `auth.sessions` are left alone deliberately: deleting them couples our migrations to GoTrue's internal schema |

| D53 | **An invitation carries what somebody arrives with** — start date, reporting line (by email) and department, applied to the profile on acceptance. An import therefore creates **invitations, not people**, and manager links resolve in both directions so order in the file does not matter. An unknown manager warns and imports; it does not fail the row. | `invitation_accept` never set `joined_date`, so the column defaulted to `CURRENT_DATE` — the server's date, not the organisation's (D9). Measured on a real acceptance: somebody who joined in 2021 was given 8.0 and 5.3 days where the file's own date gives 12.0 and 8.0. Every seeded person looked right only because the seed writes profiles directly; anybody arriving the way D39 requires got today. `profiles.id` references `auth.users`, so no import can shortcut the invitation |

| D54 | **Leave is counted in whole days and halves — nothing finer.** Enforced where numbers ENTER the system: `leave_type_days_are_halves` and `leave_type_per_request_is_halves` on the configuration, `calculate_entitlement` rounding to the nearest half, and a `NOT_A_HALF_DAY` guard on `leave_set_opening_balance`. Deliberately NOT constrained on `leave_balances`, which is arithmetic rather than configuration. Existing balances were backfilled; rows where rounding down would take available days below zero keep their old figure and are reported, not silently skipped. | Entitlement rounded to **one decimal place**, so a 5-day type joined in July gave 3.8 days — ten possible fractions where a person recognises two, and a figure that cannot be booked, because leave is taken in days and half days. Sada, 7 Aug 2026: "that confuses the end user." Rounding the calculation alone was not enough: a maximum configured at 12.4 caps a full-year employee off-grid however carefully the calculation rounds |
| D55 | **An invitation carries a name, and it is required.** `InviteInput` and `invitation_create` both refuse a blank one; `profiles.full_name` and `invitations.full_name` stay **nullable** for rows that already exist. `provision_organization` is exempt and still accepts none. | The address proves who somebody is; the name is how their colleagues recognise them, and those are different jobs. People, the reporting-line dropdown, the successor picker on deactivation, the approval timeline and every report all fall back to `full_name \|\| email`, so a workspace invited without names is a list of logins. A NOT NULL column would have refused to apply against existing rows — a migration that cannot run on real data is an outage, not a rule |
| D56 | **A cleared number box is not zero.** Numeric settings hold the typed text separately while being edited; only a value that parses reaches the settings object, and blur restores what is stored. | `Number("") === 0`. Clearing "Minimum notice" to retype it set the workspace default to _no notice at all_, and `org_settings_notice` permits 0, so Save accepted it in silence. `fyStartDay` was worse and hid it better: `org_settings_fy_day` requires 1–31, so an emptied box produced a failed save complaining about a day of the month nobody typed |

| D57 | **An employee approves nothing, and the rule is enforced where a manager is SET.** `app_role` gains `supervisor` and `coordinator` — approvers, not administrators, so `canApprove` includes them and `is_admin` does not. `admin_set_reporting_line` refuses an Employee as somebody's manager; `deactivate_employee` refuses handing a leaver's reports to one; `chain_role_can_approve` refuses naming Employee on an approval level. Existing violations are reported, never rewritten — promoting somebody is a decision about their job. `verify_invariants.sql` asserts it stays at zero. | `canApprove()` and the role picker on Approval rules both already excluded Employee, so the product **looked** enforced. Neither is where approvers come from: `resolve_approver`'s first rule reads `profiles.manager_id`, a column with no opinion about the role attached to it, so **any Employee with a direct report has approved leave since the approval engine was written**. The picker only ever governed the `role` rule, which is level 2; level 1 has always been the reporting line. Enforcing at read time instead would silently drop a configured level and re-route requests already in flight |

| D58 | **Departments are writable.** Created and renamed in Settings, assigned on the People row and the invite form, removed through `department_remove` which clears `profiles.department_id` in the same transaction. `admin_set_department` refuses a department belonging to another organisation. `unique (organization_id, name)` became a **partial, case-insensitive index**, matching `uq_leave_type_name`. Hierarchy stays unexposed — `parent_department_id` is preserved and a department with children cannot be removed. | The table has existed since the first migration with RLS, an admin policy, grants and a foreign key, and **nothing ever wrote a row** — so the Department column on both leave reports was blank for everybody and the import warned "No department called X" on every row that named one. Two faults surfaced while building the write side: the table constraint covered soft-deleted rows, so removing "Sales" spent the name permanently; and a soft delete left `profiles.department_id` pointing at a row `read own departments` filters out, a row disagreeing with itself. A foreign key constrains existence, not ownership — proved by removing the tenancy check and watching a profile accept another organisation's department |
| D59 | **Aadhaar is dropped from the MVP entirely, not merely left optional.** No column, no hash, no import field, no platform duplicates report. Supersedes the decision taken earlier the same day to store a salted hash with `aadhaar_last4`. Reinstating it is a fresh decision made after the legal work, not a resumption of this one. | Sada, 7 Aug 2026: _"drop PR5 due to legal concern. I will introduce the hashed Aadhaar later, once I have all the legal formalities completed."_ Hashing addresses storage; it does not address whether the product may **collect** the number at all, which is what the Aadhaar Act and DPDP govern and what audit item 5 (21 Aug) settles. Shipping the column first and the legal position afterwards means a schema holding identifiers nobody has established a lawful basis for — and a half-built feature is exactly the thing a later review has to unpick under time pressure |
| D60 | **A scheduled report is timed by the platform and written by the module.** `report_schedules` + `report_schedules_due()` + `report_schedule_mark_run()` are generic and name no module; `report_definitions` is a registry each module inserts its own row into. Leave renders its own email and declares its own cron entry in its own migration. Report bodies gain an org-scoped `_for` sibling — one body, two doors — because a cron job has **no `auth.uid()`** and every existing report function resolves the organisation from the JWT. | The alternative was a platform runner that knew what a leave summary is, which is the coupling D30 exists to prevent and which the nightly balance sweep already had to be moved out of once (`20260801120000`). The `_for` split is not tidiness: `leave_taken_report` raises `FORBIDDEN` from cron, and the obvious fix — copying the query into the runner — produces two definitions of "what counts as leave taken" that drift, so the weekly email eventually disagrees with the screen and nobody knows which is right. Bodies were taken from `pg_get_functiondef`, not retyped: `leave_taken_report` has two definitions and the later one added `decision_note`, the same trap that silently reverted `deactivate_employee` and deleted its `LAST_ADMIN` guard on 7 Aug |
| D61 | **Hosting moves to Cloudflare Workers.** Netlify's free plan is 300 credits a month and charges **15 per production deploy** — twenty publishes, after which the project pauses and `neuvto.com` serves `Site not available`. This project makes ~90 site-changing commits a month (~1,350 credits); only Netlify Pro at \$20/user carries that, and it still meters every deploy. Cloudflare meters no deploys at any tier, charges no egress, serves static assets free, and is \$5/month when paid. Interim: `deploy.yml` carries a `paths-ignore` list so a documentation commit stops costing 15 credits. | Recorded with the arithmetic so nobody re-derives it from a marketing page. On the pipeline's first day it published eight times and **four of those shipped a byte-identical site**. The move also consolidates rather than fragments — one vendor for hosting, DNS and (later, free) Email Routing, which is the standing fix for `neuvto.com` having no MX record. `neuvto.com` is an apex domain, so the zone must move to Cloudflare nameservers either way; GoDaddy stays the registrar |

| D62 | **A demo request emails Neuvto from the edge function, not from the notification queue.** The recipient is `DEMO_REQUEST_RECIPIENT`, a Supabase secret — never in git, never in the browser bundle, never rendered on the page. The email is sent **after** the row is recorded and can never change the answer the visitor gets. An unset secret is logged loudly, naming the row that is safe and the person nobody told. | `notifications.organization_id` is **NOT NULL** and a demo request belongs to no organisation, so queueing it needs either a fake organisation row or making that column nullable — a change to RLS on a core table, for one email. The trade is named rather than hidden: this path has **no retry and no audit trail**, which is why every failure is loud in the log and why this is the first thing to move if a second platform-level notification appears. Before this, a demo request landed in `demo_requests` and told nobody at all |
| D63 | **The social card is generated from the design tokens and served from our own origin.** `scripts/generate-social-card.py` composes `public/social-card.png` (1200×630) from `brand/neuvto-mark-source.png` and the oklch values in `tokens.ts`; the PNG is committed so nothing in CI or the build depends on Python. | `og:image` and `twitter:image` pointed at a **Lovable build preview** — `pub-bb2e…r2.dev/…/id-preview-…lovable.app-….png`, live and serving — so every share of this company fetched its picture from a bucket Neuvto does not own and could not keep. The same reason the deploy pipeline moved. Generated rather than exported by hand for the reason `styles.css` is generated: a hand-made card drifts from the brand and nothing catches it |
| D64 | **A test workspace says so, in a table the product cannot read.** `platform_test_organizations` records which workspaces are Neuvto's own rehearsals, with a required non-blank reason. It is set by `provision_organization`'s new `_is_test` argument in the same transaction that creates the workspace, and surfaced on the console list. The console can also mark and unmark an existing workspace, and the two directions are deliberately asymmetric: **Not a test** is one click, because withdrawing a marking can only make a purge refuse more; **Mark as test** opens a required reason field, because a single misclick must never put a customer on the allow-list. RLS on, no policy, no grant, and an explicit `revoke all ... from anon, authenticated` — reachable only through `SECURITY DEFINER` functions that check `is_platform_admin()`. **No purge function exists yet, and no backfill was performed.** | Sada tests in production on purpose and will ask for a hard delete of that data around Oct 2026. Nothing in the schema could answer "which of these is a rehearsal", which cost nothing while production held **one** organisation and becomes unanswerable at the second — so the marker has to land before the data, not before the purge. Not `organizations.is_test`, because a flag on the customer table is one `if` away from a second code path, and a test workspace that behaves differently has stopped testing the real one. No backfill because a migration cannot tell whether a customer was provisioned between its authoring and its application, and the failure it would cause is a real customer silently joining the allow-list a purge deletes from — a person checks the list instead. The new table also had to `revoke` Supabase's stock `grant all`, which hands TRUNCATE to `anon` and `authenticated` on every table created without one. Three defects were found in this migration before it merged and are fixed in it: (a) `drop function` takes a PUBLIC revoke with it, so recreating `provision_organization` and `platform_list_organizations` handed `anon` back EXECUTE on four SECURITY DEFINER functions — the invariant caught it and now names the offenders instead of counting them; (b) `char_length(btrim(reason)) > 0` accepts a tab, an NBSP and the whole zero-width family, so the reason rule is `reason ~ '[[:alnum:]]'`, measured against every blank form rather than assumed; (c) writing `is_test` into `analytics_events.properties` let a customer's own org_admin read Neuvto's classification of them, so it is not recorded there at all |

**D15 is unchanged and still deferred.** Company identity (D45) is not theming.
A name and a logo are _facts about the customer_, stored as columns and rendered
by components that already exist. Per-organisation colour is a _rendering
strategy_ — it stays additive because every colour already resolves through a CSS
variable, and it earns nothing until a customer asks for it. Shipping identity
does not smuggle Branding and Theme services in by the back door.

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
module_enabled_for(_org_id, _key)     → boolean   -- D44; takes the org, see 1.7
```

`module_enabled(_key)` shipped here in phase 0, resolving the organisation from
the caller's own profile. It is **dropped** in D44: any caller without a profile
— which is every scheduled job — got `false` rather than an error, so it was
silently wrong in exactly the situations that matter.

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
- OTP expiry and session duration come from settings, never hardcoded. This line decided the
  shape of D20's implementation (5 Aug 2026): the idle timeout reads `session_policy()` rather
  than a constant, which is also the only way to answer for a platform admin — they have no
  `organization_settings` row at all (D42). Idle is per ROLE as well as per organisation; see
  §3 of `standards/NEUVTO_SECURITY_POLICY.md`.
- Phone OTP deferred: needs an SMS provider and Indian DLT template registration. The auth wrapper is written so adding it is one method.

### Deactivation — D14

Deactivating a user is a guarded operation, not a flag flip — and until step 11 it was
exactly a flag flip, available to any admin in one `UPDATE`.

`deactivate_employee(who, successor)` does it in one transaction (D51):

1. Their direct reports move to the successor
2. Their pending approval steps move too, and any level the successor now holds twice is
   retired — `required_levels` and `current_level` recomputed from what survives
3. Their own leave awaiting approval is cancelled and the days released, by **the module's
   own trigger** on `profiles` (D30); leave already approved is left alone

Refused: deactivating yourself, an inactive target, and a successor who would end up
approving their own request (`SUCCESSOR_IS_REQUESTER` — D13 arriving by the back door).

**Deactivation revokes access** (D52). `current_org_id()` is null for an inactive
person, so every policy refuses them, and the sign-in screen tells them their access was
removed rather than that they were never here. **Reactivation** gives access back and
nothing else — what moved to a successor stays with them.

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

approval_queue()              → what awaits the CALLER, with the requester's name (D47)
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

## 1.5 Provisioning and invitations — how a customer comes to exist

**`platform_admins`** — Neuvto staff. RLS on, **no policy and no grant**, so it is
readable only by `SECURITY DEFINER` functions. Bootstrapping the first row is one
manual INSERT, deliberately: the first god account should be a decision somebody
made, not a side effect of a deploy. There is no self-service path into this
table and there must never be one.

**`invitations`** — `organization_id`, `email`, `phone`, `full_name`, `role`, `token`,
`expires_at`, `accepted_at`, `revoked_at`.

```
platform_provision_organization(name, slug, admin_email, admin_name, industry)
  → creates the organisation, its settings, its default approval chain (D37),
    and one org_admin invitation. Emits member.invited.

invitation_accept(token)
  → creates the profile and role, marks the invitation accepted.
    Refuses a second use, an expired token, a revoked token and a
    wrong-recipient token with the IDENTICAL message.
```

**D39 — a workspace is entered by invitation only.** Before this existed every
sign-in was a signup, so an employee arriving uninvited created a rival tenant
containing one person. **D40** governs what the inviting admin is allowed to
learn: a duplicate inside their own organisation is named to them; a clash across
organisations is never disclosed, because answering it turns the invite box into
a staff directory of a competitor.

## 1.6 Scheduled work — D43

The platform's own recurring work, scheduled **in a migration** so it is in git,
reviewable, and restored by a rebuild.

```sql
create extension pg_cron;  create extension pg_net;

platform_secret(name)          -- reads Vault; never granted to authenticated
dispatch_notifications()       -- hands the pending queue to the edge dispatcher

cron: neuvto-dispatch-notifications   '* * * * *'
```

**Unconfigured is loud, not silent.** An environment with no
`notification_dispatch_url`/`_key` in Vault raises a `WARNING` naming both, every
time it has mail it cannot send — rather than returning quietly and looking
exactly like success. Silence is the shape the original defect took, so silence
is what the harness refuses to accept.

**Only platform work is scheduled here.** A module schedules its own, in its own
migration — `neuvto-leave-mature-balances` lives with the Leave module. The first
draft of this migration looped organisations calling `leave_mature_balances()`,
which is platform code naming a module and the one thing D30 exists to forbid.

Vault secrets are per-environment and set by hand once; a `db reset` clears them.
See `docs/operations/DEPLOYMENT.md`.

## 1.7 The module boundary — D44

**`modules`** — the catalogue: `key`, `name`, `status` (`available`/`coming_soon`/`retired`).
**`organization_modules`** — `organization_id`, `module_key`, `enabled`, `enabled_at`.

Two levels, and they belong to different people:

| Level            | Who                  | Meaning                                 |
| ---------------- | -------------------- | --------------------------------------- |
| the row exists   | Neuvto               | this customer is **granted** the module |
| `enabled = true` | the customer's admin | they have **switched it on**            |

```sql
module_enabled_for(_org_id, _module_key) returns boolean
  -- stable, security definer. Takes the org explicitly, so scheduled work
  -- running as postgres gets a real answer rather than a silent false.

platform_set_module(_org_id, _module_key, _granted)   -- Neuvto only
platform_list_org_modules(_org_id)                    -- Neuvto only
```

**Enforced in the module's own functions**, which raise `MODULE_NOT_ENABLED` —
not only in the router, which is all that was true before. A customer's admin
holds `UPDATE (enabled, enabled_at)` and nothing else: granting `UPDATE` on the
whole row let an admin rewrite `module_key`, turning a Leave grant into a Payroll
one.

`module_enabled(text)` — the convenience wrapper that read the caller's own org —
is **dropped**. It answered `false` for any caller without a profile, which is
every scheduled job, and it was silently wrong rather than loudly missing.

## 1.8 Company identity and onboarding — D45, D46

**`organizations`** gains `display_name`, `logo_path`, `logo_updated_at`,
`onboarding_completed_at`. `industry_type` already existed and was unused.

**Bucket `org-logos` — private**, 2 MB, `image/png|jpeg|webp` (no SVG: it is a
script container). Path is `{organization_id}/…`, enforced by a CHECK on
`logo_path` as well as by the storage policies, and reads go through a signed URL.
Uploads are re-encoded through a canvas rather than trusted.

`UPDATE` on `organizations` is granted **per column** — name, display name, logo,
industry, onboarding — so an admin cannot reach `deleted_at` or `slug` and
soft-delete the company they administer.

`organization_display_name()` is what the invitation email carries, so the first
message anyone at a customer receives names their own employer rather than ours.

**The setup wizard** (`/app/setup`) — welcome → identity → calendar → modules →
people → done. Every step saves as it goes and is resumable; abandoning it is
expected rather than exceptional. **Completion is derived** (D46): the calendar
step is always "done" because provisioning writes valid defaults and there is no
observable difference between reviewing them and never looking — claiming to know
would park somebody forever on a step for agreeing with it.

---

# PHASE 2 — The first module: Leave Management

**Leave is an instance of the module contract, not the destination.** Everything
in this phase exists to prove the contract carries a real module: it registers
itself in `modules` as `'leave'`, contributes its own screens, settings sections
and dashboard cards through manifests, schedules its own recurring work, and
CI proves the whole directory can be deleted without breaking the platform (D32).

Its functions check `module_enabled_for(org, 'leave')` and raise
`MODULE_NOT_ENABLED` (D44). The platform names no module anywhere (D30).

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
`leave_mature_all_balances()` does the sweep for every organisation that has Leave,
scheduled by **this module** at `30 18 * * *` — midnight in the default
organisation timezone — in its own migration, never by the platform (D30/D43).
Each organisation's own "today" is resolved inside, so a customer in another zone
is still correct; the schedule decides only when the sweep runs.

**Gate:** `available = entitled + carryforward − used − reserved − pending` holds after every operation, across multiple leave types.

---

# PHASE 3 — UI

### Employee (mobile-first, 48px targets, bottom tab nav)

- **Dashboard** — balance cards with used/available progress, pending count, next approved leave, Apply CTA, all above the fold
- **Apply Leave** — type selector, range picker (past dates disabled), live working-days calc, live balance line `Available: 8 | Requested: 3 | Remaining: 5`, reason (500 chars), submit disabled while invalid
- **My Leave** — filterable list, detail with approval timeline and comments, cancel before start
- **Calendar** — month view; approved blue, pending yellow, today grey

### Manager (web, sidebar nav)

- **Approvals** (platform, `/app/approvals`) — queue from `approval_queue()`, showing employee, type, dates, days, days-waiting, level badge. **The screen belongs to the platform; modules render their own rows** through `approvalViews`, so a manager running two modules visits one queue. A row whose module is switched off still appears, through a neutral fallback
- **Detail** — employee context, the balance **for the requested leave type only**, reason, full approval history, approve/reject with comment
- **Team calendar** — direct reports, colour-coded. Reached from the Calendar screen rather than the nav bar: the mobile bar shows five destinations, and a sixth pushed Approvals off it

### Admin (web)

Built in step 8 unless marked otherwise.

- Leave types (archive, never delete) — contributed to Settings by the module, via `adminSections`
- **Holiday calendar** (platform)
- **Approval chain editor** (platform) — levels, approver rule, condition, threshold
- **Org settings** — FY start month/day, weekend days, exclusion toggles, min notice, retroactive, D34's booking window
- **Company identity** (platform, D45) — display name, logo, industry. Shared with the wizard, so the form exists once
- **Setup wizard** (`/app/setup`, platform, D46) — where an administrator lands on accepting their invitation
- **Members** — invite by email, role and phone; pending invitations, revoke. Reporting lines and deactivation are step 11
- **Neuvto console** (`/admin`) — provision a customer workspace, name its first administrator, and grant modules (D39/D42/D44)
- **Module registry** — Neuvto grants; the customer switches on, in their own Settings (D44)
- Notification toggles — _not built_
- **CSV employee import** (D11) — upload, column mapping, dry-run preview showing what will be created and what will fail, per-row error reporting, partial success. Required columns: `email`, `full_name`, `joined_date`; optional: `manager_email`, `department`, `role`. Manager links resolve by email in a second pass so order in the file doesn't matter.
- **Opening balances** (D11) — for customers onboarding mid-year: per employee per leave type, set `used_days` and `carryforward_days` directly. Available as a column in the same CSV and as an inline edit on the balance report. Every override writes an audit row with the previous value — this is `leave:balance:override` from `07`, and it must be traceable.
- **Reports** (platform destination, filled by modules) — the three below

### Reports — step 14

Until now this document said "Reports 1, 3, 4", numbers that refer to a PRD which is not in
this repository. Nobody could tell from here what report 3 was, so the three had to be agreed
in conversation before step 14 could start. They are written down here so that never has to
happen again.

Each answers a question somebody asks out loud, which is the only test a report passes or
fails.

| #   | Report                | The question                                                                                                                                                                                                                                                                                                | Filters                                                                                        |
| --- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1   | **Leave balances**    | Who has what left? Employee × leave type, entitled / carried over / used / available, for the current leave year. Includes people whose balance row does not exist yet, showing what they _would_ get — otherwise the person most needing an opening balance is the one missing from the list.              | Department, leave type                                                                         |
| 2   | **Leave taken**       | What happened? Every request **overlapping** the window — not starting within it — including **rejected and cancelled** ones. "We have no record of that" is the answer this report exists to prevent, and a refused request is precisely the one somebody later disputes.                                  | Date range, defaulting to the current month in the **organisation's** timezone                 |
| 3   | **Pending approvals** | What is stuck? Everything awaiting a decision, **longest wait first**, with which level it sits at and **everyone** who can act now — a level can have more than one approver and any of them unblocks it. `approval_queue()` answers this for the caller; this is the administrator's view of everybody's. | None. A list of everything stuck is short by definition, and if it is not, that is the finding |

All three export to CSV, with a UTF-8 BOM so Excel on Windows does not mangle a name like
`Priyā`, and a filename carrying the **organisation's** day rather than the browser's (D9) —
these files are emailed and filed, and two exports a month apart are otherwise
indistinguishable.

**Access: administrators only** (`org_admin`, `hr_admin`). Managers already have Approvals and
the Team Calendar; these three are every person in the workspace at once, and widening them
would put a colleague's sick-leave consumption in front of more people than D35 permits
elsewhere.

Every report function **raises FORBIDDEN rather than returning an empty set**. An empty report
and a forbidden report are the same picture on screen and only one of them is a bug. The screen
is not the permission: `/app/reports` also refuses a non-admin, but that is presentation, and a
screen that is merely not linked has never been a permission.

**Reports is a PLATFORM destination that modules fill**, not a Leave nav item — the constraint
that shaped the rest. `mergeNavItems` puts module items at positions 2–4 and the mobile bar
shows the first **five**. A fourth Leave entry pushes "Approvals" off the bar for an
administrator: the identical bug the team calendar caused in step 10, found only by opening the
app at 280px wide. Reports sits with People and Settings, which fall off the bar deliberately,
because admin work is desktop-first. A module contributes reports through
`ModuleDefinition.reports` and the platform renders them without knowing any of them concern
leave (D30).

---

## Build sequence

**Progress as of 31 Jul 2026:** steps 0 through 8 are merged to `main`; step 9 is built and
under verification. The harness carries the RLS assertions, the invariant suite, the D10
concurrency guard, a first-run suite that seeds NOTHING, and a scheduled-work suite that
**invokes nothing** — passing locally and in CI, and verified non-vacuous: every guard has
been watched to fail under deliberate sabotage.

**The lesson of step 8.** Steps 0–7 were green while four faults made a new workspace
unusable, because `seed_test_data.sql` hands the harness two organisations that already have
leave types, balances and approval chains. The suite had never once started where a customer
starts. A test fixture that sets up the preconditions the product is supposed to create is not
a test of the product.

**The lesson of step 9, which is the same lesson one layer down.** Step 8's suite was green
while no email the product sends could be delivered at all, because every assertion invoked
the dispatcher by hand before checking the outcome. A queue nobody drains is indistinguishable
from a queue with nothing in it. Three capabilities had been written to run on a schedule and
nothing in the repository ran on a schedule — including one, `module_enabled()`, that was
called by nothing whatsoever.

**So the recurring failure mode of this codebase is now named: a capability written,
documented, granted, and wired to nothing.** It has happened four times — `ensure_balance`
(D36), `approval_required` (D38), `leave_mature_balances` and `module_enabled` (D43/D44). It
has its own CI check, `scripts/verify-functions-wired.sh`, which fails the build when a
function our migrations define is referenced nowhere but its own definition.

| Status   | Step | Content                                                                                             | Gate                                                                                                                                                                                             |
| -------- | ---- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **done** | 0    | Vitest + GitHub Actions CI                                                                          | Lint, typecheck, unit tests, and the SQL harness run on every push                                                                                                                               |
| **done** | 1    | Phase 0 — schema, RLS, security-definer functions                                                   | Cross-org isolation verified by SQL as each role                                                                                                                                                 |
| **done** | 2    | Phase 0 — email OTP auth, auth wrapper, app shell, role-aware nav, org signup                       | Sign up → `/app` with correct nav per role; no `lovable` import outside the quarantine                                                                                                           |
| **done** | 3    | Phase 1 — Audit Log + Working Calendar (incl. org timezone)                                         | Day math matches PRD Case 4; audit rows immutable; org-local "today" correct across the IST/UTC boundary                                                                                         |
| **done** | 4    | Phase 1 — Approval Engine                                                                           | Drives a dummy entity type end to end, no leave tables; self-approval skips to next level                                                                                                        |
| **done** | 5    | Phase 1 — Notification Engine + Resend                                                              | Template renders, email delivers, `notifications` row marked sent                                                                                                                                |
| **done** | 6    | Phase 2 — Module SDK + Leave schema, entitlement, lazy balances, locked submission                  | Balance invariant holds under **concurrent** submission; engine creates correct levels                                                                                                           |
| **done** | 7    | Phase 3 — Employee UI                                                                               | PRD AC1–AC3, AC5, AC7                                                                                                                                                                            |
| **done** | 8    | The first run — provisioning, invitations, admin config, PWA                                        | A provisioned workspace is usable end to end with no SQL; platform admins read zero tenant rows                                                                                                  |
| **done** | 9    | **The platform is the product** — scheduled work, the module boundary, company identity, onboarding | The platform acceptance criteria below, in full                                                                                                                                                  |
| **done** | 10   | Phase 3 — Manager UI + decision handling                                                            | PRD AC4, AC6; Cases 1, 2, 3, 6                                                                                                                                                                   |
| **done** | 11   | Guarded deactivation + reporting lines                                                              | PRD AC9; deactivating a manager with reports is blocked                                                                                                                                          |
| **done** | 12   | Access follows deactivation, and a way back                                                         | A deactivated person reads nothing and can do nothing; reactivation restores access only (D52)                                                                                                   |
| **done** | 13   | Bringing a company's existing staff in — CSV import + opening balances                              | A row that fails is reported **and leaves nothing behind**; a start date in the file survives to the profile (D53); overrides audited by the trigger                                             |
| **done** | 14   | The three reports + CSV export — defined under "Reports — step 14" above                            | A non-admin is refused rather than shown an empty table by every report; no report crosses a tenant, asserted from both sides; the export is named for the organisation's day, not the browser's |

### Testing

**Vitest** for unit tests, **GitHub Actions** for CI. Required coverage regardless of percentage:

- Every handler's failure paths, not just the happy path
- `calculate_working_days` against the PRD's weekend and holiday cases
- `calculate_entitlement` for mid-year joiners and a non-April financial year
- Balance transitions across submit → approve → reject → cancel
- Approval resolution when the manager is missing, inactive, or is the requester
- **A concurrency test** issuing two simultaneous submissions against a balance that only covers one — this is the D10 regression guard and cannot be verified by hand
- **A scheduled-work test that invokes nothing**, because everything the product does on its own is invisible to a test that asks it to (D43)

CI runs lint, typecheck, `vitest`, the SQL harness, and two structural checks:

| Check                               | Fails when                                                                    |
| ----------------------------------- | ----------------------------------------------------------------------------- |
| `scripts/verify-module-removal.sh`  | deleting `src/modules/leave` breaks the build — i.e. D32 has been violated    |
| `scripts/verify-functions-wired.sh` | a function our migrations define is referenced nowhere but its own definition |

A red build blocks the next step. The second check has its own history worth
knowing: it contained **three bugs of its own** when written — counting comments
as callers, demanding callers for functions a later migration drops, and counting
`to_regprocedure()` existence probes as calls. Each was found by refusing to
accept a sabotage that produced no visible difference. **Verification tooling is
the most defect-prone code in this repository**, which is the argument for
sabotaging every guard rather than trusting a green tick.

### Verification gate

**Every step above is gated by `neuvto-harness/`**, in this order — seed,
`verify_rls.sql`, `verify_invariants.sql`, `verify_first_run.sql`,
`verify_concurrency.sh`, `verify_scheduled_work.sh`. The SQL files raise on the
first violation; silence is a pass. No step is complete until the whole suite
passes against it.

The last three exist because the first two cannot catch what they cannot reach:
one needs two connections, one needs a workspace nobody seeded, and one needs
nobody to invoke anything at all. Each was added after a green suite shipped a
fault of exactly that shape.

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

## Platform acceptance criteria

The PRD's AC1–AC9 are all about leave, because the PRD is about leave. They can
all pass on a platform no customer can be put onto. These are the ones that say
the platform works.

**The whole of it, in one sentence: a customer can be provisioned, onboarded,
configured and given modules with no SQL run by anyone.** Every step below has a
screen. If any of them needs somebody to open a database console, the platform is
not finished, whatever the module does.

| #    | A customer can…                                                                                                              | Proven by                                                                              |
| ---- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| PA1  | **Be provisioned by Neuvto** at `/admin` — organisation, settings, default approval chain, and one administrator named by us | `verify_first_run.sql`, by hand at `/admin`                                            |
| PA2  | **Receive their invitation without anyone pressing anything**, because the queue drains on a schedule                        | `verify_scheduled_work.sh`                                                             |
| PA3  | **Accept it and land somewhere that welcomes them** — not a dashboard reporting they have no leave balance                   | by hand, invitation → `/app/setup`                                                     |
| PA4  | **Say who they are** — display name, logo, industry — and see it in the shell and in the emails their own people receive     | `verify_rls.sql` storage block, by hand                                                |
| PA5  | **Configure the workspace themselves** — working week, financial year, holidays, notice, booking window                      | `verify_invariants.sql` proves the config is _obeyed_; that it can be saved is by hand |
| PA6  | **Switch on the modules Neuvto granted them**, and not one that we did not                                                   | `verify_rls.sql` module block                                                          |
| PA7  | **Invite their own people**, with role and phone, and withdraw an invitation                                                 | `verify_first_run.sql` covers invite → accept; **withdrawal is by hand only**          |
| PA8  | **Abandon setup half-way and come back to it**, with what they entered intact and nothing claimed as done that is not        | by hand — sign out mid-wizard, sign back in                                            |
| PA9  | Be certain that **Neuvto staff can read none of it**                                                                         | `verify_rls.sql` — scenario 24                                                         |
| PA10 | Be certain that **a module switched off refuses in the database**, not merely in the router                                  | `verify_rls.sql` — scenario 12                                                         |

**PA2 is the one that gets skipped.** It is slow, it looks like infrastructure
rather than product, and it is the only criterion here that was ever violated
silently. An invitation that is rendered, queued, and never sent looks identical
from every screen in the product to one that was never requested.

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
12. **Disable the `leave` module for an org → the functions refuse, not only the routes.** `leave_submit` raises `MODULE_NOT_ENABLED` **as `service_role` too**, not merely as an ordinary caller — that is the gap that hid a missing `security definer` in step 5. `leave_cancel` runs its ownership check _first_, so a refusal tells the caller nothing about whether somebody else's request id exists (D44)
13. Audit log `UPDATE`/`DELETE` attempted as `org_admin` → denied
14. **Two simultaneous submissions against a 3-day balance, each for 3 days → exactly one succeeds** (D10)
15. Employee at 23:00 IST applies for tomorrow → accepted, not rejected as retroactive (D9)
16. Manager applies for own leave → routed to their manager, never self-approved (D13)
17. Org with no manager configured submits → `APPROVER_UNRESOLVED`, never silently approved (D13)
18. First balance read on 1 April of a new financial year → row created with correct pro-rated entitlement (D12)
19. Deactivating a manager who still has direct reports → blocked with a clear error (D14)
20. **CSV import where row 7 has a bad email** → rows 1–6 and 8+ import, row 7 reported, and **no invitation exists for row 7** — asserted as a count, because "reported an error" and "left nothing behind" are different claims and only the second one protects the customer's next import
21. **A workspace provisioned five minutes ago is usable**: default chain exists, a leave type created by the admin produces a balance on first READ, and a request against a no-approval type comes back approved with the days moved (D36/D37/D38)
22. Invitation accepted → profile and role created; the same token refused a second time, and an expired, revoked or wrong-recipient token gives the identical message (D39)
23. **An address already in another workspace is refused at acceptance, and the inviting admin's view carries no reason for it** (D40)
24. **A platform admin selects `leave_requests`, `leave_balances`, `profiles` and `invitations` → zero rows in every case**, against a database that demonstrably holds them (D42)
25. **Provision a customer, then touch nothing.** The administrator's invitation is delivered without anybody invoking a dispatcher, running a script, or opening a console. Sabotage by unscheduling the job: it must stay `pending` and the check must go red (D43)
26. **An environment with no delivery configured says so.** Mail waiting plus no Vault secrets must produce a warning naming both keys — silent success is indistinguishable from the original fault (D43)
27. **Onboarding survives being abandoned.** Complete identity and calendar, sign out mid-wizard, sign back in: the wizard resumes with what was entered intact, claims nothing as done that is not, and the shell header shows the new company name **without a reload** (D46)
28. **An admin cannot widen what they were granted.** Rewriting `module_key` on their own `organization_modules` row, or reaching `organizations.deleted_at` or `slug`, is refused by column-level grant rather than by hoping the UI never sends it (D44/D45)
29. **A level-2 approver sees who they are approving and nothing more.** A four-day request routes to the manager-of-manager, who is neither an admin nor the requester's manager. `approval_queue()` gives them the name; they still cannot `select` that person's `profiles` row or `leave_balances` rows (D47)
30. **The balance shown to an approver is the requested type only.** Deciding on Casual discloses Casual and not Sick (D48)
31. **"My leave" lists only your own.** A manager, an approver and an administrator each see their own requests on that screen — not their reports', not their approvees', not the company's
32. **A pending approval whose module was switched off still appears in the queue**, through a neutral fallback rather than vanishing

33. **Org A's admin cannot read, write or list Org B's logo path**, and `org-logos` is not readable unauthenticated. Sabotage by making the bucket public: the check must go red (D45)
34. **An employee cannot rewrite their own start date.** A mid-year joiner editing `joined_date` is refused, and their entitlement does not move — asserted with a guard that the fixture really is mid-year, or the check would pass while proving nothing (D50)
35. **Deactivation is not something a plain `UPDATE` can do**, nor is a soft delete of a colleague (D50)
36. **AC9 — deactivating a manager hands over their work.** Reports and pending approvals move to the named successor, and a level the successor would then hold twice is retired so they approve once, not twice (D51)
37. **A reporting line that closes a loop is refused** — directly, or through a chain of managers
38. **An administrator cannot deactivate themselves**, and cannot name a successor who would inherit their own request to approve
39. **The module cancels its own on deactivation** — pending leave becomes `cancelled` and the days come back, through Leave's own trigger rather than the platform's function; approved leave is untouched
40. **A deactivated person reads nothing and can do nothing.** Profiles, balances and requests all return zero rows, and `leave_submit` raises `NO_ORGANIZATION` — the exact call that succeeded after deactivation before D52. Non-vacuity guard: they must hold balances to begin with (D52)
41. **The sign-in screen can tell deactivated apart from never-invited.** `my_account_status()` answers `deactivated`, `active` and `none` for the three cases, so somebody whose access was removed is not told to seek an invitation that will not help
42. **Reactivation restores access and nothing else.** Their balances are readable again; the reports that moved to the successor stay with the successor, asserted by count before and after (D52)
43. **The last administrator cannot be deactivated** — `LAST_ADMIN`. Without it a workspace can be left with nobody able to administer it and nobody able to undo that, because reactivation is admin-only
44. **A start date in the file reaches the profile.** Accept an invitation carrying 2021 and the entitlement is a full year; the same person with the old behaviour gets today's date pro-rated. Asserted as both numbers with a guard that they genuinely differ, because an assertion that only checks the new number passes just as happily when nothing is pro-rated at all (D53)
45. **Order in the file does not matter.** A report accepts _before_ their manager exists and is attached when the manager arrives. Sabotage by removing the reverse pass — the assertion must go red, since the forward pass alone still makes the ordinary case pass (D53)
46. **An unknown manager warns and imports** — `manager_id` stays null and the person joins, rather than the row failing. Consistent with D13, which refuses their first leave request rather than crashing
47. **An opening balance moves what it should and cannot overdraw.** `used_days` reduces `available_days` by exactly that much and leaves `entitled_days` alone; a number beyond entitlement is refused by `balance_not_overdrawn` (D31), not by a check in the browser. The override is traceable through `audit_logs` carrying the previous value, written by the trigger rather than by the function

---

## Known gaps outside the build

Not blockers for the MVP, but unowned. Recorded so they are decisions rather than surprises.

| Gap                                                     | Why it matters                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | When                             |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| **Billing / subscription model**                        | No document defines how customers pay. Per-employee/month is the obvious shape but nothing is specified.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Before first paying customer     |
| **Verified email sending domain**                       | Resolved 30 Jul 2026 — `neuvto.com` is registered. DNS records still to be added in Resend before notifications can deliver. See `docs/operations/EMAIL_AND_DOMAINS.md`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | During step 5                    |
| **Terms, Privacy Policy, DPA**                          | B2B buyers ask for a DPA at contract. India's **DPDP Act 2023** applies alongside the GDPR claim in `03` §Compliance.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Before first customer            |
| **Error monitoring**                                    | No Sentry or equivalent. Production failures will be invisible.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | At cutover                       |
| **Customer data export**                                | `03` §Compliance promises it; DPDP and GDPR both require portability.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Before first customer            |
| ~~**Super Admin console**~~                             | **Closed in step 8.** `/admin` provisions a customer workspace and names its first administrator (D39/D42). Bootstrapping the first platform admin is still one manual INSERT, deliberately — the first god account should be a decision somebody made, not a side effect of a deploy.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Done                             |
| **Vault secrets are per-environment and manual**        | D43. The cron job ships in a migration; the URL and key it needs cannot, because a migration is a file in git. Applying every migration to a fresh environment therefore produces one where all email queues and none sends. The dispatcher warns loudly and `verify_scheduled_work.sh` asserts it, but nothing can set them for you. See `docs/operations/DEPLOYMENT.md`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | At every new environment         |
| **Nothing watches the queue in production**             | The harness proves the queue drains when someone runs the harness. In production a backlog needs to page somebody, and there is no alerting — this is the same "who is watching" question the missing scheduler answered badly, one level up.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | With error monitoring            |
| **Production runs on Supabase's free plan**             | Standing constraint, taken 2 Aug 2026: **nothing is paid for until the MVP ships.** Two consequences follow and neither is visible until it bites. **No automated backups** — free projects get no daily backup and no point-in-time recovery, so a bad migration or a wrong `delete` against a customer's leave records is unrecoverable. And free projects **pause after about a week of inactivity**; whether the every-minute `pg_cron` job counts as activity is not documented, so it should be observed rather than assumed before a customer depends on it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Before the first customer's data |
| ~~**Approval emails name a database column**~~          | **Closed.** A module registers its own label (D49); the platform reads a table and still names no module. Asserted on the rendered subject in `notifications`, not on the template — what reaches an inbox is the claim.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Done                             |
| ~~**A deactivated person keeps access**~~               | **Closed** by D52. `current_org_id()` now excludes the inactive, so every policy refuses them, and reactivation exists so a mis-click is recoverable. Their JWT is still technically valid until it expires — deliberately, since deleting `auth.sessions` rows would couple our migrations to GoTrue's internal schema. It buys them nothing, and since 6 Aug 2026 it buys it for at most 30 minutes: `jwt_exp` is 1800 on the hosted project.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Done                             |
| **Rate limiting**                                       | API standards define `429`; nothing enforces it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Post-MVP                         |
| **Phone is captured but never verified**                | D41. Invitations record a phone and it is unique within an organisation, which is real — but an administrator types it, so it cannot yet do the job it was asked for: telling one human from another across workspaces. That needs phone OTP, which D8 defers pending an SMS provider and Indian DLT registration.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | With phone OTP                   |
| **Sign-in email comes from Lovable, not Neuvto**        | Resolved 31 Jul 2026 **on the Lovable Cloud project**, which is still what `neuvto.com` serves. Not resolved on `neuvto-wos-prod`, which is what this repo points at: re-read from the API on 3 Aug 2026, its template carries no `{{ .Token }}` and **cannot be given one** — "Email template modification is not available for free tier projects using the default email provider". It is not a dashboard toggle. Custom SMTP on Resend unlocks it and fixes the sender domain at the same time; upgrading the plan is ruled out by the row above. Fixed there meanwhile: OTP length 8 → 6 (the form only accepts 6), Site URL and redirect allow-list. See `docs/operations/EMAIL_AND_DOMAINS.md`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | **Before any customer signs in** |
| ~~**The published site still uses Lovable's backend**~~ | **Closed 7 Aug 2026 — after failing twice.** PR #32 repointed `.env`, but its premise — "`.env` is the only thing that decides which database the app reaches" — never held for the **published artifact**: Lovable built the site and supplied its own backend variables, so `neuvto.com` served a bundle resolving to `vkyvzhgigncranprhidn` while the repoint sat merged and inert. Closed on 3 Aug by asking Lovable to publish `main` (commit `68094bc`). **It recurred on 6 Aug**, same project ref, same mechanism — and sign-in returned HTTP 200 while sending nothing, because it was authenticating against a project with no SMTP configured. The re-check written in this row was not run: the deploy was verified by grepping the bundle for two feature strings, both of which were present and correct. **A paragraph in a document is not a check.** **Closed properly by removing the cause rather than repeating the fix.** Since 7 Aug `neuvto.com` is built by GitHub Actions from repository secrets and served by Netlify; Lovable publishes only its own preview, against pre-production. Two gates guard it — `scripts/verify-deploy.sh --dir` refuses to publish a build pointing anywhere but production, and the same script against the live domain refuses to pass a site that does. Both were earned rather than designed: the live gate caught a malformed secret, and that failure exposed a hole in the artefact gate. Verified end to end by a real sign-in code delivered from `neuvto.com` through `udrzhfgwqgolvyimbwto`, and by a demo-form row landing in production. See [../operations/PRODUCTION_HOSTING.md](../operations/PRODUCTION_HOSTING.md). | Done                             |
| **Half-day leave**                                      | `working_days` is `numeric`, so it is structurally supported. UI and validation deferred.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Phase 2                          |
| **Attachments, escalation cron, SMS, carry-forward**    | Deferred per D6.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Phase 2                          |
