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

  perform pg_temp.as_user(alice);
  select count(*) into n from analytics_events;
  perform pg_temp.check('org_admin can read own-org analytics events', n, 1);

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

  perform pg_temp.as_postgres();
  raise notice '--- RLS verification passed ---';
end $$;

reset role;
