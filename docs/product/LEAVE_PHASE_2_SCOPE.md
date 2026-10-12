# Leave Management, phase 2: what the Core HR bundle asks for, and what needs deciding

**Version:** 1.2 · **Status:** Built: the contained items and all six substantial ones · **Applies to:** the `leave` module after the Employee Master (E0–E9)

The Core HR bundle's chapter 08 describes a second phase of Leave Management. The visual
redesign is done: every Leave screen now uses the Core HR tokens, type scale, cards and
container queries, inside the E1 shell. Chapter 08 itself is a **feature** specification,
comparable in size to the whole Employee Master, and several parts collide with decisions
the Leave module already made. This document lists what exists, what the bundle adds, and
where it conflicts, so the scope can be decided rather than guessed.

---

## Already built, and kept

| Bundle asks for                                                    | Neuvto today                                                                    |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Server-side day calculation, weekly offs and holidays excluded     | `calculate_working_days`, `working_days_excluded` (the frontend counts nothing) |
| Approval routed by the reporting line, Approvals tab for approvers | The platform's approval engine and queue, D57                                   |
| Balance detail with entitled, taken, pending, available            | `BalanceCard` spells the arithmetic out (D2: days reserved on application)      |
| Leave types, holidays, opening balances, carry-forward days        | Settings and `OpeningBalances`                                                  |
| Balance, taken and pending reports, scheduled by email             | Step 14 reports and `report_schedules`                                          |
| Team calendar                                                      | `TeamCalendar`                                                                  |

## New in the bundle, grouped by size

**Contained (days each). Built 12 Oct 2026, on Sada's choice:**

- Unpaid leave (LOP) as its own kind: no entitlement, nothing credited, availed only; Apply
  Leave's side panel changes shape for it (criteria 1).
- Reject needs a reason code **and** a note; bulk "Approve selected".
- The approval-level SLA line ("Escalates to Level 2 in 1 day"), from the existing chains.
- Removing a leave type or holiday behind a modal that states the consequence (criterion 6).
- Blackout periods with add, edit and remove (criterion 7).

**Substantial (a stage each). Built 12 Oct 2026, when Sada asked for phase 2 to be completed:**

- **Compensatory off** as an earned kind: a claim with a required eligibility reason, a
  repeating work log, proof upload, approver credit, expiry, and a register (criteria 2–4).
  Any date qualifies, weekdays included.
- **Accrual**: spread (1.25 a month), one-shot, or earned on approval, with mid-year joiners
  pro-rated. Today a balance is credited whole.
- **Carry-forward review** that does nothing until an Admin locks it (criterion 8).
- **Delegation** of approval for a date range and scope.
- **Notifications configuration**: an event-by-recipient matrix with mandatory rows locked,
  and custom recipients scoped to a department (criterion 9).
- **Reports**: liability, comp-off register, approval turnaround and absenteeism, with PDF
  and Excel export besides CSV.

### As built

- **Unpaid leave.** `leave_types.kind` is `paid` or `unpaid`, chosen when the type is created
  and fixed after (the database refuses a change). An unpaid type has no allowance and **no
  balance row at all**, so every balance update has nothing to touch; Apply shows "Unpaid,
  no balance" with the days taken and awaiting a decision this year (`leave_my_unpaid()`),
  never a shortfall. The balances report and opening balances leave it out.
- **Reject reason and note.** Rejecting needs a reason code (needed at work, not enough
  notice, against policy, documents missing, other) and a note of at least three
  characters, enforced by `approval_decide()` for every module's approvals. The person sees
  both in the approval history.
- **Approve selected.** Tick requests in Approvals and approve them together;
  `approval_decide_many()` approves each through the same rules and reports each refusal by
  name. Approve only: a rejection needs its own reason.
- **The escalation line, changed.** The bundle's "Escalates to Level 2 in 1 day" would be
  false: `escalate_after_days` is stored on each chain level, but **nothing has ever acted
  on it**. Approvals now says how long a request has waited at its level against that
  target ("waiting 3 days at level 1 of 2 · over the 2-day target"), and never promises an
  escalation. **Real automatic escalation is a decision for Sada:** what happens when the
  target passes (move to the next level, add the approver's manager, or only notify).
- **Removing behind a statement of the consequence.** Archiving a leave type shows how many
  requests are waiting, how much approved leave is still to come, and how many people lose
  days they have left (`leave_type_impact()`). Removing a holiday says that date is counted
  as a working day from now on and that leave already applied for is not recounted.
  Removing a blackout says the same of blackouts.
- **Blackout periods.** Leave configuration has a Blackout periods section (Leave Admin
  only): a name and a date range. Apply names a blackout the dates fall in and will not
  send; the database refuses it either way (`BLACKOUT_PERIOD`). Leave already applied for is
  never touched.

Proved in `neuvto-harness/tests/verify_leave_phase2.sql`, every guard sabotaged, and in the
render tests of Apply, the approval card, Leave types, Blackouts, Approvals and Settings,
each watched failing first.

## Conflicts that need a decision

1. **Company profile, working calendar, financial year and time zone** sit in Leave's
   configuration in the bundle (sections 01–03). In Neuvto they are platform settings (D45,
   D46), shared by every module. Recommendation: keep them on the platform; Leave links to
   them.
2. **Departments and designations** (section 06). Designations now belong to the Employee
   Master (E9) and departments to the platform. Recommendation: Leave links, never owns.
3. **Payroll cut-off rules** (section 08: adjust next payroll, block, re-open payroll). Payroll
   is parked (D81). Recommendation: build these with Payroll, not before.
4. **"Sending address managed by the platform administrator"** (section 10) matches D42 and
   the email setup already; nothing to change, only to state on screen.
5. **Sandwich rule, optional holidays, location calendars** extend the working calendar,
   which is the platform's. Location calendars would hang off the Employee Master's deployment
   units. Recommendation: decide with Attendance, which needs the same calendars.

## Cost

Nothing paid. Everything above runs on the current Supabase and Cloudflare free tiers; the two
new libraries (jsPDF, jspdf-autotable) are MIT-licensed.

### Substantial items, as built

Each is a numbered decision in `NEUVTO_MVP_BUILD_SPEC.md`, chosen by Claude when Sada asked
for the rest to be completed, and each can be changed.

- **Automatic escalation (D87).** Past its level's target a waiting approval moves to the
  approver's manager, else the module's admin, else a company admin (active, able to approve,
  not the requester, not already signing). Both approvers are told; the history and the queue
  say where it came from. Nobody qualifying: it stays and the admins are told. Never decided
  by waiting. Swept every 15 minutes. The approval rules field is now "Move up after".
- **Opening balances for imported people (D88).** Staged against the employee record on
  Opening balances ("Not joined yet"), applied when they accept; a number that no longer fits
  is listed and never fails the acceptance.
- **Compensatory off (D89).** An "earned" leave type: claim days worked (any date, full or
  half, as many as needed), a reason, optional or required proof; the manager approves; the
  days are credited with the type's expiry; expiry takes only unused days, first in first out.
  Claimed at Leave › My Leave › Claim compensatory off.
- **Accrual (D90).** A paid type is credited all at once or a twelfth each month, rounded down
  to the half day; only what is credited can be booked.
- **Carry-forward review (D91).** Each paid type may carry up to so many days. Leave
  configuration › Carry-forward review: prepare, adjust within what is left, lock. Nothing
  changes before the lock; locking needs next year open and no balance moved since.
- **Delegation (D92).** Approvals › "Away? Hand your approvals over": a colleague who can
  approve, a date range, all modules or one; a company admin can do it for somebody. The
  history says who decided on whose behalf.
- **Notifications configuration (D93).** Leave configuration › Notifications: the matrix of
  events against audiences, the engine's own rules locked on, the rest switchable, plus named
  people for one department or all. Copies are worded "for your information".
- **Reports (D94).** Leave liability (in days; money waits for Payroll), compensatory off
  register, approval turnaround and absenteeism with the Bradford factor. Every report now
  exports Excel and PDF beside CSV (ExcelJS and jsPDF, both MIT, loaded on demand).

Each proved in its own harness suite (`verify_escalation`, `verify_opening_staged`,
`verify_comp_off`, `verify_accrual`, `verify_carry_forward`, `verify_delegation`,
`verify_notification_rules`, `verify_leave_reports_more`), every guard sabotaged, and in
render tests watched failing first.

## Still open

The conflicts above (1–5) are unchanged: platform settings stay the platform's, payroll
cut-off waits for Payroll, and the sandwich rule, optional holidays and location calendars
wait for Attendance.
