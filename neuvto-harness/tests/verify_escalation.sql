-- NEUVTO WOS — a request that waits past its target moves up (D87)
--
-- Raises on the first violation. Silence means pass. Rolled back.
--
-- PHASE-AWARE: exits quietly if approval_escalations does not exist yet.
--
-- A request waiting past its level's target moves to the approver's manager,
-- else the module's admin, else a company admin; never to the requester,
-- never to somebody already signing it, never to somebody who cannot approve
-- or belongs to another company; nothing is ever decided by waiting; when
-- nobody qualifies the administrators are told; the clock restarts after each
-- move; the old and new approvers are both told; the new one can decide and
-- the old one no longer can.

begin;

create or replace function pg_temp.es_as(_uid uuid) returns void as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', _uid::text, 'role', 'authenticated')::text, true);
end $$ language plpgsql;

create or replace function pg_temp.es_root() returns void as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$ language plpgsql;

create or replace function pg_temp.es_ok(_label text) returns void as $$
begin raise notice 'ok: %', _label; end $$ language plpgsql;

create or replace function pg_temp.es_submit(_uid uuid, _type uuid, _from date, _to date) returns uuid as $$
declare v uuid;
begin
  perform pg_temp.es_as(_uid);
  v := public.leave_submit(_type, _from, _to, null);
  perform pg_temp.es_root();
  return (select approval_request_id from public.leave_requests where id = v);
exception when others then
  perform pg_temp.es_root();
  raise exception 'ESCALATION FAIL: submit refused: %', sqlerrm;
end $$ language plpgsql;

/** Make a request look as if it has waited _days at its level. */
create or replace function pg_temp.es_age(_approval uuid, _days int) returns void as $$
begin
  update public.approval_requests set created_at = now() - make_interval(days => _days)
   where id = _approval;
  update public.approval_escalations set escalated_at = escalated_at - make_interval(days => _days)
   where approval_request_id = _approval;
end $$ language plpgsql;

create or replace function pg_temp.es_approver(_approval uuid) returns uuid as $$
  select s.approver_id from public.approval_steps s
    join public.approval_requests r on r.id = s.approval_request_id and s.level = r.current_level
   where r.id = _approval
$$ language sql;

create or replace function pg_temp.es_monday(_days int) returns date as $$
  select (date_trunc('week', current_date + _days) + interval '7 days')::date
$$ language sql;

do $$
declare
  acme   uuid := '00000000-0000-0000-0000-0000000000a0';
  globex uuid := '00000000-0000-0000-0000-0000000000b0';
  alice  uuid := '00000000-0000-0000-0000-00000000a001';  -- org_admin
  hema   uuid := '00000000-0000-0000-0000-00000000a002';  -- hr_admin
  dan    uuid := '00000000-0000-0000-0000-00000000a003';  -- Mark's manager
  mark   uuid := '00000000-0000-0000-0000-00000000a004';  -- Ravi's manager
  ravi   uuid := '00000000-0000-0000-0000-00000000a005';
  priya  uuid := '00000000-0000-0000-0000-00000000a006';
  nomgr  uuid := '00000000-0000-0000-0000-00000000a008';  -- an employee, no approver role
  casual uuid := '00000000-0000-0000-0000-0000000000c1';
  sick   uuid := '00000000-0000-0000-0000-0000000000c2';
  mon    date := pg_temp.es_monday(28);
  a1 uuid; a2 uuid; a3 uuid; a4 uuid;
  n  integer;
  v  text;
  rec record;
begin
  if to_regclass('public.approval_escalations') is null then
    raise notice 'skip: escalation does not exist yet';
    return;
  end if;
  delete from public.module_admins;

  if not exists (select 1 from cron.job where jobname = 'neuvto-escalate-approvals' and active) then
    raise exception 'ESCALATION FAIL: the sweep is not scheduled';
  end if;
  perform pg_temp.es_ok('the sweep is scheduled');

  -- ── 1 · not yet due: nothing moves
  a1 := pg_temp.es_submit(ravi, casual, mon, mon + 2);          -- level 1 only: Mark
  perform pg_temp.es_age(a1, 1);                                 -- target is 2 days
  perform public.approval_escalate_due();
  if pg_temp.es_approver(a1) <> mark or exists (select 1 from public.approval_escalations where approval_request_id = a1) then
    raise exception 'ESCALATION FAIL: a request inside its target moved';
  end if;
  perform pg_temp.es_ok('a request inside its target stays where it is');

  -- ── 2 · due: it moves to the approver's manager, and both are told
  perform pg_temp.es_age(a1, 3);
  perform public.approval_escalate_due();
  if pg_temp.es_approver(a1) <> dan then
    raise exception 'ESCALATION FAIL: it went to % instead of Mark''s manager', pg_temp.es_approver(a1);
  end if;
  select * into rec from public.approval_escalations where approval_request_id = a1;
  if rec.from_approver_id <> mark or rec.to_approver_id <> dan or rec.waited_days <> 3 then
    raise exception 'ESCALATION FAIL: the record says % → % after %', rec.from_approver_id, rec.to_approver_id, rec.waited_days;
  end if;
  if (select status from public.approval_requests where id = a1) <> 'pending' then
    raise exception 'ESCALATION FAIL: waiting decided the request';
  end if;
  select count(distinct recipient_id) into n from public.notifications
   where event_key = 'approval.escalated' and recipient_id in (mark, dan)
     and payload->>'approval_request_id' = a1::text;
  if n <> 2 then raise exception 'ESCALATION FAIL: % of the two approvers were told', n; end if;
  select subject into v from public.notifications
   where event_key = 'approval.escalated' and recipient_id = dan and payload->>'approval_request_id' = a1::text;
  if v not ilike '%moved to Dan Director%' then
    raise exception 'ESCALATION FAIL: the email reads "%"', v;
  end if;
  perform pg_temp.es_ok('past its target it moves to the approver''s manager, still pending, and both are told');

  -- ── 3 · the new approver has it; the old one no longer does
  perform pg_temp.es_as(mark);
  select count(*) into n from public.approval_queue() where approval_request_id = a1;
  perform pg_temp.es_root();
  if n <> 0 then raise exception 'ESCALATION FAIL: it is still in the old approver''s queue'; end if;
  perform pg_temp.es_as(dan);
  select * into rec from public.approval_queue() where approval_request_id = a1;
  perform pg_temp.es_root();
  if rec.escalated_from is distinct from 'Mark Manager' then
    raise exception 'ESCALATION FAIL: the new approver''s queue says it came from %', rec.escalated_from;
  end if;
  if rec.level_since < now() - interval '1 minute' then
    raise exception 'ESCALATION FAIL: the clock did not restart (%)', rec.level_since;
  end if;
  v := null;
  begin
    perform pg_temp.es_as(mark);
    perform public.approval_decide(a1, 'approved', null, null);
  exception when others then v := sqlerrm;
  end;
  perform pg_temp.es_root();
  if coalesce(v, '') not ilike '%NOT_YOUR_APPROVAL%' then
    raise exception 'ESCALATION FAIL: the old approver could still decide (%)', v;
  end if;
  perform pg_temp.es_as(ravi);
  select * into rec from public.approval_timeline(a1) where level = 1;
  perform pg_temp.es_root();
  if rec.approver_name <> 'Dan Director' or rec.escalated_from is distinct from 'Mark Manager' or rec.escalated_at is null then
    raise exception 'ESCALATION FAIL: the history reads % from %', rec.approver_name, rec.escalated_from;
  end if;
  perform pg_temp.es_ok('the queue and the history say where it came from, and only the new approver can decide');

  -- ── 4 · the clock restarts: running again moves nothing
  perform public.approval_escalate_due();
  select count(*) into n from public.approval_escalations where approval_request_id = a1;
  if n <> 1 then raise exception 'ESCALATION FAIL: it moved again at once (% moves)', n; end if;
  perform pg_temp.es_ok('each move restarts the clock');

  perform pg_temp.es_as(dan);
  perform public.approval_decide(a1, 'approved', null, null);
  perform pg_temp.es_root();
  if (select status from public.approval_requests where id = a1) <> 'approved' then
    raise exception 'ESCALATION FAIL: the new approver''s decision did not count';
  end if;
  perform pg_temp.es_ok('the new approver decides it');

  -- ── 5 · the manager is already signing: the module's admin, if they can approve
  a2 := pg_temp.es_submit(ravi, sick, mon + 7, mon + 11);       -- five days: Mark, then Dan
  insert into public.module_admins (organization_id, user_id, module_key) values (acme, nomgr, 'leave');
  perform pg_temp.es_age(a2, 3);
  perform public.approval_escalate_due();
  if pg_temp.es_approver(a2) <> alice then
    raise exception 'ESCALATION FAIL: with the manager already signing and the Leave Admin unable to approve, it went to %', pg_temp.es_approver(a2);
  end if;
  perform pg_temp.es_ok('nobody signs twice, an employee who cannot approve is passed over, and a company admin takes it');

  insert into public.user_roles (organization_id, user_id, role) values (acme, nomgr, 'manager');
  update public.approval_steps set approver_id = mark where approval_request_id = a2 and level = 1;
  delete from public.approval_escalations where approval_request_id = a2;
  perform pg_temp.es_age(a2, 3);
  perform public.approval_escalate_due();
  if pg_temp.es_approver(a2) <> nomgr then
    raise exception 'ESCALATION FAIL: a Leave Admin who can approve was passed over for %', pg_temp.es_approver(a2);
  end if;
  perform pg_temp.es_ok('the module''s admin comes before the company''s');
  delete from public.user_roles where user_id = nomgr and role = 'manager';
  delete from public.module_admins;

  -- ── 6 · nobody qualifies: nothing moves, the administrators are told
  update public.profiles set manager_id = mark where id = alice;
  -- Mark's manager is somebody in another company; the Leave Admin has left.
  update public.profiles set manager_id = '00000000-0000-0000-0000-00000000b001' where id = mark;
  update public.profiles set is_active = false where id = dan;
  insert into public.module_admins (organization_id, user_id, module_key) values (acme, dan, 'leave');
  -- An approver who administers a different module is not this module's admin.
  insert into public.user_roles (organization_id, user_id, role) values (acme, priya, 'manager');
  insert into public.module_admins (organization_id, user_id, module_key) values (acme, priya, 'employee');
  update public.user_roles set deleted_at = now() where user_id = hema and organization_id = acme;
  -- Another company's admin role and another company's module-admin row
  -- make nobody eligible here.
  insert into public.user_roles (organization_id, user_id, role) values (globex, nomgr, 'org_admin');
  insert into public.module_admins (organization_id, user_id, module_key) values (globex, nomgr, 'leave');
  a3 := pg_temp.es_submit(alice, casual, mon + 14, mon + 16);   -- the admin asks; Mark approves
  perform pg_temp.es_age(a3, 3);
  perform public.approval_escalate_due();
  if pg_temp.es_approver(a3) <> mark then
    raise exception 'ESCALATION FAIL: with nobody eligible it moved to %', pg_temp.es_approver(a3);
  end if;
  select * into rec from public.approval_escalations where approval_request_id = a3;
  if rec.id is null or rec.to_approver_id is not null then
    raise exception 'ESCALATION FAIL: the stuck request was not recorded as stuck';
  end if;
  if not exists (select 1 from public.notifications
                  where event_key = 'approval.escalation_stuck' and recipient_id = alice
                    and payload->>'approval_request_id' = a3::text) then
    raise exception 'ESCALATION FAIL: the administrators were not told it is stuck';
  end if;
  if (select status from public.approval_requests where id = a3) <> 'pending' then
    raise exception 'ESCALATION FAIL: a stuck request was decided';
  end if;
  perform pg_temp.es_ok('never to the requester, anybody who has left, nor anybody from another company; stuck, it stays and the admins are told');

  perform public.approval_escalate_due();
  select count(*) into n from public.approval_escalations where approval_request_id = a3;
  if n <> 1 then raise exception 'ESCALATION FAIL: a stuck request is reported every sweep (%)', n; end if;
  perform pg_temp.es_age(a3, 3);
  perform public.approval_escalate_due();
  select count(*) into n from public.approval_escalations where approval_request_id = a3;
  if n <> 2 then raise exception 'ESCALATION FAIL: a stuck request is not asked about again after another target (%)', n; end if;
  perform pg_temp.es_ok('a stuck request is asked about again after another full target, not every sweep');

  -- ── 7 · a level without a target never moves
  update public.approval_chains set escalate_after_days = null
   where organization_id = acme and entity_type = 'leave_request' and level = 1;
  a4 := pg_temp.es_submit(priya, casual, mon + 21, mon + 21);
  perform pg_temp.es_age(a4, 30);
  perform public.approval_escalate_due();
  if exists (select 1 from public.approval_escalations where approval_request_id = a4) then
    raise exception 'ESCALATION FAIL: a level with no target moved';
  end if;
  perform pg_temp.es_ok('a level with no target never moves');

  -- ── 8 · nobody signed in can see the record or run the sweep
  v := null;
  begin
    perform pg_temp.es_as(alice);
    perform count(*) from public.approval_escalations;
  exception when others then v := sqlerrm;
  end;
  perform pg_temp.es_root();
  if v is null then raise exception 'ESCALATION FAIL: the escalation record is readable directly'; end if;
  v := null;
  begin
    perform pg_temp.es_as(alice);
    perform public.approval_escalate_due();
  exception when others then v := sqlerrm;
  end;
  perform pg_temp.es_root();
  if v is null then raise exception 'ESCALATION FAIL: a signed-in person can run the sweep'; end if;
  perform pg_temp.es_ok('the record and the sweep are out of reach of anybody signed in');
end $$;

rollback;
