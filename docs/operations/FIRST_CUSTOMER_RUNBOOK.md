# First Customer — Onboarding Runbook

**Version:** 1.0 · **Status:** Active · **Updated:** 8 Aug 2026

**Purpose:** not marketing. This is a **product test.** Walking through what a real customer
must actually do to go live is how the missing bulk import and opening balances were found,
and walking it again will surface more.

Every step below that cannot yet be done by the customer themselves is a product gap, marked
**[GAP]**. The count of those is the honest measure of whether the MVP is sellable.

---

## Before they sign

| Step                              | Who   | Status                                               |
| --------------------------------- | ----- | ---------------------------------------------------- |
| Demo of the live app              | Sada  | Needs the MVP running                                |
| Answer the security questionnaire | Sada  | **[GAP]** — no written answers exist                 |
| Sign the DPA                      | Legal | **[GAP]** — not drafted; B2B buyers ask at signature |
| Agree pricing and terms           | Sada  | **[GAP]** — no pricing model defined anywhere        |
| Confirm data residency            | —     | Satisfied: `ap-south-1`, Mumbai                      |

Three gaps before a contract can be signed, and none of them are engineering.

---

## Day 1 — account and configuration

**0. One time only — make yourself a platform admin.** Nothing in the application can do
this, on purpose: a self-service path into `platform_admins` would be god-mode over every
customer. Sign in to Neuvto normally first, so Supabase Auth creates your account properly,
then run this once as `service_role`:

```sql
insert into public.platform_admins (user_id, note)
select id, 'Sada — founder' from auth.users where email = 'you@neuvto.com';
```

**Sign in FIRST.** Creating the auth user with a bare `INSERT` into `auth.users` produces an
account that cannot sign in at all — GoTrue scans the token columns into non-nullable Go
strings and joins `auth.identities`, so a row missing either fails every lookup with
"Database error finding user". The seed file carries the full incantation if you ever need it;
signing in normally avoids needing it.

**0b. One time per environment — set the two Vault secrets.** Applying every migration is not
enough. `notification_dispatch_url` and `notification_dispatch_key` cannot live in a migration,
because a migration is a file in git, so a fresh environment has a cron job faithfully running
every minute against nothing. **Every email queues and none sends** — which is precisely how
the first provisioning attempt failed. See the Vault section of
[DEPLOYMENT.md](DEPLOYMENT.md), and confirm with:

```bash
PSQL=psql DATABASE_URL="<the target>" bash neuvto-harness/tests/verify_scheduled_work.sh
```

**1. Provision the workspace** at `/neuvto-hq`: company name, address, and the administrator's
email and phone. They are invited, not created — they accept like anybody else, which means
they have proved they control the address before they hold the role (D39).

**2. Grant their modules** on the same screen (D44). A module Neuvto has not granted cannot be
switched on by the customer, and its functions refuse in the database rather than merely
hiding a menu item. Leave is the only one available today; Attendance and Payroll are seeded
as `coming_soon`.

**3. They accept the invitation** and land on the **setup wizard**, not a dashboard. If the
email is slow, `/neuvto-hq` shows a copyable link until it is accepted. TOTP enrolment (D21) is
not built yet.

The wizard walks them through the next four steps and every one of them is also reachable
from Settings afterwards — it is a guided path through the same forms, not a separate
configuration store. They can abandon it and come back; nothing is lost and nothing is
claimed as done that is not (D46).

**4. Company identity** — display name, logo, industry (D45). The display name is what their
own people see in the shell and in every invitation email the workspace sends, so a company
registered as "Testco Facilities Management Pvt Ltd" can simply be "Testco" to its staff.

**5. The working calendar.** Financial year start, working week, public holidays. Ask early —
an Indian firm on April–March and a Gulf firm on Friday/Saturday are both normal, six-day
weeks are ordinary, and getting this wrong invalidates every balance calculated afterwards.

**6. Modules.** Which of the granted modules to switch on. Neuvto grants; they choose.

**7. Leave types**, in Settings. Name, days per year, notice period, maximum per request, and
whether approval is needed at all. Days per year is pro-rated by joined date (D3), so one
number configures the whole company.

**8. The approval chain** under Approval rules. Level 1 always; level 2 above a threshold they
choose. Confirm the threshold explicitly rather than leaving the default of 3 days.

**A one-person workspace cannot book leave that needs approval**, and that is correct rather
than broken: D13 forbids self-approval, so no level resolves. Either invite a second person,
or mark a leave type as needing no approval (D38).

---

## Day 2 — people

**9. Invite the team.** From the wizard, or from People afterwards — email, role and phone
per person. They accept the same way the administrator did. For anything past a handful of
people, use the CSV import below instead.

**10. Prepare the employee CSV.** Required: `email`, `full_name`, `joined_date`. Optional:
`manager_email`, `department`, `role`.

Two things reliably go wrong and are worth pre-empting: `joined_date` drives pro-rated
entitlement (D3), so a wrong date produces a wrong balance for the whole year; and
`manager_email` determines who approves, so an employee with no manager has nowhere to send
requests (D13).

**11. Dry-run the import.** Review what will be created and what will fail, per row.

**12. Import.** Partial success is expected — fix the failed rows and re-run.

**13. Set opening balances.** Only for a customer joining mid-year with leave already taken.
Enter `used_days` and `carryforward_days` per employee per type. Every override is audited.

**Skipping this is the most likely day-one mistake.** An employee who has taken 6 days this
year but shows a full balance will be allowed to book leave they have not got.

---

## Before the first real row exists — backups

Do this **before** the customer's people are invited, not after. The order is the whole
point: today production holds one auth user and losing it costs an afternoon; the moment
their staff enter leave, the same loss is unrecoverable, because a leave balance exists
nowhere else in the world.

Supabase's Free plan has **no automatic backups at all** — not short retention, none. Until
Neuvto is on Pro, the only backups that exist are the ones this produces.

- [ ] Take one: `bash scripts/backup-prod.sh`
- [ ] Prove it: `bash scripts/backup-prod.sh --restore-test` — replays it into the local
      stack and counts what comes back. A backup nobody has restored is a hope.
- [ ] Capture the logo files too — they are in S3, not in the database dump, and a restore
      without them renders every customer logo broken. See `BACKUPS.md`.
- [ ] Decide whether the daily `launchd` job goes on, and if it does, say out loud that it
      only runs while the laptop is awake.

Full detail, restore order and the honest limits: **`docs/operations/BACKUPS.md`**.

---

## Day 3 — verify before anyone relies on it

Do this with the customer watching, using their real data:

- [ ] The invitation email arrived **on its own**, with nobody pressing anything, and carries
      the customer's own display name rather than ours
- [ ] One employee signs in by email OTP and sees a balance that matches their records
- [ ] They submit a short request — it routes to the right manager
- [ ] The manager receives the email and approves; the balance moves correctly
- [ ] A request longer than the threshold routes to **two** approvers
- [ ] A request spanning a configured holiday does not count that day
- [ ] A manager applying for their own leave escalates rather than self-approving (D13)
- [ ] An employee cannot see anyone else's balance

The last item is the one to demonstrate deliberately. It is what a customer is really
buying, and it is far more convincing shown than asserted.

---

## Go live

**14. Announce internally.** The customer does this; a message from their HR lands better
than one from a vendor. **[GAP]** — no template exists.

**15. Support channel.** **[GAP]** — no help centre, no documented support process, no
response-time commitment. For customer one, direct email to Sada is honest and sufficient,
provided it is stated rather than assumed.

**16. Watch the first week.** Monitor for failed emails (`email.failed`), requests stuck
awaiting approval, and any harness alert. The nightly integrity check is the safety net.

---

## Gap summary

| Gap                                       | Blocks                                                    | Type                |
| ----------------------------------------- | --------------------------------------------------------- | ------------------- |
| Security questionnaire answers            | Signature                                                 | Writing             |
| DPA, privacy policy, terms                | Signature                                                 | Legal               |
| Pricing model                             | Signature                                                 | Business            |
| ~~Super-admin provisioning console~~      | **Closed** — `/neuvto-hq`, step 8                         | —                   |
| Vault secrets set by hand per environment | Every new environment                                     | Engineering         |
| ~~No backups of production~~              | **Closed** — `scripts/backup-prod.sh`, run before go-live | —                   |
| Backups depend on one laptop being awake  | Second customer                                           | Business (Pro plan) |
| Announcement template                     | Go-live polish                                            | Writing             |
| Help centre and support process           | Second customer                                           | Writing             |

**Six of seven open gaps are not engineering.** That is the useful finding: what stands
between the MVP and revenue is mostly legal and commercial work that no amount of building
will produce.

Re-run this runbook after each build phase. Gaps that appear late are the expensive ones.
