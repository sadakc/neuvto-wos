-- ============================================================================
-- NEUVTO WOS — deactivation that actually removes access, and a way back
--
-- Step 11 made deactivation a guarded operation: reports and approvals move to
-- a named successor, pending leave is cancelled, nothing strands. What it did
-- not do is stop the person using the product.
--
-- current_org_id() checked `deleted_at` and not `is_active`. Demonstrated on
-- the seed straight after deactivating Ravi: he read his profile, read his
-- balances, and SUBMITTED A LEAVE REQUEST. Deactivation meant "cannot be
-- resolved as an approver" and nothing more.
--
-- It was left that way deliberately for one step, because there was no way
-- back. Revoking access while reactivation does not exist turns a mis-click
-- into a lockout only SQL can undo. Both halves are here.
--
-- ── THE WIDEST BLAST RADIUS IN THIS CODEBASE
--
-- Every RLS policy and most SECURITY DEFINER functions route through
-- current_org_id(). One clause changes what every one of them decides. That is
-- why the existing suite passing UNCHANGED is a large part of the evidence for
-- this migration: every seeded person is active, so nothing about them should
-- move by so much as a row.
--
-- ── WHAT IS DELIBERATELY NOT DONE
--
-- Their JWT is left alone. Deleting from auth.sessions and auth.refresh_tokens
-- would log them out at once, at the cost of coupling our migrations to
-- GoTrue's internal schema — a table we do not own, cannot version, and which
-- Supabase may change under us on any upgrade. Refusing the data is the
-- boundary that matters: the token stays valid and buys nothing.
-- ============================================================================

create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id from public.profiles
   where id = (select auth.uid())
     and deleted_at is null
     and is_active
$$;

comment on function public.current_org_id is
  'The caller''s organisation, or null when they have no profile or have been deactivated. Null makes every tenant policy refuse them, which is what deactivation now means.';

-- ═══════════════════════════════════════════════════════ why they are refused
--
-- With current_org_id() null, getCurrentUser finds no profile and the app shows
-- "You're not in a workspace yet — ask your administrator to invite your
-- address." For somebody whose access was just removed that is both wrong and
-- useless advice: an invitation will not help them.
--
-- This is the one thing a signed-in person may always learn — about themselves,
-- one word, and nothing else. It cannot be asked about anybody else, so it
-- discloses nothing that is not already the caller's own situation.

create or replace function public.my_account_status()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select case when p.is_active then 'active' else 'deactivated' end
       from public.profiles p
      where p.id = (select auth.uid()) and p.deleted_at is null),
    'none')
$$;

comment on function public.my_account_status is
  'active | deactivated | none, for the caller only. Lets the sign-in screen tell somebody their access was removed rather than that they were never here.';

revoke all on function public.my_account_status() from public, anon;
grant execute on function public.my_account_status() to authenticated;

-- ═══════════════════════════════════════════════════════ the way back

create or replace function public.reactivate_employee(_employee_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  v_uid uuid := (select auth.uid());
begin
  if v_org is null or not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.profiles
                  where id = _employee_id and organization_id = v_org
                    and deleted_at is null and not is_active) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Access, and only access.
  --
  -- Their reports and approvals moved to a successor who has been carrying them
  -- since; taking those back weeks later would change who a third person reports
  -- to, decided by a click on somebody else's record and without either of them
  -- being asked. Cancelled leave stays cancelled — they re-apply, against a
  -- balance that never went anywhere.
  update public.profiles
     set is_active = true
   where id = _employee_id and organization_id = v_org;

  insert into public.audit_logs
    (organization_id, actor_id, action, entity_type, entity_id, before, after)
  values
    (v_org, v_uid, 'member.reactivated', 'profiles', _employee_id,
     jsonb_build_object('is_active', false),
     jsonb_build_object('is_active', true, 'restored', 'access only'));
end $$;

comment on function public.reactivate_employee is
  'Gives somebody their access back. Moves nothing else — what was handed to a successor stays with them.';

revoke all on function public.reactivate_employee(uuid) from public, anon;
grant execute on function public.reactivate_employee(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════ and the last one out
--
-- Now that access follows is_active, deactivating the final org_admin leaves an
-- organisation nobody can administer AND nobody who can undo it — reactivation
-- above is admin-only, and there would be no admin. Self-deactivation was
-- already refused in step 11; this closes the other half of the same trap.
--
-- Rebuilt in full rather than patched: the body is the step 11 function with
-- one guard added, and splitting it across two files would leave the next
-- reader assembling it from a diff.

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

  if _employee_id = v_uid then
    raise exception 'CANNOT_DEACTIVATE_SELF' using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.profiles
                  where id = _employee_id and organization_id = v_org
                    and deleted_at is null and is_active) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  -- The workspace must keep somebody who can administer it — including somebody
  -- who could reverse this.
  if exists (select 1 from public.user_roles
              where user_id = _employee_id and organization_id = v_org
                and role = 'org_admin' and deleted_at is null)
     and (select count(*) from public.user_roles ur
            join public.profiles p on p.id = ur.user_id
           where ur.organization_id = v_org and ur.role = 'org_admin'
             and ur.deleted_at is null and p.deleted_at is null and p.is_active) <= 1
  then
    raise exception 'LAST_ADMIN' using errcode = 'P0001';
  end if;

  if _successor_id is null or _successor_id = _employee_id then
    raise exception 'SUCCESSOR_REQUIRED' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.profiles
                  where id = _successor_id and organization_id = v_org
                    and deleted_at is null and is_active) then
    raise exception 'SUCCESSOR_NOT_FOUND' using errcode = 'P0002';
  end if;

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

  if exists (
    select 1 from public.approval_requests r
     where r.id = any (v_requests) and r.requester_id = _successor_id
  ) then
    raise exception 'SUCCESSOR_IS_REQUESTER' using errcode = 'P0001';
  end if;

  update public.profiles
     set manager_id = _successor_id
   where manager_id = _employee_id
     and organization_id = v_org
     and deleted_at is null;
  get diagnostics v_reports = row_count;

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

  update public.approval_requests r
     set required_levels = (
           select count(*) from public.approval_steps s
            where s.approval_request_id = r.id and s.deleted_at is null),
         current_level = coalesce((
           select min(s.level) from public.approval_steps s
            where s.approval_request_id = r.id
              and s.decision = 'pending' and s.deleted_at is null), r.current_level)
   where r.id = any (v_requests);

  update public.profiles
     set is_active = false
   where id = _employee_id and organization_id = v_org;

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
  'D14 — deactivates somebody and moves their reports and open approvals to a named successor, in one transaction. Refuses self-deactivation, the last administrator, and a successor who would inherit their own request.';
