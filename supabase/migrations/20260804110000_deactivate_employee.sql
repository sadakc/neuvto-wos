-- ============================================================================
-- NEUVTO WOS — somebody leaves, and their work goes somewhere
--
-- D14, finally implemented: "deactivating a user is a guarded operation, not a
-- flag flip". Until 20260804100000_profile_writes.sql it was exactly a flag
-- flip, available to any admin in one statement. Demonstrated on the seed:
-- Mark, with three direct reports and a pending approval step, deactivated with
-- no error, nothing reassigned, and every approval routed to him stranded.
--
-- ── ONE DECISION, NOT A CHECKLIST
--
-- D14 as written says the reports and approvals "must be reassigned" first —
-- a precondition, leaving an administrator to move eight people by hand before
-- the button works. Decided with Sada to make it one operation instead: name
-- who takes over, and everything moves in a single transaction. That is the
-- decision being made anyway, and doing it atomically means there is no window
-- in which somebody is half-deactivated.
--
-- ── WHAT THIS FILE DELIBERATELY DOES NOT DO
--
-- It does not touch leave. The platform must not name a module (D30), so the
-- Leave module reacts to `is_active` going false with its own trigger, in its
-- own migration — the same arrangement by which it already reacts to approval
-- decisions. See 20260804120000_leave_on_deactivation.sql.
-- ============================================================================

create or replace function public.deactivate_employee(
  _employee_id  uuid,
  _successor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org       uuid := public.current_org_id();
  v_uid       uuid := (select auth.uid());
  v_reports   int;
  v_steps     int;
  v_collapsed int;
  v_requests  uuid[];
begin
  if v_org is null or not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- Deactivating yourself is how an organisation locks itself out. It also
  -- makes the successor question meaningless: you would be choosing who
  -- inherits your work while being the only person able to undo it.
  if _employee_id = v_uid then
    raise exception 'CANNOT_DEACTIVATE_SELF' using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.profiles
                  where id = _employee_id and organization_id = v_org
                    and deleted_at is null and is_active) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if _successor_id is null or _successor_id = _employee_id then
    raise exception 'SUCCESSOR_REQUIRED' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.profiles
                  where id = _successor_id and organization_id = v_org
                    and deleted_at is null and is_active) then
    raise exception 'SUCCESSOR_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Every request the leaver is currently sitting on. Captured before anything
  -- moves, because the reassignment below is what makes them hard to find again.
  select coalesce(array_agg(distinct s.approval_request_id), '{}')
    into v_requests
    from public.approval_steps s
    join public.approval_requests r on r.id = s.approval_request_id
   where s.approver_id = _employee_id
     and s.decision = 'pending'
     and s.deleted_at is null
     and r.status = 'pending'
     and r.deleted_at is null
     and r.organization_id = v_org;

  -- D13 forbids self-approval at submission. Inheriting it is the same thing
  -- arriving by a different door, so it is refused rather than silently skipped
  -- — the administrator picked the wrong person and should be told.
  if exists (
    select 1 from public.approval_requests r
     where r.id = any (v_requests) and r.requester_id = _successor_id
  ) then
    raise exception 'SUCCESSOR_IS_REQUESTER' using errcode = 'P0001';
  end if;

  -- ── the reports
  update public.profiles
     set manager_id = _successor_id
   where manager_id = _employee_id
     and organization_id = v_org
     and deleted_at is null;
  get diagnostics v_reports = row_count;

  -- ── the approvals
  update public.approval_steps s
     set approver_id = _successor_id
    from public.approval_requests r
   where r.id = s.approval_request_id
     and s.approver_id = _employee_id
     and s.decision = 'pending'
     and s.deleted_at is null
     and r.status = 'pending'
     and r.deleted_at is null
     and r.organization_id = v_org;
  get diagnostics v_steps = row_count;

  -- ── the duplicate that reassignment creates
  --
  -- Mark is level 1 and Dan is level 2 on the same request. Move Mark's step to
  -- Dan and Dan now approves it twice — which approval_submit takes care never
  -- to produce at submission, and which is no more sensible afterwards.
  --
  -- Keep the earliest level, retire the rest. Soft, per D17: a step is part of
  -- how a decision was reached, and these have simply stopped being needed.
  with ranked as (
    select s.id,
           row_number() over (partition by s.approval_request_id order by s.level) as rn
      from public.approval_steps s
     where s.approver_id = _successor_id
       and s.decision = 'pending'
       and s.deleted_at is null
       and s.approval_request_id = any (v_requests)
  )
  update public.approval_steps
     set deleted_at = now()
   where id in (select id from ranked where rn > 1);
  get diagnostics v_collapsed = row_count;

  -- required_levels and current_level are now describing steps that are gone.
  -- Recomputed from what actually survives rather than adjusted by arithmetic,
  -- so the row cannot drift from its own steps.
  update public.approval_requests r
     set required_levels = (
           select count(*) from public.approval_steps s
            where s.approval_request_id = r.id and s.deleted_at is null),
         current_level = coalesce((
           select min(s.level) from public.approval_steps s
            where s.approval_request_id = r.id
              and s.decision = 'pending' and s.deleted_at is null), r.current_level)
   where r.id = any (v_requests);

  -- ── and only now
  update public.profiles
     set is_active = false
   where id = _employee_id and organization_id = v_org;

  -- The profiles row shows is_active going false, and the steps show new
  -- approvers, but neither records that these were one decision or who was
  -- named. That is the fact somebody will want in six months.
  insert into public.audit_logs
    (organization_id, actor_id, action, entity_type, entity_id, before, after)
  values
    (v_org, v_uid, 'member.deactivated', 'profiles', _employee_id,
     jsonb_build_object('is_active', true),
     jsonb_build_object('is_active', false,
                        'successor_id', _successor_id,
                        'reports_moved', v_reports,
                        'approvals_moved', v_steps,
                        'levels_collapsed', v_collapsed));

  return jsonb_build_object(
    'reports_moved',    v_reports,
    'approvals_moved',  v_steps,
    'levels_collapsed', v_collapsed);
end $$;

comment on function public.deactivate_employee is
  'D14 — deactivates somebody and moves their reports and open approvals to a named successor, in one transaction. Refuses self-deactivation and a successor who would end up approving their own request.';

revoke all on function public.deactivate_employee(uuid, uuid) from public, anon;
grant execute on function public.deactivate_employee(uuid, uuid) to authenticated;

-- ═══════════════════════════════════════════════════════ what would move
--
-- So the confirmation can state facts rather than a generic warning. Reading
-- these counts needs the same privilege as acting on them: knowing how many
-- approvals a colleague is sitting on is not an ordinary employee's business.

create or replace function public.deactivation_impact(_employee_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
begin
  if v_org is null or not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'reports', (select count(*) from public.profiles
                 where manager_id = _employee_id and organization_id = v_org
                   and deleted_at is null),
    'approvals', (select count(*) from public.approval_steps s
                    join public.approval_requests r on r.id = s.approval_request_id
                   where s.approver_id = _employee_id and s.decision = 'pending'
                     and s.deleted_at is null and r.status = 'pending'
                     and r.deleted_at is null and r.organization_id = v_org));
end $$;

comment on function public.deactivation_impact is
  'Counts what deactivating somebody would move, so the confirmation names it instead of warning vaguely.';

revoke all on function public.deactivation_impact(uuid) from public, anon;
grant execute on function public.deactivation_impact(uuid) to authenticated;
