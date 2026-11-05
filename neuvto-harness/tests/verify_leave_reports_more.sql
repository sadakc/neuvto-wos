-- NEUVTO WOS — four more Leave reports (D94)
--
-- Raises on the first violation. Silence means pass. Rolled back.
--
-- PHASE-AWARE: exits quietly if leave_liability_report does not exist yet.
--
-- Liability owes what is not yet taken, booked and free, for everybody with a
-- balance, nothing for unpaid; the comp-off register lists the claims made in
-- the window with their days and outcome; turnaround measures each decision
-- from when its level began, names who decided and whether it moved up;
-- absenteeism counts only approved leave and only the days inside the window,
-- with the Bradford factor; all four are the Leave Admin's.

begin;

create or replace function pg_temp.rp_as(_uid uuid) returns void as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', _uid::text, 'role', 'authenticated')::text, true);
end $$ language plpgsql;

create or replace function pg_temp.rp_root() returns void as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$ language plpgsql;

create or replace function pg_temp.rp_ok(_label text) returns void as $$
begin raise notice 'ok: %', _label; end $$ language plpgsql;

create or replace function pg_temp.rp_refused(_label text, _uid uuid, _sql text, _needle text)
returns void as $$
declare v_msg text;
begin
  perform pg_temp.rp_as(_uid);
  begin
    execute _sql;
  exception when others then
    v_msg := sqlerrm;
  end;
  perform pg_temp.rp_root();
  if v_msg is null then
    raise exception 'REPORTS FAIL: % — it was allowed', _label;
  end if;
  if v_msg not ilike '%' || _needle || '%' then
    raise exception 'REPORTS FAIL: % — refused for the wrong reason: %', _label, v_msg;
  end if;
  perform pg_temp.rp_ok(_label);
end $$ language plpgsql;

create or replace function pg_temp.rp_leave(_uid uuid, _type uuid, _from date, _to date) returns uuid as $$
declare v uuid;
begin
  perform pg_temp.rp_as(_uid);
  v := public.leave_submit(_type, _from, _to, null);
  perform pg_temp.rp_root();
  return v;
exception when others then
  perform pg_temp.rp_root();
  raise exception 'REPORTS FAIL: leave refused: %', sqlerrm;
end $$ language plpgsql;

create or replace function pg_temp.rp_approve(_uid uuid, _leave uuid) returns void as $$
begin
  perform pg_temp.rp_as(_uid);
  perform public.approval_decide((select approval_request_id from public.leave_requests where id = _leave), 'approved');
  perform pg_temp.rp_root();
exception when others then
  perform pg_temp.rp_root();
  raise exception 'REPORTS FAIL: approval refused: %', sqlerrm;
end $$ language plpgsql;

do $$
declare
  acme   uuid := '00000000-0000-0000-0000-0000000000a0';
  hema   uuid := '00000000-0000-0000-0000-00000000a002';
  dan    uuid := '00000000-0000-0000-0000-00000000a003';  -- Employee Admin only, and Mark's manager
  mark   uuid := '00000000-0000-0000-0000-00000000a004';  -- Leave Admin below; Ravi's and Priya's approver
  ravi   uuid := '00000000-0000-0000-0000-00000000a005';
  priya  uuid := '00000000-0000-0000-0000-00000000a006';
  casual uuid := '00000000-0000-0000-0000-0000000000c1';
  sick   uuid := '00000000-0000-0000-0000-0000000000c2';
  today  date := current_date;
  mon    date := (date_trunc('week', current_date + 28) + interval '7 days')::date;
  lop uuid; coff uuid; claim uuid;
  l1 uuid; l2 uuid; l3 uuid; l4 uuid;
  rec record;
  bal record;
  n integer;
  st uuid;
begin
  if to_regprocedure('public.leave_liability_report()') is null then
    raise notice 'skip: the four reports do not exist yet';
    return;
  end if;
  delete from public.module_admins;
  insert into public.module_admins (organization_id, user_id, module_key) values
    (acme, mark, 'leave'), (acme, dan, 'employee');
  insert into public.leave_types (organization_id, name, kind, max_days_per_year)
  values (acme, 'LOP report', 'unpaid', 0) returning id into lop;
  insert into public.leave_types (organization_id, name, kind, max_days_per_year)
  values (acme, 'Comp off report', 'earned', 0) returning id into coff;
  update public.leave_balances set entitled_days = 20 where employee_id = ravi and leave_type_id = sick;

  -- ── 0 · the Leave Admin's, and a sensible window
  perform pg_temp.rp_refused('an employee cannot read liability', ravi, 'select * from public.leave_liability_report()', 'FORBIDDEN');
  perform pg_temp.rp_refused('nor the Employee Admin', dan, 'select * from public.leave_liability_report()', 'FORBIDDEN');
  perform pg_temp.rp_refused('nor the register', ravi, format('select * from public.comp_off_register(%L, %L)', today, today), 'FORBIDDEN');
  perform pg_temp.rp_refused('nor turnaround', ravi, format('select * from public.leave_approval_turnaround(%L, %L)', today, today), 'FORBIDDEN');
  perform pg_temp.rp_refused('nor absenteeism', ravi, format('select * from public.leave_absenteeism_report(%L, %L)', today, today), 'FORBIDDEN');
  perform pg_temp.rp_refused('a window ending before it starts', mark, format('select * from public.leave_absenteeism_report(%L, %L)', today, today - 1), 'INVALID_DATE_RANGE');
  perform pg_temp.rp_refused('a window over a year', mark, format('select * from public.leave_approval_turnaround(%L, %L)', today - 400, today), 'RANGE_TOO_LONG');

  -- ── 1 · liability
  l1 := pg_temp.rp_leave(ravi, casual, mon, mon + 2);          -- three days booked, waiting
  perform pg_temp.rp_as(mark);
  select * into rec from public.leave_liability_report() where employee_id = ravi and leave_type_name = 'Casual';
  perform pg_temp.rp_root();
  -- Measured against the balance itself: other suites change Ravi's numbers.
  select b.entitled_days + b.carryforward_days - b.used_days as owed,
         b.reserved_days + b.pending_days as booked
    into bal
    from public.leave_balances b
   where b.employee_id = ravi and b.leave_type_id = casual
     and b.fy_label = public.get_financial_year(acme, current_date);
  if rec.employee_id is null then raise exception 'REPORTS FAIL: Ravi''s Casual is not listed'; end if;
  if bal.booked < 3 then raise exception 'REPORTS FAIL: the booked request did not reserve days'; end if;
  if rec.not_taken_days <> bal.owed or rec.booked_days <> bal.booked or rec.free_days <> bal.owed - bal.booked then
    raise exception 'REPORTS FAIL: Ravi''s Casual liability reads %', to_jsonb(rec);
  end if;
  perform pg_temp.rp_as(mark);
  select count(*) into n from public.leave_liability_report() where employee_id = priya and leave_type_name = 'Sick';
  perform pg_temp.rp_root();
  if n <> 1 then raise exception 'REPORTS FAIL: somebody with no balance row yet is not owed their entitlement'; end if;
  perform pg_temp.rp_as(mark);
  select count(*) into n from public.leave_liability_report() where leave_type_name in ('LOP report', 'Comp off report');
  perform pg_temp.rp_root();
  if n <> 0 then raise exception 'REPORTS FAIL: unpaid leave, or comp off with nothing credited, shows as owed'; end if;
  perform pg_temp.rp_ok('liability owes what is not yet taken, booked and free; nothing for unpaid or uncredited');

  -- ── 2 · the comp-off register
  perform pg_temp.rp_as(ravi);
  claim := public.comp_off_submit(coff, jsonb_build_array(
    jsonb_build_object('date', today - 3, 'days', 1),
    jsonb_build_object('date', today - 2, 'days', 0.5)), 'Audit weekend', null);
  perform pg_temp.rp_root();
  l4 := (select approval_request_id from public.comp_off_claims where id = claim);
  perform pg_temp.rp_as(mark);
  perform public.approval_decide(l4, 'approved');
  select * into rec from public.comp_off_register(today, today) where claim_id = claim;
  if rec.claim_id is null then raise exception 'REPORTS FAIL: the register does not list the claim'; end if;
  select count(*) into n from public.comp_off_register(today - 30, today - 1);
  perform pg_temp.rp_root();
  if rec.claim_id is null or rec.status <> 'approved' or rec.total_days <> 1.5
     or rec.days_worked <> to_char(today - 3, 'YYYY-MM-DD') || ', ' || to_char(today - 2, 'YYYY-MM-DD') || ' (half)' then
    raise exception 'REPORTS FAIL: the register reads %', to_jsonb(rec);
  end if;
  if n <> 0 then raise exception 'REPORTS FAIL: the register lists a claim made outside the window'; end if;
  perform pg_temp.rp_ok('the register lists the claims made in the window, with their days and outcome');

  -- ── 3 · turnaround
  update public.approval_requests set created_at = now() - interval '2 days'
   where id = (select approval_request_id from public.leave_requests where id = l1);
  perform pg_temp.rp_approve(mark, l1);
  l2 := pg_temp.rp_leave(priya, casual, mon + 7, mon + 7);
  perform pg_temp.rp_as(mark);
  perform public.approval_delegate(hema, today, today + 2, null, null);
  perform pg_temp.rp_root();
  perform pg_temp.rp_approve(hema, l2);
  st := (select s.id from public.approval_steps s join public.leave_requests r on r.approval_request_id = s.approval_request_id where r.id = l1);
  perform pg_temp.rp_as(mark);
  select * into rec from public.leave_approval_turnaround(today, today) t where t.step_id = st;
  if rec.step_id is null then raise exception 'REPORTS FAIL: turnaround does not list the decision on %', 'l1'; end if;
  perform pg_temp.rp_root();
  if rec.days_taken < 1.9 or rec.days_taken > 2.1 or rec.decision <> 'approved' or rec.level <> 1 or rec.decided_by_name is not null or rec.moved_up then
    raise exception 'REPORTS FAIL: the turnaround for Ravi''s request reads %', to_jsonb(rec);
  end if;
  st := (select s.id from public.approval_steps s join public.leave_requests r on r.approval_request_id = s.approval_request_id where r.id = l2);
  perform pg_temp.rp_as(mark);
  select * into rec from public.leave_approval_turnaround(today, today) t where t.step_id = st;
  if rec.step_id is null then raise exception 'REPORTS FAIL: turnaround does not list the decision on %', 'l2'; end if;
  perform pg_temp.rp_root();
  if rec.decided_by_name is distinct from (select full_name from public.profiles where id = hema) then
    raise exception 'REPORTS FAIL: a decision made by a delegate does not say so (%)', rec.decided_by_name;
  end if;
  -- One that had to move up.
  update public.approval_delegations set cancelled_at = now() where cancelled_at is null;
  l3 := pg_temp.rp_leave(ravi, sick, mon + 14, mon + 14);
  update public.approval_requests set created_at = now() - interval '3 days'
   where id = (select approval_request_id from public.leave_requests where id = l3);
  perform public.approval_escalate_due();
  perform pg_temp.rp_approve(dan, l3);
  st := (select s.id from public.approval_steps s join public.leave_requests r on r.approval_request_id = s.approval_request_id where r.id = l3);
  perform pg_temp.rp_as(mark);
  select * into rec from public.leave_approval_turnaround(today, today) t where t.step_id = st;
  if rec.step_id is null then raise exception 'REPORTS FAIL: turnaround does not list the decision on %', 'l3'; end if;
  select count(*) into n from public.leave_approval_turnaround(today - 30, today - 1);
  perform pg_temp.rp_root();
  if not rec.moved_up or rec.approver_name <> (select full_name from public.profiles where id = dan) then
    raise exception 'REPORTS FAIL: a decision that moved up does not say so: %', to_jsonb(rec);
  end if;
  if n <> 0 then raise exception 'REPORTS FAIL: turnaround lists decisions outside the window'; end if;
  perform pg_temp.rp_ok('turnaround measures from when the level began, names a delegate, and marks a move up');

  -- ── 4 · absenteeism
  l4 := pg_temp.rp_leave(priya, lop, mon + 14, mon + 15);      -- unpaid, two days
  perform pg_temp.rp_approve(mark, l4);
  perform pg_temp.rp_leave(ravi, sick, mon + 21, mon + 21);     -- still waiting: not absence
  perform pg_temp.rp_as(mark);
  -- Ravi: Casual mon..mon+2 (3) and Sick mon+14 (1): two absences, four days.
  select * into rec from public.leave_absenteeism_report(mon, mon + 30) where employee_id = ravi;
  perform pg_temp.rp_root();
  if rec.spells <> 2 or rec.days <> 4 or rec.unpaid_days <> 0 or rec.bradford_factor <> 16 then
    raise exception 'REPORTS FAIL: Ravi''s absenteeism reads %', to_jsonb(rec);
  end if;
  perform pg_temp.rp_as(mark);
  select * into rec from public.leave_absenteeism_report(mon + 1, mon + 1) where employee_id = ravi;
  perform pg_temp.rp_root();
  if rec.days <> 1 or rec.spells <> 1 then
    raise exception 'REPORTS FAIL: days outside the window were counted: %', to_jsonb(rec);
  end if;
  perform pg_temp.rp_as(mark);
  select * into rec from public.leave_absenteeism_report(mon, mon + 30) where employee_id = priya;
  perform pg_temp.rp_root();
  if rec.unpaid_days <> 2 or rec.days <> 3 then
    raise exception 'REPORTS FAIL: Priya''s unpaid absence reads %', to_jsonb(rec);
  end if;
  perform pg_temp.rp_ok('absenteeism counts approved leave, only inside the window, with unpaid days and the Bradford factor');
end $$;

rollback;
