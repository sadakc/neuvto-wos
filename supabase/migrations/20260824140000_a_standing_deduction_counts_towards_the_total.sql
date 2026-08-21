-- ═══════════════════════════════════════════════════════════════════════════
-- A standing deduction counts towards the total, and the CHECK now says so
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `pay_run_line_deductions_add_up` has asserted since the first payroll
-- migration that the total is the sum of its parts — the invariant that stops a
-- payslip whose deductions do not explain the gap between gross and net.
--
-- 20260824110000 added `component_deductions` and did not add it to that sum.
-- The engine computed the total correctly and the constraint refused the row,
-- so nothing was ever paid wrong — but the FIRST pay run containing a standing
-- deduction fails to compute, with a 400 and no explanation on screen.
--
-- Found by seeding a demo workspace and pressing Compute. It survived the test
-- suite because every fixture that exercised `component_deductions` did so in
-- the engine, where there is no constraint, and every fixture that reached the
-- database had none — so the two halves were each tested and their meeting
-- point was not. The harness assertion below is that meeting point.

alter table public.pay_run_lines drop constraint if exists pay_run_line_deductions_add_up;

alter table public.pay_run_lines
  add constraint pay_run_line_deductions_add_up
  check (
    total_deduction =
      pf_employee + esi_employee + professional_tax + tds + lwf
      + component_deductions + other_deduction
  );

-- EDLI and administration charges are deliberately NOT in that sum. They are
-- the employer's cost, charged on PF wages and never deducted from anybody —
-- adding them would make the constraint demand that the employee pay them.
