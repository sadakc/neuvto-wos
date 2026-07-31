-- ============================================================================
-- NEUVTO WOS — when next year's leave opens
--
-- Balances are per financial year, so a request dated in the next one creates a
-- second bucket for the same leave type. Reported as a bug on sight: two
-- "Casual" cards, one showing 6 days and one showing 12, with nothing to say
-- why. It reads as a duplicate because, to an employee, it is one.
--
-- D34 — next year's balance does not exist until shortly before next year.
-- Sada's rule: open it a month ahead. Somebody planning next April's holiday in
-- March can book it; somebody idly looking in August is not shown a bucket for
-- a year that has not started.
--
-- Enforced here rather than only in the interface. Hiding a bucket the database
-- creates anyway leaves it there — invisible, counted in nothing the employee
-- can see, and waiting to confuse whoever looks at the table.
--
-- A setting rather than a constant, per "configuration over customization": an
-- organisation that plans further out changes a number, not a deploy.
-- ============================================================================

alter table public.organization_settings
  add column next_fy_opens_months_before smallint not null default 1
    check (next_fy_opens_months_before between 0 and 12);

comment on column public.organization_settings.next_fy_opens_months_before is
  'How long before a financial year starts its leave balances become available (D34). 0 means not until it begins.';

-- ═══════════════════════════════════════════════════════════ calendar service

-- The date a labelled financial year begins, for this organisation.
-- calculate_entitlement worked this out inline; now there is one definition,
-- and the leave module can ask the same question without repeating the parsing.
create or replace function public.financial_year_start(_org_id uuid, _fy text)
returns date
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_start date;
begin
  perform public.assert_own_org(_org_id);

  select make_date(split_part(_fy, '-', 1)::int, s.fy_start_month, s.fy_start_day)
    into v_start
    from public.organization_settings s
   where s.organization_id = _org_id;

  return v_start;
end $$;

comment on function public.financial_year_start is
  'The date a labelled financial year begins for this organisation.';

/**
 * Whether leave dated in `_ref`'s financial year can be booked yet.
 *
 * True for the current year and any past one. For a future year, true only once
 * we are within the organisation's booking window.
 */
create or replace function public.leave_year_open(_org_id uuid, _ref date)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today     date;
  v_this_fy   text;
  v_ref_fy    text;
  v_ref_start date;
  v_months    smallint;
begin
  perform public.assert_own_org(_org_id);

  v_today   := public.org_today(_org_id);
  v_this_fy := public.get_financial_year(_org_id, v_today);
  v_ref_fy  := public.get_financial_year(_org_id, _ref);

  -- This year, or a year already gone: always open. Retroactive leave is
  -- refused separately, by its own rule, for its own reason.
  if v_ref_fy <= v_this_fy then return true; end if;

  select next_fy_opens_months_before into v_months
    from public.organization_settings where organization_id = _org_id;

  v_ref_start := public.financial_year_start(_org_id, v_ref_fy);

  return v_today >= (v_ref_start - (coalesce(v_months, 1) || ' months')::interval)::date;
end $$;

comment on function public.leave_year_open is
  'D34 — whether a future financial year is close enough to book leave in yet.';

grant execute on function public.financial_year_start(uuid, text) to authenticated;
grant execute on function public.leave_year_open(uuid, date)      to authenticated;

-- ═══════════════════════════════════════════════════════════ submission

-- Rebuilt with the year check. Everything else is unchanged; the check sits
-- before ensure_balance so a refused request never creates the bucket it was
-- refused for.
create or replace function public.leave_submit(
  _leave_type_id uuid,
  _from_date     date,
  _to_date       date,
  _reason        text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
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

  select organization_id into v_org
    from public.profiles where id = v_user and deleted_at is null;
  if v_org is null then
    raise exception 'NO_ORGANIZATION' using errcode = 'P0001';
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
end $$;

comment on function public.leave_submit is
  'Submits a leave request. Refuses a year not yet open (D34), locks the balance first (D10), then validates.';
