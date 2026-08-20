-- ============================================================================
-- NEUVTO WOS — a person has a job, not just a name
--
-- `profiles` has carried who somebody is since the first migration — name,
-- email, phone, start date, manager, department. It has never carried what they
-- do or what the employer calls them.
--
-- Payroll is the module that makes the gap concrete. Every line of the salary
-- register the customer produces today is keyed on an employee code, and every
-- payslip prints a designation. Both are on the person, not on the pay run:
-- they are the same in June and July, and they belong to somebody who has never
-- been paid yet.
--
-- SO THEY GO ON THE PLATFORM, NOT IN THE PAYROLL MODULE.
--
-- Sada, 20 Aug 2026: "All the employees who are added here [remain the same]
-- across any module."
--
-- That is the rule this migration implements. There is one roster, at
-- /app/members, and a module extends the people already in it. If the employee
-- code lived in Payroll, then switching Payroll off would take every employee
-- number with it, Attendance would grow a second one, and the two would drift.
-- A module may own what only it needs — a UAN, a bank account — and nothing
-- that another module would ask for.
--
-- ── WHAT IS DELIBERATELY NOT HERE
--
-- Gender. The muster roll records it and the plan named it, but no output in
-- this MVP consumes it: the PF return's columns are UAN, name, wages,
-- contributions and NCP days, and nothing else asks. A column no screen writes
-- and no report reads is a column that is wrong the first time somebody needs
-- it, because nothing has ever checked it. It arrives with the return that
-- requires it.
-- ============================================================================

alter table public.profiles
  add column if not exists employee_code text,
  add column if not exists designation   text;

-- ═══════════════════════════════════════════════════════ the employee code
--
-- Nullable, and it has to be. Every existing person predates this column, and
-- an employer who numbers nobody is not misconfigured — the code is theirs, not
-- ours, and Payroll asks for it only when somebody is actually being paid.
--
-- Uniqueness follows uq_department_name exactly, for the reasons found there:
--
--   PARTIAL, so a deactivated employee's code can be reissued. `profiles` is
--   soft-deleted, and a table constraint would spend "TISR0002" permanently the
--   first time somebody left.
--
--   CASE-INSENSITIVE, so "tisr0002" and "TISR0002" cannot both exist. They
--   would be one person to every human reading the register and two rows to the
--   VLOOKUP that replaced it.
create unique index if not exists uq_profile_employee_code
  on public.profiles (organization_id, lower(employee_code))
  where deleted_at is null and employee_code is not null;

comment on index public.uq_profile_employee_code is
  'Partial and case-insensitive, matching uq_department_name. A departed employee frees their code; "TISR0002" and "tisr0002" are one person.';

-- Blank is not a value. Without this an empty form field arrives as '' and the
-- unique index above happily accepts a second, a third and a fourth — every
-- person the admin skipped colliding on a code that reads as absent.
alter table public.profiles
  drop constraint if exists profiles_employee_code_present;
alter table public.profiles
  add constraint profiles_employee_code_present
  check (employee_code is null or length(btrim(employee_code)) > 0);

alter table public.profiles
  drop constraint if exists profiles_designation_present;
alter table public.profiles
  add constraint profiles_designation_present
  check (designation is null or length(btrim(designation)) > 0);

comment on column public.profiles.employee_code is
  'The employer''s own number for this person. Theirs, not ours — nothing generates it.';
comment on column public.profiles.designation is
  'Job title as it prints on a payslip. Free text: an employer names their own roles.';

-- ═══════════════════════════════════════════════════════════════ writing them
--
-- Both columns are administrator-only, and `profiles` already refuses this:
-- its update policy lets a person edit their own row, which would let anybody
-- retitle themselves Chief Executive and renumber themselves as a colleague.
--
-- So they are set through a function, the way a joined date and a reporting
-- line already are (admin_set_joined_date, admin_set_department), and the
-- column-level grant below is what stops the self-service route.
create or replace function public.admin_set_employment(
  _employee_id  uuid,
  _employee_code text,
  _designation   text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := nullif(btrim(_employee_code), '');
  v_desg text := nullif(btrim(_designation), '');
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  -- Same organisation, always. `is_admin()` says the caller administers THEIR
  -- workspace, not that they may reach into another one.
  if not exists (
    select 1 from public.profiles p
     where p.id = _employee_id
       and p.organization_id = public.current_org_id()
       and p.deleted_at is null
  ) then
    raise exception 'NOT_FOUND';
  end if;

  -- Caught here as well as by the index, because a raw 23505 arrives at the
  -- screen naming an index nobody has heard of. The admin needs to be told
  -- which code, and that somebody already has it.
  if v_code is not null and exists (
    select 1 from public.profiles p
     where p.organization_id = public.current_org_id()
       and p.deleted_at is null
       and p.id <> _employee_id
       and lower(p.employee_code) = lower(v_code)
  ) then
    raise exception 'DUPLICATE_EMPLOYEE_CODE: %', v_code;
  end if;

  update public.profiles
     set employee_code = v_code,
         designation   = v_desg
   where id = _employee_id;
end $$;

comment on function public.admin_set_employment is
  'Sets an employee code and designation. Administrators only, own organisation only — profiles'' own update policy would otherwise let a person retitle and renumber themselves.';

revoke all on function public.admin_set_employment(uuid, text, text) from public;
grant execute on function public.admin_set_employment(uuid, text, text) to authenticated;

-- The column grant is the actual guard. Without it the self-update policy on
-- `profiles` reaches these two columns and the function above is decoration.
revoke update on public.profiles from authenticated;
grant update (full_name, phone) on public.profiles to authenticated;

comment on table public.profiles is
  'A person in a workspace. Employment fields (employee_code, designation) are platform-owned so every module reads one roster — D42, and Sada 20 Aug 2026.';
