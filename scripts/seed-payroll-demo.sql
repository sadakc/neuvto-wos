-- ═══════════════════════════════════════════════════════════════════════════
-- DEMO DATA — a payroll workspace you can look at without setting one up
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Run it:   psql "$DB" -f scripts/seed-payroll-demo.sql
--
-- ── This is NOT a migration, and must never become one ─────────────────────
--
-- It lives in scripts/ rather than supabase/migrations/ deliberately. Anything
-- under migrations runs against every database this product is ever deployed
-- to, and a customer whose workspace arrived pre-populated with eight invented
-- salaries would be right to ask what else we made up.
--
-- ── The guard ──────────────────────────────────────────────────────────────
--
-- It refuses to run unless the target is the local seed workspace, identified
-- by a fixture UUID that only exists in a seeded development database. A real
-- organisation's id is random; this one is `...0000a0` because somebody typed
-- it. That is the whole check, and it is enough: the failure mode being guarded
-- against is a tired person running this file against the wrong DB, not a
-- determined one.
--
-- ── What it leaves alone ───────────────────────────────────────────────────
--
-- It seeds CONFIGURATION and INPUTS: components, structures, statutory and bank
-- details, templates, module settings, and an approval chain for pay runs. It
-- does NOT write pay_run_lines. Those figures come from `src/payroll-core`, and
-- a fixture that hand-wrote them would be a set of numbers agreeing with itself
-- rather than with the engine — which is exactly the failure this module keeps
-- finding. Open the run in the app and compute it.
--
-- Idempotent. Run it as often as you like.
--
-- ── After `bun run harness` ────────────────────────────────────────────────
--
-- The harness truncates and reseeds, so it takes this with it. Getting back:
--
--   1. grant payroll to the workspace again (organization_modules)
--   2. psql "$DB" -f scripts/seed-payroll-demo.sql
--   3. sign in as hema.hr@acme.test  → Pay runs → Compute → Submit for approval
--   4. sign in as alice.admin@acme.test → Approvals → Approve
--
-- Steps 3 and 4 are two people because nobody may approve their own submission
-- (D13). That is the product working, not an obstacle to route around.

\set ON_ERROR_STOP on

do $$
declare
  org  uuid := '00000000-0000-0000-0000-0000000000a0';
  v_name text;

  -- The seed workspace's people, by their fixture ids.
  alice uuid := '00000000-0000-0000-0000-00000000a001';
  hema  uuid := '00000000-0000-0000-0000-00000000a002';
  dan   uuid := '00000000-0000-0000-0000-00000000a003';
  mark  uuid := '00000000-0000-0000-0000-00000000a004';
  ravi  uuid := '00000000-0000-0000-0000-00000000a005';
  priya uuid := '00000000-0000-0000-0000-00000000a006';
  joiner uuid := '00000000-0000-0000-0000-00000000a007';
  nomgr uuid := '00000000-0000-0000-0000-00000000a008';

  c_basic uuid; c_hra uuid; c_conv uuid; c_med uuid; c_spec uuid; c_join uuid;
  c_canteen uuid; c_advance uuid; c_vpf uuid; c_fuel uuid; c_phone uuid;
  t_ops1 uuid; t_ops2 uuid; t_mgmt uuid;
  v_run uuid;
begin
  select name into v_name from public.organizations where id = org;
  if v_name is null then
    raise exception 'DEMO SEED REFUSED: the local seed workspace % does not exist here. This file is for a seeded development database only.', org;
  end if;
  raise notice 'seeding payroll demo data into "%"', v_name;

  -- D64. True, and it makes the test-workspace banner appear, which is the
  -- point of the table.
  insert into public.platform_test_organizations (organization_id, reason)
  values (org, 'Local development seed workspace')
  on conflict (organization_id) do nothing;

  -- ═══════════════════════════════════════════════════ employee codes
  --
  -- The payslip and every export carry these. Without them each row reads
  -- "no employee code", which is correct and looks like a fault.
  update public.profiles set employee_code = v.code
    from (values
      (alice, 'ACM0001'), (hema, 'ACM0002'), (dan, 'ACM0003'), (mark, 'ACM0004'),
      (ravi, 'ACM0005'), (priya, 'ACM0006'), (joiner, 'ACM0007'), (nomgr, 'ACM0008')
    ) as v(id, code)
   where public.profiles.id = v.id and public.profiles.employee_code is distinct from v.code;

  -- ═══════════════════════════════════════════════ salary components
  --
  -- One of each shape the engine can be given, so every branch is visible:
  -- a component excluded from PF wages, one that counts only below the ceiling,
  -- one paid whole regardless of days, and two standing deductions.

  insert into public.salary_components
    (organization_id, code, name, name_in_payslip, category, epf, esi, is_pro_rata,
     calculation_type, default_amount, default_percentage, display_order)
  values
    (org, 'basic',      'Basic and DA',            'Basic & DA',            'earning', 'always',          true,  true,  'percent_of_ctc',   null, 50, 10),
    (org, 'hra',        'House rent allowance',    'HRA',                   'earning', 'off',             true,  true,  'percent_of_basic', null, 40, 20),
    (org, 'conveyance', 'Conveyance allowance',    'Conveyance',            'earning', 'under_threshold', false, true,  'flat_amount',      1600, null, 30),
    (org, 'medical',    'Medical allowance',       'Medical',               'earning', 'always',          true,  true,  'flat_amount',      1250, null, 40),
    (org, 'special',    'Special allowance',       'Special allowance',     'earning', 'always',          true,  true,  'flat_amount',      null, null, 50),
    (org, 'joining_bonus','Joining bonus',         'Joining bonus',         'earning', 'off',             false, false, 'flat_amount',      null, null, 60)
  on conflict (organization_id, code) where deleted_at is null
    do update set name = excluded.name, name_in_payslip = excluded.name_in_payslip;

  insert into public.salary_components
    (organization_id, code, name, name_in_payslip, category, epf, esi, is_pro_rata,
     frequency, display_order)
  values
    (org, 'canteen',        'Canteen recovery',       'Canteen',        'deduction', 'off', false, false, 'recurring', 10),
    (org, 'salary_advance', 'Salary advance',         'Advance',        'deduction', 'off', false, false, 'recurring', 20)
  on conflict (organization_id, code) where deleted_at is null
    do update set name = excluded.name;

  insert into public.salary_components
    (organization_id, code, name, name_in_payslip, category, epf, esi, is_pro_rata,
     part_of_structure, display_order)
  values
    (org, 'vpf', 'Voluntary provident fund', 'VPF', 'benefit', 'off', false, true, false, 10)
  on conflict (organization_id, code) where deleted_at is null
    do update set name = excluded.name;

  insert into public.salary_components
    (organization_id, code, name, name_in_payslip, category, epf, esi, is_pro_rata,
     part_of_structure, is_fbp, max_amount_per_month, unclaimed_policy, display_order)
  values
    (org, 'fuel',      'Fuel reimbursement',      'Fuel',      'reimbursement', 'off', false, false, false, true,  5000, 'carry_forward',  10),
    (org, 'telephone', 'Telephone reimbursement', 'Telephone', 'reimbursement', 'off', false, false, false, false, 1500, 'encash_monthly', 20)
  on conflict (organization_id, code) where deleted_at is null
    do update set name = excluded.name;

  select id into c_basic   from public.salary_components where organization_id = org and code = 'basic'          and deleted_at is null;
  select id into c_hra     from public.salary_components where organization_id = org and code = 'hra'            and deleted_at is null;
  select id into c_conv    from public.salary_components where organization_id = org and code = 'conveyance'     and deleted_at is null;
  select id into c_med     from public.salary_components where organization_id = org and code = 'medical'        and deleted_at is null;
  select id into c_spec    from public.salary_components where organization_id = org and code = 'special'        and deleted_at is null;
  select id into c_join    from public.salary_components where organization_id = org and code = 'joining_bonus'  and deleted_at is null;
  select id into c_canteen from public.salary_components where organization_id = org and code = 'canteen'        and deleted_at is null;
  select id into c_advance from public.salary_components where organization_id = org and code = 'salary_advance' and deleted_at is null;

  -- ══════════════════════════════════════════════ salary structures
  --
  -- Effective from the start of the financial year, so any month of 2026-27
  -- can be run. The amounts are invented but the SHAPES are the workbook's:
  -- basic is half of gross, HRA is 40% of basic, conveyance and medical are
  -- flat, and the special allowance is whatever is left. Every row sums exactly
  -- to its intended gross, which is the one property the workbook does hold for
  -- all 44 of its employees.

  create temporary table demo_pay (
    employee_id uuid, basic numeric, hra numeric, conv numeric, med numeric,
    spec numeric, joining numeric, canteen numeric, advance numeric
  ) on commit drop;

  insert into demo_pay values
    -- Well over the ESI ceiling, and over the professional tax band.
    (alice,  30000, 12000, 1600, 1250, 15150, 0,    0,   0),
    (dan,    22500,  9000, 1600, 1250, 10650, 0,    0,   0),
    (hema,   17500,  7000, 1600, 1250,  7650, 0,  250,   0),
    (mark,   14000,  5600, 1600, 1250,  5550, 0,    0, 2000),
    -- Under the ESI ceiling: these payslips show a real ESI deduction.
    (priya,   9000,  3600, 1600, 1250,  2550, 0,  300,   0),
    (ravi,    8000,  3200, 1600, 1250,  1950, 0,    0,   0),
    (nomgr,  10000,  4000, 1600, 1250,  3150, 0,    0,   0),
    -- A joining bonus, which is NOT prorated — the payslip pays it whole
    -- however few days were worked, which is the entire reason for it.
    (joiner,  7000,  2800, 1600, 1250,  1350, 5000,  0,   0);

  insert into public.salary_structures (organization_id, employee_id, effective_from)
  select org, employee_id, date '2026-04-01' from demo_pay
   where not exists (
     select 1 from public.salary_structures s
      where s.employee_id = demo_pay.employee_id and s.effective_from = date '2026-04-01'
        and s.deleted_at is null
   );

  insert into public.salary_structure_lines (organization_id, structure_id, component_id, amount)
  select org, s.id, v.component_id, v.amount
    from demo_pay d
    join public.salary_structures s
      on s.employee_id = d.employee_id and s.effective_from = date '2026-04-01' and s.deleted_at is null
   cross join lateral (values
      (c_basic, d.basic), (c_hra, d.hra), (c_conv, d.conv), (c_med, d.med),
      (c_spec, d.spec), (c_join, d.joining),
      (c_canteen, d.canteen), (c_advance, d.advance)
   ) as v(component_id, amount)
  on conflict (structure_id, component_id) where deleted_at is null
    do update set amount = excluded.amount;

  -- ═══════════════════════════════════ statutory and bank details
  --
  -- Everybody except "No Manager", ON PURPOSE. The structures screen names who
  -- would drop out of which statutory file, and a workspace where nobody is
  -- missing anything cannot show you that it does.

  insert into public.payroll_employee_details
    (organization_id, employee_id, uan, esi_number, pan, bank_name, bank_account_number, bank_ifsc)
  values
    (org, alice,  '100200300001', '3100000001', 'AAAPA1111A', 'Canara Bank',    '0123456789001', 'CNRB0001234'),
    (org, hema,   '100200300002', '3100000002', 'AAAPH2222B', 'Canara Bank',    '0123456789002', 'CNRB0001234'),
    (org, dan,    '100200300003', '3100000003', 'AAAPD3333C', 'Canara Bank',    '0123456789003', 'CNRB0001234'),
    (org, mark,   '100200300004', '3100000004', 'AAAPM4444D', 'Canara Bank',    '0123456789004', 'CNRB0001234'),
    (org, ravi,   '100200300005', '3100000005', 'AAAPR5555E', 'State Bank',     '0123456789005', 'SBIN0004321'),
    (org, priya,  '100200300006', '3100000006', 'AAAPP6666F', 'Canara Bank',    '0123456789006', 'CNRB0001234'),
    (org, joiner, '100200300007', '3100000007', 'AAAPJ7777G', 'State Bank',     '0123456789007', 'SBIN0004321')
  on conflict (employee_id) where deleted_at is null
    do update set uan = excluded.uan, esi_number = excluded.esi_number, pan = excluded.pan,
                  bank_name = excluded.bank_name,
                  bank_account_number = excluded.bank_account_number,
                  bank_ifsc = excluded.bank_ifsc;

  -- No Manager gets a bank account and no UAN, so the PF-return warning has
  -- somebody real to name.
  insert into public.payroll_employee_details
    (organization_id, employee_id, pan, bank_name, bank_account_number, bank_ifsc)
  values (org, nomgr, 'AAAPN8888H', 'State Bank', '0123456789008', 'SBIN0004321')
  on conflict (employee_id) where deleted_at is null
    do update set pan = excluded.pan, bank_name = excluded.bank_name;

  -- ══════════════════════════════════════════════ salary templates

  insert into public.salary_templates (organization_id, name, description)
  values
    (org, 'Operations — grade 1', 'Security officer, entry'),
    (org, 'Operations — grade 2', 'Supervisor'),
    (org, 'Management',           'Department head')
  on conflict (organization_id, lower(name)) where deleted_at is null
    do update set description = excluded.description;

  select id into t_ops1 from public.salary_templates where organization_id = org and name = 'Operations — grade 1' and deleted_at is null;
  select id into t_ops2 from public.salary_templates where organization_id = org and name = 'Operations — grade 2' and deleted_at is null;
  select id into t_mgmt from public.salary_templates where organization_id = org and name = 'Management'           and deleted_at is null;

  insert into public.salary_template_lines (organization_id, template_id, component_id, amount)
  values
    (org, t_ops1, c_basic,  9000), (org, t_ops1, c_hra, 3600), (org, t_ops1, c_conv, 1600),
    (org, t_ops1, c_med,    1250), (org, t_ops1, c_spec, 2550),
    (org, t_ops2, c_basic, 14000), (org, t_ops2, c_hra, 5600), (org, t_ops2, c_conv, 1600),
    (org, t_ops2, c_med,    1250), (org, t_ops2, c_spec, 5550),
    (org, t_mgmt, c_basic, 22500), (org, t_mgmt, c_hra, 9000), (org, t_mgmt, c_conv, 1600),
    (org, t_mgmt, c_med,    1250), (org, t_mgmt, c_spec,10650)
  on conflict (template_id, component_id) where deleted_at is null
    do update set amount = excluded.amount;

  -- ═════════════════════════════════════════════ the module's settings
  --
  -- One row, holding everything the five configuration screens show (D7). The
  -- labour welfare fund is switched ON here, unlike its default, so the scheme
  -- is visible working — it collects in December and takes nothing in July,
  -- which is the behaviour worth seeing.

  insert into public.module_settings (organization_id, module_key, setting_key, value)
  values (org, 'payroll', 'settings', jsonb_build_object(
    'paySchedule', jsonb_build_object(
      'calculationMethod', 'actual_days', 'fixedDays', 30,
      'payDateRule', 'last_working_day', 'payDay', 1),
    'statutory', jsonb_build_object(
      'epf', jsonb_build_object(
        'enabled', true, 'restrictToCeiling', true, 'wageCeiling', 15000,
        'employeeRate', 12, 'pensionRate', 8.33,
        'includeEdli', true, 'edliRate', 0.5,
        'includeAdminCharges', true, 'adminChargeRate', 0.5),
      'esi', jsonb_build_object(
        'enabled', true, 'number', '29-00-123456-000-0001', 'grossCeiling', 21000,
        'employeeRate', 0.75, 'employerRate', 3.25, 'includeEmployerInCtc', false),
      'pt', jsonb_build_object(
        'enabled', true, 'state', 'Karnataka', 'registrationNumber', 'PT/KAR/2026/0042',
        'slabs', jsonb_build_array(
          jsonb_build_object('upTo', 24999, 'amount', 0),
          jsonb_build_object('upTo', null,  'amount', 200))),
      'lwf', jsonb_build_object(
        'enabled', true, 'state', 'Karnataka', 'employee', 50, 'employer', 100,
        'cycle', 'yearly', 'deductInMonth', 12),
      'bonus', jsonb_build_object('enabled', true, 'frequency', 'yearly', 'percentage', 8.33)),
    'taxDetails', jsonb_build_object(
      'pan', 'AAACA1234B', 'tan', 'BLRA12345C', 'tdsCircle', 'BLR / WD / 042 / 01',
      'paymentFrequency', 'monthly', 'deductorType', 'employee',
      'deductorName', 'Hema HR', 'deductorFatherName', 'Ramesh Kumar'),
    'payslip', jsonb_build_object(
      'layout', 'standard',
      'letterhead', '2nd Floor, 14 MG Road, Madikeri, Karnataka 571201',
      'showYearToDate', false,
      'footerNote', 'This is a system-generated payslip and does not require a signature.'),
    'employeePortal', jsonb_build_object(
      'payslipsVisible', true, 'showStatutoryBreakdown', true, 'showPayDate', true,
      'bannerMessage', 'Payroll for the month closes on the 25th. Tell us about any leave before then.',
      'bannerUntil', '2027-03-31',
      'contactName', 'Hema HR', 'contactEmail', 'hema.hr@acme.test')))
  on conflict (organization_id, module_key, setting_key)
    do update set value = excluded.value, deleted_at = null;

  -- ══════════════════════════════════════ who signs off a pay run
  --
  -- Not demo data — a workspace running payroll needs this, and without it
  -- `payroll_submit_run` raises NO_APPROVER. One level, an org admin, so
  -- Hema (hr_admin) submits and Alice (org_admin) approves. D13 forbids
  -- approving your own submission, which is why it takes two people.

  insert into public.approval_chains (organization_id, entity_type, level, approver_rule, approver_role)
  values (org, 'pay_run', 1, 'role', 'org_admin')
  on conflict do nothing;

  -- ═══════════════════════ a draft pay run for July 2026, with its inputs
  --
  -- A DRAFT run and its days — inputs, not results. `computed_at` stays null
  -- and `pay_run_lines` stays empty; pressing Compute in the app is what fills
  -- them, from the engine, which is the only thing entitled to produce a
  -- figure somebody gets paid.
  --
  -- The days are varied on purpose, so the register shows the arithmetic doing
  -- something rather than eight identical full months:
  --
  --   Priya   29.5  a day and a half unpaid — proration, and the half day the
  --                 muster roll produces
  --   Joiner  12    started mid-month. His joining bonus is NOT prorated, so
  --                 the payslip pays it whole, which is the point of it
  --   Ravi    31    with arrears, from a revision paid late
  --   Mark    31    with income tax entered by hand, as the workbook does

  if not exists (
    select 1 from public.pay_runs
     where organization_id = org and period_month = date '2026-07-01' and deleted_at is null
  ) then
    insert into public.pay_runs (organization_id, period_month, days_in_month, status)
    values (org, date '2026-07-01', 31, 'draft')
    returning id into v_run;
    raise notice 'opened a DRAFT pay run for July 2026';
  else
    select id into v_run from public.pay_runs
     where organization_id = org and period_month = date '2026-07-01' and deleted_at is null;
  end if;

  -- Only while it is still a draft. Once somebody has submitted or approved the
  -- run, re-running this file must not reach into it.
  if (select status from public.pay_runs where id = v_run) = 'draft' then
    insert into public.pay_run_days
      (organization_id, pay_run_id, employee_id, days_payable, arrears, tds)
    values
      (org, v_run, alice,  31,   0,    0),
      (org, v_run, hema,   31,   0,    0),
      (org, v_run, dan,    31,   0,    0),
      (org, v_run, mark,   31,   0, 2500),
      (org, v_run, ravi,   31, 1800,   0),
      (org, v_run, priya,  29.5,  0,   0),
      (org, v_run, joiner, 12,    0,   0),
      (org, v_run, nomgr,  31,    0,   0)
    on conflict (pay_run_id, employee_id) where deleted_at is null
      do update set days_payable = excluded.days_payable,
                    arrears = excluded.arrears,
                    tds = excluded.tds;
  else
    raise notice 'the July 2026 run is no longer a draft — leaving its days alone';
  end if;

  raise notice 'done: % components, % structures, % templates',
    (select count(*) from public.salary_components  where organization_id = org and deleted_at is null),
    (select count(*) from public.salary_structures  where organization_id = org and deleted_at is null),
    (select count(*) from public.salary_templates   where organization_id = org and deleted_at is null);
  raise notice 'NOT seeded: pay_run_lines. Press Compute on the July 2026 run — those figures belong to the engine, not to this file.';
end $$;
