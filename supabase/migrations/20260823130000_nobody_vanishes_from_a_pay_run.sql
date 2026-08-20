-- ============================================================================
-- NEUVTO WOS — nobody vanishes from a pay run
--
-- `payroll_run_inputs` joined each person to their salary structure with a
-- plain `join lateral`, which is an INNER join. An employee with no structure
-- yet produced no row, so they did not appear in the pay run at all — not as a
-- warning, not as a zero, not as anything.
--
-- THIS IS THE BUG THE MODULE EXISTS TO END, REBUILT. The workbook Payroll
-- replaces looks its employees up over a range that stops at row 49, so the
-- 45th hire silently disappears from PF, ESI, the bank file and their own
-- payslip with no error at all. An inner join on a structure that has not been
-- set up yet is the same failure with different syntax, and it fires on exactly
-- the people most likely to be missed: the ones just added.
--
-- HOW IT SURVIVED THE TESTS. `PayRuns.test.tsx` asserts that somebody with no
-- structure is named on screen, and it passes — because it mocks `getRunInputs`
-- and hands it an employee carrying `fixedComponents: []`. The real function
-- could never return that shape. The screen was proved to render a warning it
-- could not be given the data to raise. The test is kept and a second one added
-- against the real function, because the assertion was right and only its
-- fixture was fictional.
--
-- Verified against the local seed before the change: 8 active people at Acme,
-- 0 returned by the inner join, 8 by the left join.
--
-- With `s.id` null, the `fixedComponents` subquery matches no lines and returns
-- '[]' — which is precisely what the screen's warning already looks for, and
-- what `computeRun` treats as unpayable rather than free.
-- ============================================================================

create or replace function public.payroll_run_inputs(_run_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_run public.pay_runs%rowtype;
  v_out jsonb;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;

  select * into v_run from public.pay_runs
   where id = _run_id and organization_id = public.current_org_id() and deleted_at is null;
  if v_run.id is null then raise exception 'NOT_FOUND'; end if;

  select jsonb_build_object(
    'periodMonth', v_run.period_month,
    'daysInMonth', v_run.days_in_month,
    'status', v_run.status,
    'components', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', c.code, 'name', c.name,
               'countsForPfWages', c.counts_for_pf_wages, 'order', c.display_order)
             order by c.display_order, c.code)
        from public.salary_components c
       where c.organization_id = v_run.organization_id
         and c.deleted_at is null and c.status = 'active'
    ), '[]'::jsonb),
    'employees', coalesce((
      select jsonb_agg(jsonb_build_object(
               'employeeId', p.id,
               'employeeCode', p.employee_code,
               'employeeName', p.full_name,
               'departmentName', d.name,
               'daysPayable', dy.days_payable,
               'arrears', coalesce(dy.arrears, 0),
               'tds', coalesce(dy.tds, 0),
               'lwf', coalesce(dy.lwf, 0),
               'otherDeduction', coalesce(dy.other_deduction, 0),
               'fixedComponents', coalesce((
                 select jsonb_agg(jsonb_build_object('code', c.code, 'amount', l.amount)
                        order by c.display_order, c.code)
                   from public.salary_structure_lines l
                   join public.salary_components c on c.id = l.component_id
                  where l.structure_id = s.id and l.deleted_at is null
                    and c.deleted_at is null and c.status = 'active'
               ), '[]'::jsonb))
             order by p.employee_code nulls last, p.id)
        from public.profiles p
        left join public.departments d
               on d.id = p.department_id and d.deleted_at is null
        left join public.pay_run_days dy
               on dy.pay_run_id = _run_id and dy.employee_id = p.id and dy.deleted_at is null
        -- LEFT, and the whole point of this migration. Somebody with no salary
        -- structure arrives with no components and is named on screen as
        -- unpayable, rather than not arriving.
        left join lateral (
          select s2.id from public.salary_structures s2
           where s2.employee_id = p.id and s2.deleted_at is null
             and s2.effective_from <= (v_run.period_month + interval '1 month - 1 day')::date
           order by s2.effective_from desc
           limit 1
        ) s on true
       where p.organization_id = v_run.organization_id
         and p.deleted_at is null and p.is_active
    ), '[]'::jsonb)
  ) into v_out;

  return v_out;
end $function$;

-- `create or replace` preserves privileges, so these are belt and braces rather
-- than a fix. They are here because a SECURITY DEFINER function that `anon` can
-- execute has already been shipped once in this repository (20260808100000),
-- and restating them costs nothing.
revoke all on function public.payroll_run_inputs(uuid) from public, anon;
grant execute on function public.payroll_run_inputs(uuid) to authenticated;
