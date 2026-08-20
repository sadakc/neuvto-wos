-- ============================================================================
-- NEUVTO WOS — a pay run has inputs, and they are not its output
--
-- `pay_run_lines` holds what the engine computed. It does not hold what
-- somebody typed, and the two must not share a table.
--
-- The workbook keeps them apart and is right to: the Muster Roll is what
-- happened, and the Salary Register is what follows from it. Storing days
-- payable on the computed line would mean a recompute either destroys the
-- input or preserves it by accident, and `payroll_replace_run_lines` deletes
-- every line each time by design.
--
-- So: this is the input sheet. It survives a recompute, it is what an
-- administrator edits, and computing reads it.
--
-- WHY DAYS AND NOT AN ATTENDANCE GRID. Sada, 20 Aug 2026: payroll takes days
-- payable, and the 31-column muster roll stays a later module. The number
-- arrives in halves because the codes behind it do — P/A is half a day present,
-- and the customer's July has people on 26.5.
--
-- The three hand-entered deductions live here for the same reason. TDS in the
-- source workbook is a column of hand-typed zeros; nothing computes it, and
-- pretending otherwise would be the one place this module invented a number.
-- ============================================================================

create table if not exists public.pay_run_days (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  pay_run_id      uuid not null references public.pay_runs(id) on delete cascade,
  employee_id     uuid not null references public.profiles(id) on delete cascade,

  days_payable    numeric(5, 2)  not null,
  arrears         numeric(12, 2) not null default 0,
  tds             numeric(12, 2) not null default 0,
  lwf             numeric(12, 2) not null default 0,
  other_deduction numeric(12, 2) not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  deleted_at timestamptz,

  -- Halves, matching leave_type_days_are_halves. A quarter day is not a thing
  -- any of the muster roll's codes can express, and 26.4 is a typo for 26.5.
  constraint pay_run_days_are_halves check (days_payable * 2 = floor(days_payable * 2)),
  constraint pay_run_days_sane       check (days_payable >= 0 and days_payable <= 31),
  constraint pay_run_days_amounts_sane
    check (arrears >= 0 and tds >= 0 and lwf >= 0 and other_deduction >= 0)
);

create unique index if not exists uq_pay_run_days_employee
  on public.pay_run_days (pay_run_id, employee_id) where deleted_at is null;

drop trigger if exists set_audit_fields on public.pay_run_days;
create trigger set_audit_fields before insert or update on public.pay_run_days
  for each row execute function public.set_audit_fields();
drop trigger if exists write_audit_log on public.pay_run_days;
create trigger write_audit_log after insert or update or delete on public.pay_run_days
  for each row execute function public.write_audit_log();

-- The same lock, for the same reason. Changing the input of an approved run is
-- changing the run: the next recompute would produce different money against a
-- payslip somebody has already been given.
drop trigger if exists pay_run_must_be_open on public.pay_run_days;
create trigger pay_run_must_be_open before insert or update or delete on public.pay_run_days
  for each row execute function public.pay_run_must_be_open();

alter table public.pay_run_days enable row level security;

-- Administrators only. An employee learns their days payable from their
-- payslip, which carries the figure the run was actually computed with — the
-- input table can be mid-edit and disagree with it.
drop policy if exists "admins read pay run days" on public.pay_run_days;
create policy "admins read pay run days" on public.pay_run_days
  for select to authenticated
  using (organization_id = public.current_org_id() and deleted_at is null and public.is_admin());

drop policy if exists "admins write pay run days" on public.pay_run_days;
create policy "admins write pay run days" on public.pay_run_days
  for all to authenticated
  using (organization_id = public.current_org_id() and public.is_admin())
  with check (organization_id = public.current_org_id() and public.is_admin());

grant select, insert, update, delete on public.pay_run_days to authenticated;

comment on table public.pay_run_days is
  'What an administrator entered for a pay run — days payable and hand-entered deductions (module: payroll). Survives a recompute; pay_run_lines does not.';

-- ═══════════════════════════════ the engine's inputs now include what was typed
--
-- Replacing payroll_run_inputs rather than adding a second function: one round
-- trip that returns everything the engine needs is the whole point of it, and
-- a caller that has to remember to fetch days separately is a caller that will
-- eventually compute a run without them and pay everybody a full month.
--
-- NOBODY DEFAULTS TO A FULL MONTH. An employee with no row here is returned
-- with daysPayable null, and the handler leaves them out of the run entirely.
-- Defaulting to days_in_month would pay somebody nobody has confirmed worked,
-- and defaulting to zero would issue a payslip saying they earned nothing.
-- Both are wrong in a way that reconciles perfectly against itself.
create or replace function public.payroll_run_inputs(_run_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
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
               'code', c.code, 'name', c.name,
               'countsForPfWages', c.counts_for_pf_wages, 'order', c.display_order)
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
        join lateral (
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
end $$;

comment on function public.payroll_run_inputs is
  'Components, people, their effective salary structures and what was entered for this run. Administrators only. daysPayable is null for anybody not yet entered — never defaulted.';

revoke all on function public.payroll_run_inputs(uuid) from public, anon;
grant execute on function public.payroll_run_inputs(uuid) to authenticated;
