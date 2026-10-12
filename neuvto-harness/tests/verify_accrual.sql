-- NEUVTO WOS — leave credited month by month (D90)
--
-- Raises on the first violation. Silence means pass. Rolled back.
--
-- PHASE-AWARE: exits quietly if leave_types.accrual does not exist yet.
--
-- A monthly type credits a twelfth for each month employed so far, rounded
-- down to the half day, never more than the year's allowance; an upfront type
-- is unchanged; only a paid type accrues; the sweep raises balances and never
-- lowers one; what can be booked is what has been credited.

begin;

create or replace function pg_temp.ac_as(_uid uuid) returns void as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', _uid::text, 'role', 'authenticated')::text, true);
end $$ language plpgsql;

create or replace function pg_temp.ac_root() returns void as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$ language plpgsql;

create or replace function pg_temp.ac_ok(_label text) returns void as $$
begin raise notice 'ok: %', _label; end $$ language plpgsql;

do $$
declare
  acme   uuid := '00000000-0000-0000-0000-0000000000a0';
  ravi   uuid := '00000000-0000-0000-0000-00000000a005';
  priya  uuid := '00000000-0000-0000-0000-00000000a006';
  casual uuid := '00000000-0000-0000-0000-0000000000c1';
  el     uuid;
  fy     text;
  next_fy text;
  fy_start date;
  this_month date := date_trunc('month', current_date)::date;
  months int;
  v      numeric;
  msg    text;
  bal    public.leave_balances;
  mon    date := (date_trunc('week', current_date + 7) + interval '7 days')::date;
begin
  if not exists (select 1 from information_schema.columns
                  where table_name = 'leave_types' and column_name = 'accrual') then
    raise notice 'skip: accrual does not exist yet';
    return;
  end if;
  if not exists (select 1 from cron.job where jobname = 'neuvto-leave-accrual' and active) then
    raise exception 'ACCRUAL FAIL: the sweep is not scheduled';
  end if;

  fy := public.get_financial_year(acme, current_date);
  select make_date(split_part(fy, '-', 1)::int, s.fy_start_month, s.fy_start_day) into fy_start
    from public.organization_settings s where s.organization_id = acme;
  next_fy := public.get_financial_year(acme, (fy_start + interval '1 year')::date);
  months := (extract(year from age(this_month, fy_start)) * 12 + extract(month from age(this_month, fy_start)))::int + 1;

  -- Fifteen a year: 1.25 a month.
  insert into public.leave_types (organization_id, name, max_days_per_year, accrual)
  values (acme, 'Earned leave', 15, 'monthly') returning id into el;

  -- ── 1 · a twelfth a month, rounded down to the half, from the month they join
  v := public.calculate_entitlement_from(acme, this_month, el, fy);
  if v <> 1 then raise exception 'ACCRUAL FAIL: one month of 15 a year credits %, not 1', v; end if;
  if months >= 2 then
    v := public.calculate_entitlement_from(acme, (this_month - interval '1 month')::date, el, fy);
    if v <> 2.5 then raise exception 'ACCRUAL FAIL: two months credit %, not 2.5', v; end if;
  end if;
  if months >= 3 then
    v := public.calculate_entitlement_from(acme, (this_month - interval '2 months')::date, el, fy);
    if v <> 3.5 then raise exception 'ACCRUAL FAIL: three months credit % (3.75 rounds down), not 3.5', v; end if;
  end if;
  -- Somebody here all year has every month so far; never more than fifteen.
  v := public.calculate_entitlement_from(acme, '2020-01-01', el, fy);
  if v <> least(floor(15 * months / 12.0 * 2) / 2, 15) or v > 15 then
    raise exception 'ACCRUAL FAIL: % months so far credit %', months, v;
  end if;
  -- Joining after this month credits nothing yet... and a year not begun holds its first month.
  v := public.calculate_entitlement_from(acme, '2020-01-01', el, next_fy);
  if v <> 1 then raise exception 'ACCRUAL FAIL: next year, opened early, holds % rather than its first month', v; end if;
  perform pg_temp.ac_ok('a monthly type credits a twelfth for each month employed so far, rounded down to the half day');

  -- ── 2 · upfront is unchanged
  v := public.calculate_entitlement_from(acme, '2020-01-01', casual, fy);
  if v <> 12 then raise exception 'ACCRUAL FAIL: an upfront type now credits % rather than 12', v; end if;
  v := public.calculate_entitlement_from(acme, this_month, casual, fy);
  if v <> round(12 * (12 - months + 1) / 12.0 * 2) / 2 then
    raise exception 'ACCRUAL FAIL: an upfront joiner this month gets %', v;
  end if;
  perform pg_temp.ac_ok('an upfront type still credits the year at once, pro-rated for joiners');

  -- ── 3 · only a paid type accrues
  begin
    insert into public.leave_types (organization_id, name, kind, max_days_per_year, accrual)
    values (acme, 'LOP monthly', 'unpaid', 0, 'monthly');
  exception when check_violation then msg := sqlerrm;
  end;
  if coalesce(msg, '') not ilike '%leave_type_only_paid_accrues%' then
    raise exception 'ACCRUAL FAIL: an unpaid type was allowed to accrue (%)', msg;
  end if;
  perform pg_temp.ac_ok('only a paid type accrues');

  -- ── 4 · the sweep raises balances to the rule and never lowers one
  perform pg_temp.ac_as(ravi);
  perform public.leave_my_balances();
  perform pg_temp.ac_root();
  select * into bal from public.leave_balances where employee_id = ravi and leave_type_id = el and fy_label = fy;
  if bal.entitled_days <> least(floor(15 * months / 12.0 * 2) / 2, 15) then
    raise exception 'ACCRUAL FAIL: the balance opened at %', bal.entitled_days;
  end if;
  update public.leave_balances set entitled_days = 0 where id = bal.id;
  perform public.leave_accrue_due();
  if (select entitled_days from public.leave_balances where id = bal.id) <> bal.entitled_days then
    raise exception 'ACCRUAL FAIL: the sweep did not raise the balance to the rule';
  end if;
  update public.leave_balances set entitled_days = 15 where id = bal.id;
  perform public.leave_accrue_due();
  if (select entitled_days from public.leave_balances where id = bal.id) <> 15 then
    raise exception 'ACCRUAL FAIL: the sweep lowered a balance';
  end if;
  -- Somebody who has left is not credited.
  perform pg_temp.ac_as(priya);
  perform public.leave_my_balances();
  perform pg_temp.ac_root();
  update public.leave_balances set entitled_days = 0 where employee_id = priya and leave_type_id = el;
  update public.profiles set is_active = false where id = priya;
  perform public.leave_accrue_due();
  if (select entitled_days from public.leave_balances where employee_id = priya and leave_type_id = el and fy_label = fy) <> 0 then
    raise exception 'ACCRUAL FAIL: somebody who has left was credited';
  end if;
  update public.profiles set is_active = true where id = priya;
  -- Upfront balances are not the sweep's.
  update public.leave_balances set entitled_days = 5 where employee_id = ravi and leave_type_id = casual and fy_label = fy;
  perform public.leave_accrue_due();
  if (select entitled_days from public.leave_balances where employee_id = ravi and leave_type_id = casual and fy_label = fy) <> 5 then
    raise exception 'ACCRUAL FAIL: the sweep touched an upfront balance';
  end if;
  update public.leave_balances set entitled_days = 12 where employee_id = ravi and leave_type_id = casual and fy_label = fy;
  perform pg_temp.ac_ok('the sweep raises a monthly balance to the rule, never lowers one, and leaves leavers and upfront types alone');

  -- ── 5 · only what has been credited can be booked
  update public.leave_balances set entitled_days = 1 where id = bal.id;
  msg := null;
  begin
    perform pg_temp.ac_as(ravi);
    perform public.leave_submit(el, mon, mon + 1, null);
  exception when others then msg := sqlerrm;
  end;
  perform pg_temp.ac_root();
  if coalesce(msg, '') not ilike '%INSUFFICIENT_BALANCE%' then
    raise exception 'ACCRUAL FAIL: two days were booked against one credited (%)', msg;
  end if;
  perform pg_temp.ac_ok('only what has been credited can be booked');

  -- ── 6 · nobody signed in runs the sweep
  msg := null;
  begin
    perform pg_temp.ac_as(ravi);
    perform public.leave_accrue_due();
  exception when others then msg := sqlerrm;
  end;
  perform pg_temp.ac_root();
  if msg is null then raise exception 'ACCRUAL FAIL: a signed-in person can run the sweep'; end if;
  perform pg_temp.ac_ok('the sweep is out of reach of anybody signed in');
end $$;

rollback;
