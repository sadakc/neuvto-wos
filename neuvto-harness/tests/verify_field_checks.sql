-- NEUVTO WOS — every field is checked, and a record is complete before acceptance (D103)
--
-- Raises on the first violation. Silence means pass. Rolled back.
--
-- PHASE-AWARE: exits quietly if valid_phone does not exist yet.
--
--   the rules     a phone, a name, a code, each right and each wrong way;
--   the paths     refused through the card's writer AND by a write straight to
--                 the table, so the import and any later caller are held too;
--   only changes  a value already on record that breaks a rule does not block
--                 an edit to another field;
--   the person    name, mobile, department and reports to are written wherever
--                 they live: profile, invitation, or draft;
--   the lists     a department added from a field is the company's one list,
--                 a duplicate is the same department, and only an Admin adds;
--   reports to    somebody who cannot approve can be made a Manager, by
--                 somebody allowed to, and is then offered.

begin;

create or replace function pg_temp.fc_as(_uid uuid) returns void as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', _uid::text, 'role', 'authenticated')::text, true);
end $$ language plpgsql;

create or replace function pg_temp.fc_root() returns void as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$ language plpgsql;

/** Refused, and for the named reason: the message, its detail or the rule it broke. */
create or replace function pg_temp.fc_refused(_label text, _uid uuid, _sql text, _needle text)
returns void as $$
declare v_msg text; v_detail text; v_rule text;
begin
  if _uid is null then perform pg_temp.fc_root(); else perform pg_temp.fc_as(_uid); end if;
  begin
    execute _sql;
  exception when others then
    get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail, v_rule = constraint_name;
  end;
  perform pg_temp.fc_root();
  if v_msg is null then
    raise exception 'FIELDS FAIL: % — it was allowed', _label;
  end if;
  if concat_ws(' ', v_msg, v_detail, v_rule) not ilike '%' || _needle || '%' then
    raise exception 'FIELDS FAIL: % — refused for the wrong reason: % / % / %', _label, v_msg, v_detail, v_rule;
  end if;
  raise notice 'ok: %', _label;
end $$ language plpgsql;

create or replace function pg_temp.fc_do(_uid uuid, _sql text) returns void as $$
begin
  perform pg_temp.fc_as(_uid);
  execute _sql;
  perform pg_temp.fc_root();
exception when others then
  perform pg_temp.fc_root();
  raise exception 'FIELDS FAIL: refused: % — %', _sql, sqlerrm;
end $$ language plpgsql;

create or replace function pg_temp.fc_val(_uid uuid, _sql text) returns text as $$
declare v text;
begin
  perform pg_temp.fc_as(_uid);
  execute _sql into v;
  perform pg_temp.fc_root();
  return v;
exception when others then
  perform pg_temp.fc_root();
  raise exception 'FIELDS FAIL: refused: % — %', _sql, sqlerrm;
end $$ language plpgsql;

do $$
declare
  acme   uuid := '00000000-0000-0000-0000-0000000000a0';
  vertex uuid := '00000000-0000-0000-0000-0000000000b0';
  alice  uuid := '00000000-0000-0000-0000-00000000a001';
  hema   uuid := '00000000-0000-0000-0000-00000000a002';
  dan    uuid := '00000000-0000-0000-0000-00000000a003';
  mark   uuid := '00000000-0000-0000-0000-00000000a004';
  ravi   uuid := '00000000-0000-0000-0000-00000000a005';
  priya  uuid := '00000000-0000-0000-0000-00000000a006';
  bob    uuid := '00000000-0000-0000-0000-00000000b001';
  e_priya uuid; e_dan uuid; d uuid; inv uuid; dept uuid; dept2 uuid; vdept uuid;
  bad text; good text; n int;
begin
  if to_regprocedure('public.valid_phone(text)') is null then
    raise notice 'skip: field rules do not exist yet';
    return;
  end if;

  insert into public.organization_modules (organization_id, module_key, enabled, enabled_at)
  values (acme, 'employee', true, now()), (vertex, 'employee', true, now())
  on conflict (organization_id, module_key) do update set enabled = true, deleted_at = null;
  select id into e_priya from public.employees where profile_id = priya;
  select id into e_dan from public.employees where profile_id = dan;

  -- ── 1 · the rules themselves, every way they can be right or wrong
  foreach good in array array['9876543210', '+91 98765 43210', '98765-43210', '(+91) 98765 43210',
                              '+971 50 123 4567', '+1 415 555 0100'] loop
    if not public.valid_phone(good) then raise exception 'FIELDS FAIL: phone % refused', good; end if;
  end loop;
  foreach bad in array array['34654365465', '987654321', '5876543210', '+91 5876543210',
                             '+91 98765 432101', 'abc9876543', '98765 4321x', '+1234567',
                             '98765.43210', '+'] loop
    if public.valid_phone(bad) then raise exception 'FIELDS FAIL: phone % accepted', bad; end if;
  end loop;
  raise notice 'ok: a phone is ten digits, +91 and ten, or another country code with 8 to 15';

  foreach good in array array['Priya', 'D''Souza', 'Anne-Marie', 'K. S. Rao', 'प्रिया शर्मा', 'தமிழ்செல்வி'] loop
    if not public.valid_words(good, 100) then raise exception 'FIELDS FAIL: name % refused', good; end if;
  end loop;
  foreach bad in array array['Priya2', 'Ravi@home', '', '   ', '...', 'R_avi', 'Rao, K', repeat('a', 101)] loop
    if public.valid_words(bad, 100) then raise exception 'FIELDS FAIL: name % accepted', bad; end if;
  end loop;
  raise notice 'ok: a name is letters in any script, spaces and . '' -; digits and symbols are refused';

  foreach good in array array['EMP-001', 'A/12', 'X.9_2', '34324'] loop
    if not public.valid_code(good) then raise exception 'FIELDS FAIL: code % refused', good; end if;
  end loop;
  foreach bad in array array['EMP 01', '#1', '-12', repeat('9', 31)] loop
    if public.valid_code(bad) then raise exception 'FIELDS FAIL: code % accepted', bad; end if;
  end loop;
  raise notice 'ok: an employee code is letters and digits, with / . _ - between them';

  -- ── 2 · through the card's writer, with the rule named for the screen
  perform pg_temp.fc_refused('an 11-digit alternate mobile is refused', hema,
    format($q$select public.employee_update(%L, '{"alternateMobile":"34654365465"}')$q$, e_priya),
    'alternate_mobile_format');
  perform pg_temp.fc_refused('an emergency phone with a letter is refused', hema,
    format($q$select public.employee_update(%L, '{"emergencyContactPhone":"98765O4321"}')$q$, e_priya),
    'emergency_contact_phone_format');
  perform pg_temp.fc_refused('a name on ID with a digit is refused', hema,
    format($q$select public.employee_update(%L, '{"nameAsPerId":"Priya 2"}')$q$, e_priya),
    'name_as_per_id_format');
  perform pg_temp.fc_refused('an emergency contact named with a symbol is refused', hema,
    format($q$select public.employee_update(%L, '{"emergencyContactName":"Asha#"}')$q$, e_priya),
    'emergency_contact_name_format');
  perform pg_temp.fc_refused('a relation with a digit is refused', hema,
    format($q$select public.employee_update(%L, '{"emergencyContactRelation":"Brother1"}')$q$, e_priya),
    'emergency_contact_relation_format');
  perform pg_temp.fc_refused('a nationality with a digit is refused', hema,
    format($q$select public.employee_update(%L, '{"nationality":"Indian1"}')$q$, e_priya),
    'nationality_format');
  perform pg_temp.fc_refused('a native state with a symbol is refused', hema,
    format($q$select public.employee_update(%L, '{"nativeState":"Kerala!"}')$q$, e_priya),
    'native_state_format');
  perform pg_temp.fc_refused('an employee code with a space is refused', hema,
    format($q$select public.employee_update(%L, '{"employeeCode":"EMP 1"}')$q$, e_priya),
    'employee_code_format');
  perform pg_temp.fc_refused('somebody under fourteen is refused', hema,
    format($q$select public.employee_update(%L, jsonb_build_object('dateOfBirth', (current_date - interval '10 years')::date))$q$, e_priya),
    'date_of_birth_age');
  perform pg_temp.fc_refused('a confirmation before birth is refused', hema,
    format($q$select public.employee_update(%L, '{"dateOfBirth":"1990-01-01","confirmedOn":"1985-01-01"}')$q$, e_priya),
    'confirmed_on_after_birth');
  perform pg_temp.fc_refused('a qualification of 201 characters is refused', hema,
    format($q$select public.employee_update(%L, jsonb_build_object('educationQualification', repeat('x', 201)))$q$, e_priya),
    'education_qualification_length');

  perform pg_temp.fc_do(hema, format($q$select public.employee_update(%L, '{
    "alternateMobile":"+91 98765 43210","emergencyContactName":"Asha D''Souza",
    "emergencyContactRelation":"Sister","emergencyContactPhone":"+971 50 123 4567",
    "nameAsPerId":"Priya K. Employee","nationality":"Indian","nativeState":"Tamil Nadu",
    "employeeCode":"ACM/0042","dateOfBirth":"1994-06-12"}')$q$, e_priya));
  if (select alternate_mobile from public.employees where id = e_priya) <> '+91 98765 43210' then
    raise exception 'FIELDS FAIL: a good mobile was not saved as typed';
  end if;
  raise notice 'ok: values that meet every rule are saved as typed';

  -- ── 3 · only what changed is checked
  alter table public.employees disable trigger employee_fields_are_valid;
  update public.employees set alternate_mobile = '34654365465' where id = e_priya;
  alter table public.employees enable trigger employee_fields_are_valid;
  perform pg_temp.fc_do(hema, format($q$select public.employee_update(%L, '{"sex":"female"}')$q$, e_priya));
  raise notice 'ok: a bad value already on record does not block an edit to another field';
  perform pg_temp.fc_refused('but saving that bad value again is refused', hema,
    format($q$select public.employee_update(%L, '{"alternateMobile":"34654365466"}')$q$, e_priya),
    'alternate_mobile_format');

  -- ── 4 · the same rules hold for a write straight to the table
  perform pg_temp.fc_refused('the table refuses a bad phone without the card', null,
    format($q$update public.employees set emergency_contact_phone = '12345' where id = %L$q$, e_priya),
    'emergency_contact_phone_format');
  perform pg_temp.fc_refused('a profile refuses a name with digits', null,
    format($q$update public.profiles set full_name = 'Priya 2' where id = %L$q$, priya), 'full_name_format');
  perform pg_temp.fc_refused('a profile refuses an 11-digit mobile', null,
    format($q$update public.profiles set phone = '34654365465' where id = %L$q$, priya), 'mobile_format');
  perform pg_temp.fc_refused('a family member named with digits is refused', null,
    format($q$insert into public.family_members (organization_id, employee_id, relation, name) values (%L, %L, 'son', 'Son 1')$q$, acme, e_priya),
    'relative_name_format');
  perform pg_temp.fc_refused('a family member born tomorrow is refused', null,
    format($q$insert into public.family_members (organization_id, employee_id, relation, name, date_of_birth) values (%L, %L, 'son', 'Arjun', current_date + 1)$q$, acme, e_priya),
    'relative_date_of_birth_future');
  perform pg_temp.fc_refused('a previous job that ends before it starts is refused', null,
    format($q$insert into public.previous_organisations (organization_id, employee_id, organisation_name, from_date, to_date) values (%L, %L, 'G4S', '2020-01-01', '2019-01-01')$q$, acme, e_priya),
    'previous_org_dates_order');
  perform pg_temp.fc_refused('a previous job in the future is refused', null,
    format($q$insert into public.previous_organisations (organization_id, employee_id, organisation_name, from_date) values (%L, %L, 'G4S', current_date + 30)$q$, acme, e_priya),
    'previous_org_dates_future');
  perform pg_temp.fc_refused('a previous job that ends in the future is refused', null,
    format($q$insert into public.previous_organisations (organization_id, employee_id, organisation_name, from_date, to_date) values (%L, %L, 'G4S', '2020-01-01', current_date + 30)$q$, acme, e_priya),
    'previous_org_dates_future');
  perform pg_temp.fc_refused('a city with digits is refused', hema,
    format($q$select public.employee_add_address(%L, '{"addressType":"present","effectiveFrom":"2026-01-01","line":"9 Lake View","city":"Hosur1","state":"Tamil Nadu","pincode":"635109"}')$q$, e_priya),
    'city_format');
  raise notice 'ok: profiles, family, previous jobs and addresses hold the rules whoever writes';

  -- ── 5 · name, mobile, department and reports to, wherever they live
  select id into dept from public.departments where organization_id = acme and name = 'Operations';
  select id into vdept from public.departments where organization_id = vertex limit 1;

  -- signed in: the profile
  perform pg_temp.fc_do(hema, format($q$select public.employee_update(%L, jsonb_build_object(
    'fullName','Priya K Employee','mobile','98400 12345','departmentId',%L,'managerId',%L))$q$, e_priya, dept, mark));
  if (select row(full_name, phone, department_id, manager_id)::text from public.profiles where id = priya)
     <> row('Priya K Employee', '98400 12345', dept, mark)::text then
    raise exception 'FIELDS FAIL: a signed-in person''s name, mobile, department and manager were not written';
  end if;
  raise notice 'ok: a signed-in person''s name, mobile, department and manager are corrected on the profile';

  perform pg_temp.fc_refused('a name cannot be removed', hema,
    format($q$select public.employee_update(%L, '{"fullName":"  "}')$q$, e_priya), 'NAME_REQUIRED');
  perform pg_temp.fc_refused('a name with digits is refused on the card', hema,
    format($q$select public.employee_update(%L, '{"fullName":"Pr1ya"}')$q$, e_priya), 'full_name_format');
  perform pg_temp.fc_refused('an 11-digit mobile is refused on the card', hema,
    format($q$select public.employee_update(%L, '{"mobile":"34654365465"}')$q$, e_priya), 'mobile_format');
  perform pg_temp.fc_refused('another company''s department is refused', hema,
    format($q$select public.employee_update(%L, jsonb_build_object('departmentId', %L))$q$, e_priya, vdept), 'DEPARTMENT_NOT_FOUND');
  perform pg_temp.fc_refused('somebody who cannot approve is not a manager', hema,
    format($q$select public.employee_update(%L, jsonb_build_object('managerId', %L))$q$, e_priya, ravi), 'MANAGER_CANNOT_APPROVE');
  perform pg_temp.fc_refused('nobody reports to themselves', hema,
    format($q$select public.employee_update(%L, jsonb_build_object('managerId', %L))$q$, e_dan, dan), 'SELF_MANAGED');
  perform pg_temp.fc_refused('a reporting loop is refused', hema,
    format($q$select public.employee_update(%L, jsonb_build_object('managerId', %L))$q$, e_dan, mark), 'REPORTING_CYCLE');
  perform pg_temp.fc_refused('a colleague cannot correct a name', ravi,
    format($q$select public.employee_update(%L, '{"fullName":"Someone Else"}')$q$, e_priya), 'FORBIDDEN');

  -- a draft: the draft's own columns
  d := pg_temp.fc_val(hema, $q$select public.employee_create_draft('{"fullName":"Deepak Dummy","email":"deepak.dummy@acme.test"}')$q$)::uuid;
  perform pg_temp.fc_do(hema, format($q$select public.employee_update(%L, jsonb_build_object(
    'fullName','Deepak Kumar','mobile','9876543210','departmentId',%L,'managerId',%L,'sex','male'))$q$, d, dept, mark));
  if (select row(draft_full_name, draft_phone, draft_department_id, draft_manager_id, sex)::text from public.employees where id = d)
     <> row('Deepak Kumar', '9876543210', dept, mark, 'male')::text then
    raise exception 'FIELDS FAIL: a draft''s name, mobile, department, manager or sex were not written';
  end if;
  raise notice 'ok: a draft is completed through the same writer';

  -- invited, not yet accepted: the invitation, and every other field too
  inv := pg_temp.fc_val(hema, format('select public.employee_send_invite(%L)', d))::uuid;
  perform pg_temp.fc_do(hema, format($q$select public.employee_update(%L, jsonb_build_object(
    'fullName','Deepak R Kumar','mobile','+91 99999 00001','managerId',%L,
    'dateOfBirth','1991-02-03','nationality','Indian','emergencyContactName','Lata'))$q$, d, dan));
  if (select row(full_name, phone, manager_email)::text from public.invitations
       where id = (select invitation_id from public.employees where id = d))
     <> row('Deepak R Kumar', '+91 99999 00001', 'dan.director@acme.test')::text then
    raise exception 'FIELDS FAIL: an invited person''s name, mobile or manager were not written to the invitation';
  end if;
  if (select row(date_of_birth, nationality, emergency_contact_name)::text from public.employees where id = d)
     <> row('1991-02-03'::date, 'Indian', 'Lata')::text then
    raise exception 'FIELDS FAIL: an invited person''s own record could not be completed';
  end if;
  raise notice 'ok: an invited person''s record is completed before they accept';
  perform pg_temp.fc_refused('an invited person''s mobile still meets the rule', hema,
    format($q$select public.employee_update(%L, '{"mobile":"123"}')$q$, d), 'mobile_format');

  -- ── 6 · a department from the field
  dept2 := pg_temp.fc_val(hema, $q$select public.employee_add_department('  Security  ')$q$)::uuid;
  if (select name from public.departments where id = dept2 and organization_id = acme) <> 'Security' then
    raise exception 'FIELDS FAIL: the department was not added to the company''s list';
  end if;
  if pg_temp.fc_val(hema, $q$select public.employee_add_department('SECURITY')$q$)::uuid <> dept2 then
    raise exception 'FIELDS FAIL: the same department under another case made a second one';
  end if;
  if pg_temp.fc_val(bob, $q$select public.employee_add_department('Security')$q$)::uuid = dept2 then
    raise exception 'FIELDS FAIL: another company was handed Acme''s department';
  end if;
  raise notice 'ok: a department added from a field joins the company''s one list, once';
  perform pg_temp.fc_refused('a colleague cannot add a department', ravi,
    $q$select public.employee_add_department('Kitchen')$q$, 'FORBIDDEN');
  perform pg_temp.fc_refused('a department needs a name', hema,
    $q$select public.employee_add_department('  ')$q$, 'NAME_REQUIRED');

  -- ── 7 · somebody to report to
  perform pg_temp.fc_as(hema);
  select count(*) into n from public.employee_manager_candidates() c where c.profile_id = ravi;
  if n <> 1 then perform pg_temp.fc_root(); raise exception 'FIELDS FAIL: Ravi, who cannot approve, is not offered'; end if;
  select count(*) into n from public.employee_manager_candidates() c where c.profile_id in (mark, dan);
  perform pg_temp.fc_root();
  if n <> 0 then raise exception 'FIELDS FAIL: somebody who already approves is offered'; end if;
  perform pg_temp.fc_refused('a colleague cannot make a manager', priya,
    format('select public.employee_make_manager(%L)', ravi), 'FORBIDDEN');
  perform pg_temp.fc_refused('a colleague cannot list who could be', priya,
    'select * from public.employee_manager_candidates()', 'FORBIDDEN');
  perform pg_temp.fc_do(alice, format('select public.employee_make_manager(%L)', ravi));
  -- Read the rows: has_role asks about the signed-in company, and this is root.
  if not public.can_approve(ravi)
     or (select array_agg(role::text order by role::text) from public.user_roles
          where user_id = ravi and deleted_at is null) <> array['employee', 'manager'] then
    raise exception 'FIELDS FAIL: Ravi was not made a Manager, or lost a role he had';
  end if;
  perform pg_temp.fc_do(hema, format($q$select public.employee_update(%L, jsonb_build_object('managerId', %L))$q$, e_priya, ravi));
  raise notice 'ok: somebody made a Manager is then accepted as a manager';
end $$;

rollback;
