-- NEUVTO WOS — an administrator for each module (D84)
--
-- Raises on the first violation. Silence means pass. Rolled back.
--
-- PHASE-AWARE: exits quietly if member_set_module_admins does not exist yet.
--
-- What is proved: only a Super Admin hands out module administration; a Leave
-- Admin administers Leave and nothing else; an Employee Admin administers the
-- employee record and nothing else; a company-wide Admin keeps both; removing
-- the grant, or deactivating the person, takes it away on the next request.

begin;

create or replace function pg_temp.ma_as(_uid uuid) returns void as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', _uid::text, 'role', 'authenticated')::text, true);
end $$ language plpgsql;

create or replace function pg_temp.ma_root() returns void as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$ language plpgsql;

create or replace function pg_temp.ma_ok(_label text) returns void as $$
begin raise notice 'ok: %', _label; end $$ language plpgsql;

create or replace function pg_temp.ma_refused(_label text, _uid uuid, _sql text, _needle text)
returns void as $$
declare v_msg text;
begin
  perform pg_temp.ma_as(_uid);
  begin
    execute _sql;
  exception when others then
    v_msg := sqlerrm;
  end;
  perform pg_temp.ma_root();
  if v_msg is null then
    raise exception 'MODULE ADMINS FAIL: % — it was allowed', _label;
  end if;
  if v_msg not ilike '%' || _needle || '%' then
    raise exception 'MODULE ADMINS FAIL: % — refused for the wrong reason: %', _label, v_msg;
  end if;
  perform pg_temp.ma_ok(_label);
end $$ language plpgsql;

create or replace function pg_temp.ma_allowed(_label text, _uid uuid, _sql text) returns void as $$
begin
  perform pg_temp.ma_as(_uid);
  begin
    execute _sql;
  exception when others then
    perform pg_temp.ma_root();
    raise exception 'MODULE ADMINS FAIL: % — refused: %', _label, sqlerrm;
  end;
  perform pg_temp.ma_root();
  perform pg_temp.ma_ok(_label);
end $$ language plpgsql;

create or replace function pg_temp.ma_count(_uid uuid, _sql text) returns integer as $$
declare n integer;
begin
  perform pg_temp.ma_as(_uid);
  execute _sql into n;
  perform pg_temp.ma_root();
  return n;
end $$ language plpgsql;

create or replace function pg_temp.ma_bool(_uid uuid, _sql text) returns boolean as $$
declare b boolean;
begin
  perform pg_temp.ma_as(_uid);
  execute _sql into b;
  perform pg_temp.ma_root();
  return b;
end $$ language plpgsql;

do $$
declare
  acme   uuid := '00000000-0000-0000-0000-0000000000a0';
  vertex uuid := '00000000-0000-0000-0000-0000000000b0';
  alice  uuid := '00000000-0000-0000-0000-00000000a001';  -- Super Admin
  hema   uuid := '00000000-0000-0000-0000-00000000a002';  -- hr_admin: company-wide Admin, not Super
  dan    uuid := '00000000-0000-0000-0000-00000000a003';  -- manager; made Employee Admin below
  mark   uuid := '00000000-0000-0000-0000-00000000a004';  -- manager; made Leave Admin below
  ravi   uuid := '00000000-0000-0000-0000-00000000a005';  -- employee
  priya  uuid := '00000000-0000-0000-0000-00000000a006';
  bob    uuid := '00000000-0000-0000-0000-00000000b001';  -- Vertex's admin
  lt     uuid;
  sched  uuid;
  n      integer;
  got    text[];
begin
  if to_regprocedure('public.member_set_module_admins(uuid,text[])') is null then
    raise notice 'skip: module admins do not exist yet';
    return;
  end if;

  insert into public.organization_modules (organization_id, module_key, enabled, enabled_at)
  values (acme, 'employee', true, now())
  on conflict (organization_id, module_key) do update set enabled = true, deleted_at = null;
  update public.organization_modules set enabled = false
   where organization_id = acme and module_key = 'attendance';

  -- ── 1 · who grants
  perform pg_temp.ma_refused('a company-wide Admin who is not Super Admin cannot grant', hema,
    format($q$select public.member_set_module_admins(%L, '{leave}')$q$, mark), 'ROLE_NOT_YOURS_TO_GRANT');
  perform pg_temp.ma_refused('nor an employee', ravi,
    format($q$select public.member_set_module_admins(%L, '{leave}')$q$, mark), 'ROLE_NOT_YOURS_TO_GRANT');
  perform pg_temp.ma_refused('a Super Admin cannot grant themselves', alice,
    format($q$select public.member_set_module_admins(%L, '{leave}')$q$, alice), 'CANNOT_CHANGE_OWN_ROLES');
  perform pg_temp.ma_refused('a module the company has not switched on is refused', alice,
    format($q$select public.member_set_module_admins(%L, '{attendance}')$q$, mark), 'UNKNOWN_MODULE');
  perform pg_temp.ma_refused('a module that does not exist is refused', alice,
    format($q$select public.member_set_module_admins(%L, '{leeve}')$q$, mark), 'UNKNOWN_MODULE');
  perform pg_temp.ma_refused('another company''s person is NOT_FOUND', alice,
    format($q$select public.member_set_module_admins(%L, '{leave}')$q$, bob), 'NOT_FOUND');
  perform pg_temp.ma_refused('nobody signed in writes the table directly', alice,
    format($q$insert into public.module_admins (organization_id, user_id, module_key) values (%L, %L, 'leave')$q$,
           acme, mark), 'permission denied');

  perform pg_temp.ma_as(alice);
  got := public.member_set_module_admins(mark, array['leave', 'leave']);
  perform public.member_set_module_admins(dan, array['employee']);
  perform pg_temp.ma_root();
  if got is distinct from array['leave'] then
    raise exception 'MODULE ADMINS FAIL: the set came back as %', got;
  end if;
  perform pg_temp.ma_ok('a Super Admin makes a Leave Admin and an Employee Admin');

  -- ── 2 · who sees the grants
  if pg_temp.ma_count(mark, 'select count(*) from public.module_admins') <> 1 then
    raise exception 'MODULE ADMINS FAIL: a Leave Admin should see only their own row';
  end if;
  if pg_temp.ma_count(ravi, 'select count(*) from public.module_admins') <> 0 then
    raise exception 'MODULE ADMINS FAIL: an employee sees other people''s grants';
  end if;
  if pg_temp.ma_count(hema, 'select count(*) from public.module_admins') <> 2 then
    raise exception 'MODULE ADMINS FAIL: an Admin should see every grant in the company';
  end if;
  if pg_temp.ma_count(bob, 'select count(*) from public.module_admins') <> 0 then
    raise exception 'MODULE ADMINS FAIL: another company sees Acme''s grants';
  end if;
  perform pg_temp.ma_ok('a person sees their own grants, an Admin sees the company''s, nobody sees another company''s');

  -- ── 3 · the Leave Admin administers Leave and nothing else
  perform pg_temp.ma_allowed('a Leave Admin reads every balance', mark, 'select count(*) from public.leave_all_balances()');
  perform pg_temp.ma_allowed('and the leave-taken report', mark,
    'select count(*) from public.leave_taken_report(current_date - 30, current_date)');
  perform pg_temp.ma_allowed('and the pending report', mark, 'select count(*) from public.leave_pending_report()');
  perform pg_temp.ma_as(mark);
  insert into public.leave_types (organization_id, name, max_days_per_year)
  values (acme, 'Study leave', 5) returning id into lt;
  update public.leave_types set max_days_per_year = 6 where id = lt;
  perform pg_temp.ma_root();
  if (select max_days_per_year from public.leave_types where id = lt) is distinct from 6::numeric then
    raise exception 'MODULE ADMINS FAIL: the Leave Admin''s leave-type edit did not land';
  end if;
  perform pg_temp.ma_ok('a Leave Admin adds and edits leave types');
  -- Somebody outside Mark's team has a request, so "every" is a real claim.
  insert into public.leave_requests (organization_id, employee_id, leave_type_id, from_date, to_date, working_days, status)
  select acme, '00000000-0000-0000-0000-00000000a008', id, current_date + 40, current_date + 40, 1, 'approved'
    from public.leave_types where organization_id = acme and id <> lt limit 1;
  select count(*) into n from public.leave_requests where organization_id = acme and deleted_at is null;
  if pg_temp.ma_count(mark, 'select count(*) from public.leave_requests') is distinct from n then
    raise exception 'MODULE ADMINS FAIL: a Leave Admin cannot read every request in the company';
  end if;
  if pg_temp.ma_count(dan, 'select count(*) from public.leave_requests') >= n then
    raise exception 'MODULE ADMINS FAIL: an Employee Admin reads every leave request';
  end if;
  perform pg_temp.ma_ok('a Leave Admin reads every leave request in the company');

  -- The approval history of a request Mark neither made nor approves: No
  -- Manager's, who reports to nobody. Reachable only as the Leave Admin.
  if to_regclass('public.approval_entity_labels') is not null
     and exists (select 1 from information_schema.columns
                  where table_name = 'approval_entity_labels' and column_name = 'module_key') then
    insert into public.approval_requests (organization_id, entity_type, entity_id, requester_id, current_level, required_levels)
    values (acme, 'leave_request', gen_random_uuid(), '00000000-0000-0000-0000-00000000a008', 1, 1)
    returning id into lt;
    perform pg_temp.ma_allowed('a Leave Admin reads any leave request''s approval history', mark,
      format('select count(*) from public.approval_timeline(%L)', lt));
    perform pg_temp.ma_refused('an Employee Admin does not', dan,
      format('select count(*) from public.approval_timeline(%L)', lt), 'FORBIDDEN');
    perform pg_temp.ma_refused('nor a colleague', ravi,
      format('select count(*) from public.approval_timeline(%L)', lt), 'FORBIDDEN');
  end if;

  perform pg_temp.ma_as(mark);
  sched := public.report_schedule_save('leave.summary', 'weekly', array['mark@acme.test'], null, 1::smallint);
  perform pg_temp.ma_root();
  perform pg_temp.ma_ok('a Leave Admin schedules a Leave report');

  -- The Reports page lists them with plain selects, so the table grant is load-
  -- bearing: without it the panel fails with 42501 before RLS is consulted.
  perform pg_temp.ma_allowed('and reads the report it can schedule', mark,
    $q$select 1 from public.report_definitions where report_key = 'leave.summary'$q$);
  perform pg_temp.ma_allowed('and reads the schedule back', mark,
    'select 1 from public.report_schedules');
  n := pg_temp.ma_count(mark, format('select count(*) from public.report_schedules where id = %L', sched));
  if n <> 1 then raise exception 'MODULE ADMINS FAIL: a Leave Admin sees % of their own schedule', n; end if;
  -- Recipients are addresses outside the product, the CEO's among them.
  n := pg_temp.ma_count(ravi, 'select count(*) from public.report_schedules');
  if n <> 0 then raise exception 'MODULE ADMINS FAIL: an employee reads % report schedules', n; end if;
  perform pg_temp.ma_ok('an employee reads no schedules');
  n := pg_temp.ma_count(dan, format('select count(*) from public.report_schedules where id = %L', sched));
  if n <> 0 then raise exception 'MODULE ADMINS FAIL: an Employee Admin reads a Leave schedule'; end if;
  perform pg_temp.ma_ok('nor does an Employee Admin read a Leave one');

  insert into public.report_definitions (report_key, module_key, title)
  values ('employee.headcount', 'employee', 'Headcount');
  perform pg_temp.ma_refused('but not another module''s report', mark,
    $q$select public.report_schedule_save('employee.headcount', 'weekly', array['mark@acme.test'], null, 1::smallint)$q$,
    'FORBIDDEN');
  perform pg_temp.ma_as(hema);
  sched := public.report_schedule_save('employee.headcount', 'weekly', array['hema@acme.test'], null, 1::smallint);
  perform pg_temp.ma_root();
  perform pg_temp.ma_refused('nor repoint or remove a schedule of another module''s report', mark,
    format($q$select public.report_schedule_remove(%L)$q$, sched), 'FORBIDDEN');
  perform pg_temp.ma_refused('nor edit one', mark,
    format($q$select public.report_schedule_save('leave.summary', 'weekly', array['mark@acme.test'], %L, 1::smallint)$q$, sched),
    'FORBIDDEN');

  perform pg_temp.ma_refused('a Leave Admin cannot open the employee record as an admin', mark,
    $q$select public.employee_create_draft('{"fullName":"Nisha Rao"}')$q$, 'FORBIDDEN');
  perform pg_temp.ma_refused('nor the Employee Master overview', mark,
    'select public.employee_admin_overview()', 'FORBIDDEN');
  perform pg_temp.ma_refused('nor invite anybody', mark,
    $q$select public.invitation_create('nisha@acme.test', null, 'employee', 'Nisha Rao')$q$, 'FORBIDDEN');
  perform pg_temp.ma_refused('nor change anybody''s roles', mark,
    format($q$select public.member_set_roles(%L, '{employee}')$q$, ravi), 'FORBIDDEN');
  perform pg_temp.ma_refused('nor write department settings', mark,
    format($q$insert into public.departments (organization_id, name) values (%L, 'Stores')$q$, acme),
    'row-level security');

  -- ── 4 · the Employee Admin administers the employee record and nothing else
  perform pg_temp.ma_allowed('an Employee Admin adds a draft', dan,
    $q$select public.employee_create_draft('{"fullName":"Nisha Rao"}')$q$);
  perform pg_temp.ma_allowed('and reads the overview', dan, 'select public.employee_admin_overview()');
  -- D110: an invitation comes from a record. Round it, even the Employee Admin is refused;
  -- marked as employee_send_invite marks it, the role rules below still hold.
  perform pg_temp.ma_refused('and invites only from a record', dan,
    $q$select public.invitation_create('nisha.rao@acme.test', null, 'employee', 'Nisha Rao')$q$,
    'INVITE_FROM_THE_RECORD');
  perform set_config('neuvto.inviting', 'record', true);
  perform pg_temp.ma_allowed('and invites an employee', dan,
    $q$select public.invitation_create('nisha.rao@acme.test', null, 'employee', 'Nisha Rao')$q$);
  perform pg_temp.ma_refused('but cannot invite an administrator', dan,
    $q$select public.invitation_create('boss@acme.test', null, 'hr_admin', 'A Boss')$q$, 'ROLE_NOT_YOURS_TO_GRANT');
  perform set_config('neuvto.inviting', '', true);
  perform pg_temp.ma_refused('nor read the Leave reports', dan,
    'select count(*) from public.leave_all_balances()', 'FORBIDDEN');
  perform pg_temp.ma_refused('nor set an opening balance', dan,
    format($q$select public.leave_set_opening_balance(%L, %L, 1, 0)$q$, ravi,
           (select id from public.leave_types where organization_id = acme limit 1)), 'FORBIDDEN');
  perform pg_temp.ma_refused('nor add a leave type', dan,
    format($q$insert into public.leave_types (organization_id, name) values (%L, 'Dan''s leave')$q$, acme),
    'row-level security');
  perform pg_temp.ma_refused('nor grant module administration', dan,
    format($q$select public.member_set_module_admins(%L, '{employee}')$q$, ravi), 'ROLE_NOT_YOURS_TO_GRANT');

  -- ── 5 · a company-wide Admin keeps every module, with no row
  perform pg_temp.ma_allowed('a company-wide Admin still reads Leave reports', hema,
    'select count(*) from public.leave_all_balances()');
  perform pg_temp.ma_allowed('and the Employee Master overview', hema, 'select public.employee_admin_overview()');
  if not pg_temp.ma_bool(hema, $q$select public.is_module_admin('leave') and public.is_module_admin('employee')$q$) then
    raise exception 'MODULE ADMINS FAIL: a company-wide Admin is not every module''s admin';
  end if;
  perform pg_temp.ma_ok('a company-wide Admin administers every module without a grant');

  -- ── 6 · a sensitive grant gets the short session. Ravi holds only
  --    `employee`, so the grant is the only thing that can shorten it.
  if pg_temp.ma_count(ravi, 'select idle_minutes from public.session_policy()') < 480 then
    raise exception 'MODULE ADMINS FAIL: the control is wrong: an employee already has a short session';
  end if;
  perform pg_temp.ma_as(alice);
  perform public.member_set_module_admins(ravi, '{employee}');
  perform pg_temp.ma_root();
  if pg_temp.ma_count(ravi, 'select idle_minutes from public.session_policy()') >= 480 then
    raise exception 'MODULE ADMINS FAIL: an Employee Admin has an employee''s long idle session';
  end if;
  perform pg_temp.ma_as(alice);
  perform public.member_set_module_admins(ravi, '{}');
  perform pg_temp.ma_root();
  perform pg_temp.ma_ok('a module admin gets the administrator''s idle timeout');

  -- A row naming another company grants nothing here. No function writes one;
  -- this is the check that would stop it if something ever did.
  insert into public.module_admins (organization_id, user_id, module_key) values (vertex, ravi, 'leave');
  perform pg_temp.ma_refused('a grant in another company administers nothing in this one', ravi,
    'select count(*) from public.leave_all_balances()', 'FORBIDDEN');

  -- ── 7 · taking it away
  perform pg_temp.ma_as(alice);
  perform public.member_set_module_admins(mark, '{}');
  perform pg_temp.ma_root();
  perform pg_temp.ma_refused('removed: the former Leave Admin is refused on the next request', mark,
    'select count(*) from public.leave_all_balances()', 'FORBIDDEN');
  perform pg_temp.ma_as(alice);
  perform public.member_set_module_admins(mark, '{leave}');
  perform pg_temp.ma_root();
  select count(*) into n from public.module_admins where user_id = mark and module_key = 'leave';
  if n <> 1 then raise exception 'MODULE ADMINS FAIL: restoring a grant made % rows', n; end if;
  perform pg_temp.ma_allowed('restored: one row, and it works again', mark,
    'select count(*) from public.leave_all_balances()');

  update public.profiles set is_active = false where id = dan;
  perform pg_temp.ma_refused('a deactivated Employee Admin administers nothing', dan,
    'select public.employee_admin_overview()', 'NOT_AUTHENTICATED');

  -- A module switched off keeps its admins, who reach nothing until it is back.
  update public.organization_modules set enabled = false where organization_id = acme and module_key = 'leave';
  perform pg_temp.ma_refused('module off: the Leave Admin is refused', mark,
    'select count(*) from public.leave_all_balances()', 'MODULE_NOT_ENABLED');
  perform pg_temp.ma_allowed('and a Super Admin can still remove the grant', alice,
    format($q$select public.member_set_module_admins(%L, '{}')$q$, mark));
end $$;

rollback;
