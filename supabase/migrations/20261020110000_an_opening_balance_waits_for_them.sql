-- ============================================================================
-- NEUVTO WOS — an opening balance for somebody who has not joined yet (D88)
-- ============================================================================
--
-- The master template (D86) brings people in as DRAFTS: an employee record and
-- no profile. A leave balance belongs to a profile (leave_balances.employee_id
-- references profiles), so until now the Leave Admin had to wait for each
-- person to accept their invitation and then remember to come back.
--
-- D88 — STAGED. The Leave Admin enters what a person has already taken and
-- carried over against their employee record, before they join. The numbers
-- wait in leave_opening_staged and are applied, by the same arithmetic as
-- leave_set_opening_balance(), the moment the record gains a profile: when the
-- invitation is accepted, by whatever path.
--
--   - Checked when entered, against the entitlement their joining date gives
--     (calculate_entitlement_from(), the one rule, now callable before there
--     is a profile).
--   - Checked again when applied, by the balance's own CHECK. If the real
--     entitlement turned out smaller (a joining date corrected meanwhile), the
--     row is kept, marked, and shown to the Leave Admin. Accepting the
--     invitation never fails because of a leave number.
--   - Applied once. A staged row that has been applied is history.
--
-- Leave reacts to the Employee Master's record gaining a profile with its own
-- trigger (D30: the module depends on the platform, never the other way).
-- ============================================================================

-- ═══════════════════════════════════════════════════════════ one entitlement rule

-- calculate_entitlement(), with the person's joining date given rather than
-- read from a profile, so somebody without one can be priced. The body is the
-- one from 20260817110000_days_come_in_halves.sql.
create or replace function public.calculate_entitlement_from(
  _org_id        uuid,
  _joined        date,
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
  v_max      numeric;
  v_fy_start date;
  v_fy_end   date;
  v_months   numeric;
begin
  select max_days_per_year into v_max
    from public.leave_types
   where id = _leave_type_id and organization_id = _org_id and deleted_at is null;
  if v_max is null then return 0; end if;

  select make_date(split_part(_fy, '-', 1)::int, s.fy_start_month, s.fy_start_day)
    into v_fy_start
    from public.organization_settings s where s.organization_id = _org_id;
  if v_fy_start is null then return 0; end if;
  v_fy_end := (v_fy_start + interval '1 year' - interval '1 day')::date;

  -- Unknown joining date: priced as a full year, the most they could have.
  if _joined is null or _joined <= v_fy_start then
    v_months := 12;
  elsif _joined > v_fy_end then
    v_months := 0;
  else
    v_months := 12 - (extract(year from age(date_trunc('month', _joined),
                                            date_trunc('month', v_fy_start))) * 12
                    + extract(month from age(date_trunc('month', _joined),
                                             date_trunc('month', v_fy_start))));
  end if;

  return round(greatest(least(round(v_max * v_months / 12.0 * 2) / 2, v_max), 0), 1);
end $$;

comment on function public.calculate_entitlement_from is
  'D3 — entitlement pro-rated across the months of the financial year from a joining date, capped at the annual maximum, rounded to the nearest half. calculate_entitlement() is this, for a profile.';

revoke all on function public.calculate_entitlement_from(uuid, date, uuid, text) from public, anon, authenticated;

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
  v_org    uuid;
  v_joined date;
begin
  select organization_id, joined_date into v_org, v_joined
    from public.profiles where id = _employee_id and deleted_at is null;
  if v_org is null then return 0; end if;
  -- A profile always has a joining date (it defaults to the day it was made);
  -- coalesce keeps the old meaning should one ever be null.
  return public.calculate_entitlement_from(v_org, coalesce(v_joined, 'infinity'::date), _leave_type_id, _fy);
end $$;

comment on function public.calculate_entitlement is
  'D3 — entitlement pro-rated across the months of the financial year the employee is employed, capped at the annual maximum, rounded to the nearest half day.';

-- ═══════════════════════════════════════════════════════════ the staged numbers

create table if not exists public.leave_opening_staged (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  employee_record_id uuid not null references public.employees(id) on delete cascade,
  leave_type_id      uuid not null references public.leave_types(id) on delete restrict,
  fy_label           text not null,
  used_days          numeric not null default 0 check (used_days >= 0 and used_days * 2 = floor(used_days * 2)),
  carryforward_days  numeric not null default 0 check (carryforward_days >= 0 and carryforward_days * 2 = floor(carryforward_days * 2)),
  applied_at         timestamptz,
  -- Why it could not be applied when they joined. Null once it has been, or
  -- while it is still waiting.
  problem            text check (problem is null or problem in ('OPENING_BALANCE_OVERDRAWN', 'MODULE_NOT_ENABLED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  deleted_at timestamptz,
  unique (employee_record_id, leave_type_id, fy_label)
);

comment on table public.leave_opening_staged is
  'D88 — leave already taken and carried over by somebody who has not joined yet, applied when their record gains a profile.';

create trigger set_audit_fields before insert or update on public.leave_opening_staged
  for each row execute function public.set_audit_fields();
create trigger write_audit_log after insert or update or delete on public.leave_opening_staged
  for each row execute function public.write_audit_log();

-- Written and read only through the functions below.
alter table public.leave_opening_staged enable row level security;
revoke all on public.leave_opening_staged from anon, authenticated;

-- ═══════════════════════════════════════════════════════════ entering them

/** What the record says the person's joining date will be, at any stage. */
create or replace function public.employee_record_joining_date(_employee_record_id uuid)
returns date
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(p.joined_date, i.joined_date, e.draft_joined_date)
    from public.employees e
    left join public.profiles p on p.id = e.profile_id
    left join public.invitations i on i.id = e.invitation_id
   where e.id = _employee_record_id
$$;

revoke all on function public.employee_record_joining_date(uuid) from public, anon, authenticated;

create or replace function public.leave_stage_opening_balance(
  _employee_record_id uuid,
  _leave_type_id      uuid,
  _used               numeric,
  _carryforward       numeric
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org  uuid := public.current_org_id();
  v_fy   text;
  v_e    public.employees%rowtype;
  v_type public.leave_types%rowtype;
begin
  if v_org is null or not public.is_module_admin('leave') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if not public.module_enabled_for(v_org, 'leave') then
    raise exception 'MODULE_NOT_ENABLED' using errcode = 'P0001';
  end if;
  if _used is null or _carryforward is null or _used < 0 or _carryforward < 0 then
    raise exception 'NEGATIVE_DAYS' using errcode = 'P0001';
  end if;
  if _used * 2 <> floor(_used * 2) or _carryforward * 2 <> floor(_carryforward * 2) then
    raise exception 'NOT_A_HALF_DAY' using errcode = 'P0001';
  end if;

  select * into v_e from public.employees
   where id = _employee_record_id and organization_id = v_org and deleted_at is null;
  if v_e.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  -- Somebody who has joined has a balance of their own; set it there.
  if v_e.profile_id is not null then
    raise exception 'ALREADY_JOINED' using errcode = 'P0001';
  end if;

  select * into v_type from public.leave_types
   where id = _leave_type_id and organization_id = v_org
     and status = 'active' and deleted_at is null;
  if v_type.id is null then
    raise exception 'LEAVE_TYPE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_type.kind = 'unpaid' then
    raise exception 'UNPAID_HAS_NO_BALANCE' using errcode = 'P0001';
  end if;

  v_fy := public.get_financial_year(v_org, public.org_today(v_org));

  -- The same test the balance's CHECK will apply when they join.
  if _used > public.calculate_entitlement_from(
               v_org, public.employee_record_joining_date(v_e.id), v_type.id, v_fy)
             + _carryforward then
    raise exception 'OPENING_BALANCE_OVERDRAWN' using errcode = 'P0001';
  end if;

  insert into public.leave_opening_staged
    (organization_id, employee_record_id, leave_type_id, fy_label, used_days, carryforward_days)
  values (v_org, v_e.id, v_type.id, v_fy, _used, _carryforward)
  on conflict (employee_record_id, leave_type_id, fy_label) do update
     set used_days = excluded.used_days,
         carryforward_days = excluded.carryforward_days,
         problem = null,
         deleted_at = null
   where public.leave_opening_staged.applied_at is null;

  if not found then
    -- The row exists and was applied: they have joined since the screen loaded.
    raise exception 'ALREADY_JOINED' using errcode = 'P0001';
  end if;
end $$;

comment on function public.leave_stage_opening_balance is
  'D88 — the Leave Admin records leave already taken and carried over by somebody not yet joined; applied when they do.';

revoke all on function public.leave_stage_opening_balance(uuid, uuid, numeric, numeric) from public, anon;
grant execute on function public.leave_stage_opening_balance(uuid, uuid, numeric, numeric) to authenticated;

/** Everybody not yet joined, against every active type with a balance, with what is staged. */
create or replace function public.leave_staged_opening_balances()
returns table (
  employee_record_id uuid,
  employee_name      text,
  employee_code      text,
  stage              text,
  joined_date        date,
  leave_type_id      uuid,
  leave_type_name    text,
  fy_label           text,
  entitled_days      numeric,
  used_days          numeric,
  carryforward_days  numeric,
  staged             boolean,
  problem            text
)
language plpgsql
stable
security definer
set search_path = public
as $$
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

  return query
    select e.id,
           coalesce(i.full_name, e.draft_full_name, i.email, e.draft_email, e.employee_code, 'Unnamed')::text,
           e.employee_code::text,
           (case when e.invitation_id is null then 'draft' else 'invited' end)::text,
           public.employee_record_joining_date(e.id),
           t.id, t.name::text, v_fy,
           public.calculate_entitlement_from(v_org, public.employee_record_joining_date(e.id), t.id, v_fy),
           coalesce(s.used_days, 0),
           coalesce(s.carryforward_days, 0),
           s.id is not null,
           s.problem
      from public.employees e
      left join public.invitations i on i.id = e.invitation_id
      cross join public.leave_types t
      left join public.leave_opening_staged s
        on s.employee_record_id = e.id and s.leave_type_id = t.id and s.fy_label = v_fy
       and s.applied_at is null and s.deleted_at is null
     where e.organization_id = v_org and e.deleted_at is null and e.profile_id is null
       and t.organization_id = v_org and t.deleted_at is null and t.status = 'active'
       and t.kind <> 'unpaid'
     order by 2, t.name;
end $$;

comment on function public.leave_staged_opening_balances is
  'D88 — the people not yet joined, each against every active paid type, with what is waiting for them.';

revoke all on function public.leave_staged_opening_balances() from public, anon;
grant execute on function public.leave_staged_opening_balances() to authenticated;

-- ═══════════════════════════════════════════════════════════ when they join

create or replace function public.tf_leave_applies_staged_opening()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_s public.leave_opening_staged%rowtype;
begin
  -- Whatever is still waiting, whenever the record has a profile. Applied rows
  -- are history and are never picked up again.
  if new.profile_id is null then
    return new;
  end if;

  for v_s in
    select * from public.leave_opening_staged
     where employee_record_id = new.id and applied_at is null and deleted_at is null
     for update
  loop
    if not public.module_enabled_for(new.organization_id, 'leave') then
      update public.leave_opening_staged set problem = 'MODULE_NOT_ENABLED' where id = v_s.id;
      continue;
    end if;
    begin
      perform public.ensure_balance(new.profile_id, v_s.leave_type_id, v_s.fy_label);
      update public.leave_balances
         set used_days = v_s.used_days, carryforward_days = v_s.carryforward_days
       where organization_id = new.organization_id
         and employee_id = new.profile_id
         and leave_type_id = v_s.leave_type_id
         and fy_label = v_s.fy_label;
      update public.leave_opening_staged
         set applied_at = now(), problem = null
       where id = v_s.id;
    exception when check_violation then
      -- Never fail an invitation over a leave number. Kept, marked, shown.
      update public.leave_opening_staged set problem = 'OPENING_BALANCE_OVERDRAWN' where id = v_s.id;
    end;
  end loop;
  return new;
end $$;

revoke all on function public.tf_leave_applies_staged_opening() from public, anon, authenticated;

drop trigger if exists leave_applies_staged_opening on public.employees;
create trigger leave_applies_staged_opening
  after update of profile_id on public.employees
  for each row execute function public.tf_leave_applies_staged_opening();

-- ═══════════════════════════════════════════════════════════ what did not apply

/** Staged numbers that could not be applied when the person joined. */
create or replace function public.leave_staged_opening_problems()
returns table (
  employee_id     uuid,
  employee_name   text,
  leave_type_name text,
  used_days       numeric,
  carryforward_days numeric,
  problem         text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
begin
  if v_org is null or not public.is_module_admin('leave') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  return query
    select p.id, coalesce(p.full_name, p.email)::text, t.name::text,
           s.used_days, s.carryforward_days, s.problem
      from public.leave_opening_staged s
      join public.employees e on e.id = s.employee_record_id
      join public.profiles p on p.id = e.profile_id
      join public.leave_types t on t.id = s.leave_type_id
     where s.organization_id = v_org and s.applied_at is null and s.problem is not null
       and s.deleted_at is null
     order by 2, 3;
end $$;

revoke all on function public.leave_staged_opening_problems() from public, anon;
grant execute on function public.leave_staged_opening_problems() to authenticated;

-- ═══════════════════════════════════════════════════════════ setting it by hand

-- Reproduced from 20261018110000_unpaid_leave_and_blackouts.sql. The diff: the
-- last statement.
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

  -- D88: setting it by hand settles anything staged for them that could not
  -- be applied when they joined.
  update public.leave_opening_staged s
     set deleted_at = now()
    from public.employees e
   where e.id = s.employee_record_id and e.profile_id = _employee_id
     and s.leave_type_id = _leave_type_id and s.applied_at is null and s.deleted_at is null;
end $function$
;
