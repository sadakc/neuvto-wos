-- NEUVTO WOS — Leave phase 2, the contained items (LEAVE_PHASE_2_SCOPE.md)
--
-- Raises on the first violation. Silence means pass. Rolled back.
--
-- PHASE-AWARE: exits quietly if leave_blackouts does not exist yet.
--
-- Unpaid leave takes no balance and is still counted; a rejection says why
-- with a code and a note; several requests are approved at once with each
-- outcome reported; the queue says how long a request has waited against its
-- level's target; a blackout period refuses new leave by name; archiving a type
-- can be priced before it is done.

begin;

create or replace function pg_temp.lp_as(_uid uuid) returns void as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', _uid::text, 'role', 'authenticated')::text, true);
end $$ language plpgsql;

create or replace function pg_temp.lp_root() returns void as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$ language plpgsql;

create or replace function pg_temp.lp_ok(_label text) returns void as $$
begin raise notice 'ok: %', _label; end $$ language plpgsql;

create or replace function pg_temp.lp_refused(_label text, _uid uuid, _sql text, _needle text)
returns void as $$
declare v_msg text;
begin
  if _uid is null then perform pg_temp.lp_root(); else perform pg_temp.lp_as(_uid); end if;
  begin
    execute _sql;
  exception when others then
    v_msg := sqlerrm;
  end;
  perform pg_temp.lp_root();
  if v_msg is null then
    raise exception 'LEAVE P2 FAIL: % — it was allowed', _label;
  end if;
  if v_msg not ilike '%' || _needle || '%' then
    raise exception 'LEAVE P2 FAIL: % — refused for the wrong reason: %', _label, v_msg;
  end if;
  perform pg_temp.lp_ok(_label);
end $$ language plpgsql;

create or replace function pg_temp.lp_submit(_uid uuid, _type uuid, _from date, _to date) returns uuid as $$
declare v uuid;
begin
  perform pg_temp.lp_as(_uid);
  v := public.leave_submit(_type, _from, _to, null);
  perform pg_temp.lp_root();
  return v;
exception when others then
  perform pg_temp.lp_root();
  raise exception 'LEAVE P2 FAIL: submit refused: %', sqlerrm;
end $$ language plpgsql;

create or replace function pg_temp.lp_approval(_req uuid) returns uuid as $$
  select approval_request_id from public.leave_requests where id = _req
$$ language sql;

/** The Monday at least _days ahead, so a five-day span is five working days. */
create or replace function pg_temp.lp_monday(_days int) returns date as $$
  select (date_trunc('week', current_date + _days) + interval '7 days')::date
$$ language sql;

do $$
declare
  acme   uuid := '00000000-0000-0000-0000-0000000000a0';
  alice  uuid := '00000000-0000-0000-0000-00000000a001';  -- company-wide Admin
  dan    uuid := '00000000-0000-0000-0000-00000000a003';  -- Employee Admin below
  mark   uuid := '00000000-0000-0000-0000-00000000a004';  -- approver of Ravi and Priya
  ravi   uuid := '00000000-0000-0000-0000-00000000a005';
  priya  uuid := '00000000-0000-0000-0000-00000000a006';
  casual uuid := '00000000-0000-0000-0000-0000000000c1';
  lop    uuid;
  mon    date := pg_temp.lp_monday(21);
  r1 uuid; r2 uuid; r3 uuid; r4 uuid;
  bo     uuid;
  n      integer;
  n2     integer;
  j      jsonb;
  rec    record;
begin
  if to_regclass('public.leave_blackouts') is null then
    raise notice 'skip: leave phase 2 does not exist yet';
    return;
  end if;
  if exists (select 1 from public.module_admins) then
    delete from public.module_admins;
  end if;
  insert into public.module_admins (organization_id, user_id, module_key) values (acme, dan, 'employee');

  -- ── 1 · unpaid leave is a kind with no allowance, fixed once created
  perform pg_temp.lp_as(alice);
  insert into public.leave_types (organization_id, name, kind, max_days_per_year, approval_required)
  values (acme, 'Loss of pay', 'unpaid', 0, true) returning id into lop;
  perform pg_temp.lp_root();
  perform pg_temp.lp_ok('a Leave Admin adds an unpaid type');
  perform pg_temp.lp_refused('an unpaid type cannot carry an allowance', alice,
    format($q$insert into public.leave_types (organization_id, name, kind, max_days_per_year) values (%L, 'LOP 2', 'unpaid', 5)$q$, acme),
    'leave_type_unpaid_has_no_allowance');
  perform pg_temp.lp_refused('a type''s kind cannot be changed', alice,
    format($q$update public.leave_types set kind = 'unpaid', max_days_per_year = 0 where id = %L$q$, casual),
    'LEAVE_TYPE_KIND_FIXED');
  perform pg_temp.lp_refused('nor an unknown kind used', alice,
    format($q$insert into public.leave_types (organization_id, name, kind) values (%L, 'Odd', 'bonus')$q$, acme),
    'leave_type_kind_known');

  -- ── 2 · it takes no balance, and is still counted
  -- Three working days, so one approval level decides it (level 2 is for
  -- more than three). An unpaid type has no allowance at all, so any length
  -- is beyond it.
  r1 := pg_temp.lp_submit(ravi, lop, mon, mon + 2);
  if exists (select 1 from public.leave_balances where leave_type_id = lop) then
    raise exception 'LEAVE P2 FAIL: unpaid leave created a balance row';
  end if;
  perform pg_temp.lp_as(ravi);
  select count(*) into n from public.leave_my_balances() where leave_type_id = lop;
  select * into rec from public.leave_my_unpaid() where leave_type_id = lop;
  perform pg_temp.lp_root();
  if n <> 0 then raise exception 'LEAVE P2 FAIL: unpaid leave shows as a balance'; end if;
  if rec.pending_days is distinct from 3::numeric or rec.taken_days is distinct from 0::numeric then
    raise exception 'LEAVE P2 FAIL: unpaid asked-for shows as % pending, % taken', rec.pending_days, rec.taken_days;
  end if;
  perform pg_temp.lp_as(ravi);
  select count(*) into n from public.leave_my_unpaid() where leave_type_id <> lop;
  perform pg_temp.lp_root();
  if n <> 0 then raise exception 'LEAVE P2 FAIL: the unpaid summary lists % paid types', n; end if;
  perform pg_temp.lp_ok('unpaid leave is applied for beyond any allowance, with no balance row, and shows as pending');

  perform pg_temp.lp_as(mark);
  perform public.approval_decide(pg_temp.lp_approval(r1), 'approved', null, null);
  perform pg_temp.lp_as(ravi);
  select * into rec from public.leave_my_unpaid() where leave_type_id = lop;
  perform pg_temp.lp_root();
  if (select status from public.leave_requests where id = r1) <> 'approved'
     or rec.taken_days is distinct from 3::numeric or rec.pending_days is distinct from 0::numeric
     or exists (select 1 from public.leave_balances where leave_type_id = lop) then
    raise exception 'LEAVE P2 FAIL: approving unpaid leave went wrong: % taken, % pending', rec.taken_days, rec.pending_days;
  end if;
  perform pg_temp.lp_ok('approved unpaid leave is counted as taken, and still touches no balance');

  perform pg_temp.lp_refused('an opening balance for unpaid leave is refused', alice,
    format($q$select public.leave_set_opening_balance(%L, %L, 1, 0)$q$, ravi, lop), 'UNPAID_HAS_NO_BALANCE');
  perform pg_temp.lp_as(alice);
  select count(*) into n from public.leave_all_balances() where leave_type_id = lop;
  perform pg_temp.lp_root();
  if n <> 0 then raise exception 'LEAVE P2 FAIL: the balances report lists unpaid leave'; end if;
  perform pg_temp.lp_ok('the balances report leaves unpaid leave out');

  -- Sick: 8 a year, 1 used. Two weeks is ten working days.
  perform pg_temp.lp_refused('paid leave is still held to its balance', ravi,
    format($q$select public.leave_submit('00000000-0000-0000-0000-0000000000c2', %L, %L, null)$q$, mon + 14, mon + 25),
    'INSUFFICIENT_BALANCE');

  -- ── 3 · a rejection says why
  r2 := pg_temp.lp_submit(ravi, casual, mon + 14, mon + 14);
  perform pg_temp.lp_refused('a rejection without a reason code is refused', mark,
    format($q$select public.approval_decide(%L, 'rejected', 'clashes with the audit')$q$, pg_temp.lp_approval(r2)),
    'REASON_CODE_REQUIRED');
  perform pg_temp.lp_refused('a made-up reason code is refused', mark,
    format($q$select public.approval_decide(%L, 'rejected', 'clashes with the audit', 'vibes')$q$, pg_temp.lp_approval(r2)),
    'REASON_CODE_REQUIRED');
  perform pg_temp.lp_refused('a rejection without a note is refused', mark,
    format($q$select public.approval_decide(%L, 'rejected', '  ', 'business_need')$q$, pg_temp.lp_approval(r2)),
    'NOTE_REQUIRED');
  perform pg_temp.lp_as(mark);
  perform public.approval_decide(pg_temp.lp_approval(r2), 'rejected', 'Clashes with the audit', 'business_need');
  perform pg_temp.lp_as(ravi);
  select * into rec from public.approval_timeline(pg_temp.lp_approval(r2));
  perform pg_temp.lp_root();
  if rec.reason_code is distinct from 'business_need' or rec.comments is distinct from 'Clashes with the audit' then
    raise exception 'LEAVE P2 FAIL: the person sees the rejection as % / %', rec.reason_code, rec.comments;
  end if;
  if (select reserved_days from public.leave_balances
       where employee_id = ravi and leave_type_id = casual and deleted_at is null
       order by fy_label desc limit 1) <> 0 then
    raise exception 'LEAVE P2 FAIL: a rejected request kept its day reserved';
  end if;
  perform pg_temp.lp_ok('a rejection carries a code and a note, the person sees both, and the day is released');

  -- ── 4 · approve selected
  r3 := pg_temp.lp_submit(ravi, casual, mon + 21, mon + 21);
  r4 := pg_temp.lp_submit(priya, casual, mon + 21, mon + 21);
  perform pg_temp.lp_as(mark);
  select count(*) filter (where status = 'approved'),
         count(*) filter (where error is not null)
    into n, n2
    from public.approval_decide_many(array[pg_temp.lp_approval(r3), pg_temp.lp_approval(r4),
                                           pg_temp.lp_approval(r2), gen_random_uuid()]) x;
  perform pg_temp.lp_root();
  if n <> 2 or n2 <> 2 then
    raise exception 'LEAVE P2 FAIL: approving several approved % of 2 and reported % refusals of 2', n, n2;
  end if;
  if (select count(*) from public.leave_requests where id in (r3, r4) and status = 'approved') <> 2 then
    raise exception 'LEAVE P2 FAIL: the selected requests were not approved';
  end if;
  perform pg_temp.lp_as(mark);
  select count(*) into n from public.approval_decide_many(array[pg_temp.lp_approval(r2), gen_random_uuid()])
   where error in ('ALREADY_DECIDED', 'NOT_FOUND');
  perform pg_temp.lp_root();
  if n <> 2 then raise exception 'LEAVE P2 FAIL: refusals were not reported one by one'; end if;
  perform pg_temp.lp_ok('approving several approves each one it can and reports each one it cannot');
  r4 := pg_temp.lp_submit(ravi, casual, mon + 28, mon + 28);
  -- Looked up as root: Priya cannot read Ravi's request, which is the point.
  bo := pg_temp.lp_approval(r4);
  perform pg_temp.lp_as(priya);
  select count(*) into n from public.approval_decide_many(array[bo])
   where status is null and error = 'NOT_YOUR_APPROVAL';
  perform pg_temp.lp_root();
  if n <> 1 or (select status from public.leave_requests where id = r4) <> 'pending_approval' then
    raise exception 'LEAVE P2 FAIL: a colleague approved somebody else''s request in bulk';
  end if;
  perform pg_temp.lp_ok('approving several approves nothing that is not yours');

  -- ── 5 · how long it has waited, against the level's target
  perform pg_temp.lp_as(mark);
  select * into rec from public.approval_queue() limit 1;
  perform pg_temp.lp_root();
  if rec.target_days is distinct from 2 or rec.level_since is null then
    raise exception 'LEAVE P2 FAIL: the queue says target %, since %', rec.target_days, rec.level_since;
  end if;
  perform pg_temp.lp_ok('the queue carries when the request reached its level and the level''s target');

  -- ── 6 · blackout periods
  perform pg_temp.lp_refused('an employee cannot add a blackout', ravi,
    format($q$insert into public.leave_blackouts (organization_id, name, from_date, to_date) values (%L, 'Mine', %L, %L)$q$,
           acme, mon + 35, mon + 36), 'row-level security');
  perform pg_temp.lp_refused('nor an Employee Admin', dan,
    format($q$insert into public.leave_blackouts (organization_id, name, from_date, to_date) values (%L, 'Mine', %L, %L)$q$,
           acme, mon + 35, mon + 36), 'row-level security');
  perform pg_temp.lp_refused('a blackout ending before it starts is refused', alice,
    format($q$insert into public.leave_blackouts (organization_id, name, from_date, to_date) values (%L, 'Back', %L, %L)$q$,
           acme, mon + 36, mon + 35), 'leave_blackout_dates_in_order');
  perform pg_temp.lp_as(alice);
  insert into public.leave_blackouts (organization_id, name, from_date, to_date)
  values (acme, 'Year-end audit', mon + 35, mon + 39) returning id into bo;
  perform pg_temp.lp_root();
  perform pg_temp.lp_refused('leave over a blackout is refused, by name', ravi,
    format($q$select public.leave_submit(%L, %L, %L, null)$q$, casual, mon + 38, mon + 42), 'BLACKOUT_PERIOD: Year-end audit');
  perform pg_temp.lp_refused('unpaid leave too', ravi,
    format($q$select public.leave_submit(%L, %L, %L, null)$q$, lop, mon + 35, mon + 35), 'BLACKOUT_PERIOD');
  perform pg_temp.lp_as(ravi);
  select count(*) into n from public.leave_blackouts;
  perform pg_temp.lp_root();
  if n <> 1 then raise exception 'LEAVE P2 FAIL: an employee sees % blackouts, expected 1', n; end if;
  perform pg_temp.lp_refused('an employee cannot remove a blackout', ravi,
    format('select public.leave_blackout_remove(%L)', bo), 'FORBIDDEN');
  perform pg_temp.lp_as(alice);
  perform public.leave_blackout_remove(bo);
  perform pg_temp.lp_root();
  r1 := pg_temp.lp_submit(ravi, casual, mon + 38, mon + 38);
  perform pg_temp.lp_ok('removing the blackout lets the dates be applied for again');

  -- ── 7 · what archiving a type leaves behind
  perform pg_temp.lp_as(alice);
  j := public.leave_type_impact(casual);
  perform pg_temp.lp_root();
  if (j ->> 'pendingRequests')::int < 1 or (j ->> 'upcomingApproved')::int < 2
     or (j ->> 'peopleWithDaysLeft')::int < 1 then
    raise exception 'LEAVE P2 FAIL: the archive impact reads %', j;
  end if;
  perform pg_temp.lp_ok('archiving a type is priced first: pending, upcoming, and who still has days');
  perform pg_temp.lp_refused('an employee cannot price it', ravi,
    format('select public.leave_type_impact(%L)', casual), 'FORBIDDEN');
  perform pg_temp.lp_refused('nor an Employee Admin', dan,
    format('select public.leave_type_impact(%L)', casual), 'FORBIDDEN');
end $$;

rollback;
