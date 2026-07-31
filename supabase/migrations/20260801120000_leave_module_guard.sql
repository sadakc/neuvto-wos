-- ============================================================================
-- NEUVTO WOS — Leave guards its own door
--
-- The other half of D44. 20260801110000_module_boundary.sql gave the platform
-- the question; this is the module answering it at every entry point it owns.
--
-- THE MODULE GUARDS ITSELF. The platform must not wrap leave_submit in a check,
-- because the platform naming a module is the coupling D30 exists to prevent —
-- and the moment it did, every future module would need the platform edited to
-- add it. A module that cannot be added without touching shared code is not a
-- module.
--
-- The same reasoning moves the nightly balance sweep here. The first draft put
-- mature_all_balances() in the platform's scheduled_work migration, looping
-- organisations and calling leave_mature_balances() — platform code naming a
-- module, in a file whose whole subject was the platform. A module schedules
-- its own work, in its own migration, and the platform never knows.
-- ============================================================================

-- ═══════════════════════════════════════════════════════ submission

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
end $$;

comment on function public.leave_submit is
  'Submits a leave request. Refuses when the module is off (D44) or the year is not open (D34), locks the balance first (D10), then validates.';

-- ═══════════════════════════════════════════════════════ reading balances

create or replace function public.leave_my_balances()
returns table (
  leave_type_id     uuid,
  leave_type_name   text,
  fy_label          text,
  entitled_days     numeric,
  carryforward_days numeric,
  used_days         numeric,
  reserved_days     numeric,
  pending_days      numeric,
  available_days    numeric
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_user uuid := (select auth.uid());
  v_org  uuid;
  v_fy   text;
  v_type record;
begin
  if v_user is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;

  select organization_id into v_org
    from public.profiles where id = v_user and deleted_at is null;
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
end $$;

comment on function public.leave_my_balances is
  'D36 — the caller''s own balances, creating this year''s rows on read. Refuses when the module is off (D44). Never takes an employee id.';

-- ═══════════════════════════════════════════════════════ cancelling

create or replace function public.leave_cancel(_request_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_user  uuid := (select auth.uid());
  v_req   public.leave_requests%rowtype;
  v_today date;
begin
  if v_user is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;

  select * into v_req from public.leave_requests
   where id = _request_id and deleted_at is null;

  -- One message whether the request belongs to somebody else or does not
  -- exist. Distinguishing them would let anyone probe for request ids.
  if v_req.id is null or v_req.employee_id <> v_user then
    raise exception 'NOT_YOUR_REQUEST' using errcode = 'P0001';
  end if;

  -- D44, after ownership. Answering "module off" for a request that is not
  -- theirs would confirm the id exists, which NOT_YOUR_REQUEST exists to avoid.
  if not public.module_enabled_for(v_req.organization_id, 'leave') then
    raise exception 'MODULE_NOT_ENABLED' using errcode = 'P0001';
  end if;

  if v_req.status not in ('pending_approval', 'approved') then
    raise exception 'ALREADY_DECIDED' using errcode = 'P0001';
  end if;

  -- D9 — the organisation's today, never the server's.
  v_today := public.org_today(v_req.organization_id);
  if v_req.from_date <= v_today then
    raise exception 'CANCEL_TOO_LATE' using errcode = 'P0001';
  end if;

  -- Closing the approval fires leave_on_approval_decided, which cancels the
  -- request AND releases the days. One writer.
  if v_req.approval_request_id is not null then
    update public.approval_requests
       set status = 'cancelled', completed_at = now()
     where id = v_req.approval_request_id
       and status in ('pending', 'approved');
    return;
  end if;

  -- A request with no approval attached: the live path for types needing no
  -- approval (D38).
  update public.leave_requests
     set status = 'cancelled', decided_at = now()
   where id = _request_id;

  if v_req.status = 'pending_approval' then
    update public.leave_balances
       set reserved_days = greatest(reserved_days - v_req.working_days, 0)
     where organization_id = v_req.organization_id
       and employee_id = v_req.employee_id
       and leave_type_id = v_req.leave_type_id
       and fy_label = public.get_financial_year(v_req.organization_id, v_req.from_date);
  else
    update public.leave_balances
       set pending_days = greatest(pending_days - v_req.working_days, 0)
     where organization_id = v_req.organization_id
       and employee_id = v_req.employee_id
       and leave_type_id = v_req.leave_type_id
       and fy_label = public.get_financial_year(v_req.organization_id, v_req.from_date);
  end if;
end $$;

comment on function public.leave_cancel is
  'Cancels own future leave (D33). Refuses when the module is off (D44), after the ownership check so the refusal confirms nothing.';

-- ═══════════════════════════════════════════════════ Leave's own scheduled work

create or replace function public.leave_mature_all_balances()
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org   uuid;
  v_total integer := 0;
begin
  for v_org in
    select id from public.organizations where deleted_at is null
  loop
    -- D44. A customer who does not have Leave has no balances to mature, and
    -- sweeping them anyway would be this module reaching into an organisation
    -- that never bought it.
    continue when not public.module_enabled_for(v_org, 'leave');

    begin
      v_total := v_total + coalesce(public.leave_mature_balances(v_org), 0);
    exception when others then
      -- One organisation's bad data must not stop every other organisation's
      -- balances from maturing.
      raise warning 'leave_mature_all_balances: organisation % failed: %', v_org, sqlerrm;
    end;
  end loop;
  return v_total;
end $$;

comment on function public.leave_mature_all_balances is
  'D43/D44 — matures approved past leave for every organisation that HAS Leave. Scheduled by this module, not by the platform.';

revoke all on function public.leave_mature_all_balances() from public, authenticated, anon;

do $$
begin
  perform cron.unschedule('neuvto-mature-balances')
    where exists (select 1 from cron.job where jobname = 'neuvto-mature-balances');
  perform cron.unschedule('neuvto-leave-mature-balances')
    where exists (select 1 from cron.job where jobname = 'neuvto-leave-mature-balances');

  -- 18:30 UTC is midnight in Asia/Kolkata, the default organisation timezone
  -- (D9). leave_mature_balances resolves each organisation's own today, so a
  -- customer in another zone is still correct — this decides only when the
  -- sweep runs, not what it considers past.
  perform cron.schedule(
    'neuvto-leave-mature-balances',
    '30 18 * * *',
    $job$select public.leave_mature_all_balances()$job$
  );
end $$;
