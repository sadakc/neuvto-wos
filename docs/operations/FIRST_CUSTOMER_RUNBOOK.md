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

**1. Create the organisation.** Sada provisions it. **[GAP]** — no super-admin console
exists (`07_ROLES_PERMISSIONS.md` defines the role; nothing implements it). Manual SQL is
acceptable for customer one if it is a conscious choice, not for customer five.

**2. Invite the first admin**, who enrols TOTP at first sign-in (D21).

**3. Configure the working calendar.** Financial year start, weekend days, public holidays.
Ask early — an Indian firm on April–March and a Gulf firm on Friday/Saturday are both
normal, and getting this wrong invalidates every balance calculated afterwards.

**4. Configure leave types.** Name, days per year, notice period, maximum per request.

**5. Configure the approval chain.** Level 1 always; level 2 above a threshold they choose.
Confirm the threshold explicitly rather than leaving the default of 3 days.

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
