-- NEUVTO WOS — writing the record (E7)
--
-- Raises on the first violation. Silence means pass. Rolled back.
--
-- PHASE-AWARE: exits quietly if employee_move_unit does not exist yet.
--
-- The bundle's acceptance criteria 1–5, from the database side: three sons
-- save; an address change is two rows; a posting change is two rows with an
-- order reference; the unit is an id from this company's active list; nominee
-- shares off 100 save nothing. And every writer refuses everybody but an Admin.

begin;

create or replace function pg_temp.ew_as(_uid uuid) returns void as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', _uid::text, 'role', 'authenticated')::text, true);
end $$ language plpgsql;

create or replace function pg_temp.ew_root() returns void as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$ language plpgsql;

create or replace function pg_temp.ew_ok(_label text) returns void as $$
begin raise notice 'ok: %', _label; end $$ language plpgsql;

create or replace function pg_temp.ew_refused(_label text, _uid uuid, _sql text, _needle text)
returns void as $$
declare v_msg text;
begin
  perform pg_temp.ew_as(_uid);
  begin
    execute _sql;
  exception when others then
    v_msg := sqlerrm;
  end;
  perform pg_temp.ew_root();
  if v_msg is null then
    raise exception 'EMPLOYEE-WRITES FAIL: % — it was allowed', _label;
  end if;
  if v_msg not ilike '%' || _needle || '%' then
    raise exception 'EMPLOYEE-WRITES FAIL: % — refused for the wrong reason: %', _label, v_msg;
  end if;
  perform pg_temp.ew_ok(_label);
end $$ language plpgsql;

create or replace function pg_temp.ew_run(_uid uuid, _sql text) returns jsonb as $$
declare v jsonb;
begin
  perform pg_temp.ew_as(_uid);
  execute _sql into v;
  perform pg_temp.ew_root();
  return v;
exception when others then
  perform pg_temp.ew_root();
  raise exception 'EMPLOYEE-WRITES FAIL: refused: % — %', _sql, sqlerrm;
end $$ language plpgsql;

create or replace function pg_temp.ew_do(_uid uuid, _sql text) returns void as $$
begin
  perform pg_temp.ew_as(_uid);
  execute _sql;
  perform pg_temp.ew_root();
exception when others then
  perform pg_temp.ew_root();
  raise exception 'EMPLOYEE-WRITES FAIL: refused: % — %', _sql, sqlerrm;
end $$ language plpgsql;

do $$
declare
  acme   uuid := '00000000-0000-0000-0000-0000000000a0';
  vertex uuid := '00000000-0000-0000-0000-0000000000b0';
  hema   uuid := '00000000-0000-0000-0000-00000000a002';  -- Admin
  mark   uuid := '00000000-0000-0000-0000-00000000a004';  -- approver
  ravi   uuid := '00000000-0000-0000-0000-00000000a005';  -- colleague
  priya  uuid := '00000000-0000-0000-0000-00000000a006';
  pay    uuid := '00000000-0000-0000-0000-00000000a008';
  bob    uuid := '00000000-0000-0000-0000-00000000b001';
  e      uuid;
  hq     uuid;
  site   uuid;
  old_u  uuid;
  theirs uuid;
  dsg    uuid;
  r      jsonb;
  n      integer;
  v_ids  uuid[];
  who    uuid;
  sql_   text;
  months integer;
  meera  uuid;
begin
  if to_regprocedure('public.employee_move_unit(uuid,jsonb)') is null then
    raise notice 'skip: the record cannot be written yet';
    return;
  end if;

  insert into public.organization_modules (organization_id, module_key, enabled, enabled_at)
  values (acme, 'employee', true, now()), (vertex, 'employee', true, now())
  on conflict (organization_id, module_key) do update set enabled = true, deleted_at = null;
  insert into public.user_roles (user_id, organization_id, role) values (pay, acme, 'payroll_officer');
  select id into e from public.employees where profile_id = priya;
  insert into public.deployment_units (organization_id, name, unit_type) values
    (acme, 'Acme HQ', 'own_establishment') returning id into hq;
  insert into public.deployment_units (organization_id, name, unit_type, client_name) values
    (acme, 'Tata AIG, Hosur', 'client_site', 'Tata AIG') returning id into site;
  insert into public.deployment_units (organization_id, name, unit_type, status) values
    (acme, 'Old Depot', 'own_establishment', 'retired') returning id into old_u;
  insert into public.deployment_units (organization_id, name, unit_type) values
    (vertex, 'Vertex Depot', 'own_establishment') returning id into theirs;
  insert into public.designations (organization_id, name) values (acme, 'Guard') returning id into dsg;

  -- ── 0 · only an Admin writes, and only in their own company
  foreach who in array array[ravi, mark, pay, priya] loop
    foreach sql_ in array array[
      format($q$select public.employee_update(%L, '{"bloodGroup":"O+"}')$q$, e),
      format($q$select public.employee_save_family(%L, '[]')$q$, e),
      format($q$select public.employee_move_unit(%L, jsonb_build_object('unitId', %L, 'effectiveFrom', '2025-01-01', 'orderRef', 'X'))$q$, e, hq)]
    loop
      perform pg_temp.ew_as(who);
      begin
        execute sql_;
        perform pg_temp.ew_root();
        raise exception 'EMPLOYEE-WRITES FAIL: % was allowed to write: %', who, sql_;
      exception when others then
        perform pg_temp.ew_root();
        if sqlerrm not like '%FORBIDDEN%' then
          raise exception 'EMPLOYEE-WRITES FAIL: % refused for the wrong reason: %', who, sqlerrm;
        end if;
      end;
    end loop;
  end loop;
  perform pg_temp.ew_ok('a colleague, the approver, Payroll and the person themselves cannot write the record');
  perform pg_temp.ew_refused('another company''s Admin gets NOT_FOUND', bob,
    format($q$select public.employee_update(%L, '{"bloodGroup":"O+"}')$q$, e), 'NOT_FOUND');

  -- ── 1 · the record's own fields
  perform pg_temp.ew_do(hema, format($q$select public.employee_update(%L, jsonb_build_object(
    'dateOfBirth','1994-06-12','bloodGroup','B+','designationId',%L,'employmentType','full_time',
    'emergencyContactName','Lakshmi'))$q$, e, dsg));
  select count(*) into n from public.employees
   where id = e and date_of_birth = '1994-06-12' and blood_group = 'B+' and designation_id = dsg;
  if n <> 1 then raise exception 'EMPLOYEE-WRITES FAIL: the update did not land'; end if;
  perform pg_temp.ew_do(hema, format($q$select public.employee_update(%L, '{"bloodGroup":null}')$q$, e));
  select count(*) into n from public.employees where id = e and blood_group is null and date_of_birth = '1994-06-12';
  if n <> 1 then raise exception 'EMPLOYEE-WRITES FAIL: null did not clear, or an absent key changed'; end if;
  perform pg_temp.ew_ok('an Admin edits the record; null clears, an absent key is left alone');
  perform pg_temp.ew_refused('a blood group off the list is refused', hema,
    format($q$select public.employee_update(%L, '{"bloodGroup":"Z+"}')$q$, e), 'INVALID_VALUE');
  perform pg_temp.ew_refused('an unknown field is refused', hema,
    format($q$select public.employee_update(%L, '{"bloodType":"B+"}')$q$, e), 'UNKNOWN_FIELD');
  update public.designations set status = 'retired' where id = dsg;
  perform pg_temp.ew_refused('a retired designation is refused', hema,
    format($q$select public.employee_update(%L, jsonb_build_object('designationId', %L))$q$, e, dsg),
    'DESIGNATION_NOT_AVAILABLE');

  -- ── 2 · three sons, and the list is saved whole (criterion 1)
  perform pg_temp.ew_do(hema, format($q$select public.employee_save_family(%L,
    '[{"relation":"son","name":"Aarav"},{"relation":"daughter","name":"Diya"},
      {"relation":"son","name":"Kabir"},{"relation":"son","name":"Vihaan"}]')$q$, e));
  select count(*) into n from public.family_members where employee_id = e and relation = 'son';
  if n <> 3 then raise exception 'EMPLOYEE-WRITES FAIL: three sons became %', n; end if;
  select array_agg(id order by sort_order) into v_ids from public.family_members where employee_id = e;
  perform pg_temp.ew_do(hema, format($q$select public.employee_save_family(%L, jsonb_build_array(
    jsonb_build_object('id', %L, 'relation', 'son', 'name', 'Aarav K'),
    jsonb_build_object('id', %L, 'relation', 'son', 'name', 'Kabir')))$q$, e, v_ids[1], v_ids[3]));
  select count(*) into n from public.family_members where employee_id = e;
  if n <> 2 or not exists (select 1 from public.family_members where id = v_ids[1] and name = 'Aarav K') then
    raise exception 'EMPLOYEE-WRITES FAIL: saving the list whole left % rows', n;
  end if;
  perform pg_temp.ew_ok('three sons save, and the list is edited and trimmed as a whole');
  -- A real row of somebody else's, not a random id: a random id is NOT_FOUND
  -- whether or not the ownership check exists.
  insert into public.family_members (organization_id, employee_id, relation, name)
  select acme, id, 'wife', 'Meera' from public.employees where profile_id = ravi
  returning id into meera;
  perform pg_temp.ew_refused('another person''s family row cannot be edited through this one', hema,
    format($q$select public.employee_save_family(%L, jsonb_build_array(jsonb_build_object(
      'id', %L, 'relation', 'son', 'name', 'X')))$q$, e, meera), 'NOT_FOUND');
  if not exists (select 1 from public.family_members where id = meera and name = 'Meera') then
    raise exception 'EMPLOYEE-WRITES FAIL: Ravi''s wife was renamed through Priya''s list';
  end if;
  perform pg_temp.ew_refused('a relation off the list is refused, and nothing is lost', hema,
    format($q$select public.employee_save_family(%L, '[{"relation":"cousin","name":"X"}]')$q$, e), 'INVALID_VALUE');
  select count(*) into n from public.family_members where employee_id = e;
  if n <> 2 then raise exception 'EMPLOYEE-WRITES FAIL: a refused save removed rows'; end if;

  -- ── 3 · an address change is two rows (criterion 2)
  perform pg_temp.ew_run(hema, format($q$select public.employee_add_address(%L, jsonb_build_object(
    'addressType','present','effectiveFrom','2024-03-01','line','402 Brigade Meadows','city','Bengaluru',
    'state','Karnataka','pincode','560062','alsoPermanent',true))$q$, e));
  r := pg_temp.ew_run(hema, format($q$select public.employee_add_address(%L, jsonb_build_object(
    'addressType','present','effectiveFrom','2025-06-01','line','9 Lake View','city','Hosur',
    'state','Tamil Nadu','pincode','635109'))$q$, e));
  if r -> 'closed' -> 0 ->> 'lastDay' is distinct from '2025-05-31' then
    raise exception 'EMPLOYEE-WRITES FAIL: the old address should end 31 May, got %', r;
  end if;
  select count(*) into n from public.employee_addresses where employee_id = e and address_type = 'present';
  if n <> 2 then raise exception 'EMPLOYEE-WRITES FAIL: an address change made % present rows', n; end if;
  select count(*) into n from public.employee_addresses
   where employee_id = e and address_type = 'permanent' and effective_to is null and city = 'Bengaluru';
  if n <> 1 then raise exception 'EMPLOYEE-WRITES FAIL: the permanent address was not kept open'; end if;
  perform pg_temp.ew_ok('an address change closes the old row the day before and keeps it');
  perform pg_temp.ew_refused('a date on or before the open row''s start is a clash', hema,
    format($q$select public.employee_add_address(%L, jsonb_build_object('addressType','present',
      'effectiveFrom','2025-06-01','line','x','city','y','state','z','pincode','560001'))$q$, e),
    'EFFECTIVE_DATE_CLASH');
  perform pg_temp.ew_refused('a bad pincode is refused', hema,
    format($q$select public.employee_add_address(%L, jsonb_build_object('addressType','emergency',
      'effectiveFrom','2025-06-01','line','x','city','y','state','z','pincode','12345'))$q$, e),
    'INVALID_VALUE');

  -- ── 4 · a posting change is two rows with an order ref (criteria 3, 4)
  perform pg_temp.ew_run(hema, format($q$select public.employee_move_unit(%L, jsonb_build_object(
    'unitId',%L,'effectiveFrom','2024-04-01','orderRef','DO-2024-0001'))$q$, e, hq));
  r := pg_temp.ew_run(hema, format($q$select public.employee_move_unit(%L, jsonb_build_object(
    'unitId',%L,'effectiveFrom','2025-06-01','orderRef','DO-2025-0042','reason','Client asked'))$q$, e, site));
  if r -> 'closed' ->> 'lastDay' is distinct from '2025-05-31' then
    raise exception 'EMPLOYEE-WRITES FAIL: the old posting should end 31 May, got %', r;
  end if;
  select count(*) into n from public.employee_deployments where employee_id = e;
  if n <> 2 then raise exception 'EMPLOYEE-WRITES FAIL: a move made % postings', n; end if;
  perform pg_temp.ew_ok('a move closes the posting the day before and opens one with its order ref');
  perform pg_temp.ew_refused('a move needs an order reference', hema,
    format($q$select public.employee_move_unit(%L, jsonb_build_object('unitId',%L,'effectiveFrom','2026-01-01','orderRef','  '))$q$, e, hq),
    'ORDER_REF_REQUIRED');
  perform pg_temp.ew_refused('a retired unit is not offered', hema,
    format($q$select public.employee_move_unit(%L, jsonb_build_object('unitId',%L,'effectiveFrom','2026-01-01','orderRef','X'))$q$, e, old_u),
    'UNIT_NOT_AVAILABLE');
  perform pg_temp.ew_refused('another company''s unit is not offered', hema,
    format($q$select public.employee_move_unit(%L, jsonb_build_object('unitId',%L,'effectiveFrom','2026-01-01','orderRef','X'))$q$, e, theirs),
    'UNIT_NOT_AVAILABLE');
  perform pg_temp.ew_refused('moving to where they already are is refused', hema,
    format($q$select public.employee_move_unit(%L, jsonb_build_object('unitId',%L,'effectiveFrom','2026-01-01','orderRef','X'))$q$, e, site),
    'ALREADY_DEPLOYED_THERE');
  perform pg_temp.ew_refused('a move dated before the current posting is a clash', hema,
    format($q$select public.employee_move_unit(%L, jsonb_build_object('unitId',%L,'effectiveFrom','2025-01-01','orderRef','X'))$q$, e, hq),
    'EFFECTIVE_DATE_CLASH');

  -- ── 5 · nominees off 100 save nothing (criterion 5)
  perform pg_temp.ew_refused('shares totalling 90 are refused', hema,
    format($q$select public.employee_save_nomination(%L, '{"effectiveFrom":"2024-04-01","nominees":[
      {"name":"Lakshmi","relation":"mother","sharePercent":60},{"name":"Aarav","relation":"son","sharePercent":30}]}')$q$, e),
    'NOMINEE_SHARES_NOT_100');
  select count(*) into n from public.nomination_versions where employee_id = e;
  if n <> 0 then raise exception 'EMPLOYEE-WRITES FAIL: a refused nomination left a version'; end if;
  perform pg_temp.ew_run(hema, format($q$select to_jsonb(public.employee_save_nomination(%L, '{"effectiveFrom":"2024-04-01","nominees":[
      {"name":"Lakshmi","relation":"mother","sharePercent":70},{"name":"Aarav","relation":"son","sharePercent":30}]}'))$q$, e));
  perform pg_temp.ew_run(hema, format($q$select to_jsonb(public.employee_save_nomination(%L, '{"effectiveFrom":"2025-01-01","nominees":[
      {"name":"Lakshmi","relation":"mother","sharePercent":100}]}'))$q$, e));
  select count(*) into n from public.nomination_versions where employee_id = e;
  if n <> 2 then raise exception 'EMPLOYEE-WRITES FAIL: superseding made % versions', n; end if;
  select count(*) into n from public.nominees nm join public.nomination_versions v on v.id = nm.version_id
   where v.employee_id = e and v.effective_to = '2025-01-01';
  if n <> 2 then raise exception 'EMPLOYEE-WRITES FAIL: the superseded nomination lost its nominees'; end if;
  perform pg_temp.ew_ok('a new nomination supersedes the old, which keeps its nominees');
  perform pg_temp.ew_refused('no nominees is refused', hema,
    format($q$select public.employee_save_nomination(%L, '{"effectiveFrom":"2026-01-01","nominees":[]}')$q$, e),
    'NOMINEES_REQUIRED');

  -- ── 6 · previous organisations feed total experience
  months := (pg_temp.ew_run(hema, format('select public.employee_card(%L)', e)) ->> 'totalExperienceMonths')::int;
  perform pg_temp.ew_do(hema, format($q$select public.employee_save_previous_orgs(%L,
    '[{"organisationName":"SIS Security","designation":"Guard","fromDate":"2019-01-01","toDate":"2020-12-31"}]')$q$, e));
  if (pg_temp.ew_run(hema, format('select public.employee_card(%L)', e)) ->> 'totalExperienceMonths')::int
     is distinct from months + 23 then
    raise exception 'EMPLOYEE-WRITES FAIL: two years at SIS did not add 23 whole months';
  end if;
  perform pg_temp.ew_refused('a previous job ending before it starts is refused', hema,
    format($q$select public.employee_save_previous_orgs(%L,
      '[{"organisationName":"X","fromDate":"2020-01-01","toDate":"2019-01-01"}]')$q$, e), 'INVALID_VALUE');
  perform pg_temp.ew_ok('previous organisations are saved whole and feed total experience');

  -- ── 7 · module off
  update public.organization_modules set enabled = false
   where organization_id = acme and module_key = 'employee';
  perform pg_temp.ew_refused('module off: no writes', hema,
    format($q$select public.employee_update(%L, '{"bloodGroup":"O+"}')$q$, e), 'MODULE_NOT_ENABLED');
end $$;

rollback;
