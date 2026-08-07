-- ============================================================================
-- NEUVTO WOS — an employee approves nothing
--
-- Sada, 7 Aug 2026: "anybody who is an employee would never have permission to
-- approve. That's what I would go with: anyone who is an [admin], manager,
-- supervisor, or coordinator. These are the people who can approve a leave, but
-- anybody who has been selected as an employee should never have permission to
-- approve any leave."
--
-- ── THE HOLE THIS CLOSES, WHICH WAS NOT THE OBVIOUS ONE
--
-- `canApprove()` in the browser and the role picker on Approval rules both
-- already excluded Employee, so the product LOOKED like it enforced this. It did
-- not, because neither is where approvers come from.
--
-- Approvals resolve through `resolve_approver`, and its first rule is:
--
--     if _rule = 'reporting_manager' then
--       select manager_id into v_approver from public.profiles ...
--
-- `profiles.manager_id` — a column, with no opinion whatsoever about the role of
-- the person it points at. Any Employee with a direct report has been approving
-- leave since the approval engine was written. The role picker only ever
-- governed the `role` rule, which is level 2 of the default chain; level 1 has
-- always been the reporting line.
--
-- So the rule is enforced where a manager is SET, not where one is read:
--
--   admin_set_reporting_line   the front door
--   deactivate_employee        the bulk door — it reassigns reports and pending
--                              steps directly, bypassing the front door entirely
--   approval_chains            a CHECK, so 'employee' cannot be chosen at level 2
--
-- ── WHY AT WRITE TIME AND NOT AT READ TIME
--
-- Teaching `resolve_approver` to skip a non-approving manager would have been
-- one line and would have been wrong. It would silently drop a level from a
-- chain the organisation configured — the exact failure D13 and the cycle guard
-- already exist to prevent — and it would change the routing of requests that
-- are mid-flight right now. Refusing the write leaves every existing approval
-- exactly where it is and stops new ones being created.
--
-- ── EXISTING DATA IS REPORTED, NOT REWRITTEN
--
-- An Employee who already holds direct reports keeps them. Promoting them or
-- moving their team is a decision about somebody's job, which is Sada's to make
-- and not a migration's. The count is raised as a warning at the bottom of this
-- file, and verify_invariants.sql asserts it stays at zero from here.
--
-- Both functions below are reproduced from their CURRENT definitions —
-- admin_set_reporting_line from 20260804100000_profile_writes.sql and
-- deactivate_employee from 20260805100000_access_follows_active.sql — and
-- substituted programmatically, not retyped. The diff in each is one block.
--
-- deactivate_employee has TWO definitions in the history, and the first
-- attempt at this file reproduced the older one, silently dropping the
-- LAST_ADMIN guard that 20260805100000 added. Nothing in the diff looked
-- wrong; verify_rls.sql caught it by deactivating the last administrator and
-- watching the workspace lock itself out. Both are now selected by taking the
-- LAST definition in migration order rather than the first one a grep prints.
-- ============================================================================

-- ═══════════════════════════════════════════════ which roles approve

-- The single source of truth, mirrored by canApprove() in session.ts. Note what
-- is NOT here: `employee`. And note that this is not is_admin() — a Supervisor
-- approves leave and administers nothing.
create or replace function public.is_approver_role(_role public.app_role)
returns boolean
language sql
immutable
set search_path = public
as $$
  select _role in ('org_admin', 'hr_admin', 'manager', 'supervisor', 'coordinator')
$$;

comment on function public.is_approver_role is
  'D57 — the roles that may hold an approval. Mirrored by canApprove() in src/platform/auth/session.ts.';

-- Postgres grants EXECUTE to PUBLIC on every new function. 20260808100000
-- revoked that across the board after a real open relay, but it could only
-- revoke what existed then — every function added since has to say so itself.
revoke all on function public.is_approver_role(public.app_role) from public, anon, authenticated;

-- Deliberately takes a user id rather than reading auth.uid(): every caller here
-- is asking about SOMEBODY ELSE — the proposed manager, the named successor.
create or replace function public.can_approve(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles ur
     where ur.user_id = _user_id
       and ur.deleted_at is null
       and public.is_approver_role(ur.role)
  )
$$;

comment on function public.can_approve is
  'D57 — whether this person may hold an approval at all. Asked about a proposed manager or successor, never about the caller.';

-- Granted to NOBODY, deliberately. Its only callers are the two SECURITY
-- DEFINER functions below, which run as the owner and need no grant, and the
-- harness, which runs as postgres. Left with the default PUBLIC grant it would
-- be a SECURITY DEFINER function callable by `anon` — which is precisely what
-- verify_invariants.sql refuses, and it caught this one before this line existed.
revoke all on function public.can_approve(uuid) from public, anon, authenticated;

-- ═══════════════════════════════════════════════ the front door

create or replace function public.admin_set_reporting_line(
  _employee_id uuid,
  _manager_id  uuid          -- null clears it: somebody has to report to nobody
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
begin
  if v_org is null or not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.profiles
                  where id = _employee_id and organization_id = v_org and deleted_at is null) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if _manager_id is not null then
    if _manager_id = _employee_id then
      raise exception 'SELF_MANAGED' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.profiles
                    where id = _manager_id and organization_id = v_org
                      and deleted_at is null and is_active) then
      raise exception 'MANAGER_NOT_FOUND' using errcode = 'P0002';
    end if;

    -- D57. An Employee cannot be somebody's manager, because `reporting_manager`
    -- resolves this column and asks nothing about the role attached to it.
    --
    -- Sada, 7 Aug 2026: "anybody who is an employee would never have permission
    -- to approve ... Basically, there would be nobody to report under them. If
    -- there is any report under them, then let the admin decide that they are
    -- the managers." So the refusal names the decision rather than just refusing.
    --
    -- Before the cycle walk below, deliberately: this is a cheap lookup and by
    -- far the commoner mistake, and the recursive CTE is neither.
    if not public.can_approve(_manager_id) then
      raise exception 'MANAGER_CANNOT_APPROVE' using errcode = 'P0001';
    end if;

    -- ── cycles.
    --
    -- profiles_not_own_manager stops A→A and nothing stopped A→B→A. Both rows
    -- were accepted on the seed, and manager_of_manager then resolved Ravi's
    -- second level to Ravi himself — which D13 skips, so the request quietly
    -- lost a level the organisation had asked for. A ring of three or more was
    -- equally welcome.
    --
    -- Walk UP from the proposed manager: if we meet the employee, this edit
    -- closes a loop. The depth cap is a second line of defence — a cycle that
    -- already exists in the data would otherwise make this walk itself hang.
    if exists (
      with recursive up as (
        select p.id, p.manager_id, 1 as depth
          from public.profiles p
         where p.id = _manager_id and p.deleted_at is null
        union all
        select p.id, p.manager_id, up.depth + 1
          from public.profiles p
          join up on p.id = up.manager_id
         where p.deleted_at is null and up.depth < 64
      )
      select 1 from up where id = _employee_id
    ) then
      raise exception 'REPORTING_CYCLE' using errcode = 'P0001';
    end if;
  end if;

  update public.profiles
     set manager_id = _manager_id
   where id = _employee_id and organization_id = v_org;
end $$;;


-- ═══════════════════════════════════════════════ the bulk door

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

  -- D57, through the other door.
  --
  -- admin_set_reporting_line refuses to make an Employee somebody's manager.
  -- This function reassigns reports and pending approval steps WITHOUT going
  -- through it, so handing a leaver's team to an Employee produced exactly the
  -- arrangement that guard exists to prevent — and produced it in bulk.
  --
  -- Only when something is actually handed over. A leaver holding no reports and
  -- no waiting approvals can be succeeded by anybody, and refusing on the
  -- successor's role there would block an ordinary departure over a rule with
  -- nothing to bite on.
  if not public.can_approve(_successor_id)
     and (array_length(v_requests, 1) > 0
          or exists (select 1 from public.profiles
                      where manager_id = _employee_id
                        and organization_id = v_org
                        and deleted_at is null)) then
    raise exception 'SUCCESSOR_CANNOT_APPROVE' using errcode = 'P0001';
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
end $$;;


-- ═══════════════════════════════════════════════ the configured chain
--
-- chain_role_present already requires approver_role alongside a 'role' rule.
-- Nothing required it to be a role that can approve. The Approval rules screen
-- has filtered Employee out of the picker since it was built, which is precisely
-- why this was never noticed: the only way in was an RPC or a direct insert.
--
-- Written as a plain comparison rather than is_approver_role(): a CHECK runs
-- with the privileges of whoever is writing the row, so a function call here
-- would need an EXECUTE grant to `authenticated` that nothing else wants.
do $$
declare
  v_bad bigint;
begin
  select count(*) into v_bad from public.approval_chains where approver_role = 'employee';
  if v_bad > 0 then
    raise exception
      'D57: % approval chain level(s) name Employee as the approver. Repoint or remove them before applying this migration.', v_bad;
  end if;
end $$;

alter table public.approval_chains
  add constraint chain_role_can_approve
  check (approver_role is null or approver_role <> 'employee');

comment on constraint chain_role_can_approve on public.approval_chains is
  'D57 — an approval level cannot name Employee. The screen already filtered it; the database never did.';

-- ═══════════════════════════════════════════════ what is already out there

do $$
declare
  v_bad bigint;
begin
  select count(*) into v_bad
    from public.profiles m
   where m.deleted_at is null
     and m.is_active
     and not public.can_approve(m.id)
     and exists (select 1 from public.profiles r
                  where r.manager_id = m.id and r.deleted_at is null);

  if v_bad = 0 then
    raise notice '[D57] no employee holds direct reports';
  else
    -- Not rewritten. Promoting somebody or moving their team is a decision about
    -- a person's job. They keep approving until somebody decides otherwise; what
    -- changes today is that no NEW one can be created.
    raise warning '[D57] % active person(s) hold direct reports without a role that can approve. They keep them. Find them with:  select m.id, m.organization_id from profiles m where m.is_active and not can_approve(m.id) and exists (select 1 from profiles r where r.manager_id = m.id and r.deleted_at is null);', v_bad;
  end if;
end $$;
