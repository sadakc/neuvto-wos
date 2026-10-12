-- NEUVTO WOS — bulk import of employee records (E8)
--
-- Raises on the first violation. Silence means pass. Rolled back.
--
-- PHASE-AWARE: exits quietly if employee_import_commit does not exist yet.
--
-- E8's criterion: a dry run before any commit, and the commit never trusts it.

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
  raise notice 'ok: %', _label;
end $$ language plpgsql;

create or replace function pg_temp.im_json(_uid uuid, _sql text) returns jsonb as $$
declare v jsonb;
begin
  perform pg_temp.im_as(_uid);
  execute _sql into v;
  perform pg_temp.im_root();
  return v;
exception when others then
  perform pg_temp.im_root();
  raise exception 'IMPORT FAIL: refused: % — %', _sql, sqlerrm;
end $$ language plpgsql;

do $$
declare
  acme  uuid := '00000000-0000-0000-0000-0000000000a0';
  alice uuid := '00000000-0000-0000-0000-00000000a001';  -- Super Admin
  hema  uuid := '00000000-0000-0000-0000-00000000a002';  -- Admin
  rows_ jsonb;
  r     jsonb;
  n0    integer;
  n     integer;
begin
  if to_regprocedure('public.employee_import_commit(jsonb,boolean)') is null then
    raise notice 'skip: employee import does not exist yet';
    return;
  end if;

  insert into public.organization_modules (organization_id, module_key, enabled, enabled_at)
  values (acme, 'employee', true, now())
  on conflict (organization_id, module_key) do update set enabled = true, deleted_at = null;
  insert into public.designations (organization_id, name) values (acme, 'Security Guard');
  insert into public.deployment_units (organization_id, name, unit_type, client_name)
  values (acme, 'Tata AIG, Hosur', 'client_site', 'Tata AIG');

  rows_ := $j$[
    {"full_name":"Asha K","email":"asha@acme.test","joined_date":"2026-11-01","designation":"security guard",
     "department":"operations","reports_to_email":"MARK.MANAGER@acme.test","employment_type":"Full Time",
     "date_of_birth":"1995-02-03","sex":"Female","blood_group":"o+","emergency_contact_name":"Ravi K",
     "emergency_contact_phone":"+91 90000 22222","deployed_unit":"Tata AIG, Hosur","deployment_order_ref":"DO-IMP-1"},
    {"full_name":"No Email","joined_date":"2026-11-01"},
    {"full_name":"Bad Designation","designation":"Astronaut"},
    {"full_name":"Twin One","email":"twin@acme.test"},
    {"full_name":"Twin Two","email":"TWIN@acme.test"},
    {"full_name":"Existing","email":"ravi.emp@acme.test"},
    {"full_name":"Bad Date","joined_date":"01/11/2026"},
    {"full_name":"Unit Without Order","deployed_unit":"Tata AIG, Hosur","joined_date":"2026-11-01"},
    {"full_name":"","email":"nameless@acme.test"}
  ]$j$::jsonb;

  -- ── 1 · who may
  perform pg_temp.im_refused('an Admin who is not Super Admin cannot import', hema,
    format('select public.employee_import_check(%L)', rows_), 'FORBIDDEN');
  perform pg_temp.im_refused('a statutory column is not importable', alice,
    $q$select public.employee_import_check('[{"full_name":"X","aadhaar":"234567890124"}]')$q$, 'UNKNOWN_COLUMN');
  perform pg_temp.im_refused('an empty file is refused', alice,
    $q$select public.employee_import_check('[]')$q$, 'NO_ROWS');

  -- ── 2 · the dry run says what is wrong, by row and column, and writes nothing
  select count(*) into n0 from public.employees;
  r := pg_temp.im_json(alice, format('select public.employee_import_check(%L)', rows_));
  select count(*) into n from public.employees;
  if n is distinct from n0 then raise exception 'IMPORT FAIL: the dry run wrote % records', n - n0; end if;
  if r -> 0 -> 'problems' is distinct from '{}'::jsonb
     or r -> 1 -> 'problems' is distinct from '{}'::jsonb
     or r -> 2 -> 'problems' ->> 'designation' is distinct from 'Not in the designation list'
     or r -> 3 -> 'problems' is distinct from '{}'::jsonb
     or r -> 4 -> 'problems' ->> 'email' is distinct from 'Appears twice in this file'
     or r -> 5 -> 'problems' ->> 'email' is distinct from 'Already a member'
     or r -> 6 -> 'problems' ->> 'joined_date' is null
     or r -> 7 -> 'problems' ->> 'deployment_order_ref' is null
     or r -> 8 -> 'problems' ->> 'full_name' is distinct from 'Required' then
    raise exception 'IMPORT FAIL: the dry run reads %', r;
  end if;
  raise notice 'ok: the dry run names each problem by row and column, and writes nothing';

  -- ── 3 · all or nothing, unless asked for the clean rows only
  perform pg_temp.im_refused('a file with problems is refused whole', alice,
    format('select public.employee_import_commit(%L, false)', rows_), 'ROWS_NEED_ATTENTION');
  select count(*) into n from public.employees;
  if n is distinct from n0 then raise exception 'IMPORT FAIL: a refused import wrote % records', n - n0; end if;

  r := pg_temp.im_json(alice, format('select public.employee_import_commit(%L, true)', rows_));
  if (r ->> 'created')::int is distinct from 3 or (r ->> 'skipped')::int is distinct from 6 then
    raise exception 'IMPORT FAIL: the clean import reports %', r;
  end if;
  select count(*) into n from public.employees e
    join public.designations d on d.id = e.designation_id
   where e.draft_email = 'asha@acme.test' and d.name = 'Security Guard'
     and e.employment_type = 'full_time' and e.sex = 'female' and e.blood_group = 'O+'
     and e.draft_manager_id = '00000000-0000-0000-0000-00000000a004'
     and exists (select 1 from public.employee_deployments x where x.employee_id = e.id
                  and x.effective_to is null and x.deployment_order_ref = 'DO-IMP-1'
                  and x.effective_from = '2026-11-01');
  if n is distinct from 1 then raise exception 'IMPORT FAIL: the full row did not land as a complete draft'; end if;
  raise notice 'ok: the clean rows come in as drafts, names matched case-blind, the posting made';

  -- ── 4 · the commit re-checks; it never trusts the earlier dry run
  perform pg_temp.im_refused('the same file again finds its own drafts', alice,
    format($q$select public.employee_import_commit('[{"full_name":"Asha K","email":"asha@acme.test"}]', false)$q$),
    'ROWS_NEED_ATTENTION');
end $$;

rollback;
