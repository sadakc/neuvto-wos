-- NEUVTO WOS — fields as long as they need to be (D123)
--
-- Raises on the first violation. Silence means pass. Rolled back.
--
-- PHASE-AWARE: exits quietly if employee_save_family does not refuse a name twice yet.
--
--   lengths   full name, name on ID, account holder 50; other names and short
--             fields 30; a deployment order reference 15; each refused for
--             its length one past the limit, and a value already on record
--             not refused while it is left alone;
--   family    two members with the same name refused; one father still;
--   aadhaar   optional by default.

begin;

create or replace function pg_temp.sf_as(_uid uuid) returns void as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', _uid::text, 'role', 'authenticated')::text, true);
end $$ language plpgsql;

create or replace function pg_temp.sf_root() returns void as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$ language plpgsql;

/** Refused, and for the named reason: the message or its detail. */
create or replace function pg_temp.sf_refused(_label text, _uid uuid, _sql text, _needle text)
returns void as $$
declare v_msg text; v_detail text;
begin
  if _uid is null then perform pg_temp.sf_root(); else perform pg_temp.sf_as(_uid); end if;
  begin
    execute _sql;
  exception when others then
    get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
  end;
  perform pg_temp.sf_root();
  if v_msg is null then
    raise exception 'SHORTER FAIL: % — it was allowed', _label;
  end if;
  if concat_ws(' ', v_msg, v_detail) not ilike '%' || _needle || '%' then
    raise exception 'SHORTER FAIL: % — refused for the wrong reason: % / %', _label, v_msg, v_detail;
  end if;
  raise notice 'ok: %', _label;
end $$ language plpgsql;

create or replace function pg_temp.sf_do(_label text, _uid uuid, _sql text) returns void as $$
begin
  perform pg_temp.sf_as(_uid);
  execute _sql;
  perform pg_temp.sf_root();
  raise notice 'ok: %', _label;
exception when others then
  perform pg_temp.sf_root();
  raise exception 'SHORTER FAIL: % — refused: %', _label, sqlerrm;
end $$ language plpgsql;

create or replace function pg_temp.sf_val(_uid uuid, _sql text) returns text as $$
declare v text;
begin
  perform pg_temp.sf_as(_uid);
  execute _sql into v;
  perform pg_temp.sf_root();
  return v;
exception when others then
  perform pg_temp.sf_root();
  raise exception 'SHORTER FAIL: refused: % — %', _sql, sqlerrm;
end $$ language plpgsql;

create or replace function pg_temp.sf_check(_label text, _got text, _want text) returns void as $$
begin
  if _got is distinct from _want then
    raise exception 'SHORTER FAIL: % — got %, wanted %', _label, _got, _want;
  end if;
  raise notice 'ok: %', _label;
end $$ language plpgsql;


do $$
declare
  acme    uuid := '00000000-0000-0000-0000-0000000000a0';
  hema    uuid := '00000000-0000-0000-0000-00000000a002';  -- Employee Admin
  priya   uuid := '00000000-0000-0000-0000-00000000a006';
  e       uuid;
  hq      uuid;
  n30     text := repeat('a', 30);
  n31     text := repeat('a', 31);
  n50     text := repeat('a', 50);
  n51     text := repeat('a', 51);
begin
  if to_regprocedure('public.employee_save_family(uuid,jsonb)') is null
     or position('family_name_twice' in pg_get_functiondef('public.employee_save_family(uuid,jsonb)'::regprocedure)) = 0 then
    raise notice 'skip: no shorter fields yet';
    return;
  end if;

  insert into public.organization_modules (organization_id, module_key, enabled, enabled_at)
  values (acme, 'employee', true, now())
  on conflict (organization_id, module_key) do update set enabled = true, deleted_at = null;
  delete from public.employee_field_settings where organization_id = acme;
  select id into e from public.employees where profile_id = priya;
  perform set_config('neuvto.purge', 'on', true);
  delete from public.nominees where version_id in (select id from public.nomination_versions where employee_id = e);
  delete from public.nomination_versions where employee_id = e;
  delete from public.family_members where employee_id = e;
  delete from public.previous_organisations where employee_id = e;
  perform set_config('neuvto.purge', '', true);

  -- ══ the lengths: each limit taken, and one more refused for the length
  perform pg_temp.sf_do('a full name of 50', hema, format(
    $q$select public.employee_update(%L, jsonb_build_object('fullName', %L::text))$q$, e, n50));
  perform pg_temp.sf_refused('a full name of 51 is refused', hema, format(
    $q$select public.employee_update(%L, jsonb_build_object('fullName', %L::text))$q$, e, n51), 'full_name_format');
  perform pg_temp.sf_do('a name as per ID of 50', hema, format(
    $q$select public.employee_update(%L, jsonb_build_object('nameAsPerId', %L::text))$q$, e, n50));
  perform pg_temp.sf_refused('and of 51', hema, format(
    $q$select public.employee_update(%L, jsonb_build_object('nameAsPerId', %L::text))$q$, e, n51), 'name_as_per_id_format');
  perform pg_temp.sf_do('an emergency contact named in 30', hema, format(
    $q$select public.employee_update(%L, jsonb_build_object('emergencyContactName', %L::text, 'emergencyContactRelation', 'brother'))$q$, e, n30));
  perform pg_temp.sf_refused('and in 31', hema, format(
    $q$select public.employee_update(%L, jsonb_build_object('emergencyContactName', %L::text))$q$, e, n31), 'emergency_contact_name_format');
  perform pg_temp.sf_refused('a nationality of 31', hema, format(
    $q$select public.employee_update(%L, jsonb_build_object('nationality', %L::text))$q$, e, n31), 'nationality_format');
  perform pg_temp.sf_refused('a family member named in 31', hema, format(
    $q$select public.employee_save_family(%L, jsonb_build_array(jsonb_build_object('relation','son','name', %L::text)))$q$, e, n31), 'relative_name_format');
  perform pg_temp.sf_do('and in 30', hema, format(
    $q$select public.employee_save_family(%L, jsonb_build_array(jsonb_build_object('relation','son','name', %L::text)))$q$, e, n30));
  perform pg_temp.sf_refused('a previous organisation of 31', hema, format(
    $q$select public.employee_save_previous_orgs(%L, jsonb_build_array(jsonb_build_object('organisationName', %L::text, 'fromDate','2015-01-01','toDate','2016-01-01')))$q$, e, n31), 'organisation_name_length');
  perform pg_temp.sf_refused('a designation of 31', hema, format(
    $q$select public.employee_save_previous_orgs(%L, jsonb_build_array(jsonb_build_object('organisationName','Infosys','designation', %L::text, 'fromDate','2015-01-01','toDate','2016-01-01')))$q$, e, n31), 'previous_designation_length');
  perform pg_temp.sf_refused('a bank of 31', hema, format(
    $q$select public.employee_set_bank(%L, jsonb_build_object('bankName', %L::text))$q$, e, n31), 'bank_name_length');
  perform pg_temp.sf_refused('an account holder of 51', hema, format(
    $q$select public.employee_set_bank(%L, jsonb_build_object('accountHolder', %L::text))$q$, e, n51), 'account_holder_format');
  perform pg_temp.sf_do('an account holder of 50', hema, format(
    $q$select public.employee_set_bank(%L, jsonb_build_object('accountHolder', %L::text))$q$, e, n50));
  perform pg_temp.sf_refused('a police station of 31', hema, format(
    $q$select public.employee_update(%L, jsonb_build_object('nearestPoliceStation', %L::text))$q$, e, n31), 'nearest_police_station_length');
  perform pg_temp.sf_refused('a department of 31', hema, format(
    $q$select public.employee_add_department(%L)$q$, n31), 'department_name_length');

  insert into public.deployment_units (organization_id, name, unit_type) values
    (acme, 'Shorter HQ', 'own_establishment') returning id into hq;
  perform pg_temp.sf_refused('a deployment order reference of 16', hema, format(
    $q$select public.employee_move_unit(%L, jsonb_build_object('unitId', %L, 'effectiveFrom', '2024-04-01', 'orderRef', %L::text))$q$,
    e, hq, repeat('R', 16)), 'order_ref_length');
  perform pg_temp.sf_do('and of 15', hema, format(
    $q$select public.employee_move_unit(%L, jsonb_build_object('unitId', %L, 'effectiveFrom', '2024-04-01', 'orderRef', %L::text))$q$,
    e, hq, repeat('R', 15)));

  -- what is on record already is not refused for an untouched field
  -- As data from before D123 got there: written while the checks allowed it.
  set local session_replication_role = replica;
  update public.employees set name_as_per_id = repeat('b', 80) where id = e;
  set local session_replication_role = origin;
  perform pg_temp.sf_do('a long name already on record does not stop another field being saved', hema, format(
    $q$select public.employee_update(%L, '{"bloodGroup":"O+"}')$q$, e));

  -- ══ one name, one person
  perform pg_temp.sf_refused('two family members with the same name are refused', hema, format(
    $q$select public.employee_save_family(%L, '[{"relation":"son","name":"Arjun"},{"relation":"son","name":"  arjun  "}]')$q$, e),
    'family_name_twice');
  perform pg_temp.sf_refused('nor do spaces between the words make two people', hema, format(
    $q$select public.employee_save_family(%L, '[{"relation":"son","name":"Arjun Rao"},{"relation":"daughter","name":"Arjun   Rao"}]')$q$, e),
    'family_name_twice');
  perform pg_temp.sf_do('two different names are fine', hema, format(
    $q$select public.employee_save_family(%L, '[{"relation":"son","name":"Arjun"},{"relation":"son","name":"Karan"}]')$q$, e));
  perform pg_temp.sf_refused('and still one father', hema, format(
    $q$select public.employee_save_family(%L, '[{"relation":"father","name":"Ramesh"},{"relation":"father","name":"Suresh"}]')$q$, e),
    'ONE_PARENT_EACH');

  -- ══ Aadhaar is optional
  perform pg_temp.sf_check('Aadhaar is not required by default',
    (select required::text from public.employee_field_defaults() where field_key = 'aadhaar'), 'false');

  raise notice 'shorter fields: all checks passed';
end $$;

rollback;
