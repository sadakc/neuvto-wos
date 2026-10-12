-- Real employee_card() answers, one per relationship, for the render tests.
--
-- The screen tests read src/modules/employee/components/__fixtures__/cards.json,
-- which is the output of this file against a seeded LOCAL database. Hand-written
-- fixtures would let the screen and the database disagree about which keys a
-- role receives; these cannot, because they are what the database sent.
--
-- Regenerate after changing employee_card():
--   supabase db reset --local && psql "$DB" -f neuvto-harness/seed/seed_test_data.sql
--   psql "$DB" -qtAX -v ON_ERROR_STOP=1 -f neuvto-harness/tools/employee_card_fixtures.sql \
--     > src/modules/employee/components/__fixtures__/cards.json
--
-- Everything is rolled back.

begin;

create function pg_temp.card_as(_uid uuid, _of uuid) returns jsonb as $$
declare v jsonb;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', _uid::text, 'role', 'authenticated')::text, true);
  v := public.employee_card(_of);
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  return v;
end $$ language plpgsql;

create function pg_temp.as_(_uid uuid) returns void as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', _uid::text, 'role', 'authenticated')::text, true);
end $$ language plpgsql;

create function pg_temp.root_() returns void as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$ language plpgsql;

do $$
declare
  acme uuid := '00000000-0000-0000-0000-0000000000a0';
  e uuid; unit1 uuid; unit2 uuid; ver uuid; dsg uuid;
begin
  insert into public.organization_modules (organization_id, module_key, enabled, enabled_at)
  values (acme, 'employee', true, now())
  on conflict (organization_id, module_key) do update set enabled = true, deleted_at = null;
  insert into public.user_roles (user_id, organization_id, role)
  values ('00000000-0000-0000-0000-00000000a008', acme, 'payroll_officer'),
         ('00000000-0000-0000-0000-00000000a007', acme, 'statutory_officer');

  select id into e from public.employees where profile_id = '00000000-0000-0000-0000-00000000a006';
  insert into public.designations (organization_id, name, grade)
  values (acme, 'Security Supervisor', 'S2') returning id into dsg;
  update public.employees set
    employee_code = 'ACM-0042', designation_id = dsg, employment_type = 'full_time',
    confirmed_on = '2024-10-01', date_of_birth = '1994-06-12', sex = 'female',
    marital_status = 'married', nationality = 'Indian', native_state = 'Karnataka',
    personal_email = 'priya@home.test', blood_group = 'B+', name_as_per_id = 'PRIYA E',
    education_qualification = 'B.Com', alternate_mobile = '+91 98450 11122',
    height_cm = 162, weight_kg = 58,
    emergency_contact_name = 'Lakshmi', emergency_contact_relation = 'mother',
    emergency_contact_phone = '+91 98000 00000', nearest_police_station = 'Yelahanka'
   where id = e;

  insert into public.employee_addresses
    (organization_id, employee_id, address_type, line, city, state, pincode, effective_from, effective_to)
  values (acme, e, 'present', '12 Old Road', 'Mysuru', 'Karnataka', '570001', '2020-01-01', '2024-03-01');  -- exclusive end: last day 29 Feb
  insert into public.employee_addresses
    (organization_id, employee_id, address_type, line, city, state, pincode, effective_from)
  values (acme, e, 'present', '402 Brigade Meadows', 'Bengaluru', 'Karnataka', '560062', '2024-03-01');

  insert into public.family_members (organization_id, employee_id, relation, name)
  values (acme, e, 'son', 'Aarav'), (acme, e, 'daughter', 'Diya'), (acme, e, 'son', 'Kabir');

  insert into public.deployment_units (organization_id, name, unit_type)
  values (acme, 'Acme HQ, Bengaluru', 'own_establishment') returning id into unit1;
  insert into public.deployment_units (organization_id, name, unit_type, client_name)
  values (acme, 'Tata AIG, Hosur', 'client_site', 'Tata AIG') returning id into unit2;
  insert into public.employee_deployments
    (organization_id, employee_id, deployment_unit_id, effective_from, effective_to, deployment_order_ref)
  values (acme, e, unit1, '2024-04-01', '2025-06-01', 'DO-2024-0001');  -- exclusive end: last day 31 May
  insert into public.employee_deployments
    (organization_id, employee_id, deployment_unit_id, effective_from, deployment_order_ref)
  values (acme, e, unit2, '2025-06-01', 'DO-2025-0042');

  insert into public.nomination_versions (organization_id, employee_id, effective_from)
  values (acme, e, '2024-04-01') returning id into ver;
  insert into public.nominees (organization_id, version_id, name, relation, share_percent)
  values (acme, ver, 'Lakshmi', 'mother', 70), (acme, ver, 'Aarav', 'son', 30);

  -- E6: written through the real functions, as the roles §5 lets write them.
  if to_regprocedure('public.employee_set_statutory(uuid,jsonb)') is not null then
    perform pg_temp.as_('00000000-0000-0000-0000-00000000a002');  -- Hema, Admin
    perform public.employee_set_statutory(e, jsonb_build_object(
      'aadhaar', '234567890124', 'pan', 'ABCDE1234F', 'uan', '101234567890',
      'epfNumber', 'MHBAN00000640000000125', 'esicNumber', '3100123456',
      'identityDocumentType', 'aadhaar', 'verifiedOn', '2024-04-10',
      'policeVerification', 'verified', 'policeVerifiedOn', '2024-05-01'));
    perform pg_temp.as_('00000000-0000-0000-0000-00000000a008');  -- Payroll
    perform public.employee_set_bank(e, jsonb_build_object(
      'bankName', 'HDFC Bank', 'branch', 'Yelahanka', 'account', '004512345678',
      'ifsc', 'HDFC0001234', 'accountHolder', 'PRIYA E', 'pennyDropStatus', 'verified'));
    perform pg_temp.as_('00000000-0000-0000-0000-00000000a007');  -- Statutory
    perform public.employee_set_restricted(e, '{"religion":"Hindu","casteCategory":"obc"}');
    perform pg_temp.root_();
  end if;

  insert into public.previous_organisations
    (organization_id, employee_id, organisation_name, designation, from_date, to_date, reason_for_leaving)
  values (acme, e, 'SIS Security', 'Guard', '2019-01-01', '2024-03-15', 'Better role');
end $$;

set constraints all immediate;

select jsonb_pretty(jsonb_build_object(
  'self',      pg_temp.card_as('00000000-0000-0000-0000-00000000a006', null),
  'colleague', pg_temp.card_as('00000000-0000-0000-0000-00000000a005',
                 (select id from public.employees where profile_id = '00000000-0000-0000-0000-00000000a006')),
  'approver',  pg_temp.card_as('00000000-0000-0000-0000-00000000a004',
                 (select id from public.employees where profile_id = '00000000-0000-0000-0000-00000000a006')),
  'payroll',   pg_temp.card_as('00000000-0000-0000-0000-00000000a008',
                 (select id from public.employees where profile_id = '00000000-0000-0000-0000-00000000a006')),
  'statutory', pg_temp.card_as('00000000-0000-0000-0000-00000000a007',
                 (select id from public.employees where profile_id = '00000000-0000-0000-0000-00000000a006')),
  'admin',     pg_temp.card_as('00000000-0000-0000-0000-00000000a001',
                 (select id from public.employees where profile_id = '00000000-0000-0000-0000-00000000a006'))
));

rollback;
