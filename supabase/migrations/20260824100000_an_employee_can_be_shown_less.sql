-- ═══════════════════════════════════════════════════════════════════════════
-- An employee can be shown less — and shown less means TOLD less, not drawn less
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Sada's rule for the employee view: the payslip, when the money lands, and
-- nothing else — with the administrator deciding what is shown.
--
-- The trap in "the administrator decides what is shown" is that it reads like a
-- display preference and is not one. A switch that only stops a component
-- rendering leaves the data one fetch away: `getRunLines` selects straight from
-- `pay_run_lines` under RLS, so anybody with the browser console open still has
-- every figure. This codebase has said so in three places already —
-- app-nav.tsx, the module contract, the payroll manifest — that a screen which
-- is merely not linked is not a permission.
--
-- So the switch lives where the refusal has to happen. `payroll_employee_portal`
-- reads the module's own settings row (D7) and the policy on `pay_run_lines`
-- consults it before handing an employee their own line.
--
-- ── What this deliberately does NOT gate ───────────────────────────────────
--
-- Administrators are unaffected. They can read every line in the workspace
-- regardless, which is what running payroll is, and gating them here would
-- break the pay run screen to no purpose.
--
-- The OTHER employee-portal switch — whether the statutory breakdown appears —
-- is enforced nowhere and belongs nowhere. It hides an employee's own PF and
-- ESI from the employee they belong to, which is a question of how much detail
-- a workspace wants on screen and not of who may see what. Enforcing that in
-- the database would dress a layout preference as a security boundary.

-- ─────────────────────────────────────────── the setting, read from the policy
--
-- Absent means visible. A workspace that has never opened the payroll settings
-- screen must still show people their payslips — defaulting to hidden would
-- mean shipping this migration silently switches every existing customer's
-- payslips off. That default matches `EmployeePortalInput` in the module's
-- contracts, and the two are required to agree: the screen shows the value this
-- function will act on.
--
-- SECURITY DEFINER with an explicit organisation filter, like `is_admin()` and
-- for the same reason — a policy calling a function that is itself subject to
-- RLS is a policy whose behaviour depends on a second policy.
create or replace function public.payroll_employee_portal(_key text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select (value -> 'employeePortal' ->> _key)::boolean
       from public.module_settings
      where organization_id = public.current_org_id()
        and module_key = 'payroll'
        and setting_key = 'settings'
        and deleted_at is null),
    true
  );
$$;

revoke all on function public.payroll_employee_portal(text) from public, anon;
grant execute on function public.payroll_employee_portal(text) to authenticated;

-- ────────────────────────────────────────────────────────── the policy itself
--
-- Replaces the policy from 20260823110000. The administrator branch is
-- untouched; only the employee's own-row branch gains the condition.
drop policy if exists "read own pay run line" on public.pay_run_lines;
create policy "read own pay run line" on public.pay_run_lines
  for select to authenticated
  using (
    organization_id = public.current_org_id() and deleted_at is null
    and (
      public.is_admin()
      or (
        employee_id = (select auth.uid())
        and public.payroll_employee_portal('payslipsVisible')
      )
    )
  );
