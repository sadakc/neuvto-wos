-- ============================================================================
-- NEUVTO WOS — Leave Management module
--
-- Build step 6, and the first business module. Everything it needs that another
-- module would also need — approvals, notifications, working days, audit — it
-- consumes from the platform. Nothing here is reimplemented.
--
-- Note what is absent: no approval table, no email, no audit writer, no
-- weekend arithmetic. Those live in the platform, and Attendance will use the
-- same ones.
--
-- D30 — the module reacts to approval outcomes with a trigger on
-- approval_requests, defined here rather than in the engine. The direction
-- matters: a module may depend on the platform, the platform must never depend
-- on a module. A hook inside approval_decide naming 'leave_request' would
-- invert that. It also has to be a trigger rather than application code, so the
-- balance moves in the same transaction as the decision — a crash between the
-- two would leave days reserved against a request already approved.
-- ============================================================================

create extension if not exists btree_gist;

create type public.leave_status as enum
  ('draft', 'pending_approval', 'approved', 'rejected', 'cancelled');

-- Approval levels are the engine's business, not this enum's.

-- ─────────────────────────────────────────────────────────── leave types

create table public.leave_types (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  name               text not null,
  description        text,
  max_days_per_year  numeric not null default 0,
  approval_required  boolean not null default true,
  max_per_request    numeric,
  min_notice_days    integer,
  status             text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  deleted_at timestamptz,

  constraint leave_type_name_present check (length(btrim(name)) > 0),
  constraint leave_type_days_sane    check (max_days_per_year >= 0),
  constraint leave_type_per_request_sane check (max_per_request is null or max_per_request > 0),
  constraint leave_type_notice_sane  check (min_notice_days is null or min_notice_days >= 0)
);

create unique index uq_leave_type_name on public.leave_types (organization_id, lower(name))
  where deleted_at is null;
create index idx_leave_types_org on public.leave_types (organization_id) where deleted_at is null;

-- ─────────────────────────────────────────────────────────── balances

create table public.leave_balances (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  employee_id        uuid not null references public.profiles(id) on delete cascade,
  leave_type_id      uuid not null references public.leave_types(id) on delete restrict,
  fy_label           text not null,
  entitled_days      numeric not null default 0,
  carryforward_days  numeric not null default 0,
  used_days          numeric not null default 0,
  reserved_days      numeric not null default 0,
  pending_days       numeric not null default 0,

  -- Generated, not maintained. A column the application computes is a column
  -- the application eventually forgets to recompute, and a wrong balance is the
  -- one bug a leave system cannot survive.
  available_days numeric generated always as
    (entitled_days + carryforward_days - used_days - reserved_days - pending_days) stored,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  deleted_at timestamptz,

  constraint balance_non_negative check (
    entitled_days >= 0 and carryforward_days >= 0 and used_days >= 0
    and reserved_days >= 0 and pending_days >= 0
  ),

  -- D31. Overdraw is made structurally impossible, the same way overlap is
  -- (D18): by a constraint rather than by remembering to check.
  --
  -- Found by sabotage. Removing the row lock alone did nothing, because
  -- ensure_balance's INSERT ... ON CONFLICT happens to block on a concurrently
  -- updated row and was silently serialising everything. With BOTH removed, two
  -- racing submissions each reserved three days against a balance of three and
  -- left available_days at -3. Two locks defending an invariant that nothing
  -- actually asserted.
  --
  -- Deliberate consequence: an admin cannot cut entitlement below what is
  -- already committed. That edit fails loudly instead of quietly putting an
  -- employee in deficit, which is the right way round — the correction is a
  -- decision somebody should make explicitly.
  constraint balance_not_overdrawn check (
    entitled_days + carryforward_days - used_days - reserved_days - pending_days >= 0
  ),

  unique (organization_id, employee_id, leave_type_id, fy_label)
);

create index idx_leave_balances_employee
  on public.leave_balances (organization_id, employee_id, fy_label)
  where deleted_at is null;

-- ─────────────────────────────────────────────────────────── requests

create table public.leave_requests (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  employee_id         uuid not null references public.profiles(id) on delete restrict,
  leave_type_id       uuid not null references public.leave_types(id) on delete restrict,
  from_date           date not null,
  to_date             date not null,
  working_days        numeric not null,
  reason              text,
  status              public.leave_status not null default 'pending_approval',
  approval_request_id uuid references public.approval_requests(id) on delete set null,
  submitted_at        timestamptz,
  decided_at          timestamptz,
  rejection_reason    text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  deleted_at timestamptz,

  constraint leave_dates_ordered  check (to_date >= from_date),
  constraint leave_days_positive  check (working_days > 0)
);

create index idx_leave_requests_employee on public.leave_requests (organization_id, employee_id)
  where deleted_at is null;
create index idx_leave_requests_status on public.leave_requests (organization_id, status)
  where deleted_at is null;

-- D18. The handler checks overlap too, for a readable message — but a check in
-- application code races and a constraint does not. Two requests submitted in
-- the same millisecond both pass a SELECT and both insert; this makes the second
-- insert impossible.
--
-- '[]' is inclusive at both ends: leave from the 1st to the 3rd occupies the 3rd.
alter table public.leave_requests add constraint no_overlapping_leave
  exclude using gist (
    employee_id with =,
    daterange(from_date, to_date, '[]') with &&
  ) where (status in ('pending_approval', 'approved') and deleted_at is null);

create trigger set_audit_fields before insert or update on public.leave_types
  for each row execute function public.set_audit_fields();
create trigger set_audit_fields before insert or update on public.leave_balances
  for each row execute function public.set_audit_fields();
create trigger set_audit_fields before insert or update on public.leave_requests
  for each row execute function public.set_audit_fields();

create trigger write_audit_log after insert or update or delete on public.leave_types
  for each row execute function public.write_audit_log();
create trigger write_audit_log after insert or update or delete on public.leave_balances
  for each row execute function public.write_audit_log();
create trigger write_audit_log after insert or update or delete on public.leave_requests
  for each row execute function public.write_audit_log();

-- ═══════════════════════════════════════════════════════════ entitlement

-- D3. Pro-rated across the months of the financial year the employee is
-- actually employed for, capped at the type's annual maximum. A March joiner on
-- an April financial year gets one month's worth, not a full year's.
create or replace function public.calculate_entitlement(
  _employee_id   uuid,
  _leave_type_id uuid,
  _fy            text
)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org      uuid;
  v_joined   date;
  v_max      numeric;
  v_fy_start date;
  v_fy_end   date;
  v_months   numeric;
begin
  select organization_id, joined_date into v_org, v_joined
    from public.profiles where id = _employee_id and deleted_at is null;
  if v_org is null then return 0; end if;

  select max_days_per_year into v_max
    from public.leave_types
   where id = _leave_type_id and organization_id = v_org and deleted_at is null;
  if v_max is null then return 0; end if;

  -- The financial year window that this label describes, derived from the
  -- organisation's own configuration rather than assumed to start in April.
  select make_date(split_part(_fy, '-', 1)::int, s.fy_start_month, s.fy_start_day)
    into v_fy_start
    from public.organization_settings s where s.organization_id = v_org;
  if v_fy_start is null then return 0; end if;
  v_fy_end := (v_fy_start + interval '1 year' - interval '1 day')::date;

  -- Months of that window the employee is employed for. Someone who joined
  -- before it started gets all twelve.
  if v_joined <= v_fy_start then
    v_months := 12;
  elsif v_joined > v_fy_end then
    v_months := 0;
  else
    v_months := 12 - (extract(year from age(date_trunc('month', v_joined),
                                            date_trunc('month', v_fy_start))) * 12
                    + extract(month from age(date_trunc('month', v_joined),
                                             date_trunc('month', v_fy_start))));
  end if;

  return greatest(least(round(v_max * v_months / 12.0, 1), v_max), 0);
end $$;

comment on function public.calculate_entitlement is
  'D3 — entitlement pro-rated across the months of the financial year the employee is employed, capped at the annual maximum.';

-- D12. Created on first read rather than by a scheduled job. No cron to fail
-- silently on 1 April, and someone hired mid-year has a balance the moment they
-- sign in rather than the next time the job runs.
create or replace function public.ensure_balance(
  _employee_id   uuid,
  _leave_type_id uuid,
  _fy            text
)
returns public.leave_balances
language plpgsql
volatile
security definer
set search_path = public
as $$
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
end $$;

comment on function public.ensure_balance is
  'D12 — lazily creates the balance row for a financial year on first read. Idempotent and safe under concurrency.';

-- ═══════════════════════════════════════════════════════════ submission

-- The whole flow in one transaction. Every rejection raises a named error the
-- interface can translate; none of them leaks a raw database message.
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

  v_today := public.org_today(v_org);                 -- D9, never the server clock
  v_fy    := public.get_financial_year(v_org, _from_date);

  -- 0 · D10. The balance row is locked BEFORE anything is validated. Without
  -- this, two submissions read available_days = 3 at the same instant, both
  -- pass the check below, and both insert — and the employee has taken six days
  -- against a balance of three. Reservation alone stops sequential overdraw,
  -- not simultaneous.
  perform public.ensure_balance(v_user, _leave_type_id, v_fy);
  select * into v_balance from public.leave_balances
   where organization_id = v_org and employee_id = v_user
     and leave_type_id = _leave_type_id and fy_label = v_fy
   for update;

  -- 1 · ordering
  if _to_date < _from_date then
    raise exception 'INVALID_DATE_RANGE' using errcode = 'P0001';
  end if;

  -- 2 · the past, in the organisation's own timezone
  if _from_date < v_today and not coalesce(v_settings.allow_retroactive, false) then
    raise exception 'PAST_DATE' using errcode = 'P0001';
  end if;

  -- 3 · notice period — the type's own, falling back to the organisation's
  v_notice := coalesce(v_type.min_notice_days, v_settings.default_min_notice_days, 0);
  if v_notice > 0 and _from_date < v_today + v_notice then
    raise exception 'INSUFFICIENT_NOTICE' using errcode = 'P0001';
  end if;

  -- 4 · working days, honouring weekends and holidays
  v_days := public.calculate_working_days(v_org, _from_date, _to_date);
  if v_days <= 0 then
    raise exception 'NO_WORKING_DAYS' using errcode = 'P0001';
  end if;

  -- 5 · overlap. The constraint is the guarantee; this is the readable message.
  if exists (
    select 1 from public.leave_requests
     where employee_id = v_user
       and status in ('pending_approval', 'approved')
       and deleted_at is null
       and daterange(from_date, to_date, '[]') && daterange(_from_date, _to_date, '[]')
  ) then
    raise exception 'OVERLAPPING_REQUEST' using errcode = 'P0001';
  end if;

  -- 6 · balance
  if v_days > v_balance.available_days then
    raise exception 'INSUFFICIENT_BALANCE: requested %, available %', v_days, v_balance.available_days
      using errcode = 'P0001';
  end if;

  -- 7 · per-request cap
  if v_type.max_per_request is not null and v_days > v_type.max_per_request then
    raise exception 'EXCEEDS_MAX_PER_REQUEST' using errcode = 'P0001';
  end if;

  -- 8 · insert and reserve, together
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

  -- 9 · hand off to the engine, which decides how many levels this needs from
  -- approval_chains. This module has no opinion about that.
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
  -- The constraint won the race. Report it the same way the handler check does,
  -- rather than leaking a raw exclusion-violation message.
  when exclusion_violation then
    raise exception 'OVERLAPPING_REQUEST' using errcode = 'P0001';
end $$;

comment on function public.leave_submit is
  'Submits a leave request. Locks the balance first (D10), then validates. Raises a named error for every rejection.';

-- ═══════════════════════════════════════════════════════════ decisions
-- D30. Defined here, in the module, attached to a platform table. The platform
-- knows nothing about it; removing Leave removes this with it.

create or replace function public.leave_on_approval_decided()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req    public.leave_requests%rowtype;
  v_fy     text;
  v_today  date;
begin
  if new.entity_type <> 'leave_request' then return new; end if;
  if new.status = old.status then return new; end if;
  if new.status not in ('approved', 'rejected', 'cancelled') then return new; end if;

  select * into v_req from public.leave_requests where id = new.entity_id;
  if v_req.id is null then return new; end if;

  v_fy    := public.get_financial_year(v_req.organization_id, v_req.from_date);
  v_today := public.org_today(v_req.organization_id);

  if new.status = 'approved' then
    update public.leave_requests
       set status = 'approved', decided_at = now()
     where id = v_req.id;

    -- Reserved days become pending, or used if the leave is already behind us.
    -- Days do not vanish and are never counted twice: whatever leaves
    -- reserved_days arrives somewhere else in the same statement.
    update public.leave_balances
       set reserved_days = reserved_days - v_req.working_days,
           pending_days  = pending_days
                           + case when v_req.to_date >= v_today then v_req.working_days else 0 end,
           used_days     = used_days
                           + case when v_req.to_date <  v_today then v_req.working_days else 0 end
     where organization_id = v_req.organization_id
       and employee_id = v_req.employee_id
       and leave_type_id = v_req.leave_type_id
       and fy_label = v_fy;

  else
    update public.leave_requests
       set status = case when new.status = 'rejected' then 'rejected' else 'cancelled' end::public.leave_status,
           decided_at = now()
     where id = v_req.id;

    -- The reservation is released. It was never spent.
    update public.leave_balances
       set reserved_days = greatest(reserved_days - v_req.working_days, 0)
     where organization_id = v_req.organization_id
       and employee_id = v_req.employee_id
       and leave_type_id = v_req.leave_type_id
       and fy_label = v_fy;
  end if;

  return new;
end $$;

create trigger leave_on_approval_decided
  after update on public.approval_requests
  for each row execute function public.leave_on_approval_decided();

comment on function public.leave_on_approval_decided is
  'D30 — moves leave balances when the Approval Engine decides. In the module, on a platform table, in the decision transaction.';

-- Approved leave whose end date has passed moves from pending to used. Run
-- daily. Idempotent: it only touches requests still holding pending days.
create or replace function public.leave_mature_balances(_org_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_today date := public.org_today(_org_id);
  v_count integer := 0;
begin
  with matured as (
    select r.id, r.employee_id, r.leave_type_id, r.working_days,
           public.get_financial_year(r.organization_id, r.from_date) as fy
      from public.leave_requests r
     where r.organization_id = _org_id
       and r.status = 'approved'
       and r.to_date < v_today
       and r.deleted_at is null
  )
  update public.leave_balances b
     set pending_days = greatest(b.pending_days - m.working_days, 0),
         used_days    = b.used_days + least(m.working_days, b.pending_days)
    from matured m
   where b.organization_id = _org_id
     and b.employee_id = m.employee_id
     and b.leave_type_id = m.leave_type_id
     and b.fy_label = m.fy
     and b.pending_days > 0;

  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ═══════════════════════════════════════════════════════════ grants
-- RLS restricts; GRANT permits.

grant select, insert, update on public.leave_types    to authenticated;
grant select                 on public.leave_balances to authenticated;
grant select, update         on public.leave_requests to authenticated;

grant execute on function public.calculate_entitlement(uuid, uuid, text) to authenticated;
grant execute on function public.ensure_balance(uuid, uuid, text)        to authenticated;
grant execute on function public.leave_submit(uuid, date, date, text)    to authenticated;

revoke execute on function public.leave_mature_balances(uuid) from public, authenticated;
grant  execute on function public.leave_mature_balances(uuid) to service_role;

-- ═══════════════════════════════════════════════════════════ RLS

alter table public.leave_types    enable row level security;
alter table public.leave_balances enable row level security;
alter table public.leave_requests enable row level security;

create policy "read leave types in scope" on public.leave_types
  for select to authenticated
  using (organization_id = public.current_org_id() and deleted_at is null);

create policy "admins write leave types" on public.leave_types
  for insert to authenticated
  with check (organization_id = public.current_org_id() and public.is_admin());

create policy "admins update leave types" on public.leave_types
  for update to authenticated
  using (organization_id = public.current_org_id() and public.is_admin() and deleted_at is null)
  with check (organization_id = public.current_org_id());

-- Your own balance, your reports' balances, and an admin's view of the
-- organisation. Nobody else's — an employee seeing a colleague's leave balance
-- is the single most obvious privacy failure this product could have.
create policy "read leave balances in scope" on public.leave_balances
  for select to authenticated
  using (
    organization_id = public.current_org_id()
    and deleted_at is null
    and (
      employee_id = (select auth.uid())
      or public.is_manager_of(employee_id)
      or public.is_admin()
    )
  );

create policy "read leave requests in scope" on public.leave_requests
  for select to authenticated
  using (
    organization_id = public.current_org_id()
    and deleted_at is null
    and (
      employee_id = (select auth.uid())
      or public.is_manager_of(employee_id)
      or public.is_admin()
      -- Whoever has to decide it must be able to see it, even across
      -- departments — the chain may route to someone who is not their manager.
      or exists (
        select 1 from public.approval_requests ar
         where ar.id = leave_requests.approval_request_id
           and public.is_approver_on(ar.id)
      )
    )
  );

-- No INSERT policy: requests arrive exclusively through leave_submit(), which
-- is SECURITY DEFINER. Direct insert would skip the balance lock, the notice
-- period and the approval hand-off.
create policy "employee cancels own request" on public.leave_requests
  for update to authenticated
  using (
    organization_id = public.current_org_id()
    and employee_id = (select auth.uid())
    and status = 'pending_approval'
    and deleted_at is null
  )
  with check (employee_id = (select auth.uid()));

comment on table public.leave_types    is 'Per-organisation leave types (module: leave).';
comment on table public.leave_balances is 'Per employee, per type, per financial year. available_days is generated (module: leave).';
comment on table public.leave_requests is 'Leave requests. Overlap is impossible by constraint, not by convention — D18 (module: leave).';

-- The module registry row. Disabled by default: shipping a module must not
-- switch it on for every existing customer.
insert into public.modules (key, name, status)
values ('leave', 'Leave Management', 'available')
on conflict (key) do update set name = excluded.name, status = excluded.status;
