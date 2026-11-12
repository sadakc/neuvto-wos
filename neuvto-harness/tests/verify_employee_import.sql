-- NEUVTO WOS — the master template import (D86)
--
-- Raises on the first violation. Silence means pass. Rolled back.
--
-- PHASE-AWARE: exits quietly if employee_import_master does not exist yet.
--
-- A dry run keeps nothing; a commit keeps only what passed every writer the
-- card uses; family is any number of rows; Aadhaar, PAN and bank arrive
-- encrypted; new people only; the Employee Admin may, nobody else may.

begin;

create or replace function pg_temp.im_as(_uid uuid) returns void as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', _uid::text, 'role', 'authenticated')::text, true);
end $$ language plpgsql;

create or replace function pg_temp.im_root() returns void as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$ language plpgsql;

create or replace function pg_temp.im_ok(_label text) returns void as $$
begin raise notice 'ok: %', _label; end $$ language plpgsql;

create or replace function pg_temp.im_refused(_label text, _uid uuid, _sql text, _needle text)
returns void as $$
declare v_msg text;
begin
  perform pg_temp.im_as(_uid);
  begin
    execute _sql;
  exception when others then
    v_msg := sqlerrm;
  end;
  perform pg_temp.im_root();
  if v_msg is null then
    raise exception 'IMPORT FAIL: % — it was allowed', _label;
  end if;
  if v_msg not ilike '%' || _needle || '%' then
    raise exception 'IMPORT FAIL: % — refused for the wrong reason: %', _label, v_msg;
  end if;
  perform pg_temp.im_ok(_label);
end $$ language plpgsql;

create or replace function pg_temp.im_run(_uid uuid, _book jsonb, _commit boolean, _only_clean boolean default false)
returns jsonb as $$
declare v jsonb;
begin
  perform pg_temp.im_as(_uid);
  v := public.employee_import_master(_book, _commit, _only_clean);
  perform pg_temp.im_root();
  return v;
exception when others then
  perform pg_temp.im_root();
  raise exception 'IMPORT FAIL: refused: %', sqlerrm;
end $$ language plpgsql;

/** The problems of one kind, as "tab:row:code" strings, for asserting. */
create or replace function pg_temp.im_has(_res jsonb, _tab text, _row int, _code text) returns boolean as $$
  select exists (select 1 from jsonb_array_elements(_res -> 'problems') p
                  where p ->> 'tab' = _tab and (p ->> 'row')::int = _row and p ->> 'code' = _code)
$$ language sql;

create or replace function pg_temp.im_aadhaar(_stem text) returns text as $$
declare d int;
begin
  for d in 0 .. 9 loop
    if public.aadhaar_is_valid(_stem || d) then return _stem || d; end if;
  end loop;
  raise exception 'no check digit for %', _stem;
end $$ language plpgsql;

do $$
declare
  acme   uuid := '00000000-0000-0000-0000-0000000000a0';
  alice  uuid := '00000000-0000-0000-0000-00000000a001';  -- Super Admin
  hema   uuid := '00000000-0000-0000-0000-00000000a002';  -- company-wide Admin
  dan    uuid := '00000000-0000-0000-0000-00000000a003';  -- Employee Admin below
  mark   uuid := '00000000-0000-0000-0000-00000000a004';  -- Leave Admin below
  ravi   uuid := '00000000-0000-0000-0000-00000000a005';
  a1     text := pg_temp.im_aadhaar('34567890123');
  a2     text := pg_temp.im_aadhaar('45678901234');
  book   jsonb;
  res    jsonb;
  e      uuid;
  n      integer;
begin
  if to_regprocedure('public.employee_import_master(jsonb,boolean,boolean)') is null then
    raise notice 'skip: the master template import does not exist yet';
    return;
  end if;

  insert into public.organization_modules (organization_id, module_key, enabled, enabled_at)
  values (acme, 'employee', true, now())
  on conflict (organization_id, module_key) do update set enabled = true, deleted_at = null;
  delete from public.module_admins;
  insert into public.module_admins (organization_id, user_id, module_key)
  values (acme, dan, 'employee'), (acme, mark, 'leave');
  insert into public.designations (organization_id, name) values (acme, 'Security Guard');
  insert into public.deployment_units (organization_id, name, unit_type, client_name)
  values (acme, 'Tata AIG, Hosur', 'client_site', 'Tata AIG');

  book := jsonb_build_object(
    'people', jsonb_build_array(
      jsonb_build_object(
        'employeeCode', 'IMP-001', 'fullName', 'Mallappa Wagger', 'email', 'mallappa@acme.test',
        'mobile', '+91 98450 00001', 'joinedDate', '2026-11-02', 'designation', 'security guard',
        'employmentType', 'full_time', 'sex', 'male', 'dateOfBirth', '1990-06-12',
        'maritalStatus', 'married', 'bloodGroup', 'B+', 'heightCm', '170',
        'presentLine', '12 Old Road', 'presentCity', 'Hukkeri', 'presentState', 'Karnataka',
        'presentPincode', '591221', 'permanentSameAsPresent', 'yes',
        'deployedUnit', 'Tata AIG, Hosur', 'deploymentOrderRef', 'DO-1',
        'identityDocumentType', 'aadhaar', 'aadhaar', a1, 'pan', 'ABCDE1234F', 'uan', '101234567890',
        'bankName', 'State Bank of India', 'account', '004512345678', 'ifsc', 'SBIN0001234',
        'religion', 'Hindu', 'casteCategory', 'obc'),
      jsonb_build_object(
        'employeeCode', 'IMP-002', 'fullName', 'Lakshmi Rao', 'joinedDate', '2026-11-02')),
    'family', jsonb_build_array(
      jsonb_build_object('employeeCode', 'IMP-001', 'relation', 'wife', 'name', 'Mallavva'),
      jsonb_build_object('employeeCode', 'IMP-001', 'relation', 'son', 'name', 'Arun', 'dateOfBirth', '2012-01-01'),
      jsonb_build_object('employeeCode', 'IMP-001', 'relation', 'son', 'name', 'Bala', 'dateOfBirth', '2014-01-01'),
      jsonb_build_object('employeeCode', 'IMP-001', 'relation', 'son', 'name', 'Chetan', 'dateOfBirth', '2016-01-01'),
      jsonb_build_object('employeeCode', 'IMP-001', 'relation', 'daughter', 'name', 'Deepa', 'dateOfBirth', '2018-01-01'),
      jsonb_build_object('employeeCode', 'imp-001', 'relation', 'daughter', 'name', 'Esha', 'dateOfBirth', '2020-01-01')),
    'nominees', jsonb_build_array(
      jsonb_build_object('employeeCode', 'IMP-001', 'name', 'Mallavva', 'relation', 'wife', 'sharePercent', '60'),
      jsonb_build_object('employeeCode', 'IMP-001', 'name', 'Arun', 'relation', 'son', 'sharePercent', '40')),
    'previous', jsonb_build_array(
      jsonb_build_object('employeeCode', 'IMP-001', 'organisationName', 'SIS Security',
                         'fromDate', '2015-01-01', 'toDate', '2026-09-30')));

  -- ── 1 · who may
  perform pg_temp.im_refused('an employee cannot import', ravi,
    format('select public.employee_import_master(%L, false)', book), 'FORBIDDEN');
  perform pg_temp.im_refused('nor a Leave Admin', mark,
    format('select public.employee_import_master(%L, false)', book), 'FORBIDDEN');
  perform pg_temp.im_refused('a misspelt column refuses the file', dan,
    format('select public.employee_import_master(%L, false)', book || jsonb_build_object(
      'family', jsonb_build_array(jsonb_build_object('employeeCode', 'IMP-001', 'relatoin', 'son')))),
    'UNKNOWN_COLUMN');

  -- ── 2 · the dry run keeps nothing
  res := pg_temp.im_run(dan, book, false);
  if jsonb_array_length(res -> 'problems') <> 0 or (res ->> 'ready')::int <> 2 then
    raise exception 'IMPORT FAIL: the dry run of a clean file said %', res;
  end if;
  if exists (select 1 from public.employees where employee_code in ('IMP-001', 'IMP-002')) then
    raise exception 'IMPORT FAIL: the dry run kept a record';
  end if;
  perform pg_temp.im_ok('an Employee Admin''s dry run finds a clean file clean and keeps nothing');

  -- ── 3 · the commit keeps everything, encrypted, any number of children
  res := pg_temp.im_run(dan, book, true);
  if (res ->> 'created')::int <> 2 then raise exception 'IMPORT FAIL: the commit said %', res; end if;
  select id into e from public.employees where employee_code = 'IMP-001';
  if e is null or (select draft_full_name from public.employees where id = e) is distinct from 'Mallappa Wagger' then
    raise exception 'IMPORT FAIL: the person is not a draft';
  end if;
  select count(*) into n from public.family_members where employee_id = e;
  if n <> 6 then raise exception 'IMPORT FAIL: % family rows, expected 6 (wife, three sons, two daughters)', n; end if;
  if (select count(*) from public.family_members where employee_id = e and relation = 'son' and date_of_birth is not null) <> 3 then
    raise exception 'IMPORT FAIL: the sons lost their dates of birth';
  end if;
  perform pg_temp.im_ok('family is any number of rows, each with its date of birth');

  if (select aadhaar_last4 from public.employee_statutory where employee_id = e) is distinct from right(a1, 4)
     or exists (select 1 from public.employee_statutory where employee_id = e
                 and position(convert_to(a1, 'UTF8') in aadhaar_cipher) > 0)
     or (select account_last4 from public.employee_bank where employee_id = e) is distinct from '5678'
     or not exists (select 1 from public.employee_restricted where employee_id = e) then
    raise exception 'IMPORT FAIL: statutory, bank or restricted did not arrive encrypted';
  end if;
  if exists (select 1 from public.audit_logs
              where coalesce(before::text, '') || coalesce(after::text, '') like any
                    (array['%' || a1 || '%', '%ABCDE1234F%', '%004512345678%', '%Hindu%'])) then
    raise exception 'IMPORT FAIL: the audit trail holds an imported number';
  end if;
  perform pg_temp.im_ok('Aadhaar, PAN, bank and restricted data arrive encrypted, and the audit trail holds none');

  if (select count(*) from public.employee_addresses where employee_id = e) <> 2
     or not exists (select 1 from public.employee_deployments where employee_id = e)
     or (select count(*) from public.nominees nm join public.nomination_versions v on v.id = nm.version_id
          where v.employee_id = e) <> 2
     or not exists (select 1 from public.previous_organisations where employee_id = e)
     or (select designation_id from public.employees where id = e) is null then
    raise exception 'IMPORT FAIL: an address, the posting, nominees, previous employment or the designation is missing';
  end if;
  perform pg_temp.im_ok('addresses, posting, nominees, previous employment and designation all land');

  -- ── 4 · new people only, and each problem named where it is
  res := pg_temp.im_run(hema, book, false);
  if not pg_temp.im_has(res, 'people', 1, 'CODE_TAKEN') then
    raise exception 'IMPORT FAIL: an existing employee code was not refused: %', res -> 'problems';
  end if;
  perform pg_temp.im_ok('an employee code already in the company is refused, never overwritten');

  book := jsonb_build_object(
    'people', jsonb_build_array(
      jsonb_build_object('employeeCode', 'NEW-1', 'fullName', 'Clean Person'),
      jsonb_build_object('employeeCode', 'NEW-2', 'fullName', 'Bad Numbers', 'aadhaar', '123456789012',
                         'designation', 'Astronaut'),
      jsonb_build_object('employeeCode', 'NEW-1', 'fullName', 'Twice'),
      jsonb_build_object('employeeCode', 'NEW-4', 'fullName', 'Short Shares')),
    'family', jsonb_build_array(
      jsonb_build_object('employeeCode', 'NOBODY', 'relation', 'son', 'name', 'X')),
    'nominees', jsonb_build_array(
      jsonb_build_object('employeeCode', 'NEW-4', 'name', 'Y', 'relation', 'wife', 'sharePercent', '90')));
  res := pg_temp.im_run(dan, book, false);
  if not (pg_temp.im_has(res, 'people', 2, 'INVALID_AADHAAR')
          and pg_temp.im_has(res, 'people', 2, 'UNKNOWN_DESIGNATION')
          and pg_temp.im_has(res, 'people', 3, 'TWICE_IN_FILE')
          and pg_temp.im_has(res, 'people', 4, 'NOMINEE_SHARES_NOT_100')
          and pg_temp.im_has(res, 'family', 1, 'NOT_ON_PEOPLE'))
     or pg_temp.im_has(res, 'people', 1, 'REQUIRED') then
    raise exception 'IMPORT FAIL: the problems are not each named where they are: %', res -> 'problems';
  end if;
  perform pg_temp.im_ok('every problem is named by tab, row and column, several per person');

  perform pg_temp.im_refused('a commit with problems refuses the whole file by default', dan,
    format('select public.employee_import_master(%L, true)', book), 'ROWS_NEED_ATTENTION');
  if exists (select 1 from public.employees where employee_code = 'NEW-1') then
    raise exception 'IMPORT FAIL: a refused file kept a person';
  end if;
  -- Without the stray family row, which refuses nobody but is still reported.
  res := pg_temp.im_run(dan, book - 'family', true, true);
  if (res ->> 'created')::int <> 1
     or not exists (select 1 from public.employees where employee_code = 'NEW-1')
     or exists (select 1 from public.employees where employee_code in ('NEW-2', 'NEW-4')) then
    raise exception 'IMPORT FAIL: importing only the clean people said %', res;
  end if;
  if exists (select 1 from public.nominees where name = 'Y') then
    raise exception 'IMPORT FAIL: a skipped person''s nominees were kept';
  end if;
  perform pg_temp.im_ok('importing only the clean people keeps them and nothing of the rest');

  -- ── 5 · module off
  update public.organization_modules set enabled = false where organization_id = acme and module_key = 'employee';
  perform pg_temp.im_refused('module off: no import', alice,
    format('select public.employee_import_master(%L, false)', book), 'MODULE_NOT_ENABLED');
end $$;

rollback;
