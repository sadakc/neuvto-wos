# First Customer — Onboarding Runbook

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

**1. Provision the workspace** at `/admin`: company name, address, and the administrator's
email and phone. They are invited, not created — they accept like anybody else, which means
they have proved they control the address before they hold the role (D39).

**2. They accept the invitation** and land in the workspace as its administrator. If the email
is slow, `/admin` shows a copyable link until it is accepted. TOTP enrolment (D21) is not
built yet.

**3. Configure the working calendar** in Settings. Financial year start, working week, public
holidays. Ask early — an Indian firm on April–March and a Gulf firm on Friday/Saturday are
both normal, six-day weeks are ordinary, and getting this wrong invalidates every balance
calculated afterwards.

**4. Configure leave types** in Settings. Name, days per year, notice period, maximum per
request, and whether approval is needed at all. Days per year is pro-rated by joined date
(D3), so one number configures the whole company.

**5. Configure the approval chain** under Approval rules. Level 1 always; level 2 above a
threshold they choose. Confirm the threshold explicitly rather than leaving the default of 3
days.

**A one-person workspace cannot book leave that needs approval**, and that is correct rather
than broken: D13 forbids self-approval, so no level resolves. Either invite a second person,
or mark a leave type as needing no approval (D38).

---

## Day 2 — people

**6. Prepare the employee CSV.** Required: `email`, `full_name`, `joined_date`. Optional:
`manager_email`, `department`, `role`.

Two things reliably go wrong and are worth pre-empting: `joined_date` drives pro-rated
entitlement (D3), so a wrong date produces a wrong balance for the whole year; and
`manager_email` determines who approves, so an employee with no manager has nowhere to send
requests (D13).

**7. Dry-run the import.** Review what will be created and what will fail, per row.

**8. Import.** Partial success is expected — fix the failed rows and re-run.

**9. Set opening balances.** Only for a customer joining mid-year with leave already taken.
Enter `used_days` and `carryforward_days` per employee per type. Every override is audited.

**Skipping this is the most likely day-one mistake.** An employee who has taken 6 days this
year but shows a full balance will be allowed to book leave they have not got.

---

## Day 3 — verify before anyone relies on it

Do this with the customer watching, using their real data:

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

**10. Announce internally.** The customer does this; a message from their HR lands better
than one from a vendor. **[GAP]** — no template exists.

**11. Support channel.** **[GAP]** — no help centre, no documented support process, no
response-time commitment. For customer one, direct email to Sada is honest and sufficient,
provided it is stated rather than assumed.

**12. Watch the first week.** Monitor for failed emails (`email.failed`), requests stuck
awaiting approval, and any harness alert. The nightly integrity check is the safety net.

---

## Gap summary

| Gap                              | Blocks                   | Type        |
| -------------------------------- | ------------------------ | ----------- |
| Security questionnaire answers   | Signature                | Writing     |
| DPA, privacy policy, terms       | Signature                | Legal       |
| Pricing model                    | Signature                | Business    |
| Super-admin provisioning console | Scaling past customer ~3 | Engineering |
| Announcement template            | Go-live polish           | Writing     |
| Help centre and support process  | Second customer          | Writing     |

**Five of six are not engineering.** That is the useful finding: what stands between the MVP
and revenue is mostly legal and commercial work that no amount of building will produce.

Re-run this runbook after each build phase. Gaps that appear late are the expensive ones.
