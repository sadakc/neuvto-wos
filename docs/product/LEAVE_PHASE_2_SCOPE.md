# Leave Management, phase 2: what the Core HR bundle asks for, and what needs deciding

**Version:** 1.0 · **Status:** For decision · **Applies to:** the `leave` module after the Employee Master (E0–E9)

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

**Contained (days each):**

- Unpaid leave (LOP) as its own kind: no entitlement, nothing credited, availed only; Apply
  Leave's side panel changes shape for it (criteria 1).
- Reject needs a reason code **and** a note; bulk "Approve selected".
- The approval-level SLA line ("Escalates to Level 2 in 1 day"), from the existing chains.
- Removing a leave type or holiday behind a modal that states the consequence (criterion 6).
- Blackout periods with add, edit and remove (criterion 7).

**Substantial (a stage each):**

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

Nothing paid. Everything above runs on the current Supabase and Cloudflare free tiers.

## What is needed from Sada

Which of the "substantial" items to build, and in what order. A suggested order, smallest
dependency first: unpaid leave and the reject reason (contained), then compensatory off,
then accrual and carry-forward review, then delegation and notifications configuration, then
the extra reports.
