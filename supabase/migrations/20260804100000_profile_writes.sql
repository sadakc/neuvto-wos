-- ============================================================================
-- NEUVTO WOS — an employee could double their own leave
--
-- `authenticated` held UPDATE on every column of `profiles`. Policies filter
-- ROWS; grants filter COLUMNS; the two are independent, and `update own profile`
-- lets a person update their own row. So every employee could write every field
-- about themselves — including `joined_date`, which is the number their
-- entitlement is calculated from.
--
-- Demonstrated on the seed before this was written. As New Joiner, an ordinary
-- employee with no role beyond `employee`:
--
--     joined_date 2026-10-01  →  entitlement  6.0 days
--     update profiles set joined_date = '2020-01-01' where id = me;   -- UPDATE 1
--     joined_date 2020-01-01  →  entitlement 12.0 days
--
-- Twice the leave, self-served, one statement. Narrower than it first looks —
-- ensure_balance seeds entitled_days when the row is CREATED, so a balance that
-- already exists does not retrospectively move — which means the reach is a
-- leave type they have not touched yet, or simply next financial year. Neither
-- is a comfort.
--
-- The same grant let anybody set `is_active`, `deleted_at` and `manager_id` on
-- themselves, and any admin set them on anyone with no guard whatsoever. That
-- second half is what D14 has forbidden since day one and what
-- 20260804110000_deactivate_employee.sql exists to replace; this file is the
-- part that makes the guard mean something, because a guarded function is
-- decoration while the raw UPDATE is still there.
--
-- The step 9 treatment of `organizations`, one table over.
-- ============================================================================

revoke update on public.profiles from authenticated;

-- What a person may change about themselves. Nothing here alters an entitlement,
-- a permission, or who anybody reports to.
--
-- Not `email`: it is how somebody signs in and how an invitation was matched.
-- Not `joined_date`: see above.
-- Not `is_active` / `deleted_at` / `organization_id` / `id`: none of those are
-- an edit, they are a different operation wearing an edit's clothes.
--
-- `phone_normalized` is GENERATED ALWAYS and cannot be granted; `updated_at` and
-- `updated_by` are written by the set_audit_fields trigger, which does not need
-- the caller to hold the column.
grant update (full_name, phone) on public.profiles to authenticated;

-- ═══════════════════════════════════════════════════════ reporting lines
--
-- An administrator setting who reports to whom is ordinary and frequent. It is
-- also the one profile edit that can corrupt approval routing, so it gets a
-- function rather than a grant — a column grant cannot say "admins only",
-- because grants are per role and both `update own profile` and
-- `admins write profiles` run as `authenticated`.

create or replace function public.admin_set_reporting_line(
  _employee_id uuid,
  _manager_id  uuid          -- null clears it: somebody has to report to nobody
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

  if _manager_id is not null then
    if _manager_id = _employee_id then
      raise exception 'SELF_MANAGED' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.profiles
                    where id = _manager_id and organization_id = v_org
                      and deleted_at is null and is_active) then
      raise exception 'MANAGER_NOT_FOUND' using errcode = 'P0002';
    end if;

    -- ── cycles.
    --
    -- profiles_not_own_manager stops A→A and nothing stopped A→B→A. Both rows
    -- were accepted on the seed, and manager_of_manager then resolved Ravi's
    -- second level to Ravi himself — which D13 skips, so the request quietly
    -- lost a level the organisation had asked for. A ring of three or more was
    -- equally welcome.
    --
    -- Walk UP from the proposed manager: if we meet the employee, this edit
    -- closes a loop. The depth cap is a second line of defence — a cycle that
    -- already exists in the data would otherwise make this walk itself hang.
    if exists (
      with recursive up as (
        select p.id, p.manager_id, 1 as depth
          from public.profiles p
         where p.id = _manager_id and p.deleted_at is null
        union all
        select p.id, p.manager_id, up.depth + 1
          from public.profiles p
          join up on p.id = up.manager_id
         where p.deleted_at is null and up.depth < 64
      )
      select 1 from up where id = _employee_id
    ) then
      raise exception 'REPORTING_CYCLE' using errcode = 'P0001';
    end if;
  end if;

  update public.profiles
     set manager_id = _manager_id
   where id = _employee_id and organization_id = v_org;
end $$;

comment on function public.admin_set_reporting_line is
  'Sets who somebody reports to. Refuses a cycle — a loop makes manager_of_manager resolve to the requester, which D13 then skips, silently costing the request a level.';

revoke all on function public.admin_set_reporting_line(uuid, uuid) from public, anon;
grant execute on function public.admin_set_reporting_line(uuid, uuid) to authenticated;

-- ═══════════════════════════════════════════════════════ the start date
--
-- Kept editable, deliberately: a typo caught at onboarding is common and the
-- alternative is a support ticket. Admin-only now, and every change is recorded
-- by the existing write_audit_log trigger with the whole row before and after —
-- so a balance that moves later can be traced to who moved the date and when,
-- without this function writing an audit row of its own.

create or replace function public.admin_set_joined_date(
  _employee_id uuid,
  _joined_date date
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
  if _joined_date is null then
    raise exception 'JOINED_DATE_REQUIRED' using errcode = 'P0001';
  end if;
  if _joined_date > (public.org_today(v_org) + 365) then
    raise exception 'JOINED_DATE_UNREASONABLE' using errcode = 'P0001';
  end if;

  update public.profiles
     set joined_date = _joined_date
   where id = _employee_id and organization_id = v_org and deleted_at is null;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
end $$;

comment on function public.admin_set_joined_date is
  'Corrects a start date. Admin-only because it is the number entitlement is calculated from — an employee could otherwise double their own leave.';

revoke all on function public.admin_set_joined_date(uuid, date) from public, anon;
grant execute on function public.admin_set_joined_date(uuid, date) to authenticated;
