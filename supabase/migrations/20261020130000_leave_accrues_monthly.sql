-- ============================================================================
-- NEUVTO WOS — leave that is credited month by month (D90)
-- ============================================================================
--
-- Until now a paid type's allowance was credited whole: the day the balance
-- was first read, the person had the year's twelve days (pro-rated if they
-- joined part-way, D3). Leave phase 2 asks for the other common rule too.
--
-- leave_types.accrual:
--   'upfront'  the year's allowance at once (as before; the default)
--   'monthly'  a twelfth of it at the start of each month of the leave year
--              the person is employed for, so 15 a year is 1.25 a month
--
-- The running total is rounded DOWN to the half day, never up: leave is booked
-- in halves, and a quarter day that could never be booked is not worth
-- showing. Fifteen a year therefore reads 1, 2.5, 3.5, 5 ... and exactly 15 in
-- the twelfth month. Nobody is ever credited ahead of the rule.
--
-- What can be booked is what has been credited. A person can book next
-- month's leave today against what they have now, not against what will come.
-- Next year's balance (open a month ahead, D34) holds the first month.
--
-- Credited by calculate_entitlement_from(), the one rule (D88), which now asks
-- the date; and a sweep raises every monthly balance of the current year
-- to what the rule gives today, hourly. It only ever raises: an entitlement is never
-- taken back from under leave already booked.
--
-- Only a paid type accrues. Unpaid has no allowance; earned is credited by
-- claims (D89).
-- ============================================================================

alter table public.leave_types
  add column if not exists accrual text not null default 'upfront';
alter table public.leave_types drop constraint if exists leave_type_accrual_known;
alter table public.leave_types add constraint leave_type_accrual_known
  check (accrual in ('upfront', 'monthly'));
alter table public.leave_types drop constraint if exists leave_type_only_paid_accrues;
alter table public.leave_types add constraint leave_type_only_paid_accrues
  check (kind = 'paid' or accrual = 'upfront');

comment on column public.leave_types.accrual is
  'D90 — upfront: the year''s allowance at once; monthly: a twelfth at the start of each month employed, rounded down to the half day.';

-- ═══════════════════════════════════════════════════════════ the one rule

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
  v_accrual  text;
  v_fy_start date;
  v_fy_end   date;
  v_from     date;
  v_as_of    date;
  v_months   numeric;
begin
  select max_days_per_year, accrual into v_max, v_accrual
    from public.leave_types
   where id = _leave_type_id and organization_id = _org_id and deleted_at is null;
  if v_max is null then return 0; end if;

  select make_date(split_part(_fy, '-', 1)::int, s.fy_start_month, s.fy_start_day)
    into v_fy_start
    from public.organization_settings s where s.organization_id = _org_id;
  if v_fy_start is null then return 0; end if;
  v_fy_end := (v_fy_start + interval '1 year' - interval '1 day')::date;

  -- The first month they are employed for in this year. Unknown joining date:
  -- priced as the whole year, the most they could have.
  if _joined is null or _joined <= v_fy_start then
    v_from := v_fy_start;
  elsif _joined > v_fy_end then
    return 0;
  else
    v_from := _joined;
  end if;

  if v_accrual = 'monthly' then
    -- Months credited so far: from their first month to this one, inclusive.
    -- A year not begun yet holds its first month (D34 opens it a month ahead):
    -- v_from is never before the year starts.
    v_as_of := least(greatest(public.org_today(_org_id), v_from), v_fy_end);
    v_months := (extract(year from age(date_trunc('month', v_as_of), date_trunc('month', v_from))) * 12
               + extract(month from age(date_trunc('month', v_as_of), date_trunc('month', v_from)))) + 1;
    -- Down to the half day: never credited ahead of the rule. (At most twelve
    -- months fit in a year, so the cap below only restates the allowance.)
    return round(greatest(least(floor(v_max * v_months / 12.0 * 2) / 2, v_max), 0), 1);
  end if;

  -- Upfront (D3): every month of the year they are employed for, at once.
  v_months := 12 - (extract(year from age(date_trunc('month', v_from), date_trunc('month', v_fy_start))) * 12
                  + extract(month from age(date_trunc('month', v_from), date_trunc('month', v_fy_start))));
  return round(greatest(least(round(v_max * v_months / 12.0 * 2) / 2, v_max), 0), 1);
end $$;

comment on function public.calculate_entitlement_from is
  'D3/D90 — entitlement from a joining date: upfront, the months of the year employed at once (nearest half); monthly, a twelfth for each month employed so far (rounded down to the half). Capped at the annual maximum.';

revoke all on function public.calculate_entitlement_from(uuid, date, uuid, text) from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════ the monthly sweep

create or replace function public.leave_accrue_due()
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  with due as (
    select b.id, public.calculate_entitlement(b.employee_id, b.leave_type_id, b.fy_label) as owed
      from public.leave_balances b
      join public.leave_types t on t.id = b.leave_type_id
      join public.profiles p on p.id = b.employee_id
     where t.accrual = 'monthly' and t.kind = 'paid' and t.deleted_at is null
       and b.deleted_at is null and p.deleted_at is null and p.is_active
       and public.module_enabled_for(b.organization_id, 'leave')
       -- This year's and any year already open; never one gone.
       and b.fy_label >= public.get_financial_year(b.organization_id, public.org_today(b.organization_id))
  )
  update public.leave_balances b
     set entitled_days = due.owed
    from due
   where b.id = due.id and due.owed > b.entitled_days;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

comment on function public.leave_accrue_due is
  'D90 — raises every monthly-accruing balance to what the rule gives today. Only ever raises. Daily.';

revoke all on function public.leave_accrue_due() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule('neuvto-leave-accrual')
    where exists (select 1 from cron.job where jobname = 'neuvto-leave-accrual');
  -- Hourly, so the first of the month arrives within the hour in every time
  -- zone a company can be in. It does nothing on the other days.
  perform cron.schedule(
    'neuvto-leave-accrual',
    '15 * * * *',
    $job$select public.leave_accrue_due()$job$
  );
end $$;
