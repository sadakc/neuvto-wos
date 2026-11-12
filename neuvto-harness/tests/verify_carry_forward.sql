-- NEUVTO WOS — carry-forward review (D91)
--
-- Raises on the first violation. Silence means pass. Rolled back.
--
-- PHASE-AWARE: exits quietly if leave_carry_reviews does not exist yet.
--
-- Preparing a review writes no balance; the proposal is the smaller of what is
-- left and the type's maximum; only types that carry are listed; the Leave
-- Admin may change a line within what is left; locking applies every line to
-- next year at once, only once next year is open and only if no balance has
-- moved; a locked review never changes.

begin;

create or replace function pg_temp.cf_as(_uid uuid) returns void as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', _uid::text, 'role', 'authenticated')::text, true);
end $$ language plpgsql;

create or replace function pg_temp.cf_root() returns void as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$ language plpgsql;

create or replace function pg_temp.cf_ok(_label text) returns void as $$
begin raise notice 'ok: %', _label; end $$ language plpgsql;

create or replace function pg_temp.cf_refused(_label text, _uid uuid, _sql text, _needle text)
returns void as $$
declare v_msg text;
begin
  if _uid is null then perform pg_temp.cf_root(); else perform pg_temp.cf_as(_uid); end if;
  begin
    execute _sql;
  exception when others then
    v_msg := sqlerrm;
  end;
  perform pg_temp.cf_root();
  if v_msg is null then
    raise exception 'CARRY FAIL: % — it was allowed', _label;
  end if;
  if v_msg not ilike '%' || _needle || '%' then
    raise exception 'CARRY FAIL: % — refused for the wrong reason: %', _label, v_msg;
  end if;
  perform pg_temp.cf_ok(_label);
end $$ language plpgsql;

create or replace function pg_temp.cf_do(_uid uuid, _sql text) returns jsonb as $$
declare v jsonb;
begin
  perform pg_temp.cf_as(_uid);
  execute _sql into v;
  perform pg_temp.cf_root();
  return v;
exception when others then
  perform pg_temp.cf_root();
  raise exception 'CARRY FAIL: refused: % — %', _sql, sqlerrm;
end $$ language plpgsql;

do $$
declare
  acme   uuid := '00000000-0000-0000-0000-0000000000a0';
  dan    uuid := '00000000-0000-0000-0000-00000000a003';  -- Employee Admin only
  mark   uuid := '00000000-0000-0000-0000-00000000a004';  -- Leave Admin only
  ravi   uuid := '00000000-0000-0000-0000-00000000a005';
  priya  uuid := '00000000-0000-0000-0000-00000000a006';
  casual uuid := '00000000-0000-0000-0000-0000000000c1';
  sick   uuid := '00000000-0000-0000-0000-0000000000c2';
  fy     text;
  prev   text;
  review uuid;
  cur_review uuid;
  j      jsonb;
  l_ravi uuid;
  n      integer;
  msg    text;
begin
  if to_regclass('public.leave_carry_reviews') is null then
    raise notice 'skip: carry-forward review does not exist yet';
    return;
  end if;
  delete from public.module_admins;
  insert into public.module_admins (organization_id, user_id, module_key) values
    (acme, mark, 'leave'), (acme, dan, 'employee');

  fy := public.get_financial_year(acme, current_date);
  prev := public.get_financial_year(acme, (
    select make_date(split_part(fy, '-', 1)::int, s.fy_start_month, s.fy_start_day) - 1
      from public.organization_settings s where s.organization_id = acme));

  update public.leave_types set carry_forward_max = 5 where id = casual;
  -- Last year: Ravi has 8 Casual left, Priya 2; Ravi's Sick does not carry.
  insert into public.leave_balances (organization_id, employee_id, leave_type_id, fy_label, entitled_days, used_days)
  values (acme, ravi, casual, prev, 12, 4), (acme, priya, casual, prev, 12, 10), (acme, ravi, sick, prev, 8, 1);

  -- ── 0 · only a paid type carries
  begin
    insert into public.leave_types (organization_id, name, kind, max_days_per_year, carry_forward_max)
    values (acme, 'LOP carry', 'unpaid', 0, 3);
  exception when check_violation then msg := sqlerrm;
  end;
  if coalesce(msg, '') not ilike '%leave_type_only_paid_carries%' then
    raise exception 'CARRY FAIL: an unpaid type was given a carry-over (%)', msg;
  end if;

  -- ── 1 · only the Leave Admin
  perform pg_temp.cf_refused('an employee cannot prepare a review', ravi,
    format('select public.leave_carry_prepare(%L)', prev), 'FORBIDDEN');
  perform pg_temp.cf_refused('nor can the Employee Admin', dan,
    format('select public.leave_carry_prepare(%L)', prev), 'FORBIDDEN');
  perform pg_temp.cf_refused('a year not yet begun has nothing to carry', mark,
    format('select public.leave_carry_prepare(%L)', public.leave_next_fy(acme, fy)), 'INVALID_YEAR');

  j := pg_temp.cf_do(mark, 'select public.leave_carry_years()');
  if j ->> 'current' <> fy or j ->> 'previous' <> prev then
    raise exception 'CARRY FAIL: the years offered are %', j;
  end if;
  perform pg_temp.cf_refused('an employee is not offered the years', ravi,
    'select public.leave_carry_years()', 'FORBIDDEN');

  -- ── 2 · preparing proposes and writes nothing
  review := (pg_temp.cf_do(mark, format('select to_jsonb(public.leave_carry_prepare(%L))', prev)) #>> '{}')::uuid;
  j := pg_temp.cf_do(mark, format('select public.leave_carry_review(%L)', prev));
  if jsonb_array_length(j -> 'lines') <> 2 or j ->> 'status' <> 'draft' or j ->> 'toFy' <> fy then
    raise exception 'CARRY FAIL: the review reads %', j;
  end if;
  -- By id, not by name: another suite renames people.
  select id into l_ravi from public.leave_carry_lines where review_id = review and employee_id = ravi;
  if not exists (select 1 from jsonb_array_elements(j -> 'lines') x where (x ->> 'id')::uuid = l_ravi) then
    raise exception 'CARRY FAIL: the review does not list Ravi''s line';
  end if;
  if (select proposed_days from public.leave_carry_lines where id = l_ravi) <> 5
     or (select proposed_days from public.leave_carry_lines where employee_id = priya and review_id = review) <> 2 then
    raise exception 'CARRY FAIL: proposals are not the smaller of what is left and the maximum';
  end if;
  if exists (select 1 from public.leave_balances where fy_label = fy and leave_type_id = casual and carryforward_days <> 0) then
    raise exception 'CARRY FAIL: preparing wrote to a balance';
  end if;
  perform pg_temp.cf_ok('preparing proposes the smaller of what is left and the maximum, lists only types that carry, and writes nothing');

  -- ── 3 · the Admin changes a line, within what is left
  perform pg_temp.cf_do(mark, format('select to_jsonb(public.leave_carry_adjust(%L, 7))', l_ravi));
  perform pg_temp.cf_refused('not more than they have left', mark,
    format('select public.leave_carry_adjust(%L, 9)', l_ravi), 'MORE_THAN_LEFT');
  perform pg_temp.cf_refused('in halves', mark,
    format('select public.leave_carry_adjust(%L, 1.3)', l_ravi), 'NOT_A_HALF_DAY');
  perform pg_temp.cf_refused('never negative', mark,
    format('select public.leave_carry_adjust(%L, -1)', l_ravi), 'NEGATIVE_DAYS');
  perform pg_temp.cf_refused('an employee cannot change a line', ravi,
    format('select public.leave_carry_adjust(%L, 8)', l_ravi), 'FORBIDDEN');
  perform pg_temp.cf_refused('a line that does not exist', mark,
    format('select public.leave_carry_adjust(%L, 1)', gen_random_uuid()), 'NOT_FOUND');
  perform pg_temp.cf_do(mark, format('select to_jsonb(public.leave_carry_prepare(%L))', prev));
  if (select adjusted_days from public.leave_carry_lines where id = l_ravi) <> 7 then
    raise exception 'CARRY FAIL: preparing again lost the Admin''s number';
  end if;
  perform pg_temp.cf_ok('the Admin changes a line within what is left, and preparing again keeps it');

  -- ── 4 · locking applies exactly what was on the screen
  update public.leave_balances set used_days = 5 where employee_id = ravi and leave_type_id = casual and fy_label = prev;
  perform pg_temp.cf_refused('a balance that moved since preparing makes the review stale', mark,
    format('select public.leave_carry_lock(%L)', review), 'REVIEW_STALE');
  perform pg_temp.cf_do(mark, format('select to_jsonb(public.leave_carry_prepare(%L))', prev));

  -- Priya already relies on more carried-over days next year than the line gives.
  update public.leave_balances set carryforward_days = 6, used_days = 15
   where employee_id = priya and leave_type_id = casual and fy_label = fy;
  perform pg_temp.cf_refused('a lock that would overdraw next year applies nothing', mark,
    format('select public.leave_carry_lock(%L)', review), 'CARRY_WOULD_OVERDRAW');
  if (select carryforward_days from public.leave_balances where employee_id = ravi and leave_type_id = casual and fy_label = fy) <> 0 then
    raise exception 'CARRY FAIL: a refused lock applied a line';
  end if;
  update public.leave_balances set carryforward_days = 0, used_days = 6
   where employee_id = priya and leave_type_id = casual and fy_label = fy;

  if not public.leave_year_open(acme, public.financial_year_start(acme, public.leave_next_fy(acme, fy))) then
    cur_review := (pg_temp.cf_do(mark, format('select to_jsonb(public.leave_carry_prepare(%L))', fy)) #>> '{}')::uuid;
    perform pg_temp.cf_refused('next year must be open before this year''s review is locked', mark,
      format('select public.leave_carry_lock(%L)', cur_review), 'NEXT_YEAR_NOT_OPEN_YET');
  end if;

  n := (pg_temp.cf_do(mark, format('select to_jsonb(public.leave_carry_lock(%L))', review)) #>> '{}')::int;
  if n <> 2
     or (select carryforward_days from public.leave_balances where employee_id = ravi and leave_type_id = casual and fy_label = fy) <> 7
     or (select carryforward_days from public.leave_balances where employee_id = priya and leave_type_id = casual and fy_label = fy) <> 2
     or exists (select 1 from public.leave_balances where employee_id = ravi and leave_type_id = sick and fy_label = fy and carryforward_days <> 0) then
    raise exception 'CARRY FAIL: locking applied the wrong days';
  end if;
  j := pg_temp.cf_do(mark, format('select public.leave_carry_review(%L)', prev));
  if j ->> 'status' <> 'locked' or j ->> 'lockedBy' is distinct from (select full_name from public.profiles where id = mark) then
    raise exception 'CARRY FAIL: the locked review reads %', j;
  end if;
  perform pg_temp.cf_ok('locking applies every line to next year at once, the Admin''s numbers where changed');

  -- ── 5 · a locked review never changes
  perform pg_temp.cf_refused('a locked line cannot be changed', mark,
    format('select public.leave_carry_adjust(%L, 1)', l_ravi), 'REVIEW_LOCKED');
  perform pg_temp.cf_refused('nor the review prepared again', mark,
    format('select public.leave_carry_prepare(%L)', prev), 'REVIEW_LOCKED');
  perform pg_temp.cf_refused('nor locked twice', mark,
    format('select public.leave_carry_lock(%L)', review), 'REVIEW_LOCKED');
  perform pg_temp.cf_refused('nor its lines touched directly', null,
    format('update public.leave_carry_lines set adjusted_days = 0 where id = %L', l_ravi), 'REVIEW_LOCKED');
  perform pg_temp.cf_refused('nor the review reopened directly', null,
    format('update public.leave_carry_reviews set status = ''draft'', locked_at = null where id = %L', review), 'REVIEW_LOCKED');
  perform pg_temp.cf_refused('and nobody signed in reads the tables', ravi,
    'select count(*) from public.leave_carry_lines', 'permission denied');
end $$;

rollback;
