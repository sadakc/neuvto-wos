-- NEUVTO WOS — who is told of what, set by the company (D93)
--
-- Raises on the first violation. Silence means pass. Rolled back.
--
-- PHASE-AWARE: exits quietly if notification_rules does not exist yet.
--
-- The module's admin sees every event against every audience, the engine's
-- own rules locked on; switches the rest on and off; names people to be told
-- as well, for one department or all. Copies have their own "for your
-- information" wording, reach nobody the event already reaches, and follow
-- only this company's settings.

begin;

create or replace function pg_temp.nr_as(_uid uuid) returns void as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', _uid::text, 'role', 'authenticated')::text, true);
end $$ language plpgsql;

create or replace function pg_temp.nr_root() returns void as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$ language plpgsql;

create or replace function pg_temp.nr_ok(_label text) returns void as $$
begin raise notice 'ok: %', _label; end $$ language plpgsql;

create or replace function pg_temp.nr_refused(_label text, _uid uuid, _sql text, _needle text)
returns void as $$
declare v_msg text;
begin
  perform pg_temp.nr_as(_uid);
  begin
    execute _sql;
  exception when others then
    v_msg := sqlerrm;
  end;
  perform pg_temp.nr_root();
  if v_msg is null then
    raise exception 'NOTIFY RULES FAIL: % — it was allowed', _label;
  end if;
  if v_msg not ilike '%' || _needle || '%' then
    raise exception 'NOTIFY RULES FAIL: % — refused for the wrong reason: %', _label, v_msg;
  end if;
  perform pg_temp.nr_ok(_label);
end $$ language plpgsql;

create or replace function pg_temp.nr_do(_uid uuid, _sql text) returns text as $$
declare v text;
begin
  perform pg_temp.nr_as(_uid);
  execute _sql into v;
  perform pg_temp.nr_root();
  return v;
exception when others then
  perform pg_temp.nr_root();
  raise exception 'NOTIFY RULES FAIL: refused: % — %', _sql, sqlerrm;
end $$ language plpgsql;

create or replace function pg_temp.nr_leave(_uid uuid, _from date) returns uuid as $$
declare v uuid;
begin
  perform pg_temp.nr_as(_uid);
  v := public.leave_submit('00000000-0000-0000-0000-0000000000c2', _from, _from, null);
  perform pg_temp.nr_root();
  return (select approval_request_id from public.leave_requests where id = v);
exception when others then
  perform pg_temp.nr_root();
  raise exception 'NOTIFY RULES FAIL: leave refused: %', sqlerrm;
end $$ language plpgsql;

create or replace function pg_temp.nr_told(_uid uuid, _event text, _ar uuid) returns boolean as $$
  select exists (select 1 from public.notifications
                  where recipient_id = _uid and event_key = _event
                    and payload ->> 'approval_request_id' = _ar::text)
$$ language sql;

do $$
declare
  acme   uuid := '00000000-0000-0000-0000-0000000000a0';
  globex uuid := '00000000-0000-0000-0000-0000000000b0';
  alice  uuid := '00000000-0000-0000-0000-00000000a001';
  hema   uuid := '00000000-0000-0000-0000-00000000a002';
  dan    uuid := '00000000-0000-0000-0000-00000000a003';
  mark   uuid := '00000000-0000-0000-0000-00000000a004';  -- Ravi's approver, and a Leave Admin below
  ravi   uuid := '00000000-0000-0000-0000-00000000a005';
  priya  uuid := '00000000-0000-0000-0000-00000000a006';
  bob    uuid := '00000000-0000-0000-0000-00000000b001';
  ops    uuid := '00000000-0000-0000-0000-0000000000d1';  -- Ravi's department
  admin_dept uuid := '00000000-0000-0000-0000-0000000000d2';
  other_dept uuid := '00000000-0000-0000-0000-0000000000d3';  -- another company's
  mon    date := (date_trunc('week', current_date + 14) + interval '7 days')::date;
  a1 uuid; a2 uuid; a3 uuid; c_hema uuid;
  n integer;
  v text;
begin
  if to_regclass('public.notification_rules') is null then
    raise notice 'skip: notification rules do not exist yet';
    return;
  end if;
  delete from public.module_admins;
  insert into public.module_admins (organization_id, user_id, module_key) values
    (acme, mark, 'leave'), (acme, alice, 'leave'), (acme, dan, 'employee');
  update public.leave_balances set entitled_days = 20
   where employee_id = ravi and leave_type_id = '00000000-0000-0000-0000-0000000000c2';

  -- ── 1 · the matrix, the engine's rules locked on
  perform pg_temp.nr_as(mark);
  select count(*) into n from public.notification_matrix('leave') where entity_type = 'leave_request';
  perform pg_temp.nr_root();
  if n <> 11 then raise exception 'NOTIFY RULES FAIL: the leave request matrix has % cells, not 11', n; end if;
  perform pg_temp.nr_as(mark);
  select string_agg(event_key || ':' || audience, ',' order by event_key, audience) into v
    from public.notification_matrix('leave') where entity_type = 'leave_request' and mandatory and enabled;
  perform pg_temp.nr_root();
  if v is distinct from 'approval.completed:requester,approval.escalated:approver,approval.submitted:approver' then
    raise exception 'NOTIFY RULES FAIL: the locked cells are %', v;
  end if;
  perform pg_temp.nr_refused('an employee cannot see the matrix', ravi,
    'select * from public.notification_matrix(''leave'')', 'FORBIDDEN');
  perform pg_temp.nr_refused('nor the Employee Admin, Leave''s', dan,
    'select * from public.notification_matrix(''leave'')', 'FORBIDDEN');
  perform pg_temp.nr_refused('a locked cell cannot be switched off', mark,
    'select public.notification_rule_set(''leave_request'', ''approval.submitted'', ''approver'', false)', 'MANDATORY_NOTIFICATION');
  perform pg_temp.nr_refused('nor the outcome to the person who asked', mark,
    'select public.notification_rule_set(''leave_request'', ''approval.completed'', ''requester'', false)', 'MANDATORY_NOTIFICATION');
  perform pg_temp.nr_refused('an employee cannot switch one on', ravi,
    'select public.notification_rule_set(''leave_request'', ''approval.submitted'', ''module_admins'', true)', 'FORBIDDEN');
  perform pg_temp.nr_ok('the module''s admin sees every event and audience, the engine''s own rules locked on');

  -- ── 2 · off by default; another company's settings change nothing here
  insert into public.notification_rules (organization_id, entity_type, event_key, audience, enabled)
  values (globex, 'leave_request', 'approval.submitted', 'requester', true);
  a1 := pg_temp.nr_leave(ravi, mon);
  if not pg_temp.nr_told(mark, 'approval.submitted', a1) then raise exception 'NOTIFY RULES FAIL: the approver was not told'; end if;
  select count(*) into n from public.notifications where event_key like '%\_fyi' and payload ->> 'approval_request_id' = a1::text;
  if n <> 0 then raise exception 'NOTIFY RULES FAIL: % copies were sent with nothing switched on', n; end if;
  perform pg_temp.nr_ok('nothing extra is sent until switched on, and another company''s settings do nothing here');

  -- ── 3 · switched on: copies, in their own words, never to somebody already told
  perform pg_temp.nr_do(mark, 'select public.notification_rule_set(''leave_request'', ''approval.submitted'', ''module_admins'', true)::text');
  perform pg_temp.nr_do(mark, 'select public.notification_rule_set(''leave_request'', ''approval.submitted'', ''requester'', true)::text');
  perform pg_temp.nr_do(mark, 'select public.notification_rule_set(''leave_request'', ''approval.submitted'', ''requester_manager'', true)::text');
  a2 := pg_temp.nr_leave(ravi, mon + 1);
  if not pg_temp.nr_told(alice, 'approval.submitted_fyi', a2) then raise exception 'NOTIFY RULES FAIL: the Leave Admin got no copy'; end if;
  if not pg_temp.nr_told(ravi, 'approval.submitted_fyi', a2) then raise exception 'NOTIFY RULES FAIL: the person who asked got no acknowledgement'; end if;
  if pg_temp.nr_told(mark, 'approval.submitted_fyi', a2) then
    raise exception 'NOTIFY RULES FAIL: the approver (also manager and Leave Admin) got a copy as well as the request';
  end if;
  select subject into v from public.notifications
   where recipient_id = alice and event_key = 'approval.submitted_fyi' and payload ->> 'approval_request_id' = a2::text;
  if v not ilike 'For your information:%' or v not ilike '%' || (select full_name from public.profiles where id = ravi) || '%' or v ilike '%needs your approval%' then
    raise exception 'NOTIFY RULES FAIL: the copy reads "%"', v;
  end if;
  perform pg_temp.nr_do(mark, 'select public.notification_rule_set(''leave_request'', ''approval.submitted'', ''requester'', false)::text');
  a3 := pg_temp.nr_leave(ravi, mon + 2);
  if pg_temp.nr_told(ravi, 'approval.submitted_fyi', a3) then raise exception 'NOTIFY RULES FAIL: a rule switched off still sends'; end if;
  perform pg_temp.nr_ok('switched on, copies go in their own words to nobody already told; switched off, they stop');

  -- ── 4 · named people, for a department or all
  c_hema := pg_temp.nr_do(mark, format('select public.notification_custom_add(''leave_request'', ''approval.completed'', %L, %L)', hema, ops))::uuid;
  perform pg_temp.nr_do(mark, format('select public.notification_custom_add(''leave_request'', ''approval.completed'', %L, %L)', dan, admin_dept));
  perform pg_temp.nr_refused('the same person twice for the same thing', mark,
    format('select public.notification_custom_add(''leave_request'', ''approval.completed'', %L, %L)', hema, ops), 'ALREADY_TOLD');
  perform pg_temp.nr_refused('nobody from another company', mark,
    format('select public.notification_custom_add(''leave_request'', ''approval.completed'', %L)', bob), 'NOT_FOUND');
  perform pg_temp.nr_refused('nor another company''s department', mark,
    format('select public.notification_custom_add(''leave_request'', ''approval.completed'', %L, %L)', priya, other_dept), 'NOT_FOUND');
  perform pg_temp.nr_refused('an employee cannot name anybody', ravi,
    format('select public.notification_custom_add(''leave_request'', ''approval.completed'', %L)', ravi), 'FORBIDDEN');
  perform pg_temp.nr_do(mark, format('select public.approval_decide(%L, ''approved'')::text', a1));
  if not pg_temp.nr_told(hema, 'approval.completed_fyi', a1) then
    raise exception 'NOTIFY RULES FAIL: somebody named for Ravi''s department was not told';
  end if;
  if pg_temp.nr_told(dan, 'approval.completed_fyi', a1) then
    raise exception 'NOTIFY RULES FAIL: somebody named for another department was told';
  end if;
  if pg_temp.nr_told(ravi, 'approval.completed_fyi', a1) or not pg_temp.nr_told(ravi, 'approval.completed', a1) then
    raise exception 'NOTIFY RULES FAIL: the person who asked got a copy, or not the outcome';
  end if;
  perform pg_temp.nr_refused('an employee cannot remove a name', ravi,
    format('select public.notification_custom_remove(%L)', c_hema), 'NOT_FOUND');
  perform pg_temp.nr_do(mark, format('select public.notification_custom_remove(%L)::text', c_hema));
  perform pg_temp.nr_do(mark, format('select public.notification_custom_add(''leave_request'', ''approval.completed'', %L)', priya));
  perform pg_temp.nr_do(mark, format('select public.approval_decide(%L, ''approved'')::text', a2));
  if pg_temp.nr_told(hema, 'approval.completed_fyi', a2) then raise exception 'NOTIFY RULES FAIL: a removed name was still told'; end if;
  if not pg_temp.nr_told(priya, 'approval.completed_fyi', a2) then raise exception 'NOTIFY RULES FAIL: somebody named for every department was not told'; end if;
  -- Somebody named who has since left is told nothing.
  update public.profiles set is_active = false where id = priya;
  perform pg_temp.nr_do(mark, format('select public.approval_decide(%L, ''approved'')::text', a3));
  if pg_temp.nr_told(priya, 'approval.completed_fyi', a3) then raise exception 'NOTIFY RULES FAIL: somebody who left was told'; end if;
  update public.profiles set is_active = true where id = priya;
  perform pg_temp.nr_as(mark);
  select count(*) into n from public.notification_custom_list('leave');
  perform pg_temp.nr_root();
  if n <> 2 then raise exception 'NOTIFY RULES FAIL: the list holds % names, not 2', n; end if;
  if pg_temp.nr_do(mark, format('select count(*) from public.notification_people(''leave'') where id = %L', bob)) <> '0'
     or pg_temp.nr_do(mark, format('select count(*) from public.notification_people(''leave'') where id = %L', ravi)) <> '1' then
    raise exception 'NOTIFY RULES FAIL: the people offered are wrong';
  end if;
  perform pg_temp.nr_refused('an employee is not offered the people', ravi,
    'select * from public.notification_people(''leave'')', 'FORBIDDEN');
  perform pg_temp.nr_refused('nobody signed in reads the tables', mark,
    'select count(*) from public.notification_rules', 'permission denied');
  perform pg_temp.nr_ok('named people are told for their department or all, and stop once removed');
end $$;

rollback;
