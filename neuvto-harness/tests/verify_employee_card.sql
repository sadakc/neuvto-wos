-- NEUVTO WOS — the Employee Card answers by role (E5, NEUVTO_EMPLOYEE_MASTER §5)
--
-- Raises on the first violation. Silence means pass. Rolled back.
--
-- PHASE-AWARE: exits quietly if public.employee_card does not exist yet.
--
-- Every "may not see" here is checked as ABSENT from the JSON, not as null: a
-- key that is present and null still tells the browser the field exists, and
-- a test that only checks for null passes when the shaping is removed and the
-- person simply has no value recorded. So each person below HAS a value for
-- every field whose absence is asserted.

begin;

create or replace function pg_temp.ec_as(_uid uuid) returns void as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', _uid::text, 'role', 'authenticated')::text, true);
end $$ language plpgsql;

create or replace function pg_temp.ec_root() returns void as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$ language plpgsql;

create or replace function pg_temp.ec_card(_as uuid, _of uuid) returns jsonb as $$
declare v jsonb;
begin
  perform pg_temp.ec_as(_as);
  v := public.employee_card(_of);
  perform pg_temp.ec_root();
  return v;
end $$ language plpgsql;

/** Fails unless every key in _has is present and every key in _lacks is absent. */
create or replace function pg_temp.ec_shape(_label text, _card jsonb, _has text[], _lacks text[])
returns void as $$
declare k text;
begin
  foreach k in array _has loop
    if not (_card ? k) then
      raise exception 'EMPLOYEE-CARD FAIL: % — "%" is missing', _label, k;
    end if;
  end loop;
  foreach k in array _lacks loop
    if _card ? k then
      raise exception 'EMPLOYEE-CARD FAIL: % — "%" was sent and must not be', _label, k;
    end if;
  end loop;
  raise notice 'ok: %', _label;
end $$ language plpgsql;

create or replace function pg_temp.ec_refused(_label text, _as uuid, _sql text, _needle text)
returns void as $$
declare v_msg text;
begin
  perform pg_temp.ec_as(_as);
  begin
    execute _sql;
  exception when others then
    v_msg := sqlerrm;
  end;
  perform pg_temp.ec_root();
  if v_msg is null then
    raise exception 'EMPLOYEE-CARD FAIL: % — it was allowed', _label;
  end if;
  if v_msg not ilike '%' || _needle || '%' then
    raise exception 'EMPLOYEE-CARD FAIL: % — refused for the wrong reason: %', _label, v_msg;
  end if;
  raise notice 'ok: %', _label;
end $$ language plpgsql;

do $$
declare
  acme   uuid := '00000000-0000-0000-0000-0000000000a0';
  vertex uuid := '00000000-0000-0000-0000-0000000000b0';
  alice  uuid := '00000000-0000-0000-0000-00000000a001';  -- admin
  dan    uuid := '00000000-0000-0000-0000-00000000a003';  -- Mark's manager, not Priya's
  mark   uuid := '00000000-0000-0000-0000-00000000a004';  -- Priya's manager
  ravi   uuid := '00000000-0000-0000-0000-00000000a005';  -- Priya's colleague
  priya  uuid := '00000000-0000-0000-0000-00000000a006';
  joiner uuid := '00000000-0000-0000-0000-00000000a007';  -- made statutory below
  noman  uuid := '00000000-0000-0000-0000-00000000a008';  -- made payroll below
  bob    uuid := '00000000-0000-0000-0000-00000000b001';  -- Vertex admin
  e      uuid;
  sara_e uuid;
  ver    uuid;
  unit   uuid;
  c      jsonb;
  n      integer;
  personal text[] := array['dateOfBirth','age','sex','maritalStatus','personalEmail',
                           'bloodGroup','physical','previousOrganisations','nameAsPerId'];
begin
  if to_regprocedure('public.employee_card(uuid)') is null then
    raise notice 'skip: the employee card does not exist yet';
    return;
  end if;

  insert into public.organization_modules (organization_id, module_key, enabled, enabled_at)
  values (acme, 'employee', true, now()), (vertex, 'employee', true, now())
  on conflict (organization_id, module_key) do update set enabled = true, deleted_at = null;

  insert into public.user_roles (user_id, organization_id, role) values
    (noman, acme, 'payroll_officer'), (joiner, acme, 'statutory_officer');

  -- Give Priya a value in every field whose absence is asserted.
  select id into e from public.employees where profile_id = priya;
  select id into sara_e from public.employees
   where profile_id = '00000000-0000-0000-0000-00000000b002';
  update public.employees set
    date_of_birth = '1994-06-12', sex = 'female', marital_status = 'married',
    personal_email = 'priya@home.test', blood_group = 'B+', name_as_per_id = 'PRIYA E',
    emergency_contact_name = 'Lakshmi', emergency_contact_relation = 'mother',
    emergency_contact_phone = '9800000000', nearest_police_station = 'Yelahanka'
   where id = e;
  insert into public.employee_addresses
    (organization_id, employee_id, address_type, line, city, state, pincode, effective_from)
  values (acme, e, 'present', '402 Brigade Meadows', 'Bengaluru', 'Karnataka', '560062', '2024-03-01');
  insert into public.family_members (organization_id, employee_id, relation, name)
  values (acme, e, 'mother', 'Lakshmi');
  insert into public.deployment_units (organization_id, name, unit_type)
  values (acme, 'Acme HQ', 'own_establishment') returning id into unit;
  insert into public.employee_deployments
    (organization_id, employee_id, deployment_unit_id, effective_from, deployment_order_ref)
  values (acme, e, unit, '2024-04-01', 'DO-1');
  insert into public.nomination_versions (organization_id, employee_id, effective_from)
  values (acme, e, '2024-04-01') returning id into ver;
  insert into public.nominees (organization_id, version_id, name, relation, share_percent)
  values (acme, ver, 'Lakshmi', 'mother', 100);
  set constraints all immediate;
  set constraints all deferred;

  -- ── self: everything on the card
  c := pg_temp.ec_card(priya, null);
  if (c->>'id')::uuid is distinct from e then
    raise exception 'EMPLOYEE-CARD FAIL: no argument did not return your own card';
  end if;
  perform pg_temp.ec_shape('you see your whole card', c,
    personal || array['emergencyContact','addresses','familyMembers','nominations','deployments'],
    array[]::text[]);
  if (c->'capabilities'->>'canRequestChange')::boolean is not true
     or (c->'capabilities'->>'canEdit')::boolean is not false then
    raise exception 'EMPLOYEE-CARD FAIL: self should request changes, not edit';
  end if;

  -- ── colleague: who they are and where they work, nothing more
  perform pg_temp.ec_shape('a colleague sees the work card only', pg_temp.ec_card(ravi, e),
    array['fullName','workEmail','designation','department','reportsTo','currentDeployment'],
    personal || array['emergencyContact','addresses','nearestPoliceStation','familyMembers',
                      'nominations','deployments','totalExperienceMonths']);

  -- ── a manager one step removed is just a colleague
  perform pg_temp.ec_shape('a manager''s manager is not the approver', pg_temp.ec_card(dan, e),
    array['fullName'], array['emergencyContact','totalExperienceMonths']);

  -- ── approver: the emergency contact, not the home
  perform pg_temp.ec_shape('the approver sees whom to call, not where they live',
    pg_temp.ec_card(mark, e),
    array['emergencyContact','totalExperienceMonths'],
    personal || array['addresses','nearestPoliceStation','familyMembers','nominations','deployments']);

  -- ── payroll: family, nominations, postings; not the home, not the birthday
  perform pg_temp.ec_shape('payroll sees family, nominees and postings', pg_temp.ec_card(noman, e),
    array['familyMembers','nominations','deployments'],
    personal || array['addresses','emergencyContact']);

  -- ── statutory: addresses too
  c := pg_temp.ec_card(joiner, e);
  perform pg_temp.ec_shape('statutory sees addresses and the police station', c,
    array['addresses','nearestPoliceStation','familyMembers','nominations'],
    personal || array['emergencyContact']);
  if (c->'capabilities'->>'canRevealStatutory')::boolean is not true then
    raise exception 'EMPLOYEE-CARD FAIL: statutory is not offered the reveal';
  end if;

  -- ── admin: everything, and may edit
  c := pg_temp.ec_card(alice, e);
  perform pg_temp.ec_shape('an admin sees everything', c,
    personal || array['emergencyContact','addresses','familyMembers','nominations','deployments'],
    array[]::text[]);
  if (c->'capabilities'->>'canEdit')::boolean is not true then
    raise exception 'EMPLOYEE-CARD FAIL: an admin is not offered edit';
  end if;

  -- ── other companies: indistinguishable from absent
  perform pg_temp.ec_refused('another company''s card is NOT_FOUND', bob,
    format('select public.employee_card(%L)', e), 'NOT_FOUND');
  perform pg_temp.ec_refused('even from their own admin', alice,
    format('select public.employee_card(%L)', sara_e), 'NOT_FOUND');
  perform pg_temp.ec_refused('a made-up id is NOT_FOUND too', alice,
    format('select public.employee_card(%L)', gen_random_uuid()), 'NOT_FOUND');

  -- ── the helpers are not callable from outside
  perform pg_temp.ec_refused('the relationship helper is not exposed', alice,
    format('select public.employee_relationship(%L)', e), 'permission denied');

  -- ── directory and org chart: own company only
  perform pg_temp.ec_as(ravi);
  select count(*) into n from public.employee_directory(null) d where d.id = sara_e;
  perform pg_temp.ec_root();
  if n <> 0 then raise exception 'EMPLOYEE-CARD FAIL: the directory lists another company'; end if;
  perform pg_temp.ec_as(ravi);
  select count(*) into n from public.employee_directory('priya');
  perform pg_temp.ec_root();
  if n <> 1 then raise exception 'EMPLOYEE-CARD FAIL: searching "priya" found %', n; end if;
  raise notice 'ok: the directory is the caller''s company, and it searches';

  perform pg_temp.ec_as(ravi);
  select count(*) into n from public.employee_org_chart() o
   where o.profile_id = priya and o.manager_profile_id = mark;
  perform pg_temp.ec_root();
  if n <> 1 then raise exception 'EMPLOYEE-CARD FAIL: the org chart lost Priya→Mark'; end if;
  raise notice 'ok: the org chart has the reporting line';

  -- ── module off: every reader says so
  update public.organization_modules set enabled = false
   where organization_id = acme and module_key = 'employee';
  perform pg_temp.ec_refused('module off: the card refuses', priya,
    'select public.employee_card(null)', 'MODULE_NOT_ENABLED');
  perform pg_temp.ec_refused('module off: the directory refuses', priya,
    'select * from public.employee_directory(null)', 'MODULE_NOT_ENABLED');
  perform pg_temp.ec_refused('module off: the org chart refuses', priya,
    'select * from public.employee_org_chart()', 'MODULE_NOT_ENABLED');
end $$;

rollback;
