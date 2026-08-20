-- ============================================================================
-- NEUVTO WOS — payroll can actually be run
--
-- The customer's payroll is an eleven-sheet Excel workbook wired together by
-- VLOOKUP. It works, and it is failing in ways a spreadsheet cannot catch:
-- every lookup is hard-coded to row 49, so the 45th hire silently disappears
-- from PF, ESI, the bank file and their own payslip — no error, just absence.
--
-- ── WHERE THE ARITHMETIC LIVES, AND WHY IT IS NOT HERE
--
-- Leave puts its rules in SQL deliberately: a working day and a balance must
-- mean the same thing to a handler, a constraint and a report. Payroll does
-- not, and the departure is a decision rather than an oversight.
--
-- Sada, 20 Aug 2026, chose a calculation engine as a peer package —
-- `src/payroll-core/`, pure TypeScript, no database. The reason it earns that
-- shape: its acceptance test is a real month of the workbook it replaces, all
-- 44 employees, every figure against what Excel actually produced. That test
-- runs in milliseconds with no database at all, and the same engine will serve
-- a native client and a REST route unchanged.
--
-- SO THIS SCHEMA GUARDS WHAT THE ENGINE CANNOT: who may run a payroll, whose
-- payroll they may run, and that an approved one can never be quietly changed.
--
-- AND IT REFUSES A LINE THAT CONTRADICTS ITSELF. The database does not compute
-- net pay, but it does know that net pay is earned gross less deductions, and
-- that total deductions are the sum of their parts. Those are CHECK
-- constraints below. A future caller — a bad import, a half-written migration,
-- a third-party integration — cannot write a payslip whose own numbers
-- disagree, even though nothing here worked them out.
--
-- ── FROZEN, NOT JOINED
--
-- `pay_run_lines` copies the employee code, the department and the component
-- breakdown rather than joining to them. A payslip issued in July must still
-- render July after somebody moves department in August, and after a salary
-- component is renamed or archived. A joined payslip is a payslip that changes
-- behind the person it was issued to.
--
-- That is also why the breakdown is jsonb and not a child table: its whole
-- purpose is to survive the definitions it came from being edited or removed,
-- which a foreign key exists to prevent.
-- ============================================================================

-- ═══════════════════════════════════════════════ what the organisation pays

create table if not exists public.salary_components (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  code                text not null,
  name                text not null,
  -- The only flag the arithmetic reads. Stated as "does this make up PF wages"
  -- rather than "subtract HRA", so it survives an employer who calls the
  -- component something else or has two of them.
  counts_for_pf_wages boolean not null default true,
  display_order       integer not null default 0,
  status              text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  deleted_at timestamptz,

  constraint salary_component_code_present check (length(btrim(code)) > 0),
  constraint salary_component_name_present check (length(btrim(name)) > 0),
  -- The code reaches a payslip and an export column header. Spaces and
  -- punctuation in it become a CSV that a bank or the EPFO portal rejects.
  constraint salary_component_code_shape   check (code ~ '^[a-z][a-z0-9_]*$')
);

create unique index if not exists uq_salary_component_code
  on public.salary_components (organization_id, code) where deleted_at is null;
create index if not exists idx_salary_components_org
  on public.salary_components (organization_id) where deleted_at is null;

-- ═══════════════════════════════════ what payroll knows that nothing else does
--
-- Separate from `profiles` on purpose. A bank account number and a PAN must not
-- be readable by everything that reads a name, and `profiles` is read by every
-- module, every report and the approvals queue. D42 — Neuvto staff never read
-- tenant data — is about people; this is the same argument about columns.

create table if not exists public.payroll_employee_details (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  employee_id         uuid not null references public.profiles(id) on delete cascade,
  uan                 text,
  esi_number          text,
  pan                 text,
  bank_name           text,
  bank_account_number text,
  bank_ifsc           text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  deleted_at timestamptz,

  -- Shapes, not existence. Every one of these is nullable, because payroll is
  -- configured over weeks and a person without a UAN yet is ordinary. But a UAN
  -- with eleven digits is a PF return that the portal rejects in bulk, hours
  -- after the deadline, and the workbook has no way to say so.
  constraint payroll_uan_shape  check (uan  is null or uan  ~ '^[0-9]{12}$'),
  constraint payroll_pan_shape  check (pan  is null or pan  ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  constraint payroll_ifsc_shape check (bank_ifsc is null or bank_ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  constraint payroll_esi_shape  check (esi_number is null or esi_number ~ '^[0-9]{10,17}$'),
  constraint payroll_account_shape
    check (bank_account_number is null or bank_account_number ~ '^[0-9]{5,20}$')
);

create unique index if not exists uq_payroll_employee_details
  on public.payroll_employee_details (employee_id) where deleted_at is null;

-- ═══════════════════════════════════════════════════════ what a person is paid

create table if not exists public.salary_structures (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id     uuid not null references public.profiles(id) on delete cascade,
  effective_from  date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  deleted_at timestamptz
);

create unique index if not exists uq_salary_structure_effective
  on public.salary_structures (employee_id, effective_from) where deleted_at is null;
create index if not exists idx_salary_structures_lookup
  on public.salary_structures (organization_id, employee_id, effective_from desc)
  where deleted_at is null;

create table if not exists public.salary_structure_lines (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  structure_id    uuid not null references public.salary_structures(id) on delete cascade,
  component_id    uuid not null references public.salary_components(id) on delete restrict,
  -- Whole rupees. Every formula in the source workbook ends ROUND(…, 0), and
  -- paise that nothing downstream can hold are paise that go missing in a
  -- statutory return.
  amount          numeric(12, 2) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  deleted_at timestamptz,

  constraint salary_structure_line_amount_sane check (amount >= 0)
);

create unique index if not exists uq_salary_structure_line
  on public.salary_structure_lines (structure_id, component_id) where deleted_at is null;

-- ═══════════════════════════════════════════════════════════════ the pay run

create table if not exists public.pay_runs (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  -- Always the first of the month. A pay run is for July, not for the 14th.
  period_month        date not null,
  days_in_month       integer not null,
  status              text not null default 'draft'
                      check (status in ('draft', 'pending_approval', 'approved', 'paid')),
  approval_request_id uuid references public.approval_requests(id) on delete set null,
  computed_at         timestamptz,
  locked_at           timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  deleted_at timestamptz,

  constraint pay_run_period_is_first_of_month check (period_month = date_trunc('month', period_month)::date),
  constraint pay_run_days_sane check (days_in_month between 28 and 31),
  -- A locked run is one that has been approved. Storing both and letting them
  -- disagree is how "approved but still editable" happens.
  constraint pay_run_locked_when_decided
    check ((status in ('approved', 'paid')) = (locked_at is not null))
);

create unique index if not exists uq_pay_run_period
  on public.pay_runs (organization_id, period_month) where deleted_at is null;

create table if not exists public.pay_run_lines (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  pay_run_id       uuid not null references public.pay_runs(id) on delete cascade,
  employee_id      uuid not null references public.profiles(id) on delete restrict,

  -- Frozen copies. See the header — a payslip must not change behind the person
  -- it was issued to.
  employee_code    text,
  department_name  text,
  earned_components jsonb not null default '[]'::jsonb,

  fixed_gross      numeric(12, 2) not null,
  days_payable     numeric(5, 2)  not null,
  arrears          numeric(12, 2) not null default 0,
  earned_gross     numeric(12, 2) not null,

  pf_wages         numeric(12, 2) not null default 0,
  pf_employee      numeric(12, 2) not null default 0,
  eps              numeric(12, 2) not null default 0,
  eps_difference   numeric(12, 2) not null default 0,

  esi_eligible     boolean not null,
  esi_employee     numeric(12, 2) not null default 0,
  esi_employer     numeric(12, 2) not null default 0,

  professional_tax numeric(12, 2) not null default 0,
  tds              numeric(12, 2) not null default 0,
  lwf              numeric(12, 2) not null default 0,
  other_deduction  numeric(12, 2) not null default 0,
  total_deduction  numeric(12, 2) not null,
  net_payable      numeric(12, 2) not null,
  ncp_days         numeric(5, 2)  not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  deleted_at timestamptz,

  constraint pay_run_line_days_sane check (days_payable >= 0 and days_payable <= 31),
  constraint pay_run_line_breakdown_is_array check (jsonb_typeof(earned_components) = 'array'),

  -- ── THE ARITHMETIC THE DATABASE STILL OWNS
  --
  -- It does not compute these. It refuses a row where they disagree, which is
  -- the guarantee moving the engine into TypeScript would otherwise have cost.
  constraint pay_run_line_deductions_add_up check (
    total_deduction = pf_employee + esi_employee + professional_tax + tds + lwf + other_deduction
  ),
  constraint pay_run_line_net_adds_up check (
    net_payable = earned_gross - total_deduction
  ),
  -- Exempt and zero are different facts. The workbook renders both as 0 and
  -- cannot tell them apart, so nobody can see whether the test ever ran.
  constraint pay_run_line_esi_consistent check (
    esi_eligible or (esi_employee = 0 and esi_employer = 0)
  ),
  constraint pay_run_line_pf_split check (eps_difference = pf_employee - eps)
);

create unique index if not exists uq_pay_run_line_employee
  on public.pay_run_lines (pay_run_id, employee_id) where deleted_at is null;
create index if not exists idx_pay_run_lines_run
  on public.pay_run_lines (pay_run_id) where deleted_at is null;

-- ═══════════════════════════════════════════════════════════ audit and locking

do $$
declare t text;
begin
  foreach t in array array[
    'salary_components', 'payroll_employee_details', 'salary_structures',
    'salary_structure_lines', 'pay_runs', 'pay_run_lines'
  ] loop
    execute format('drop trigger if exists set_audit_fields on public.%I', t);
    execute format('create trigger set_audit_fields before insert or update on public.%I
                    for each row execute function public.set_audit_fields()', t);
    execute format('drop trigger if exists write_audit_log on public.%I', t);
    execute format('create trigger write_audit_log after insert or update or delete on public.%I
                    for each row execute function public.write_audit_log()', t);
  end loop;
end $$;

/**
 * An approved pay run never changes again.
 *
 * A TRIGGER RATHER THAN A POLICY, deliberately. RLS does not apply to a
 * SECURITY DEFINER function, and every write below arrives through one — so a
 * policy saying "only while draft" would guard the one path nobody uses and
 * miss all the ones they do. A trigger fires for every caller including
 * postgres, which is the point: this is the row that proves what somebody was
 * paid, and it has to be as hard to change for us as for them.
 */
create or replace function public.pay_run_must_be_open()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run uuid := coalesce(new.pay_run_id, old.pay_run_id);
  v_locked timestamptz;
begin
  select locked_at into v_locked from public.pay_runs where id = v_run;
  if v_locked is not null then
    raise exception 'PAY_RUN_LOCKED';
  end if;
  return coalesce(new, old);
end $$;

comment on function public.pay_run_must_be_open is
  'Refuses any change to the lines of an approved pay run, for every caller including SECURITY DEFINER functions and postgres.';

drop trigger if exists pay_run_must_be_open on public.pay_run_lines;
create trigger pay_run_must_be_open before insert or update or delete on public.pay_run_lines
  for each row execute function public.pay_run_must_be_open();

-- Unlocking is the same act as editing, so it is refused the same way. Without
-- this, "approved runs cannot change" is one UPDATE away from being false.
create or replace function public.pay_run_stays_locked()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.locked_at is not null and new.locked_at is null then
    raise exception 'PAY_RUN_LOCKED';
  end if;
  if old.locked_at is not null and new.status not in ('approved', 'paid') then
    raise exception 'PAY_RUN_LOCKED';
  end if;
  return new;
end $$;

drop trigger if exists pay_run_stays_locked on public.pay_runs;
create trigger pay_run_stays_locked before update on public.pay_runs
  for each row execute function public.pay_run_stays_locked();

-- ═══════════════════════════════════════════════════════════════════════ RLS

alter table public.salary_components        enable row level security;
alter table public.payroll_employee_details enable row level security;
alter table public.salary_structures        enable row level security;
alter table public.salary_structure_lines   enable row level security;
alter table public.pay_runs                 enable row level security;
alter table public.pay_run_lines            enable row level security;

-- Component definitions are the only payroll table everybody may read: a
-- payslip names them, and the person reading their own payslip is not an admin.
drop policy if exists "read salary components in scope" on public.salary_components;
create policy "read salary components in scope" on public.salary_components
  for select to authenticated
  using (organization_id = public.current_org_id() and deleted_at is null);

drop policy if exists "admins write salary components" on public.salary_components;
create policy "admins write salary components" on public.salary_components
  for insert to authenticated
  with check (organization_id = public.current_org_id() and public.is_admin());

drop policy if exists "admins update salary components" on public.salary_components;
create policy "admins update salary components" on public.salary_components
  for update to authenticated
  using (organization_id = public.current_org_id() and public.is_admin())
  with check (organization_id = public.current_org_id());

-- A bank account and a PAN. Yourself or an administrator — and deliberately NOT
-- your manager, who can already see your leave and has no reason to see where
-- your salary is paid.
drop policy if exists "read own payroll details" on public.payroll_employee_details;
create policy "read own payroll details" on public.payroll_employee_details
  for select to authenticated
  using (
    organization_id = public.current_org_id() and deleted_at is null
    and (employee_id = (select auth.uid()) or public.is_admin())
  );

drop policy if exists "admins write payroll details" on public.payroll_employee_details;
create policy "admins write payroll details" on public.payroll_employee_details
  for all to authenticated
  using (organization_id = public.current_org_id() and public.is_admin())
  with check (organization_id = public.current_org_id() and public.is_admin());

-- What somebody is paid. Same rule, same reason: a colleague's salary is the
-- most obvious privacy failure this module could have, and a manager is a
-- colleague.
drop policy if exists "read own salary structure" on public.salary_structures;
create policy "read own salary structure" on public.salary_structures
  for select to authenticated
  using (
    organization_id = public.current_org_id() and deleted_at is null
    and (employee_id = (select auth.uid()) or public.is_admin())
  );

drop policy if exists "admins write salary structures" on public.salary_structures;
create policy "admins write salary structures" on public.salary_structures
  for all to authenticated
  using (organization_id = public.current_org_id() and public.is_admin())
  with check (organization_id = public.current_org_id() and public.is_admin());

drop policy if exists "read own salary structure lines" on public.salary_structure_lines;
create policy "read own salary structure lines" on public.salary_structure_lines
  for select to authenticated
  using (
    organization_id = public.current_org_id() and deleted_at is null
    and exists (
      select 1 from public.salary_structures s
       where s.id = salary_structure_lines.structure_id
         and (s.employee_id = (select auth.uid()) or public.is_admin())
    )
  );

drop policy if exists "admins write salary structure lines" on public.salary_structure_lines;
create policy "admins write salary structure lines" on public.salary_structure_lines
  for all to authenticated
  using (organization_id = public.current_org_id() and public.is_admin())
  with check (organization_id = public.current_org_id() and public.is_admin());

-- A pay run itself is an administrative object; its existence is not secret to
-- an approver who has to decide it.
drop policy if exists "read pay runs in scope" on public.pay_runs;
create policy "read pay runs in scope" on public.pay_runs
  for select to authenticated
  using (
    organization_id = public.current_org_id() and deleted_at is null
    and (
      public.is_admin()
      or exists (
        select 1 from public.approval_requests ar
         where ar.id = pay_runs.approval_request_id and public.is_approver_on(ar.id)
      )
    )
  );

-- No INSERT or UPDATE policy. Runs are opened, computed, submitted and locked
-- through the functions below, which hold the ordering rules. A direct insert
-- would produce a run with no days_in_month agreed and no lines.

-- Your own payslip line, or an administrator's view of the run. An approver
-- sees the run's totals, not every colleague's net pay — approving a payroll
-- does not require reading each person's salary.
drop policy if exists "read own pay run line" on public.pay_run_lines;
create policy "read own pay run line" on public.pay_run_lines
  for select to authenticated
  using (
    organization_id = public.current_org_id() and deleted_at is null
    and (employee_id = (select auth.uid()) or public.is_admin())
  );

-- ═══════════════════════════════════════════════════════════════════ grants

grant select, insert, update on public.salary_components        to authenticated;
grant select, insert, update, delete on public.payroll_employee_details to authenticated;
grant select, insert, update, delete on public.salary_structures      to authenticated;
grant select, insert, update, delete on public.salary_structure_lines to authenticated;
grant select on public.pay_runs      to authenticated;
grant select on public.pay_run_lines to authenticated;

-- ══════════════════════════════════════════════════════════════════ functions

/**
 * Everything the calculation engine needs for one run, in one round trip.
 *
 * Assembled here rather than in the handler because the "which structure
 * applies" question is a lateral join over effective dates, and expressing it
 * in TypeScript means fetching every structure a person has ever had and
 * picking in memory. It is also the query that decides whose pay is computed,
 * which is not a decision to make client-side.
 *
 * WHO IS IN A PAY RUN: everybody active, in this organisation, who has a salary
 * structure effective on or before the period. Somebody with no structure is
 * left out rather than paid zero — a zero payslip is a statement that they
 * earned nothing, and "not set up yet" is a different fact that the screen
 * reports separately.
 */
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
               'departmentName', d.name,
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
        -- The latest structure effective on or before this period. `distinct
        -- on` rather than a window function so a person with a July revision
        -- and an unapplied September one is paid July's.
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
  'Components, people and their effective salary structures for one pay run. Administrators only; somebody with no structure is omitted rather than paid zero.';

/**
 * Writes what the engine computed.
 *
 * Replace, not merge. A recompute after somebody''s days change must not leave
 * a line from the previous attempt for an employee who has since been
 * deactivated — a stale row here is money paid to somebody who should not have
 * been in the run, and it would reconcile perfectly against itself.
 *
 * The line's own arithmetic is checked by the CHECK constraints on the table,
 * not here. This function's job is who, whose, and when.
 */
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
    earned_components, fixed_gross, days_payable, arrears, earned_gross,
    pf_wages, pf_employee, eps, eps_difference,
    esi_eligible, esi_employee, esi_employer,
    professional_tax, tds, lwf, other_deduction, total_deduction, net_payable, ncp_days
  )
  select
    v_run.organization_id, _run_id,
    (l->>'employeeId')::uuid, l->>'employeeCode', l->>'departmentName',
    coalesce(l->'earnedComponents', '[]'::jsonb),
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

  -- Every employee in the payload must belong to this organisation. The insert
  -- above would otherwise accept an id from anywhere: `pay_run_lines` has a
  -- foreign key to `profiles`, and `profiles` spans every tenant.
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

comment on function public.payroll_replace_run_lines is
  'Stores the computed pay run. Replaces rather than merges, so a recompute cannot leave a stale line for somebody no longer in the run.';

/** Opens the draft run for a month, or returns the one already open. */
create or replace function public.payroll_open_run(_period_month date)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org   uuid := public.current_org_id();
  v_first date := date_trunc('month', _period_month)::date;
  v_id    uuid;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  if not public.module_enabled_for(v_org, 'payroll') then raise exception 'MODULE_DISABLED'; end if;

  select id into v_id from public.pay_runs
   where organization_id = v_org and period_month = v_first and deleted_at is null;
  if v_id is not null then return v_id; end if;

  insert into public.pay_runs (organization_id, period_month, days_in_month)
  values (v_org, v_first,
          -- Calendar days, taken here rather than accepted from the caller.
          -- Proration divides by this number, so a client that sent 30 for
          -- July would underpay every prorated person in the run.
          extract(day from (v_first + interval '1 month - 1 day'))::integer)
  returning id into v_id;

  return v_id;
end $$;

comment on function public.payroll_open_run is
  'Opens the draft pay run for a month. days_in_month is computed here, never accepted from the caller — proration divides by it.';

/** Hands a computed run to the Approval Engine. */
create or replace function public.payroll_submit_run(_run_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run     public.pay_runs%rowtype;
  v_lines   integer;
  v_request uuid;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;

  select * into v_run from public.pay_runs
   where id = _run_id and organization_id = public.current_org_id() and deleted_at is null;
  if v_run.id is null then raise exception 'NOT_FOUND'; end if;
  if v_run.status <> 'draft' then raise exception 'PAY_RUN_NOT_DRAFT'; end if;

  select count(*) into v_lines from public.pay_run_lines
   where pay_run_id = _run_id and deleted_at is null;
  -- An empty run submitted and approved is a month in which nobody was paid and
  -- every record says the payroll was completed.
  if v_lines = 0 then raise exception 'PAY_RUN_EMPTY'; end if;

  v_request := public.approval_submit('pay_run', _run_id,
    jsonb_build_object('periodMonth', v_run.period_month, 'employees', v_lines));

  update public.pay_runs
     set status = 'pending_approval', approval_request_id = v_request
   where id = _run_id;

  return v_request;
end $$;

comment on function public.payroll_submit_run is
  'Submits a computed pay run for approval. Refuses an empty run — approving one would record that a month was paid when nobody was.';

/**
 * Locks the run when its approval is decided.
 *
 * Modelled on leave_on_approval_decided, and registered against the same table.
 * A rejected run returns to draft so the mistake can be corrected and
 * resubmitted, rather than stranding the month.
 */
create or replace function public.payroll_on_approval_decided()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.entity_type <> 'pay_run' then return new; end if;
  if new.status = old.status then return new; end if;

  if new.status = 'approved' then
    update public.pay_runs
       set status = 'approved', locked_at = now()
     where id = new.entity_id and locked_at is null;
  elsif new.status in ('rejected', 'cancelled') then
    update public.pay_runs
       set status = 'draft', approval_request_id = null
     where id = new.entity_id and locked_at is null;
  end if;

  return new;
end $$;

drop trigger if exists payroll_on_approval_decided on public.approval_requests;
create trigger payroll_on_approval_decided
  after update on public.approval_requests
  for each row execute function public.payroll_on_approval_decided();

comment on function public.payroll_on_approval_decided is
  'Locks an approved pay run and returns a rejected one to draft. A rejected run that stayed pending would strand the month.';

-- ── THE TRIGGER FUNCTIONS ARE REVOKED FIRST, AND THE HARNESS IS WHY
--
-- `create function` grants EXECUTE to PUBLIC, and `anon` inherits PUBLIC. All
-- three below are SECURITY DEFINER, so leaving that grant in place hands an
-- unauthenticated caller three functions that bypass RLS by definition. The
-- invariant suite caught exactly this the first time these were applied — the
-- same regression 20260808100000 fixed for four other functions, which had it
-- back the moment they were recreated.
--
-- Revoking does not stop them firing. PostgreSQL does not check EXECUTE on a
-- trigger function when the trigger runs; only a direct call is refused, and
-- nothing should ever call these directly.
revoke all on function public.pay_run_must_be_open()        from public, anon, authenticated;
revoke all on function public.pay_run_stays_locked()        from public, anon, authenticated;
revoke all on function public.payroll_on_approval_decided() from public, anon, authenticated;

revoke all on function public.payroll_run_inputs(uuid)              from public, anon;
revoke all on function public.payroll_replace_run_lines(uuid, jsonb) from public, anon;
revoke all on function public.payroll_open_run(date)                 from public, anon;
revoke all on function public.payroll_submit_run(uuid)               from public, anon;

grant execute on function public.payroll_run_inputs(uuid)               to authenticated;
grant execute on function public.payroll_replace_run_lines(uuid, jsonb) to authenticated;
grant execute on function public.payroll_open_run(date)                 to authenticated;
grant execute on function public.payroll_submit_run(uuid)               to authenticated;

comment on table public.salary_components        is 'Per-organisation salary component definitions (module: payroll).';
comment on table public.payroll_employee_details is 'Statutory identifiers and bank details (module: payroll). Separate from profiles so a bank account is not readable by everything that reads a name.';
comment on table public.salary_structures        is 'What a person is paid, from a date (module: payroll).';
comment on table public.salary_structure_lines   is 'Component amounts within a salary structure (module: payroll).';
comment on table public.pay_runs                 is 'One month''s payroll (module: payroll). Locked on approval and never editable again.';
comment on table public.pay_run_lines            is 'One person''s pay for one month, frozen at compute time (module: payroll).';

-- Payroll must be sellable before a customer can switch it on. The row already
-- exists — the module registry has seeded `payroll` as `coming_soon` since the
-- first migration, alongside `attendance` — so this flips the status rather
-- than inserting. Without it, payroll_open_run raises MODULE_DISABLED for every
-- customer, because module_enabled_for requires the module to be granted AND
-- enabled (D44).
--
-- Note what this does NOT do: switch it on for anybody. Granting a customer
-- Payroll is a Neuvto decision made per organisation through
-- platform_set_module, and enabling it is then theirs (D42/D44).
update public.modules
   set name = 'Payroll', status = 'available', updated_at = now()
 where key = 'payroll' and status <> 'available';
