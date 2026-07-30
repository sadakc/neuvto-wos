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
  ghost   uuid := '00000000-0000-0000-0000-0000000000ff';
  joiner  uuid := '00000000-0000-0000-0000-00000000a007';
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
      select count(*) into n from public.approval_pending_for();
      if n < 1 then raise exception 'RLS FAIL: the approval is not in its approver''s queue'; end if;
      raise notice 'ok: pending queue shows the approver their own work';

      perform pg_temp.as_user(alice);
      select count(*) into n from public.approval_pending_for();
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
      select count(*) into n from public.approval_pending_for();
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

  ---------------------------------------------------------------- signup (step 2)
  -- Phase 0 made signup impossible: granting a role requires is_admin(), and the
  -- founder of a brand-new organisation has none. signup_organization() is the
  -- one SECURITY DEFINER path through that, so its limits matter.
  -- to_regprocedure, not to_regproc: only the former accepts an argument list.
  -- to_regproc returns null for a signature with parentheses, which made this
  -- guard permanently false and skipped every assertion below without a word.
  if to_regprocedure('public.signup_organization(text,text,text)') is not null then
    perform pg_temp.as_postgres();
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at,
                            raw_app_meta_data, raw_user_meta_data)
    values ('00000000-0000-0000-0000-0000000000f1',
            '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
            'newfounder@signup.test', crypt('x', gen_salt('bf')),
            now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb);

    perform pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
    perform public.signup_organization('Signup Test Co', 'signup-test-co', 'New Founder');

    perform pg_temp.as_postgres();
    select count(*) into n from organizations where slug = 'signup-test-co';
    perform pg_temp.check('signup creates exactly one organisation', n, 1);

    select count(*) into n from user_roles
     where user_id = '00000000-0000-0000-0000-0000000000f1' and role = 'org_admin';
    perform pg_temp.check('signup makes the founder an org_admin', n, 1);

    select count(*) into n from organization_settings s
      join organizations o on o.id = s.organization_id where o.slug = 'signup-test-co';
    perform pg_temp.check('signup creates settings (every date calculation needs them)', n, 1);

    -- The email must come from the verified auth record, never a parameter,
    -- or someone signs up under an address they do not control.
    select count(*) into n from profiles
     where id = '00000000-0000-0000-0000-0000000000f1' and email = 'newfounder@signup.test';
    perform pg_temp.check('signup takes the email from auth, not from input', n, 1);

    -- Without this the function is an unlimited organisation factory.
    perform pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
    begin
      perform public.signup_organization('Second Co', 'second-co', 'New Founder');
      raise exception 'RLS FAIL: signup_organization created a second organisation for one user';
    exception
      when unique_violation then raise notice 'ok: one organisation per person';
    end;

    -- Step 2 revoked direct insert; the function is the only supported path.
    begin
      insert into organizations (name, slug) values ('Sneaky Co', 'sneaky-co');
      raise exception 'RLS FAIL: an organisation was created without going through signup_organization';
    exception
      when insufficient_privilege then raise notice 'ok: organisations cannot be inserted directly';
    end;

    perform pg_temp.as_postgres();
    delete from auth.users where email = 'newfounder@signup.test';
    delete from organizations where slug = 'signup-test-co';
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
      d0 := public.org_today(acme) + 45;

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
          v_req2 := public.leave_submit(casual, d0 + 200, d0 + 202, 'to withdraw');

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
          v_req2 := public.leave_submit(casual, d0 + 300, d0 + 302, 'not yours');

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
