-- ═══════════════════════════════════════════════════════════════════════════
-- A component has a category, and stops being editable once somebody is on it
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `salary_components` held a name, a code, an order and one boolean. That was
-- enough to reproduce a spreadsheet and is not enough to run a payroll: there is
-- no way to express a canteen recovery, a joining bonus paid whole, or an
-- allowance that counts towards provident fund only for people under the
-- ceiling. Four categories, from the source spec.
--
--   earning        becomes a line of pay
--   deduction      a standing amount taken off, itemised separately from the
--                  one-off correction typed into a run
--   benefit        configured, computes nothing yet
--   reimbursement  configured, computes nothing yet
--
-- The last two are honest rather than lazy. Both need a claims flow to mean
-- anything, and a component that looks configured while changing no payslip is
-- worse than one that was never offered — so the screen says so, the engine
-- ignores them, and a test asserts that it does.
--
-- ── counts_for_pf_wages becomes a three-way choice ─────────────────────────
--
-- `off` and `always` are what the boolean meant. `under_threshold` is the third
-- position employers actually take: include this allowance in PF wages for
-- somebody under the ceiling, so their contribution reaches the statutory
-- minimum, and leave everybody above it alone.
--
-- Worth recording, because it was nearly built as a no-op: while PF wages are
-- RESTRICTED to the ceiling, `min(base, cap)` and `min(base + extra, cap)` give
-- the same answer above the ceiling and below it, so the treatment is invisible.
-- It only means anything once an employer chooses "actual PF wage" over
-- "restricted" — which is a switch on the EPF scheme, not on the component.
--
-- ── Freeze after association ───────────────────────────────────────────────
--
-- The spec repeats this rule on every category: once a component is attached to
-- a real employee, only its name and its default amount stay editable. The
-- reason is reproducibility — flipping a component out of PF wages in November
-- would silently restate every payslip computed against it since April.
--
-- Enforced by a trigger rather than by the screen, because the screen is not
-- what a stale browser tab, an import or a future handler goes through.

-- ───────────────────────────────────────────────────────── the wider component

alter table public.salary_components
  add column if not exists category text not null default 'earning',
  add column if not exists name_in_payslip text,
  add column if not exists calculation_type text not null default 'flat_amount',
  add column if not exists default_amount numeric(12,2),
  add column if not exists default_percentage numeric(5,2),
  add column if not exists epf text,
  add column if not exists esi boolean not null default true,
  add column if not exists is_taxable boolean not null default true,
  add column if not exists is_pro_rata boolean not null default true,
  add column if not exists is_fbp boolean not null default false,
  add column if not exists show_on_payslip boolean not null default true,
  add column if not exists part_of_structure boolean not null default true,
  add column if not exists frequency text,
  add column if not exists max_amount_per_month numeric(12,2),
  add column if not exists unclaimed_policy text;

-- Carry the boolean across before it is dropped. Anything already configured
-- keeps behaving exactly as it did — this migration must not restate a payslip.
--
-- Guarded, because the column is gone on a second run and an unguarded UPDATE
-- would abort the file half-applied. Migrations get replayed: the harness
-- rebuilds from empty on every run, and a file that only works once is a file
-- that works until somebody looks.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'salary_components'
       and column_name = 'counts_for_pf_wages'
  ) then
    execute $q$
      update public.salary_components
         set epf = case when counts_for_pf_wages then 'always' else 'off' end
       where epf is null
    $q$;
  end if;
end $$;

-- Anything created after the column went, or by a fixture that never had it.
update public.salary_components set epf = 'always' where epf is null;

alter table public.salary_components alter column epf set not null;
alter table public.salary_components alter column epf set default 'always';
alter table public.salary_components drop column if exists counts_for_pf_wages;

-- The payslip falls back to the internal name, so this is never blank on screen.
update public.salary_components set name_in_payslip = name where name_in_payslip is null;

do $$
begin
  alter table public.salary_components
    add constraint salary_component_category_known
    check (category in ('earning', 'deduction', 'benefit', 'reimbursement'));
exception when duplicate_object then null; end $$;

do $$
begin
  alter table public.salary_components
    add constraint salary_component_epf_known
    check (epf in ('off', 'always', 'under_threshold'));
exception when duplicate_object then null; end $$;

do $$
begin
  alter table public.salary_components
    add constraint salary_component_calculation_known
    check (calculation_type in ('flat_amount', 'percent_of_ctc', 'percent_of_basic'));
exception when duplicate_object then null; end $$;

-- A percentage basis is an earning's business. A canteen recovery expressed as
-- "40% of basic" is not a thing anybody means, and allowing it would put a
-- number on screen that nothing computes.
do $$
begin
  alter table public.salary_components
    add constraint salary_component_percentage_is_an_earning
    check (calculation_type = 'flat_amount' or category = 'earning');
exception when duplicate_object then null; end $$;

do $$
begin
  alter table public.salary_components
    add constraint salary_component_frequency_known
    check (frequency is null or frequency in ('one_time', 'recurring'));
exception when duplicate_object then null; end $$;

do $$
begin
  alter table public.salary_components
    add constraint salary_component_unclaimed_known
    check (unclaimed_policy is null or unclaimed_policy in ('carry_forward', 'encash_monthly'));
exception when duplicate_object then null; end $$;

-- A percentage that is not a percentage, or an amount below zero, reaches a
-- payslip as a number nobody can explain.
do $$
begin
  alter table public.salary_components
    add constraint salary_component_amounts_sane
    check (
      (default_amount is null or default_amount >= 0)
      and (default_percentage is null or (default_percentage >= 0 and default_percentage <= 100))
      and (max_amount_per_month is null or max_amount_per_month >= 0)
    );
exception when duplicate_object then null; end $$;

-- ────────────────────────────────────────────── frozen once somebody is on it

create or replace function public.salary_component_freeze()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_used boolean;
begin
  select exists (
    select 1 from public.salary_structure_lines l
     where l.component_id = old.id and l.deleted_at is null
  ) into v_used;

  if not v_used then return new; end if;

  -- What may still change: what it is called, what it defaults to for the NEXT
  -- person set up, and whether it is still offered. None of those restates a
  -- payslip that has already been computed.
  if new.category           is distinct from old.category
     or new.epf             is distinct from old.epf
     or new.esi             is distinct from old.esi
     or new.calculation_type is distinct from old.calculation_type
     or new.is_pro_rata     is distinct from old.is_pro_rata
     or new.is_taxable      is distinct from old.is_taxable
     or new.part_of_structure is distinct from old.part_of_structure
     or new.code            is distinct from old.code
  then
    raise exception 'COMPONENT_IN_USE';
  end if;

  return new;
end $$;

-- SECURITY DEFINER so the freeze is unconditional — a guard that only holds
-- when the caller happens to be able to SEE the structure lines is a guard with
-- a hole in it. Which makes the revoke below mandatory rather than tidy: the
-- invariant suite refuses any definer function `anon` can execute, and it
-- caught this one. A trigger function is never called directly by anybody.
revoke all on function public.salary_component_freeze() from public, anon, authenticated;

drop trigger if exists salary_component_freeze on public.salary_components;
create trigger salary_component_freeze
  before update on public.salary_components
  for each row execute function public.salary_component_freeze();

-- ─────────────────────────────────── a frozen line carries its deductions too

alter table public.pay_run_lines
  add column if not exists deductions jsonb not null default '[]'::jsonb,
  add column if not exists component_deductions numeric(12,2) not null default 0;

-- ────────────────────────────── the run inputs, carrying the wider definition
--
-- Replaces the version from 20260823130000. The `left join lateral` is
-- unchanged and is load-bearing: somebody with no salary structure arrives with
-- no components and is named on screen as unpayable, rather than not arriving.
--
-- `fixedComponents` now includes DEDUCTION components as well as earnings —
-- both live on a salary structure, and which of the two an amount is depends on
-- the component's category, not on which list it arrived in. The engine sorts
-- them out; the database does not need a second opinion.

create or replace function public.payroll_run_inputs(_run_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_run public.pay_runs%rowtype;
  v_out jsonb;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;

  select * into v_run from public.pay_runs
   where id = _run_id and organization_id = public.current_org_id() and deleted_at is null;
  if v_run.id is null then raise exception 'NOT_FOUND'; end if;

  select jsonb_build_object(
    'periodMonth', v_run.period_month,
    'daysInMonth', v_run.days_in_month,
    'status', v_run.status,
    'components', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', c.code,
               'name', coalesce(c.name_in_payslip, c.name),
               'category', c.category,
               'epf', c.epf,
               'proRata', c.is_pro_rata,
               'order', c.display_order)
             order by c.display_order, c.code)
        from public.salary_components c
       where c.organization_id = v_run.organization_id
         and c.deleted_at is null and c.status = 'active'
    ), '[]'::jsonb),
    'employees', coalesce((
      select jsonb_agg(jsonb_build_object(
               'employeeId', p.id,
               'employeeCode', p.employee_code,
               'employeeName', p.full_name,
               'departmentName', d.name,
               'daysPayable', dy.days_payable,
               'arrears', coalesce(dy.arrears, 0),
               'tds', coalesce(dy.tds, 0),
               'lwf', coalesce(dy.lwf, 0),
               'otherDeduction', coalesce(dy.other_deduction, 0),
               'fixedComponents', coalesce((
                 select jsonb_agg(jsonb_build_object('code', c.code, 'amount', l.amount)
                        order by c.display_order, c.code)
                   from public.salary_structure_lines l
                   join public.salary_components c on c.id = l.component_id
                  where l.structure_id = s.id and l.deleted_at is null
                    and c.deleted_at is null and c.status = 'active'
               ), '[]'::jsonb))
             order by p.employee_code nulls last, p.id)
        from public.profiles p
        left join public.departments d
               on d.id = p.department_id and d.deleted_at is null
        left join public.pay_run_days dy
               on dy.pay_run_id = _run_id and dy.employee_id = p.id and dy.deleted_at is null
        left join lateral (
          select s2.id from public.salary_structures s2
           where s2.employee_id = p.id and s2.deleted_at is null
             and s2.effective_from <= (v_run.period_month + interval '1 month - 1 day')::date
           order by s2.effective_from desc
           limit 1
        ) s on true
       where p.organization_id = v_run.organization_id
         and p.deleted_at is null and p.is_active
    ), '[]'::jsonb)
  ) into v_out;

  return v_out;
end
$function$;

revoke all on function public.payroll_run_inputs(uuid) from public, anon;
grant execute on function public.payroll_run_inputs(uuid) to authenticated;

-- ─────────────────────────────── the frozen line, carrying its own deductions

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
    pf_wages, pf_employee, eps, eps_difference,
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
