-- ============================================================================
-- NEUVTO WOS — unpaid leave, blackout periods, and what removing a leave type
-- does (Leave phase 2, contained items; LEAVE_PHASE_2_SCOPE.md)
-- ============================================================================
--
-- UNPAID LEAVE (loss of pay). leave_types.kind is 'paid' or 'unpaid'. An unpaid
-- type has no allowance (max_days_per_year = 0, enforced), and NO BALANCE ROW:
-- ensure_balance() creates none, so reserving, approving, maturing, rejecting
-- and cancelling, which all update the balance row, have nothing to touch.
-- What it shows instead is what was taken: leave_my_unpaid(). A type's kind is
-- fixed once it is created; turning paid into unpaid would strand balances.
--
-- BLACKOUT PERIODS. leave_blackouts: named date ranges when no leave of any
-- kind can be applied for. Written by the Leave Admin (D84) through RLS, read
-- by everybody in the company so Apply can say so before sending. Existing
-- requests are not touched; leave_submit() refuses new ones with the name.
--
-- REMOVING A LEAVE TYPE. leave_type_impact() counts what archiving it leaves
-- behind, so the screen can state the consequence before it happens.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════ unpaid

alter table public.leave_types
  add column if not exists kind text not null default 'paid';
alter table public.leave_types drop constraint if exists leave_type_kind_known;
alter table public.leave_types add constraint leave_type_kind_known
  check (kind in ('paid', 'unpaid'));
alter table public.leave_types drop constraint if exists leave_type_unpaid_has_no_allowance;
alter table public.leave_types add constraint leave_type_unpaid_has_no_allowance
  check (kind = 'paid' or max_days_per_year = 0);

create or replace function public.tf_leave_type_kind_is_fixed()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.kind is distinct from old.kind then
    raise exception 'LEAVE_TYPE_KIND_FIXED' using errcode = 'P0001',
      hint = 'Archive this type and add a new one instead.';
  end if;
  return new;
end $$;

revoke all on function public.tf_leave_type_kind_is_fixed() from public, anon, authenticated;

drop trigger if exists leave_type_kind_is_fixed on public.leave_types;
create trigger leave_type_kind_is_fixed
  before update of kind on public.leave_types
  for each row execute function public.tf_leave_type_kind_is_fixed();

-- ── ensure_balance: no row for unpaid
CREATE OR REPLACE FUNCTION public.ensure_balance(_employee_id uuid, _leave_type_id uuid, _fy text)
 RETURNS leave_balances
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org uuid;
  v_row public.leave_balances%rowtype;
begin
  select organization_id into v_org
    from public.profiles where id = _employee_id and deleted_at is null;
  if v_org is null then
    raise exception 'EMPLOYEE_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- ON CONFLICT rather than "select, then insert if missing": two first reads
  -- arriving together would both find nothing and both insert.
  -- Unpaid leave has no balance: nothing is credited and nothing is reserved,
  -- so every balance update for it has no row to touch. Returns null.
  if exists (select 1 from public.leave_types
              where id = _leave_type_id and kind = 'unpaid') then
    return null;
  end if;

  insert into public.leave_balances
    (organization_id, employee_id, leave_type_id, fy_label, entitled_days)
  values
    (v_org, _employee_id, _leave_type_id, _fy,
     public.calculate_entitlement(_employee_id, _leave_type_id, _fy))
  on conflict (organization_id, employee_id, leave_type_id, fy_label) do nothing;

  select * into v_row from public.leave_balances
   where organization_id = v_org and employee_id = _employee_id
     and leave_type_id = _leave_type_id and fy_label = _fy;

  return v_row;
end $function$
;


-- ── leave_set_opening_balance: refused for unpaid
CREATE OR REPLACE FUNCTION public.leave_set_opening_balance(_employee_id uuid, _leave_type_id uuid, _used numeric, _carryforward numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org uuid := public.current_org_id();
  v_fy  text;
begin
  if v_org is null or not public.is_module_admin('leave') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- D44. A customer without Leave switched on has no balances to open.
  if not public.module_enabled_for(v_org, 'leave') then
    raise exception 'MODULE_NOT_ENABLED' using errcode = 'P0001';
  end if;

  if _used < 0 or _carryforward < 0 then
    raise exception 'NEGATIVE_DAYS' using errcode = 'P0001';
  end if;

  -- The screen sends step="0.5". That is a browser attribute, not a rule, and
  -- this function is granted to `authenticated`.
  if _used * 2 <> floor(_used * 2) or _carryforward * 2 <> floor(_carryforward * 2) then
    raise exception 'NOT_A_HALF_DAY' using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.profiles
                  where id = _employee_id and organization_id = v_org
                    and deleted_at is null) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.leave_types
                  where id = _leave_type_id and organization_id = v_org
                    and deleted_at is null) then
    raise exception 'LEAVE_TYPE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.leave_types where id = _leave_type_id and kind = 'unpaid') then
    raise exception 'UNPAID_HAS_NO_BALANCE' using errcode = 'P0001';
  end if;

  v_fy := public.get_financial_year(v_org, public.org_today(v_org));

  -- The row may not exist yet: balances materialise when they are READ (D12,
  -- D36), and an administrator setting an opening balance is very often the
  -- first time anybody has looked. ensure_balance seeds entitled_days from
  -- calculate_entitlement, which is what these numbers are then measured
  -- against, so it has to run first rather than be worked around.
  perform public.ensure_balance(_employee_id, _leave_type_id, v_fy);

  begin
    update public.leave_balances
       set used_days = _used, carryforward_days = _carryforward
     where organization_id = v_org
       and employee_id = _employee_id
       and leave_type_id = _leave_type_id
       and fy_label = v_fy;
  exception when check_violation then
    -- balance_not_overdrawn. The administrator has said somebody has taken more
    -- than they were ever entitled to, which is either a typo or an
    -- entitlement that needs correcting first.
    raise exception 'OPENING_BALANCE_OVERDRAWN' using errcode = 'P0001';
  end;
end $function$
;


-- ── leave_all_balances: paid types only
CREATE OR REPLACE FUNCTION public.leave_all_balances()
 RETURNS TABLE(employee_id uuid, employee_name text, department_name text, leave_type_id uuid, leave_type_name text, fy_label text, entitled_days numeric, carryforward_days numeric, used_days numeric, available_days numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org uuid := public.current_org_id();
  v_fy  text;
begin
  if v_org is null or not public.is_module_admin('leave') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if not public.module_enabled_for(v_org, 'leave') then
    raise exception 'MODULE_NOT_ENABLED' using errcode = 'P0001';
  end if;

  v_fy := public.get_financial_year(v_org, public.org_today(v_org));

  -- Every active person against every active type, whether or not a balance row
  -- exists yet. Entitlement is computed for the ones that do not, so the screen
  -- shows what they WOULD get — otherwise the person most needing an opening
  -- balance is the one missing from the list.
  return query
    select p.id, coalesce(p.full_name, p.email)::text,
           d.name::text,
           t.id, t.name::text, v_fy,
           coalesce(b.entitled_days, public.calculate_entitlement(p.id, t.id, v_fy)),
           coalesce(b.carryforward_days, 0),
           coalesce(b.used_days, 0),
           coalesce(b.available_days,
                    public.calculate_entitlement(p.id, t.id, v_fy))
      from public.profiles p
      cross join public.leave_types t
      left join public.departments d on d.id = p.department_id
      left join public.leave_balances b
        on b.employee_id = p.id and b.leave_type_id = t.id and b.fy_label = v_fy
       and b.deleted_at is null
     where p.organization_id = v_org and p.deleted_at is null and p.is_active
       and t.organization_id = v_org and t.deleted_at is null and t.status = 'active'
       and t.kind = 'paid'
     order by coalesce(p.full_name, p.email), t.name;
end $function$
;


/** What the person has taken and asked for, of each unpaid type, this year. */
create or replace function public.leave_my_unpaid()
returns table (leave_type_id uuid, leave_type_name text, fy_label text, taken_days numeric, pending_days numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := (select auth.uid());
  v_org  uuid := public.current_org_id();
  v_fy   text;
begin
  if v_user is null or v_org is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;
  if not public.module_enabled_for(v_org, 'leave') then
    raise exception 'MODULE_NOT_ENABLED' using errcode = 'P0001';
  end if;
  v_fy := public.get_financial_year(v_org, public.org_today(v_org));
  return query
    select t.id, t.name::text, v_fy,
           coalesce(sum(r.working_days) filter (where r.status = 'approved'), 0),
           coalesce(sum(r.working_days) filter (where r.status = 'pending_approval'), 0)
      from public.leave_types t
      left join public.leave_requests r
        on r.leave_type_id = t.id and r.employee_id = v_user and r.deleted_at is null
       and public.get_financial_year(v_org, r.from_date) = v_fy
     where t.organization_id = v_org and t.kind = 'unpaid'
       and t.status = 'active' and t.deleted_at is null
     group by t.id, t.name
     order by t.name;
end $$;

revoke all on function public.leave_my_unpaid() from public, anon;
grant execute on function public.leave_my_unpaid() to authenticated;

-- ═══════════════════════════════════════════════════════════ blackouts

create table public.leave_blackouts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null check (length(btrim(name)) between 1 and 80),
  from_date       date not null,
  to_date         date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  deleted_at timestamptz,
  constraint leave_blackout_dates_in_order check (to_date >= from_date),
  constraint leave_blackout_not_endless check (to_date - from_date <= 366)
);
create index idx_leave_blackouts_org
  on public.leave_blackouts (organization_id, from_date) where deleted_at is null;

create trigger set_audit_fields before insert or update on public.leave_blackouts
  for each row execute function public.set_audit_fields();
create trigger write_audit_log after insert or update or delete on public.leave_blackouts
  for each row execute function public.write_audit_log();

alter table public.leave_blackouts enable row level security;
revoke all on public.leave_blackouts from anon, authenticated;
grant select, insert, update on public.leave_blackouts to authenticated;

create policy "read blackouts in scope" on public.leave_blackouts
  for select to authenticated
  using (organization_id = public.current_org_id() and deleted_at is null);
create policy "leave admins add blackouts" on public.leave_blackouts
  for insert to authenticated
  with check (organization_id = public.current_org_id() and public.is_module_admin('leave'));
-- Editing a name or the dates. Removing is leave_blackout_remove(): a soft
-- delete through RLS fails, because Postgres checks the updated row against
-- the read policy too, and a removed row is one nobody reads.
create policy "leave admins change blackouts" on public.leave_blackouts
  for update to authenticated
  using (organization_id = public.current_org_id() and public.is_module_admin('leave') and deleted_at is null)
  with check (organization_id = public.current_org_id() and public.is_module_admin('leave'));

create or replace function public.leave_blackout_remove(_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_org uuid := public.current_org_id();
begin
  if v_org is null or not public.is_module_admin('leave') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  update public.leave_blackouts set deleted_at = now()
   where id = _id and organization_id = v_org and deleted_at is null;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
end $$;

revoke all on function public.leave_blackout_remove(uuid) from public, anon;
grant execute on function public.leave_blackout_remove(uuid) to authenticated;

comment on table public.leave_blackouts is
  'Leave phase 2 — date ranges when no leave can be applied for. Written by the Leave Admin; existing requests are not touched.';

-- ── leave_submit: unpaid takes no balance; a blackout refuses
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
  v_blackout text;
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

  -- D10 — the balance row is locked before anything is validated. Unpaid
  -- leave has none to lock: nothing is reserved, and overlapping requests are
  -- refused by the exclusion constraint either way.
  if v_type.kind = 'paid' then
    perform public.ensure_balance(v_user, _leave_type_id, v_fy);
    select * into v_balance from public.leave_balances
     where organization_id = v_org and employee_id = v_user
       and leave_type_id = _leave_type_id and fy_label = v_fy
     for update;
  end if;

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

  -- A blackout period refuses every kind of leave, unpaid included, and says
  -- which one, so the person knows what to move.
  select b.name into v_blackout
    from public.leave_blackouts b
   where b.organization_id = v_org and b.deleted_at is null
     and daterange(b.from_date, b.to_date, '[]') && daterange(_from_date, _to_date, '[]')
   order by b.from_date
   limit 1;
  if v_blackout is not null then
    raise exception 'BLACKOUT_PERIOD: %', v_blackout using errcode = 'P0001';
  end if;

  if v_type.kind = 'paid' and v_days > v_balance.available_days then
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

  if v_type.kind = 'paid' then
    update public.leave_balances
       set reserved_days = reserved_days + v_days
     where id = v_balance.id;
  end if;

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
;


-- ═══════════════════════════════════════════════════════════ removing a type

/** What archiving a leave type leaves behind, for the confirmation. */
create or replace function public.leave_type_impact(_leave_type_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org   uuid := public.current_org_id();
  v_today date;
begin
  if v_org is null or not public.is_module_admin('leave') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.leave_types
                  where id = _leave_type_id and organization_id = v_org and deleted_at is null) then
    raise exception 'LEAVE_TYPE_NOT_FOUND' using errcode = 'P0002';
  end if;
  v_today := public.org_today(v_org);
  return jsonb_build_object(
    'pendingRequests', (select count(*) from public.leave_requests
                         where leave_type_id = _leave_type_id and deleted_at is null
                           and status = 'pending_approval'),
    'upcomingApproved', (select count(*) from public.leave_requests
                          where leave_type_id = _leave_type_id and deleted_at is null
                            and status = 'approved' and to_date >= v_today),
    'peopleWithDaysLeft', (select count(distinct employee_id) from public.leave_balances
                            where leave_type_id = _leave_type_id and deleted_at is null
                              and fy_label = public.get_financial_year(v_org, v_today)
                              and available_days > 0)
  );
end $$;

revoke all on function public.leave_type_impact(uuid) from public, anon;
grant execute on function public.leave_type_impact(uuid) to authenticated;
