-- NEUVTO WOS — RLS verification
-- Raises an exception on the first violation. Silence means pass.
-- Run after every build step, against every environment.
--
-- Requires seed_test_data.sql to have run first (needs two orgs to be meaningful).

create or replace function pg_temp.as_user(_uid uuid) returns void as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', _uid::text, 'role', 'authenticated')::text, true);
end $$ language plpgsql;

create or replace function pg_temp.check(_label text, _actual bigint, _expected bigint) returns void as $$
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
  priya   uuid := '00000000-0000-0000-0000-00000000a006';
  mark    uuid := '00000000-0000-0000-0000-00000000a004';
  alice   uuid := '00000000-0000-0000-0000-00000000a001';
  bob     uuid := '00000000-0000-0000-0000-00000000b001';
  ghost   uuid := '00000000-0000-0000-0000-0000000000ff';
  n       bigint;
begin
  ---------------------------------------------------------------- tenant isolation
  perform pg_temp.as_user(alice);
  select count(*) into n from profiles where organization_id = vertex;
  perform pg_temp.check('acme org_admin sees no vertex profiles', n, 0);

  select count(*) into n from leave_requests where organization_id = vertex;
  perform pg_temp.check('acme org_admin sees no vertex leave requests', n, 0);

  select count(*) into n from leave_balances where organization_id = vertex;
  perform pg_temp.check('acme org_admin sees no vertex balances', n, 0);

  select count(*) into n from holidays where organization_id = vertex;
  perform pg_temp.check('acme org_admin sees no vertex holidays', n, 0);

  perform pg_temp.as_user(bob);
  select count(*) into n from profiles where organization_id = acme;
  perform pg_temp.check('vertex org_admin sees no acme profiles', n, 0);

  ---------------------------------------------------------------- orphan user
  -- Authenticated but has no profile row: must see nothing anywhere.
  perform pg_temp.as_user(ghost);
  select count(*) into n from profiles;         perform pg_temp.check('orphan sees no profiles', n, 0);
  select count(*) into n from leave_requests;   perform pg_temp.check('orphan sees no requests', n, 0);
  select count(*) into n from organizations;    perform pg_temp.check('orphan sees no orgs', n, 0);

  ---------------------------------------------------------------- employee scope
  perform pg_temp.as_user(ravi);
  select count(*) into n from leave_balances where employee_id <> ravi;
  perform pg_temp.check('employee sees only own balances', n, 0);

  select count(*) into n from leave_requests where employee_id <> ravi;
  perform pg_temp.check('employee sees only own requests', n, 0);

  ---------------------------------------------------------------- privilege escalation
  begin
    insert into user_roles (user_id, organization_id, role) values (ravi, acme, 'org_admin');
    raise exception 'RLS FAIL: employee was able to grant themselves org_admin';
  exception
    when insufficient_privilege or check_violation then
      raise notice 'ok: employee cannot self-promote';
  end;

  begin
    update profiles set organization_id = vertex where id = ravi;
    -- If this silently affected 0 rows that is also acceptable; a success is not.
    get diagnostics n = row_count;
    perform pg_temp.check('employee cannot move themselves between orgs', n, 0);
  exception
    when insufficient_privilege then raise notice 'ok: employee cannot change own org';
  end;

  ---------------------------------------------------------------- manager scope
  perform pg_temp.as_user(mark);
  select count(*) into n from leave_requests
    where employee_id not in (select id from profiles where manager_id = mark)
      and employee_id <> mark;
  perform pg_temp.check('manager sees only own and direct reports requests', n, 0);

  ---------------------------------------------------------------- audit immutability
  perform pg_temp.as_user(alice);
  if exists (select 1 from information_schema.tables where table_name = 'audit_logs') then
    begin
      update audit_logs set action = 'tampered' where true;
      get diagnostics n = row_count;
      perform pg_temp.check('audit_logs not updatable even by org_admin', n, 0);
    exception
      when insufficient_privilege then raise notice 'ok: audit_logs not updatable';
    end;

    begin
      delete from audit_logs where true;
      get diagnostics n = row_count;
      perform pg_temp.check('audit_logs not deletable even by org_admin', n, 0);
    exception
      when insufficient_privilege then raise notice 'ok: audit_logs not deletable';
    end;
  end if;

  ---------------------------------------------------------------- soft delete (D17)
  -- The filter must live in the policy. If it lives only in application queries,
  -- this test passes here and leaks in production.
  if exists (select 1 from information_schema.columns
             where table_name = 'leave_requests' and column_name = 'deleted_at') then

    perform pg_temp.as_user(alice);   -- org_admin: the widest normal read
    select count(*) into n from leave_requests where deleted_at is not null;
    perform pg_temp.check('soft-deleted requests invisible to org_admin', n, 0);

    perform pg_temp.as_user(ravi);    -- employee
    select count(*) into n from leave_requests where deleted_at is not null;
    perform pg_temp.check('soft-deleted requests invisible to employee', n, 0);

    perform pg_temp.as_user(mark);    -- manager
    select count(*) into n from profiles where deleted_at is not null;
    perform pg_temp.check('soft-deleted profiles invisible to manager', n, 0);
  end if;

  ---------------------------------------------------------------- audit fields (D16)
  -- created_by must not be forgeable: an employee cannot claim another user wrote a row.
  if exists (select 1 from information_schema.columns
             where table_name = 'leave_requests' and column_name = 'created_by') then
    perform pg_temp.as_user(ravi);
    begin
      insert into leave_requests
        (organization_id, employee_id, leave_type_id, from_date, to_date,
         working_days, status, created_by)
      values
        (acme, ravi, '00000000-0000-0000-0000-0000000000c1','2027-06-01','2027-06-01',
         1,'draft', alice);   -- claiming to be the admin

      select count(*) into n from leave_requests
      where from_date = '2027-06-01' and created_by = alice;
      perform pg_temp.check('created_by cannot be forged', n, 0);
    exception
      when insufficient_privilege then
        raise notice 'ok: forged created_by rejected outright';
    end;
  end if;

  raise notice '--- RLS verification passed ---';
end $$;

reset role;
