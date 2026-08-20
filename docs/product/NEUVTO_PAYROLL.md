# Payroll

**Version:** 1.0 · **Status:** Active · **Updated:** 20 Aug 2026

The second module. It replaces an eleven-sheet Excel workbook that runs a real
payroll every month, and its acceptance criterion is that workbook's own July
2026 figures — 44 employees, ₹851,500 gross, ₹650,587 net — reproduced exactly.

---

## What the spreadsheet was doing wrong

Not "was inefficient". Wrong, in ways a spreadsheet structurally cannot catch.

**Every lookup is hard-coded to row 49.** `VLOOKUP(B6,'Salary Register'!$B$6:$AG$49,…)`
covers 44 employees. The 45th hire returns `#N/A` at best and a neighbouring
row's data at worst, and disappears from PF, ESI, the bank file and their own
payslip. No error. Just absence.

**The professional tax return is the wrong state's form.** The PT sheet is
_Form 5A under the Andhra Pradesh Tax on Professions, Trades, Callings and
Employments Act, 1987_. The establishment is in Madikeri, Karnataka; the muster
roll is _Form 22 under the Karnataka Shops Rules, 1963_; and the slab actually
applied — ₹200 above ₹24,999 — is Karnataka's. A Karnataka deduction filed on
an Andhra return.

**The same 44 people have three department vocabularies.** `summary` reports
_Engineering_ as 7 people, ₹155,500, 196.5 days. `Sheet1` labels the identical
row _HR DEPARTMENT_. `Sheet9` says _HR department_. Same for _F&B Production_ /
_OPERATION DEPT_ and _F&B Service_ / _R & d DEPT_. Two of the three are pivot
caches nobody refreshed after a rename.

**Payslip email addresses are generated**: `=LEFT(C2,4)&"@gmail.com"` produces
`Sam @gmail.com` — with a space, and invalid. One sheet is named `"PT "`, with
a trailing space, which is why a lookup by exact name silently finds nothing.

---

## The one finding that changed the design

The workbook appears to derive salary components, and says so in its formula
bar:

```
K6 = ROUND(P6*50%,0)     Basic and DA = 50% of gross
L6 = ROUND(K6*40%,0)     HRA          = 40% of Basic
```

**Those rules hold for 12 and 20 of its 44 employees respectively.** Everyone
else has hand-keyed amounts. For all 44, the components sum exactly to gross.

The first 12 rows are formula-driven and the rest are not, so reading the top of
the sheet — which is what anyone does — gives exactly the wrong answer. An
engine built on those percentages would have silently restated the pay of three
quarters of the workforce.

**So a percentage is a template for setting somebody up, not a rule for paying
them.** Fixed component amounts are stored per employee. Salary components
define what exists, their payslip order, and the one flag the arithmetic
reads — whether a component makes up PF wages.

---

## Where the arithmetic lives

`src/payroll-core/` — pure TypeScript, no database, no clock, no React. ESLint
refuses any import that leaves the folder, in two blocks because the escape
depth differs by file depth (`../` already leaves from `engine.ts`; from
`__fixtures__/` it is still inside).

**This is a deliberate departure from Leave**, which keeps its rules in SQL so a
working day means the same thing to a handler, a constraint and a report.
Payroll earns the other shape because its acceptance test is a real month of a
real spreadsheet, and that test runs in milliseconds with no database at all.

**The database still refuses a line that contradicts itself.** It does not
compute net pay, but it knows:

| Constraint                       | What it refuses                           |
| -------------------------------- | ----------------------------------------- |
| `pay_run_line_net_adds_up`       | net ≠ earned gross − total deductions     |
| `pay_run_line_deductions_add_up` | total deductions ≠ the sum of their parts |
| `pay_run_line_pf_split`          | an EPF/EPS split that does not reconcile  |
| `pay_run_line_esi_consistent`    | an ESI-exempt person charged ESI          |

A bad import or a third-party integration cannot write a payslip whose own
numbers disagree, even though nothing in the database worked them out.

### Rounding

Excel `ROUND` sends a tie **away from zero**; `Math.round` sends it toward
+∞ and disagrees on negatives. Proration lands on an exact half constantly — a
salary of ₹31 over 26.5 days is 26.5 precisely — so `round0` and `roundUp0` in
`money.ts` are not defensive, they are load-bearing.

`roundUp0`'s nine-decimal snap **is** defensive: a scan of every integer gross
from 0 to 200,000 against all four rates in `DEFAULT_POLICY` finds no case where
binary dust survives into a different ceiling. It is kept because the rates are
policy input, not constants.

All money is integer rupees. Every formula in the source workbook ends
`ROUND(…, 0)`.

---

## The rules, as implemented

| Value                 | Rule                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------ |
| Earned component      | `round(fixed ÷ daysInMonth × daysPayable)` — calendar days, not a flat 30                                    |
| Earned gross          | `Σ earned components + arrears`                                                                              |
| PF wages              | `min(earnings from PF-counting components + arrears, 15000)`                                                 |
| PF / EPS / difference | `round(pfWages × 12%)` / `round(× 8.33%)` / `pf − eps`                                                       |
| ESI                   | eligible if **fixed** gross ≤ 21000; then `roundUp(earnedGross × 0.75%)` employee, `round(× 3.25%)` employer |
| Professional tax      | `earnedGross > 24999 → 200` (Karnataka)                                                                      |
| NCP days              | `round(daysInMonth − daysPayable)`                                                                           |

**The ESI asymmetry is deliberate.** Eligibility reads what somebody is
contracted to earn; the contribution is charged on what they actually earned.
Testing eligibility on earned gross would drop a well-paid employee into ESI in
any month they took unpaid leave, and enrol them for a period they cannot leave.

---

## Exempt is not zero

The workbook renders "outside ESI" and "ESI came to nothing" identically, as
`0`. Nobody can tell from the output whether the eligibility test ever ran, and
a return filed from it declares 44 members when 11 are covered.

`pay_run_lines.esi_eligible` is a separate boolean, and three surfaces say so:

- the payslip shows **not applicable**, not ₹0
- the salary register exports **exempt**
- the ESI return **omits** the uncovered, and states how many above the table

---

## Known divergences from statute

Recorded rather than silently corrected. The instruction was to mirror the
workbook exactly so output can be diffed cell-for-cell; every one of these is a
deliberate later decision, not an oversight.

1. **ESI contribution-period stickiness.** An employee whose wages cross
   ₹21,000 mid-period should stay covered until the period ends. This drops
   them immediately, as the workbook does.
2. **No EDLI 0.5% or PF admin charges** as separate lines. `EDLI WAGES` is
   reported; the contribution is not.
3. **No minimum-wage floor on Basic.** `gross × 50%` can fall below Karnataka
   minimum wages for the lowest-paid staff.
4. **TDS is hand-entered.** Column AC of the source workbook is a column of
   typed zeros. Nothing computes it, and pretending otherwise would be the one
   place this module invented a number.

The single correction made: **the PT report is Karnataka's, not Andhra
Pradesh's.**

---

## What a month looks like

1. **Open the run** — `payroll_open_run` computes `days_in_month` itself and
   never accepts it from the caller, because proration divides by it.
2. **Enter days payable** per person, in whole days or halves.
3. **Compute** — reads inputs, runs the engine, stores frozen lines.
4. **Submit** — hands it to the Approval Engine. An empty run is refused.
5. **Approve** — locks it. `locked_at` is set and the run never changes again.

**Anybody without days entered is left out and named on screen.** A full month
would pay somebody nobody confirmed worked; zero would issue a payslip saying
they earned nothing. Both reconcile perfectly against themselves.

`pay_run_days` is a separate table from `pay_run_lines` because inputs are not
output — `payroll_replace_run_lines` deletes every line on each recompute by
design.

---

## What is frozen, and why

`pay_run_lines` copies the employee code, department and component breakdown
rather than joining to them. A payslip issued in July must still render July
after somebody moves department in August, and after a component is renamed or
archived. The breakdown is `jsonb` for the same reason: its purpose is to
survive the definitions it came from being edited, which a foreign key exists to
prevent.

An approved run is protected by a **trigger, not a policy**. RLS does not apply
to `SECURITY DEFINER` functions and every write arrives through one, so a policy
would guard the single path nobody uses. Unlocking is refused too — it is
editing by another name. `verify_payroll.sql` has to disable the triggers to
tear its own fixture down, which is the proof.

---

## Who can see what

| Data                     | Employee | Manager | Approver | Admin |
| ------------------------ | -------- | ------- | -------- | ----- |
| Salary components        | ✓        | ✓       | ✓        | ✓     |
| Own payslip line         | ✓        | —       | —        | ✓     |
| Own bank details and PAN | ✓        | —       | —        | ✓     |
| Own salary structure     | ✓        | —       | —        | ✓     |
| Pay run totals           | —        | —       | ✓        | ✓     |
| Days payable             | —        | —       | —        | ✓     |

**A manager is a colleague.** They can already see their reports' leave; there
is no argument that they should see their salary or where it is paid. An
approver sees the run's totals and headcount, because approving a payroll is a
decision about an amount leaving the company and does not require reading each
person's net pay.

---

## Verification

- `src/payroll-core/engine.test.ts` — all 44 July 2026 employees, every figure,
  against the workbook's own cached cell values. Includes a test that moves one
  policy rate and requires the output to move, so a golden test compared against
  itself cannot pass.
- `neuvto-harness/tests/verify_payroll.sql` — 30 refusals, each asserted by
  attempting the thing and requiring it to fail.
- Render tests for the pay run and payslip screens, every one watched failing
  first.

The fixture holds **no names**. The engine never reads one, so none is stored.

---

## Not built

Muster-roll grid · TDS computation · loans · reimbursements · bonus and
off-cycle runs · full-and-final settlement · contractors · a public REST
surface · PDF payslips (HTML and print CSS — no dependency, no cost).

**The Leave→Payroll seam is missing and needs the platform.** A payslip should
show EL/CL/SL taken, and `registry.ts` is the only file permitted to import
`@/modules/*` — so Payroll cannot ask Leave. Those counts are entered alongside
days payable until a platform service exists to carry them.
