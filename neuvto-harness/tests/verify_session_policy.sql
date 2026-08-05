-- NEUVTO WOS — session_policy answers by role, and never by accident
--
-- Raises on the first violation. Silence means pass.
--
-- PHASE-AWARE: exits quietly if session_policy does not exist yet.
--
-- Requires seed_test_data.sql: the asymmetry is not testable with one user, and
-- the tenant-isolation case is not testable with one organisation.

create or replace function pg_temp.sp_check(_label text, _actual text, _expected text)
returns void as $$
begin
  if _actual is distinct from _expected then
    raise exception 'SESSION-POLICY FAIL: % — expected %, got %', _label, _expected, _actual;
  end if;
  raise notice 'ok: %', _label;
end $$ language plpgsql;

create or replace function pg_temp.sp_as(_uid uuid) returns void as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', _uid::text, 'role', 'authenticated')::text, true);
end $$ language plpgsql;

create or replace function pg_temp.sp_root() returns void as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$ language plpgsql;

/** Idle minutes for one caller, as that caller. */
create or replace function pg_temp.sp_idle(_uid uuid) returns integer as $$
declare v integer;
begin
  perform pg_temp.sp_as(_uid);
  select idle_minutes into v from public.session_policy();
  perform pg_temp.sp_root();
  return v;
end $$ language plpgsql;

do $$
declare
  acme      uuid := '00000000-0000-0000-0000-0000000000a0';
  vertex    uuid := '00000000-0000-0000-0000-0000000000b0';
  org_admin uuid := '00000000-0000-0000-0000-00000000a001';
  manager   uuid := '00000000-0000-0000-0000-00000000a003';
  employee  uuid := '00000000-0000-0000-0000-00000000a005';
  staff     uuid := '00000000-0000-0000-0000-0000000000e1';
  v_abs     integer;
begin
  if to_regprocedure('public.session_policy()') is null then
    raise notice 'skip: session_policy does not exist yet';
    return;
  end if;

  -- ── 1 · the default is 30, and a new organisation inherits it
  --
  -- D20 shipped this column defaulting to 60 and nothing ever wrote it. If a
  -- later migration reverts the default, every organisation provisioned after
  -- it silently gets the old number and nothing else notices.
  perform pg_temp.sp_check('the column default is 30',
    (select column_default from information_schema.columns
      where table_name = 'organization_settings' and column_name = 'session_idle_minutes'),
    '30');

  -- ── 2 · THE ASYMMETRY (D21's argument, applied to session length)
  --
  -- The whole point of this function. An admin who can export the workforce and
  -- an employee who can see their own balance do not get the same session.
  perform pg_temp.sp_check('an org_admin gets the organisation setting',
    pg_temp.sp_idle(org_admin)::text, '30');
  perform pg_temp.sp_check('a manager gets the organisation setting',
    pg_temp.sp_idle(manager)::text, '30');
  perform pg_temp.sp_check('an employee gets at least 8 hours',
    pg_temp.sp_idle(employee)::text, '480');

  if pg_temp.sp_idle(employee) <= pg_temp.sp_idle(org_admin) then
    raise exception 'SESSION-POLICY FAIL: an employee must get a LONGER idle than an admin — the asymmetry is the feature, not a rounding artefact';
  end if;
  raise notice 'ok: the employee session outlasts the admin session';

  -- ── 3 · the organisation's own number, never another tenant's
  --
  -- Tenant isolation for a setting rather than for data, and just as important:
  -- a policy read across the boundary would let one customer's tightening apply
  -- to another customer's staff.
  perform pg_temp.sp_root();
  update public.organization_settings set session_idle_minutes = 17 where organization_id = acme;
  update public.organization_settings set session_idle_minutes = 45 where organization_id = vertex;

  perform pg_temp.sp_check('an admin reads their OWN organisation''s setting',
    pg_temp.sp_idle(org_admin)::text, '17');

  perform pg_temp.sp_root();
  update public.organization_settings set session_idle_minutes = 30 where organization_id in (acme, vertex);

  -- ── 4 · a tightened organisation setting cannot lengthen an employee's floor,
  --        but a longer one wins
  --
  -- `greatest(setting, 480)` is the rule, and both directions are asserted.
  --
  -- Swapping it for `least` is caught immediately by assertion 2 above, since
  -- least(30, 480) is 30. What these two add is the case assertion 2 cannot
  -- see: a customer who deliberately chooses a number either side of the floor.
  -- Below it, the floor must hold; above it, their choice must win rather than
  -- being clamped back to 480 by a `case` somebody later simplifies.
  perform pg_temp.sp_root();
  update public.organization_settings set session_idle_minutes = 10 where organization_id = acme;
  perform pg_temp.sp_check('a tight org setting does not shorten the employee floor',
    pg_temp.sp_idle(employee)::text, '480');

  perform pg_temp.sp_root();
  update public.organization_settings set session_idle_minutes = 600 where organization_id = acme;
  perform pg_temp.sp_check('an org setting longer than the floor wins',
    pg_temp.sp_idle(employee)::text, '600');

  perform pg_temp.sp_root();
  update public.organization_settings set session_idle_minutes = 30 where organization_id = acme;

  -- ── 5 · D42 — a platform admin has no organisation row at all
  --
  -- The case that would otherwise hand the browser a null, which becomes NaN
  -- minutes, which expires somebody on the first tick. Staff are checked BEFORE
  -- the profile lookup precisely because every lookup returns null for them.
  perform pg_temp.sp_root();
  delete from public.platform_admins where user_id = staff;
  delete from auth.users where id = staff;
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at,
                          raw_app_meta_data, raw_user_meta_data)
  values (staff, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'staff@session.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  insert into public.platform_admins (user_id, note) values (staff, 'harness');

  perform pg_temp.sp_check('a platform admin gets a policy, not a null',
    pg_temp.sp_idle(staff)::text, '30');

  perform pg_temp.sp_as(staff);
  select absolute_hours into v_abs from public.session_policy();
  perform pg_temp.sp_root();
  perform pg_temp.sp_check('and a tighter absolute cap than a tenant', v_abs::text, '8');

  if exists (select 1 from public.profiles where id = staff) then
    raise exception 'SESSION-POLICY FAIL: the platform admin has a profile — this test is no longer exercising the D42 shape';
  end if;
  raise notice 'ok: the platform admin still has no profile, so this tested what it claims';

  perform pg_temp.sp_root();
  delete from public.platform_admins where user_id = staff;
  delete from auth.users where id = staff;

  -- ── 6 · no session is refused, not answered
  --
  -- Answering a caller with no session lets a browser run a timer against
  -- nothing, which looks like it works until the moment it matters.
  begin
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', '', true);
    perform * from public.session_policy();
    perform pg_temp.sp_root();
    raise exception 'SESSION-POLICY FAIL: a caller with no session was given a policy';
  exception when sqlstate 'P0001' then
    perform pg_temp.sp_root();
    if sqlerrm like '%was given a policy%' then raise exception '%', sqlerrm; end if;
    raise notice 'ok: no session is refused rather than answered';
  end;

  -- ── 7 · anon holds no grant
  --
  -- 20260808100000_anon_executes_nothing.sql, and the open relay behind it.
  perform pg_temp.sp_check('anon cannot execute session_policy',
    (select case when has_function_privilege('anon', 'public.session_policy()', 'execute')
            then 'granted' else 'denied' end), 'denied');

  raise notice 'ok: session policy verified';
end $$;
