-- ============================================================================
-- NEUVTO WOS — the three reports an administrator actually opens
--
-- Step 14. Balances (what is left), taken (what happened), pending (what is
-- stuck). Each answers a question somebody asks out loud, which is the only
-- test a report passes or fails.
--
-- ── WHY THESE ARE FUNCTIONS AND NOT SELECTS FROM THE BROWSER
--
-- RLS already lets an administrator read every leave row in their organisation,
-- so all three COULD be PostgREST queries with joins. Two reasons they are not:
--
-- 1. A report joins profiles, leave_types, leave_requests, approval_requests
--    and approval_steps. Expressed as nested PostgREST selects that is five
--    embedded resources whose RLS each apply independently — and when one of
--    them silently returns nothing, the column goes null rather than the request
--    failing. leave_approval_detail exists for exactly this reason: an approver
--    could read the request and not the balance, and the screen showed a
--    decision with no numbers behind it.
--
-- 2. `is_admin()` is checked ONCE, here, loudly. A report that leaks is a report
--    that showed somebody a row they may not see, and the failure is silent by
--    construction — nobody notices extra rows.
--
-- Every one of these raises FORBIDDEN for a non-admin rather than returning an
-- empty set. An empty report and a forbidden report look identical on screen,
-- and only one of them is a bug.
-- ============================================================================

-- ─────────────────────────────────────────────────── 1 · balances, by department
--
-- leave_all_balances already existed for the opening-balance editor. The report
-- wants to filter by department, so it gains one column. The return type changes,
-- which CREATE OR REPLACE cannot do — hence the drop, and hence re-granting.
drop function if exists public.leave_all_balances();

create or replace function public.leave_all_balances()
returns table (
  employee_id       uuid,
  employee_name     text,
  department_name   text,
  leave_type_id     uuid,
  leave_type_name   text,
  fy_label          text,
  entitled_days     numeric,
  carryforward_days numeric,
  used_days         numeric,
  available_days    numeric)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_org uuid := public.current_org_id();
  v_fy  text;
begin
  if v_org is null or not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if not public.module_enabled_for(v_org, 'leave') then
    raise exception 'MODULE_NOT_ENABLED' using errcode = 'P0001';
  end if;

  v_fy := public.get_financial_year(v_org, public.org_today(v_org));

  -- Every active person against every active type, whether or not a balance row
  -- exists yet. Entitlement is computed for the ones that do not, so the screen
  -- shows what they WOULD get — otherwise the person most needing an opening
  -- balance is the one missing from the list.
  return query
    select p.id, coalesce(p.full_name, p.email)::text,
           d.name::text,
           t.id, t.name::text, v_fy,
           coalesce(b.entitled_days, public.calculate_entitlement(p.id, t.id, v_fy)),
           coalesce(b.carryforward_days, 0),
           coalesce(b.used_days, 0),
           coalesce(b.available_days,
                    public.calculate_entitlement(p.id, t.id, v_fy))
      from public.profiles p
      cross join public.leave_types t
      left join public.departments d on d.id = p.department_id
      left join public.leave_balances b
        on b.employee_id = p.id and b.leave_type_id = t.id and b.fy_label = v_fy
       and b.deleted_at is null
     where p.organization_id = v_org and p.deleted_at is null and p.is_active
       and t.organization_id = v_org and t.deleted_at is null and t.status = 'active'
     order by coalesce(p.full_name, p.email), t.name;
end $function$;

revoke all on function public.leave_all_balances() from public, anon;
grant execute on function public.leave_all_balances() to authenticated;

-- ──────────────────────────────────────────────────────────── 2 · leave taken
--
-- What happened, for payroll and for the auditor. Deliberately includes
-- cancelled and rejected requests: "we have no record of that" is the answer a
-- report exists to prevent, and a request that was rejected is precisely the
-- one somebody will later dispute.
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
           -- Who decided it: the last person to act, which for a two-level
           -- chain is the one that completed it. Null while pending, which is
           -- the honest answer rather than a blank that reads as "nobody".
           (select coalesce(ap.full_name, ap.email)::text
              from public.approval_steps s
              join public.profiles ap on ap.id = s.approver_id
             where s.approval_request_id = r.approval_request_id
               and s.decision <> 'pending'
               and s.deleted_at is null
             order by s.decided_at desc
             limit 1),
           coalesce(r.rejection_reason, r.reason)
      from public.leave_requests r
      join public.profiles p on p.id = r.employee_id
      join public.leave_types t on t.id = r.leave_type_id
      left join public.departments d on d.id = p.department_id
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

-- ─────────────────────────────────────────────────────── 3 · pending approvals
--
-- What is stuck, and on whose desk. approval_queue() answers this for the
-- CALLER — it is the approver's own inbox. This is the administrator's view of
-- everybody's, which is a different question: "why has nothing moved for nine
-- days" is not answerable from your own queue.
create or replace function public.leave_pending_report()
returns table (
  leave_request_id uuid,
  employee_name    text,
  department_name  text,
  leave_type_name  text,
  from_date        date,
  to_date          date,
  working_days     numeric,
  submitted_at     timestamptz,
  days_waiting     integer,
  current_level    smallint,
  required_levels  smallint,
  waiting_on       text)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_org uuid := public.current_org_id();
  v_tz  text;
begin
  if v_org is null or not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if not public.module_enabled_for(v_org, 'leave') then
    raise exception 'MODULE_NOT_ENABLED' using errcode = 'P0001';
  end if;

  select coalesce(s.timezone, 'UTC') into v_tz
    from public.organization_settings s where s.organization_id = v_org;

  return query
    select r.id,
           coalesce(p.full_name, p.email)::text,
           d.name::text,
           t.name::text,
           r.from_date, r.to_date, r.working_days,
           r.submitted_at,
           -- Age in the ORGANISATION's days, not the server's (D9).
           --
           -- `submitted_at::date` does NOT do that. The cast resolves in the
           -- SESSION timezone, which is UTC on Supabase, so only one side of
           -- this subtraction was ever org-local. For Asia/Kolkata that is
           -- wrong for five and a half hours of every day:
           --
           --   submitted_at  2026-08-02 19:00 UTC
           --   local clock   2026-08-03 00:30   → submitted today
           --   ::date        2026-08-02         → yesterday
           --   days_waiting  1                  → for a request a minute old
           --
           -- Invisible whenever the two dates happen to agree, which is most of
           -- the working day, and wrong every evening.
           (public.org_today(v_org)
              - (r.submitted_at at time zone v_tz)::date)::integer,
           ar.current_level, ar.required_levels,
           -- Everyone who could act right now. A level can have more than one
           -- approver and any of them unblocks it, so naming only the first
           -- would send the administrator to chase the wrong person.
           (select string_agg(coalesce(ap.full_name, ap.email), ', '
                              order by coalesce(ap.full_name, ap.email))
              from public.approval_steps s
              join public.profiles ap on ap.id = s.approver_id
             where s.approval_request_id = ar.id
               and s.level = ar.current_level
               and s.decision = 'pending'
               and s.deleted_at is null)
      from public.leave_requests r
      join public.approval_requests ar on ar.id = r.approval_request_id
      join public.profiles p on p.id = r.employee_id
      join public.leave_types t on t.id = r.leave_type_id
      left join public.departments d on d.id = p.department_id
     where r.organization_id = v_org
       and r.deleted_at is null
       and r.status = 'pending_approval'
       and ar.status = 'pending'
       and ar.deleted_at is null
     -- Oldest first. The report exists to surface what has been ignored, and
     -- sorting by date submitted puts that at the top where it belongs.
     order by r.submitted_at;
end $function$;

revoke all on function public.leave_pending_report() from public, anon;
grant execute on function public.leave_pending_report() to authenticated;

comment on function public.leave_taken_report(date, date) is
  'Admin-only. Every leave request overlapping the window, including rejected and cancelled ones.';
comment on function public.leave_pending_report() is
  'Admin-only. Everything awaiting a decision, oldest first, with who can act now. approval_queue() is the approver''s own inbox; this is everybody''s.';
