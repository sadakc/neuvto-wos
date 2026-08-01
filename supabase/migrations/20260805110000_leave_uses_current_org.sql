-- ============================================================================
-- NEUVTO WOS — Leave asks the platform who the caller is
--
-- Both of these resolved the caller's organisation themselves:
--
--     select organization_id into v_org
--       from public.profiles where id = v_user and deleted_at is null;
--
-- They are SECURITY DEFINER, so that read bypasses RLS and happily returned an
-- organisation for somebody who had just been deactivated. What stopped them
-- going further was `assert_own_org`, several calls downstream inside
-- org_today() — a real platform guard, but reached by luck of the call chain
-- rather than by decision, and it reports TENANT_MISMATCH, which tells the
-- person nothing true about their situation.
--
-- One definition of "which organisation may this caller act in", and it is
-- current_org_id() — which as of 20260805100000 excludes the deactivated. A
-- deactivated caller now gets NO_ORGANIZATION at the first line that matters,
-- because that is what is actually the case.
--
-- Both bodies are otherwise untouched. They were produced by substituting that
-- one lookup in the live definitions rather than retyped: rebuilding a function
-- by hand to change one line is how four guards were silently dropped from the
-- approval engine earlier in this project, and the diff is checked in the
-- harness run that follows.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.leave_submit(_leave_type_id uuid, _from_date date, _to_date date, _reason text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user     uuid := (select auth.uid());
  v_org      uuid;
  v_type     public.leave_types%rowtype;
  v_settings public.organization_settings%rowtype;
  v_fy       text;
  v_balance  public.leave_balances%rowtype;
  v_days     numeric;
  v_notice   integer;
  v_today    date;
  v_request  uuid;
  v_approval uuid;
begin
  if v_user is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;

  v_org := public.current_org_id();
  if v_org is null then
    raise exception 'NO_ORGANIZATION' using errcode = 'P0001';
  end if;

  -- D44. First, before anything is read or written. A module that is off must
  -- not create a balance row, reserve a day, or leave any other trace.
  if not public.module_enabled_for(v_org, 'leave') then
    raise exception 'MODULE_NOT_ENABLED' using errcode = 'P0001';
  end if;

  select * into v_settings from public.organization_settings where organization_id = v_org;
  select * into v_type from public.leave_types
   where id = _leave_type_id and organization_id = v_org
     and status = 'active' and deleted_at is null;
  if v_type.id is null then
    raise exception 'LEAVE_TYPE_NOT_FOUND' using errcode = 'P0001';
  end if;

  v_today := public.org_today(v_org);
  v_fy    := public.get_financial_year(v_org, _from_date);

  -- D34. Before ensure_balance, deliberately: a refused request must not leave
  -- a balance row behind for a year nobody can see yet.
  if not public.leave_year_open(v_org, _from_date) then
    raise exception 'NEXT_YEAR_NOT_OPEN_YET' using errcode = 'P0001';
  end if;

  -- D10 — the balance row is locked before anything is validated.
  perform public.ensure_balance(v_user, _leave_type_id, v_fy);
  select * into v_balance from public.leave_balances
   where organization_id = v_org and employee_id = v_user
     and leave_type_id = _leave_type_id and fy_label = v_fy
   for update;

  if _to_date < _from_date then
    raise exception 'INVALID_DATE_RANGE' using errcode = 'P0001';
  end if;

  if _from_date < v_today and not coalesce(v_settings.allow_retroactive, false) then
    raise exception 'PAST_DATE' using errcode = 'P0001';
  end if;

  v_notice := coalesce(v_type.min_notice_days, v_settings.default_min_notice_days, 0);
  if v_notice > 0 and _from_date < v_today + v_notice then
    raise exception 'INSUFFICIENT_NOTICE' using errcode = 'P0001';
  end if;

  v_days := public.calculate_working_days(v_org, _from_date, _to_date);
  if v_days <= 0 then
    raise exception 'NO_WORKING_DAYS' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.leave_requests
     where employee_id = v_user
       and status in ('pending_approval', 'approved')
       and deleted_at is null
       and daterange(from_date, to_date, '[]') && daterange(_from_date, _to_date, '[]')
  ) then
    raise exception 'OVERLAPPING_REQUEST' using errcode = 'P0001';
  end if;

  if v_days > v_balance.available_days then
    raise exception 'INSUFFICIENT_BALANCE: requested %, available %', v_days, v_balance.available_days
      using errcode = 'P0001';
  end if;

  if v_type.max_per_request is not null and v_days > v_type.max_per_request then
    raise exception 'EXCEEDS_MAX_PER_REQUEST' using errcode = 'P0001';
  end if;

  insert into public.leave_requests
    (organization_id, employee_id, leave_type_id, from_date, to_date,
     working_days, reason, status, submitted_at)
  values
    (v_org, v_user, _leave_type_id, _from_date, _to_date,
     v_days, _reason, 'pending_approval', now())
  returning id into v_request;

  update public.leave_balances
     set reserved_days = reserved_days + v_days
   where id = v_balance.id;

  -- D38. A type needing no approval is settled here and now.
  if not v_type.approval_required then
    perform public.leave_mark_approved(v_request);
    return v_request;
  end if;

  v_approval := public.approval_submit(
    'leave_request', v_request,
    jsonb_build_object(
      'working_days', v_days,
      'leave_type_id', _leave_type_id,
      'employee_id', v_user
    )
  );

  update public.leave_requests set approval_request_id = v_approval where id = v_request;

  return v_request;

exception
  when exclusion_violation then
    raise exception 'OVERLAPPING_REQUEST' using errcode = 'P0001';
end $function$;
CREATE OR REPLACE FUNCTION public.leave_my_balances()
 RETURNS TABLE(leave_type_id uuid, leave_type_name text, fy_label text, entitled_days numeric, carryforward_days numeric, used_days numeric, reserved_days numeric, pending_days numeric, available_days numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user uuid := (select auth.uid());
  v_org  uuid;
  v_fy   text;
  v_type record;
begin
  if v_user is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;

  v_org := public.current_org_id();
  if v_org is null then
    raise exception 'NO_ORGANIZATION' using errcode = 'P0001';
  end if;

  -- D44. This function CREATES rows, so it has to refuse before it does — a
  -- disabled module must not quietly accumulate balances nobody can see.
  if not public.module_enabled_for(v_org, 'leave') then
    raise exception 'MODULE_NOT_ENABLED' using errcode = 'P0001';
  end if;

  -- The current year only (D36). Materialising further would recreate exactly
  -- the next-year buckets D34 exists to hide.
  v_fy := public.get_financial_year(v_org, public.org_today(v_org));

  for v_type in
    select id from public.leave_types
     where organization_id = v_org and status = 'active' and deleted_at is null
  loop
    perform public.ensure_balance(v_user, v_type.id, v_fy);
  end loop;

  return query
    select b.leave_type_id, t.name::text, b.fy_label,
           b.entitled_days, b.carryforward_days, b.used_days,
           b.reserved_days, b.pending_days, b.available_days
      from public.leave_balances b
      join public.leave_types t on t.id = b.leave_type_id
     where b.organization_id = v_org
       and b.employee_id = v_user
       and b.deleted_at is null
     order by b.fy_label desc, t.name;
end $function$;
