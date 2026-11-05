-- Real employee_field_settings() rows, for the render tests (D107).
--
-- The screen tests read src/modules/employee/components/__fixtures__/fieldSettings.json,
-- which is what this file prints against a LOCAL database: Neuvto's answers,
-- as a Super Admin (Alice) and as an Employee Admin (Hema) see them. Any
-- company's own answers are set aside first, so the output is the defaults.
--
--   psql "$DB" -qtAX -v ON_ERROR_STOP=1 -f neuvto-harness/tools/field_settings_fixture.sql \
--     > src/modules/employee/components/__fixtures__/fieldSettings.json
--
-- Everything is rolled back.

begin;

create function pg_temp.rows_as(_uid uuid) returns jsonb as $$
declare v jsonb;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', _uid::text, 'role', 'authenticated')::text, true);
  select jsonb_agg(to_jsonb(r)) into v from public.employee_field_settings() r;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  return v;
end $$ language plpgsql;

insert into public.organization_modules (organization_id, module_key, enabled, enabled_at)
values ('00000000-0000-0000-0000-0000000000a0', 'employee', true, now())
on conflict (organization_id, module_key) do update set enabled = true, deleted_at = null;
delete from public.employee_field_settings;

select jsonb_pretty(jsonb_build_object(
  'superAdmin',    pg_temp.rows_as('00000000-0000-0000-0000-00000000a001'),
  'employeeAdmin', pg_temp.rows_as('00000000-0000-0000-0000-00000000a002')
));

rollback;
