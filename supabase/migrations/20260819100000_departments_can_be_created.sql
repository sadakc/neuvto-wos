-- ============================================================================
-- NEUVTO WOS — a department can actually be created
--
-- Sada, 7 Aug 2026: "within reports, I see a drop down for the departments, but
-- I do not see it anywhere else to select what department an individual can be
-- added to. That's strange."
--
-- Stranger than it looked. `departments` has existed since the first migration,
-- with RLS, an admin write policy, grants, a parent column for hierarchy, and a
-- foreign key from `profiles`. Every report joins it. The spreadsheet import
-- validates against it. **Nothing in the product has ever written a row.**
--
-- So:
--   · the Department column in both leave reports is blank for everybody, always
--   · the import validates department names against a permanently empty list,
--     warns "No department called X" on every row that names one, and imports
--     the person without it
--
-- A table nobody can populate is indistinguishable from a table that does not
-- work. This migration is the write side.
--
-- ── TWO FAULTS FOUND WHILE BUILDING IT
--
-- 1. `unique (organization_id, name)` is a TABLE constraint, so it covers
--    soft-deleted rows. Remove "Sales" and the name is spent — no department
--    called Sales can ever exist in that workspace again, and the refusal would
--    arrive as a raw constraint violation on a name the admin cannot see
--    anywhere. `leave_types` already solved this exact problem with a partial
--    index; departments never got the same treatment.
--
--    Replaced with a partial unique index that is also case-insensitive, again
--    matching leave_types: "Sales" and "sales" are one department, and an admin
--    who types the second while the first exists should be told so rather than
--    given two.
--
-- 2. Soft-deleting a department leaves `profiles.department_id` pointing at it.
--    `read own departments` filters `deleted_at is null`, so the join returns
--    nothing and the person reads as having no department — while the column
--    still holds a live reference. That is a row that disagrees with itself, and
--    the report and the profile would answer the same question differently.
--
--    `department_remove` therefore clears the column in the same transaction and
--    returns how many people it moved, in the shape `deactivate_employee` uses,
--    so the screen can say what happened rather than guess.
-- ============================================================================

-- ═══════════════════════════════════════════════ uniqueness that can be reused

do $$
declare
  v_dupes bigint;
begin
  select count(*) into v_dupes from (
    select organization_id, lower(name)
      from public.departments
     where deleted_at is null
     group by 1, 2
    having count(*) > 1
  ) d;

  if v_dupes > 0 then
    -- Case-insensitivity is new here. Refuse rather than pick a winner: which of
    -- "Sales" and "sales" is the real one is a question about somebody's
    -- organisation chart, not about this migration.
    raise exception
      'Departments: % name(s) differ only by case within one organisation. Merge them before applying this migration.', v_dupes;
  end if;
end $$;

alter table public.departments drop constraint if exists departments_organization_id_name_key;

create unique index if not exists uq_department_name
  on public.departments (organization_id, lower(name))
  where deleted_at is null;

comment on index public.uq_department_name is
  'Partial and case-insensitive, matching uq_leave_type_name. A removed department frees its name; "Sales" and "sales" are one department.';

-- ═══════════════════════════════════════════════ assigning somebody to one

-- D50 — everything an administrator edits about somebody ELSE goes through a
-- SECURITY DEFINER function. `profiles` grants UPDATE on (full_name, phone) to
-- authenticated and nothing else, so this cannot be a column grant even if we
-- wanted one: a grant is per role, and both `update own profile` and
-- `admins write profiles` run as `authenticated`.
--
-- Modelled on admin_set_reporting_line, including that null clears it — somebody
-- has to be in no department, and a workspace that has not configured any is the
-- normal starting state.
create or replace function public.admin_set_department(
  _employee_id   uuid,
  _department_id uuid          -- null clears it
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
begin
  if v_org is null or not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.profiles
                  where id = _employee_id and organization_id = v_org and deleted_at is null) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  -- The tenancy check that makes this function worth existing. Without it an
  -- administrator could point somebody at another customer's department id — the
  -- foreign key would happily accept it, because a FK constrains existence and
  -- not ownership, and every report joining departments would then disclose a
  -- name across a tenant boundary.
  if _department_id is not null
     and not exists (select 1 from public.departments
                      where id = _department_id and organization_id = v_org
                        and deleted_at is null) then
    raise exception 'DEPARTMENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  update public.profiles
     set department_id = _department_id
   where id = _employee_id and organization_id = v_org;
end $$;

comment on function public.admin_set_department is
  'D58 — puts somebody in a department, or takes them out of one. Refuses a department belonging to another organisation, which a foreign key alone would accept.';

revoke all on function public.admin_set_department(uuid, uuid) from public, anon;
grant execute on function public.admin_set_department(uuid, uuid) to authenticated;

-- ═══════════════════════════════════════════════ removing one

-- Soft, per D17, and it clears the column on the way out — see the header. The
-- count comes back so the screen can say "3 people are no longer in a
-- department" instead of leaving the admin to find out from a report.
create or replace function public.department_remove(_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org    uuid := public.current_org_id();
  v_moved  int;
  v_kids   int;
begin
  if v_org is null or not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.departments
                  where id = _id and organization_id = v_org and deleted_at is null) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  -- A sub-department would be orphaned rather than deleted: parent_department_id
  -- is `on delete set null`, and this is a soft delete anyway, so the child would
  -- keep pointing at a row nothing can read. Refused instead — an administrator
  -- removing a branch of the tree should say what happens to the branch.
  select count(*) into v_kids
    from public.departments
   where parent_department_id = _id and deleted_at is null;
  if v_kids > 0 then
    raise exception 'DEPARTMENT_HAS_CHILDREN' using errcode = 'P0001';
  end if;

  update public.profiles
     set department_id = null
   where department_id = _id and organization_id = v_org and deleted_at is null;
  get diagnostics v_moved = row_count;

  update public.departments
     set deleted_at = now()
   where id = _id and organization_id = v_org;

  return jsonb_build_object('people_unassigned', v_moved);
end $$;

comment on function public.department_remove is
  'D58 — soft-removes a department and takes everybody out of it in the same transaction, so no profile is left pointing at a row nobody can read.';

revoke all on function public.department_remove(uuid) from public, anon;
grant execute on function public.department_remove(uuid) to authenticated;
