-- NEUVTO WOS — Sada's fifth round (D107): Required and Employees can update
--
-- Raises on the first violation. Silence means pass. Rolled back.
--
-- PHASE-AWARE: exits quietly if employee_field_settings() does not exist yet.
--
--   who sets     only the company's Super Admin; not the Employee Admin, not
--                the person, not another company; a locked answer never moves;
--   the person   writes their own fields that are switched on, at once, and
--                nothing that is off, nor anybody else's; a save with one
--                field off saves nothing; addresses by type, relatives by
--                relation, the nomination as a whole, previous employers;
--   required     a save that empties a required field is refused and names
--                it, for the Employee Admin too, and for the numbers;
--                switched off, the same save goes through;
--   the card     tells the person which fields are theirs and which required.

begin;

create or replace function pg_temp.fs_as(_uid uuid) returns void as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', _uid::text, 'role', 'authenticated')::text, true);
end $$ language plpgsql;

create or replace function pg_temp.fs_root() returns void as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$ language plpgsql;

/** Refused, and for the named reason: the message or its detail. */
create or replace function pg_temp.fs_refused(_label text, _uid uuid, _sql text, _needle text)
returns void as $$
declare v_msg text; v_detail text;
begin
  if _uid is null then perform pg_temp.fs_root(); else perform pg_temp.fs_as(_uid); end if;
  begin
    execute _sql;
  exception when others then
    get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
  end;
  perform pg_temp.fs_root();
  if v_msg is null then
    raise exception 'FIELDS FAIL: % — it was allowed', _label;
  end if;
  if concat_ws(' ', v_msg, v_detail) not ilike '%' || _needle || '%' then
    raise exception 'FIELDS FAIL: % — refused for the wrong reason: % / %', _label, v_msg, v_detail;
  end if;
  raise notice 'ok: %', _label;
end $$ language plpgsql;

create or replace function pg_temp.fs_do(_label text, _uid uuid, _sql text) returns void as $$
begin
  perform pg_temp.fs_as(_uid);
  execute _sql;
  perform pg_temp.fs_root();
  raise notice 'ok: %', _label;
exception when others then
  perform pg_temp.fs_root();
  raise exception 'FIELDS FAIL: % — refused: %', _label, sqlerrm;
end $$ language plpgsql;

create or replace function pg_temp.fs_val(_uid uuid, _sql text) returns text as $$
declare v text;
begin
  perform pg_temp.fs_as(_uid);
  execute _sql into v;
  perform pg_temp.fs_root();
  return v;
exception when others then
  perform pg_temp.fs_root();
  raise exception 'FIELDS FAIL: refused: % — %', _sql, sqlerrm;
end $$ language plpgsql;

create or replace function pg_temp.fs_check(_label text, _got text, _want text) returns void as $$
begin
  if _got is distinct from _want then
    raise exception 'FIELDS FAIL: % — got %, wanted %', _label, _got, _want;
  end if;
  raise notice 'ok: %', _label;
end $$ language plpgsql;

create or replace function pg_temp.fs_set(_key text, _setting text, _value boolean) returns void as $$
begin
  perform pg_temp.fs_as('00000000-0000-0000-0000-00000000a001');  -- Alice, Acme's Super Admin
  perform public.employee_save_field_setting(_key, _setting, _value);
  perform pg_temp.fs_root();
end $$ language plpgsql;

do $$
declare
  acme   uuid := '00000000-0000-0000-0000-0000000000a0';
  vertex uuid := '00000000-0000-0000-0000-0000000000b0';
  alice  uuid := '00000000-0000-0000-0000-00000000a001';  -- Super Admin
  hema   uuid := '00000000-0000-0000-0000-00000000a002';  -- Employee Admin, not Super Admin
  ravi   uuid := '00000000-0000-0000-0000-00000000a005';  -- the person
  priya  uuid := '00000000-0000-0000-0000-00000000a006';
  bob    uuid := '00000000-0000-0000-0000-00000000b001';  -- Vertex's Super Admin
  e_ravi uuid;
  e_priya uuid;
  father uuid;
  addr   jsonb := jsonb_build_object('addressType', 'present', 'effectiveFrom', '2026-01-01',
                    'line', '12 MG Road', 'city', 'Bengaluru', 'state', 'Karnataka', 'pincode', '560001');
  c      jsonb;
begin
  if to_regprocedure('public.employee_field_settings()') is null then
    raise notice 'skip: no field settings yet';
    return;
  end if;

  insert into public.organization_modules (organization_id, module_key, enabled, enabled_at)
  values (acme, 'employee', true, now()), (vertex, 'employee', true, now())
  on conflict (organization_id, module_key) do update set enabled = true, deleted_at = null;
  select id into e_ravi from public.employees where profile_id = ravi;
  select id into e_priya from public.employees where profile_id = priya;
  -- Whatever the local copy holds, these start from Neuvto's answers.
  delete from public.employee_field_settings where organization_id in (acme, vertex);

  -- ── 1 · the list, and who may change it
  perform pg_temp.fs_check('everybody in the company reads the 57 fields',
    pg_temp.fs_val(ravi, 'select count(*) from public.employee_field_settings()'), '57');
  perform pg_temp.fs_check('Neuvto''s answers: date of birth required, mobile theirs, sex not',
    pg_temp.fs_val(ravi, $q$select string_agg(field_key || '=' || required || '/' || employee_can_update, ',' order by field_key)
       from public.employee_field_settings() where field_key in ('dateOfBirth','mobile','sex')$q$),
    'dateOfBirth=true/false,mobile=true/true,sex=true/false');
  perform pg_temp.fs_check('the list says who may change it: the Super Admin',
    pg_temp.fs_val(alice, 'select bool_and(can_change)::text from public.employee_field_settings()'), 'true');
  perform pg_temp.fs_check('and not the Employee Admin',
    pg_temp.fs_val(hema, 'select bool_or(can_change)::text from public.employee_field_settings()'), 'false');
  perform pg_temp.fs_refused('the Employee Admin cannot change a setting', hema,
    $q$select public.employee_save_field_setting('sex', 'employeeCanUpdate', true)$q$, 'SUPER_ADMIN_ONLY');
  perform pg_temp.fs_refused('the person cannot change a setting', ravi,
    $q$select public.employee_save_field_setting('sex', 'employeeCanUpdate', true)$q$, 'SUPER_ADMIN_ONLY');
  perform pg_temp.fs_refused('a worked-out field cannot be made required', alice,
    $q$select public.employee_save_field_setting('age', 'required', true)$q$, 'FIELD_LOCKED');
  perform pg_temp.fs_refused('the person can never be let change their UAN', alice,
    $q$select public.employee_save_field_setting('uan', 'employeeCanUpdate', true)$q$, 'FIELD_LOCKED');
  perform pg_temp.fs_refused('nor their designation', alice,
    $q$select public.employee_save_field_setting('designation', 'employeeCanUpdate', true)$q$, 'FIELD_LOCKED');
  perform pg_temp.fs_refused('a name cannot be made optional', alice,
    $q$select public.employee_save_field_setting('fullName', 'required', false)$q$, 'FIELD_LOCKED');
  perform pg_temp.fs_refused('nominee dates of birth follow the nomination', alice,
    $q$select public.employee_save_field_setting('nomineeDob', 'employeeCanUpdate', false)$q$, 'FIELD_LOCKED');
  perform pg_temp.fs_refused('an unknown field is refused', alice,
    $q$select public.employee_save_field_setting('salary', 'required', true)$q$, 'UNKNOWN_FIELD');
  perform pg_temp.fs_refused('an unknown setting is refused', alice,
    $q$select public.employee_save_field_setting('sex', 'visible', true)$q$, 'INVALID_VALUE');
  perform pg_temp.fs_refused('no answer is refused', alice,
    $q$select public.employee_save_field_setting('sex', 'required', null)$q$, 'INVALID_VALUE');
  perform pg_temp.fs_refused('the table cannot be written round the function', ravi,
    format($q$insert into public.employee_field_settings (organization_id, field_key, employee_can_update) values (%L, 'sex', true)$q$, acme),
    'permission denied');

  -- ── 2 · the person, on their own record
  perform pg_temp.fs_do('the person changes a field that is theirs, at once', ravi,
    format($q$select public.employee_update(%L, '{"alternateMobile":"9876500011"}')$q$, e_ravi));
  perform pg_temp.fs_check('and it is saved',
    (select alternate_mobile from public.employees where id = e_ravi), '9876500011');
  perform pg_temp.fs_refused('a field left off is refused, and named', ravi,
    format($q$select public.employee_update(%L, '{"sex":"male"}')$q$, e_ravi), 'Sex');
  perform pg_temp.fs_refused('one field off in a save refuses the whole save', ravi,
    format($q$select public.employee_update(%L, '{"alternateMobile":"9876500022","sex":"male"}')$q$, e_ravi),
    'NOT_YOURS_TO_CHANGE');
  perform pg_temp.fs_check('and nothing in it was saved',
    (select alternate_mobile from public.employees where id = e_ravi), '9876500011');
  perform pg_temp.fs_refused('a key no person may set is refused', ravi,
    format($q$select public.employee_update(%L, '{"departmentId":null}')$q$, e_ravi), 'NOT_YOURS_TO_CHANGE');
  perform pg_temp.fs_refused('the company''s facts are not theirs', ravi,
    format($q$select public.employee_update(%L, '{"status":"working"}')$q$, e_ravi), 'NOT_YOURS_TO_CHANGE');
  perform pg_temp.fs_refused('somebody else''s record stays FORBIDDEN', ravi,
    format($q$select public.employee_update(%L, '{"alternateMobile":"9876500033"}')$q$, e_priya), 'FORBIDDEN');

  perform pg_temp.fs_set('sex', 'employeeCanUpdate', true);
  perform pg_temp.fs_do('switched on, the same field goes through', ravi,
    format($q$select public.employee_update(%L, '{"sex":"male"}')$q$, e_ravi));
  perform pg_temp.fs_set('alternateMobile', 'employeeCanUpdate', false);
  perform pg_temp.fs_refused('switched off, a field they had is refused', ravi,
    format($q$select public.employee_update(%L, '{"alternateMobile":"9876500044"}')$q$, e_ravi), 'Alternate mobile');
  perform pg_temp.fs_do('the Employee Admin is not held to it', hema,
    format($q$select public.employee_update(%L, '{"alternateMobile":"9876500055"}')$q$, e_ravi));
  perform pg_temp.fs_check('a setting change is in the audit log, with who made it',
    (select (count(*) > 0)::text from public.audit_logs
      where entity_type = 'employee_field_settings' and actor_id = alice and organization_id = acme), 'true');

  -- Another company's answers are its own.
  perform pg_temp.fs_as(bob);
  perform public.employee_save_field_setting('alternateMobile', 'employeeCanUpdate', true);
  perform pg_temp.fs_root();
  perform pg_temp.fs_refused('Vertex switching a field on does not switch it on at Acme', ravi,
    format($q$select public.employee_update(%L, '{"alternateMobile":"9876500066"}')$q$, e_ravi), 'Alternate mobile');

  -- Addresses, by type.
  perform pg_temp.fs_do('the person adds their present address', ravi,
    format('select public.employee_add_address(%L, %L)', e_ravi, addr));
  perform pg_temp.fs_set('permanentAddress', 'employeeCanUpdate', false);
  perform pg_temp.fs_refused('not as permanent too, when permanent is off', ravi,
    format('select public.employee_add_address(%L, %L)', e_ravi,
      addr || '{"effectiveFrom":"2026-02-01","alsoPermanent":true}'), 'Permanent address');
  perform pg_temp.fs_refused('nor a permanent one alone', ravi,
    format('select public.employee_add_address(%L, %L)', e_ravi,
      addr || '{"addressType":"permanent","effectiveFrom":"2026-02-01"}'), 'Permanent address');
  perform pg_temp.fs_refused('nor an address of another type', ravi,
    format('select public.employee_add_address(%L, %L)', e_ravi,
      addr || '{"addressType":"while_deployed","effectiveFrom":"2026-02-01"}'), 'NOT_YOURS_TO_CHANGE');

  -- Relatives, by relation.
  delete from public.family_members where employee_id = e_ravi;  -- start empty
  insert into public.family_members (organization_id, employee_id, relation, name, date_of_birth, sort_order)
  values (acme, e_ravi, 'father', 'Mohan Kumar', '1960-03-03', 0) returning id into father;
  perform pg_temp.fs_set('father', 'employeeCanUpdate', false);
  perform pg_temp.fs_do('the person adds a son, their father sent back untouched', ravi,
    format($q$select public.employee_save_family(%L, jsonb_build_array(
      jsonb_build_object('id', %L, 'relation', 'father', 'name', 'Mohan Kumar', 'dateOfBirth', '1960-03-03', 'isDependent', true),
      jsonb_build_object('relation', 'son', 'name', 'Arjun Kumar', 'dateOfBirth', '2015-05-05')))$q$, e_ravi, father));
  perform pg_temp.fs_check('the son is saved and the father kept',
    (select string_agg(relation, ',' order by relation) from public.family_members where employee_id = e_ravi), 'father,son');
  perform pg_temp.fs_refused('but not a change to their father', ravi,
    format($q$select public.employee_save_family(%L, jsonb_build_array(
      jsonb_build_object('id', %L, 'relation', 'father', 'name', 'Mohan K', 'dateOfBirth', '1960-03-03', 'isDependent', true)))$q$,
      e_ravi, father), 'Father name and DOB');
  perform pg_temp.fs_refused('nor removing him', ravi,
    format($q$select public.employee_save_family(%L, '[]')$q$, e_ravi), 'Father name and DOB');
  perform pg_temp.fs_refused('nor turning him into somebody else', ravi,
    format($q$select public.employee_save_family(%L, jsonb_build_array(
      jsonb_build_object('id', %L, 'relation', 'son', 'name', 'Mohan Kumar', 'dateOfBirth', '1960-03-03', 'isDependent', true)))$q$,
      e_ravi, father), 'Father name and DOB');

  -- The nomination, as a whole; previous employers.
  perform pg_temp.fs_do('the person saves their nomination', ravi,
    format($q$select public.employee_save_nomination(%L, jsonb_build_object('nominees',
      jsonb_build_array(jsonb_build_object('name', 'Mohan Kumar', 'relation', 'father', 'sharePercent', 100))))$q$, e_ravi));
  perform pg_temp.fs_set('nomineeDob', 'required', true);
  perform pg_temp.fs_refused('a nominee without a date of birth, once it is required', hema,
    format($q$select public.employee_save_nomination(%L, jsonb_build_object('effectiveFrom', '2026-12-01', 'nominees',
      jsonb_build_array(jsonb_build_object('name', 'Mohan Kumar', 'relation', 'father', 'sharePercent', 100))))$q$, e_ravi),
    'Nominee date of birth');
  perform pg_temp.fs_set('nomineeName', 'employeeCanUpdate', false);
  perform pg_temp.fs_refused('switched off, the nomination is refused', ravi,
    format($q$select public.employee_save_nomination(%L, jsonb_build_object('effectiveFrom', '2026-12-01', 'nominees',
      jsonb_build_array(jsonb_build_object('name', 'Mohan Kumar', 'relation', 'father', 'dateOfBirth', '1960-03-03', 'sharePercent', 100))))$q$, e_ravi),
    'Nominee name and relation');
  perform pg_temp.fs_check('and its date of birth follows it',
    pg_temp.fs_val(ravi, $q$select employee_can_update::text from public.employee_field_settings() where field_key = 'nomineeDob'$q$), 'false');
  perform pg_temp.fs_refused('previous employers are off to begin with', ravi,
    format($q$select public.employee_save_previous_orgs(%L, '[]')$q$, e_ravi), 'Previous organisations');
  perform pg_temp.fs_set('previousOrganisations', 'employeeCanUpdate', true);
  perform pg_temp.fs_do('and theirs once switched on', ravi,
    format($q$select public.employee_save_previous_orgs(%L, jsonb_build_array(jsonb_build_object(
      'organisationName', 'Securitas', 'fromDate', '2018-01-01', 'toDate', '2020-12-31')))$q$, e_ravi));

  -- ── 3 · required
  perform pg_temp.fs_refused('the Employee Admin cannot empty a required field', hema,
    format($q$select public.employee_update(%L, '{"dateOfBirth":null}')$q$, e_ravi), 'Date of birth');
  perform pg_temp.fs_refused('nor blank it', hema,
    format($q$select public.employee_update(%L, '{"educationQualification":"   "}')$q$, e_ravi), 'FIELD_REQUIRED');
  perform pg_temp.fs_refused('each part of a required emergency contact', hema,
    format($q$select public.employee_update(%L, '{"emergencyContactPhone":null}')$q$, e_ravi), 'Emergency contact');
  perform pg_temp.fs_refused('the person neither', ravi,
    format($q$select public.employee_update(%L, '{"mobile":null}')$q$, e_ravi), 'Mobile number');
  perform pg_temp.fs_refused('nor a required number', hema,
    format($q$select public.employee_set_statutory(%L, '{"aadhaar":""}')$q$, e_ravi), 'Aadhaar number');
  perform pg_temp.fs_refused('nor a required bank account', hema,
    format($q$select public.employee_set_bank(%L, '{"account":null}')$q$, e_ravi), 'Bank account number');
  perform pg_temp.fs_set('religion', 'required', true);
  perform pg_temp.fs_refused('nor a restricted field made required', hema,
    format($q$select public.employee_set_restricted(%L, '{"religion":null}')$q$, e_ravi), 'Religion');
  perform pg_temp.fs_do('an optional field still empties', hema,
    format($q$select public.employee_update(%L, '{"bloodGroup":null}')$q$, e_ravi));
  perform pg_temp.fs_set('dateOfBirth', 'required', false);
  perform pg_temp.fs_do('made optional, date of birth empties', hema,
    format($q$select public.employee_update(%L, '{"dateOfBirth":null}')$q$, e_ravi));
  perform pg_temp.fs_set('bloodGroup', 'required', true);
  perform pg_temp.fs_refused('made required, blood group no longer does', hema,
    format($q$select public.employee_update(%L, '{"bloodGroup":null}')$q$, e_ravi), 'Blood group');

  -- ── 4 · the card says so
  c := (pg_temp.fs_val(ravi, 'select public.employee_card()::text'))::jsonb -> 'capabilities';
  perform pg_temp.fs_check('the person''s card lists their fields, by field and by key',
    ((c -> 'ownFields') ? 'sex' and (c -> 'ownFields') ? 'mobile' and (c -> 'ownFields') ? 'presentAddress'
     and (c -> 'ownFields') ? 'emergencyContactPhone' and (c -> 'ownFields') ? 'previousOrganisations')::text, 'true');
  perform pg_temp.fs_check('and none that are off',
    ((c -> 'ownFields') ? 'alternateMobile' or (c -> 'ownFields') ? 'father'
     or (c -> 'ownFields') ? 'uan' or (c -> 'ownFields') ? 'nomineeName')::text, 'false');
  perform pg_temp.fs_check('and what is required',
    ((c -> 'requiredFields') ? 'bloodGroup' and (c -> 'requiredFields') ? 'mobile'
     and not (c -> 'requiredFields') ? 'dateOfBirth')::text, 'true');
  c := (pg_temp.fs_val(hema, format('select public.employee_card(%L)::text', e_ravi)))::jsonb -> 'capabilities';
  perform pg_temp.fs_check('the Employee Admin''s card offers no own fields',
    jsonb_array_length(c -> 'ownFields')::text, '0');
  perform pg_temp.fs_check('but the same required ones',
    ((c -> 'requiredFields') ? 'bloodGroup')::text, 'true');
end $$;

rollback;
