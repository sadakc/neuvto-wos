-- NEUVTO WOS — handing approvals to somebody while away (D92)
--
-- Raises on the first violation. Silence means pass. Rolled back.
--
-- PHASE-AWARE: exits quietly if approval_delegations does not exist yet.
--
-- An approver hands their approvals to a colleague who can approve, for a
-- date range and a scope; while in force the delegate sees, is told of, reads
-- and decides them, and the history says on whose behalf; outside its dates,
-- scope, or once cancelled, nothing; never a chain; never one's own request;
-- never two signatures on one request; only an admin sets one up for somebody
-- else.

begin;

create or replace function pg_temp.dl_as(_uid uuid) returns void as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', _uid::text, 'role', 'authenticated')::text, true);
end $$ language plpgsql;

create or replace function pg_temp.dl_root() returns void as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$ language plpgsql;

create or replace function pg_temp.dl_ok(_label text) returns void as $$
begin raise notice 'ok: %', _label; end $$ language plpgsql;

create or replace function pg_temp.dl_refused(_label text, _uid uuid, _sql text, _needle text)
returns void as $$
declare v_msg text;
begin
  perform pg_temp.dl_as(_uid);
  begin
    execute _sql;
  exception when others then
    v_msg := sqlerrm;
  end;
  perform pg_temp.dl_root();
  if v_msg is null then
    raise exception 'DELEGATION FAIL: % — it was allowed', _label;
  end if;
  if v_msg not ilike '%' || _needle || '%' then
    raise exception 'DELEGATION FAIL: % — refused for the wrong reason: %', _label, v_msg;
  end if;
  perform pg_temp.dl_ok(_label);
end $$ language plpgsql;

create or replace function pg_temp.dl_val(_uid uuid, _sql text) returns text as $$
declare v text;
begin
  perform pg_temp.dl_as(_uid);
  execute _sql into v;
  perform pg_temp.dl_root();
  return v;
exception when others then
  perform pg_temp.dl_root();
  raise exception 'DELEGATION FAIL: refused: % — %', _sql, sqlerrm;
end $$ language plpgsql;

create or replace function pg_temp.dl_leave(_uid uuid, _from date, _to date) returns uuid as $$
declare v uuid;
begin
  perform pg_temp.dl_as(_uid);
  v := public.leave_submit('00000000-0000-0000-0000-0000000000c2', _from, _to, null);
  perform pg_temp.dl_root();
  return (select approval_request_id from public.leave_requests where id = v);
exception when others then
  perform pg_temp.dl_root();
  raise exception 'DELEGATION FAIL: leave refused: %', sqlerrm;
end $$ language plpgsql;

create or replace function pg_temp.dl_in_queue(_uid uuid, _ar uuid) returns boolean as $$
declare n integer;
begin
  perform pg_temp.dl_as(_uid);
  select count(*) into n from public.approval_queue() where approval_request_id = _ar;
  perform pg_temp.dl_root();
  return n > 0;
end $$ language plpgsql;

do $$
declare
  acme  uuid := '00000000-0000-0000-0000-0000000000a0';
  alice uuid := '00000000-0000-0000-0000-00000000a001';  -- org_admin
  hema  uuid := '00000000-0000-0000-0000-00000000a002';  -- hr_admin
  dan   uuid := '00000000-0000-0000-0000-00000000a003';
  mark  uuid := '00000000-0000-0000-0000-00000000a004';  -- Ravi's and Priya's approver
  ravi  uuid := '00000000-0000-0000-0000-00000000a005';
  priya uuid := '00000000-0000-0000-0000-00000000a006';
  nomgr uuid := '00000000-0000-0000-0000-00000000a008';
  bob   uuid := '00000000-0000-0000-0000-00000000b001';  -- another company
  today date := public.org_today('00000000-0000-0000-0000-0000000000a0');
  mon   date := (date_trunc('week', current_date + 14) + interval '7 days')::date;
  d1 uuid; d2 uuid; d3 uuid;
  a1 uuid; a2 uuid; a3 uuid; a4 uuid; a5 uuid; probe uuid;
  v  text;
  rec record;
begin
  if to_regclass('public.approval_delegations') is null then
    raise notice 'skip: delegation does not exist yet';
    return;
  end if;

  -- Enough Sick for the requests below.
  update public.leave_balances set entitled_days = 20
   where employee_id = ravi and leave_type_id = '00000000-0000-0000-0000-0000000000c2';

  -- ── 1 · who can be handed approvals, and when
  perform pg_temp.dl_refused('not to yourself', mark,
    format('select public.approval_delegate(%L, %L, %L)', mark, today, today + 3), 'DELEGATE_TO_SELF');
  perform pg_temp.dl_refused('not to somebody who cannot approve', mark,
    format('select public.approval_delegate(%L, %L, %L)', priya, today, today + 3), 'DELEGATE_CANNOT_APPROVE');
  perform pg_temp.dl_refused('not to somebody in another company', mark,
    format('select public.approval_delegate(%L, %L, %L)', bob, today, today + 3), 'DELEGATE_CANNOT_APPROVE');
  perform pg_temp.dl_refused('not backdated', mark,
    format('select public.approval_delegate(%L, %L, %L)', hema, today - 1, today + 3), 'PAST_DATE');
  perform pg_temp.dl_refused('not ending before it starts', mark,
    format('select public.approval_delegate(%L, %L, %L)', hema, today + 3, today), 'INVALID_DATE_RANGE');
  perform pg_temp.dl_refused('not longer than six months', mark,
    format('select public.approval_delegate(%L, %L, %L)', hema, today, today + 181), 'DELEGATION_TOO_LONG');
  perform pg_temp.dl_refused('not for a module the company does not have', mark,
    format('select public.approval_delegate(%L, %L, %L, ''payroll'')', hema, today, today + 3), 'MODULE_NOT_ENABLED');
  perform pg_temp.dl_refused('an employee cannot hand over somebody else''s approvals', ravi,
    format('select public.approval_delegate(%L, %L, %L, null, null, %L)', hema, today, today + 3, mark), 'FORBIDDEN');

  -- ── 2 · in force: seen, told, read, decided, recorded
  d1 := pg_temp.dl_val(mark, format('select public.approval_delegate(%L, %L, %L, ''leave'', ''On leave'')', hema, today, today + 7))::uuid;
  if not exists (select 1 from public.notifications where event_key = 'approval.delegated' and recipient_id = hema) then
    raise exception 'DELEGATION FAIL: the delegate was not told';
  end if;
  perform pg_temp.dl_refused('one delegation at a time', mark,
    format('select public.approval_delegate(%L, %L, %L)', alice, today + 5, today + 9), 'DELEGATION_OVERLAPS');

  a1 := pg_temp.dl_leave(ravi, mon, mon + 2);
  if not pg_temp.dl_in_queue(hema, a1) then raise exception 'DELEGATION FAIL: the delegate does not see it'; end if;
  if not pg_temp.dl_in_queue(mark, a1) then raise exception 'DELEGATION FAIL: the approver lost it'; end if;
  perform pg_temp.dl_as(hema);
  select on_behalf_of into v from public.approval_queue() where approval_request_id = a1;
  perform pg_temp.dl_root();
  if v is distinct from (select full_name from public.profiles where id = mark) then
    raise exception 'DELEGATION FAIL: the queue says on behalf of %', v;
  end if;
  if not exists (select 1 from public.notifications where event_key = 'approval.submitted' and recipient_id = hema
                  and payload ->> 'approval_request_id' = a1::text) then
    raise exception 'DELEGATION FAIL: the delegate was not told of a new request';
  end if;
  perform pg_temp.dl_val(hema, format('select count(*) from public.leave_approval_detail(%L)', a1));
  perform pg_temp.dl_val(hema, format('select public.approval_decide(%L, ''approved'')', a1));
  select * into rec from public.approval_steps where approval_request_id = a1 and level = 1;
  if rec.approver_id <> mark or rec.decided_by <> hema or rec.decision <> 'approved' then
    raise exception 'DELEGATION FAIL: the step reads %', to_jsonb(rec);
  end if;
  perform pg_temp.dl_as(ravi);
  select decided_by into v from public.approval_timeline(a1) where level = 1;
  perform pg_temp.dl_root();
  if v is distinct from (select full_name from public.profiles where id = hema) then
    raise exception 'DELEGATION FAIL: the history does not say who decided (%)', v;
  end if;
  perform pg_temp.dl_ok('in force, the delegate sees, is told of, reads and decides the approver''s requests, and the history says so');

  -- ── 3 · outside its scope, nothing
  perform pg_temp.dl_as(ravi);
  probe := public.approval_submit('harness_probe', gen_random_uuid(), '{"size": 1}');
  perform pg_temp.dl_root();
  if pg_temp.dl_in_queue(hema, probe) then raise exception 'DELEGATION FAIL: a leave-only delegation reached another module'; end if;
  perform pg_temp.dl_refused('nor can it be decided', hema,
    format('select public.approval_decide(%L, ''approved'')', probe), 'NOT_YOUR_APPROVAL');

  -- ── 4 · not before it starts, not after it is cancelled
  d2 := pg_temp.dl_val(dan, format('select public.approval_delegate(%L, %L, %L)', alice, today + 10, today + 12))::uuid;
  a2 := pg_temp.dl_leave(ravi, mon + 7, mon + 11);   -- five days: Mark, then Dan
  perform pg_temp.dl_val(mark, format('select public.approval_decide(%L, ''approved'')', a2));
  if pg_temp.dl_in_queue(alice, a2) then raise exception 'DELEGATION FAIL: a delegation in force before its start'; end if;
  perform pg_temp.dl_refused('a delegation not yet begun decides nothing', alice,
    format('select public.approval_decide(%L, ''approved'')', a2), 'NOT_YOUR_APPROVAL');
  perform pg_temp.dl_refused('only the approver, the one who set it up, or an admin cancels it', ravi,
    format('select public.approval_delegation_cancel(%L)', d1), 'NOT_FOUND');
  perform pg_temp.dl_val(mark, format('select public.approval_delegation_cancel(%L)', d1));
  a3 := pg_temp.dl_leave(priya, mon + 14, mon + 14);
  if pg_temp.dl_in_queue(hema, a3) then raise exception 'DELEGATION FAIL: a cancelled delegation still hands over'; end if;
  perform pg_temp.dl_refused('nor decides', hema,
    format('select public.approval_decide(%L, ''approved'')', a3), 'NOT_YOUR_APPROVAL');
  perform pg_temp.dl_ok('nothing outside its scope, before it starts, or once cancelled');

  -- ── 5 · never a chain; never two signatures on one request
  d3 := pg_temp.dl_val(mark, format('select public.approval_delegate(%L, %L, %L)', hema, today, today + 3))::uuid;
  perform pg_temp.dl_val(hema, format('select public.approval_delegate(%L, %L, %L)', alice, today, today + 3));
  if pg_temp.dl_in_queue(alice, a3) then raise exception 'DELEGATION FAIL: a delegate passed the approvals on'; end if;
  perform pg_temp.dl_val(mark, format('select public.approval_delegation_cancel(%L)', d3));
  perform pg_temp.dl_val(mark, format('select public.approval_delegate(%L, %L, %L)', dan, today, today + 3));
  -- Dan is no admin and not on Priya's one-day request: he reads it only as
  -- Mark's delegate.
  perform pg_temp.dl_val(dan, format('select count(*) from public.leave_approval_detail(%L)', a3));
  a4 := pg_temp.dl_leave(priya, mon + 21, mon + 25);  -- five days: Mark, then Dan
  perform pg_temp.dl_refused('somebody signing another level cannot sign this one too', dan,
    format('select public.approval_decide(%L, ''approved'')', a4), 'ALREADY_SIGNING');
  perform pg_temp.dl_ok('approvals are never passed on again, and nobody signs twice');

  -- ── 6 · never one's own request
  update public.profiles set manager_id = mark where id = nomgr;
  insert into public.user_roles (organization_id, user_id, role) values (acme, nomgr, 'manager');
  insert into public.leave_balances (organization_id, employee_id, leave_type_id, fy_label, entitled_days)
  values (acme, nomgr, '00000000-0000-0000-0000-0000000000c2', public.get_financial_year(acme, mon + 28), 8)
  on conflict do nothing;
  perform pg_temp.dl_val(dan, format('select public.approval_delegation_cancel(%L)', d2));
  update public.approval_delegations set cancelled_at = now() where delegator_id = mark and cancelled_at is null;
  perform pg_temp.dl_val(mark, format('select public.approval_delegate(%L, %L, %L)', nomgr, today, today + 3));
  a5 := pg_temp.dl_leave(nomgr, mon + 28, mon + 28);
  if pg_temp.dl_in_queue(nomgr, a5) then raise exception 'DELEGATION FAIL: a delegate is shown their own request'; end if;
  perform pg_temp.dl_refused('nor can they approve it', nomgr,
    format('select public.approval_decide(%L, ''approved'')', a5), 'SELF_APPROVAL_FORBIDDEN');
  -- A delegate who leaves holds nothing.
  update public.profiles set is_active = false where id = nomgr;
  if public.approval_delegation_active(mark, nomgr, 'leave_request', acme) then
    raise exception 'DELEGATION FAIL: a delegate who left still holds the approvals';
  end if;
  update public.profiles set is_active = true where id = nomgr;
  perform pg_temp.dl_refused('without the delegation, the request is not his to read', dan,
    format('select count(*) from public.leave_approval_detail(%L)', a3), 'FORBIDDEN');
  -- A row naming another company hands nothing over here.
  insert into public.approval_delegations (organization_id, delegator_id, delegate_id, from_date, to_date)
  values ('00000000-0000-0000-0000-0000000000b0', dan, alice, today, today + 1);
  if public.approval_delegation_active(dan, alice, 'leave_request', acme) then
    raise exception 'DELEGATION FAIL: a delegation recorded for another company is in force here';
  end if;
  perform pg_temp.dl_ok('never one''s own request, and nothing for a delegate who has left');

  -- ── 7 · an admin sets one up for somebody; each person sees their own
  update public.approval_delegations set cancelled_at = now() where cancelled_at is null;
  perform pg_temp.dl_val(alice, format('select public.approval_delegate(%L, %L, %L, null, ''Off sick'', %L)', hema, today, today + 2, mark));
  if pg_temp.dl_val(mark, 'select string_agg(direction, '','') from public.approval_my_delegations()') <> 'given'
     or pg_temp.dl_val(hema, 'select string_agg(direction, '','') from public.approval_my_delegations()') <> 'received'
     or pg_temp.dl_val(ravi, 'select count(*) from public.approval_my_delegations()') <> '0' then
    raise exception 'DELEGATION FAIL: each person does not see exactly their own';
  end if;
  if pg_temp.dl_val(mark, format('select count(*) from public.approval_delegate_candidates() where id in (%L, %L, %L)', mark, priya, bob)) <> '0' then
    raise exception 'DELEGATION FAIL: the candidates include yourself, an employee or another company';
  end if;
  perform pg_temp.dl_refused('nobody signed in reads the table', mark,
    'select count(*) from public.approval_delegations', 'permission denied');
  perform pg_temp.dl_ok('a company admin sets one up for somebody; each person sees their own');
end $$;

rollback;
