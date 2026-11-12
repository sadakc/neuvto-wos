-- NEUVTO WOS — the Employee Master's three record rules, as constraints (D82)
--
-- Raises on the first violation. Silence means pass. Rolled back.
--
-- PHASE-AWARE: exits quietly if public.employees does not exist yet.
--
-- Each rule is proved twice: the thing it allows works, and the thing it
-- forbids is refused for the right reason. A refusal checked only by "it
-- raised something" passes when the table is missing, so every refusal here
-- names the exception it expects.

begin;

create or replace function pg_temp.em_ok(_label text) returns void as $$
begin raise notice 'ok: %', _label; end $$ language plpgsql;

create or replace function pg_temp.em_refused(_label text, _sql text, _needle text) returns void as $$
declare v_msg text;
begin
  begin
    execute _sql;
    -- Deferred constraint triggers fire at commit; make them fire now.
    execute 'set constraints all immediate';
    execute 'set constraints all deferred';
  exception when others then
    v_msg := sqlerrm;
  end;
  if v_msg is null then
    raise exception 'EMPLOYEE-MASTER FAIL: % — it was allowed', _label;
  end if;
  if v_msg not ilike '%' || _needle || '%' then
    raise exception 'EMPLOYEE-MASTER FAIL: % — refused for the wrong reason: %', _label, v_msg;
  end if;
  perform pg_temp.em_ok(_label);
end $$ language plpgsql;

create or replace function pg_temp.em_as(_uid uuid) returns void as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', _uid::text, 'role', 'authenticated')::text, true);
end $$ language plpgsql;

create or replace function pg_temp.em_root() returns void as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$ language plpgsql;

do $$
declare
  acme   uuid := '00000000-0000-0000-0000-0000000000a0';
  vertex uuid := '00000000-0000-0000-0000-0000000000b0';
  alice  uuid := '00000000-0000-0000-0000-00000000a001';
  priya  uuid := '00000000-0000-0000-0000-00000000a005';
  bob    uuid := '00000000-0000-0000-0000-00000000b001';
  e      uuid;  -- priya's record
  hq     uuid;
  site   uuid;
  theirs uuid;  -- a Vertex unit
  addr   uuid;
  ver    uuid;
  n      integer;
begin
  if to_regclass('public.employees') is null then
    raise notice 'skip: the employee master does not exist yet';
    return;
  end if;

  -- ── 0 · everybody with a profile has exactly one record
  select count(*) into n from public.profiles p
   where p.deleted_at is null
     and (select count(*) from public.employees x where x.profile_id = p.id) <> 1;
  if n > 0 then
    raise exception 'EMPLOYEE-MASTER FAIL: % profiles do not have exactly one employee record', n;
  end if;
  perform pg_temp.em_ok('every profile has exactly one employee record');

  select id into e from public.employees where profile_id = priya;

  insert into public.deployment_units (organization_id, name, unit_type) values
    (acme, 'Acme HQ, Bengaluru', 'own_establishment') returning id into hq;
  insert into public.deployment_units (organization_id, name, unit_type, client_name) values
    (acme, 'Tata AIG, Hosur', 'client_site', 'Tata AIG') returning id into site;
  insert into public.deployment_units (organization_id, name, unit_type) values
    (vertex, 'Vertex Depot', 'own_establishment') returning id into theirs;

  -- ── 1 · repeating things repeat without a limit
  insert into public.family_members (organization_id, employee_id, relation, name) values
    (acme, e, 'son', 'Aarav'), (acme, e, 'son', 'Vihaan'), (acme, e, 'son', 'Kabir');
  select count(*) into n from public.family_members where employee_id = e and relation = 'son';
  if n <> 3 then raise exception 'EMPLOYEE-MASTER FAIL: three sons became %', n; end if;
  perform pg_temp.em_ok('a third son is a row, not a missing column');

  -- ── 2 · history is closed, never overwritten
  insert into public.employee_addresses
    (organization_id, employee_id, address_type, line, city, state, pincode, effective_from)
  values (acme, e, 'present', '402 Brigade Meadows', 'Bengaluru', 'Karnataka', '560062', '2024-03-01')
  returning id into addr;

  perform pg_temp.em_refused('a second open address of the same type is refused',
    format($q$insert into public.employee_addresses
       (organization_id, employee_id, address_type, line, city, state, pincode, effective_from)
       values (%L, %L, 'present', '9 Elsewhere', 'Pune', 'Maharashtra', '411001', '2025-01-01')$q$, acme, e),
    'employee_addresses_never_overlap');

  perform pg_temp.em_refused('an open address cannot be edited in place',
    format($q$update public.employee_addresses set city = 'Mysuru' where id = %L$q$, addr),
    'USE_A_NEW_ROW');

  -- The correct move: close it, then add the successor from the next day.
  update public.employee_addresses set effective_to = '2025-01-01' where id = addr;
  insert into public.employee_addresses
    (organization_id, employee_id, address_type, line, city, state, pincode, effective_from)
  values (acme, e, 'present', '9 Elsewhere', 'Pune', 'Maharashtra', '411001', '2025-01-01');
  perform pg_temp.em_ok('closing a row and adding its successor keeps both');

  perform pg_temp.em_refused('a closed address is immutable',
    format($q$update public.employee_addresses set pincode = '560063' where id = %L$q$, addr),
    'ARCHIVED_IMMUTABLE');
  perform pg_temp.em_refused('a closed address cannot be reopened',
    format($q$update public.employee_addresses set effective_to = null where id = %L$q$, addr),
    'ARCHIVED_IMMUTABLE');
  perform pg_temp.em_refused('history is never deleted',
    format($q$delete from public.employee_addresses where id = %L$q$, addr),
    'HISTORY_IS_NEVER_DELETED');
  perform pg_temp.em_refused('a pincode is six digits',
    format($q$insert into public.employee_addresses
       (organization_id, employee_id, address_type, line, city, state, pincode, effective_from)
       values (%L, %L, 'permanent', 'x', 'y', 'z', '56006', '2024-01-01')$q$, acme, e),
    'employee_addresses_pincode_check');

  -- Deployments: one posting at a time, in the employee's own organisation.
  insert into public.employee_deployments
    (organization_id, employee_id, deployment_unit_id, effective_from, deployment_order_ref)
  values (acme, e, hq, '2024-01-01', 'DO-2024-0001');
  perform pg_temp.em_refused('two postings at once are refused',
    format($q$insert into public.employee_deployments
       (organization_id, employee_id, deployment_unit_id, effective_from, deployment_order_ref)
       values (%L, %L, %L, '2025-06-01', 'DO-2025-0042')$q$, acme, e, site),
    'employee_deployments_never_overlap');
  perform pg_temp.em_refused('a posting to another company''s unit is refused',
    format($q$insert into public.employee_deployments
       (organization_id, employee_id, deployment_unit_id, effective_from, deployment_order_ref)
       values (%L, %L, %L, '2030-01-01', 'DO-X')$q$, acme, e, theirs),
    'CROSS_ORGANISATION_ROW');
  perform pg_temp.em_refused('a posting needs an order reference',
    format($q$insert into public.employee_deployments
       (organization_id, employee_id, deployment_unit_id, effective_from, deployment_order_ref)
       values (%L, %L, %L, '2031-01-01', '  ')$q$, acme, e, site),
    'deployment_order_ref');

  -- ── 3 · nominees: a version, totalling exactly 100, never edited
  insert into public.nomination_versions (organization_id, employee_id, effective_from)
  values (acme, e, '2024-01-01') returning id into ver;
  perform pg_temp.em_refused('shares that total 90 are refused',
    format($q$insert into public.nominees (organization_id, version_id, name, relation, share_percent)
       values (%L, %L, 'Lakshmi', 'wife', 60), (%L, %L, 'Aarav', 'son', 30)$q$, acme, ver, acme, ver),
    'NOMINEE_SHARES_NOT_100');
  insert into public.nominees (organization_id, version_id, name, relation, share_percent)
  values (acme, ver, 'Lakshmi', 'wife', 70), (acme, ver, 'Aarav', 'son', 30);
  set constraints all immediate;
  set constraints all deferred;
  perform pg_temp.em_ok('shares that total 100 are accepted');
  perform pg_temp.em_refused('a nominee is never edited, the nomination is superseded',
    format($q$update public.nominees set share_percent = 50 where version_id = %L and name = 'Lakshmi'$q$, ver),
    'NOMINATION_IS_VERSIONED');

  -- ── 4 · managed lists are retired, never deleted
  perform pg_temp.em_refused('a deployment unit cannot be deleted',
    format($q$delete from public.deployment_units where id = %L$q$, hq), 'RETIRE_DO_NOT_DELETE');
  perform pg_temp.em_refused('a deployment unit cannot be soft-deleted either',
    format($q$update public.deployment_units set deleted_at = now() where id = %L$q$, hq),
    'RETIRE_DO_NOT_DELETE');
  update public.deployment_units set status = 'retired' where id = hq;
  perform pg_temp.em_ok('a unit is retired, and its postings still point at it');
  perform pg_temp.em_refused('a client site names its client',
    format($q$insert into public.deployment_units (organization_id, name, unit_type)
       values (%L, 'Mystery Site', 'client_site')$q$, acme),
    'deployment_units_client_matches_type');

  -- ── 5 · access: nobody reads the record directly
  perform pg_temp.em_as(alice);
  perform pg_temp.em_refused('even a Super Admin cannot select employees directly',
    'select count(*) from public.employees', 'permission denied');
  perform pg_temp.em_refused('or anybody''s family',
    'select count(*) from public.family_members', 'permission denied');
  select count(*) into n from public.deployment_units;
  perform pg_temp.em_root();
  if n <> 2 then
    raise exception 'EMPLOYEE-MASTER FAIL: Acme sees % deployment units, expected its own 2', n;
  end if;
  perform pg_temp.em_ok('managed lists are readable, and only your own company''s');

  perform pg_temp.em_as(bob);
  select count(*) into n from public.deployment_units where organization_id = acme;
  perform pg_temp.em_root();
  if n <> 0 then raise exception 'EMPLOYEE-MASTER FAIL: Vertex can see Acme''s units'; end if;
  perform pg_temp.em_ok('another company''s units are invisible');

  -- ── 6 · a declared purge can remove what the product never may
  perform set_config('neuvto.purge', 'on', true);
  delete from public.employee_addresses where employee_id = e;
  perform set_config('neuvto.purge', '', true);
  perform pg_temp.em_ok('an operator''s declared purge is the only way history is removed');
end $$;

rollback;
