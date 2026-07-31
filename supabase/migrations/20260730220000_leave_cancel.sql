-- ============================================================================
-- NEUVTO WOS — Cancelling leave
--
-- Step 6 shipped an RLS policy letting an employee update their own
-- pending_approval request, and nothing that gives the days back. A cancel
-- button built on that policy alone strands them: available never recovers and
-- the row looks perfectly fine. The same failure as an overdraw, approached
-- from the other side — days that exist on paper and nowhere else.
--
-- It also covered only pending requests, while test scenario 8 requires
-- cancelling APPROVED future leave. Plans change after approval; that is the
-- ordinary case, not the edge one.
--
-- D33 — cancellation releases days from whichever bucket actually holds them,
-- and exactly one thing moves them.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════ the release path
--
-- The trap this migration exists to avoid:
--
-- leave_cancel has to close the approval request, and setting
-- approval_requests.status = 'cancelled' FIRES THIS TRIGGER. If leave_cancel
-- also moved the balance, every cancellation would release twice — and a
-- double release is invisible: the balance simply grows, no constraint is
-- violated, and nobody notices until an employee takes leave they never had.
--
-- So leave_cancel sets statuses and this remains the only writer of balances.
--
-- What was wrong: the cancel branch decremented reserved_days unconditionally.
-- That is right for a request still awaiting approval, and wrong for one
-- already approved — those days moved to pending_days when it was approved.
-- Cancelling an approved request therefore subtracted from a bucket holding
-- nothing (clamped to zero by greatest()) and left the real days stranded in
-- pending_days forever.
--
-- The bucket is decided by the LEAVE request's status before the change, not by
-- the approval's status after it.
create or replace function public.leave_on_approval_decided()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req   public.leave_requests%rowtype;
  v_fy    text;
  v_today date;
begin
  if new.entity_type <> 'leave_request' then return new; end if;
  if new.status = old.status then return new; end if;
  if new.status not in ('approved', 'rejected', 'cancelled') then return new; end if;

  select * into v_req from public.leave_requests where id = new.entity_id;
  if v_req.id is null then return new; end if;

  -- Already in a final state: nothing to release, and releasing again would
  -- inflate the balance. Belt and braces against a second trigger firing.
  if v_req.status in ('rejected', 'cancelled') then return new; end if;

  v_fy    := public.get_financial_year(v_req.organization_id, v_req.from_date);
  v_today := public.org_today(v_req.organization_id);

  if new.status = 'approved' then
    update public.leave_requests
       set status = 'approved', decided_at = now()
     where id = v_req.id;

    update public.leave_balances
       set reserved_days = reserved_days - v_req.working_days,
           pending_days  = pending_days
                           + case when v_req.to_date >= v_today then v_req.working_days else 0 end,
           used_days     = used_days
                           + case when v_req.to_date <  v_today then v_req.working_days else 0 end
     where organization_id = v_req.organization_id
       and employee_id = v_req.employee_id
       and leave_type_id = v_req.leave_type_id
       and fy_label = v_fy;

  else
    update public.leave_requests
       set status = case when new.status = 'rejected' then 'rejected' else 'cancelled' end::public.leave_status,
           decided_at = now()
     where id = v_req.id;

    -- D33. Whichever bucket holds them.
    --
    --   pending_approval → the days are reserved, never spent
    --   approved         → they moved to pending_days on approval, or to
    --                      used_days if the leave had already been taken
    --
    -- Cancelling leave already taken is refused by leave_cancel, so used_days
    -- is not unwound here. If that ever changes, this is the place.
    if v_req.status = 'pending_approval' then
      update public.leave_balances
         set reserved_days = greatest(reserved_days - v_req.working_days, 0)
       where organization_id = v_req.organization_id
         and employee_id = v_req.employee_id
         and leave_type_id = v_req.leave_type_id
         and fy_label = v_fy;

    elsif v_req.status = 'approved' then
      update public.leave_balances
         set pending_days = greatest(pending_days - v_req.working_days, 0)
       where organization_id = v_req.organization_id
         and employee_id = v_req.employee_id
         and leave_type_id = v_req.leave_type_id
         and fy_label = v_fy;
    end if;
  end if;

  return new;
end $$;

comment on function public.leave_on_approval_decided is
  'D30/D33 — the only writer of leave balances. Releases from the bucket that actually holds the days.';

-- ═══════════════════════════════════════════════════════════ cancelling

create or replace function public.leave_cancel(_request_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_user  uuid := (select auth.uid());
  v_req   public.leave_requests%rowtype;
  v_today date;
begin
  if v_user is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;

  select * into v_req from public.leave_requests
   where id = _request_id and deleted_at is null;

  -- One message whether the request belongs to somebody else or does not
  -- exist. Distinguishing them would let anyone probe for request ids.
  if v_req.id is null or v_req.employee_id <> v_user then
    raise exception 'NOT_YOUR_REQUEST' using errcode = 'P0001';
  end if;

  if v_req.status not in ('pending_approval', 'approved') then
    raise exception 'ALREADY_DECIDED' using errcode = 'P0001';
  end if;

  -- D9 — the organisation's today, never the server's. A UTC server would tell
  -- an employee in India that tomorrow has already started, for five and a half
  -- hours every day.
  v_today := public.org_today(v_req.organization_id);
  if v_req.from_date <= v_today then
    raise exception 'CANCEL_TOO_LATE' using errcode = 'P0001';
  end if;

  -- Closing the approval fires leave_on_approval_decided, which cancels the
  -- leave request AND releases the days. This function deliberately does not
  -- touch balances: one writer.
  --
  -- `status in ('pending', 'approved')` matters. An earlier version said
  -- `status = 'pending'`, so cancelling an ALREADY-APPROVED request updated
  -- nothing, the trigger never fired, and a fallback here released the days
  -- instead — two writers, and a comment claiming there was one. The balances
  -- came out right, which is what made it invisible: sabotaging the trigger
  -- changed nothing, because the trigger was not doing the work.
  if v_req.approval_request_id is not null then
    update public.approval_requests
       set status = 'cancelled', completed_at = now()
     where id = v_req.approval_request_id
       and status in ('pending', 'approved');
    return;
  end if;

  -- The one case the trigger cannot serve: a leave request with no approval
  -- attached at all. leave_submit always attaches one, so this is defensive —
  -- but a request that cannot be cancelled at all would be worse than a second
  -- code path that is never taken.
  update public.leave_requests
     set status = 'cancelled', decided_at = now()
   where id = _request_id;

  if v_req.status = 'pending_approval' then
    update public.leave_balances
       set reserved_days = greatest(reserved_days - v_req.working_days, 0)
     where organization_id = v_req.organization_id
       and employee_id = v_req.employee_id
       and leave_type_id = v_req.leave_type_id
       and fy_label = public.get_financial_year(v_req.organization_id, v_req.from_date);
  else
    update public.leave_balances
       set pending_days = greatest(pending_days - v_req.working_days, 0)
     where organization_id = v_req.organization_id
       and employee_id = v_req.employee_id
       and leave_type_id = v_req.leave_type_id
       and fy_label = public.get_financial_year(v_req.organization_id, v_req.from_date);
  end if;
end $$;

comment on function public.leave_cancel is
  'Cancels own future leave, pending or approved (D33). Days return from whichever bucket holds them, released exactly once.';

grant execute on function public.leave_cancel(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════ policy
-- Widened to approved requests, because cancelling approved future leave is the
-- ordinary case. Writes still go through leave_cancel — this policy exists so a
-- future screen can update its own row, not as the cancellation path.

drop policy if exists "employee cancels own request" on public.leave_requests;

create policy "employee cancels own request" on public.leave_requests
  for update to authenticated
  using (
    organization_id = public.current_org_id()
    and employee_id = (select auth.uid())
    and status in ('pending_approval', 'approved')
    and deleted_at is null
  )
  with check (employee_id = (select auth.uid()));

-- The reason field: the spec says 500 characters and the form said 1000. A form
-- that accepts what the server refuses is a bug the customer meets, not us.
alter table public.leave_requests
  add constraint leave_reason_length check (reason is null or length(reason) <= 500);
