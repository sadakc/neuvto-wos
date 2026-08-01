-- ============================================================================
-- NEUVTO WOS — when somebody leaves, Leave tidies up after itself
--
-- deactivate_employee() moves reports and approvals and says nothing about
-- leave, because the platform must not name a module (D30). This is the other
-- half, and it lives here: a trigger the Leave module puts on a PLATFORM table,
-- exactly as leave_on_approval_decided already sits on approval_requests.
--
-- ── WHAT HAPPENS TO THEIR OWN REQUESTS
--
-- Decided with Sada:
--
--   pending_approval  → cancelled, and the reserved days released. Nobody is
--                       going to approve leave for somebody who has gone, and
--                       leaving it pending strands an approver forever.
--   approved (future) → left alone. Working a notice period is ordinary, and a
--                       deactivated account is not the same as a cancelled
--                       holiday. An administrator can still cancel it.
--   approved (past)   → left alone. It happened.
--
-- ── ONE WRITER, STILL
--
-- D33 was found by sabotage: the cancel path decremented the wrong bucket and
-- stranded days forever, because two places were releasing them. The fix was
-- one writer — closing the approval fires leave_on_approval_decided, which
-- cancels the request AND releases the days.
--
-- So this does not touch leave_balances. It closes the approval and lets the
-- existing path do what it already does correctly. A second releaser here would
-- be D33 all over again, and this time in a code path nobody watches.
-- ============================================================================

create or replace function public.leave_on_member_deactivated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The WHEN clause on the trigger already narrows this, but a SECURITY DEFINER
  -- function is worth being able to read on its own.
  if not (old.is_active and not new.is_active) then
    return new;
  end if;

  -- D44. A customer who does not have Leave switched on has no leave for this
  -- to cancel, and reaching into their data anyway would be the module ignoring
  -- its own boundary.
  if not public.module_enabled_for(new.organization_id, 'leave') then
    return new;
  end if;

  -- Requests carrying an approval: close the approval and stop. Everything else
  -- — the leave_requests row, the balance — is done by
  -- leave_on_approval_decided, which is the single writer for a release.
  --
  -- No date filter, unlike leave_cancel's CANCEL_TOO_LATE. That rule protects an
  -- employee from cancelling leave they have already started taking; this is
  -- somebody leaving the company, and a request nobody will ever decide should
  -- not sit pending against their balance whatever its dates.
  update public.approval_requests ar
     set status = 'cancelled', completed_at = now()
    from public.leave_requests lr
   where lr.approval_request_id = ar.id
     and lr.employee_id = new.id
     and lr.status = 'pending_approval'
     and lr.deleted_at is null
     and ar.status = 'pending'
     and ar.deleted_at is null;

  -- A pending request with no approval attached should not exist — a type
  -- needing no approval is approved on submission (D38) — but the shape is
  -- possible, and leaving it pending would strand days with nothing left to
  -- close it.
  update public.leave_balances b
     set reserved_days = greatest(b.reserved_days - lr.working_days, 0)
    from public.leave_requests lr
   where lr.employee_id = new.id
     and lr.status = 'pending_approval'
     and lr.approval_request_id is null
     and lr.deleted_at is null
     and b.organization_id = lr.organization_id
     and b.employee_id     = lr.employee_id
     and b.leave_type_id   = lr.leave_type_id
     and b.fy_label = public.get_financial_year(lr.organization_id, lr.from_date);

  update public.leave_requests
     set status = 'cancelled', decided_at = now()
   where employee_id = new.id
     and status = 'pending_approval'
     and approval_request_id is null
     and deleted_at is null;

  return new;
end $$;

comment on function public.leave_on_member_deactivated is
  'Leave''s own reaction to somebody being deactivated (D30). Cancels their pending requests through the existing single release path; leaves approved leave alone.';

drop trigger if exists leave_on_member_deactivated on public.profiles;

create trigger leave_on_member_deactivated
  after update of is_active on public.profiles
  for each row
  when (old.is_active and not new.is_active)
  execute function public.leave_on_member_deactivated();
