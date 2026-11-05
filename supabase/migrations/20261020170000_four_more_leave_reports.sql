-- ============================================================================
-- NEUVTO WOS — four more Leave reports (D94)
-- ============================================================================
--
-- Leave phase 2: "liability, comp-off register, approval turnaround and
-- absenteeism, with PDF and Excel export besides CSV". The exports are the
-- report frame's (src/platform/reports/export.ts); these are the numbers.
--
--   LIABILITY. What the company still owes in leave this year, person by
--   person and type by type: days not yet taken (credited plus carried over,
--   less taken), of which already booked, and what is free to book. In DAYS:
--   a value in money needs pay, which waits for Payroll (D81). Unpaid leave
--   owes nothing; earned leave (comp off, D89) is owed like any balance.
--
--   COMP-OFF REGISTER. Every compensatory off claim made in the dates chosen:
--   the days worked, the reason, what happened, when it expires and what
--   expired unused.
--
--   APPROVAL TURNAROUND. Every Leave decision made in the dates chosen: who
--   had it, who decided (D92), how long it waited at its level, and whether it
--   had to move up (D87).
--
--   ABSENTEEISM. Approved leave falling in the dates chosen, per person: how
--   many separate absences, how many working days (counted inside the window
--   only), of which unpaid, and the Bradford factor (absences squared times
--   days), which weighs many short absences above one long one.
--
-- The Leave Admin's (D84), like the three reports before them. A window is at
-- most a year.
-- ============================================================================

create or replace function public.leave_report_window(_from date, _to date)
returns void
language plpgsql
immutable
set search_path = public
as $$
begin
  if _from is null or _to is null or _to < _from then
    raise exception 'INVALID_DATE_RANGE' using errcode = 'P0001';
  end if;
  if _to - _from > 366 then
    raise exception 'RANGE_TOO_LONG' using errcode = 'P0001';
  end if;
end $$;

revoke all on function public.leave_report_window(date, date) from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════ liability

create or replace function public.leave_liability_report()
returns table (
  employee_id     uuid,
  employee_name   text,
  department_name text,
  leave_type_name text,
  kind            text,
  fy_label        text,
  not_taken_days  numeric,
  booked_days     numeric,
  free_days       numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  v_fy  text;
begin
  if v_org is null or not public.is_module_admin('leave') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if not public.module_enabled_for(v_org, 'leave') then
    raise exception 'MODULE_NOT_ENABLED' using errcode = 'P0001';
  end if;
  v_fy := public.get_financial_year(v_org, public.org_today(v_org));

  -- Everybody active against every type with a balance, materialised or not:
  -- somebody nobody has looked at yet is owed their entitlement all the same.
  return query
    with base as (
      select p.id as pid, coalesce(p.full_name, p.email)::text as pname, d.name::text as dname,
             t.name::text as tname, t.kind,
             coalesce(b.entitled_days,
                      case when t.kind = 'paid' then public.calculate_entitlement(p.id, t.id, v_fy) else 0 end) as entitled,
             coalesce(b.carryforward_days, 0) as carried,
             coalesce(b.used_days, 0) as used,
             coalesce(b.reserved_days, 0) + coalesce(b.pending_days, 0) as booked
        from public.profiles p
        cross join public.leave_types t
        left join public.departments d on d.id = p.department_id
        left join public.leave_balances b
          on b.employee_id = p.id and b.leave_type_id = t.id and b.fy_label = v_fy and b.deleted_at is null
       where p.organization_id = v_org and p.deleted_at is null and p.is_active
         and t.organization_id = v_org and t.deleted_at is null and t.status = 'active'
         and t.kind <> 'unpaid'
    )
    select pid, pname, dname, tname, base.kind, v_fy,
           entitled + carried - used,
           booked,
           entitled + carried - used - booked
      from base
     where entitled + carried - used > 0
     order by pname, tname;
end $$;

comment on function public.leave_liability_report is
  'D94 — leave still owed this year, in days, per person and type: not yet taken, of which booked, and free to book.';

revoke all on function public.leave_liability_report() from public, anon;
grant execute on function public.leave_liability_report() to authenticated;

-- ═══════════════════════════════════════════════════════════ comp-off register

create or replace function public.comp_off_register(_from date, _to date)
returns table (
  claim_id        uuid,
  employee_name   text,
  department_name text,
  leave_type_name text,
  days_worked     text,
  total_days      numeric,
  reason          text,
  status          text,
  submitted_on    date,
  decided_on      date,
  expires_on      date,
  expired_days    numeric,
  has_proof       boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  v_tz  text;
begin
  if v_org is null or not public.is_module_admin('leave') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if not public.module_enabled_for(v_org, 'leave') then
    raise exception 'MODULE_NOT_ENABLED' using errcode = 'P0001';
  end if;
  perform public.leave_report_window(_from, _to);
  select timezone into v_tz from public.organization_settings where organization_id = v_org;

  return query
    select c.id, coalesce(p.full_name, p.email)::text, d.name::text, t.name::text,
           (select string_agg(to_char(x.worked_on, 'YYYY-MM-DD') || case when x.days = 0.5 then ' (half)' else '' end,
                              ', ' order by x.worked_on)
              from public.comp_off_claim_days x where x.claim_id = c.id),
           c.total_days, c.reason, c.status,
           (c.created_at at time zone coalesce(v_tz, 'UTC'))::date,
           (c.decided_at at time zone coalesce(v_tz, 'UTC'))::date,
           c.expires_on, c.expired_days, c.proof_path is not null
      from public.comp_off_claims c
      join public.profiles p on p.id = c.employee_id
      join public.leave_types t on t.id = c.leave_type_id
      left join public.departments d on d.id = p.department_id
     where c.organization_id = v_org and c.deleted_at is null
       and (c.created_at at time zone coalesce(v_tz, 'UTC'))::date between _from and _to
     order by c.created_at;
end $$;

comment on function public.comp_off_register is
  'D94 — every compensatory off claim made between two dates, with its days, outcome, expiry and what expired unused.';

revoke all on function public.comp_off_register(date, date) from public, anon;
grant execute on function public.comp_off_register(date, date) to authenticated;

-- ═══════════════════════════════════════════════════════════ approval turnaround

create or replace function public.leave_approval_turnaround(_from date, _to date)
returns table (
  step_id         uuid,
  what            text,
  employee_name   text,
  level           smallint,
  approver_name   text,
  decided_by_name text,
  decision        text,
  reached_at      timestamptz,
  decided_at      timestamptz,
  days_taken      numeric,
  moved_up        boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  v_tz  text;
begin
  if v_org is null or not public.is_module_admin('leave') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if not public.module_enabled_for(v_org, 'leave') then
    raise exception 'MODULE_NOT_ENABLED' using errcode = 'P0001';
  end if;
  perform public.leave_report_window(_from, _to);
  select timezone into v_tz from public.organization_settings where organization_id = v_org;

  return query
    with steps as (
      select s.*, r.requester_id, l.label,
             -- When this level began: the previous level's decision, or when
             -- the request was raised. A move up does not restart it here:
             -- turnaround is how long the requester waited at the level.
             coalesce((select max(prev.decided_at) from public.approval_steps prev
                        where prev.approval_request_id = s.approval_request_id
                          and prev.level < s.level and prev.deleted_at is null), r.created_at) as began
        from public.approval_steps s
        join public.approval_requests r on r.id = s.approval_request_id
        join public.approval_entity_labels l on l.entity_type = r.entity_type
       where s.organization_id = v_org and s.deleted_at is null
         and l.module_key = 'leave'
         and s.decision <> 'pending'
         and (s.decided_at at time zone coalesce(v_tz, 'UTC'))::date between _from and _to
    )
    select st.id, st.label::text,
           coalesce(rp.full_name, 'A colleague')::text,
           st.level,
           coalesce(ap.full_name, 'Approver')::text,
           case when st.decided_by is not null and st.decided_by <> st.approver_id
                then coalesce(dp.full_name, 'A colleague')::text end,
           st.decision::text,
           st.began, st.decided_at,
           round((extract(epoch from st.decided_at - st.began) / 86400)::numeric, 1),
           exists (select 1 from public.approval_escalations e where e.approval_step_id = st.id)
      from steps st
      left join public.profiles rp on rp.id = st.requester_id
      left join public.profiles ap on ap.id = st.approver_id
      left join public.profiles dp on dp.id = st.decided_by
     order by st.decided_at;
end $$;

comment on function public.leave_approval_turnaround is
  'D94 — every Leave approval decision between two dates: who had it, who decided, how long it waited at its level, whether it moved up.';

revoke all on function public.leave_approval_turnaround(date, date) from public, anon;
grant execute on function public.leave_approval_turnaround(date, date) to authenticated;

-- ═══════════════════════════════════════════════════════════ absenteeism

create or replace function public.leave_absenteeism_report(_from date, _to date)
returns table (
  employee_id     uuid,
  employee_name   text,
  department_name text,
  spells          integer,
  days            numeric,
  unpaid_days     numeric,
  bradford_factor numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
begin
  if v_org is null or not public.is_module_admin('leave') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if not public.module_enabled_for(v_org, 'leave') then
    raise exception 'MODULE_NOT_ENABLED' using errcode = 'P0001';
  end if;
  perform public.leave_report_window(_from, _to);

  return query
    with spells as (
      select r.employee_id, t.kind,
             -- Only the working days inside the window.
             public.calculate_working_days(v_org, greatest(r.from_date, _from), least(r.to_date, _to)) as d
        from public.leave_requests r
        join public.leave_types t on t.id = r.leave_type_id
       where r.organization_id = v_org and r.deleted_at is null
         and r.status = 'approved'
         and r.from_date <= _to and r.to_date >= _from
    ),
    per as (
      select s.employee_id, count(*)::int as n, sum(s.d) as total,
             coalesce(sum(s.d) filter (where s.kind = 'unpaid'), 0) as unpaid
        from spells s
       where s.d > 0
       group by s.employee_id
    )
    select per.employee_id, coalesce(p.full_name, p.email)::text, d.name::text,
           per.n, per.total, per.unpaid, (per.n * per.n * per.total)::numeric
      from per
      join public.profiles p on p.id = per.employee_id
      left join public.departments d on d.id = p.department_id
     order by 7 desc, 2;
end $$;

comment on function public.leave_absenteeism_report is
  'D94 — approved leave inside two dates, per person: absences, working days (inside the window), unpaid days, and the Bradford factor.';

revoke all on function public.leave_absenteeism_report(date, date) from public, anon;
grant execute on function public.leave_absenteeism_report(date, date) to authenticated;
