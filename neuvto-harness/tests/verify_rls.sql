-- NEUVTO WOS — RLS verification
--
-- Raises an exception on the first violation. Silence means pass.
-- Run after every build step, against every environment.
--
-- PHASE-AWARE: blocks guard themselves on whether their table exists, so this
-- runs usefully from Phase 0 onward rather than only against a finished schema.
--
-- Requires seed_test_data.sql to have run first — tenant isolation is not
-- testable with a single organisation.

create or replace function pg_temp.as_user(_uid uuid) returns void as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', _uid::text, 'role', 'authenticated')::text, true);
end $$ language plpgsql;

create or replace function pg_temp.as_postgres() returns void as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$ language plpgsql;

create or replace function pg_temp.check(_label text, _actual bigint, _expected bigint)
returns void as $$
begin
  if _actual is distinct from _expected then
    raise exception 'RLS FAIL: % — expected %, got %', _label, _expected, _actual;
  end if;
  raise notice 'ok: %', _label;
end $$ language plpgsql;

do $$
declare
  acme    uuid := '00000000-0000-0000-0000-0000000000a0';
  vertex  uuid := '00000000-0000-0000-0000-0000000000b0';
  ravi    uuid := '00000000-0000-0000-0000-00000000a005';
  mark    uuid := '00000000-0000-0000-0000-00000000a004';
  dan     uuid := '00000000-0000-0000-0000-00000000a003';   -- Mark's manager
  alice   uuid := '00000000-0000-0000-0000-00000000a001';
  bob     uuid := '00000000-0000-0000-0000-00000000b001';
  sara    uuid := '00000000-0000-0000-0000-00000000b002';   -- reports to Bob, in Vertex
  hema    uuid := '00000000-0000-0000-0000-00000000a002';   -- hr_admin, not org_admin
  ghost   uuid := '00000000-0000-0000-0000-0000000000ff';
  joiner  uuid := '00000000-0000-0000-0000-00000000a007';
  v_text  text;
  v_refused boolean;
  n       bigint;
begin
  ---------------------------------------------------------------- tenant isolation
  perform pg_temp.as_user(alice);
  select count(*) into n from profiles              where organization_id = vertex;
  perform pg_temp.check('acme org_admin sees no vertex profiles', n, 0);
  select count(*) into n from departments           where organization_id = vertex;
  perform pg_temp.check('acme org_admin sees no vertex departments', n, 0);
  select count(*) into n from user_roles            where organization_id = vertex;
  perform pg_temp.check('acme org_admin sees no vertex roles', n, 0);
  select count(*) into n from organizations         where id = vertex;
  perform pg_temp.check('acme org_admin sees no vertex organization', n, 0);
  select count(*) into n from organization_settings where organization_id = vertex;
  perform pg_temp.check('acme org_admin sees no vertex settings', n, 0);

  perform pg_temp.as_user(bob);
  select count(*) into n from profiles where organization_id = acme;
  perform pg_temp.check('vertex org_admin sees no acme profiles', n, 0);

  if to_regclass('public.holidays') is not null then
    perform pg_temp.as_user(alice);
    execute 'select count(*) from holidays where organization_id = $1' into n using vertex;
    perform pg_temp.check('acme org_admin sees no vertex holidays', n, 0);
  end if;

  if to_regclass('public.leave_requests') is not null then
    perform pg_temp.as_user(alice);
    execute 'select count(*) from leave_requests where organization_id = $1' into n using vertex;
    perform pg_temp.check('acme org_admin sees no vertex leave requests', n, 0);
    execute 'select count(*) from leave_balances where organization_id = $1' into n using vertex;
    perform pg_temp.check('acme org_admin sees no vertex balances', n, 0);
  end if;

  ---------------------------------------------------------------- orphan user
  -- Authenticated but has no profile row: must see nothing anywhere.
  perform pg_temp.as_user(ghost);
  select count(*) into n from profiles;      perform pg_temp.check('orphan sees no profiles', n, 0);
  select count(*) into n from organizations; perform pg_temp.check('orphan sees no organizations', n, 0);
  select count(*) into n from user_roles;    perform pg_temp.check('orphan sees no roles', n, 0);
  select count(*) into n from departments;   perform pg_temp.check('orphan sees no departments', n, 0);

  ---------------------------------------------------------------- employee scope
  perform pg_temp.as_user(ravi);
  select count(*) into n from profiles where id <> ravi;
  perform pg_temp.check('employee sees only their own profile', n, 0);
  select count(*) into n from user_roles where user_id <> ravi;
  perform pg_temp.check('employee sees only their own roles', n, 0);

  if to_regclass('public.leave_balances') is not null then
    execute 'select count(*) from leave_balances where employee_id <> $1' into n using ravi;
    perform pg_temp.check('employee sees only own balances', n, 0);
  end if;

  ---------------------------------------------------------------- manager scope
  perform pg_temp.as_user(mark);
  select count(*) into n from profiles
   where id <> mark and id not in (select p.id from profiles p where p.manager_id = mark);
  perform pg_temp.check('manager sees only self and direct reports', n, 0);

  ---------------------------------------------------------------- privilege escalation
  -- The boundary D4 exists to defend. An employee must not be able to promote
  -- themselves, directly or by moving between tenants.
  perform pg_temp.as_user(ravi);
  begin
    insert into user_roles (user_id, organization_id, role) values (ravi, acme, 'org_admin');
    raise exception 'RLS FAIL: employee granted themselves org_admin';
  exception
    when insufficient_privilege then raise notice 'ok: employee cannot self-promote';
  end;

  begin
    update profiles set organization_id = vertex where id = ravi;
    get diagnostics n = row_count;
    perform pg_temp.check('employee cannot move themselves between orgs', n, 0);
  exception
    when insufficient_privilege then raise notice 'ok: employee cannot change own org';
  end;

  -- Nor grant a role to anyone else.
  begin
    insert into user_roles (user_id, organization_id, role) values (mark, acme, 'org_admin');
    raise exception 'RLS FAIL: employee granted a role to another user';
  exception
    when insufficient_privilege then raise notice 'ok: employee cannot grant roles to others';
  end;

  ---------------------------------------------------------------- audit fields (D16)
  -- created_by must not be forgeable: supplying it in the payload must not
  -- override the authenticated user.
  perform pg_temp.as_user(alice);
  insert into departments (organization_id, name, created_by)
  values (acme, 'Forgery Test', bob);          -- claiming Bob authored it

  select count(*) into n from departments where name = 'Forgery Test' and created_by = alice;
  perform pg_temp.check('created_by is the authenticated user, not the supplied one', n, 1);

  select count(*) into n from departments where name = 'Forgery Test' and created_at is null;
  perform pg_temp.check('created_at populated by trigger', n, 0);

  -- created_at must survive an update unchanged.
  update departments set name = 'Forgery Test 2' where name = 'Forgery Test';
  select count(*) into n from departments
   where name = 'Forgery Test 2'
     and (updated_at < created_at or updated_by is distinct from alice);
  perform pg_temp.check('update refreshes updated_* and preserves created_*', n, 0);

  perform pg_temp.as_postgres();
  delete from departments where name = 'Forgery Test 2';

  ---------------------------------------------------------------- soft delete (D17)
  -- The filter must live in the policy. If it lives only in application queries,
  -- this passes here and leaks in production.
  update profiles set deleted_at = now() where id = joiner;

  perform pg_temp.as_user(alice);
  select count(*) into n from profiles where deleted_at is not null;
  perform pg_temp.check('soft-deleted profile invisible to org_admin', n, 0);
  select count(*) into n from profiles where id = joiner;
  perform pg_temp.check('soft-deleted profile not reachable by id', n, 0);

  perform pg_temp.as_postgres();
  update profiles set deleted_at = null where id = joiner;

  ---------------------------------------------------------------- analytics (D25)
  -- Behavioural data about employees is not theirs to browse.
  insert into analytics_events (organization_id, user_id, event)
  values (acme, ravi, 'user.signed_in');

  perform pg_temp.as_user(ravi);
  select count(*) into n from analytics_events;
  perform pg_temp.check('employee cannot read analytics events', n, 0);

  -- Asserted as "at least one", not an exact count: this file inserts an event
  -- each run, so an exact count only holds when it is run immediately after a
  -- re-seed. What matters is who can see them, not how many there are.
  perform pg_temp.as_user(alice);
  select count(*) into n from analytics_events;
  if n < 1 then
    raise exception 'RLS FAIL: org_admin cannot read their own organisation''s analytics events';
  end if;
  raise notice 'ok: org_admin can read own-org analytics events';

  perform pg_temp.as_user(bob);
  select count(*) into n from analytics_events;
  perform pg_temp.check('other tenant cannot read those events', n, 0);

  ---------------------------------------------------------------- calendar tenancy
  -- The calendar functions are SECURITY DEFINER and take an organisation id, so
  -- without a guard any authenticated user could pass another tenant's id and
  -- read back their weekend, holiday and timezone configuration by probing.
  if to_regprocedure('public.calculate_working_days(uuid,date,date)') is not null then
    perform pg_temp.as_user(alice);            -- Acme admin
    begin
      perform public.calculate_working_days(vertex, '2026-08-07', '2026-08-10');
      raise exception 'RLS FAIL: acme could compute working days for vertex';
    exception
      when insufficient_privilege then raise notice 'ok: working days refuse another tenant';
    end;
    begin
      perform public.get_financial_year(vertex, '2026-06-15');
      raise exception 'RLS FAIL: acme could read vertex financial-year configuration';
    exception
      when insufficient_privilege then raise notice 'ok: financial year refuses another tenant';
    end;
    begin
      perform public.org_today(vertex);
      raise exception 'RLS FAIL: acme could read vertex timezone';
    exception
      when insufficient_privilege then raise notice 'ok: org_today refuses another tenant';
    end;

    -- ...and still works for the caller's own organisation.
    if public.calculate_working_days(acme, '2026-08-07', '2026-08-10') <> 2 then
      raise exception 'RLS FAIL: the guard broke the caller''s own organisation';
    end if;
    raise notice 'ok: own-organisation calendar still works';

    perform pg_temp.as_user(ravi);             -- a plain employee
    select count(*) into n from holidays where organization_id = vertex;
    perform pg_temp.check('employee sees no other-tenant holidays', n, 0);
  end if;

  ---------------------------------------------------------------- audit log (Phase 1)
  if to_regclass('public.audit_logs') is not null then
    -- The trigger must actually be writing. An empty table would make every
    -- immutability assertion below pass vacuously.
    perform pg_temp.as_postgres();
    select count(*) into n from audit_logs;
    if n = 0 then
      raise exception 'RLS FAIL: audit_logs is empty — the trigger is not writing, so immutability proves nothing';
    end if;
    raise notice 'ok: audit trail is being written';

    -- Role grants are the privilege boundary; every one must leave a record.
    select count(*) into n from audit_logs where entity_type = 'user_roles' and action = 'user_roles.insert';
    if n = 0 then
      raise exception 'RLS FAIL: granting a role left no audit entry';
    end if;
    raise notice 'ok: role grants are audited';

    -- Before/after captured on update, or the trail records that something
    -- changed without recording what.
    perform pg_temp.as_postgres();
    update profiles set full_name = 'Renamed For Audit' where id = ravi;
    select count(*) into n from audit_logs
     where entity_type = 'profiles' and action = 'profiles.update'
       and before ->> 'full_name' is distinct from after ->> 'full_name';
    if n = 0 then
      raise exception 'RLS FAIL: an update was audited without capturing the before/after change';
    end if;
    raise notice 'ok: updates record what actually changed';

    -- Tenant isolation applies to the trail as much as the data.
    perform pg_temp.as_user(bob);
    select count(*) into n from audit_logs where organization_id = acme;
    perform pg_temp.check('other tenant cannot read acme audit rows', n, 0);

    perform pg_temp.as_user(ravi);
    select count(*) into n from audit_logs;
    perform pg_temp.check('employees cannot read the audit trail at all', n, 0);

    -- Immutability. No UPDATE or DELETE policy exists for any role, so RLS
    -- denies both — including to the organisation's own administrator.
    perform pg_temp.as_user(alice);
    select count(*) into n from audit_logs;
    if n = 0 then
      raise exception 'RLS FAIL: org_admin cannot read their own audit trail';
    end if;
    raise notice 'ok: org_admin can read their own audit trail';

    begin
      update audit_logs set action = 'tampered';
      get diagnostics n = row_count;
      perform pg_temp.check('audit_logs not updatable even by org_admin', n, 0);
    exception
      when insufficient_privilege then raise notice 'ok: audit_logs not updatable';
    end;
    begin
      delete from audit_logs;
      get diagnostics n = row_count;
      perform pg_temp.check('audit_logs not deletable even by org_admin', n, 0);
    exception
      when insufficient_privilege then raise notice 'ok: audit_logs not deletable';
    end;

    -- Nor may anyone forge an entry directly; rows arrive only via the trigger.
    begin
      insert into audit_logs (organization_id, action, entity_type)
      values (acme, 'fake.entry', 'profiles');
      raise exception 'RLS FAIL: an audit entry was forged directly';
    exception
      when insufficient_privilege then raise notice 'ok: audit entries cannot be forged';
    end;
  end if;

  ---------------------------------------------------------------- approval engine (step 4)
  -- Driven with a NON-LEAVE entity type on purpose. The whole claim of this
  -- service is that Attendance and Payroll reuse it unchanged, and the only way
  -- to know that is to exercise it without any leave table in play.
  if to_regprocedure('public.approval_submit(text,uuid,jsonb)') is not null then
    declare
      v_req    uuid;
      v_status text;
      v_raised boolean;
      v_ent    uuid := gen_random_uuid();
    begin
      ---------------------------------------------------------- single level
      -- size = 1, so the level-2 condition (size > 3) does not apply.
      perform pg_temp.as_user(ravi);
      v_req := public.approval_submit('harness_probe', v_ent, '{"size": 1}'::jsonb);

      perform pg_temp.as_postgres();
      select required_levels into n from approval_requests where id = v_req;
      perform pg_temp.check('condition not met means one level only', n, 1);

      select count(*) into n from approval_steps
       where approval_request_id = v_req and approver_id = mark;
      perform pg_temp.check('level 1 resolved to the reporting manager', n, 1);

      -- The queue shows it to the approver, and to nobody else.
      perform pg_temp.as_user(mark);
      select count(*) into n from public.approval_queue();
      if n < 1 then raise exception 'RLS FAIL: the approval is not in its approver''s queue'; end if;
      raise notice 'ok: pending queue shows the approver their own work';

      perform pg_temp.as_user(alice);
      select count(*) into n from public.approval_queue();
      perform pg_temp.check('an uninvolved admin has nothing pending', n, 0);

      -- The requester may not decide their own request.
      perform pg_temp.as_user(ravi);
      begin
        perform public.approval_decide(v_req, 'approved', null);
        raise exception 'RLS FAIL: the requester approved their own request';
      exception
        when insufficient_privilege then raise notice 'ok: requester cannot decide their own request';
      end;

      perform pg_temp.as_user(mark);
      v_status := public.approval_decide(v_req, 'approved', 'fine by me');
      if v_status <> 'approved' then
        raise exception 'RLS FAIL: a single-level approval did not complete, got %', v_status;
      end if;
      raise notice 'ok: single-level approval completes';

      -- Deciding twice must not reopen a closed request.
      v_raised := false;
      begin
        perform public.approval_decide(v_req, 'rejected', null);
      exception when raise_exception then v_raised := true;
      end;
      if not v_raised then raise exception 'RLS FAIL: a completed approval was decided again'; end if;
      raise notice 'ok: a completed approval cannot be decided again';

      ---------------------------------------------------------- two levels
      v_ent := gen_random_uuid();
      perform pg_temp.as_user(ravi);
      v_req := public.approval_submit('harness_probe', v_ent, '{"size": 5}'::jsonb);

      perform pg_temp.as_postgres();
      select required_levels into n from approval_requests where id = v_req;
      perform pg_temp.check('condition met adds the second level', n, 2);

      -- A later-level approver must not be able to act early.
      perform pg_temp.as_user(dan);
      begin
        perform public.approval_decide(v_req, 'approved', null);
        raise exception 'RLS FAIL: level 2 approved before level 1';
      exception
        when insufficient_privilege then raise notice 'ok: a later level cannot decide early';
      end;

      perform pg_temp.as_user(mark);
      v_status := public.approval_decide(v_req, 'approved', null);
      if v_status <> 'pending' then
        raise exception 'RLS FAIL: approving level 1 of 2 should leave it pending, got %', v_status;
      end if;
      raise notice 'ok: approving level 1 advances rather than completes';

      perform pg_temp.as_user(dan);
      v_status := public.approval_decide(v_req, 'approved', null);
      if v_status <> 'approved' then
        raise exception 'RLS FAIL: approving the final level should complete, got %', v_status;
      end if;
      raise notice 'ok: the final level completes the approval';

      ---------------------------------------------------------- rejection
      v_ent := gen_random_uuid();
      perform pg_temp.as_user(ravi);
      v_req := public.approval_submit('harness_probe', v_ent, '{"size": 5}'::jsonb);
      perform pg_temp.as_user(mark);
      v_status := public.approval_decide(v_req, 'rejected', 'clashes with a deadline');
      if v_status <> 'rejected' then
        raise exception 'RLS FAIL: rejection at level 1 should end it, got %', v_status;
      end if;
      raise notice 'ok: rejection ends the chain without consulting later levels';

      ---------------------------------------------------------- D13
      -- Nobody to approve: this employee has no manager.
      perform pg_temp.as_user('00000000-0000-0000-0000-00000000a008');
      v_raised := false;
      begin
        perform public.approval_submit('harness_probe', gen_random_uuid(), '{"size": 1}'::jsonb);
      exception when raise_exception then v_raised := true;
      end;
      if not v_raised then
        raise exception 'RLS FAIL: an unresolvable chain was accepted instead of raising';
      end if;
      raise notice 'ok: an unresolvable chain raises rather than auto-approving';

      -- Alice is the only org_admin, so a role-based level naming org_admin
      -- resolves to nobody when she is the requester: skipped, not self-approved.
      perform pg_temp.as_user(alice);
      v_raised := false;
      begin
        perform public.approval_submit('admin_only_probe', gen_random_uuid(), '{}'::jsonb);
      exception when raise_exception then v_raised := true;
      end;
      if not v_raised then
        raise exception 'RLS FAIL: the only admin approved their own request — self-approval was allowed';
      end if;
      raise notice 'ok: a level resolving to the requester is skipped, not self-approved';

      -- ...and the same chain resolves normally for somebody else.
      perform pg_temp.as_user(ravi);
      v_req := public.approval_submit('admin_only_probe', gen_random_uuid(), '{}'::jsonb);
      perform pg_temp.as_postgres();
      select count(*) into n from approval_steps
       where approval_request_id = v_req and approver_id = alice;
      perform pg_temp.check('the role rule resolves for a different requester', n, 1);

      ---------------------------------------------------------- tenancy
      perform pg_temp.as_user(bob);
      select count(*) into n from approval_requests where organization_id = acme;
      perform pg_temp.check('other tenant sees no acme approvals', n, 0);
      select count(*) into n from approval_steps where organization_id = acme;
      perform pg_temp.check('other tenant sees no acme approval steps', n, 0);
      select count(*) into n from public.approval_queue();
      perform pg_temp.check('other tenant has nothing pending from acme', n, 0);

      -- An uninvolved employee must not read someone else's approval.
      perform pg_temp.as_user('00000000-0000-0000-0000-00000000a006');   -- priya
      select count(*) into n from approval_requests where requester_id = ravi;
      perform pg_temp.check('an uninvolved colleague cannot read the approval', n, 0);

      -- Clean up after ourselves so this file is re-runnable without a re-seed.
      -- Leaving probe requests behind makes later runs fail on unrelated
      -- assertions — which reads as a real defect and wastes the next hour.
      perform pg_temp.as_postgres();
      delete from public.approval_requests
       where entity_type in ('harness_probe', 'admin_only_probe');
    end;
  end if;

  ------------------------------------- the approval queue (step 10, D35 mirrored)
  --
  -- Dan Director is the case this whole step turns on. The ACME chain routes
  -- level 2 to manager_of_manager above three days, so a four-day request from
  -- Ravi reaches Dan — who holds `manager`, is not an admin, and is NOT Ravi's
  -- manager. is_manager_of() is direct-reports-only.
  --
  -- Dan can therefore read the request and the steps, and can read neither
  -- Ravi's profile nor Ravi's balance. Before approval_queue() he would have
  -- been shown an unnamed request, for an unknown balance, and asked to decide.
  --
  -- The fix disclosed the NAME through a function instead of widening the
  -- profiles policy — D35's reasoning, mirrored. Assertion 2 below is the one
  -- that proves it was actually done that way: without it, everything here
  -- passes just as happily with is_approver_on bolted onto both policies, which
  -- is the shortcut this step exists to avoid.
  if to_regprocedure('public.approval_queue()') is not null
     and to_regprocedure('public.leave_approval_detail(uuid)') is not null then
    declare
      v_casual   uuid := '00000000-0000-0000-0000-0000000000c1';
      v_off      int;
      v_lr       uuid;
      v_ar       uuid;
      v_seen     text;
      v_real     text;
      v_rows     int;
      v_types    int;
      v_reserved numeric;
      v_pending  numeric;
      v_refused  boolean;
      v_msg_real text;
      v_msg_fake text;
    begin
      perform pg_temp.as_postgres();

      -- A clean slate for Ravi: the D18 exclusion constraint would otherwise
      -- reject the submission below for overlapping something an earlier block
      -- left behind, and the failure would read as a defect in this one.
      delete from public.leave_requests where employee_id = ravi;
      update public.leave_balances
         set entitled_days = 12, carryforward_days = 0, used_days = 0,
             reserved_days = 0, pending_days = 0
       where employee_id = ravi and leave_type_id = v_casual;

      -- Near enough to stay inside the current financial year. A window in NEXT
      -- year has no materialised balance row (D34), so the balance assertions
      -- would compare against nulls and prove nothing.
      select g into v_off from generate_series(30, 90) g
       where public.calculate_working_days(acme,
               public.org_today(acme) + g, public.org_today(acme) + g + 3) = 4
       limit 1;

      if v_off is null then
        raise exception 'RLS FAIL: no four-working-day window exists in the next 90 days, so the two-level assertions below would be vacuous';
      end if;

      perform pg_temp.as_user(ravi);
      v_lr := public.leave_submit(v_casual,
                public.org_today(acme) + v_off,
                public.org_today(acme) + v_off + 3, 'four days, two levels');

      perform pg_temp.as_postgres();
      select approval_request_id into v_ar from public.leave_requests where id = v_lr;
      select required_levels into v_rows from public.approval_requests where id = v_ar;
      perform pg_temp.check('a four-day request needs two levels (AC6)', v_rows, 2);

      ---------------------------------------------------------- 1 · a name
      -- Level 1 is in play, so it is Mark's and nobody else's yet.
      perform pg_temp.as_user(dan);
      select count(*) into v_rows from public.approval_queue() where approval_request_id = v_ar;
      perform pg_temp.check('a later-level approver sees nothing until it is their turn', v_rows, 0);

      perform pg_temp.as_user(mark);
      select requester_name into v_seen from public.approval_queue() where approval_request_id = v_ar;
      perform pg_temp.as_postgres();
      select full_name into v_real from public.profiles where id = ravi;

      if v_seen is null or v_real is null or v_seen is distinct from v_real then
        raise exception 'RLS FAIL: the queue named the requester "%" when their profile says "%"',
          coalesce(v_seen, '(null)'), coalesce(v_real, '(null)');
      end if;
      raise notice 'ok: the queue names the requester to the approver';

      ------------------------------------------------- AC6 · levels in order
      perform pg_temp.as_user(dan);
      v_refused := false;
      begin
        perform public.approval_decide(v_ar, 'approved', 'jumping the queue');
      exception when others then
        v_refused := (sqlerrm = 'NOT_YOUR_APPROVAL');
      end;
      if not v_refused then
        raise exception 'RLS FAIL: level 2 decided before level 1 had (AC6)';
      end if;
      raise notice 'ok: a later level cannot decide before an earlier one (AC6)';

      perform pg_temp.as_user(mark);
      perform public.approval_decide(v_ar, 'approved', 'ok from me');

      perform pg_temp.as_user(dan);
      select requester_name into v_seen from public.approval_queue() where approval_request_id = v_ar;
      if v_seen is distinct from v_real then
        raise exception 'RLS FAIL: level 2 approver does not see the request, or does not see the name';
      end if;
      raise notice 'ok: it reaches the second level, named';

      ------------------------------------- 2 · and NOTHING beyond a name
      --
      -- The assertion that says the disclosure was minimal. Widening the
      -- profiles or leave_balances policy would satisfy every other check here
      -- and fail this one.
      select count(*) into v_rows from public.profiles where id = ravi;
      perform pg_temp.check('a level-2 approver still cannot read the requester''s profile', v_rows, 0);

      select count(*) into v_rows from public.leave_balances where employee_id = ravi;
      perform pg_temp.check('a level-2 approver still cannot read the requester''s balances', v_rows, 0);

      ------------------------------------- 3 · one leave type, not all of them
      perform pg_temp.as_postgres();
      select count(*) into v_types from public.leave_balances where employee_id = ravi;
      if v_types < 2 then
        raise exception 'RLS FAIL: Ravi holds % balance row(s), so "one type, not all" would pass without disclosing anything', v_types;
      end if;

      perform pg_temp.as_user(dan);
      select count(*) into v_rows from public.leave_approval_detail(v_ar);
      perform pg_temp.check('the approver is given one leave type, not every one', v_rows, 1);

      select count(*) into v_rows from public.leave_approval_detail(v_ar)
       where leave_type_id = v_casual and available_days is not null;
      perform pg_temp.check('and it is the type actually being requested, with its balance', v_rows, 1);

      ------------------------------------- 4 · a stranger learns nothing at all
      perform pg_temp.as_user('00000000-0000-0000-0000-00000000a006');   -- priya
      begin
        perform public.leave_approval_detail(v_ar);
        raise exception 'RLS FAIL: an uninvolved colleague read the approval detail';
      exception when others then
        if sqlerrm like 'RLS FAIL%' then raise; end if;
        v_msg_real := sqlerrm;
      end;
      begin
        perform public.leave_approval_detail('11111111-1111-1111-1111-111111111111');
        raise exception 'RLS FAIL: a fabricated approval id returned rows';
      exception when others then
        if sqlerrm like 'RLS FAIL%' then raise; end if;
        v_msg_fake := sqlerrm;
      end;
      if v_msg_real is distinct from v_msg_fake then
        raise exception 'RLS FAIL: a real request refuses with "%" and an invented one with "%" — guessing ids tells you which exist',
          v_msg_real, v_msg_fake;
      end if;
      raise notice 'ok: a real and an invented approval id refuse identically';

      ------------------------------------- 7 · a module that is off refuses (D44)
      perform pg_temp.as_postgres();
      update public.organization_modules set enabled = false
       where organization_id = acme and module_key = 'leave';

      perform pg_temp.as_user(dan);
      v_refused := false;
      begin
        perform public.leave_approval_detail(v_ar);
      exception when others then
        v_refused := (sqlerrm = 'MODULE_NOT_ENABLED');
      end;
      if not v_refused then
        raise exception 'RLS FAIL: the approval detail answered with the Leave module switched off (D44)';
      end if;
      raise notice 'ok: the approval detail refuses when the module is off';

      perform pg_temp.as_postgres();
      update public.organization_modules set enabled = true
       where organization_id = acme and module_key = 'leave';

      ------------------------------------- 6 · AC4 · and the days actually move
      select reserved_days, pending_days into v_reserved, v_pending
        from public.leave_balances
       where employee_id = ravi and leave_type_id = v_casual;

      if v_reserved <> 4 then
        raise exception 'RLS FAIL: four days were submitted but reserved_days is % — the rest of this proves nothing', v_reserved;
      end if;

      perform pg_temp.as_user(dan);
      perform public.approval_decide(v_ar, 'approved', 'and from me');

      perform pg_temp.as_postgres();
      select reserved_days, pending_days into v_reserved, v_pending
        from public.leave_balances
       where employee_id = ravi and leave_type_id = v_casual;

      if v_reserved <> 0 or v_pending <> 4 then
        raise exception 'RLS FAIL: after the final approval reserved=% pending=% — expected 0 and 4 (AC4)',
          v_reserved, v_pending;
      end if;
      raise notice 'ok: the final approval moves the days from reserved to pending (AC4)';

      select count(*) into v_rows from public.approval_queue() where approval_request_id = v_ar;
      perform pg_temp.check('a decided request leaves every queue', v_rows, 0);

      -- Re-runnable without a re-seed, like the block above.
      perform pg_temp.as_postgres();
      delete from public.leave_requests where employee_id = ravi;
      delete from public.approval_requests where id = v_ar;
      update public.leave_balances
         set entitled_days = 12, carryforward_days = 0, used_days = 0,
             reserved_days = 0, pending_days = 0
       where employee_id = ravi and leave_type_id = v_casual;
    end;
  end if;

  ------------------------------------------------- provisioning (step 8, D39/D42)
  -- Self-serve signup is closed. signup_organization is DROPPED, not revoked:
  -- any verified email creating a workspace and administering it is exactly the
  -- behaviour that had to stop, and a SECURITY DEFINER function which grants
  -- org_admin is not something to leave in the schema behind a comment.
  --
  -- to_regprocedure, not to_regproc: only the former accepts an argument list.
  -- to_regproc returns null for a signature with parentheses, which once made a
  -- guard here permanently false and skipped every assertion below without a word.
  if to_regprocedure('public.provision_organization(text,text,text,text,text)') is not null then

    if to_regprocedure('public.signup_organization(text,text,text)') is not null then
      raise exception 'RLS FAIL: signup_organization still exists — self-serve signup is meant to be gone (D39)';
    end if;
    raise notice 'ok: self-serve signup no longer exists';

    perform pg_temp.as_postgres();
    delete from public.invitations where email in ('provisioned@signup.test', 'nobody@signup.test');
    delete from public.platform_admins where user_id = '00000000-0000-0000-0000-0000000000f0';
    delete from auth.users where email in ('staff@signup.test', 'provisioned@signup.test');

    insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at,
                            raw_app_meta_data, raw_user_meta_data)
    values
      ('00000000-0000-0000-0000-0000000000f0',
       '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
       'staff@signup.test', crypt('x', gen_salt('bf')),
       now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb),
      ('00000000-0000-0000-0000-0000000000f1',
       '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
       'provisioned@signup.test', crypt('x', gen_salt('bf')),
       now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb);

    -- ─────────────────────────────────────── nobody promotes themselves
    -- platform_admins has RLS on, no policy, and NO GRANT. Both matter: RLS
    -- restricts and GRANT permits, and this is the one table where a path from a
    -- signed-in session would be catastrophic.
    perform pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
    begin
      insert into public.platform_admins (user_id)
      values ('00000000-0000-0000-0000-0000000000f1');
      raise exception 'RLS FAIL: an ordinary user made themselves a platform admin';
    exception
      when insufficient_privilege then raise notice 'ok: platform_admins cannot be written from the application';
    end;

    begin
      perform count(*) from public.platform_admins;
      raise exception 'RLS FAIL: an ordinary user can read platform_admins';
    exception
      when insufficient_privilege then raise notice 'ok: platform_admins cannot be read from the application';
    end;

    -- Provisioning refuses anyone who is not staff, including a tenant org_admin.
    begin
      perform public.provision_organization('Sneaky Co', 'sneaky-co', 'x@sneaky.test', null, null);
      raise exception 'RLS FAIL: a non-platform-admin provisioned an organisation';
    exception
      when insufficient_privilege then raise notice 'ok: provisioning refuses a non-platform admin';
    end;

    perform pg_temp.as_user(alice);   -- Alice, org_admin of Acme
    begin
      perform public.provision_organization('Sneaky Co', 'sneaky-co', 'x@sneaky.test', null, null);
      raise exception 'RLS FAIL: a tenant org_admin provisioned an organisation';
    exception
      when insufficient_privilege then raise notice 'ok: a tenant admin is not a platform admin';
    end;

    -- ─────────────────────────────────────── provisioning, done properly
    perform pg_temp.as_postgres();
    insert into public.platform_admins (user_id, note)
    values ('00000000-0000-0000-0000-0000000000f0', 'harness');

    perform pg_temp.as_user('00000000-0000-0000-0000-0000000000f0');
    perform public.provision_organization(
      'Provisioned Co', 'provisioned-co', 'provisioned@signup.test', '+91 90000 09999', 'New Admin');

    perform pg_temp.as_postgres();
    select count(*) into n from organizations where slug = 'provisioned-co';
    perform pg_temp.check('provisioning creates exactly one organisation', n, 1);

    select count(*) into n from organization_settings s
      join organizations o on o.id = s.organization_id where o.slug = 'provisioned-co';
    perform pg_temp.check('provisioning creates settings (every date calculation needs them)', n, 1);

    -- No profile. The designated admin proves they control the address first.
    select count(*) into n from profiles where email = 'provisioned@signup.test';
    perform pg_temp.check('provisioning creates no profile — the admin accepts an invitation (D39)', n, 0);

    select count(*) into n from invitations i join organizations o on o.id = i.organization_id
     where o.slug = 'provisioned-co' and i.role = 'org_admin' and i.accepted_at is null;
    perform pg_temp.check('provisioning invites the named administrator', n, 1);

    -- ─────────────────────────────────────── D42 · staff read no tenant data
    --
    -- This is the promise the whole product rests on, so it is asserted rather
    -- than assumed. A platform admin has no profile, so current_org_id() is null
    -- and every tenant policy refuses them. Sabotage-tested below.
    -- SOMETHING TO FAIL TO SEE.
    --
    -- The first version of this block asserted zero against leave_requests and
    -- approval_requests without checking there was anything there — and the seed
    -- creates NEITHER. Both assertions were decoration: they would have passed
    -- just as happily with isolation switched off. Found by sabotaging them,
    -- watching only the balances check fail, and asking why.
    --
    -- So the fixture is built here, and its presence is asserted as postgres
    -- first. If the seed ever stops producing these rows, this fails loudly
    -- instead of going quietly vacuous again.
    perform pg_temp.as_postgres();
    insert into public.leave_requests
      (organization_id, employee_id, leave_type_id, from_date, to_date,
       working_days, status, submitted_at)
    select acme, ravi, lt.id, current_date + 45, current_date + 45, 1,
           'pending_approval', now()
      from public.leave_types lt
     where lt.organization_id = acme and lt.deleted_at is null
     limit 1;

    select count(*) into n from leave_requests;
    if n = 0 then
      raise exception 'RLS FAIL: no leave_requests exist, so "platform admin reads none" would prove nothing';
    end if;
    select count(*) into n from leave_balances;
    if n = 0 then
      raise exception 'RLS FAIL: no leave_balances exist, so "platform admin reads none" would prove nothing';
    end if;
    select count(*) into n from profiles;
    if n = 0 then
      raise exception 'RLS FAIL: no profiles exist, so "platform admin reads none" would prove nothing';
    end if;
    select count(*) into n from invitations;
    if n = 0 then
      raise exception 'RLS FAIL: no invitations exist, so "platform admin reads none" would prove nothing';
    end if;

    perform pg_temp.as_user('00000000-0000-0000-0000-0000000000f0');
    select count(*) into n from leave_requests;
    perform pg_temp.check('platform admin reads no leave requests', n, 0);
    select count(*) into n from leave_balances;
    perform pg_temp.check('platform admin reads no leave balances', n, 0);
    select count(*) into n from profiles;
    perform pg_temp.check('platform admin reads no profiles', n, 0);
    select count(*) into n from invitations;
    perform pg_temp.check('platform admin reads no invitations through RLS', n, 0);

    -- ...and the console read they DO have discloses only names and counts.
    select count(*) into n from public.platform_list_organizations();
    if n = 0 then
      raise exception 'RLS FAIL: platform_list_organizations returned nothing — the console cannot be verified against an empty result';
    end if;
    raise notice 'ok: a platform admin sees workspaces but no tenant data (D42)';

    -- ─────────────────────────────────── the mail alarm actually alarms
    --
    -- Written after three invitations failed on production for twelve hours in
    -- silence. Every check we had was green: the cron ran every minute, the
    -- dispatcher returned 200, and Resend refused every message. The existing
    -- scheduled-work suite covers an environment with delivery UNCONFIGURED —
    -- a different fault, and not the one that happened.
    perform pg_temp.as_postgres();
    insert into public.notifications
      (organization_id, recipient_id, event_key, channel, subject, body,
       status, attempts, failed_reason, recipient_email)
    values
      (acme, ravi, 'member.invited', 'email', 'harness', '<p>harness</p>',
       'failed', 1,
       -- Carries an address on purpose: the redaction is the D42 half of this.
       'HTTP 422: invalid recipient priya@customer.test', 'priya@customer.test');

    -- Non-vacuity, the lesson of the block above: prove there IS a failure to
    -- find, or "the alarm reports a failure" passes against an empty table.
    select count(*) into n from public.notifications where status = 'failed';
    if n = 0 then
      raise exception 'RLS FAIL: no failed notification exists, so the mail alarm would prove nothing';
    end if;

    perform pg_temp.as_user('00000000-0000-0000-0000-0000000000f0');
    select case when h.healthy then 1 else 0 end into n
      from public.platform_mail_health() h;
    perform pg_temp.check('the mail alarm reports unhealthy when mail has failed', n, 0);

    select h.failed_24h into n from public.platform_mail_health() h;
    if n < 1 then
      raise exception 'RLS FAIL: mail alarm counted % failures, expected at least 1', n;
    end if;

    -- The reason survives, the address does not.
    select case
             when h.last_failure_reason like '%[address removed]%'
              and h.last_failure_reason not like '%priya@customer.test%'
             then 1 else 0 end
      into n from public.platform_mail_health() h;
    perform pg_temp.check('the failure reason keeps the diagnosis and drops the address (D42)', n, 1);

    -- An ordinary administrator cannot read the platform's own health.
    perform pg_temp.as_user(alice);
    begin
      perform * from public.platform_mail_health();
      raise exception 'RLS FAIL: a tenant admin read platform mail health';
    exception
      when raise_exception then
        if sqlerrm <> 'FORBIDDEN' then
          raise exception 'RLS FAIL: mail health refused a tenant admin with "%" rather than FORBIDDEN', sqlerrm;
        end if;
        raise notice 'ok: mail health is refused to a tenant admin';
    end;

    perform pg_temp.as_postgres();
    delete from public.notifications where subject = 'harness';

    -- ─────────────────────────────────────── the invitation, accepted
    perform pg_temp.as_postgres();
    select token into v_text from invitations i join organizations o on o.id = i.organization_id
     where o.slug = 'provisioned-co' and i.role = 'org_admin';

    -- A token addressed to somebody else must fail exactly as a bad one does.
    perform pg_temp.as_user(alice);
    begin
      perform public.invitation_accept(v_text);
      raise exception 'RLS FAIL: an invitation was accepted by the wrong person';
    exception
      when raise_exception then
        if sqlerrm not in ('INVITATION_NOT_FOUND', 'EMAIL_IN_ANOTHER_WORKSPACE') then
          raise exception 'RLS FAIL: wrong-recipient acceptance said "%"', sqlerrm;
        end if;
    end;

    -- A token that does not exist says the same thing as one that does but is
    -- not yours. Anything more specific is an oracle for probing tokens.
    perform pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
    begin
      perform public.invitation_accept('deadbeef' || repeat('0', 40));
      raise exception 'RLS FAIL: a nonexistent invitation token was accepted';
    exception
      when raise_exception then
        if sqlerrm <> 'INVITATION_NOT_FOUND' then
          raise exception 'RLS FAIL: a bad token said "%" instead of INVITATION_NOT_FOUND', sqlerrm;
        end if;
    end;
    raise notice 'ok: a bad token and somebody else''s token are indistinguishable';

    perform public.invitation_accept(v_text);

    perform pg_temp.as_postgres();
    select count(*) into n from profiles where email = 'provisioned@signup.test';
    perform pg_temp.check('accepting an invitation creates the profile', n, 1);
    select count(*) into n from user_roles r join profiles p on p.id = r.user_id
     where p.email = 'provisioned@signup.test' and r.role = 'org_admin';
    perform pg_temp.check('accepting an invitation grants the invited role', n, 1);

    -- Once used, it is spent.
    perform pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
    begin
      perform public.invitation_accept(v_text);
      raise exception 'RLS FAIL: an invitation was accepted twice';
    exception
      when raise_exception then
        if sqlerrm not in ('INVITATION_NOT_FOUND', 'EMAIL_IN_ANOTHER_WORKSPACE') then
          raise exception 'RLS FAIL: reuse said "%"', sqlerrm;
        end if;
    end;
    raise notice 'ok: an invitation cannot be redeemed twice';

    -- ─────────────────────────────────────── invitations are tenant-scoped
    -- Alice administers Acme. Vertex's invitations are none of her business,
    -- and she cannot revoke one she cannot see.
    perform pg_temp.as_user(alice);
    select count(*) into n from invitations i join organizations o on o.id = i.organization_id
     where o.slug = 'provisioned-co';
    perform pg_temp.check('an admin cannot read another organisation''s invitations', n, 0);

    -- An employee cannot read even their own organisation's — a token is a
    -- credential and the guest list is not theirs.
    perform pg_temp.as_user(ravi);
    begin
      perform public.invitation_create('someone@acme.test', null, 'employee', null);
      raise exception 'RLS FAIL: an employee created an invitation';
    exception
      when insufficient_privilege then raise notice 'ok: only an admin invites';
    end;

    select count(*) into n from invitations;
    perform pg_temp.check('an employee reads no invitations at all', n, 0);

    ------------------------------------- what somebody arrives with (step 13)
    --
    -- invitation_accept inserted (id, organization_id, full_name, email, phone)
    -- and NOT joined_date, which defaults to CURRENT_DATE. Everyone seeded has
    -- a sensible start date only because the seed writes it directly; anybody
    -- arriving the way the product actually requires got today.
    --
    -- calculate_entitlement pro-rates the year from that date (D3). Measured on
    -- this seed before the fix, for somebody who joined in 2022: 8 days instead
    -- of 12. A third of their leave, silently.
    declare
      v_tok1   text;
      v_tok2   text;
      v_ent    numeric;
      v_full   numeric;
      v_joined date;
      v_casual uuid := '00000000-0000-0000-0000-0000000000c1';
      v_fy     text;
    begin
      perform pg_temp.as_postgres();
      v_fy := public.get_financial_year(acme, public.org_today(acme));

      -- Two people, and the REPORT is invited naming a manager who does not
      -- exist yet. That is the ordering a customer's spreadsheet actually has,
      -- and the half that is easy to get wrong.
      perform pg_temp.as_user(alice);
      perform public.invitation_create('import.report@acme.test', null, 'employee',
        'Imported Report', date '2022-03-01', 'import.boss@acme.test', null);
      perform public.invitation_create('import.boss@acme.test', null, 'manager',
        'Imported Boss', date '2021-01-01', null, null);

      perform pg_temp.as_postgres();
      select token into v_tok1 from invitations where email = 'import.report@acme.test';
      select token into v_tok2 from invitations where email = 'import.boss@acme.test';

      insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
        email_confirmed_at, confirmation_token, recovery_token, email_change_token_new,
        email_change, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values
        ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-000000000000',
         'authenticated','authenticated','import.report@acme.test','', now(),'','','','',
         '{"provider":"email"}','{}', now(), now()),
        ('00000000-0000-0000-0000-0000000000d2','00000000-0000-0000-0000-000000000000',
         'authenticated','authenticated','import.boss@acme.test','', now(),'','','','',
         '{"provider":"email"}','{}', now(), now())
      on conflict (id) do nothing;

      insert into auth.identities (id, user_id, identity_data, provider, provider_id,
        created_at, updated_at, last_sign_in_at)
      select gen_random_uuid(), u.id,
             jsonb_build_object('sub', u.id::text, 'email', u.email), 'email', u.email,
             now(), now(), now()
        from auth.users u
       where u.id in ('00000000-0000-0000-0000-0000000000d1',
                      '00000000-0000-0000-0000-0000000000d2')
         and not exists (select 1 from auth.identities i where i.user_id = u.id);

      -- The report accepts FIRST, when their manager has no profile at all.
      perform pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
      perform public.invitation_accept(v_tok1);

      perform pg_temp.as_postgres();
      select joined_date into v_joined from profiles where email = 'import.report@acme.test';
      if v_joined <> date '2022-03-01' then
        raise exception 'RLS FAIL: the start date became % rather than the one on the invitation', v_joined;
      end if;

      -- The number, not just the date. A full year here is what the leave type
      -- allows; pro-rating from today would be a fraction of it.
      select public.calculate_entitlement(id, v_casual, v_fy) into v_ent
        from profiles where email = 'import.report@acme.test';
      select max_days_per_year into v_full from leave_types where id = v_casual;
      if v_ent <> v_full then
        raise exception 'RLS FAIL: entitlement is % of a possible % — the start date is not reaching calculate_entitlement', v_ent, v_full;
      end if;
      raise notice 'ok: somebody joins on the date they actually joined, with the entitlement that follows';

      perform pg_temp.check('their manager is unresolved until that person exists',
        (select count(*) from profiles where email = 'import.report@acme.test'
          and manager_id is not null), 0::bigint);

      -- Now the manager arrives. The reverse pass is what makes file order stop
      -- mattering; without it the report reports to nobody forever.
      perform pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
      perform public.invitation_accept(v_tok2);

      perform pg_temp.as_postgres();
      perform pg_temp.check('a manager arriving later picks up the reports waiting for them',
        (select count(*) from profiles p join profiles m on m.id = p.manager_id
          where p.email = 'import.report@acme.test'
            and m.email = 'import.boss@acme.test'), 1::bigint);

      delete from public.user_roles where user_id in
        ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000d2');
      delete from public.profiles where email in
        ('import.report@acme.test','import.boss@acme.test');
      delete from public.invitations where email in
        ('import.report@acme.test','import.boss@acme.test');
      delete from auth.users where id in
        ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000d2');
    end;

    -- ─────────────────────────────────────── cleanup
    perform pg_temp.as_postgres();
    delete from public.leave_requests where employee_id = ravi;
    delete from public.notifications  where organization_id in
      (select id from organizations where slug = 'provisioned-co');
    delete from public.invitations    where organization_id in
      (select id from organizations where slug = 'provisioned-co');
    delete from public.approval_chains where organization_id in
      (select id from organizations where slug = 'provisioned-co');
    delete from public.user_roles     where organization_id in
      (select id from organizations where slug = 'provisioned-co');
    delete from public.audit_logs     where organization_id in
      (select id from organizations where slug = 'provisioned-co');
    delete from public.analytics_events where organization_id in
      (select id from organizations where slug = 'provisioned-co');
    delete from public.profiles       where organization_id in
      (select id from organizations where slug = 'provisioned-co');
    delete from public.organizations  where slug = 'provisioned-co';
    delete from public.platform_admins where user_id = '00000000-0000-0000-0000-0000000000f0';
    delete from auth.users where email in ('staff@signup.test', 'provisioned@signup.test');
  end if;

  ------------------------------------------------- the module boundary (step 9, D44)
  -- Neuvto is a platform onto which modules are deployed multi-tenant, and
  -- module_enabled() was called by nothing at all until step 9. Test scenario 12
  -- has always said "routes AND functions refuse"; only the routes did.
  --
  -- Two levels, answering different questions:
  --   the row exists  Neuvto sells this customer this module   platform admins
  --   enabled = true  the customer switched it on              their admins
  if to_regprocedure('public.module_enabled_for(uuid,text)') is not null then

    -- ─────────────────────────────────────── a customer cannot sell to itself
    -- The previous policy was FOR ALL, so an org_admin could INSERT their own
    -- entitlement to any module in the registry.
    perform pg_temp.as_user(alice);
    begin
      insert into public.organization_modules (organization_id, module_key, enabled, enabled_at)
      values (acme, 'payroll', true, now());
      raise exception 'RLS FAIL: a tenant admin granted themselves a module';
    exception when insufficient_privilege then null;
    end;

    -- Column-level, this one. An UPDATE that rewrites module_key on a row they
    -- legitimately hold turns a Leave grant into a Payroll grant — an
    -- escalation wearing the clothes of an edit.
    begin
      update public.organization_modules set module_key = 'payroll'
       where organization_id = acme and module_key = 'leave';
      raise exception 'RLS FAIL: a tenant admin rewrote which module a grant is for';
    exception when insufficient_privilege then null;
    end;

    begin
      delete from public.organization_modules where organization_id = acme;
      raise exception 'RLS FAIL: a tenant admin deleted a module grant';
    exception when insufficient_privilege then null;
    end;

    begin
      perform public.platform_set_module(acme, 'payroll', true);
      raise exception 'RLS FAIL: a tenant admin called platform_set_module';
    exception when insufficient_privilege then null;
    end;
    raise notice 'ok: only Neuvto grants a module; a customer cannot grant itself one';

    -- ─────────────────────────────────────── but they own the switch
    update public.organization_modules set enabled = false
     where organization_id = acme and module_key = 'leave';

    -- ─────────────────────────────────────── and OFF means off, in the database
    --
    -- Not merely absent from the router. This is the half of scenario 12 that
    -- was never true.
    -- The refusal is recorded in a flag rather than raised inside the block.
    -- Raising the failure there means this handler catches it and reports the
    -- assertion's own message as if the code had produced it — which is what
    -- the first version did, turning a clear failure into a confusing one.
    perform pg_temp.as_user(ravi);
    v_refused := false;
    begin
      perform count(*) from public.leave_my_balances();
    exception when raise_exception then
      v_refused := (sqlerrm = 'MODULE_NOT_ENABLED');
    end;
    if not v_refused then
      raise exception 'RLS FAIL: leave_my_balances did not refuse with the module switched off';
    end if;

    v_refused := false;
    begin
      perform public.leave_submit(
        (select id from public.leave_types where organization_id = acme and deleted_at is null limit 1),
        current_date + 30, current_date + 30, 'refused');
    exception when raise_exception then
      v_refused := (sqlerrm = 'MODULE_NOT_ENABLED');
    end;
    if not v_refused then
      raise exception 'RLS FAIL: leave_submit did not refuse with the module switched off';
    end if;
    raise notice 'ok: a disabled module refuses in the database, not just in the router';

    -- The sweep skips organisations that do not have Leave, rather than this
    -- module reaching into a company that never bought it.
    perform pg_temp.as_postgres();
    if public.leave_mature_all_balances() <> 0 then
      raise exception 'RLS FAIL: the nightly sweep touched an organisation with Leave switched off';
    end if;
    raise notice 'ok: the nightly sweep skips organisations without the module';

    update public.organization_modules set enabled = true
     where organization_id = acme and module_key = 'leave';
  end if;


  ------------------------------------------- company identity + storage (step 9, D45)
  -- A workspace that looks like the customer's own — and a logo that is theirs
  -- alone. The bucket is PRIVATE: public would make every customer's identity
  -- enumerable by anyone who can guess a UUID, and who Neuvto's customers are
  -- is not ours to publish.
  if to_regprocedure('public.organization_display_name(uuid)') is not null then

    perform pg_temp.as_postgres();
    if exists (select 1 from storage.buckets where id = 'org-logos' and public) then
      raise exception 'RLS FAIL: the org-logos bucket is PUBLIC — every customer''s logo is world-readable';
    end if;

    insert into storage.objects (bucket_id, name, metadata)
    values ('org-logos', acme::text   || '/logo.png', '{}'::jsonb),
           ('org-logos', vertex::text || '/logo.png', '{}'::jsonb)
    on conflict do nothing;

    perform pg_temp.as_user(alice);
    select count(*) into n from storage.objects where bucket_id = 'org-logos';
    perform pg_temp.check('an admin sees only their own company logo', n, 1);

    begin
      insert into storage.objects (bucket_id, name, metadata)
      values ('org-logos', vertex::text || '/stolen.png', '{}'::jsonb);
      raise exception 'RLS FAIL: an admin wrote into another customer''s logo path';
    exception when insufficient_privilege then null;
    end;

    -- An employee sees the logo — it is on every screen they open — and cannot
    -- change it.
    perform pg_temp.as_user(ravi);
    select count(*) into n from storage.objects where bucket_id = 'org-logos';
    perform pg_temp.check('an employee sees their own company logo', n, 1);
    begin
      insert into storage.objects (bucket_id, name, metadata)
      values ('org-logos', acme::text || '/employee.png', '{}'::jsonb);
      raise exception 'RLS FAIL: an employee replaced the company logo';
    exception when insufficient_privilege then null;
    end;
    raise notice 'ok: a logo belongs to one customer, and only their admins may change it';

    -- Deletion and replacement cannot be exercised here: Supabase's
    -- protect_delete() trigger refuses direct DML on storage.objects and points
    -- at the Storage API. Assert the policies EXIST and are scoped, which is
    -- the part a migration can get wrong.
    perform pg_temp.as_postgres();
    select count(*) into n from pg_policy p join pg_class c on c.oid = p.polrelid
     where c.relname = 'objects'
       and p.polname in ('admins replace organization logo', 'admins remove organization logo')
       and pg_get_expr(p.polqual, p.polrelid) like '%current_org_id%'
       and pg_get_expr(p.polqual, p.polrelid) like '%is_admin%';
    perform pg_temp.check('replace and remove are org-scoped and admin-only', n, 2);

    -- ─────────────────────────────────────── what an admin may change
    --
    -- authenticated held UPDATE on EVERY column of organizations. Two were
    -- reachable that should never have been: `slug`, which is the workspace
    -- address every link depends on, and `deleted_at` — an administrator could
    -- SOFT-DELETE THEIR OWN ORGANISATION and lock everyone out of a workspace
    -- that no policy would show them again.
    perform pg_temp.as_user(alice);
    begin
      update public.organizations set deleted_at = now() where id = acme;
      raise exception 'RLS FAIL: an admin soft-deleted their own organisation';
    exception when insufficient_privilege then null;
    end;
    begin
      update public.organizations set slug = 'stolen' where id = acme;
      raise exception 'RLS FAIL: an admin changed their workspace address';
    exception when insufficient_privilege then null;
    end;
    update public.organizations set display_name = 'Acme' where id = acme;
    raise notice 'ok: an admin sets their own identity, not their address or their existence';

    -- No cleanup: protect_delete() refuses direct deletion here too, and the
    -- inserts above are fixed names with ON CONFLICT DO NOTHING, so repeated
    -- runs leave exactly one object per organisation either way.
  end if;

  ------------------------------------- leaving properly (step 11, D14/AC9)
  --
  -- Two defects sat here, both demonstrated on the seed before the fix.
  --
  -- ONE. `authenticated` held UPDATE on every column of `profiles`. Policies
  -- filter rows, grants filter columns, and `update own profile` lets a person
  -- update their own row — so every employee could write `joined_date`, which is
  -- the number their entitlement is calculated from. New Joiner turned 6 days
  -- into 12 with a single statement about themselves.
  --
  -- TWO. Deactivation was that same UPDATE. Mark — three direct reports and a
  -- pending approval — went inactive with no error and nothing reassigned, and
  -- every approval routed to him stranded. D14 has forbidden exactly this since
  -- the first draft and nothing enforced it.
  if to_regprocedure('public.deactivate_employee(uuid,uuid)') is not null then
    declare
      v_before_ent numeric;
      v_after_ent  numeric;
      v_moved      jsonb;
      v_reports    int;
      v_steps      int;
      v_rows       int;      -- step 12: counts that must be non-zero to mean anything
      v_refused    boolean;
      v_casual     uuid := '00000000-0000-0000-0000-0000000000c1';
      v_fy         text;
      v_off        int;
      v_lr         uuid;
      v_ar         uuid;
    begin
      ---------------------------------------------------- 1 · nobody edits their own entitlement
      perform pg_temp.as_postgres();
      v_fy := public.get_financial_year(acme, public.org_today(acme));
      v_before_ent := public.calculate_entitlement(joiner, v_casual, v_fy);

      perform pg_temp.as_user(joiner);
      begin
        update public.profiles set joined_date = '2020-01-01' where id = joiner;
        raise exception 'RLS FAIL: an employee rewrote their own joined_date — the number their leave is calculated from';
      exception when insufficient_privilege then null;
      end;

      perform pg_temp.as_postgres();
      v_after_ent := public.calculate_entitlement(joiner, v_casual, v_fy);
      -- Belt and braces: the refusal above is the mechanism, this is the effect.
      -- A mid-year joiner is the fixture on purpose — for somebody who joined
      -- before the year started the number cannot move, so the assertion would
      -- pass without proving anything.
      if v_before_ent <> v_after_ent then
        raise exception 'RLS FAIL: entitlement moved from % to % after a self-edit', v_before_ent, v_after_ent;
      end if;
      if v_before_ent >= 12 then
        raise exception 'RLS FAIL: the fixture is not a mid-year joiner (entitlement %), so this proves nothing', v_before_ent;
      end if;
      raise notice 'ok: an employee cannot rewrite the date their entitlement comes from';

      ---------------------------------------------------- 2 · nor is deactivation a flag flip
      perform pg_temp.as_user(alice);
      begin
        update public.profiles set is_active = false where id = mark;
        raise exception 'RLS FAIL: an admin deactivated somebody with a bare UPDATE — D14 says this is a guarded operation';
      exception when insufficient_privilege then null;
      end;
      begin
        update public.profiles set deleted_at = now() where id = mark;
        raise exception 'RLS FAIL: an admin soft-deleted a colleague directly';
      exception when insufficient_privilege then null;
      end;
      raise notice 'ok: deactivation is not something a plain UPDATE can do';

      ---------------------------------------------------- 3 · cycles
      perform pg_temp.as_user(alice);
      begin
        perform public.admin_set_reporting_line(dan, ravi);   -- ravi → mark → dan → ravi
        raise exception 'RLS FAIL: a reporting cycle was accepted';
      exception when others then
        if sqlerrm not like '%REPORTING_CYCLE%' then raise; end if;
      end;
      raise notice 'ok: a reporting line that closes a loop is refused';

      ---------------------------------------------------- 4 · AC9, and the collapse
      perform pg_temp.as_postgres();
      delete from public.leave_requests where employee_id = ravi;
      update public.leave_balances
         set entitled_days = 12, carryforward_days = 0, used_days = 0,
             reserved_days = 0, pending_days = 0
       where employee_id = ravi and leave_type_id = v_casual;

      select g into v_off from generate_series(30, 90) g
       where public.calculate_working_days(acme,
               public.org_today(acme) + g, public.org_today(acme) + g + 3) = 4
       limit 1;

      -- Four days, so the chain needs level 2 = manager_of_manager = Dan, while
      -- level 1 is Mark. Deactivating Mark TO Dan is the duplicate-approver case.
      perform pg_temp.as_user(ravi);
      v_lr := public.leave_submit(v_casual,
                public.org_today(acme) + v_off,
                public.org_today(acme) + v_off + 3, 'step 11');

      perform pg_temp.as_postgres();
      select approval_request_id into v_ar from public.leave_requests where id = v_lr;
      select required_levels into v_steps from public.approval_requests where id = v_ar;
      if v_steps <> 2 then
        raise exception 'RLS FAIL: the fixture needs two approval levels, got % — the collapse below would prove nothing', v_steps;
      end if;

      select count(*) into v_reports from public.profiles
       where manager_id = mark and deleted_at is null;
      if v_reports = 0 then
        raise exception 'RLS FAIL: Mark has no reports, so "reports move" would pass vacuously';
      end if;

      perform pg_temp.as_user(alice);
      v_moved := public.deactivate_employee(mark, dan);

      perform pg_temp.as_postgres();
      perform pg_temp.check('every direct report moved to the successor',
        (v_moved->>'reports_moved')::bigint, v_reports::bigint);
      perform pg_temp.check('the waiting approval moved too',
        (v_moved->>'approvals_moved')::bigint, 1::bigint);
      perform pg_temp.check('nobody still reports to the person who left',
        (select count(*) from public.profiles where manager_id = mark and deleted_at is null), 0::bigint);
      perform pg_temp.check('and they are inactive',
        (select count(*) from public.profiles where id = mark and is_active), 0::bigint);

      -- The collapse. Dan held level 2 already; inheriting level 1 would leave
      -- him approving the same request twice, which approval_submit takes care
      -- never to produce at submission.
      perform pg_temp.check('the successor approves it once, not twice',
        (select count(*) from public.approval_steps
          where approval_request_id = v_ar and decision = 'pending' and deleted_at is null), 1::bigint);
      select required_levels into v_steps from public.approval_requests where id = v_ar;
      perform pg_temp.check('and the request says so', v_steps::bigint, 1::bigint);
      if (select current_level from public.approval_requests where id = v_ar) > v_steps then
        raise exception 'RLS FAIL: current_level is past required_levels — the request can never complete';
      end if;
      raise notice 'ok: deactivation hands over reports and approvals in one operation (AC9)';

      ---------------------------------------------------- 5 · the module cancelled its own
      -- Ravi still has the pending request; deactivating HIM must cancel it and
      -- return the days, through Leave's own trigger. The platform names no
      -- module, so if this fails the days are stranded and nothing says so.
      perform pg_temp.as_postgres();
      select available_days into v_before_ent from public.leave_balances
       where employee_id = ravi and leave_type_id = v_casual;

      perform pg_temp.as_user(alice);
      perform public.deactivate_employee(ravi, dan);

      perform pg_temp.as_postgres();
      perform pg_temp.check('their pending leave is cancelled when they go',
        (select count(*) from public.leave_requests where id = v_lr and status = 'cancelled'), 1::bigint);
      select available_days into v_after_ent from public.leave_balances
       where employee_id = ravi and leave_type_id = v_casual;
      if v_after_ent <> v_before_ent + 4 then
        raise exception 'RLS FAIL: cancelling on deactivation did not return the days — available % → %, expected %',
          v_before_ent, v_after_ent, v_before_ent + 4;
      end if;
      raise notice 'ok: the module cancels its own work and the days come back';

      ---------------------------------------------------- 6 · self-deactivation
      perform pg_temp.as_user(alice);
      begin
        perform public.deactivate_employee(alice, dan);
        raise exception 'RLS FAIL: an administrator deactivated themselves';
      exception when others then
        if sqlerrm not like '%CANNOT_DEACTIVATE_SELF%' then raise; end if;
      end;
      raise notice 'ok: an administrator cannot deactivate themselves';

      ---------------------------------------- 7 · deactivation removes ACCESS (step 12)
      --
      -- Step 11 moved their work and left them using the product. Demonstrated
      -- on the seed: after being deactivated, Ravi read his profile, read his
      -- balances, and submitted a leave request. current_org_id() checked
      -- deleted_at and not is_active, so "deactivated" meant "cannot be resolved
      -- as an approver" and nothing else.
      --
      -- Ravi is deactivated at this point in the block, which is why these sit
      -- here rather than in a section of their own.
      perform pg_temp.as_postgres();
      select count(*) into v_rows from public.leave_balances where employee_id = ravi;
      if v_rows = 0 then
        raise exception 'RLS FAIL: Ravi holds no balances, so "a deactivated person reads nothing" would pass without refusing anything';
      end if;

      perform pg_temp.as_user(ravi);
      perform pg_temp.check('a deactivated person reads no profiles',
        (select count(*) from public.profiles), 0::bigint);
      perform pg_temp.check('a deactivated person reads no balances',
        (select count(*) from public.leave_balances), 0::bigint);
      perform pg_temp.check('a deactivated person reads no leave requests',
        (select count(*) from public.leave_requests), 0::bigint);

      -- The exact call that succeeded in step 11.
      v_refused := false;
      begin
        perform public.leave_submit(v_casual,
          '2099-06-01'::date, '2099-06-02'::date, 'after deactivation');
      exception when others then
        v_refused := (sqlerrm = 'NO_ORGANIZATION');
      end;
      if not v_refused then
        raise exception 'RLS FAIL: a deactivated person submitted leave — deactivation is not removing access';
      end if;
      raise notice 'ok: a deactivated person reads nothing and can do nothing';

      -- And can be told why, rather than being shown the never-invited screen.
      if public.my_account_status() <> 'deactivated' then
        raise exception 'RLS FAIL: a deactivated person is told "%" rather than deactivated', public.my_account_status();
      end if;
      perform pg_temp.as_user(alice);
      if public.my_account_status() <> 'active' then
        raise exception 'RLS FAIL: an active administrator is not reported as active';
      end if;
      perform pg_temp.as_user(ghost);
      if public.my_account_status() <> 'none' then
        raise exception 'RLS FAIL: somebody with no profile is not reported as none';
      end if;
      raise notice 'ok: the sign-in screen can tell deactivated apart from never-invited';

      ---------------------------------------- 8 · and there is a way back
      perform pg_temp.as_postgres();
      select count(*) into v_reports from public.profiles
       where manager_id = dan and deleted_at is null;
      -- Non-vacuity: if nothing had moved to Dan, "reactivation does not take
      -- the reports back" would hold trivially and prove nothing.
      if v_reports = 0 then
        raise exception 'RLS FAIL: the successor holds no reports, so the assertion below is empty';
      end if;

      perform pg_temp.as_user(alice);
      perform public.reactivate_employee(ravi);

      perform pg_temp.as_user(ravi);
      perform pg_temp.check('reactivation gives access back',
        (select count(*) from public.leave_balances), v_rows::bigint);
      if public.my_account_status() <> 'active' then
        raise exception 'RLS FAIL: a reactivated person is still reported as deactivated';
      end if;

      -- And gives nothing else back. What moved to the successor is theirs now;
      -- taking it back weeks later would change who a third person reports to,
      -- decided by a click on somebody else's record.
      perform pg_temp.as_postgres();
      perform pg_temp.check('reactivation does not take the reports back off the successor',
        (select count(*) from public.profiles where manager_id = dan and deleted_at is null),
        v_reports::bigint);
      raise notice 'ok: reactivation restores access and nothing else';

      ---------------------------------------- 9 · the last one out
      -- Alice is the only org_admin in the seed. Deactivating her would leave
      -- nobody able to administer the workspace AND nobody able to undo it,
      -- because reactivation above is admin-only.
      select count(*) into v_rows
        from public.user_roles ur join public.profiles p on p.id = ur.user_id
       where ur.organization_id = acme and ur.role = 'org_admin'
         and ur.deleted_at is null and p.deleted_at is null and p.is_active;
      if v_rows <> 1 then
        raise exception 'RLS FAIL: acme has % active administrators, so the last-admin guard would prove nothing', v_rows;
      end if;

      perform pg_temp.as_user(hema);          -- hr_admin, so is_admin() but not org_admin
      begin
        perform public.deactivate_employee(alice, dan);
        raise exception 'RLS FAIL: the last administrator was deactivated, locking the workspace out';
      exception when others then
        if sqlerrm not like '%LAST_ADMIN%' then raise; end if;
      end;
      raise notice 'ok: the last administrator cannot be deactivated';

      -- Re-runnable: put the seed back the way it was found.
      perform pg_temp.as_postgres();
      delete from public.leave_requests where employee_id = ravi;
      delete from public.approval_requests where id = v_ar;
      update public.profiles set is_active = true where id in (mark, ravi);
      update public.profiles set manager_id = mark where id in (ravi, joiner, '00000000-0000-0000-0000-00000000a006');
      update public.profiles set manager_id = dan  where id = mark;
      update public.leave_balances
         set entitled_days = 12, carryforward_days = 0, used_days = 0,
             reserved_days = 0, pending_days = 0
       where employee_id = ravi and leave_type_id = v_casual;
    end;
  end if;

  ------------------------------------- leave already taken (step 13, D11)
  --
  -- A company adopting Neuvto in August has staff who have already taken six
  -- days this year. The runbook is blunt about the consequence of nowhere to
  -- say so: "an employee who has taken 6 days this year but shows a full
  -- balance will be allowed to book leave they have not got."
  if to_regprocedure('public.leave_set_opening_balance(uuid,uuid,numeric,numeric)') is not null then
    declare
      priya      uuid := '00000000-0000-0000-0000-00000000a006';
      v_casual   uuid := '00000000-0000-0000-0000-0000000000c1';
      v_avail0   numeric;
      v_avail1   numeric;
      v_ent0     numeric;
      v_ent1     numeric;
      v_refused  boolean;
      v_audit    bigint;
      -- Priya is seeded with only THREE days available on purpose: a later
      -- assertion needs "requesting five is blocked" to fail for the right
      -- reason. Zeroing her and restoring zeros left her flush, and that test
      -- then failed with EXCEEDS_MAX_PER_REQUEST instead — a different refusal
      -- proving a different thing. Whatever this block borrows, it puts back.
      v_keep     public.leave_balances%rowtype;
    begin
      perform pg_temp.as_postgres();
      select * into v_keep from public.leave_balances
       where employee_id = priya and leave_type_id = v_casual;

      update public.leave_balances
         set used_days = 0, carryforward_days = 0, reserved_days = 0, pending_days = 0
       where employee_id = priya and leave_type_id = v_casual;
      select available_days, entitled_days into v_avail0, v_ent0
        from public.leave_balances where employee_id = priya and leave_type_id = v_casual;

      if v_avail0 < 4 then
        raise exception 'RLS FAIL: Priya has only % days available, so "recording 4 already taken" would prove nothing', v_avail0;
      end if;

      perform pg_temp.as_user(alice);
      perform public.leave_set_opening_balance(priya, v_casual, 4, 0);

      perform pg_temp.as_postgres();
      select available_days, entitled_days into v_avail1, v_ent1
        from public.leave_balances where employee_id = priya and leave_type_id = v_casual;

      if v_avail1 <> v_avail0 - 4 then
        raise exception 'RLS FAIL: recording 4 days taken moved available from % to %, expected %',
          v_avail0, v_avail1, v_avail0 - 4;
      end if;
      if v_ent1 <> v_ent0 then
        raise exception 'RLS FAIL: an opening balance changed entitlement from % to % — it records history, it does not grant days',
          v_ent0, v_ent1;
      end if;
      raise notice 'ok: leave already taken comes off what is available, and leaves entitlement alone';

      -- D31 makes the bad state unrepresentable. This proves the refusal comes
      -- from the constraint rather than from a check in the browser.
      perform pg_temp.as_user(alice);
      v_refused := false;
      begin
        perform public.leave_set_opening_balance(priya, v_casual, 9999, 0);
      exception when others then
        v_refused := (sqlerrm = 'OPENING_BALANCE_OVERDRAWN');
      end;
      if not v_refused then
        raise exception 'RLS FAIL: an opening balance overdrew the account';
      end if;
      raise notice 'ok: an opening balance cannot overdraw';

      -- Traceable, per `07`. Written by the trigger on leave_balances rather
      -- than by the function, which is why the previous value is really there.
      perform pg_temp.as_postgres();
      select count(*) into v_audit from public.audit_logs
       where entity_type = 'leave_balances' and entity_id =
             (select id from public.leave_balances where employee_id = priya and leave_type_id = v_casual)
         and (before->>'used_days')::numeric = 0
         and (after->>'used_days')::numeric = 4;
      if v_audit = 0 then
        raise exception 'RLS FAIL: the override left no audit row carrying the previous value';
      end if;
      raise notice 'ok: an override is traceable, with the number it replaced';

      -- Not an employee's to set, on themselves or anybody.
      perform pg_temp.as_user(priya);
      v_refused := false;
      begin
        perform public.leave_set_opening_balance(priya, v_casual, 0, 99);
      exception when others then
        v_refused := (sqlerrm = 'FORBIDDEN');
      end;
      if not v_refused then
        raise exception 'RLS FAIL: an employee granted themselves carried-over days';
      end if;
      raise notice 'ok: only an administrator records an opening balance';

      -- D44.
      perform pg_temp.as_postgres();
      update public.organization_modules set enabled = false
       where organization_id = acme and module_key = 'leave';
      perform pg_temp.as_user(alice);
      v_refused := false;
      begin
        perform public.leave_set_opening_balance(priya, v_casual, 1, 0);
      exception when others then
        v_refused := (sqlerrm = 'MODULE_NOT_ENABLED');
      end;
      if not v_refused then
        raise exception 'RLS FAIL: an opening balance was set with the Leave module switched off';
      end if;
      perform pg_temp.as_postgres();
      update public.organization_modules set enabled = true
       where organization_id = acme and module_key = 'leave';
      raise notice 'ok: opening balances refuse when the module is off';

      update public.leave_balances
         set used_days         = v_keep.used_days,
             carryforward_days = v_keep.carryforward_days,
             reserved_days     = v_keep.reserved_days,
             pending_days      = v_keep.pending_days
       where employee_id = priya and leave_type_id = v_casual;
    end;
  end if;

  ------------------------------------- emails written in English (step 10b)
  --
  -- What a manager received from the first approval onwards:
  --
  --     Approval needed: leave_request
  --     Your leave_request request was approved
  --
  -- A database column in a subject line. It was not a careless template: D30
  -- forbids the platform naming a module, and `entity_type` was the only thing
  -- to hand. A module now declares its own label in a row.
  --
  -- Asserted on the RENDERED text in `notifications`, not on the template,
  -- because the template being right is not the claim — what reaches somebody's
  -- inbox is.
  if to_regprocedure('public.approval_entity_label(text)') is not null then
    declare
      v_subject text;
      v_type    uuid;
      v_off     int;
      v_lr      uuid;
    begin
      perform pg_temp.as_postgres();
      delete from public.leave_requests where employee_id = sara;
      delete from public.notifications where organization_id = vertex;

      -- Vertex, deliberately: Acme overrides approval.submitted in the seed, and
      -- an organisation's own wording must keep winning. Asserting against Acme
      -- would test the fixture instead of the product.
      select id into v_type from public.leave_types
       where organization_id = vertex and approval_required and status = 'active'
       limit 1;
      select g into v_off from generate_series(30, 90) g
       where public.calculate_working_days(vertex,
               public.org_today(vertex) + g, public.org_today(vertex) + g + 1) = 2
       limit 1;

      if v_type is not null and v_off is not null then
        perform pg_temp.as_user(sara);
        v_lr := public.leave_submit(v_type,
                  public.org_today(vertex) + v_off,
                  public.org_today(vertex) + v_off + 1, 'wording check');

        perform pg_temp.as_postgres();
        select subject into v_subject from public.notifications
         where organization_id = vertex and event_key = 'approval.submitted'
         order by created_at desc limit 1;

        if v_subject is null then
          raise exception 'RLS FAIL: no approval email was queued, so the wording assertion below would prove nothing';
        end if;
        if v_subject like '%leave\_request%' then
          raise exception 'RLS FAIL: an approval email says "leave_request" — a column name reached somebody''s inbox: %', v_subject;
        end if;
        if v_subject not like '%leave request%' then
          raise exception 'RLS FAIL: an approval email does not name what it is about: %', v_subject;
        end if;
        -- Belt and braces. render_template strips a placeholder its payload does
        -- not supply, so a missing label shows up as the empty noun the check
        -- above catches, not as this. This fires only if that stripping is ever
        -- removed — at which point a customer would receive raw template syntax.
        if v_subject like '%{{%' then
          raise exception 'RLS FAIL: an approval email shipped an unrendered placeholder: %', v_subject;
        end if;
        raise notice 'ok: approval emails name the thing in English, not by column';

        perform pg_temp.as_postgres();
        delete from public.leave_requests where id = v_lr;
      end if;

      -- An entity type nobody registered falls back to a word, never to the
      -- type name. This is what keeps a future module's oversight from quietly
      -- reinstating the original defect.
      if public.approval_entity_label('expense_claim') <> 'request' then
        raise exception 'RLS FAIL: an unregistered entity type does not fall back to the generic word';
      end if;
      if public.approval_entity_label('leave_request') <> 'leave request' then
        raise exception 'RLS FAIL: the leave module has not registered its own label';
      end if;
      raise notice 'ok: an unregistered entity type falls back to a word, not a column name';
    end;
  end if;


  ---------------------------------------------------------------- notification engine (step 5)
  if to_regprocedure('public.notify(text,uuid,jsonb)') is not null then
    declare
      v_ent   uuid := gen_random_uuid();
      v_req   uuid;
      v_subj  text;
      v_body  text;
      v_bad   boolean;
    begin
      perform pg_temp.as_postgres();
      delete from notifications;

      ------------------------------------------------- the approval lifecycle notifies
      perform pg_temp.as_user(ravi);
      v_req := public.approval_submit('harness_probe', v_ent, '{"size": 5}'::jsonb);

      perform pg_temp.as_postgres();
      select count(*) into n from notifications
       where event_key = 'approval.submitted' and recipient_id = mark;
      perform pg_temp.check('submission notifies the level-1 approver', n, 1);

      -- D26: the module named an event, not a person. Nobody uninvolved is mailed.
      select count(*) into n from notifications where recipient_id in (alice, bob, dan);
      perform pg_temp.check('submission mails nobody who is not involved', n, 0);

      ------------------------------------------------- an org template beats the default
      -- Acme overrides approval.submitted in the seed; Vertex does not.
      select subject into v_subj from notifications
       where event_key = 'approval.submitted' and recipient_id = mark;
      if v_subj not like 'ACME OVERRIDE%' then
        raise exception 'RLS FAIL: the organisation''s own template did not win — got %', v_subj;
      end if;
      raise notice 'ok: an organisation''s template beats the system default';

      ------------------------------------------------- the next approver, and only them
      perform pg_temp.as_user(mark);
      perform public.approval_decide(v_req, 'approved', 'level one');

      perform pg_temp.as_postgres();
      select count(*) into n from notifications
       where event_key = 'approval.decided' and recipient_id = dan;
      perform pg_temp.check('a decision notifies whoever is next in the chain', n, 1);

      select count(*) into n from notifications
       where event_key = 'approval.decided' and recipient_id <> dan;
      perform pg_temp.check('a decision mails only the next approver', n, 0);

      ------------------------------------------------- completion reaches the requester
      perform pg_temp.as_user(dan);
      perform public.approval_decide(v_req, 'approved', 'level two');

      perform pg_temp.as_postgres();
      select count(*) into n from notifications
       where event_key = 'approval.completed' and recipient_id = ravi;
      perform pg_temp.check('completion notifies the person who asked', n, 1);

      select count(*) into n from notifications where event_key = 'approval.decided';
      perform pg_temp.check('the closing decision does not also mail a next approver', n, 1);

      ------------------------------------------------- a rejection stops the chain
      -- This is the case the resolver's "is the request still open" check
      -- exists for, and the only one that exercises it. When a two-level
      -- request is REJECTED at level one, level two's step is still pending —
      -- so a resolver that looks only at step decisions cheerfully tells the
      -- level-two approver it is their turn to act on a request that is already
      -- dead. Approving twice never reaches that state, which is why the first
      -- version of this block passed against a deliberately broken resolver.
      declare
        v_ent2 uuid := gen_random_uuid();
        v_req2 uuid;
      begin
        perform pg_temp.as_postgres();
        delete from notifications;

        perform pg_temp.as_user(ravi);
        v_req2 := public.approval_submit('harness_probe', v_ent2, '{"size": 5}'::jsonb);

        perform pg_temp.as_user(mark);
        perform public.approval_decide(v_req2, 'rejected', 'not this time');

        perform pg_temp.as_postgres();
        select count(*) into n from notifications
         where event_key = 'approval.decided' and recipient_id = dan;
        perform pg_temp.check('a rejection does not summon the next approver', n, 0);

        select count(*) into n from notifications
         where event_key = 'approval.completed' and recipient_id = ravi;
        perform pg_temp.check('a rejection still tells the requester', n, 1);

        select count(*) into n from notifications
         where event_key = 'approval.completed' and body like '%rejected%';
        perform pg_temp.check('the requester is told it was rejected, not approved', n, 1);

        delete from approval_steps    where approval_request_id = v_req2;
        delete from approval_requests where id = v_req2;
        delete from notifications;
      end;

      -- Rebuild the approved-path fixture the later assertions read.
      perform pg_temp.as_user(ravi);
      v_req := public.approval_submit('harness_probe', gen_random_uuid(), '{"size": 5}'::jsonb);
      perform pg_temp.as_user(mark);
      perform public.approval_decide(v_req, 'approved', 'level one');
      perform pg_temp.as_user(dan);
      perform public.approval_decide(v_req, 'approved', 'level two');
      perform pg_temp.as_postgres();

      ------------------------------------------------- everything renders
      select count(*) into n from notifications
       where subject like '%{{%' or body like '%{{%';
      perform pg_temp.check('no notification went out with an unrendered placeholder', n, 0);

      select count(*) into n from notifications where status = 'failed';
      perform pg_temp.check('no notification failed for want of a template', n, 0);

      ------------------------------------------------- D27, on the real path
      -- Not render_template() in isolation — the whole way through notify(),
      -- because escaping that is skipped on the path actually used is escaping
      -- that does not exist.
      perform public.notify('approval.completed', ravi,
        jsonb_build_object('entity_type', 'leave', 'status', '<img src=x onerror=alert(1)>'));

      select body into v_body from notifications
       where recipient_id = ravi and body like '%img%' order by created_at desc limit 1;
      if v_body like '%<img%' then
        raise exception 'RLS FAIL: D27 — live markup reached a rendered notification body';
      end if;
      if v_body not like '%&lt;img%' then
        raise exception 'RLS FAIL: D27 — the value was dropped rather than escaped: %', v_body;
      end if;
      raise notice 'ok: user input is escaped, not executed, in a rendered body';

      ------------------------------------------------- tenancy
      perform pg_temp.as_user(bob);
      select count(*) into n from notifications;
      perform pg_temp.check('a vertex user sees no acme notifications', n, 0);

      select count(*) into n from notification_templates where organization_id = acme;
      perform pg_temp.check('a vertex user cannot read acme templates', n, 0);

      -- But the system defaults are readable, or an admin cannot see what they
      -- are about to override.
      select count(*) into n from notification_templates where organization_id is null;
      if n < 1 then raise exception 'RLS FAIL: system default templates are invisible to an admin'; end if;
      raise notice 'ok: system defaults are readable by everyone';

      ------------------------------------------------- your mail is yours
      perform pg_temp.as_user(mark);
      select count(*) into n from notifications where recipient_id <> mark;
      perform pg_temp.check('an employee sees only their own notifications', n, 0);

      perform pg_temp.as_user(alice);
      select count(*) into n from notifications where recipient_id = mark;
      if n < 1 then raise exception 'RLS FAIL: an org_admin cannot see their organisation''s notifications'; end if;
      raise notice 'ok: an org_admin sees the organisation''s mail';

      ------------------------------------------------- an admin cannot rewrite the defaults
      v_bad := false;
      perform pg_temp.as_user(alice);
      begin
        insert into notification_templates (organization_id, event_key, channel, subject_template, body_template)
        values (null, 'approval.submitted', 'email', 'hijacked', 'hijacked');
        v_bad := true;
      exception when insufficient_privilege or check_violation then null;
      end;
      if v_bad then
        raise exception 'RLS FAIL: an org_admin wrote a system default template every customer depends on';
      end if;
      raise notice 'ok: system defaults are not writable by a customer admin';

      ------------------------------------------------- nobody marks their own mail sent
      -- Asserted on the grant itself rather than by calling and catching the
      -- error. Calling appears to prove it, but the exception that comes back
      -- is raised by the column-level GRANT on notifications, not by the
      -- missing EXECUTE — so the call still fails after someone grants EXECUTE
      -- to authenticated, and a test that only calls reports "ok" while the
      -- privilege it names has actually been given away.
      perform pg_temp.as_postgres();
      if has_function_privilege('authenticated', 'public.notification_mark_sent(uuid)', 'execute')
         or has_function_privilege('authenticated', 'public.notification_mark_failed(uuid,text)', 'execute')
         or has_function_privilege('authenticated', 'public.notification_claim_batch(integer)', 'execute')
      then
        raise exception 'RLS FAIL: a delivery function is executable by ordinary users — a recipient could mark their own mail sent and hide it';
      end if;
      raise notice 'ok: delivery functions are service-role only';

      -- And the behaviour, belt and braces: even with the grant, the write is
      -- refused. Two independent defences, asserted independently.
      v_bad := false;
      perform pg_temp.as_user(mark);
      begin
        perform public.notification_mark_sent(
          (select id from notifications where recipient_id = mark limit 1));
        v_bad := true;
      exception when insufficient_privilege then null;
      end;
      if v_bad then
        raise exception 'RLS FAIL: a signed-in user marked a notification sent';
      end if;
      raise notice 'ok: marking mail sent is refused at the table as well as the grant';

      ------------------------------------------------- the dispatcher can actually work
      -- Run as service_role, which is what the edge function is. This is the
      -- only assertion in the suite that does, and it exists because nothing
      -- else could catch what it caught: the delivery functions were not
      -- SECURITY DEFINER, so they inherited service_role's rights, and
      -- service_role has no grant on profiles. Every SQL test passed. The
      -- dispatcher failed on its first real call with "permission denied for
      -- table profiles". A test that never assumes the identity that runs the
      -- code in production is not testing production.
      perform pg_temp.as_postgres();
      set local role service_role;
      begin
        select count(*) into n from public.notification_claim_batch(10);
      exception when others then
        raise exception 'RLS FAIL: the dispatcher cannot claim its own queue as service_role — %', sqlerrm;
      end;
      reset role;
      if n < 1 then
        raise exception 'RLS FAIL: the dispatcher claimed nothing from a queue that has pending mail in it';
      end if;
      raise notice 'ok: the dispatcher can claim the queue as service_role, with the address attached';

      ------------------------------------------------- D29 retry
      -- The behaviour that was claimed in a comment and not implemented: a
      -- transient failure has to remain deliverable. Tested here rather than in
      -- the dispatcher because the decision about when to give up lives in SQL.
      if to_regprocedure('public.notification_mark_retry(uuid,text)') is not null then
        declare
          v_note uuid;
          v_next timestamptz;
          v_max  smallint := public.notification_max_attempts();
        begin
          perform pg_temp.as_postgres();
          delete from notifications;

          v_note := public.notify('approval.completed', ravi,
            jsonb_build_object('entity_type', 'leave', 'status', 'approved'));

          -- One transient failure: still pending, still ours, but not yet.
          update notifications set attempts = 1 where id = v_note;
          perform public.notification_mark_retry(v_note, 'NETWORK: connection reset');

          select status::text, next_attempt_at into strict v_subj, v_next
            from notifications where id = v_note;
          if v_subj <> 'pending' then
            raise exception 'RLS FAIL: a transient failure was not left retryable — status is %', v_subj;
          end if;
          if v_next <= now() then
            raise exception 'RLS FAIL: no backoff applied — it would be re-claimed immediately';
          end if;
          raise notice 'ok: a transient failure stays pending and backs off';

          -- Backed off means backed off: the dispatcher must not pick it up yet.
          set local role service_role;
          select count(*) into n from public.notification_claim_batch(10);
          reset role;
          perform pg_temp.check('a backed-off notification is not claimed early', n, 0);

          -- Once its time comes it is claimable again.
          update notifications set next_attempt_at = now() - interval '1 second' where id = v_note;
          set local role service_role;
          select count(*) into n from public.notification_claim_batch(10);
          reset role;
          perform pg_temp.check('it becomes claimable once the backoff expires', n, 1);

          -- And it does not retry forever. At the cap it goes terminal, or a
          -- permanently broken notification never surfaces to anyone.
          update notifications set attempts = v_max where id = v_note;
          perform public.notification_mark_retry(v_note, 'NETWORK: still down');

          select status::text into strict v_subj from notifications where id = v_note;
          if v_subj <> 'failed' then
            raise exception 'RLS FAIL: retries never give up — status is % at the attempt cap', v_subj;
          end if;
          select count(*) into n from notifications
           where id = v_note and failed_reason like 'GAVE_UP%';
          perform pg_temp.check('giving up records that it gave up, and why', n, 1);

          -- A signed-in user must not be able to defer their own mail forever.
          perform pg_temp.as_postgres();
          if has_function_privilege('authenticated', 'public.notification_mark_retry(uuid,text)', 'execute') then
            raise exception 'RLS FAIL: an ordinary user can reschedule notification delivery';
          end if;
          raise notice 'ok: rescheduling delivery is service-role only';

          perform pg_temp.as_postgres();
          delete from notifications;
        end;
      end if;

      ------------------------------------------------- leave the queue as we found it
      perform pg_temp.as_postgres();
      delete from notifications;
      delete from approval_steps    where approval_request_id = v_req;
      delete from approval_requests where id = v_req;
    end;
  end if;

  ---------------------------------------------------------------- leave module (step 6)
  if to_regprocedure('public.leave_submit(uuid,date,date,text)') is not null then
    declare
      casual uuid := '00000000-0000-0000-0000-0000000000c1';
      priya  uuid := '00000000-0000-0000-0000-00000000a006';
      d0     date;
      v_off  int;    -- offset to a window that really is four working days
      v_req  uuid;
      v_appr uuid;
      v_bad  boolean;
      v_status text;
      v_before numeric;
      v_after  numeric;
    begin
      perform pg_temp.as_postgres();
      delete from leave_requests;
      update leave_balances set reserved_days = 0, pending_days = 0;

      -- A WINDOW THAT IS FOUR WORKING DAYS, FOUND RATHER THAN ASSUMED.
      --
      -- This was `org_today(acme) + 45`, and the assertions below need the
      -- request to be MORE THAN THREE working days — that is what makes the
      -- seeded chain require a second level (D5, the threshold as a row).
      --
      -- A fixed offset does not give a fixed number of working days. It gives
      -- whatever the weekday alignment happens to produce, and the alignment
      -- moves every day. On 2 Aug 2026 the offset landed on a Wednesday, so
      -- d0..d0+4 spanned Wed–Sun: three working days, one approval level, and
      -- "leave went to approved after only the first of two approvals" — the
      -- product behaving correctly and the fixture being wrong.
      --
      -- It had been latent since this block was written and turned red on a
      -- Sunday, on main, straight after a merge whose own CI was green a few
      -- hours earlier. Nothing changed but the day of the week.
      select g into v_off
        from generate_series(40, 100) g
       where public.calculate_working_days(acme,
               public.org_today(acme) + g, public.org_today(acme) + g + 4) = 4
       limit 1;

      if v_off is null then
        raise exception 'RLS FAIL: no five-day window in the next 100 days contains four working days — the level assertions below would be testing the calendar, not the engine';
      end if;
      d0 := public.org_today(acme) + v_off;

      ------------------------------------------------- submission reserves
      select available_days into v_before from leave_balances
       where employee_id = ravi and leave_type_id = casual;

      perform pg_temp.as_user(ravi);
      v_req := public.leave_submit(casual, d0, d0 + 4, 'harness');

      perform pg_temp.as_postgres();
      select available_days into v_after from leave_balances
       where employee_id = ravi and leave_type_id = casual;

      select working_days into n from leave_requests where id = v_req;
      if v_before - v_after <> n then
        raise exception 'RLS FAIL: submitting % days moved available by %', n, v_before - v_after;
      end if;
      raise notice 'ok: submitting reserves exactly the working days requested';

      -- The engine was handed the request; this module decided no levels.
      select approval_request_id into v_appr from leave_requests where id = v_req;
      if v_appr is null then
        raise exception 'RLS FAIL: a submitted request has no approval attached';
      end if;
      perform pg_temp.check('the approval names the leave request as its entity', (
        select count(*) from approval_requests
         where id = v_appr and entity_type = 'leave_request' and entity_id = v_req), 1);

      ------------------------------------------------- D18, at the constraint
      -- The handler check gives the readable message. This proves the database
      -- refuses it even when the handler is bypassed entirely — an insert made
      -- directly, as postgres, exactly as a race would.
      v_bad := false;
      begin
        insert into leave_requests
          (organization_id, employee_id, leave_type_id, from_date, to_date, working_days, status)
        values (acme, ravi, casual, d0 + 1, d0 + 2, 1, 'pending_approval');
        v_bad := true;
      exception when exclusion_violation then null;
      end;
      if v_bad then
        raise exception 'RLS FAIL: D18 — overlapping leave was inserted past the constraint';
      end if;
      raise notice 'ok: overlap is refused by the constraint, not only the handler';

      ------------------------------------------------- D31, overdraw is unrepresentable
      v_bad := false;
      begin
        update leave_balances set reserved_days = reserved_days + 999
         where employee_id = ravi and leave_type_id = casual;
        v_bad := true;
      exception when check_violation then null;
      end;
      if v_bad then
        raise exception 'RLS FAIL: D31 — a balance was driven negative';
      end if;
      raise notice 'ok: a balance cannot be overdrawn, whatever the caller does';

      ------------------------------------------------- named refusals
      perform pg_temp.as_user(ravi);
      begin
        perform public.leave_submit(casual, public.org_today(acme) - 5, public.org_today(acme) - 4, 'past');
        raise exception 'RLS FAIL: leave was accepted for a date already past';
      exception when raise_exception then
        if sqlerrm <> 'PAST_DATE' then raise; end if;
      end;
      raise notice 'ok: retroactive leave is refused in org-local time';

      begin
        -- A Saturday and Sunday for Acme, whose weekend is Sat/Sun.
        perform public.leave_submit(casual, date '2026-09-05', date '2026-09-06', 'weekend');
        raise exception 'RLS FAIL: leave was accepted for non-working days only';
      exception when raise_exception then
        if sqlerrm <> 'NO_WORKING_DAYS' then raise; end if;
      end;
      raise notice 'ok: a weekend-only request is refused';

      -- Priya's balance covers 3 days; a fortnight cannot fit in it.
      perform pg_temp.as_user(priya);
      begin
        perform public.leave_submit(casual, d0 + 100, d0 + 113, 'overdraw');
        raise exception 'RLS FAIL: a request larger than the balance was accepted';
      exception when raise_exception then
        if sqlerrm not like 'INSUFFICIENT_BALANCE%' then raise; end if;
      end;
      raise notice 'ok: a request beyond the available balance is refused';

      ------------------------------------------------- D30, the decision moves the days
      -- This request is 4 working days, and the seeded chain requires a second
      -- approval above 3 — D5 as a row rather than a line of code. The first
      -- decision must therefore advance and change nothing about the leave.
      perform pg_temp.as_user(mark);
      perform public.approval_decide(v_appr, 'approved', 'level one');

      perform pg_temp.as_postgres();
      select status::text into v_status from leave_requests where id = v_req;
      if v_status <> 'pending_approval' then
        raise exception 'RLS FAIL: leave went to % after only the first of two approvals', v_status;
      end if;
      select reserved_days into v_before from leave_balances
       where employee_id = ravi and leave_type_id = casual;
      if v_before <> n then
        raise exception 'RLS FAIL: the reservation moved before the chain finished';
      end if;
      raise notice 'ok: a part-approved request stays pending and stays reserved';

      -- The second, which completes it.
      perform pg_temp.as_user(dan);
      perform public.approval_decide(v_appr, 'approved', 'level two');

      perform pg_temp.as_postgres();
      select status::text into v_status from leave_requests where id = v_req;
      if v_status <> 'approved' then
        raise exception 'RLS FAIL: the approval completed but the leave request is still %', v_status;
      end if;
      raise notice 'ok: completing the chain approves the leave';

      select reserved_days into v_before from leave_balances
       where employee_id = ravi and leave_type_id = casual;
      perform pg_temp.check('approval releases the reservation', v_before::bigint, 0::bigint);

      select pending_days into v_after from leave_balances
       where employee_id = ravi and leave_type_id = casual;
      if v_after <> n then
        raise exception 'RLS FAIL: % days were reserved but % became pending', n, v_after;
      end if;
      raise notice 'ok: approved days move from reserved to pending, none lost';

      ------------------------------------------------- D35, the approval timeline
      -- SECURITY DEFINER bypasses RLS, so this function restates the rule
      -- rather than inheriting it. If that restatement is wrong, one employee
      -- reads another's approval history — and the join it replaced failed
      -- closed, so nothing else here would notice.
      declare
        v_name text;
        v_seen boolean;
      begin
        perform pg_temp.as_user(ravi);
        select approver_name into v_name
          from public.approval_timeline(v_appr) where level = 1;
        if v_name is null or v_name = 'Approver' then
          raise exception 'RLS FAIL: the requester cannot see who has to approve their leave — got %', coalesce(v_name, '(null)');
        end if;
        raise notice 'ok: the requester sees their approver by name';

        -- The approver can see it too; they are on the request.
        perform pg_temp.as_user(mark);
        select count(*) > 0 into v_seen from public.approval_timeline(v_appr);
        if not v_seen then
          raise exception 'RLS FAIL: an approver cannot read the timeline of a request they must decide';
        end if;
        raise notice 'ok: an approver sees the timeline of what they must decide';

        -- Nobody else. Priya is in the same organisation and uninvolved.
        perform pg_temp.as_user(priya);
        v_bad := false;
        begin
          perform public.approval_timeline(v_appr);
          v_bad := true;
        exception when raise_exception then
          if sqlerrm <> 'FORBIDDEN' then raise; end if;
        end;
        if v_bad then
          raise exception 'RLS FAIL: an uninvolved colleague read somebody else''s approval history';
        end if;
        raise notice 'ok: an uninvolved colleague cannot read the timeline';

        -- And no one from another tenant, whatever they pass.
        perform pg_temp.as_user(bob);
        v_bad := false;
        begin
          perform public.approval_timeline(v_appr);
          v_bad := true;
        exception when raise_exception then
          if sqlerrm <> 'FORBIDDEN' then raise; end if;
        end;
        if v_bad then
          raise exception 'RLS FAIL: another tenant read an approval timeline';
        end if;
        raise notice 'ok: another tenant cannot read the timeline';
      end;

      ------------------------------------------------- D33, cancelling
      -- The invariant that matters is not "the status changed" but "the days
      -- came back, once". A release that happens twice inflates the balance
      -- silently — no constraint is violated and nobody notices until somebody
      -- takes leave they never had.
      if to_regprocedure('public.leave_cancel(uuid)') is not null then
        declare
          v_avail0 numeric;
          v_avail1 numeric;
          v_req2   uuid;
          v_appr2  uuid;
          v_step   record;
        begin
          ------------------------------------------- cancelling an APPROVED request
          -- v_req from above is approved, its days sitting in pending_days.
          select available_days into v_avail0 from leave_balances
           where employee_id = ravi and leave_type_id = casual;

          perform pg_temp.as_user(ravi);
          perform public.leave_cancel(v_req);

          perform pg_temp.as_postgres();
          select status::text into v_status from leave_requests where id = v_req;
          if v_status <> 'cancelled' then
            raise exception 'RLS FAIL: cancel left the request as %', v_status;
          end if;

          select available_days into v_avail1 from leave_balances
           where employee_id = ravi and leave_type_id = casual;
          if v_avail1 - v_avail0 <> n then
            raise exception 'RLS FAIL: cancelling % approved days returned % to available', n, v_avail1 - v_avail0;
          end if;
          raise notice 'ok: cancelling approved leave returns the days from pending';

          select pending_days into v_before from leave_balances
           where employee_id = ravi and leave_type_id = casual;
          perform pg_temp.check('nothing is left stranded in pending', v_before::bigint, 0::bigint);

          ------------------------------------------- cancelling a PENDING request
          perform pg_temp.as_user(ravi);
          select available_days into v_avail0 from leave_balances
           where employee_id = ravi and leave_type_id = casual;
          v_req2 := public.leave_submit(casual, d0 + 100, d0 + 102, 'to withdraw');

          perform pg_temp.as_postgres();
          select working_days into n from leave_requests where id = v_req2;
          perform pg_temp.as_user(ravi);
          perform public.leave_cancel(v_req2);

          perform pg_temp.as_postgres();
          select available_days into v_avail1 from leave_balances
           where employee_id = ravi and leave_type_id = casual;
          if v_avail1 <> v_avail0 then
            raise exception 'RLS FAIL: withdrawing a pending request left available at % instead of %', v_avail1, v_avail0;
          end if;
          raise notice 'ok: withdrawing a pending request returns the days from reserved';

          select reserved_days into v_before from leave_balances
           where employee_id = ravi and leave_type_id = casual;
          perform pg_temp.check('nothing is left stranded in reserved', v_before::bigint, 0::bigint);

          ------------------------------------------- released exactly once
          -- Cancelling twice must not pay out twice. The second call is refused,
          -- but the assertion is on the balance, because a refusal that still
          -- moved days would pass a status check.
          perform pg_temp.as_user(ravi);
          v_bad := false;
          begin
            perform public.leave_cancel(v_req2);
            v_bad := true;
          exception when raise_exception then
            if sqlerrm <> 'ALREADY_DECIDED' then raise; end if;
          end;
          if v_bad then
            raise exception 'RLS FAIL: an already-cancelled request was cancelled again';
          end if;

          perform pg_temp.as_postgres();
          select available_days into v_avail1 from leave_balances
           where employee_id = ravi and leave_type_id = casual;
          if v_avail1 <> v_avail0 then
            raise exception 'RLS FAIL: a second cancel moved the balance to % — days released twice', v_avail1;
          end if;
          raise notice 'ok: cancelling twice pays out once';

          ------------------------------------------- somebody else's leave
          perform pg_temp.as_user(ravi);
          v_req2 := public.leave_submit(casual, d0 + 130, d0 + 132, 'not yours');

          perform pg_temp.as_user(priya);
          v_bad := false;
          begin
            perform public.leave_cancel(v_req2);
            v_bad := true;
          exception when raise_exception then
            if sqlerrm <> 'NOT_YOUR_REQUEST' then raise; end if;
          end;
          if v_bad then
            raise exception 'RLS FAIL: an employee cancelled a colleague''s leave';
          end if;
          raise notice 'ok: an employee cannot cancel a colleague''s leave';

          ------------------------------------------- leave already under way
          -- D9: judged in the organisation's today, not the server's.
          perform pg_temp.as_postgres();
          update leave_requests
             set from_date = public.org_today(acme) - 1, to_date = public.org_today(acme) + 1
           where id = v_req2;

          perform pg_temp.as_user(ravi);
          v_bad := false;
          begin
            perform public.leave_cancel(v_req2);
            v_bad := true;
          exception when raise_exception then
            if sqlerrm <> 'CANCEL_TOO_LATE' then raise; end if;
          end;
          if v_bad then
            raise exception 'RLS FAIL: leave that had already started was cancelled';
          end if;
          raise notice 'ok: leave already under way cannot be cancelled';

          ------------------------------------------- the reason cap agrees with the form
          perform pg_temp.as_postgres();
          v_bad := false;
          begin
            update leave_requests set reason = repeat('x', 501) where id = v_req2;
            v_bad := true;
          exception when check_violation then null;
          end;
          if v_bad then
            raise exception 'RLS FAIL: a reason longer than the form permits was accepted';
          end if;
          raise notice 'ok: the reason cap matches the 500 the form enforces';

          perform pg_temp.as_postgres();
          delete from approval_steps    where approval_request_id in
            (select approval_request_id from leave_requests where employee_id = ravi);
          delete from approval_requests where entity_id in
            (select id from leave_requests where employee_id = ravi);
          delete from leave_requests where employee_id = ravi;
          update leave_balances set reserved_days = 0, pending_days = 0 where employee_id = ravi;
          -- Requests far enough ahead land in the NEXT financial year, and
          -- ensure_balance creates a balance row there. Resetting the buckets
          -- left those rows behind, and they then showed up in the interface as
          -- a second, unexplained bucket for the same leave type. Test data has
          -- to leave nothing behind, or it becomes somebody's bug report.
          delete from leave_balances
           where employee_id = ravi
             and fy_label <> public.get_financial_year(acme, public.org_today(acme));
        end;
      end if;

      ------------------------------------------------- tenancy
      -- Scoped to Acme's rows specifically. Counting everything Bob can see
      -- would count Vertex's own balances, which he is entitled to — and the
      -- assertion would then be measuring the seed rather than the policy.
      perform pg_temp.as_user(bob);
      select count(*) into n from leave_requests where organization_id = acme;
      perform pg_temp.check('a vertex user sees no acme leave requests', n, 0);
      select count(*) into n from leave_balances where organization_id = acme;
      perform pg_temp.check('a vertex user sees no acme balances', n, 0);

      -- The one an employee would notice immediately, and the reason RLS is
      -- where this is enforced rather than in a query somebody might forget.
      perform pg_temp.as_user(priya);
      select count(*) into n from leave_balances where employee_id = ravi;
      perform pg_temp.check('an employee cannot see a colleague''s balance', n, 0);

      perform pg_temp.as_user(mark);
      select count(*) into n from leave_balances where employee_id = ravi;
      if n < 1 then
        raise exception 'RLS FAIL: a manager cannot see their own report''s balance';
      end if;
      raise notice 'ok: a manager sees their reports, and only their reports';

      perform pg_temp.as_postgres();
      delete from leave_requests;
      update leave_balances set reserved_days = 0, pending_days = 0;
    end;
  end if;

  perform pg_temp.as_postgres();
  raise notice '--- RLS verification passed ---';
end $$;

reset role;
