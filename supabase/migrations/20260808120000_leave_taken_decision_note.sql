-- ============================================================================
-- NEUVTO WOS — the taken report says why it was REFUSED, not why it was asked
--
-- Step 14, found by reading the report's own output rather than its code.
--
-- `leave_taken_report` returned `coalesce(r.rejection_reason, r.reason)` under
-- the heading "reason". That reads as "the reason, whichever kind applies" and
-- is what it would do — except that `leave_requests.rejection_reason` is
-- declared in the step 7 schema and written by NOTHING. Not by leave_cancel,
-- not by approval_decide, not by any handler. The coalesce has never once
-- reached its first argument.
--
-- So every rejected row showed the employee's own words. A report whose stated
-- purpose is payroll and audit, listing a refused request, answered "why?" with
-- the sentence the person wrote when they asked for it:
--
--     Renamed For Audit | 2026-08-26 | rejected | "To be rejected"
--
-- The approver DID give a reason — 'Cover not available' — and it was recorded.
-- It lives in `approval_steps.comments`, because refusing is an act of the
-- Approval Engine and not of this module. The report already reaches into that
-- table for `decided_by`; it simply did not bring the comment back with it.
--
-- The two are now separate columns, which is what the auditor wanted in the
-- first place: what was asked for, and what the decision said. A single "reason"
-- column cannot hold both, and choosing between them silently is how it came to
-- hold the wrong one.
--
-- `rejection_reason` is left in place and still unwritten. Dropping a column is
-- a bigger decision than this migration, and it is now referenced by nothing —
-- which is the honest state for a field nothing populates.
--
-- The return type changes, so this drops rather than replaces, and re-grants.
-- ============================================================================

drop function if exists public.leave_taken_report(date, date);

create or replace function public.leave_taken_report(_from date, _to date)
returns table (
  leave_request_id uuid,
  employee_name    text,
  department_name  text,
  leave_type_name  text,
  from_date        date,
  to_date          date,
  working_days     numeric,
  status           text,
  submitted_at     timestamptz,
  decided_at       timestamptz,
  decided_by       text,
  -- What the decision said. Null while pending, and null when whoever decided
  -- it left the box empty — both of which are honest answers.
  decision_note    text,
  -- What the employee wrote when they asked. Theirs, not the approver's.
  reason           text)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_org uuid := public.current_org_id();
begin
  if v_org is null or not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if not public.module_enabled_for(v_org, 'leave') then
    raise exception 'MODULE_NOT_ENABLED' using errcode = 'P0001';
  end if;
  if _from is null or _to is null or _to < _from then
    return;
  end if;

  return query
    select r.id,
           coalesce(p.full_name, p.email)::text,
           d.name::text,
           t.name::text,
           r.from_date, r.to_date, r.working_days,
           r.status::text,
           r.submitted_at, r.decided_at,
           -- The last person to act and what they said, taken together from the
           -- SAME step. Two subqueries each ordering independently could name
           -- one approver and quote another's comment — rare, and impossible to
           -- spot in a spreadsheet.
           s.approver_name,
           s.comments,
           r.reason
      from public.leave_requests r
      join public.profiles p on p.id = r.employee_id
      join public.leave_types t on t.id = r.leave_type_id
      left join public.departments d on d.id = p.department_id
      left join lateral (
        select coalesce(ap.full_name, ap.email)::text as approver_name,
               st.comments::text                      as comments
          from public.approval_steps st
          join public.profiles ap on ap.id = st.approver_id
         where st.approval_request_id = r.approval_request_id
           and st.decision <> 'pending'
           and st.deleted_at is null
         order by st.decided_at desc
         limit 1
      ) s on true
     where r.organization_id = v_org
       and r.deleted_at is null
       -- OVERLAPS the window, not "starts within it". Leave running from the
       -- 28th to the 3rd belongs in both months' reports; a request that
       -- straddles a quarter boundary is exactly the one payroll asks about.
       and r.from_date <= _to
       and r.to_date   >= _from
     order by r.from_date desc, coalesce(p.full_name, p.email);
end $function$;

revoke all on function public.leave_taken_report(date, date) from public, anon;
grant execute on function public.leave_taken_report(date, date) to authenticated;

comment on function public.leave_taken_report(date, date) is
  'Admin-only. Every leave request overlapping the window, including rejected and cancelled ones. "reason" is the employee''s; "decision_note" is the approver''s.';
