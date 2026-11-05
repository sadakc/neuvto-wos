-- Real employee_import_master() answers, for the Import render tests (D86).
--
-- The screen tests read src/modules/employee/components/__fixtures__/import.json,
-- which is what this file prints against a LOCAL database: the workbook sent,
-- the dry run, and the import, as a Super Admin (Alice) gets them. The test
-- before this one used a hand-written problem list that named a column the
-- database never sends, and called a file with a bad Aadhaar clean.
--
--   psql "$DB" -qtAX -v ON_ERROR_STOP=1 -f neuvto-harness/tools/import_master_fixtures.sql \
--     | npx prettier --stdin-filepath import.json \
--     > src/modules/employee/components/__fixtures__/import.json
--
-- The workbooks must stay what ImportRecords.test.tsx builds from its grids;
-- the test checks the screen sends exactly `workbook`. Everything is rolled
-- back, the imports included.

begin;

create function pg_temp.import_as(_uid uuid, _workbook jsonb, _commit boolean, _only_clean boolean)
returns jsonb as $$
declare v jsonb;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', _uid::text, 'role', 'authenticated')::text, true);
  v := public.employee_import_master(_workbook, _commit, _only_clean);
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  return v;
end $$ language plpgsql;

insert into public.organization_modules (organization_id, module_key, enabled, enabled_at)
values ('00000000-0000-0000-0000-0000000000a0', 'employee', true, now())
on conflict (organization_id, module_key) do update set enabled = true, deleted_at = null;

-- A code already on file would turn every answer into CODE_TAKEN.
do $$ begin
  if exists (select 1 from public.employees
              where organization_id = '00000000-0000-0000-0000-0000000000a0'
                and employee_code in ('E-1', 'E-2', 'E-9')) then
    raise exception 'E-1, E-2 or E-9 is already an employee code here; use a freshly seeded database';
  end if;
end $$;

create temp table wb (k text primary key, workbook jsonb) on commit drop;
insert into wb values
  -- Two good people, one family row.
  ('clean', '{"people": [
      {"employeeCode": "E-1", "fullName": "Mallappa", "aadhaar": "234567890124", "joinedDate": "2026-11-02"},
      {"employeeCode": "E-2", "fullName": "Lakshmi", "aadhaar": "345678901238"}],
    "family": [{"employeeCode": "E-1", "relation": "son", "name": "Arun"}],
    "nominees": [], "previous": []}'),
  -- Lakshmi's Aadhaar is short, and a family row names nobody on People.
  ('problems', '{"people": [
      {"employeeCode": "E-1", "fullName": "Mallappa", "aadhaar": "234567890124", "joinedDate": "2026-11-02"},
      {"employeeCode": "E-2", "fullName": "Lakshmi", "aadhaar": "123"}],
    "family": [{"employeeCode": "E-1", "relation": "son", "name": "Arun"},
               {"employeeCode": "E-9", "relation": "daughter", "name": "Kavya"}],
    "nominees": [], "previous": []}');

-- Each import is undone before the next is asked, so every answer is to the
-- same database. The answers are held in psql variables, which a rollback
-- does not reach.
savepoint s;
select pg_temp.import_as('00000000-0000-0000-0000-00000000a001', workbook, false, false) as clean_check
  from wb where k = 'clean' \gset
rollback to savepoint s;
select pg_temp.import_as('00000000-0000-0000-0000-00000000a001', workbook, true, false) as clean_import
  from wb where k = 'clean' \gset
rollback to savepoint s;
select pg_temp.import_as('00000000-0000-0000-0000-00000000a001', workbook, false, false) as problems_check
  from wb where k = 'problems' \gset
rollback to savepoint s;
select pg_temp.import_as('00000000-0000-0000-0000-00000000a001', workbook, true, true) as problems_import_clean
  from wb where k = 'problems' \gset
rollback to savepoint s;

select jsonb_pretty(jsonb_build_object(
  'clean', jsonb_build_object(
    'workbook', (select workbook from wb where k = 'clean'),
    'check',    :'clean_check'::jsonb,
    'import',   :'clean_import'::jsonb),
  'problems', jsonb_build_object(
    'workbook',    (select workbook from wb where k = 'problems'),
    'check',       :'problems_check'::jsonb,
    'importClean', :'problems_import_clean'::jsonb)
));

rollback;
