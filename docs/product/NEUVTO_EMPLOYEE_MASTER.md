# NEUVTO WOS — Employee Master

**Version:** 1.2 · **Status:** Active, in build · **Applies to:** the `employee` module and the platform roles it depends on

The record of a person. Every other module reads it: reporting line, department,
deployment, the working calendar a deployment carries, bank and statutory numbers.
Decided on 11 Oct 2026 to take precedence over every other module (D81).

---

## 1. Where this came from

Sada published two prototypes on 11 Oct 2026, **Core HR Suite** (web) and **Core HR
Mobile** (native), with a written spec bundle (`core-hr-docs.zip`: product overview, data
model, schema, API contract, roles, design system, employee master, leave, attendance and
payroll outlines, build plan). They are the design for every module from now on (D76).

The bundle was written for a different repository: a frontend talking to a separate REST
API it does not own. Neuvto owns its database and talks to it through RLS and
`SECURITY DEFINER` functions. So the bundle is adopted **for what it says about the
product** and translated for how Neuvto is built:

| The bundle says                                        | Neuvto does                                                                                                                                                   |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/employees/:id` returns a role-shaped payload | A `SECURITY DEFINER` function returns it. The role filter is in SQL, so a field a role may not see is **absent from the response**, the bundle's rule exactly |
| `GET /api/me` with `permissions`                       | `my_permissions()`, one RPC at boot, cached in the session provider                                                                                           |
| `PATCH` on an address returns 403                      | There is no `UPDATE` grant on a temporal table, and a trigger refuses any change to a closed row                                                              |
| pnpm, React Router, react-hook-form                    | bun, TanStack Router, the forms we already have. A new dependency still needs a reason                                                                        |
| Tenant from the session cookie                         | Tenant from `current_org_id()`, as everywhere else. The client never sends one                                                                                |
| Seven roles                                            | `app_role` values in `user_roles`, additive (§5)                                                                                                              |

What carries over **verbatim**: the three rules (§2), the screens and their copy (§6), the
role-by-field visibility table (§5), the acceptance criteria (§8), and the design system,
which is now `docs/standards/NEUVTO_DESIGN_SYSTEM.md` v2.0.

The bundle's own `CLAUDE.md` and build plan are not copied into the repository. Their
rules that apply are in this file and in the design system; the rest describe a
codebase that is not this one.

---

## 2. The three rules

These came out of migrating a 65-column spreadsheet that could do none of them. They are
enforced by the database, not by remembering.

### Rule 1. Repeating things repeat without a limit

The source spreadsheet has `SON 1`, `SON 2`, `DAUGHTER 1`, `DAUGHTER 2`. A third son has
nowhere to go, so somebody types two names into one cell.

**Family members, nominees and previous organisations are rows.** The relation is a value
on the row, never part of a column name. No cap on the count, no index in a field name,
no "Son 1" label in the UI. A person with three sons is saved, shown and edited with no
code change.

### Rule 2. History is closed, never overwritten

An address in the spreadsheet is one cell. Change it and last year's address is gone,
which is exactly what a statutory notice, a background re-check or a provident fund claim
asks for.

**Addresses, deployments and nominations are temporal.** Each row carries
`effective_from` and `effective_to`; the open row has `effective_to` null. A change closes
the open row the day before the successor starts and inserts the successor. Nothing is
deleted, by anyone, including a Super Admin.

- An exclusion constraint (`btree_gist`, `daterange … with &&`) makes two overlapping rows
  impossible. One open address per type; exactly one open deployment.
- A trigger refuses any change to a closed row, and on an open row allows only setting
  `effective_to`. The application role has no `DELETE` grant on these tables.
- On screen: closed rows are muted with an `Archived` pill and **no edit or delete control
  in the DOM**. Not disabled; absent. Sorted open first, then `effective_from` descending.
- The form that adds a successor says in plain words what will happen to the current row
  before the user confirms, and its button reads `Save and archive the old one`.

Family members are **not** temporal. A family row has no history of its own and can be
removed outright; the removal is in the audit log.

### Rule 3. Anything a report groups by comes from a managed list

`Deputation / Deployed Unit` was free text. Two spellings of one unit means two lines on
the muster roll and a wrong client invoice.

**Deployment units, departments and designations are rows with ids.** Records point at the
id, never store the label. Renaming a unit renames it everywhere, closed history included,
because history points at the id. A unit anyone has ever been posted to cannot be deleted,
only **retired**, which hides it from pickers and leaves past rows readable. There is no
text-input path to a deployed unit anywhere in the module.

Departments already exist (D58). Designations and deployment units are new.

---

## 3. The record: `employees`, and why it is not `profiles`

`profiles` exists only once somebody has signed in: its id **is** their `auth.users` id,
and an invitation, not a person, is how anyone arrives (D39, D53). The Core HR Add
Employee screen builds a full record (family, addresses, statutory numbers) **before**
the person accepts, and an incomplete record can still be invited.

So the master record is its own table (D82):

```
employees            one per person, from the moment an admin starts the record
  profile_id         → profiles.id, NULL until the invitation is accepted, then unique
  invitation_id      → invitations.id, the invitation that brought them
  employee_code      unique per organisation (format from settings)
  name_as_per_id, sex, date_of_birth, marital_status, nationality, native_state,
  blood_group, education_qualification, alternate_mobile, personal_email,
  designation_id → designations, employment_type, re_joining_date, confirmed_on,
  status (working | probation | notice | suspended | left), termination_date,
  termination_reason, reason_for_leaving_last_org, height_cm, chest_cm, weight_kg,
  nearest_police_station, emergency_contact_name / _relation / _phone
```

**What stays on `profiles`, and is not duplicated:** `full_name`, `email` (the sign-in,
immutable), `phone` (the mobile), `joined_date`, `manager_id` (Reports to, which drives
every approval chain), `department_id`, `is_active` (the sign-in gate, D52). Before
acceptance those values ride on the invitation, which already carries them (D53), and the
card reads them from there. One column, one home: two copies of a reporting line is how a
leave request goes to the wrong manager.

**Derived, never stored:** `age`, `total_experience_months` (previous organisations plus
service here), `current_deployment`, `current_address`. Computed by the function that
returns the card. A stored age is wrong within a year.

### Sub-records

| Table                              | Kind               | Notes                                                                                                                                                                                        |
| ---------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `employee_addresses`               | temporal           | `address_type` present / permanent / while_deployed / emergency. One open row per type                                                                                                       |
| `employee_deployments`             | temporal           | → `deployment_units`. Exactly one open row after joining. Carries `deployment_order_ref`, `moved_by`                                                                                         |
| `nomination_versions` + `nominees` | temporal, as a set | Shares in a version total exactly 100, by a deferred constraint trigger. Changing any nominee supersedes the whole version, because the superseded Form 2 is what a claim is settled against |
| `family_members`                   | repeating          | `relation` from ten values; no unique on (employee, relation)                                                                                                                                |
| `previous_organisations`           | repeating          | feeds total experience                                                                                                                                                                       |
| `employee_documents`               | repeating          | the twelve document types; files in a private, org-scoped bucket                                                                                                                             |
| `employee_statutory`               | 1:1, restricted    | UAN, EPF, ESIC, old UAN, old ESIC, document type; **Aadhaar and PAN encrypted** with `*_last4` beside them                                                                                   |
| `employee_bank`                    | 1:1, restricted    | bank, branch, **account encrypted** + `account_last4`, IFSC, holder, penny-drop status                                                                                                       |
| `employee_restricted`              | 1:1, restricted    | religion, caste category, disability status and percent                                                                                                                                      |
| `designations`, `deployment_units` | managed lists      | retire, never delete                                                                                                                                                                         |
| `restricted_reads`                 | audit              | one row per reveal: who, whose, which fields, the stated reason, when. Kept three years                                                                                                      |

All carry the universal column set (D16) and are org-scoped by RLS (D17).

### Restricted data (D80, reversing D59)

D59 (23 Aug 2026) dropped Aadhaar from the product. Sada reversed it on 11 Oct 2026: the
statutory returns this product exists to produce ask for it, so the full design is built.

- **Separate tables, not columns on `employees`,** so an accidental `select *` on the
  employee cannot carry them and the grant is simple.
- **Encrypted at rest** with `pgcrypto`, under a key held in Vault, per environment and set
  by hand (D43). The key is never in a migration, never in git, never in the browser.
- **Absent, not masked.** The card function omits a field the caller's role may not see.
  The last four digits arrive as their own field (`aadhaar_last4`). If a frontend is
  writing a mask, it is doing it wrong.
- **Reveal is an action.** `employee_reveal_statutory(_employee_id, _fields, _reason)`
  requires the Statutory role (Payroll for bank), requires a non-blank reason, writes a
  `restricted_reads` row in the same transaction, and returns the plaintext once. The
  client holds it in component state only: never the query cache, never a log, never a
  URL, cleared on unmount, on route change and after two minutes idle. A `shown, logged`
  pill sits beside each revealed value.
- **Not to a phone.** A mobile session gets last-four only and no reveal (§7 of
  `NEUVTO_NATIVE_TRANSLATION.md` when the app exists).

- **As built (E6, 13 Oct 2026).** Every number is encrypted, UAN, EPF and ESIC included,
  not only Aadhaar and PAN: the generic audit trigger copies whole rows into `audit_logs`,
  which admins read, so anything in clear there would reach them. The three tables audit
  through `tf_restricted_audit` instead, which records which fields changed and never a
  value. Decisions taken in building it: an Admin may **write** statutory numbers (onboarding)
  but reads only the last four; bank details are written by Payroll only; verification by an
  Admin only; restricted data by the Statutory role only. A person may reveal their own
  restricted data (logged like anybody's); not their own Aadhaar, which they already hold.
  Aadhaar and PAN are unique per company through a keyed hash. "Who has looked" is shown to
  the person, a Super Admin and the Statutory role. Operator steps:
  `operations/STATUTORY_DATA.md`.

This is the most sensitive data Neuvto will hold. It does not go to production until the
encryption key, the reveal audit and the purge story (`operations/TEST_DATA_PURGE.md`) are
in place, and each is in the harness.

---

## 4. Who can make whom an admin (D78)

When Sada provisions a company, the administrator he names becomes that company's
**Super Admin**. From there the company runs its own access:

| Grant                            | Who may give or take it  |
| -------------------------------- | ------------------------ |
| Super Admin                      | a Super Admin            |
| Admin (`org_admin`, `hr_admin`)  | a Super Admin            |
| Payroll role, Statutory role     | a Super Admin            |
| Manager, Supervisor, Coordinator | any Admin or Super Admin |
| Employee                         | everybody holds it       |

- **An Admin cannot create an Admin.** Being the HR admin does not mean being able to hand
  out admin rights, or read 248 Aadhaar numbers, which is why Payroll and Statutory are
  separate grants that Admin does not include.
- **The last Super Admin cannot be removed or deactivated.** The function refuses and says
  why. A company that loses its last Super Admin has lost its own access control.
- **Nobody changes their own roles.** A Super Admin promotes other people.
- **Roles are rows, written by one function.** `member_set_roles` is the only writer of
  `user_roles`; the direct table write policies are dropped. A role on a table a user can
  write is a privilege-escalation hole (D4), and four policies saying "any admin" were
  exactly that once Admin and Super Admin differ.
- Every grant and revoke is audited (the `user_roles` audit trigger), and a removed role is
  soft-deleted, so who held what and when survives. A change takes effect on the person's
  next request, because every policy reads `user_roles` at query time; no session has to be
  revoked for it.
- **How the first Super Admin happens:** a trigger. When an organisation with no Super Admin
  gains its first Administrator, that person becomes Super Admin. So the administrator Sada
  names at provisioning becomes one on **acceptance**, through the unchanged acceptance
  path. Existing organisations were backfilled with the person who accepted their first
  administrator invitation. Proved from a workspace that was never seeded, in
  `verify_first_run.sql`, and rule by rule in `verify_company_access.sql`.
- **Neuvto can add or remove a company's Super Admins (D83).** In the console, each
  customer row has a **Super Admins** panel: it lists the company's Super Admins and pending
  Super Admin invitations, adds one by email (a member is promoted at once; anybody else is
  invited and becomes one on accepting; a pending ordinary invitation is upgraded), removes
  one (their other roles stay; somebody left with no role keeps Employee), and withdraws a
  pending Super Admin invitation. It cannot grant any other role, and it cannot remove the
  last Super Admin, because the trigger refuses Neuvto exactly as it refuses the company. To
  replace the only one, add the new person, wait for them to accept, then remove. Every add
  and remove is recorded in `analytics_events` and the `user_roles` audit trail. Proved in
  `verify_platform_super_admins.sql`.
- **Platform admins still never read tenant data (D42).** The Super Admins panel shows
  names and email addresses of a company's Super Admins, the same kind of fact the console
  already showed for the first administrator, and nothing about anybody else.

Module access is unchanged and already built (D44): a module is **granted** by Neuvto from
the console's Modules panel (Grant / Withdraw, per customer) and **switched on** by the
customer. Only the console's look changes with D76.

---

## 5. Roles and what each sees

Roles are additive, not a ladder. A person can approve and hold the Payroll role without
being an Admin.

| Role             | `app_role`                             | Granted                                                                   |
| ---------------- | -------------------------------------- | ------------------------------------------------------------------------- |
| Employee         | `employee`                             | by existing                                                               |
| Approver         | `manager`, `supervisor`, `coordinator` | by an Admin (D57). The Approvals tab appears when someone reports to them |
| Unit coordinator | `coordinator` + a unit assignment      | by an Admin, per deployment unit                                          |
| Admin            | `org_admin`, `hr_admin`                | by a Super Admin                                                          |
| Payroll role     | `payroll_officer`                      | by a Super Admin                                                          |
| Statutory role   | `statutory_officer`                    | by a Super Admin                                                          |
| Super Admin      | `super_admin`                          | provisioning, then by another Super Admin                                 |

**Approver, and D57.** The bundle derives Approver purely from having direct reports.
Neuvto's D57 (18 Aug 2026) requires an approver role before anyone can be _set_ as a
manager. The two agree on screen: since only an approver can have reports, "has direct
reports" is the condition for the Approvals tab. D57 is kept; nothing derives a
permission from a job title.

**Field visibility** (the API omits what a role may not see; the frontend renders what it
gets):

| Field group                         | Self                 | Their approver | Unit coord.     | Admin        | Payroll             | Statutory           |
| ----------------------------------- | -------------------- | -------------- | --------------- | ------------ | ------------------- | ------------------- |
| Name, code, designation, department | read                 | read           | read            | read, write  | read                | read                |
| Mobile, alternate mobile            | read, request change | read           | read            | read, write  | read                | read                |
| Personal email, emergency contact   | read, request change | read           | hidden          | read, write  | hidden              | hidden              |
| Addresses, current and archived     | read, request change | hidden         | hidden          | read, append | hidden              | read                |
| Family, nominees                    | read, request change | hidden         | hidden          | read, write  | read                | read                |
| Deployment, current and history     | read                 | read current   | their unit only | read, append | read                | read                |
| Height, chest, weight               | read                 | hidden         | read            | read, write  | hidden              | hidden              |
| Police station, verification        | read                 | hidden         | status only     | read, write  | hidden              | read                |
| UAN, EPF, ESIC                      | last 4               | hidden         | hidden          | last 4       | **full**            | **full**            |
| Aadhaar, PAN                        | last 4               | hidden         | hidden          | last 4       | last 4              | **full, on reveal** |
| Bank account, IFSC                  | last 4, own only     | hidden         | hidden          | hidden       | **full, on reveal** | hidden              |
| Religion, caste, disability         | own only             | hidden         | hidden          | **hidden**   | hidden              | **full, on reveal** |

Two rows where Admin sees less than expected are deliberate.

A `403` is a **forbidden state**, never an empty screen: what was refused, which role would
be needed, who to ask. An empty table is how people conclude the data is missing.

---

## 6. Screens

Route base `/app/employee`. Tabs `My Card`, `Directory`, `Org Chart` in the row; `Add
Employee` and `Configuration` behind `Company` for Admin and above. The screens, fields and
copy are the bundle's `07-employee-master.md` and the Core HR Suite prototype; the
prototype is the visual reference and this list is the checklist.

| Screen                       | Content                                                                                                                                                                                                                                                                                                     |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **My Card** header           | Avatar, name, `Working` and `Confirmed` pills, `<designation>, <department>, deployed to <unit>`, tags for code, joined, age, total experience; a six-cell strip: deployed unit, reports to, status, mobile, alternate mobile, police station. `Export record`; `Edit record` (Admin) or `Request a change` |
| Overview                     | Contact · Current deployment · Emergency contact · This year                                                                                                                                                                                                                                                |
| Personal                     | Identity (age derived) · Education and experience (total derived) · Physical record · the Restricted block, collapsed, with Reveal only for the Statutory role                                                                                                                                              |
| Family                       | Family `RepeatRows` with a live count (`2 sons, 1 daughter`) · Nominees with a live share total that blocks save off 100                                                                                                                                                                                    |
| Employment                   | Position · Dates and status (re-joining keeps the original joining date) · Deployment summary · Shift and calendar                                                                                                                                                                                          |
| Statutory and bank           | Warning strip (masked, reveal logged, kept three years) · PF and insurance · Identity documents · Bank · Verification                                                                                                                                                                                       |
| History                      | The rule, stated first · Address history · Deployment history (with duration) · Previous organisations                                                                                                                                                                                                      |
| Documents                    | Twelve document types, uploaded, expiry, status                                                                                                                                                                                                                                                             |
| Add an address (modal)       | States what it closes before anything is typed; `Save and archive the old one`                                                                                                                                                                                                                              |
| Move to another unit (modal) | Unit is a select from active units; order reference; notify toggles                                                                                                                                                                                                                                         |
| Directory                    | Search (server side, 200ms debounce) and three filters; deployed unit and mobile columns                                                                                                                                                                                                                    |
| Org chart                    | Four levels from Reports to, scrolling inside its own container                                                                                                                                                                                                                                             |
| Add Employee                 | Two-pane, eight sections, four stat tiles; `Save draft`, `Send invite`; gaps become onboarding items                                                                                                                                                                                                        |
| Manage / Deactivate          | Account active, Admin and Super Admin switches (Super Admin only), approval follows the reporting line; deactivation lists what it did, including the closed deployment row                                                                                                                                 |
| Bulk import                  | Dry run first, always; column mapping with per-column results; two commit paths (Super Admin)                                                                                                                                                                                                               |
| Configuration                | Fields and visibility (the full field catalogue) · Deployment units · Record rules · Onboarding checklist · Access and admin roles                                                                                                                                                                          |

**Sign-in and security** (platform, not this module): the email code (D8), and **face or
fingerprint** through a passkey (D79), enrolled from here after the first email sign-in.

---

## 7. Build order

One stage per pull request. Each is done when lint, typecheck, unit and render tests and
the SQL harness pass, the stage's acceptance criteria are verified one by one, and a
screen change has been through `screen-prover`.

| Stage | Content                                                                                                           | Done when                                                                                                                      |
| ----- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| E0    | Core HR tokens, IBM Plex, theme rule, these documents (D76, D77, D81)                                             | Every pairing passes the contrast suite; the palette matches the prototype except the three documented values                  |
| E1    | Shell: module rail and adaptive tab bar, container queries, the shared components                                 | No horizontal scroll at 390/834/1112/1440 with 12 modules injected; the active tab is never hidden, for every role             |
| E2    | Roles: `super_admin`, `payroll_officer`, `statutory_officer`, `member_set_roles`, the backfill, the People screen | An Admin cannot grant Admin, asserted from SQL **and** from the screen; the last Super Admin cannot be removed                 |
| E3    | Passkeys: enrol and sign in with face or fingerprint (D79)                                                        | Sign-in by passkey reaches `/app`; a passkey on a deactivated account buys nothing (D52)                                       |
| E4 ✔  | Schema: `employees`, managed lists, temporal and repeating tables, the backfill from `profiles`                   | Overlap refused by constraint; a closed row refuses UPDATE; three sons save; shares ≠ 100 refused; every guard watched failing |
| E5 ✔  | My Card read tabs, Directory, Org chart                                                                           | Per-role render tests against §5; a restricted field is absent from the RPC response, not hidden                               |
| E6 ✔  | Restricted data: encryption, reveal, `restricted_reads`                                                           | Reveal writes its audit row in the same transaction; the value never enters the query cache                                    |
| E7    | Writes: family, nominees, previous organisations, add an address, move to another unit                            | The bundle's acceptance criteria 1–5 and 10                                                                                    |
| E8    | Add Employee, Manage, Deactivate, bulk import                                                                     | An incomplete record can be invited; a dry run is required before commit                                                       |
| E9    | Configuration, and the responsive and role sweeps                                                                 | Every one of the 62 source columns has a home; `scrollWidth === clientWidth` on every route at every width                     |

Leave Management's redesign follows E9, to the same design, reusing E1's shell.

---

## 8. Acceptance criteria, module level

From the bundle, unchanged:

1. A person with three sons can be saved, displayed and edited. No field name contains an index.
2. Changing an address produces two rows. The old one renders muted with an `Archived` pill and **has no edit or delete control in the DOM**, for Super Admin too.
3. Changing a deployment produces two rows and a deployment order reference. The history shows duration per posting.
4. The deployed unit control is a select whose options come from the database. There is no text input path to that field anywhere.
5. Nominee shares that do not total 100 block save, with the running total visible before the user presses anything.
6. Aadhaar, PAN, bank account and the restricted block are absent from the response for a role without the grant. Confirmed in the network response, not by reading the UI.
7. Reveal writes an audit entry and the revealed value never enters the query cache.
8. Every one of the 62 non-blank source spreadsheet columns has a home in the UI. The field catalogue is the checklist.
9. All seven card sub-tabs and all eight Add Employee sections render without horizontal page scroll at 390, 834 and 1440px.
10. Deactivating closes the open deployment row and the confirmation lists what it did.

---

## 9. Payroll is parked (D81)

The payroll rebuild (`docs/product/NEUVTO_PAYROLL.md` on `payroll/mvp`, all four stages
built, unpushed) is parked, not abandoned. When it resumes it rebases onto this module,
and three things change:

- Its `20260823100000_a_person_has_a_job.sql` adds `employee_code` and a free-text
  `designation` to `profiles`. Both now belong to `employees`, and designation is a
  managed list (Rule 3). Payroll reads them from here instead.
- Bank details come from `employee_bank`, revealed under the Payroll role.
- Its decisions D67–D75 collide with `main`'s D67 (the sign-in form, #93) and are
  renumbered on rebase.
