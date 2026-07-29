-- ============================================================================
-- NEUVTO WOS — Platform service: Approval Engine
--
-- Build step 4. Entity-agnostic by construction: it operates on
-- (entity_type, entity_id) and knows nothing about leave. Attendance
-- corrections, shift swaps and payroll runs will use it unchanged.
--
-- The gate for this step is deliberately awkward — the harness drives it end to
-- end with a dummy entity type, before any leave table exists. A service that
-- can only be tested through the module it was written for is not a service.
--
-- D5 realised: "more than 3 days needs two approvals" is a ROW in
-- approval_chains, not a line of code. An organisation changes its threshold,
-- or adds a third level, without a deploy.
-- ============================================================================

create type public.approval_status   as enum ('pending', 'approved', 'rejected', 'cancelled');
create type public.approval_decision as enum ('pending', 'approved', 'rejected');
create type public.approver_rule     as enum ('reporting_manager', 'manager_of_manager', 'role');

-- ─────────────────────────────────────────────────────────── chains (configuration)

create table public.approval_chains (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  entity_type         text not null,
  level               smallint not null,
  approver_rule       public.approver_rule not null,
  approver_role       public.app_role,
  condition_field     text,
  condition_op        text,
  condition_value     numeric,
  escalate_after_days integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  deleted_at timestamptz,

  constraint chain_level_positive check (level > 0),
  constraint chain_entity_format  check (entity_type ~ '^[a-z_]+$'),
  -- A 'role' rule without a role is unresolvable; a role on any other rule is
  -- misleading. Reject both at write time rather than failing at submission.
  constraint chain_role_present check (
    (approver_rule = 'role' and approver_role is not null)
    or (approver_rule <> 'role' and approver_role is null)
  ),
  -- A condition is all three parts or none. A field with no operator silently
  -- never matches, which reads as "this level never applies".
  constraint chain_condition_complete check (
    (condition_field is null and condition_op is null and condition_value is null)
    or (condition_field is not null and condition_op is not null and condition_value is not null)
  ),
  constraint chain_condition_op check (condition_op is null or condition_op in ('>', '>=', '<', '<=', '=')),
  constraint chain_escalate_positive check (escalate_after_days is null or escalate_after_days > 0),

  unique (organization_id, entity_type, level)
);

create index idx_chains_lookup on public.approval_chains (organization_id, entity_type, level)
  where deleted_at is null;

-- ─────────────────────────────────────────────────────────── requests

create table public.approval_requests (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_type     text not null,
  entity_id       uuid not null,
  requester_id    uuid not null references public.profiles(id) on delete restrict,
  status          public.approval_status not null default 'pending',
  current_level   smallint not null,
  required_levels smallint not null,
  context         jsonb not null default '{}',
  completed_at    timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  deleted_at timestamptz,

  constraint request_levels_positive check (required_levels > 0 and current_level > 0),
  constraint request_completed_when_final check (
    (status in ('pending') and completed_at is null)
    or (status in ('approved', 'rejected', 'cancelled') and completed_at is not null)
  ),
  -- One open approval per thing. Without this a double-submit creates two
  -- competing chains for the same entity and both can be approved.
  unique (entity_type, entity_id, status) deferrable initially immediate
);

create index idx_requests_entity  on public.approval_requests (entity_type, entity_id);
create index idx_requests_pending on public.approval_requests (organization_id, status, current_level)
  where deleted_at is null;

-- ─────────────────────────────────────────────────────────── steps
-- Every resolved level gets a row at submission, not one at a time. The chain
-- is frozen when the request is made (D5): resolving later would mean a manager
-- leaving mid-approval silently changes who must sign off, and "all required
-- levels approved" would be uncheckable.

create table public.approval_steps (
  id                  uuid primary key default gen_random_uuid(),
  approval_request_id uuid not null references public.approval_requests(id) on delete cascade,
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  level               smallint not null,
  approver_id         uuid not null references public.profiles(id) on delete restrict,
  decision            public.approval_decision not null default 'pending',
  comments            text,
  decided_at          timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  deleted_at timestamptz,

  constraint step_level_positive check (level > 0),
  constraint step_decided_when_final check (
    (decision = 'pending' and decided_at is null)
    or (decision <> 'pending' and decided_at is not null)
  ),
  unique (approval_request_id, level)
);

create index idx_steps_approver on public.approval_steps (approver_id, decision)
  where deleted_at is null;

-- ─────────────────────────────────────────────────────────── audit + triggers

create trigger set_audit_fields before insert or update on public.approval_chains
  for each row execute function public.set_audit_fields();
create trigger set_audit_fields before insert or update on public.approval_requests
  for each row execute function public.set_audit_fields();
create trigger set_audit_fields before insert or update on public.approval_steps
  for each row execute function public.set_audit_fields();

create trigger write_audit_log after insert or update or delete on public.approval_chains
  for each row execute function public.write_audit_log();
create trigger write_audit_log after insert or update or delete on public.approval_requests
  for each row execute function public.write_audit_log();
create trigger write_audit_log after insert or update or delete on public.approval_steps
  for each row execute function public.write_audit_log();

-- ═══════════════════════════════════════════════════════════ event seam
-- The Notification Engine arrives in step 5. Until then this is a deliberate
-- no-op: the call sites are correct, so step 5 is one function body rather than
-- a hunt through the engine for places that should have notified.

create or replace function public.emit_platform_event(_event_key text, _payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Step 5 replaces this body with notification dispatch.
  -- Intentionally silent: an event nobody consumes yet must not fail a request.
  return;
end $$;

comment on function public.emit_platform_event is
  'Seam for the Notification Engine (step 5). No-op today; call sites are already correct.';

-- ═══════════════════════════════════════════════════════════ approver resolution

create or replace function public.resolve_approver(
  _org_id       uuid,
  _requester_id uuid,
  _rule         public.approver_rule,
  _role         public.app_role
)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_approver uuid;
begin
  if _rule = 'reporting_manager' then
    select manager_id into v_approver
      from public.profiles
     where id = _requester_id and organization_id = _org_id and deleted_at is null;

  elsif _rule = 'manager_of_manager' then
    select m.manager_id into v_approver
      from public.profiles p
      join public.profiles m on m.id = p.manager_id
     where p.id = _requester_id and p.organization_id = _org_id
       and p.deleted_at is null and m.deleted_at is null;

  elsif _rule = 'role' then
    -- Any active holder of the role. Deterministic ordering so the same request
    -- resolves the same way twice; a nondeterministic pick would make an
    -- approval chain unreproducible when investigating a complaint.
    select ur.user_id into v_approver
      from public.user_roles ur
      join public.profiles p on p.id = ur.user_id
     where ur.organization_id = _org_id and ur.role = _role
       and ur.deleted_at is null and p.deleted_at is null and p.is_active
       and ur.user_id <> _requester_id
     order by p.created_at, ur.user_id
     limit 1;
  end if;

  return v_approver;
end $$;

-- ═══════════════════════════════════════════════════════════ condition matching
-- Compared in SQL rather than by building a predicate string: dynamic SQL over a
-- customer-editable operator is an injection surface, and the CHECK constraint
-- already limits the operator set.

create or replace function public.chain_condition_matches(
  _context jsonb,
  _field   text,
  _op      text,
  _value   numeric
)
returns boolean
language plpgsql
immutable
as $$
declare
  v_actual numeric;
begin
  if _field is null then
    return true;                       -- no condition: the level always applies
  end if;

  begin
    v_actual := (_context ->> _field)::numeric;
  exception when others then
    v_actual := null;                  -- absent or non-numeric
  end;

  if v_actual is null then
    -- The chain asks about something the caller did not provide. Treating that
    -- as "matches" would silently add an approval level; treating it as "does
    -- not match" would silently remove one. Not matching is the safer default
    -- only because an unresolvable chain then raises rather than auto-approving.
    return false;
  end if;

  return case _op
    when '>'  then v_actual >  _value
    when '>=' then v_actual >= _value
    when '<'  then v_actual <  _value
    when '<=' then v_actual <= _value
    when '='  then v_actual =  _value
    else false
  end;
end $$;

-- ═══════════════════════════════════════════════════════════ submit

create or replace function public.approval_submit(
  _entity_type text,
  _entity_id   uuid,
  _context     jsonb default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org       uuid := public.current_org_id();
  v_requester uuid := (select auth.uid());
  v_chain     record;
  v_approver  uuid;
  v_levels    smallint[] := '{}';
  v_approvers uuid[]     := '{}';
  v_request   uuid;
  i           int;
begin
  if v_requester is null or v_org is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;

  -- Resolve the whole chain first, then write. A half-created request with no
  -- approvers is worse than a clean failure.
  for v_chain in
    select * from public.approval_chains
     where organization_id = v_org and entity_type = _entity_type and deleted_at is null
     order by level
  loop
    -- A level whose condition does not match simply is not required.
    if not public.chain_condition_matches(
         _context, v_chain.condition_field, v_chain.condition_op, v_chain.condition_value) then
      continue;
    end if;

    v_approver := public.resolve_approver(
      v_org, v_requester, v_chain.approver_rule, v_chain.approver_role);

    -- D13. Skip rather than fail: a later level may still resolve, and that is
    -- the escalation the rule is describing.
    if v_approver is null then
      continue;                                        -- nobody holds that position
    end if;
    if v_approver = v_requester then
      continue;                                        -- would be self-approval
    end if;
    if not exists (select 1 from public.profiles
                    where id = v_approver and is_active and deleted_at is null) then
      continue;                                        -- approver has left
    end if;
    if v_approver = any (v_approvers) then
      continue;                                        -- already approving a lower level
    end if;

    v_levels    := v_levels    || v_chain.level;
    v_approvers := v_approvers || v_approver;
  end loop;

  -- Never auto-approve. An organisation with no managers configured must fail
  -- loudly at submission, not silently approve everything it is asked.
  if array_length(v_levels, 1) is null then
    raise exception 'APPROVER_UNRESOLVED' using errcode = 'P0001';
  end if;

  insert into public.approval_requests (
    organization_id, entity_type, entity_id, requester_id,
    current_level, required_levels, context
  ) values (
    v_org, _entity_type, _entity_id, v_requester,
    v_levels[1], array_length(v_levels, 1)::smallint, coalesce(_context, '{}')
  ) returning id into v_request;

  -- Every resolved level, written now: the chain is frozen at submission (D5).
  for i in 1 .. array_length(v_levels, 1) loop
    insert into public.approval_steps (approval_request_id, organization_id, level, approver_id)
    values (v_request, v_org, v_levels[i], v_approvers[i]);
  end loop;

  perform public.emit_platform_event('approval.submitted', jsonb_build_object(
    'approval_request_id', v_request,
    'entity_type', _entity_type,
    'entity_id', _entity_id,
    'approver_id', v_approvers[1],
    'required_levels', array_length(v_levels, 1)
  ));

  return v_request;
end $$;

comment on function public.approval_submit is
  'Starts an approval for any entity. Resolves and freezes the chain, or raises APPROVER_UNRESOLVED. Never auto-approves.';

-- ═══════════════════════════════════════════════════════════ decide

create or replace function public.approval_decide(
  _request_id uuid,
  _decision   public.approval_decision,
  _comments   text default null
)
returns public.approval_status
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_request   public.approval_requests;
  v_step      public.approval_steps;
  v_next      smallint;
  v_status    public.approval_status;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;
  if _decision not in ('approved', 'rejected') then
    raise exception 'INVALID_DECISION' using errcode = '22023';
  end if;

  select * into v_request from public.approval_requests
   where id = _request_id and deleted_at is null;

  if v_request.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_request.organization_id is distinct from public.current_org_id() then
    raise exception 'TENANT_MISMATCH' using errcode = '42501';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'ALREADY_DECIDED' using errcode = 'P0001';
  end if;

  select * into v_step from public.approval_steps
   where approval_request_id = _request_id
     and level = v_request.current_level and deleted_at is null;

  -- Only the approver for the level currently in play. A later-level approver
  -- acting early would skip a signature the organisation asked for.
  if v_step.approver_id is distinct from v_uid then
    raise exception 'NOT_YOUR_APPROVAL' using errcode = '42501';
  end if;
  if v_step.decision <> 'pending' then
    raise exception 'ALREADY_DECIDED' using errcode = 'P0001';
  end if;
  -- Belt and braces: D13 keeps a requester out of their own chain at submission,
  -- but a chain edited afterwards must never let it through here either.
  if v_uid = v_request.requester_id then
    raise exception 'SELF_APPROVAL_FORBIDDEN' using errcode = '42501';
  end if;

  update public.approval_steps
     set decision = _decision, comments = _comments, decided_at = now()
   where id = v_step.id;

  if _decision = 'rejected' then
    v_status := 'rejected';
    update public.approval_requests
       set status = v_status, completed_at = now()
     where id = _request_id;
  else
    select min(level) into v_next from public.approval_steps
     where approval_request_id = _request_id
       and decision = 'pending' and deleted_at is null;

    if v_next is null then
      v_status := 'approved';
      update public.approval_requests
         set status = v_status, completed_at = now()
       where id = _request_id;
    else
      v_status := 'pending';
      update public.approval_requests set current_level = v_next where id = _request_id;
    end if;
  end if;

  perform public.emit_platform_event('approval.decided', jsonb_build_object(
    'approval_request_id', _request_id,
    'entity_type', v_request.entity_type,
    'entity_id', v_request.entity_id,
    'level', v_request.current_level,
    'decision', _decision,
    'status', v_status
  ));

  if v_status <> 'pending' then
    perform public.emit_platform_event('approval.completed', jsonb_build_object(
      'approval_request_id', _request_id,
      'entity_type', v_request.entity_type,
      'entity_id', v_request.entity_id,
      'requester_id', v_request.requester_id,
      'status', v_status
    ));
  end if;

  return v_status;
end $$;

comment on function public.approval_decide is
  'Records a decision for the level currently in play, then advances or completes. Emits approval.decided, and approval.completed on a final status.';

-- ═══════════════════════════════════════════════════════════ pending queue

create or replace function public.approval_pending_for(_user_id uuid default null)
returns setof public.approval_requests
language sql
stable
security definer
set search_path = public
as $$
  select r.*
    from public.approval_requests r
    join public.approval_steps s
      on s.approval_request_id = r.id
     and s.level = r.current_level
     and s.decision = 'pending'
     and s.deleted_at is null
   where r.status = 'pending'
     and r.deleted_at is null
     and r.organization_id = public.current_org_id()
     and s.approver_id = coalesce(_user_id, (select auth.uid()))
   order by r.created_at
$$;

comment on function public.approval_pending_for is
  'Approvals waiting on a user, at the level currently in play only. Scoped to the caller''s organisation.';

-- ═══════════════════════════════════════════════════════════ grants and RLS

grant select, insert, update on public.approval_chains   to authenticated;
grant select                 on public.approval_requests to authenticated;
grant select                 on public.approval_steps    to authenticated;

grant execute on function public.emit_platform_event(text, jsonb)                                to authenticated;
grant execute on function public.resolve_approver(uuid, uuid, public.approver_rule, public.app_role) to authenticated;
grant execute on function public.chain_condition_matches(jsonb, text, text, numeric)             to authenticated;
grant execute on function public.approval_submit(text, uuid, jsonb)                              to authenticated;
grant execute on function public.approval_decide(uuid, public.approval_decision, text)           to authenticated;
grant execute on function public.approval_pending_for(uuid)                                      to authenticated;

alter table public.approval_chains   enable row level security;
alter table public.approval_requests enable row level security;
alter table public.approval_steps    enable row level security;

-- chains: everyone may read the rules that govern them; only admins set them.
create policy "read own approval chains" on public.approval_chains
  for select to authenticated
  using (organization_id = public.current_org_id() and deleted_at is null);

create policy "admins manage approval chains" on public.approval_chains
  for all to authenticated
  using (organization_id = public.current_org_id() and public.is_admin() and deleted_at is null)
  with check (organization_id = public.current_org_id() and public.is_admin());

-- The two tables need to ask about each other — a requester should see the steps
-- on their request, and an approver should see the request behind their step.
-- Writing those as inline EXISTS makes each policy invoke the other's policy:
--
--   ERROR: infinite recursion detected in policy for relation "approval_requests"
--
-- SECURITY DEFINER breaks the cycle by bypassing RLS for the lookup itself,
-- which is the same reason current_org_id() and is_admin() are defined that way.

create or replace function public.is_approver_on(_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.approval_steps
     where approval_request_id = _request_id
       and approver_id = (select auth.uid())
       and deleted_at is null
  )
$$;

create or replace function public.is_requester_of(_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.approval_requests
     where id = _request_id
       and requester_id = (select auth.uid())
       and deleted_at is null
  )
$$;

grant execute on function public.is_approver_on(uuid)  to authenticated;
grant execute on function public.is_requester_of(uuid) to authenticated;

-- requests: the requester, anyone in the chain, and admins.
-- Writes go exclusively through approval_submit/approval_decide, which are
-- SECURITY DEFINER — so no INSERT or UPDATE policy exists, and none should.
create policy "read approvals in scope" on public.approval_requests
  for select to authenticated
  using (
    organization_id = public.current_org_id()
    and deleted_at is null
    and (
      requester_id = (select auth.uid())
      or public.is_admin()
      or public.is_approver_on(id)
    )
  );

create policy "read approval steps in scope" on public.approval_steps
  for select to authenticated
  using (
    organization_id = public.current_org_id()
    and deleted_at is null
    and (
      approver_id = (select auth.uid())
      or public.is_admin()
      or public.is_requester_of(approval_request_id)
    )
  );

comment on table public.approval_chains is
  'D5 — approval rules as configuration. A threshold change is a row edit, not a deploy.';
comment on table public.approval_requests is
  'Entity-agnostic approvals, keyed on (entity_type, entity_id). Knows nothing about leave.';
