-- NEUVTO WOS — Employee Master configuration (E9)
--
-- Raises on the first violation. Silence means pass. Rolled back.
--
-- PHASE-AWARE: exits quietly if employee_save_unit does not exist yet.

begin;

create or replace function pg_temp.cf_as(_uid uuid) returns void as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', _uid::text, 'role', 'authenticated')::text, true);
end $$ language plpgsql;

create or replace function pg_temp.cf_root() returns void as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$ language plpgsql;

create or replace function pg_temp.cf_refused(_label text, _uid uuid, _sql text, _needle text)
returns void as $$
declare v_msg text;
begin
  perform pg_temp.cf_as(_uid);
  begin
    execute _sql;
  exception when others then
    v_msg := sqlerrm;
  end;
  perform pg_temp.cf_root();
  if v_msg is null then
    raise exception 'CONFIG FAIL: % — it was allowed', _label;
  end if;
  if v_msg not ilike '%' || _needle || '%' then
    raise exception 'CONFIG FAIL: % — refused for the wrong reason: %', _label, v_msg;
  end if;
  raise notice 'ok: %', _label;
end $$ language plpgsql;

create or replace function pg_temp.cf_json(_uid uuid, _sql text) returns jsonb as $$
declare v jsonb;
begin
  perform pg_temp.cf_as(_uid);
  execute _sql into v;
  perform pg_temp.cf_root();
  return v;
exception when others then
  perform pg_temp.cf_root();
  raise exception 'CONFIG FAIL: refused: % — %', _sql, sqlerrm;
end $$ language plpgsql;

do $$
declare
  acme  uuid := '00000000-0000-0000-0000-0000000000a0';
  hema  uuid := '00000000-0000-0000-0000-00000000a002';  -- Admin
  ravi  uuid := '00000000-0000-0000-0000-00000000a005';
  priya uuid := '00000000-0000-0000-0000-00000000a006';
  bob   uuid := '00000000-0000-0000-0000-00000000b001';
  hq    uuid;
  site  uuid;
  dsg   uuid;
  e     uuid;
  r     jsonb;
  n     integer;
begin
  if to_regprocedure('public.employee_save_unit(uuid,jsonb)') is null then
    raise notice 'skip: configuration does not exist yet';
    return;
  end if;

  insert into public.organization_modules (organization_id, module_key, enabled, enabled_at)
  values (acme, 'employee', true, now()),
         ('00000000-0000-0000-0000-0000000000b0', 'employee', true, now())
  on conflict (organization_id, module_key) do update set enabled = true, deleted_at = null;
  select id into e from public.employees where profile_id = priya;

  -- ── 1 · deployment units
  perform pg_temp.cf_refused('an employee cannot add a unit', ravi,
    $q$select public.employee_save_unit(null, '{"name":"X"}')$q$, 'FORBIDDEN');
  hq := (pg_temp.cf_json(hema, $q$select to_jsonb(public.employee_save_unit(null,
    '{"name":"Acme HQ","unitType":"own_establishment","location":"Bengaluru","state":"Karnataka"}'))$q$) #>> '{}')::uuid;
  perform pg_temp.cf_refused('a client site names its client', hema,
    $q$select public.employee_save_unit(null, '{"name":"Tata AIG, Hosur","unitType":"client_site"}')$q$, 'CLIENT_REQUIRED');
  site := (pg_temp.cf_json(hema, $q$select to_jsonb(public.employee_save_unit(null,
    '{"name":"Tata AIG, Hosur","unitType":"client_site","clientName":"Tata AIG","isBillable":true}'))$q$) #>> '{}')::uuid;
  perform pg_temp.cf_refused('a second unit with the same name, spelt differently, is refused', hema,
    $q$select public.employee_save_unit(null, '{"name":"  acme hq "}')$q$, 'UNIT_NAME_TAKEN');
  raise notice 'ok: an Admin adds units, and the duplicate spellings a spreadsheet makes are refused';

  perform pg_temp.cf_json(hema, format($q$select to_jsonb(public.employee_move_unit(%L, jsonb_build_object(
    'unitId', %L, 'effectiveFrom', '2025-06-01', 'orderRef', 'DO-1')))$q$, e, site));
  perform pg_temp.cf_json(hema, format($q$select to_jsonb(public.employee_save_unit(%L,
    '{"name":"Tata AIG Insurance, Hosur","unitType":"client_site","clientName":"Tata AIG"}'))$q$, site));
  if pg_temp.cf_json(hema, format('select public.employee_card(%L)', e)) -> 'currentDeployment' ->> 'unitName'
     is distinct from 'Tata AIG Insurance, Hosur' then
    raise exception 'CONFIG FAIL: renaming a unit did not relabel the posting';
  end if;
  raise notice 'ok: renaming a unit relabels every posting, because postings point at the id';

  perform pg_temp.cf_refused('a unit somebody is posted to cannot be retired', hema,
    format($q$select public.employee_set_unit_status(%L, 'retired')$q$, site), 'UNIT_HAS_PEOPLE');
  perform pg_temp.cf_json(hema, format($q$select to_jsonb(public.employee_move_unit(%L, jsonb_build_object(
    'unitId', %L, 'effectiveFrom', '2025-09-01', 'orderRef', 'DO-2')))$q$, e, hq));
  perform pg_temp.cf_json(hema, format($q$select to_jsonb(public.employee_set_unit_status(%L, 'retired'))$q$, site));
  perform pg_temp.cf_as(hema);
  select count(*) into n from public.employee_units() u where u.id = site and u.status = 'retired'
     and u.posted_now = 0 and u.postings_ever = 1;
  perform pg_temp.cf_root();
  if n <> 1 then raise exception 'CONFIG FAIL: the retired unit''s counts are wrong'; end if;
  if pg_temp.cf_json(hema, format('select public.employee_card(%L)', e)) -> 'deployments' -> 1 ->> 'unitRetired'
     is distinct from 'true' then
    raise exception 'CONFIG FAIL: the old posting does not say its unit is retired';
  end if;
  raise notice 'ok: once empty, a unit retires; its past postings stay readable and say so';
  perform pg_temp.cf_refused('another company cannot touch the unit', bob,
    format($q$select public.employee_set_unit_status(%L, 'active')$q$, hq), 'NOT_FOUND');

  -- ── 2 · designations
  dsg := (pg_temp.cf_json(hema, $q$select to_jsonb(public.employee_save_designation(null, '{"name":"Guard","grade":"G1"}'))$q$) #>> '{}')::uuid;
  perform pg_temp.cf_refused('a duplicate designation is refused', hema,
    $q$select public.employee_save_designation(null, '{"name":"guard"}')$q$, 'DESIGNATION_NAME_TAKEN');
  perform pg_temp.cf_json(hema, format($q$select to_jsonb(public.employee_set_designation_status(%L, 'retired'))$q$, dsg));
  perform pg_temp.cf_refused('a retired designation is not given to anybody new', hema,
    format($q$select public.employee_update(%L, jsonb_build_object('designationId', %L))$q$, e, dsg),
    'DESIGNATION_NOT_AVAILABLE');
  raise notice 'ok: designations are added, kept unique and retired';

  -- ── 3 · the onboarding checklist decides what is missing
  perform pg_temp.cf_as(hema);
  select count(*) into n from public.employee_onboarding_items();
  perform pg_temp.cf_root();
  if n <> 12 then raise exception 'CONFIG FAIL: the checklist has % items, not 12', n; end if;

  update public.profiles set joined_date = public.org_today(acme) - 60 where id = priya;
  r := public.employee_onboarding_gaps(e);
  if not (r @> '[{"key":"present_address","overdue":true}]') then
    raise exception 'CONFIG FAIL: a 60-day-old record without an address is not overdue: %', r;
  end if;
  perform pg_temp.cf_json(hema, $q$select to_jsonb(public.employee_save_onboarding_item('present_address', 90, false))$q$);
  r := public.employee_onboarding_gaps(e);
  if r @> '[{"key":"present_address"}]' then
    raise exception 'CONFIG FAIL: an item made optional is still listed as missing';
  end if;
  perform pg_temp.cf_json(hema, $q$select to_jsonb(public.employee_save_onboarding_item('present_address', 90, true))$q$);
  r := public.employee_onboarding_gaps(e);
  if not (r @> '[{"key":"present_address","overdue":false}]') then
    raise exception 'CONFIG FAIL: a longer due window did not stop it being overdue: %', r;
  end if;
  raise notice 'ok: the company''s checklist decides what is missing and when it is overdue';
  perform pg_temp.cf_refused('an unknown item is refused', hema,
    $q$select public.employee_save_onboarding_item('tattoos', 1, true)$q$, 'NOT_FOUND');
  perform pg_temp.cf_refused('a due window over a year is refused', hema,
    $q$select public.employee_save_onboarding_item('uan', 400, true)$q$, 'INVALID_VALUE');
  perform pg_temp.cf_refused('an employee cannot change the checklist', ravi,
    $q$select public.employee_save_onboarding_item('uan', 1, false)$q$, 'FORBIDDEN');
end $$;

rollback;
