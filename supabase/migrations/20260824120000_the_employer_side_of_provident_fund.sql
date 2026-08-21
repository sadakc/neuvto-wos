-- ═══════════════════════════════════════════════════════════════════════════
-- The employer's side of provident fund, frozen with the rest of the line
-- ═══════════════════════════════════════════════════════════════════════════
--
-- EDLI and administration charges are the employer's cost, never deducted from
-- anybody, and the ECR return asks for both separately. They are computed from
-- PF wages at compute time and have to be FROZEN like every other figure on the
-- line — a return filed in November for July must show July's rates, and rates
-- change by notification.
--
-- Both default to zero, and both stay zero unless the organisation has chosen
-- to include them (`includeEdli`, `includeAdminCharges` on the EPF scheme). An
-- establishment that has not made that choice sees no new figures anywhere.

alter table public.pay_run_lines
  add column if not exists edli numeric(12,2) not null default 0,
  add column if not exists pf_admin numeric(12,2) not null default 0;

-- Recreated to carry them. Everything else is unchanged from 20260824110000.
create or replace function public.payroll_replace_run_lines(_run_id uuid, _lines jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run   public.pay_runs%rowtype;
  v_count integer;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;

  select * into v_run from public.pay_runs
   where id = _run_id and organization_id = public.current_org_id() and deleted_at is null;
  if v_run.id is null then raise exception 'NOT_FOUND'; end if;
  if v_run.status <> 'draft' then raise exception 'PAY_RUN_NOT_DRAFT'; end if;
  if jsonb_typeof(_lines) <> 'array' then raise exception 'INVALID_LINES'; end if;

  delete from public.pay_run_lines where pay_run_id = _run_id;

  insert into public.pay_run_lines (
    organization_id, pay_run_id, employee_id, employee_code, department_name,
    earned_components, deductions, component_deductions,
    fixed_gross, days_payable, arrears, earned_gross,
    pf_wages, pf_employee, eps, eps_difference, edli, pf_admin,
    esi_eligible, esi_employee, esi_employer,
    professional_tax, tds, lwf, other_deduction, total_deduction, net_payable, ncp_days
  )
  select
    v_run.organization_id, _run_id,
    (l->>'employeeId')::uuid, l->>'employeeCode', l->>'departmentName',
    coalesce(l->'earnedComponents', '[]'::jsonb),
    coalesce(l->'deductions', '[]'::jsonb),
    coalesce((l->>'componentDeductions')::numeric, 0),
    (l->>'fixedGross')::numeric, (l->>'daysPayable')::numeric,
    (l->>'arrears')::numeric, (l->>'earnedGross')::numeric,
    (l->>'pfWages')::numeric, (l->>'pfEmployee')::numeric,
    (l->>'eps')::numeric, (l->>'epsDifference')::numeric,
    coalesce((l->>'edli')::numeric, 0), coalesce((l->>'pfAdmin')::numeric, 0),
    (l->>'esiEligible')::boolean, (l->>'esiEmployee')::numeric, (l->>'esiEmployer')::numeric,
    (l->>'professionalTax')::numeric, (l->>'tds')::numeric, (l->>'lwf')::numeric,
    (l->>'otherDeduction')::numeric, (l->>'totalDeduction')::numeric,
    (l->>'netPayable')::numeric, (l->>'ncpDays')::numeric
  from jsonb_array_elements(_lines) as l;

  get diagnostics v_count = row_count;

  if exists (
    select 1 from public.pay_run_lines pl
     join public.profiles p on p.id = pl.employee_id
    where pl.pay_run_id = _run_id and p.organization_id <> v_run.organization_id
  ) then
    raise exception 'CROSS_TENANT_EMPLOYEE';
  end if;

  update public.pay_runs set computed_at = now() where id = _run_id;
  return v_count;
end $$;

revoke all on function public.payroll_replace_run_lines(uuid, jsonb) from public, anon;
grant execute on function public.payroll_replace_run_lines(uuid, jsonb) to authenticated;
