-- ============================================================================
-- NEUVTO WOS — enough to decide, and not one field more
--
-- approval_queue() is the platform's half: what is waiting on you, from any
-- module, with the requester's name. It names no module and reads no leave
-- table, and must not.
--
-- This is Leave's half. A manager deciding on three days of Casual leave needs
-- the dates, the days, the reason, and the balance that request is drawn
-- against. That last one is the reason this function exists rather than a join
-- in the browser: an approver reached by manager_of_manager can read the
-- leave_requests row (is_approver_on is in that policy) and CANNOT read the
-- employee's leave_balances rows, because that policy has only own /
-- is_manager_of / is_admin and is_manager_of is direct-reports-only.
--
-- ── THE BALANCE FOR THE REQUESTED TYPE, AND NO OTHER
--
-- Decided with Sada. Deciding on Casual discloses the Casual balance. It does
-- not disclose Sick.
--
-- Not squeamishness — days of sick leave taken is a health signal, and D35's
-- rule is that the disclosure should be the answer to the question actually
-- being asked. The question here is "can this person afford these three days",
-- which the Casual row answers on its own. An approver who is also the
-- employee's manager, or an admin, can already see the rest through the ordinary
-- policies; this function does not decide what THEY may see, only what it hands
-- to somebody whose entire relationship to the employee is one pending decision.
--
-- ── ORDER OF THE GUARDS
--
-- Tenancy, then entitlement, then the module — and all three raise before
-- anything reveals whether the id exists. A caller who is not entitled gets the
-- identical FORBIDDEN for a real request, a request in another tenant, and a
-- uuid that was never issued. Guessing ids must teach nobody anything.
-- ============================================================================

create or replace function public.leave_approval_detail(_approval_request_id uuid)
returns table (
  leave_request_id  uuid,
  employee_name     text,
  leave_type_id     uuid,
  leave_type_name   text,
  from_date         date,
  to_date           date,
  working_days      numeric,
  reason            text,
  status            public.leave_status,
  fy_label          text,
  entitled_days     numeric,
  carryforward_days numeric,
  used_days         numeric,
  reserved_days     numeric,
  pending_days      numeric,
  available_days    numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_fy  text;
begin
  -- ── tenancy, on its own.
  --
  -- is_admin() answers "holds an admin role", not "in this organisation". The
  -- entitlement test below is a disjunction, so folding tenancy into it as
  -- another alternative would let an admin of ANY tenant past the gate and
  -- leave the row filter as the only thing between them and the data.
  -- approval_timeline had exactly that bug.
  select organization_id into v_org
    from public.approval_requests
   where id = _approval_request_id and deleted_at is null;

  if v_org is null or v_org <> public.current_org_id() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- ── the same people the request itself is visible to.
  -- Restated because SECURITY DEFINER bypasses RLS and inherits nothing.
  if not (
    public.is_requester_of(_approval_request_id)
    or public.is_approver_on(_approval_request_id)
    or public.is_admin()
  ) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- ── D44, after the two above. A caller with no business here learns only
  -- FORBIDDEN; whether this customer has Leave switched on is not their answer
  -- to have.
  if not public.module_enabled_for(v_org, 'leave') then
    raise exception 'MODULE_NOT_ENABLED' using errcode = 'P0001';
  end if;

  return query
    select r.id,
           coalesce(p.full_name, 'A colleague')::text,
           r.leave_type_id,
           t.name::text,
           r.from_date,
           r.to_date,
           r.working_days,
           r.reason,
           r.status,
           b.fy_label,
           b.entitled_days,
           b.carryforward_days,
           b.used_days,
           b.reserved_days,
           b.pending_days,
           b.available_days
      from public.leave_requests r
      join public.leave_types    t on t.id = r.leave_type_id
      left join public.profiles  p on p.id = r.employee_id and p.deleted_at is null
      -- The financial year of the FROM DATE, which is the row the reservation
      -- was taken from — leave_submit and leave_on_approval_decided both resolve
      -- it that way. Resolving it from today instead would show the wrong year's
      -- numbers for a request booked into next year under D34.
      --
      -- LEFT joined, and joined on the request's own leave_type_id: this is
      -- where "one type, not all" is actually enforced, not in the caller.
      left join public.leave_balances b
             on b.employee_id   = r.employee_id
            and b.leave_type_id = r.leave_type_id
            and b.fy_label      = public.get_financial_year(r.organization_id, r.from_date)
            and b.deleted_at is null
     where r.approval_request_id = _approval_request_id
       and r.deleted_at is null
       and r.organization_id = v_org;
end $$;

comment on function public.leave_approval_detail is
  'What an approver needs to decide one leave request, including the balance for THAT LEAVE TYPE ONLY (D35). Refuses identically for unknown, cross-tenant and unentitled ids.';

revoke all on function public.leave_approval_detail(uuid) from public, anon;
grant execute on function public.leave_approval_detail(uuid) to authenticated;
