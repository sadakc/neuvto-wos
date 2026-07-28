-- NEUVTO WOS — Test seed data
--
-- Creates the conditions that surface multi-tenant, balance, and approval bugs.
-- Safe to re-run: truncates the tables it owns first.
-- TEST ENVIRONMENTS ONLY. Never run against production.
--
-- PHASE-AWARE. The build lands in phases, so every block is guarded by whether
-- its table exists yet. After Phase 0 only the platform tables are seeded; the
-- leave blocks switch themselves on when Phase 2 creates them. A harness that
-- only works on a finished schema is a harness nobody runs during the build.
--
-- Design notes:
--   Org A (Acme)  — India: April FY, Sat/Sun weekend, IST
--   Org B (Vertex)— Gulf:  January FY, Fri/Sat weekend, GST
--   Org B exists to prove the FY, weekend, timezone and approval-chain config
--   paths are genuinely data-driven and not hardcoded to Org A's assumptions.

begin;

-- ---------------------------------------------------------------- reset
-- Child-to-parent order; skips anything not yet created.
do $$
declare
  t text;
  ordered text[] := array[
    'leave_requests','leave_balances','leave_types',
    'approval_steps','approval_requests','approval_chains',
    'notifications','notification_templates','audit_logs','holidays',
    'analytics_events','user_roles','profiles','departments',
    'organization_modules','module_settings','organization_settings','organizations'
  ];
begin
  foreach t in array ordered loop
    if to_regclass('public.' || t) is not null then
      execute format('truncate table public.%I cascade', t);
    end if;
  end loop;
end $$;

delete from auth.users
 where email like '%@acme.test' or email like '%@vertex.test' or email like '%@orphan.test';

-- ---------------------------------------------------------------- auth users
-- Direct auth.users insert is test-only; the app creates these via Supabase Auth.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       u.email, crypt('TestPass123!', gen_salt('bf')),
       now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb
from (values
  ('00000000-0000-0000-0000-00000000a001'::uuid, 'alice.admin@acme.test'),
  ('00000000-0000-0000-0000-00000000a002'::uuid, 'hema.hr@acme.test'),
  ('00000000-0000-0000-0000-00000000a003'::uuid, 'dan.director@acme.test'),
  ('00000000-0000-0000-0000-00000000a004'::uuid, 'mark.manager@acme.test'),
  ('00000000-0000-0000-0000-00000000a005'::uuid, 'ravi.emp@acme.test'),
  ('00000000-0000-0000-0000-00000000a006'::uuid, 'priya.emp@acme.test'),
  ('00000000-0000-0000-0000-00000000a007'::uuid, 'newjoiner.emp@acme.test'),
  ('00000000-0000-0000-0000-00000000a008'::uuid, 'nomanager.emp@acme.test'),
  ('00000000-0000-0000-0000-00000000b001'::uuid, 'bob.admin@vertex.test'),
  ('00000000-0000-0000-0000-00000000b002'::uuid, 'sara.emp@vertex.test'),
  ('00000000-0000-0000-0000-0000000000ff'::uuid, 'ghost@orphan.test')
) as u(id, email);

-- ghost@orphan.test deliberately gets NO profile row.
-- Any authenticated request from it must return zero rows everywhere.

-- ---------------------------------------------------------------- organizations
insert into public.organizations (id, name, slug) values
  ('00000000-0000-0000-0000-0000000000a0', 'Acme Security Services', 'acme'),
  ('00000000-0000-0000-0000-0000000000b0', 'Vertex Facilities',      'vertex');

-- Different timezones are deliberate: an org-local "today" bug is invisible
-- when every tenant shares the server's timezone.
insert into public.organization_settings
  (organization_id, timezone, fy_start_month, fy_start_day, weekend_days,
   exclude_weekends, exclude_holidays, allow_retroactive, default_min_notice_days)
values
  ('00000000-0000-0000-0000-0000000000a0', 'Asia/Kolkata', 4, 1, '{0,6}', true, true, false, 1),
  ('00000000-0000-0000-0000-0000000000b0', 'Asia/Dubai',   1, 1, '{5,6}', true, true, true,  0);

insert into public.organization_modules (organization_id, module_key, enabled, enabled_at) values
  ('00000000-0000-0000-0000-0000000000a0', 'leave', true, now()),
  ('00000000-0000-0000-0000-0000000000b0', 'leave', true, now());

insert into public.departments (id, organization_id, name) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a0', 'Operations'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a0', 'Corporate'),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000b0', 'Facilities');

-- ---------------------------------------------------------------- profiles
-- joined_date variety is deliberate: it drives pro-rated entitlement (D3).
insert into public.profiles
  (id, organization_id, full_name, email, joined_date, manager_id, department_id) values
  ('00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-0000000000a0','Alice Admin',   'alice.admin@acme.test',  '2023-01-10', null, '00000000-0000-0000-0000-0000000000d2'),
  ('00000000-0000-0000-0000-00000000a002','00000000-0000-0000-0000-0000000000a0','Hema HR',       'hema.hr@acme.test',      '2023-03-01', null, '00000000-0000-0000-0000-0000000000d2'),
  ('00000000-0000-0000-0000-00000000a003','00000000-0000-0000-0000-0000000000a0','Dan Director',  'dan.director@acme.test', '2022-06-15', null, '00000000-0000-0000-0000-0000000000d1'),
  ('00000000-0000-0000-0000-00000000a004','00000000-0000-0000-0000-0000000000a0','Mark Manager',  'mark.manager@acme.test', '2023-02-01', '00000000-0000-0000-0000-00000000a003', '00000000-0000-0000-0000-0000000000d1'),
  ('00000000-0000-0000-0000-00000000a005','00000000-0000-0000-0000-0000000000a0','Ravi Employee', 'ravi.emp@acme.test',     '2024-04-01', '00000000-0000-0000-0000-00000000a004', '00000000-0000-0000-0000-0000000000d1'),
  ('00000000-0000-0000-0000-00000000a006','00000000-0000-0000-0000-0000000000a0','Priya Employee','priya.emp@acme.test',    '2024-04-01', '00000000-0000-0000-0000-00000000a004', '00000000-0000-0000-0000-0000000000d1'),
  -- mid-year joiner: pro-rating must give roughly half a year's entitlement
  ('00000000-0000-0000-0000-00000000a007','00000000-0000-0000-0000-0000000000a0','New Joiner',    'newjoiner.emp@acme.test','2026-10-01', '00000000-0000-0000-0000-00000000a004', '00000000-0000-0000-0000-0000000000d1'),
  -- no manager: approval resolution must fail gracefully, not crash
  ('00000000-0000-0000-0000-00000000a008','00000000-0000-0000-0000-0000000000a0','No Manager',    'nomanager.emp@acme.test','2024-01-01', null, '00000000-0000-0000-0000-0000000000d1'),
  ('00000000-0000-0000-0000-00000000b001','00000000-0000-0000-0000-0000000000b0','Bob Admin',     'bob.admin@vertex.test',  '2023-01-01', null, '00000000-0000-0000-0000-0000000000d3'),
  ('00000000-0000-0000-0000-00000000b002','00000000-0000-0000-0000-0000000000b0','Sara Employee', 'sara.emp@vertex.test',   '2024-01-01', '00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-0000000000d3');

insert into public.user_roles (user_id, organization_id, role) values
  ('00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-0000000000a0','org_admin'),
  ('00000000-0000-0000-0000-00000000a002','00000000-0000-0000-0000-0000000000a0','hr_admin'),
  ('00000000-0000-0000-0000-00000000a003','00000000-0000-0000-0000-0000000000a0','manager'),
  ('00000000-0000-0000-0000-00000000a004','00000000-0000-0000-0000-0000000000a0','manager'),
  ('00000000-0000-0000-0000-00000000a005','00000000-0000-0000-0000-0000000000a0','employee'),
  ('00000000-0000-0000-0000-00000000a006','00000000-0000-0000-0000-0000000000a0','employee'),
  ('00000000-0000-0000-0000-00000000a007','00000000-0000-0000-0000-0000000000a0','employee'),
  ('00000000-0000-0000-0000-00000000a008','00000000-0000-0000-0000-0000000000a0','employee'),
  ('00000000-0000-0000-0000-00000000b001','00000000-0000-0000-0000-0000000000b0','org_admin'),
  ('00000000-0000-0000-0000-00000000b002','00000000-0000-0000-0000-0000000000b0','employee');

-- ================================================================ PHASE 1+
-- Everything below switches itself on when the owning migration lands.

-- ---------------------------------------------------------------- calendar
do $$
begin
  if to_regclass('public.holidays') is not null then
    insert into public.holidays (organization_id, name, holiday_date) values
      ('00000000-0000-0000-0000-0000000000a0','Independence Day','2026-08-15'),
      ('00000000-0000-0000-0000-0000000000a0','Diwali',          '2026-11-08'),
      ('00000000-0000-0000-0000-0000000000b0','New Year',        '2027-01-01');
    raise notice 'seeded: holidays';
  end if;
end $$;

-- ---------------------------------------------------------------- approval chains
-- Acme: L1 reporting manager; L2 manager-of-manager only when days > 3.
-- Vertex: single level, no condition. Proves chains are per-org.
do $$
begin
  if to_regclass('public.approval_chains') is not null then
    insert into public.approval_chains
      (organization_id, entity_type, level, approver_rule,
       condition_field, condition_op, condition_value, escalate_after_days)
    values
      ('00000000-0000-0000-0000-0000000000a0','leave_request',1,'reporting_manager',  null,          null,null,2),
      ('00000000-0000-0000-0000-0000000000a0','leave_request',2,'manager_of_manager','working_days','>', 3,  2),
      ('00000000-0000-0000-0000-0000000000b0','leave_request',1,'reporting_manager',  null,          null,null,3);
    raise notice 'seeded: approval_chains';
  end if;
end $$;

-- ---------------------------------------------------------------- leave types
do $$
begin
  if to_regclass('public.leave_types') is not null then
    insert into public.leave_types
      (id, organization_id, name, max_days_per_year, max_per_request, min_notice_days, status)
    values
      ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000a0','Casual', 12, 5,    1, 'active'),
      ('00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000a0','Sick',    8, null, 0, 'active'),
      ('00000000-0000-0000-0000-0000000000c3','00000000-0000-0000-0000-0000000000a0','Retired', 5, null, 0, 'archived'),
      ('00000000-0000-0000-0000-0000000000c4','00000000-0000-0000-0000-0000000000b0','Annual', 20, null, 0, 'active');
    raise notice 'seeded: leave_types';
  end if;
end $$;

-- ---------------------------------------------------------------- balances
-- Deliberately includes a low balance to make the overdraw path reachable.
do $$
begin
  if to_regclass('public.leave_balances') is not null then
    insert into public.leave_balances
      (organization_id, employee_id, leave_type_id, fy_label,
       entitled_days, used_days, reserved_days, pending_days)
    values
      ('00000000-0000-0000-0000-0000000000a0','00000000-0000-0000-0000-00000000a005','00000000-0000-0000-0000-0000000000c1','2026-27',12,2,0,0),
      ('00000000-0000-0000-0000-0000000000a0','00000000-0000-0000-0000-00000000a005','00000000-0000-0000-0000-0000000000c2','2026-27', 8,1,0,0),
      -- Priya has only 3 available: requesting 5 must be blocked
      ('00000000-0000-0000-0000-0000000000a0','00000000-0000-0000-0000-00000000a006','00000000-0000-0000-0000-0000000000c1','2026-27',12,6,0,3),
      ('00000000-0000-0000-0000-0000000000a0','00000000-0000-0000-0000-00000000a008','00000000-0000-0000-0000-0000000000c1','2026-27',12,0,0,0),
      ('00000000-0000-0000-0000-0000000000b0','00000000-0000-0000-0000-00000000b002','00000000-0000-0000-0000-0000000000c4','2026',   20,0,0,0);
    raise notice 'seeded: leave_balances';
  end if;
end $$;

commit;

-- ---------------------------------------------------------------- summary
select o.name as org,
       (select count(*) from public.profiles p    where p.organization_id = o.id) as people,
       (select count(*) from public.user_roles r  where r.organization_id = o.id) as roles,
       (select count(*) from public.departments d where d.organization_id = o.id) as departments
from public.organizations o order by o.name;
