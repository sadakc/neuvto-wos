-- NEUVTO WOS — what is typed once is not typed again (D121)
--
-- Raises on the first violation. Silence means pass. Rolled back.
--
-- PHASE-AWARE: exits quietly if employee_latest_previous_org does not exist yet.
--
--   emergency  a family member as the emergency contact: name and relation
--              from Family, following it; one's own typed unlinks; never
--              somebody else's family member;
--   police     the present address's, corrected in place by Physical record;
--              the first present address takes the one the record held;
--              nothing else on an address is edited in place;
--   reason     the reason for leaving the last organisation is the latest
--              organisation's, typed in either place.

begin;

create or replace function pg_temp.lf_as(_uid uuid) returns void as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', _uid::text, 'role', 'authenticated')::text, true);
end $$ language plpgsql;

create or replace function pg_temp.lf_root() returns void as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$ language plpgsql;

/** Refused, and for the named reason: the message or its detail. */
create or replace function pg_temp.lf_refused(_label text, _uid uuid, _sql text, _needle text)
returns void as $$
declare v_msg text; v_detail text;
begin
  if _uid is null then perform pg_temp.lf_root(); else perform pg_temp.lf_as(_uid); end if;
  begin
    execute _sql;
  exception when others then
    get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
  end;
  perform pg_temp.lf_root();
  if v_msg is null then
    raise exception 'LINKED FAIL: % — it was allowed', _label;
  end if;
  if concat_ws(' ', v_msg, v_detail) not ilike '%' || _needle || '%' then
    raise exception 'LINKED FAIL: % — refused for the wrong reason: % / %', _label, v_msg, v_detail;
  end if;
  raise notice 'ok: %', _label;
end $$ language plpgsql;

create or replace function pg_temp.lf_do(_label text, _uid uuid, _sql text) returns void as $$
begin
  perform pg_temp.lf_as(_uid);
  execute _sql;
  perform pg_temp.lf_root();
  raise notice 'ok: %', _label;
exception when others then
  perform pg_temp.lf_root();
  raise exception 'LINKED FAIL: % — refused: %', _label, sqlerrm;
end $$ language plpgsql;

create or replace function pg_temp.lf_val(_uid uuid, _sql text) returns text as $$
declare v text;
begin
  perform pg_temp.lf_as(_uid);
  execute _sql into v;
  perform pg_temp.lf_root();
  return v;
exception when others then
  perform pg_temp.lf_root();
  raise exception 'LINKED FAIL: refused: % — %', _sql, sqlerrm;
end $$ language plpgsql;

create or replace function pg_temp.lf_check(_label text, _got text, _want text) returns void as $$
begin
  if _got is distinct from _want then
    raise exception 'LINKED FAIL: % — got %, wanted %', _label, _got, _want;
  end if;
  raise notice 'ok: %', _label;
end $$ language plpgsql;


do $$
declare
  acme    uuid := '00000000-0000-0000-0000-0000000000a0';
  hema    uuid := '00000000-0000-0000-0000-00000000a002';  -- Employee Admin
  priya   uuid := '00000000-0000-0000-0000-00000000a006';
  e_priya uuid;
  e_hema  uuid;
  v_father uuid;
  v_other  uuid;
  v_addr   uuid;
  v_rows   jsonb;
  n        integer;
begin
  if to_regprocedure('public.employee_latest_previous_org(uuid)') is null then
    raise notice 'skip: no linked fields yet';
    return;
  end if;

  insert into public.organization_modules (organization_id, module_key, enabled, enabled_at)
  values (acme, 'employee', true, now())
  on conflict (organization_id, module_key) do update set enabled = true, deleted_at = null;
  delete from public.employee_field_settings where organization_id = acme;
  select id into e_priya from public.employees where profile_id = priya;
  select id into e_hema from public.employees where profile_id = hema;
  perform set_config('neuvto.purge', 'on', true);
  update public.employees set emergency_contact_family_member_id = null, nearest_police_station = null,
         reason_for_leaving_last_org = null where id in (e_priya, e_hema);
  delete from public.nominees where version_id in (select id from public.nomination_versions where employee_id = e_priya);
  delete from public.nomination_versions where employee_id = e_priya;
  delete from public.family_members where employee_id in (e_priya, e_hema);
  delete from public.employee_addresses where employee_id = e_priya;
  delete from public.previous_organisations where employee_id = e_priya;
  perform set_config('neuvto.purge', '', true);

  -- ══ 1 · the emergency contact may be a family member
  perform pg_temp.lf_do('a father in Family', hema, format($q$select public.employee_save_family(%L,
    '[{"relation":"father","name":"Ramesh","dateOfBirth":"1960-05-01"}]')$q$, e_priya));
  select id into v_father from public.family_members where employee_id = e_priya and relation = 'father';
  perform pg_temp.lf_do('the father picked as the emergency contact, with a phone', hema, format(
    $q$select public.employee_update(%L, jsonb_build_object('emergencyContactFamilyMemberId', %L::text,
       'emergencyContactPhone', '9845012345'))$q$, e_priya, v_father));
  perform pg_temp.lf_check('linked to the father',
    (select emergency_contact_family_member_id::text from public.employees where id = e_priya), v_father::text);
  perform pg_temp.lf_check('the name and relation are Family''s',
    (select emergency_contact_name || '/' || emergency_contact_relation from public.employees where id = e_priya),
    'Ramesh/father');
  perform pg_temp.lf_check('and the card says who in Family it is', pg_temp.lf_val(hema, format(
    $q$select public.employee_card(%L) -> 'emergencyContact' ->> 'familyMemberId'$q$, e_priya)), v_father::text);

  perform pg_temp.lf_do('Family renames the father', hema, format($q$select public.employee_save_family(%L,
    jsonb_build_array(jsonb_build_object('id', %L::text, 'relation', 'father', 'name', 'Ramesh Kumar',
                                         'dateOfBirth', '1960-05-01')))$q$, e_priya, v_father));
  perform pg_temp.lf_check('the emergency contact follows Family',
    (select emergency_contact_name from public.employees where id = e_priya), 'Ramesh Kumar');

  perform pg_temp.lf_do('a name typed for the contact', hema, format(
    $q$select public.employee_update(%L, '{"emergencyContactName":"Anil","emergencyContactRelation":"brother"}')$q$, e_priya));
  perform pg_temp.lf_check('is somebody of one''s own: unlinked',
    (select coalesce(emergency_contact_family_member_id::text, 'none') from public.employees where id = e_priya), 'none');
  perform pg_temp.lf_do('Family saved again', hema, format($q$select public.employee_save_family(%L,
    jsonb_build_array(jsonb_build_object('id', %L::text, 'relation', 'father', 'name', 'Ramesh K',
                                         'dateOfBirth', '1960-05-01')))$q$, e_priya, v_father));
  perform pg_temp.lf_check('does not touch a contact of one''s own',
    (select emergency_contact_name from public.employees where id = e_priya), 'Anil');

  perform pg_temp.lf_do('the father picked again', hema, format(
    $q$select public.employee_update(%L, jsonb_build_object('emergencyContactFamilyMemberId', %L::text))$q$,
    e_priya, v_father));
  perform pg_temp.lf_do('and "somebody not in Family" chosen, though the contact is required', hema, format(
    $q$select public.employee_update(%L, '{"emergencyContactFamilyMemberId":null}')$q$, e_priya));
  perform pg_temp.lf_check('unlinks, keeping the name as it was',
    (select coalesce(emergency_contact_family_member_id::text, 'none') || '/' || emergency_contact_name
       from public.employees where id = e_priya), 'none/Ramesh K');
  perform pg_temp.lf_refused('the contact''s name itself still may not be emptied', hema, format(
    $q$select public.employee_update(%L, '{"emergencyContactName":""}')$q$, e_priya), 'FIELD_REQUIRED');

  -- refusals
  perform pg_temp.lf_do('a family member on Hema''s own record', hema, format($q$select public.employee_save_family(%L,
    '[{"relation":"mother","name":"Kamala"}]')$q$, e_hema));
  select id into v_other from public.family_members where employee_id = e_hema;
  perform pg_temp.lf_refused('somebody else''s family member is refused', hema, format(
    $q$select public.employee_update(%L, jsonb_build_object('emergencyContactFamilyMemberId', %L::text))$q$,
    e_priya, v_other), 'emergencyContactFamilyMemberId');
  perform pg_temp.lf_refused('and so is something that is no id', hema, format(
    $q$select public.employee_update(%L, '{"emergencyContactFamilyMemberId":"nobody"}')$q$, e_priya),
    'emergencyContactFamilyMemberId');
  perform pg_temp.lf_refused('Priya may not link the contact on Hema''s record', priya, format(
    $q$select public.employee_update(%L, jsonb_build_object('emergencyContactFamilyMemberId', %L::text))$q$,
    e_hema, v_other), 'FORBIDDEN');
  perform pg_temp.lf_check('which is still unlinked',
    (select coalesce(emergency_contact_family_member_id::text, 'none') from public.employees where id = e_hema), 'none');

  -- a family member removed leaves the contact as last known
  perform pg_temp.lf_do('the father linked again', hema, format(
    $q$select public.employee_update(%L, jsonb_build_object('emergencyContactFamilyMemberId', %L::text))$q$,
    e_priya, v_father));
  perform pg_temp.lf_do('and removed from Family', hema, format(
    $q$select public.employee_save_family(%L, '[]')$q$, e_priya));
  perform pg_temp.lf_check('the contact stays, unlinked, as last known',
    (select coalesce(emergency_contact_family_member_id::text, 'none') || '/' || emergency_contact_name
       from public.employees where id = e_priya), 'none/Ramesh K');

  -- ══ 3 · the police station is the present address's
  perform pg_temp.lf_do('a police station before there is an address', hema, format(
    $q$select public.employee_update(%L, '{"nearestPoliceStation":"Indiranagar"}')$q$, e_priya));
  perform pg_temp.lf_check('waits on the record, and the card shows it', pg_temp.lf_val(hema, format(
    $q$select public.employee_card(%L) ->> 'nearestPoliceStation'$q$, e_priya)), 'Indiranagar');
  perform pg_temp.lf_do('the first present address, with no police station', hema, format(
    $q$select public.employee_add_address(%L, '{"addressType":"present","effectiveFrom":"2026-01-01",
       "line":"12 MG Road","city":"Bengaluru","state":"Karnataka","pincode":"560001"}')$q$, e_priya));
  select id into v_addr from public.employee_addresses where employee_id = e_priya and address_type = 'present';
  perform pg_temp.lf_check('takes the one the record held',
    (select nearest_police_station from public.employee_addresses where id = v_addr), 'Indiranagar');
  perform pg_temp.lf_check('and the record no longer holds one',
    (select coalesce(nearest_police_station, 'none') from public.employees where id = e_priya), 'none');

  perform pg_temp.lf_do('Physical record corrects the police station', hema, format(
    $q$select public.employee_update(%L, '{"nearestPoliceStation":"Halasuru"}')$q$, e_priya));
  perform pg_temp.lf_check('on the present address, in place',
    (select nearest_police_station from public.employee_addresses where id = v_addr), 'Halasuru');
  perform pg_temp.lf_check('not as a new address',
    (select count(*)::text from public.employee_addresses where employee_id = e_priya), '1');
  perform pg_temp.lf_check('and the card shows it', pg_temp.lf_val(hema, format(
    $q$select public.employee_card(%L) ->> 'nearestPoliceStation'$q$, e_priya)), 'Halasuru');

  -- the exception is that one column, on that one row, while named
  perform pg_temp.lf_refused('the address itself is still never edited in place', null, format(
    $q$select set_config('neuvto.police_station', %L, true);
       update public.employee_addresses set line = '13 MG Road' where id = %L$q$, v_addr, v_addr), 'USE_A_NEW_ROW');
  perform set_config('neuvto.police_station', '', true);
  perform pg_temp.lf_refused('nor its police station, unless named', null, format(
    $q$update public.employee_addresses set nearest_police_station = 'Ulsoor' where id = %L$q$, v_addr), 'USE_A_NEW_ROW');
  perform pg_temp.lf_do('a move: a new present address', hema, format(
    $q$select public.employee_add_address(%L, '{"addressType":"present","effectiveFrom":"2026-06-01",
       "line":"4 Church Street","city":"Bengaluru","state":"Karnataka","pincode":"560001",
       "nearestPoliceStation":"Cubbon Park"}')$q$, e_priya));
  perform pg_temp.lf_refused('a closed address is never corrected, even named', null, format(
    $q$select set_config('neuvto.police_station', %L, true);
       update public.employee_addresses set nearest_police_station = 'Ulsoor' where id = %L$q$, v_addr, v_addr),
    'ARCHIVED_IMMUTABLE');
  perform set_config('neuvto.police_station', '', true);
  perform pg_temp.lf_check('the card follows the move', pg_temp.lf_val(hema, format(
    $q$select public.employee_card(%L) ->> 'nearestPoliceStation'$q$, e_priya)), 'Cubbon Park');

  -- ══ 4 · the reason for leaving is the latest organisation's
  perform pg_temp.lf_do('two previous organisations', hema, format($q$select public.employee_save_previous_orgs(%L,
    '[{"organisationName":"Infosys","fromDate":"2015-01-01","toDate":"2018-12-31","reasonForLeaving":"Studies"},
      {"organisationName":"Wipro","fromDate":"2019-01-01","toDate":"2024-12-31","reasonForLeaving":"A better role"}]')$q$, e_priya));
  perform pg_temp.lf_check('the record takes the latest one''s reason',
    (select reason_for_leaving_last_org from public.employees where id = e_priya), 'A better role');
  perform pg_temp.lf_do('the reason typed on the record', hema, format(
    $q$select public.employee_update(%L, '{"reasonForLeavingLastOrg":"Moved to Bengaluru"}')$q$, e_priya));
  perform pg_temp.lf_check('is the latest organisation''s too',
    (select reason_for_leaving from public.previous_organisations
      where employee_id = e_priya and organisation_name = 'Wipro'), 'Moved to Bengaluru');
  perform pg_temp.lf_check('and not the older one''s',
    (select reason_for_leaving from public.previous_organisations
      where employee_id = e_priya and organisation_name = 'Infosys'), 'Studies');
  select jsonb_agg(jsonb_build_object('id', id, 'organisationName', organisation_name, 'fromDate', from_date,
                                      'toDate', to_date, 'reasonForLeaving', null))
    into v_rows from public.previous_organisations where employee_id = e_priya;
  perform pg_temp.lf_do('every reason emptied in Previous organisations', hema, format(
    $q$select public.employee_save_previous_orgs(%L, %L)$q$, e_priya, v_rows));
  perform pg_temp.lf_check('the one on record stands: nothing is invented, nothing silently lost',
    (select reason_for_leaving_last_org from public.employees where id = e_priya), 'Moved to Bengaluru');

  raise notice 'linked fields: all checks passed';
end $$;

rollback;
