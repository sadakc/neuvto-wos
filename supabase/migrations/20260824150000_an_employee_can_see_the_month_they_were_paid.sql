-- ═══════════════════════════════════════════════════════════════════════════
-- An employee can see the month they were paid for
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `pay_run_lines` let an employee read their own line from the first payroll
-- migration. `pay_runs` never let them read the row that line belongs to — only
-- administrators and the approvers of that particular run.
--
-- So the payslip screen, which is the WHOLE of this module for somebody who is
-- not an administrator, has never worked for one. `MyPayslip` asks `listRuns()`
-- which months exist, gets nothing back, and says "You have no payslips yet" to
-- a person whose payslip is sitting one table over.
--
-- ── How it survived ────────────────────────────────────────────────────────
--
-- `MyPayslip.test.tsx` mocks `listRuns` and hands it an approved run. The
-- assertions were right; the fixture was one the policy could not produce. That
-- is the row-49 failure again, and the third time this module has found it:
-- a screen proved against data the database would never hand it.
--
-- Found by seeding a demo workspace, approving a real run, and signing in as an
-- employee. Nothing short of that would have caught it.
--
-- ── What this discloses, and what it does not ──────────────────────────────
--
-- The run row carries the period, the days in the month, and the status. It
-- carries no money — the totals on the pay runs screen are aggregated from
-- `pay_run_lines`, which still shows an employee their own line and nobody
-- else's. So this hands over "there was a July payroll and it is approved",
-- which is a fact about the reader's own payslip.
--
-- APPROVED AND PAID RUNS ONLY. A draft is still being worked on, and letting an
-- employee see one tells them payroll is in progress and invites them to ask
-- what their number is before it is final.
--
-- And the `payslipsVisible` switch keeps working through this: it is enforced
-- on `pay_run_lines`, so when payslips are off the EXISTS below finds nothing
-- and the run disappears with the line.

drop policy if exists "read pay runs in scope" on public.pay_runs;
create policy "read pay runs in scope" on public.pay_runs
  for select to authenticated
  using (
    organization_id = public.current_org_id()
    and deleted_at is null
    and (
      public.is_admin()
      or exists (
        select 1 from public.approval_requests ar
         where ar.id = pay_runs.approval_request_id
           and public.is_approver_on(ar.id)
      )
      or (
        status in ('approved', 'paid')
        and exists (
          select 1 from public.pay_run_lines l
           where l.pay_run_id = pay_runs.id
             and l.employee_id = (select auth.uid())
             and l.deleted_at is null
        )
      )
    )
  );
