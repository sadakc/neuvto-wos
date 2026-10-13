# NEUVTO WOS — Employee Master

**Version:** 1.19 · **Status:** Active, in build · **Applies to:** the `employee` module and the platform roles it depends on

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

- **Changed by Sada, 12 Oct 2026 (D85).** The Employee Admin (§4) enters every statutory
  number, the bank details, and religion, caste category and disability. After saving they
  see each number locked to its last four, with an **eye**: one click shows the full number,
  a second click locks it again. The eye asks for **no reason**; the look is still written
  to `restricted_reads` before the number is returned, so the person and a Super Admin see
  who looked, at what and when. The person themselves sees their own last four digits and
  that restricted data is recorded, and has **no eye**, restricted data included. Storage
  does not change: every number stays encrypted in the database (Sada's choice, the same
  day). Aadhaar is optional: "Aadhaar or PAN" is no longer a mandatory onboarding item by
  default, though a company can make it one. Payroll keeps the bank, Statutory keeps the
  numbers and restricted data; both are additions to the Employee Admin, not instead of it.

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
| Admin of one module (D84)        | a Super Admin            |
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

- **An admin for each module (D84, 12 Oct 2026).** A Super Admin can make somebody the
  admin of one module: **Employee Admin** (adds people and manages every employee card,
  statutory numbers and bank included) or **Leave Admin** (leave types, opening balances,
  Leave's reports and every leave request). A person can administer several modules and a
  module can have several admins. A company-wide Admin (`org_admin`, `hr_admin`) stays the
  admin of every module without a grant. A module admin reaches nothing outside their
  module: not People, departments, holidays, approval rules or another module's records.
  The grants are rows in `module_admins`, written only by `member_set_module_admins` (Super
  Admin only, never your own), and every module check asks `is_module_admin(module)`. On
  screen it is the **Administers a module** section of the People access panel. A module's
  approvals name their module in `approval_entity_labels.module_key` (set by the module's own
  migration), so a Leave Admin also reads any leave request's approval history. Proved in
  `verify_module_admins.sql`.

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
| Admin            | `org_admin`, `hr_admin`                | by a Super Admin. Administers every module                                |
| Module admin     | a `module_admins` row (D84)            | by a Super Admin. "Admin" in the table below means Employee Admin         |
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

| Field group                         | Self                 | Their approver | Unit coord.     | Admin        | Payroll     | Statutory   |
| ----------------------------------- | -------------------- | -------------- | --------------- | ------------ | ----------- | ----------- |
| Name, code, designation, department | read                 | read           | read            | read, write  | read        | read        |
| Mobile, alternate mobile            | read, request change | read           | read            | read, write  | read        | read        |
| Personal email, emergency contact   | read, request change | read           | hidden          | read, write  | hidden      | hidden      |
| Addresses, current and archived     | read, request change | hidden         | hidden          | read, append | hidden      | read        |
| Family, nominees                    | read, request change | hidden         | hidden          | read, write  | read        | read        |
| Deployment, current and history     | read                 | read current   | their unit only | read, append | read        | read        |
| Height, chest, weight               | read                 | hidden         | read            | read, write  | hidden      | hidden      |
| Police station, verification        | read                 | hidden         | status only     | read, write  | hidden      | read        |
| UAN, EPF, ESIC                      | last 4               | hidden         | hidden          | last 4, eye  | **full**    | **full**    |
| Aadhaar, PAN                        | last 4               | hidden         | hidden          | last 4, eye  | last 4      | last 4, eye |
| Bank account, IFSC                  | last 4, own only     | hidden         | hidden          | last 4, eye  | last 4, eye | hidden      |
| Religion, caste, disability         | "recorded" only      | hidden         | hidden          | eye, write   | hidden      | eye, write  |

"Eye" (D85): locked to the last four, opened with one click and no reason, every look
logged. Until D85 the Admin saw no bank and no restricted data and could open nothing;
Sada changed that on 12 Oct 2026.

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
| E7 ✔  | Writes: family, nominees, previous organisations, add an address, move to another unit                            | The bundle's acceptance criteria 1–5 and 10                                                                                    |
| E8 ✔  | Add Employee, Manage, Deactivate, bulk import                                                                     | An incomplete record can be invited; a dry run is required before commit                                                       |
| E9 ✔  | Configuration, and the responsive and role sweeps                                                                 | Every one of the 62 source columns has a home; `scrollWidth === clientWidth` on every route at every width                     |

Leave Management's redesign follows E9, to the same design, reusing E1's shell. **Done for the
look (16 Oct 2026):** every Leave screen uses the Core HR tokens, type scale, cards and
container queries. The bundle's Leave chapter is also a feature specification; what it adds,
where it conflicts and what needs deciding is in `LEAVE_PHASE_2_SCOPE.md`.

---

### E7 as built (14 Oct 2026)

Every writer is an Admin's (§5) and lives in `20261014100000_the_record_is_written.sql`:
`employee_update`, `employee_add_address`, `employee_move_unit`, `employee_save_family`,
`employee_save_previous_orgs`, `employee_save_nomination`. Proved by
`verify_employee_writes.sql` (criteria 1–5 from the database side) and
`RecordEditors.test.tsx` (the same from the screen).

- **End dates are exclusive in the table.** A row closed for a successor starting 1 Mar
  has `effective_to = 1 Mar` and last ran on 28 or 29 Feb. The screen always shows the
  last day; showing the stored value would claim one day too many.
- **Repeating lists are saved whole** (family, previous organisations): the screen sends
  the list it holds, existing rows by id, new rows without one, and anything missing is
  removed. A row id belonging to somebody else is NOT_FOUND.
- **The nominee total is the E4 constraint trigger's**, made immediate inside the function
  so a 90% nomination is refused before anything is written, not at commit.
- **Request a change, built.** `employee_request_change`, `employee_change_requests`,
  `employee_resolve_change`. A person describes the correction; every active admin of the
  company is emailed; an Admin makes it with the editors and marks it made or declined
  (declining needs a reason), and the person is emailed. Deliberately not an automatic
  apply, and not an approval chain: an address change closes a row for good, so an Admin who
  can see the history makes it. The notification engine gained two generic audiences
  (`organization_admins`, `recipient_id`) instead of learning this module's event names. Ten
  open requests per person at most. Proved by `verify_change_requests.sql`.
- **Still not built:**
  - _Move to another unit:_ of the three checkboxes, the shift and calendar one is built
    (D102, below): the calendar always follows the unit, and a person's own shift ends at the
    move unless "Keep their own shift" is ticked. Notify the receiving coordinator and notify
    the employee are still not offered: there is no unit coordinator assignment yet, and a
    checkbox that does nothing is worse than none.
  - ~~Proof uploads on an address.~~ Built: D98, below.

### E8 as built (15 Oct 2026)

`20261015100000_adding_people_and_letting_them_go.sql` and
`20261015110000_records_from_a_spreadsheet.sql`; proved by `verify_employee_lifecycle.sql`
and `verify_employee_import.sql`, and on screen by `Lifecycle.test.tsx` and
`ImportRecords.test.tsx`.

- **Drafts.** An Admin starts a record with only a name (`employee_create_draft`). Until the
  invitation exists, the name, email, phone, joining date, department and manager sit in
  `draft_*` columns; sending the invitation moves them onto it through `invitation_create`,
  so every invitation rule (D78's role rule, duplicates) applies unchanged. Accepting claims
  the drafted record: one record from draft to arrival, postings and all. A draft is visible
  to Admins only. An incomplete record can be invited (E8's criterion); what it lacks is
  listed against it on Add Employee.
- **Stages.** `draft`, `invited`, `active`, `deactivated`, and `removed` for a record whose
  person's account was deleted. That last one was found by the harness: such a record had
  been counting, nameless, as a draft.
- **Deactivate** (`employee_deactivate`) wraps the platform's deactivation (sign-in blocked,
  reports and approvals moved to a named successor) and adds what the record owes: the open
  posting closed on the last working day, status Left with the date and reason. It returns
  what it did, and the dialog says so (criterion 10). A trigger closes an open posting on
  every other deactivation path too, so the People screen's deactivation cannot leave one
  open.
- **Bulk import** is the Employee module's own, for a Super Admin: rows come in as drafts,
  dry run first, the commit re-checks every row, and either the clean rows only or nothing.
  Designation, department and unit must match the managed lists; dates must be YYYY-MM-DD,
  because Postgres read `01/11/2026` as 11 January (found by the harness). **Statutory and
  restricted columns are never imported** and are named as dropped: a spreadsheet of Aadhaar
  numbers is the file that leaks.
- **Deliberate differences from the bundle:**
  - _Add Employee_ starts the record (sections 01 and 02) and opens it on the card, where the
    card's own editors fill 03 to 08. One set of editors means one set of rules; a second
    address form would be the one that forgot to close the old row.
  - _Manage_ has no separate modal: account access is changed on People (Change access),
    which already enforces D78; deactivation is on the card.
  - _Deactivate_ does not cancel the person's own pending leave requests or hand final
    settlement to Payroll: the first belongs to Leave and the second to the parked Payroll
    module (D81). Both are listed in the build spec's known gaps.

### The master template (D86, 12 Oct 2026)

Sada: the old master sheet is **not** imported as it is; it is replaced by Neuvto's own
template. Import records now downloads and reads one Excel workbook:

| Tab                 | One row is          | Notes                                                                                                                       |
| ------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Instructions        | a column            | every column, whether it is required, and what to put                                                                       |
| People              | a person            | identity, contact, employment, both addresses, posting, physical, statutory, bank, religion/caste/disability (all optional) |
| Family              | a family member     | any number of sons, daughters and others: no numbered slots                                                                 |
| Nominees            | a nominee           | per scheme, shares totalling 100                                                                                            |
| Previous employment | an earlier employer |                                                                                                                             |

- Rows are linked by **Employee code**, required and unique. **New people only**: a code or
  email already in the company is a problem on that row, never an update.
- **Who:** the Employee Admin, so every company-wide Admin too (was Super Admin only).
- **One set of rules.** `employee_import_master` runs every person through the card's own
  writers, each section in its own subtransaction, and keeps nothing on a dry run or for a
  person with any problem. Aadhaar, PAN, bank and restricted values are encrypted on
  arrival by those writers; the audit trail holds no value. All or nothing by default, or
  only the clean people when asked.
- **The workbook.** Text columns are formatted as Text, so a 12-digit Aadhaar or an 18-digit
  account is not turned into a rounded number; a number Excel has already rounded is
  refused, never stored. Choices are drop-downs; designations, departments and units are
  the company's own, so a name cannot be misspelt. Dates are date cells or YYYY-MM-DD.
- **Not in it: leave opening balances.** Leave keeps balances only for people who have signed
  in, and an imported person is a draft until they accept their invitation. Opening
  balances are set from Leave's own screen once they have joined.
- Defined once in `src/modules/employee/masterTemplate.ts`; written and read with ExcelJS
  (MIT, free), loaded only on this screen. Proved by `verify_employee_import.sql` and
  `masterTemplate.test.ts`, which also fails if the template's columns and the database's
  accepted keys ever differ. Replaces the 17-column CSV import, which is dropped.

### E9 as built (16 Oct 2026)

`20261016100000_configuration.sql`, proved by `verify_employee_config.sql`; the screen by
`Configuration.test.tsx` and `fieldCatalogue.test.tsx`.

- **01 Fields and visibility** is the bundle's field inventory as data
  (`src/modules/employee/fieldCatalogue.ts`), with one column the bundle lacks: where each
  field now lives. `fieldCatalogue.test.tsx` renders a real card, opens every tab and fails if
  any field's home is not a panel that is actually there. That is criterion 8, run rather
  than asserted. **Settled against the real master sheet (12 Oct 2026):** it has 62 named
  columns (two blank ones, H and BM, are not columns). Two are repeats, FATHER NAME and
  HUSBAND NAME in E/F and again in AQ/AR, and Neuvto keeps each once (Sada: take duplicates
  out). The bundle's 56-name inventory also left out SON 1 DOB, SON 2 DOB, DAUGHTER 1 DOB and
  DAUGHTER 2 DOB, which live on each family row's date of birth. Sons and daughters are any
  number of rows, never numbered slots. The headers are in `src/modules/employee/masterSheet.ts`
  and `masterSheet.test.ts` fails if any column loses its field or a repeat is kept twice. Who sees each field
  is not a setting: §5 is enforced by `employee_card()`, and a switch that could loosen it
  would be the leak.
- **02 Deployment units and designations**: add, edit, retire and bring back. A rename
  relabels every posting, because postings point at the id. A unit somebody is posted to now
  cannot be retired. Duplicate names are refused however they are spelt or spaced, which is
  the spreadsheet's duplicate-unit problem stopped at the source. A unit's working calendar
  and default shift are set here since D102 (06 Calendars and shifts); attendance capture per
  unit arrives with Attendance.
- **03 Record rules**: the three rules and the corrections table, stated.
- **04 Onboarding checklist**: twelve items, each one a check the database runs against the
  record; a company sets each one's due window and whether it is mandatory. Add Employee's
  "missing" list is now this checklist, with an overdue flag counted from the joining date.
  Reminders and escalation are built (D99, below).
- **05 Access and admin roles**: the role table and the rules that are always on. Roles are
  changed on People (Change access). Every card view is logged, not only reveals (D100, below).

### Documents and Export record (D95, D96, 12 Oct 2026)

- **Documents** is the card's seventh sub-tab, for the person and the Employee Admin only.
  The twelve documents are listed with uploaded date, expiry and status (Uploaded, Verified,
  Expired, Not submitted); each earlier employer's relieving letter is its own row. Uploading
  a document already on file replaces it and keeps the old one. The Employee Admin verifies
  (never on their own record) and removes with a reason; nothing is deleted. Every opening is
  logged, and storage will not hand out the file without that log entry, so the footer's "every
  opening is logged" is enforced, not promised. The Employee Admin can see who opened what.
  Proved by `verify_employee_documents.sql`.
- **Export record** in the card header writes a PDF of the card as its viewer received it.
  Numbers to their last four, always; the physical record and the restricted fields never.

### The rest of the card (D97–D100, 12 Oct 2026)

`20261021110000_the_rest_of_the_card.sql`; proved by `verify_card_rest.sql`, and on screen by
`CardRest.test.tsx` and `Configuration.test.tsx`.

- **This year** (D97) is Overview's fourth card, for the person, the Employee Admin and their
  manager (`employee_this_year`). Leave left of each paid and earned type, "10 of 12 days
  left · 1.5 awaiting a decision", the same figures as the person's own Leave screen; a
  balance not made yet is worked out, never created, so looking at a card cannot change
  anybody's leave. No leave block when Leave is off. Open requests by kind, and open record
  corrections. Attendance and the last appraisal (bundle §7.1) join it when those modules
  exist; no empty rows until then.
- **Proof on an address** (D98). Add an address takes an optional proof, filed against the
  row added for the type chosen (not the permanent copy). The current address row shows the
  proof with View and Replace, or Attach; an archived row says "On file" or "None" and has no
  control (criterion 2), and every address proof is listed on the Documents tab, where it
  opens. A proof is a document (`address_proof`, pointing at its address), so it is opened
  through the logged open, replaced not overwritten, verified and removed like any other,
  by the same two people; the address row itself never changes. The card carries the proof
  to the person and the Employee Admin only; the Statutory role, which sees addresses, sees
  no proof column. If the address saves and the proof does not, the screen says so and the
  proof is attached from the row.
- **Onboarding reminders** (D99), on Configuration's checklist: remind the Employee Admins
  every N days (default 3, up to 30) and tell the Super Admins once an item is N days past
  due (default 7, up to 90); 0 switches each off, and reminders off means no escalation
  either. A daily job at 09:00 India time sends one email a company naming each record with
  mandatory items past due and what they lack, never one per record, and nothing when nothing
  is due. Deactivated records are not chased. Each send is recorded, and the screen shows
  the last of each. "Blocks the first payroll run" waits for Payroll.
- **Every look is logged** (D100). `employee_card()` writes who opened whose record before it
  returns any of it, so asking the database directly is logged too. Ten minutes of one
  person looking at one record is one row (the screen re-reads the card after every save);
  your own record is not logged; a refused look writes nothing. The person and a Super Admin
  see "Who has looked at this record" on Overview. Append-only, pruned after three years,
  never switchable off.

### Shift and calendar (D102, 12 Oct 2026)

`20261022100000_shift_and_calendar.sql`; proved by `verify_shift_calendar.sql`, and on screen
by `ShiftCalendar.test.tsx`, `Configuration.test.tsx`, `settings.holidays.test.tsx` and
`ApplyLeave.test.tsx`. Sada's choices, 12 Oct 2026:

- **The unit carries the calendar, and leave is counted on it.** Each day of a leave request
  costs leave unless, on that day, the calendar of the unit the person was posted to then
  makes it a day off or a holiday. A move to a six-day site changes the count from the move.
  Somebody posted nowhere, or at a unit naming no calendar, is on the Company calendar.
- **A calendar is the days of the week that are off**, chosen by the Admin; a new one starts
  with Sunday off. No alternate-Saturday or sandwich rules. The Company calendar is the one
  Settings has always set (the trigger keeps them equal), listed in Configuration and edited
  only on Settings. One in use by a unit is not retired.
- **Holidays stay one company list.** A holiday applies to every calendar unless an Admin
  limits it to some (Settings, "Applies to"), say a state holiday for one state's units.
- **Shifts**: name, start, end (earlier than the start for a night shift, which ends the
  next morning) and unpaid break. A unit has a default shift; the Employee Admin can give one
  person their own from a date, or return them to the unit's. Their own-shift history is
  rule 2's: closed rows never change. Rosters, swaps, grace, late marks and overtime are
  Attendance's.
- **On the card**, the Employment tab's "Shift and calendar" says which calendar and shift a
  person works today and where each comes from, to everybody in the company; the own-shift
  history to the person, the Employee Admin and their manager. Change shift for an Admin.
- **Moving somebody** says which calendar their leave is counted on from the move, and, when
  they have their own shift, asks whether to keep it.
- **Leave already asked for keeps the days it was counted at.** Moving somebody, changing a
  unit's calendar or limiting a holiday changes what new requests cost, not old ones.
- The apply screen's preview and its "Not counted" sentence ask for the applicant's own
  calendar (`my_working_days`, `my_days_excluded`), the same rule `leave_submit` charges.

### Checked at phone width (13 Oct 2026)

Every screen from D95 to D102 was opened in a real browser at 390px against local data (the
card fixture, committed locally), and again at 1440px: every card tab, the upload form, Change
shift, Move to another unit, Configuration's calendars, shifts and onboarding sections, and
Settings' holidays. No page scrolls sideways. Four things were wrong and are fixed: Export
record squeezed the card header's name and tags (it now takes its own row on a phone); the
proof column broke the file name mid-word; the onboarding checklist's item names went one word
per line and ran into their controls (an E9 screen, found on the way); and "Calendar from:
From …" said "from" twice (now "Set by"). Layout cannot be seen by the render tests, which
have no layout engine, so these four were proved in the browser; the copy change is pinned by
`ShiftCalendar.test.tsx`.

### Every screen, every orientation (13 Oct 2026)

Every route in the app, every card sub-tab and every Configuration section, measured in a real
browser at ten sizes: phones 360×780 and 390×844, tablets 768×1024 and 834×1194, each upright
and sideways, and laptops 1280×800 and 1440×900. Three people: a company Admin (380
screens), an employee (180, their own card and a colleague's) and a manager with requests
waiting (60). Each screen is checked for the page scrolling sideways, anything off the edge
that is not inside something meant to scroll, controls drawn over each other, text cut off
without an ellipsis, and text squeezed to a word or two a line; the check was itself proved
first by planting one of each fault, all five caught. Found and fixed: three table columns
squeezed (the address on History, "Visible to" in the field catalogue, the notification
matrix's headings) and, sideways on a phone 360px tall, confirmations that could run off the
screen with no way to scroll, so both shared dialogs now cap their height and scroll inside
(`dialog-height.test.tsx`). After the fixes every screen at every size passes. On a phone
held sideways only the 45px sub-tab row stays pinned; the module bar and page header scroll
away. Not covered: the Neuvto console (`/neuvto-hq`), which is staff-only and was not part of
this phase.

### Sada's first round (D103, 13 Oct 2026)

Found testing PR 95 on the local build, all fixed:

- **An 11-digit alternate mobile was saved without a word.** Every field now has a rule, said
  under the field as it is typed (`fieldRules.ts`) and enforced again by a trigger per table
  (`20261023100000_fields_are_checked.sql`), so the import and any later caller are held too.
  The trigger checks only what a write changes: a bad value already on record is still shown,
  and still refused if it is saved again, but never blocks an edit to another field. A
  refusal names its rule, and the screen turns the rule into the field's own words.
- **An invited person's details could not all be completed.** Everything could be saved, but
  the buttons sat below the panels and the name and mobile had no form at all. The card's
  writer now also corrects the full name, mobile, department and reports to, wherever they
  live: the profile after sign-in, the invitation before it, the draft before that.
- **"Edit emergency contact" when there was none.** Each panel carries its own button in its
  header: **Add …** while it is empty, **Edit …** once anything is in it. An empty emergency
  contact is shown to whoever can fill it. The same on every tab, Statutory and bank
  included (its one editor split into one per panel).
- **Adding to a list meant leaving the form.** Designation and Department end with "Add a
  designation…" / "Add a department…": the name is added to the company's one list (the
  rows Configuration, Organisation and the leave reports read) and selected. A department
  already there under the same name is the same department. Reports to ends with "Make
  somebody a Manager…": only somebody who can approve has reports (D57), so this gives them
  the Manager role through `member_set_roles`, where D78 still decides who may.
- **"Not yet"** is **None** for designation, department, employment type and reports to.

The rules, in full: a phone is 10 digits starting 6–9, the same after +91, or another country
code with 8 to 15 digits (spaces, dashes and brackets allowed); a name, relation, nationality,
state, city or district is letters in any script with spaces and . ' - (no digits or other
symbols); an employee code is letters and digits with / . \_ - between; free text has a length
(qualification 200, reasons 500, police station 100); somebody is at least 14 on their date of
birth; no relative is born in the future and no previous job is dated there or ends before it
starts; the statutory and bank numbers keep the database's existing patterns, now also said on
screen, with Aadhaar's checksum.

### Sada's second round (D104, 13 Oct 2026)

Found testing the D103 build, all fixed:

- **A date of birth took hundreds of clicks.** Every date in the module is typed as
  DD/MM/YYYY (the slashes go in by themselves) or picked from a calendar whose month and year
  are dropdowns, the way Workday takes one (`src/components/shared/date-field.tsx`). A date of
  birth's calendar opens thirty years back and offers nothing under fourteen. Half a date is
  never taken for no date: it is refused with "Enter the date as DD/MM/YYYY".
- **"Fixed it to 10 digits and it still refused."** The ten digits started with a 3, and no
  Indian mobile does, but the message only said "10 digits" again. Each way of being wrong is
  now named: how many digits there are, a first digit other than 6–9, a leading 0, digits
  after +91, a symbol.
- **Nationality** is a dropdown: Indian, Nepali, Bangladeshi. A new record starts as Indian
  (the column's default) and the form starts on Indian when nothing is recorded. A value
  already on record that is not on the list is still shown.
- **Total experience could not be entered.** Experience before joining is two dropdowns,
  years and months, saved as months (`employees.prior_experience_months`, 0 to 720). When set
  it stands in for the previous organisations' sum; service here is still added, so the total
  keeps counting by itself. The Education and experience panel's button reads only **Add** or
  **Edit**.
- **Height, chest and weight** are dropdowns (100–230 cm with feet and inches, 50–150 cm,
  30–200 kg). The database still allows its wider range, and a value outside the lists is shown
  as it is.
- **A new family row said Son.** It says **Select**, and a row without a relation is refused.
  The same for a new nominee row. The emergency contact's relation is the same list.
- **Grade was missing from Edit position.** It is shown there, read only, following the
  designation chosen: a grade belongs to the designation (Configuration, Designations), and a
  designation added from the field can be given one.
- **Deploy stayed disabled with no reason.** There were no units, and the dialog did not say
  so. It now lists every active unit, ends with **Add a unit…** (a name, and a client for a
  client site), and says under the button what it still needs.
- **Editing PF numbers looked like it had cleared them.** Every number on record opens as its
  last four with **Change** beside it; only a number the Admin changes is typed and sent, and
  **Keep** puts it back. The same for Aadhaar, PAN and the account number.
- **The eye dropped to the next line once a number was shown.** The number and its eye stay
  on one line; "Shown, logged" goes under them.
- **The bank panel had no photo.** It takes the passbook's first page or a cancelled cheque,
  filed as the Documents tab's bank proof, so opening it is logged the same way.
- **The Personal tab's Restricted panel showed nothing.** It is a one-line note now.
- **Documents had no Browse button.** The stylesheet's reset had taken the browser's away.
  Every file choice in the module is a Browse button, the file's name and size, and Remove to
  unchoose it (`src/components/shared/file-picker.tsx`). Removing a document already uploaded
  was there for the Employee Admin; nothing could be uploaded to remove.
- **"Add pf and insurance numbers".** Button titles keep the capitals of PF and IFSC.

Leave's own date boxes are not changed in this round; the same field drops in there when
wanted.

### Sada's third round (D105, 13 Oct 2026)

- **The module is the Employee Card** on every screen (the rail, the header, the database's
  module list). This document keeps its name.
- **Tabs fill the row.** As many as fit in 70% of the bar are shown, the Company tabs after a
  divider instead of behind a `Company` menu; the rest are behind `More`. Below 540px the row
  is still the one section picker.
- **The modules column folds** to a strip of named icons (a row or grid on narrower screens
  folds up under its brand), and stays folded on that device.
- **Postings.** Current deployment on the Overview has its own Deploy/Move button. A move can
  end the current posting on its own last day; the new one starts the day after, unless the
  Admin picks another start. Expected duration is years and months; the reason is "Reason for
  deploying". The latest posting can be **removed**, with a reason: it is kept in
  `record_withdrawals` with who and when, listed under the history as a removed posting, and the
  posting it cut short carries on. This is the one exception to "history is never deleted"
  (rule 2): the append-only triggers let through only the row a withdrawing function names.
- **The blank Current unit, Since and Deployed unit** after a move dated ahead: "current" meant
  "no end date", and the old posting had one in the future while the new one had not begun.
  It now means the posting covering today, with the next one shown beside it ("Moving to").
- **One nomination for every scheme.** The Scheme choice is gone; the ESIC save that did not
  show was a second, separate nomination. Saving again the same day corrects the nomination
  (the first is kept in `record_withdrawals`) instead of clashing with it.
- **Native state** is every state and union territory, Karnataka first and the default, then
  Maharashtra, Goa and Andhra Pradesh, then the rest alphabetically (`indiaPlaces.ts`). Bijapur
  is a district of Karnataka (Vijayapura), not a state, so it is not in the state list.
- **Addresses** start with the state, as a list; its districts follow it, with "Not listed" for
  one newer than the list. City is **City/Town**. An address is written line, city or town,
  district, state, India, then the PIN code.
- **Clearing a box** is the × at its right, with room kept so text never runs under it.
- **The calendar** goes to the end of next year; a document's expiry goes ten years ahead.
- **Height** starts at 4 ft. **Add a family member**, not "Add a relative". **Dates and status**
  is **Joining and exit dates**.
- **Change shift** starts on the shift they work now and offers Save only for a change; saving
  "their unit's shift" for somebody already on it used to be refused after the click.
- **An old UAN or ESIC number that is the current one** is refused, on screen when both are
  typed and by the database when one is on record.
- **Identity documents** drop "Document given" (the Documents tab answers it) for a **driving
  licence number**, encrypted and opened like PAN.
- **The passbook or cheque photo** is the Documents tab's bank proof, so it is listed there too.

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
