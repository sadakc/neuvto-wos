-- ============================================================================
-- NEUVTO WOS — a day, or half of one, and nothing in between
--
-- Sada, 7 Aug 2026: "Let the leaves split out only in halves, not in 0.3, 0.4,
-- 0.6, or 0.7 ... because that confuses the end user."
--
-- He is describing entitlement, and this is where it came from:
--
--     round(v_max * v_months / 12.0, 1)      -- one DECIMAL PLACE
--
-- Ten possible fractions where a person recognises two. Somebody on 5 days a
-- year joining in July was entitled to 3.8 days — a number that means nothing to
-- the person holding it and cannot be taken, because leave is booked in whole
-- days and half days.
--
-- ── the grid, and everywhere it has to hold
--
-- Rounding the calculation alone would not have been enough. The half-day grid
-- has four ways in, and this migration closes all of them:
--
--   1. the CONFIGURED maximum      leave_types.max_days_per_year
--   2. the CALCULATED entitlement  calculate_entitlement()
--   3. the OPENING balance         leave_set_opening_balance()
--   4. what is ALREADY STORED      leave_balances
--
-- (1) matters more than it looks. If a type is configured at 12.4, a full-year
-- employee is capped at 12.4 and lands off-grid however carefully (2) rounds.
-- The cap has to sit on the grid or the calculation cannot.
--
-- (3) was accepting any numeric with only a `< 0` check. The Opening Balances
-- screen sends step="0.5", which is a browser attribute and not a rule — this
-- project has been bitten by exactly that distinction before, and an RPC granted
-- to `authenticated` is reachable by anything holding a session.
--
-- ── the rounding
--
--     round(x * 2) / 2
--
-- Nearest half, ties away from zero. 2.7 -> 2.5, 2.8 -> 3.0, 2.75 -> 3.0.
-- Sada confirmed 2.7 -> 2.5 explicitly.
--
-- Whole numbers still occur and that is accepted, not overlooked: twelve months
-- of a 12-day entitlement is 12.0 and no arithmetic avoids it. What disappears
-- is 2.7 and 0.3.
-- ============================================================================

-- ═══════════════════════════════════ 1. the configured maximum

-- Backfill BEFORE the constraint, so the constraint can be added validated
-- rather than NOT VALID. A rule the database is not actually checking is a
-- comment with extra steps.
--
-- max_per_request rounds UP to a floor of 0.5: leave_type_per_request_sane
-- already requires it to be > 0 when set, and 0.2 would otherwise round to 0
-- and violate a constraint that has nothing to do with this change. There is no
-- such floor on max_days_per_year, where 0 is legitimate — an unpaid type with
-- no allowance.
do $$
declare
  v_types bigint;
begin
  update public.leave_types
     set max_days_per_year = round(max_days_per_year * 2) / 2,
         max_per_request   = case
                               when max_per_request is null then null
                               else greatest(round(max_per_request * 2) / 2, 0.5)
                             end
   where max_days_per_year * 2 <> floor(max_days_per_year * 2)
      or (max_per_request is not null
          and max_per_request * 2 <> floor(max_per_request * 2));
  get diagnostics v_types = row_count;

  if v_types > 0 then
    raise notice '[halves] % leave type(s) moved onto the half-day grid', v_types;
  end if;
end $$;

alter table public.leave_types
  add constraint leave_type_days_are_halves
  check (max_days_per_year * 2 = floor(max_days_per_year * 2));

alter table public.leave_types
  add constraint leave_type_per_request_is_halves
  check (max_per_request is null or max_per_request * 2 = floor(max_per_request * 2));

comment on constraint leave_type_days_are_halves on public.leave_types is
  'Whole days or halves. LeaveTypeInput mirrors this exactly — a form that accepts what the database refuses produces an unexplained failure.';

-- ═══════════════════════════════════ 2. the calculated entitlement

-- Reproduced from 20260730180000_leave_module.sql, which is the current
-- definition. The diff is the return line.
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

  -- Nearest half. `least` is applied to the ROUNDED figure rather than the other
  -- way round, so the cap can never be exceeded by the rounding itself — and
  -- v_max is guaranteed to be on the grid by leave_type_days_are_halves above,
  -- which is what makes capping and rounding agree.
  --
  -- The outer round(..., 1) is about SCALE, not value. `round(x*2)/2` divides a
  -- scale-0 numeric by 2, and Postgres gives division a scale of 16 or so — the
  -- answer is right and it is stored as 4.0000000000000000. Every reader casts
  -- through Number(), so nothing was visibly wrong, but the stored figure is
  -- what a CSV export and a support query show. One decimal place is exact for
  -- a number already on the half grid.
  return round(greatest(least(round(v_max * v_months / 12.0 * 2) / 2, v_max), 0), 1);
end $$;

comment on function public.calculate_entitlement is
  'D3 — entitlement pro-rated across the months of the financial year the employee is employed, capped at the annual maximum, rounded to the nearest half day.';

-- ═══════════════════════════════════ 3. the opening balance

-- Reproduced from 20260806110000_leave_opening_balance.sql. The diff is the one
-- block below NEGATIVE_DAYS.
create or replace function public.leave_set_opening_balance(
  _employee_id   uuid,
  _leave_type_id uuid,
  _used          numeric,
  _carryforward  numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  v_fy  text;
begin
  if v_org is null or not public.is_admin() then
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
end $$;

-- ═══════════════════════════════════ 4. what is already stored

-- Sada: "anybody today who has 2.7, let's make it 2.5."
--
-- THE TRAP, and why this is not a bare UPDATE. leave_balances carries
--
--   check (entitled_days + carryforward_days - used_days - reserved_days
--          - pending_days >= 0)
--
-- and `available_days` is GENERATED STORED from the same expression. Rounding
-- 2.7 DOWN to 2.5 for somebody who has already taken 2.7 days pushes them below
-- zero, the constraint refuses the row, and the whole migration aborts — on a
-- customer's data, at deploy time, for a cosmetic improvement.
--
-- So the guard is in the WHERE clause: round only where the result survives.
-- Anything left off-grid keeps the number it had and is COUNTED OUT LOUD rather
-- than passed over. A backfill that silently skips rows is indistinguishable
-- from one that worked.
do $$
declare
  v_moved bigint;
  v_stuck bigint;
begin
  update public.leave_balances
     set entitled_days     = round(round(entitled_days * 2) / 2, 1),
         carryforward_days = round(round(carryforward_days * 2) / 2, 1)
   where (entitled_days * 2 <> floor(entitled_days * 2)
          or carryforward_days * 2 <> floor(carryforward_days * 2))
     and round(entitled_days * 2) / 2 + round(carryforward_days * 2) / 2
         - used_days - reserved_days - pending_days >= 0;
  get diagnostics v_moved = row_count;

  select count(*) into v_stuck
    from public.leave_balances
   where entitled_days * 2 <> floor(entitled_days * 2)
      or carryforward_days * 2 <> floor(carryforward_days * 2);

  raise notice '[halves] % balance row(s) moved onto the half-day grid', v_moved;

  if v_stuck > 0 then
    -- A warning, not an exception. These rows are correct as they stand — the
    -- person has taken the days — and refusing to deploy over them would trade
    -- a working system for a tidy one.
    raise warning '[halves] % balance row(s) left off-grid: rounding down would have taken available days below zero. They keep the number they had, and settle onto the grid at the next financial year.', v_stuck;
  end if;
end $$;

-- Deliberately NOT constrained. leave_balances is arithmetic rather than
-- configuration: used_days and reserved_days are written by leave_submit from
-- calculate_working_days, and a CHECK here would turn a future half-day booking
-- feature into a migration against every customer's balances. The grid is
-- enforced where numbers ENTER the system — the three sections above — which is
-- the only place it can be enforced without freezing what leave can mean.
