-- ============================================================================
-- NEUVTO WOS — bulk import of employee records (E8, bundle §7.7)
-- ============================================================================
--
-- The People screen's import (step 13) INVITES people and knows nothing about
-- any module (D30). This one is the Employee Master's: it brings a workforce
-- in as DRAFTS, carrying the record's own fields (designation, unit, date of
-- birth, emergency contact...), which an Admin then invites from Add Employee,
-- one at a time or all at once. Super Admin only (bundle §7.7).
--
--   employee_import_check(rows)          the dry run. Writes nothing. Says,
--                                        per row and per column, what is wrong.
--   employee_import_commit(rows, clean)  writes. Re-checks first: the file is
--                                        never trusted because a dry run once
--                                        passed it. With clean = false, any row
--                                        needing attention refuses the lot.
--
-- Statutory numbers are NOT importable. A spreadsheet of Aadhaar numbers is
-- the file that leaks; they go in one record at a time, on the card, where
-- they are encrypted on arrival and every write is audited (D80).
--
-- Names are matched, not ids, because a spreadsheet has names: designation,
-- department and deployed unit must match an active entry exactly (case and
-- spacing aside). An unknown one is an error, never a new entry: rule 3 says
-- anything a report groups by comes from a managed list.
-- ============================================================================

create or replace function public.employee_import_columns()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array['full_name','email','mobile','joined_date','employee_code','designation',
               'department','reports_to_email','employment_type','date_of_birth','sex',
               'blood_group','emergency_contact_name','emergency_contact_phone',
               'deployed_unit','deployed_from','deployment_order_ref']
$$;

grant execute on function public.employee_import_columns() to authenticated;

/**
 * One row's problems, as {column: message}. Empty means clean. `_seen` is the
 * emails earlier in the same file, so a duplicate inside the file is caught
 * before it reaches the unique index.
 */
create or replace function public.employee_import_row_problems(_org uuid, _r jsonb, _seen text[])
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  p     jsonb := '{}'::jsonb;
  v     text;
  v_email text := nullif(lower(btrim(coalesce(_r ->> 'email', ''))), '');
  d     date;
begin
  if length(btrim(coalesce(_r ->> 'full_name', ''))) = 0 then
    p := p || jsonb_build_object('full_name', 'Required');
  end if;

  if v_email is not null then
    if v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      p := p || jsonb_build_object('email', 'Not an email address');
    elsif v_email = any (_seen) then
      p := p || jsonb_build_object('email', 'Appears twice in this file');
    elsif exists (select 1 from public.profiles where organization_id = _org and lower(email) = v_email and deleted_at is null) then
      p := p || jsonb_build_object('email', 'Already a member');
    elsif exists (select 1 from public.invitations where organization_id = _org and lower(email) = v_email
                   and accepted_at is null and revoked_at is null and deleted_at is null) then
      p := p || jsonb_build_object('email', 'Already invited');
    elsif exists (select 1 from public.employees where organization_id = _org and lower(draft_email) = v_email and deleted_at is null) then
      p := p || jsonb_build_object('email', 'Already a draft');
    end if;
  end if;

  -- YYYY-MM-DD and nothing else. Postgres would happily read 01/11/2026,
  -- as 11 January under its default date style, where the person who typed
  -- it in India meant 1 November. An import that silently swaps day and month
  -- is worse than one that refuses. Found by the harness's first run.
  foreach v in array array['joined_date','date_of_birth','deployed_from'] loop
    if nullif(btrim(coalesce(_r ->> v, '')), '') is not null then
      begin
        if btrim(_r ->> v) !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
          raise exception 'not iso';
        end if;
        d := (btrim(_r ->> v))::date;
      exception when others then
        p := p || jsonb_build_object(v, 'Not a date. Write it as YYYY-MM-DD, like 2026-11-01');
      end;
    end if;
  end loop;

  v := nullif(btrim(coalesce(_r ->> 'designation', '')), '');
  if v is not null and not exists (select 1 from public.designations where organization_id = _org
                                    and lower(btrim(name)) = lower(v) and status = 'active' and deleted_at is null) then
    p := p || jsonb_build_object('designation', 'Not in the designation list');
  end if;
  v := nullif(btrim(coalesce(_r ->> 'department', '')), '');
  if v is not null and not exists (select 1 from public.departments where organization_id = _org
                                    and lower(btrim(name)) = lower(v) and deleted_at is null) then
    p := p || jsonb_build_object('department', 'Not a department');
  end if;
  v := nullif(lower(btrim(coalesce(_r ->> 'reports_to_email', ''))), '');
  if v is not null and not exists (select 1 from public.profiles pr where pr.organization_id = _org
                                    and lower(pr.email) = v and pr.is_active and pr.deleted_at is null
                                    and public.can_approve(pr.id)) then
    p := p || jsonb_build_object('reports_to_email', 'Not an active manager here');
  end if;
  v := nullif(lower(btrim(coalesce(_r ->> 'employment_type', ''))), '');
  if v is not null and replace(v, ' ', '_') not in ('full_time','contract','apprentice','part_time','intern','consultant') then
    p := p || jsonb_build_object('employment_type', 'Not one of the employment types');
  end if;
  v := nullif(lower(btrim(coalesce(_r ->> 'sex', ''))), '');
  if v is not null and v not in ('male','female','other','undisclosed') then
    p := p || jsonb_build_object('sex', 'Male, female, other or undisclosed');
  end if;
  v := nullif(upper(btrim(coalesce(_r ->> 'blood_group', ''))), '');
  if v is not null and v not in ('A+','A-','B+','B-','AB+','AB-','O+','O-') then
    p := p || jsonb_build_object('blood_group', 'Not a blood group');
  end if;

  v := nullif(btrim(coalesce(_r ->> 'deployed_unit', '')), '');
  if v is not null then
    if not exists (select 1 from public.deployment_units where organization_id = _org
                    and lower(btrim(name)) = lower(v) and status = 'active' and deleted_at is null) then
      p := p || jsonb_build_object('deployed_unit', 'Not an active unit');
    end if;
    if nullif(btrim(coalesce(_r ->> 'deployment_order_ref', '')), '') is null then
      p := p || jsonb_build_object('deployment_order_ref', 'Required with a deployed unit');
    end if;
    if nullif(btrim(coalesce(_r ->> 'deployed_from', '')), '') is null
       and nullif(btrim(coalesce(_r ->> 'joined_date', '')), '') is null then
      p := p || jsonb_build_object('deployed_from', 'Required with a deployed unit (or a joined date)');
    end if;
  end if;
  return p;
end $$;

revoke all on function public.employee_import_row_problems(uuid, jsonb, text[]) from public, anon, authenticated;

/** Checks the caller and the file's shape; returns per-row problems. Writes nothing. */
create or replace function public.employee_import_check(_rows jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org  uuid := public.current_org_id();
  v_seen text[] := '{}';
  v_out  jsonb := '[]'::jsonb;
  r      jsonb;
  i      integer := 0;
  v_p    jsonb;
  k      text;
begin
  if (select auth.uid()) is null or v_org is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;
  if not public.module_enabled_for(v_org, 'employee') then
    raise exception 'MODULE_NOT_ENABLED' using errcode = 'P0001';
  end if;
  if not public.is_super_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501',
      hint = 'Bringing a workforce in from a spreadsheet is a Super Admin''s.';
  end if;
  if _rows is null or jsonb_typeof(_rows) <> 'array' or jsonb_array_length(_rows) = 0 then
    raise exception 'NO_ROWS' using errcode = 'P0001';
  end if;
  if jsonb_array_length(_rows) > 2000 then
    raise exception 'TOO_MANY_ROWS' using errcode = 'P0001', hint = 'Two thousand rows at a time.';
  end if;

  for r in select * from jsonb_array_elements(_rows) loop
    i := i + 1;
    for k in select jsonb_object_keys(r) loop
      if not (k = any (public.employee_import_columns())) then
        raise exception 'UNKNOWN_COLUMN' using errcode = 'P0001', detail = k;
      end if;
    end loop;
    v_p := public.employee_import_row_problems(v_org, r, v_seen);
    if nullif(lower(btrim(coalesce(r ->> 'email', ''))), '') is not null then
      v_seen := v_seen || lower(btrim(r ->> 'email'));
    end if;
    v_out := v_out || jsonb_build_object('index', i, 'problems', v_p);
  end loop;
  return v_out;
end $$;

comment on function public.employee_import_check is
  'E8 — the dry run. Per row, the columns that need attention and why. Writes nothing.';

revoke all on function public.employee_import_check(jsonb) from public, anon;
grant execute on function public.employee_import_check(jsonb) to authenticated;

/**
 * Brings the rows in as drafts. Re-runs the check first and never trusts an
 * earlier dry run. `_only_clean`: true imports the clean rows and skips the
 * rest; false refuses the whole file if any row needs attention.
 */
create or replace function public.employee_import_commit(_rows jsonb, _only_clean boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org     uuid := public.current_org_id();
  v_check   jsonb := public.employee_import_check(_rows);
  v_bad     integer;
  r         jsonb;
  i         integer := 0;
  v_id      uuid;
  v_created integer := 0;
  v_skipped integer := 0;
  v_rec     jsonb;
  v_unit    uuid;
begin
  select count(*) into v_bad from jsonb_array_elements(v_check) c where c -> 'problems' <> '{}'::jsonb;
  if v_bad > 0 and not _only_clean then
    raise exception 'ROWS_NEED_ATTENTION' using errcode = 'P0001', detail = v_bad::text;
  end if;

  for r in select * from jsonb_array_elements(_rows) loop
    i := i + 1;
    if (v_check -> (i - 1) -> 'problems') <> '{}'::jsonb then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_id := public.employee_create_draft(jsonb_strip_nulls(jsonb_build_object(
      'fullName', btrim(r ->> 'full_name'),
      'email', nullif(lower(btrim(coalesce(r ->> 'email', ''))), ''),
      'phone', nullif(btrim(coalesce(r ->> 'mobile', '')), ''),
      'joinedDate', nullif(btrim(coalesce(r ->> 'joined_date', '')), ''),
      'departmentId', (select id from public.departments where organization_id = v_org
                        and lower(btrim(name)) = lower(btrim(r ->> 'department')) and deleted_at is null limit 1),
      'managerId', (select id from public.profiles where organization_id = v_org
                     and lower(email) = lower(btrim(r ->> 'reports_to_email')) and deleted_at is null limit 1))));

    v_rec := jsonb_strip_nulls(jsonb_build_object(
      'employeeCode', nullif(btrim(coalesce(r ->> 'employee_code', '')), ''),
      'designationId', (select id from public.designations where organization_id = v_org
                         and lower(btrim(name)) = lower(btrim(r ->> 'designation')) and status = 'active'
                         and deleted_at is null limit 1),
      'employmentType', nullif(replace(lower(btrim(coalesce(r ->> 'employment_type', ''))), ' ', '_'), ''),
      'dateOfBirth', nullif(btrim(coalesce(r ->> 'date_of_birth', '')), ''),
      'sex', nullif(lower(btrim(coalesce(r ->> 'sex', ''))), ''),
      'bloodGroup', nullif(upper(btrim(coalesce(r ->> 'blood_group', ''))), ''),
      'emergencyContactName', nullif(btrim(coalesce(r ->> 'emergency_contact_name', '')), ''),
      'emergencyContactPhone', nullif(btrim(coalesce(r ->> 'emergency_contact_phone', '')), '')));
    if v_rec <> '{}'::jsonb then
      perform public.employee_update(v_id, v_rec);
    end if;

    if nullif(btrim(coalesce(r ->> 'deployed_unit', '')), '') is not null then
      select id into v_unit from public.deployment_units where organization_id = v_org
         and lower(btrim(name)) = lower(btrim(r ->> 'deployed_unit')) and status = 'active'
         and deleted_at is null limit 1;
      perform public.employee_move_unit(v_id, jsonb_build_object(
        'unitId', v_unit,
        'effectiveFrom', coalesce(nullif(btrim(r ->> 'deployed_from'), ''), btrim(r ->> 'joined_date')),
        'orderRef', btrim(r ->> 'deployment_order_ref')));
    end if;
    v_created := v_created + 1;
  end loop;

  insert into public.analytics_events (organization_id, user_id, event, properties)
  values (v_org, (select auth.uid()), 'employee.imported',
          jsonb_build_object('created', v_created, 'skipped', v_skipped));
  return jsonb_build_object('created', v_created, 'skipped', v_skipped);
end $$;

comment on function public.employee_import_commit is
  'E8 — brings rows in as drafts after re-checking every one. All or nothing unless _only_clean, which skips the rows needing attention. Never imports statutory numbers.';

revoke all on function public.employee_import_commit(jsonb, boolean) from public, anon;
grant execute on function public.employee_import_commit(jsonb, boolean) to authenticated;
