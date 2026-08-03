-- ============================================================================
-- NEUVTO WOS — the notice refusal says how many days it wanted
--
-- "This leave type needs more notice than that." tells an employee that they
-- were wrong and not what would be right, so the only way forward is to guess a
-- date, submit, and see. Sada met it in testing and asked the obvious question:
-- more notice than WHAT?
--
-- The number was already resolved one line above the refusal:
--
--     v_notice := coalesce(v_type.min_notice_days,
--                          v_settings.default_min_notice_days, 0);
--
-- which matters, because "the notice period" is two settings, not one — a leave
-- type may name its own, and otherwise the organisation's default applies.
-- Quoting `min_notice_days` alone would have been right only for the types that
-- set it, and silently wrong for the ones inheriting the default. v_notice is
-- the value actually enforced, so it is the only honest thing to put in the
-- message.
--
-- Raised WITH the code, in the INSUFFICIENT_BALANCE style already used two
-- checks further down, so the browser parses a number rather than being told
-- one. The alternative — reading min_notice_days from the form's copy of the
-- leave type — is a number as old as the page: an administrator changing a type
-- from 1 day to 5 while somebody has the form open would produce a refusal
-- confidently explaining the wrong figure.
--
-- Reproduced from pg_get_functiondef and substituted programmatically, not
-- retyped: the diff against the live definition is one line, and that was
-- checked before this file existed.
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
    raise exception 'INSUFFICIENT_NOTICE: % days required', v_notice using errcode = 'P0001';
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
end $function$

-- Grants are unchanged: CREATE OR REPLACE keeps them.
