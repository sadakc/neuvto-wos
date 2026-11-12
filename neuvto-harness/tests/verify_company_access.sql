-- NEUVTO WOS — a company runs its own access, and only a Super Admin hands out
-- administrator rights (D78)
--
-- Raises on the first violation. Silence means pass. Every case runs as a real
-- seeded person through the real functions, and the whole suite is rolled back.
--
-- PHASE-AWARE: exits quietly if member_set_roles does not exist yet.
--
-- Requires seed_test_data.sql. Note what the seed does NOT do: it grants no
-- super_admin. Alice and Bob hold org_admin only, exactly as a provisioned
-- administrator does on acceptance; if they are Super Admins below, the trigger
-- made them so, and verify_first_run.sql proves the same from a workspace that
-- was never seeded at all.

begin;

create or replace function pg_temp.ca_as(_uid uuid) returns void as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', _uid::text, 'role', 'authenticated')::text, true);
end $$ language plpgsql;

create or replace function pg_temp.ca_root() returns void as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$ language plpgsql;

create or replace function pg_temp.ca_ok(_label text) returns void as $$
begin
  raise notice 'ok: %', _label;
end $$ language plpgsql;

/** Runs _sql as _uid and requires it to be refused with _needle in the message. */
create or replace function pg_temp.ca_refused(_label text, _uid uuid, _sql text, _needle text)
returns void as $$
declare
  v_refused boolean := false;
  v_msg text;
begin
  begin
    if _uid is null then perform pg_temp.ca_root(); else perform pg_temp.ca_as(_uid); end if;
    execute _sql;
  exception when others then
    v_refused := true;
    v_msg := sqlerrm;
  end;
  perform pg_temp.ca_root();
  if not v_refused then
    raise exception 'COMPANY-ACCESS FAIL: % — it was allowed', _label;
  end if;
  if v_msg not ilike '%' || _needle || '%' then
    raise exception 'COMPANY-ACCESS FAIL: % — refused, but for the wrong reason: %', _label, v_msg;
  end if;
  perform pg_temp.ca_ok(_label);
end $$ language plpgsql;

/** Runs _sql as _uid and requires it to succeed. */
create or replace function pg_temp.ca_allowed(_label text, _uid uuid, _sql text) returns void as $$
begin
  perform pg_temp.ca_as(_uid);
  execute _sql;
  perform pg_temp.ca_root();
  perform pg_temp.ca_ok(_label);
exception when others then
  perform pg_temp.ca_root();
  raise exception 'COMPANY-ACCESS FAIL: % — refused: %', _label, sqlerrm;
end $$ language plpgsql;

create or replace function pg_temp.ca_holds(_uid uuid, _role text) returns boolean as $$
  select exists (select 1 from public.user_roles
                  where user_id = _uid and role::text = _role and deleted_at is null)
$$ language sql;

do $$
declare
  alice uuid := '00000000-0000-0000-0000-00000000a001';  -- org_admin, first in Acme
  hema  uuid := '00000000-0000-0000-0000-00000000a002';  -- hr_admin
  dan   uuid := '00000000-0000-0000-0000-00000000a003';  -- manager, has reports
  priya uuid := '00000000-0000-0000-0000-00000000a005';  -- employee
  ravi  uuid := '00000000-0000-0000-0000-00000000a006';  -- employee
  emp   uuid := '00000000-0000-0000-0000-00000000a007';  -- employee, untouched below
  bob   uuid := '00000000-0000-0000-0000-00000000b001';  -- org_admin, Vertex
begin
  if to_regprocedure('public.member_set_roles(uuid, public.app_role[])') is null then
    raise notice 'skip: member_set_roles does not exist yet';
    return;
  end if;

  -- ── 1 · the first Administrator is the Super Admin, and only the first
  if not pg_temp.ca_holds(alice, 'super_admin') then
    raise exception 'COMPANY-ACCESS FAIL: Acme''s first administrator was not made Super Admin';
  end if;
  if not pg_temp.ca_holds(bob, 'super_admin') then
    raise exception 'COMPANY-ACCESS FAIL: Vertex''s first administrator was not made Super Admin';
  end if;
  if pg_temp.ca_holds(hema, 'super_admin') then
    raise exception 'COMPANY-ACCESS FAIL: an hr_admin became Super Admin without being made one';
  end if;
  perform pg_temp.ca_ok('each organisation''s first administrator, and nobody else, is Super Admin');

  -- ── 2 · an Admin cannot make an Admin. The headline rule, from every side.
  perform pg_temp.ca_refused('an hr_admin cannot grant org_admin', hema,
    format('select public.member_set_roles(%L, ''{manager,org_admin}'')', dan),
    'ROLE_NOT_YOURS_TO_GRANT');
  perform pg_temp.ca_refused('an hr_admin cannot grant super_admin', hema,
    format('select public.member_set_roles(%L, ''{employee,super_admin}'')', priya),
    'ROLE_NOT_YOURS_TO_GRANT');
  perform pg_temp.ca_refused('an hr_admin cannot grant the Statutory role', hema,
    format('select public.member_set_roles(%L, ''{employee,statutory_officer}'')', priya),
    'ROLE_NOT_YOURS_TO_GRANT');
  -- D110: an invitation comes from a record; marked as employee_send_invite marks it.
  perform set_config('neuvto.inviting', 'record', true);
  perform pg_temp.ca_refused('an hr_admin cannot invite an org_admin either', hema,
    $q$select public.invitation_create('new.admin@acme.test', null, 'org_admin', 'New Admin')$q$,
    'ROLE_NOT_YOURS_TO_GRANT');
  perform set_config('neuvto.inviting', '', true);
  -- The old way round: straight at the table, which four policies used to allow.
  perform pg_temp.ca_refused('an hr_admin cannot insert a role row directly', hema,
    format($q$insert into public.user_roles (user_id, organization_id, role)
              values (%L, '00000000-0000-0000-0000-0000000000a0', 'org_admin')$q$, hema),
    'permission denied');
  perform pg_temp.ca_refused('a Super Admin cannot write the table directly either', alice,
    format('update public.user_roles set deleted_at = now() where user_id = %L', priya),
    'permission denied');

  -- ── 3 · what an Admin may do: approver roles
  perform pg_temp.ca_allowed('an hr_admin may make an employee a supervisor', hema,
    format('select public.member_set_roles(%L, ''{employee,supervisor}'')', priya));
  if not pg_temp.ca_holds(priya, 'supervisor') then
    raise exception 'COMPANY-ACCESS FAIL: member_set_roles returned but priya is not a supervisor';
  end if;

  -- ── 4 · what a Super Admin may do
  perform pg_temp.ca_allowed('a Super Admin may make somebody an org_admin', alice,
    format('select public.member_set_roles(%L, ''{employee,org_admin}'')', ravi));
  perform pg_temp.ca_allowed('a Super Admin may make somebody a Super Admin', alice,
    format('select public.member_set_roles(%L, ''{hr_admin,super_admin}'')', hema));
  perform pg_temp.ca_allowed('a Super Admin may grant Payroll and Statutory', alice,
    format('select public.member_set_roles(%L, ''{employee,payroll_officer,statutory_officer}'')', priya));
  if not (pg_temp.ca_holds(ravi, 'org_admin') and pg_temp.ca_holds(hema, 'super_admin')
          and pg_temp.ca_holds(priya, 'statutory_officer')) then
    raise exception 'COMPANY-ACCESS FAIL: a Super Admin''s grants did not land';
  end if;
  -- A role removed is soft-deleted, kept for the audit trail, and restorable.
  if not exists (select 1 from public.user_roles
                  where user_id = priya and role = 'supervisor' and deleted_at is not null) then
    raise exception 'COMPANY-ACCESS FAIL: a removed role was hard-deleted, losing who held it';
  end if;
  perform pg_temp.ca_allowed('a removed role can be granted back', alice,
    format('select public.member_set_roles(%L, ''{employee,supervisor}'')', priya));
  perform pg_temp.ca_ok('removed roles are soft-deleted and restorable');

  -- ── 5 · nobody changes their own roles, not even a Super Admin
  perform pg_temp.ca_refused('a Super Admin cannot change their own roles', alice,
    format('select public.member_set_roles(%L, ''{employee}'')', alice),
    'CANNOT_CHANGE_OWN_ROLES');

  -- ── 6 · the last Super Admin stays, by every path
  -- Hema is a Super Admin now (case 4). Take it back, so Alice is the only one.
  perform pg_temp.ca_allowed('one Super Admin may remove another', alice,
    format('select public.member_set_roles(%L, ''{hr_admin}'')', hema));
  perform pg_temp.ca_refused('the last Super Admin''s role cannot be soft-deleted', null,
    format($q$update public.user_roles set deleted_at = now()
              where user_id = %L and role = 'super_admin'$q$, alice),
    'LAST_SUPER_ADMIN');
  perform pg_temp.ca_refused('the last Super Admin cannot be deactivated', null,
    format('update public.profiles set is_active = false where id = %L', alice),
    'LAST_SUPER_ADMIN');
  -- A hard DELETE is not guarded, deliberately: nobody signed in can issue one
  -- (case 2), and an operator removing a whole workspace must be able to.

  -- ── 7 · D57 from the other side
  perform pg_temp.ca_refused('somebody with reports keeps a role that approves', alice,
    format('select public.member_set_roles(%L, ''{employee}'')', dan),
    'STILL_HAS_REPORTS');

  -- ── 8 · tenancy and the plain refusals
  perform pg_temp.ca_refused('a Super Admin cannot touch another company''s people', alice,
    format('select public.member_set_roles(%L, ''{employee}'')', bob),
    'NOT_FOUND');
  perform pg_temp.ca_refused('an employee changes nobody''s roles', emp,
    format('select public.member_set_roles(%L, ''{employee,manager}'')', dan),
    'FORBIDDEN');
end $$;

rollback;
