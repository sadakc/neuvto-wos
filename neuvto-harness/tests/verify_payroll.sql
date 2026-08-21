-- ============================================================================
-- NEUVTO WOS — payroll refuses what it should
--
-- Payroll is the first module whose arithmetic lives OUTSIDE the database, in
-- src/payroll-core. That is a deliberate choice and it moves a guarantee: the
-- database no longer computes net pay, so it cannot vouch for it by having
-- worked it out.
--
-- What it can still do is refuse — a line that contradicts itself, a run that
-- has been approved, a caller who is not an administrator, and an employee who
-- belongs to somebody else. Every one of those is asserted here by attempting
-- the thing and requiring the attempt to fail.
--
-- Silence is a pass. Any guard that does not hold raises.
-- ============================================================================

create or replace function pg_temp.as_user(_uid uuid) returns void as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', _uid::text, 'role', 'authenticated')::text, true);
end $$ language plpgsql;

create or replace function pg_temp.as_postgres() returns void as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$ language plpgsql;

do $$
declare
  org_a uuid; org_b uuid;
  admin_a uuid; emp_a uuid; mgr_a uuid; admin_b uuid; emp_b uuid;
  comp_basic uuid; comp_hra uuid; struct_a uuid;
  run_a uuid; n bigint; failed int := 0;

  procedure_note text;
begin
  select p.id, p.organization_id into admin_a, org_a
    from public.profiles p join public.user_roles r on r.user_id = p.id
   where r.role = 'org_admin' and p.deleted_at is null
   order by p.id limit 1;

  select p.id into emp_a
    from public.profiles p join public.user_roles r on r.user_id = p.id
   where p.organization_id = org_a and r.role = 'employee' and p.deleted_at is null
   order by p.id limit 1;

  select p.id into mgr_a
    from public.profiles p join public.user_roles r on r.user_id = p.id
   where p.organization_id = org_a and r.role = 'manager' and p.deleted_at is null
   order by p.id limit 1;

  select p.id, p.organization_id into admin_b, org_b
    from public.profiles p join public.user_roles r on r.user_id = p.id
   where r.role = 'org_admin' and p.organization_id <> org_a and p.deleted_at is null
   order by p.id limit 1;

  select p.id into emp_b
    from public.profiles p join public.user_roles r on r.user_id = p.id
   where p.organization_id = org_b and r.role = 'employee' and p.deleted_at is null
   order by p.id limit 1;

  -- ══════════════════════════════════ the module must be granted and enabled

  perform pg_temp.as_user(admin_a);
  begin
    perform public.payroll_open_run(date '2026-07-01');
    raise notice 'FAIL: a pay run opened for a customer without the module'; failed := failed + 1;
  exception when others then
    if sqlerrm like '%MODULE_DISABLED%'
      then raise notice 'ok: payroll refuses a customer who has not been granted it';
      else raise notice 'FAIL: wrong refusal for a disabled module: %', sqlerrm; failed := failed + 1; end if;
  end;
  perform pg_temp.as_postgres();

  insert into public.organization_modules (organization_id, module_key, enabled)
  values (org_a, 'payroll', true)
  on conflict (organization_id, module_key) do update set enabled = true, deleted_at = null;

  -- ══════════════════════════════════════════════════ who may open a pay run

  perform pg_temp.as_user(emp_a);
  begin
    perform public.payroll_open_run(date '2026-07-01');
    raise notice 'FAIL: an employee opened a pay run'; failed := failed + 1;
  exception when others then
    if sqlerrm like '%FORBIDDEN%'
      then raise notice 'ok: an employee cannot open a pay run';
      else raise notice 'FAIL: wrong refusal for a non-admin: %', sqlerrm; failed := failed + 1; end if;
  end;

  perform pg_temp.as_user(mgr_a);
  begin
    perform public.payroll_open_run(date '2026-07-01');
    raise notice 'FAIL: a manager opened a pay run'; failed := failed + 1;
  exception when others then
    if sqlerrm like '%FORBIDDEN%'
      then raise notice 'ok: a manager cannot open a pay run — approving one is not running one';
      else raise notice 'FAIL: wrong refusal for a manager: %', sqlerrm; failed := failed + 1; end if;
  end;

  perform pg_temp.as_user(admin_a);
  run_a := public.payroll_open_run(date '2026-07-01');
  perform pg_temp.as_postgres();
  if (select days_in_month from public.pay_runs where id = run_a) = 31
    then raise notice 'ok: July is opened with 31 days, computed rather than accepted';
    else raise notice 'FAIL: days_in_month wrong for July'; failed := failed + 1; end if;

  -- Opening the same month twice returns the same run rather than a second one.
  perform pg_temp.as_user(admin_a);
  if public.payroll_open_run(date '2026-07-31') = run_a
    then raise notice 'ok: reopening a month returns the run already open';
    else raise notice 'FAIL: a second run was opened for the same month'; failed := failed + 1; end if;
  perform pg_temp.as_postgres();

  -- ═══════════════════════════════════════════ a line that contradicts itself

  insert into public.salary_components (organization_id, code, name, category, epf, display_order)
  values (org_a, 'basic', 'Basic and DA', 'earning', 'always', 10) returning id into comp_basic;
  insert into public.salary_components (organization_id, code, name, category, epf, display_order)
  values (org_a, 'hra', 'House rent allowance', 'earning', 'off', 20) returning id into comp_hra;

  begin
    insert into public.pay_run_lines (
      organization_id, pay_run_id, employee_id, fixed_gross, days_payable,
      earned_gross, esi_eligible, pf_employee, total_deduction, net_payable)
    values (org_a, run_a, emp_a, 10000, 31, 10000, false, 1200, 1200, 9999);
    raise notice 'FAIL: a payslip whose net pay does not follow from its own numbers was stored'; failed := failed + 1;
  exception when check_violation then
    raise notice 'ok: a line where net <> earned - deductions is refused';
  end;

  begin
    insert into public.pay_run_lines (
      organization_id, pay_run_id, employee_id, fixed_gross, days_payable,
      earned_gross, esi_eligible, pf_employee, professional_tax, total_deduction, net_payable)
    values (org_a, run_a, emp_a, 10000, 31, 10000, false, 1200, 200, 1200, 8800);
    raise notice 'FAIL: total deductions need not equal the sum of the deductions'; failed := failed + 1;
  exception when check_violation then
    raise notice 'ok: a line whose deductions do not add up is refused';
  end;

  begin
    insert into public.pay_run_lines (
      organization_id, pay_run_id, employee_id, fixed_gross, days_payable,
      earned_gross, esi_eligible, esi_employee, total_deduction, net_payable)
    values (org_a, run_a, emp_a, 50000, 31, 50000, false, 375, 375, 49625);
    raise notice 'FAIL: somebody outside ESI was charged ESI'; failed := failed + 1;
  exception when check_violation then
    raise notice 'ok: an ESI-exempt person cannot be charged ESI';
  end;

  begin
    insert into public.pay_run_lines (
      organization_id, pay_run_id, employee_id, fixed_gross, days_payable,
      earned_gross, esi_eligible, pf_employee, eps, eps_difference, total_deduction, net_payable)
    values (org_a, run_a, emp_a, 10000, 31, 10000, false, 1200, 833, 999, 1200, 8800);
    raise notice 'FAIL: the EPF/EPS split need not reconcile'; failed := failed + 1;
  exception when check_violation then
    raise notice 'ok: the EPF/EPS split must reconcile';
  end;

  -- ═══════════════════════════════════════════════════ an empty run cannot go

  perform pg_temp.as_user(admin_a);
  begin
    perform public.payroll_submit_run(run_a);
    raise notice 'FAIL: an empty pay run was submitted for approval'; failed := failed + 1;
  exception when others then
    if sqlerrm like '%PAY_RUN_EMPTY%'
      then raise notice 'ok: an empty pay run cannot be submitted';
      else raise notice 'FAIL: wrong refusal for an empty run: %', sqlerrm; failed := failed + 1; end if;
  end;

  -- ═════════════════════════════════════════════════ whose employees they are

  begin
    perform public.payroll_replace_run_lines(run_a, jsonb_build_array(jsonb_build_object(
      'employeeId', emp_b, 'employeeCode', 'X', 'departmentName', null,
      'earnedComponents', '[]'::jsonb, 'fixedGross', 10000, 'daysPayable', 31,
      'arrears', 0, 'earnedGross', 10000, 'pfWages', 10000, 'pfEmployee', 1200,
      'eps', 833, 'epsDifference', 367, 'esiEligible', true, 'esiEmployee', 75,
      'esiEmployer', 325, 'professionalTax', 0, 'tds', 0, 'lwf', 0,
      'otherDeduction', 0, 'totalDeduction', 1275, 'netPayable', 8725, 'ncpDays', 0)));
    raise notice 'FAIL: another organisation''s employee was paid from this run'; failed := failed + 1;
  exception when others then
    if sqlerrm like '%CROSS_TENANT%' or sqlerrm like '%violates%'
      then raise notice 'ok: an employee from another organisation cannot be paid here';
      else raise notice 'FAIL: wrong refusal for a cross-tenant employee: %', sqlerrm; failed := failed + 1; end if;
  end;

  -- A real line, so the rest of the run has something to work with.
  perform public.payroll_replace_run_lines(run_a, jsonb_build_array(jsonb_build_object(
    'employeeId', emp_a, 'employeeCode', 'TISR0009', 'departmentName', 'Engineering',
    'earnedComponents', jsonb_build_array(jsonb_build_object('code','basic','amount',10000)),
    'fixedGross', 10000, 'daysPayable', 31,
    'arrears', 0, 'earnedGross', 10000, 'pfWages', 10000, 'pfEmployee', 1200,
    'eps', 833, 'epsDifference', 367, 'esiEligible', true, 'esiEmployee', 75,
    'esiEmployer', 325, 'professionalTax', 0, 'tds', 0, 'lwf', 0,
    'otherDeduction', 0, 'totalDeduction', 1275, 'netPayable', 8725, 'ncpDays', 0)));

  select count(*) into n from public.pay_run_lines where pay_run_id = run_a and deleted_at is null;
  if n = 1 then raise notice 'ok: a valid line is stored';
  else raise notice 'FAIL: expected one line, found %', n; failed := failed + 1; end if;

  -- Replace means replace. A recompute must not leave the previous attempt behind.
  perform public.payroll_replace_run_lines(run_a, jsonb_build_array(jsonb_build_object(
    'employeeId', emp_a, 'employeeCode', 'TISR0009', 'departmentName', 'Engineering',
    'earnedComponents', '[]'::jsonb, 'fixedGross', 10000, 'daysPayable', 20,
    'arrears', 0, 'earnedGross', 6452, 'pfWages', 6452, 'pfEmployee', 774,
    'eps', 537, 'epsDifference', 237, 'esiEligible', true, 'esiEmployee', 49,
    'esiEmployer', 210, 'professionalTax', 0, 'tds', 0, 'lwf', 0,
    'otherDeduction', 0, 'totalDeduction', 823, 'netPayable', 5629, 'ncpDays', 11)));
  select count(*) into n from public.pay_run_lines where pay_run_id = run_a and deleted_at is null;
  if n = 1 then raise notice 'ok: recomputing replaces the run rather than adding to it';
  else raise notice 'FAIL: recompute left % lines', n; failed := failed + 1; end if;
  perform pg_temp.as_postgres();

  -- ══════════════════════════════════════════════ who can read whose payslip

  perform pg_temp.as_user(emp_a);
  select count(*) into n from public.pay_run_lines;
  if n = 1 then raise notice 'ok: a person can read their own payslip line';
  else raise notice 'FAIL: a person cannot read their own payslip (% rows)', n; failed := failed + 1; end if;

  perform pg_temp.as_user(mgr_a);
  select count(*) into n from public.pay_run_lines;
  if n = 0 then raise notice 'ok: a manager cannot read what their reports are paid';
  else raise notice 'FAIL: a manager read % payslip line(s)', n; failed := failed + 1; end if;

  perform pg_temp.as_user(admin_b);
  select count(*) into n from public.pay_run_lines;
  if n = 0 then raise notice 'ok: another organisation''s admin reads nothing here';
  else raise notice 'FAIL: a foreign admin read % payslip line(s)', n; failed := failed + 1; end if;

  perform pg_temp.as_user(emp_b);
  select count(*) into n from public.pay_runs;
  if n = 0 then raise notice 'ok: another organisation''s employee sees no pay runs';
  else raise notice 'FAIL: a foreign employee saw % pay run(s)', n; failed := failed + 1; end if;
  perform pg_temp.as_postgres();

  -- ═══════════════════════ an administrator can switch payslips off, for real
  --
  -- 20260824100000. "The administrator decides what the employee can see" is
  -- only true if switching it off stops the DATA. `getRunLines` selects
  -- straight from this table, so a switch honoured only in React leaves every
  -- figure one fetch away in the browser console — which is the difference
  -- between a permission and a layout preference.
  --
  -- The assertion further up — a person reads their own payslip line — ran with
  -- no settings row in existence at all, and that is the other half of this
  -- guard: absent means VISIBLE, so shipping the migration does not silently
  -- switch every existing workspace's payslips off.

  insert into public.module_settings (organization_id, module_key, setting_key, value)
  values (org_a, 'payroll', 'settings',
          jsonb_build_object('employeePortal', jsonb_build_object('payslipsVisible', false)))
  on conflict (organization_id, module_key, setting_key)
    do update set value = excluded.value, deleted_at = null;

  perform pg_temp.as_user(emp_a);
  select count(*) into n from public.pay_run_lines;
  if n = 0 then raise notice 'ok: payslips switched off stops the data, not only the screen';
  else raise notice 'FAIL: an employee read % payslip line(s) with payslips switched off', n; failed := failed + 1; end if;

  perform pg_temp.as_user(admin_a);
  select count(*) into n from public.pay_run_lines;
  if n = 1 then raise notice 'ok: and an administrator can still run payroll';
  else raise notice 'FAIL: switching payslips off blinded the administrator too (% rows)', n; failed := failed + 1; end if;
  perform pg_temp.as_postgres();

  update public.module_settings
     set value = jsonb_build_object('employeePortal', jsonb_build_object('payslipsVisible', true))
   where organization_id = org_a and module_key = 'payroll' and setting_key = 'settings';

  perform pg_temp.as_user(emp_a);
  select count(*) into n from public.pay_run_lines;
  if n = 1 then raise notice 'ok: and switching them back on returns them';
  else raise notice 'FAIL: payslips did not come back after being switched on (% rows)', n; failed := failed + 1; end if;
  perform pg_temp.as_postgres();

  -- ═══════════════════════════════════════════════════ an approved run is fixed

  update public.pay_runs set status = 'approved', locked_at = now() where id = run_a;

  begin
    update public.pay_run_lines set net_payable = 999999, total_deduction = earned_gross - 999999
     where pay_run_id = run_a;
    raise notice 'FAIL: an approved payslip was rewritten'; failed := failed + 1;
  exception when others then
    if sqlerrm like '%PAY_RUN_LOCKED%' then raise notice 'ok: an approved payslip cannot be rewritten, even as postgres';
    else raise notice 'FAIL: wrong refusal on a locked line: %', sqlerrm; failed := failed + 1; end if;
  end;

  begin
    delete from public.pay_run_lines where pay_run_id = run_a;
    raise notice 'FAIL: an approved payslip was deleted'; failed := failed + 1;
  exception when others then
    if sqlerrm like '%PAY_RUN_LOCKED%' then raise notice 'ok: an approved payslip cannot be deleted';
    else raise notice 'FAIL: wrong refusal deleting a locked line: %', sqlerrm; failed := failed + 1; end if;
  end;

  begin
    update public.pay_runs set locked_at = null, status = 'draft' where id = run_a;
    raise notice 'FAIL: an approved run was unlocked'; failed := failed + 1;
  exception when others then
    if sqlerrm like '%PAY_RUN_LOCKED%' then raise notice 'ok: an approved run cannot be unlocked — editing by another name';
    else raise notice 'FAIL: wrong refusal unlocking a run: %', sqlerrm; failed := failed + 1; end if;
  end;

  perform pg_temp.as_user(admin_a);
  begin
    perform public.payroll_replace_run_lines(run_a, '[]'::jsonb);
    raise notice 'FAIL: an approved run was recomputed'; failed := failed + 1;
  exception when others then
    if sqlerrm like '%PAY_RUN_NOT_DRAFT%' or sqlerrm like '%PAY_RUN_LOCKED%'
      then raise notice 'ok: an approved run cannot be recomputed';
      else raise notice 'FAIL: wrong refusal recomputing: %', sqlerrm; failed := failed + 1; end if;
  end;
  perform pg_temp.as_postgres();

  -- ══════════════════════════════════════════ identifiers that would be rejected

  begin
    insert into public.payroll_employee_details (organization_id, employee_id, uan)
    values (org_a, emp_a, '12345678901');
    raise notice 'FAIL: an 11-digit UAN was accepted'; failed := failed + 1;
  exception when check_violation then
    raise notice 'ok: a UAN that the PF portal would reject is refused here first';
  end;

  begin
    insert into public.payroll_employee_details (organization_id, employee_id, pan)
    values (org_a, emp_a, 'ABCD1234E');
    raise notice 'FAIL: a malformed PAN was accepted'; failed := failed + 1;
  exception when check_violation then raise notice 'ok: a malformed PAN is refused'; end;

  begin
    insert into public.payroll_employee_details (organization_id, employee_id, bank_ifsc)
    values (org_a, emp_a, 'CNRB123456');
    raise notice 'FAIL: a malformed IFSC was accepted'; failed := failed + 1;
  exception when check_violation then raise notice 'ok: a malformed IFSC is refused'; end;

  insert into public.payroll_employee_details
    (organization_id, employee_id, uan, pan, bank_ifsc, bank_account_number)
  values (org_a, emp_a, '123456789012', 'ABCDE1234F', 'CNRB0001234', '3195118000010');
  raise notice 'ok: correctly-shaped identifiers are accepted';

  -- ═══════════════════════════ a bank account is not readable by a colleague

  perform pg_temp.as_user(mgr_a);
  select count(*) into n from public.payroll_employee_details;
  if n = 0 then raise notice 'ok: a manager cannot read their report''s bank account';
  else raise notice 'FAIL: a manager read % bank record(s)', n; failed := failed + 1; end if;

  perform pg_temp.as_user(emp_a);
  select count(*) into n from public.payroll_employee_details;
  if n = 1 then raise notice 'ok: a person can read their own bank details';
  else raise notice 'FAIL: a person cannot read their own bank details (% rows)', n; failed := failed + 1; end if;
  perform pg_temp.as_postgres();

  -- ══════════════════════════════════════════════════ a salary is not gossip

  insert into public.salary_structures (organization_id, employee_id, effective_from)
  values (org_a, emp_a, date '2026-01-01') returning id into struct_a;
  insert into public.salary_structure_lines (organization_id, structure_id, component_id, amount)
  values (org_a, struct_a, comp_basic, 10000);

  perform pg_temp.as_user(mgr_a);
  select count(*) into n from public.salary_structures;
  if n = 0 then raise notice 'ok: a manager cannot read what their report is paid';
  else raise notice 'FAIL: a manager read % salary structure(s)', n; failed := failed + 1; end if;

  select count(*) into n from public.salary_structure_lines;
  if n = 0 then raise notice 'ok: nor the component amounts behind it';
  else raise notice 'FAIL: a manager read % structure line(s)', n; failed := failed + 1; end if;
  perform pg_temp.as_postgres();

  -- ═════════════ a component stops meaning something else once somebody is on it
  --
  -- 20260824110000. The source spec repeats this on every category: after a
  -- component reaches a real employee, only its name and its default stay
  -- editable. The reason is reproducibility — flipping `basic` out of PF wages
  -- in November silently restates every payslip computed against it since
  -- April, and every one of those has already been shown to somebody.
  --
  -- comp_basic is on emp_a's structure by this point, and comp_hra is on
  -- nobody's. The pair is the point: the rule has to bite for one and not the
  -- other, or it is just a table that cannot be edited.

  begin
    update public.salary_components set epf = 'off' where id = comp_basic;
    raise notice 'FAIL: a component somebody is paid through changed what it means';
    failed := failed + 1;
  exception when others then
    if sqlerrm like '%COMPONENT_IN_USE%'
      then raise notice 'ok: a component in use cannot change what it means';
      else raise notice 'FAIL: wrong refusal changing a component in use: %', sqlerrm;
           failed := failed + 1; end if;
  end;

  -- Renaming is not restating. An organisation that decides "Basic and DA"
  -- should read "Basic Salary" on the payslip must be able to say so.
  begin
    update public.salary_components
       set name = 'Basic Salary', name_in_payslip = 'Basic Salary'
     where id = comp_basic;
    raise notice 'ok: and can still be renamed';
  exception when others then
    raise notice 'FAIL: a component in use could not be renamed: %', sqlerrm;
    failed := failed + 1;
  end;

  begin
    update public.salary_components set epf = 'under_threshold' where id = comp_hra;
    raise notice 'ok: a component nobody is on is still fully editable';
  exception when others then
    raise notice 'FAIL: an unused component was frozen: %', sqlerrm;
    failed := failed + 1;
  end;

  -- ══════════════════════════ the categories the arithmetic is allowed to have
  --
  -- Mirrors the CHECK constraints. A percentage on a canteen recovery is not
  -- something anybody means, and an unknown category would reach the engine as
  -- a component it silently ignores — pay quietly missing from a payslip with
  -- every total still reconciling.

  begin
    insert into public.salary_components (organization_id, code, name, category, epf, display_order)
    values (org_a, 'nonsense', 'Nonsense', 'bonus_thing', 'off', 90);
    raise notice 'FAIL: a component was created with an unknown category';
    failed := failed + 1;
  exception when check_violation then
    raise notice 'ok: an unknown component category is refused';
  end;

  begin
    insert into public.salary_components
      (organization_id, code, name, category, epf, calculation_type, default_percentage, display_order)
    values (org_a, 'silly', 'Silly', 'deduction', 'off', 'percent_of_basic', 40, 91);
    raise notice 'FAIL: a deduction was defined as a percentage of basic';
    failed := failed + 1;
  exception when check_violation then
    raise notice 'ok: only an earning can be a percentage';
  end;

  begin
    insert into public.salary_components (organization_id, code, name, category, epf, display_order)
    values (org_a, 'wrongpf', 'Wrong PF', 'earning', 'sometimes', 92);
    raise notice 'FAIL: a component was created with an unknown PF treatment';
    failed := failed + 1;
  exception when check_violation then
    raise notice 'ok: an unknown provident fund treatment is refused';
  end;

  -- ═════════════════════ nobody vanishes for want of a salary structure
  --
  -- emp_a has a structure; mgr_a has none. Before 20260823130000 the lateral
  -- join onto salary_structures was INNER, so mgr_a produced no row and was
  -- simply not in the pay run — no warning, no zero, no line. That is the
  -- workbook's row-49 failure rebuilt in SQL, and it defeated the screen test
  -- that was supposed to catch it: PayRuns.test.tsx mocks this function and
  -- hands it an employee with `fixedComponents: []`, a shape the function
  -- could not produce. The screen was proved to render a warning it could
  -- never be given the data to raise.
  perform pg_temp.as_user(admin_a);

  select count(*) into n
    from jsonb_array_elements(public.payroll_run_inputs(run_a) -> 'employees') e
   where (e ->> 'employeeId')::uuid = mgr_a;
  if n = 1 then raise notice 'ok: somebody with no salary structure still appears in the run';
  else raise notice 'FAIL: an employee with no salary structure vanished from the run'; failed := failed + 1; end if;

  select count(*) into n
    from jsonb_array_elements(public.payroll_run_inputs(run_a) -> 'employees') e
   where (e ->> 'employeeId')::uuid = mgr_a
     and e -> 'fixedComponents' = '[]'::jsonb;
  if n = 1 then raise notice 'ok: and carries no components, which is what the screen names them for';
  else raise notice 'FAIL: they arrived carrying components they do not have'; failed := failed + 1; end if;

  -- The person who DOES have a structure still carries it, so the left join
  -- did not simply blank everybody out.
  select count(*) into n
    from jsonb_array_elements(public.payroll_run_inputs(run_a) -> 'employees') e
   where (e ->> 'employeeId')::uuid = emp_a
     and jsonb_array_length(e -> 'fixedComponents') > 0;
  if n = 1 then raise notice 'ok: and somebody who has a structure still carries it';
  else raise notice 'FAIL: a structure that exists was not returned'; failed := failed + 1; end if;

  perform pg_temp.as_postgres();

  -- ═══════════════════════════════════════════════ the module boundary again

  perform pg_temp.as_postgres();
  update public.organization_modules set enabled = false
   where organization_id = org_a and module_key = 'payroll';

  perform pg_temp.as_user(admin_a);
  begin
    perform public.payroll_open_run(date '2026-09-01');
    raise notice 'FAIL: a pay run opened after the module was switched off'; failed := failed + 1;
  exception when others then
    if sqlerrm like '%MODULE_DISABLED%'
      then raise notice 'ok: switching payroll off stops pay runs, not just the menu item';
      else raise notice 'FAIL: wrong refusal after disabling: %', sqlerrm; failed := failed + 1; end if;
  end;
  perform pg_temp.as_postgres();

  -- ─────────────────────────────────────────────────────────────── cleanup
  --
  -- The triggers have to be switched off to clean up, and that is the last
  -- proof rather than a workaround: there is no in-band way to remove an
  -- approved pay run, not for an administrator, not for this suite, not for
  -- postgres. Undoing it requires owner rights on the table and a deliberate
  -- act that would appear in the audit log.
  --
  -- The suite re-runs verify_invariants afterwards, which asserts the harness
  -- left nothing behind.
  alter table public.pay_run_lines disable trigger pay_run_must_be_open;
  alter table public.pay_runs      disable trigger pay_run_stays_locked;

  delete from public.pay_run_lines where pay_run_id = run_a;
  delete from public.pay_runs where id = run_a;
  delete from public.salary_structure_lines where structure_id = struct_a;
  delete from public.salary_structures where id = struct_a;
  delete from public.payroll_employee_details where employee_id = emp_a;
  delete from public.salary_components where id in (comp_basic, comp_hra);
  delete from public.organization_modules where organization_id = org_a and module_key = 'payroll';

  alter table public.pay_run_lines enable trigger pay_run_must_be_open;
  alter table public.pay_runs      enable trigger pay_run_stays_locked;

  if failed > 0 then
    raise exception 'PAYROLL FAIL: % guard(s) did not hold', failed;
  end if;
  raise notice '--- payroll refuses everything it should ---';
end $$;
