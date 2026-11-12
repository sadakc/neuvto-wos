-- ============================================================================
-- NEUVTO WOS — handing your approvals to somebody while you are away (D92)
-- ============================================================================
--
-- Leave phase 2: "delegation of approval for a date range and scope". Platform,
-- not Leave: every module's approvals can be delegated the same way.
--
--   WHO. An approver hands their approvals to one colleague for a date range,
--   for everything or for one module's approvals (the scope is a module key,
--   read from the request's approval_entity_labels row, D30). A company admin
--   can set one up on somebody's behalf: people fall ill without warning.
--   The delegate must be active in the same company and able to approve at all
--   (D57). One delegation at a time per person: two overlapping ones would make
--   "who has my approvals" a question with two answers.
--
--   WHAT IT DOES. While it is in force (the company's dates, D9) the delegate
--   sees the approver's waiting requests in their own queue, marked as on whose
--   behalf, is told of new ones, can read them, and can decide them. The
--   approver still can too: delegating hands over, it does not lock out.
--   Every decision records who actually made it, and the history says "on
--   behalf of".
--
--   WHAT IT NEVER DOES. Let anybody approve their own request (D13), or sign
--   two levels of the same request: a delegate already signing another level
--   is refused. Nor is it a chain: a delegate's own delegation does not pass
--   the delegator's approvals on again.
--
--   Cancelled, not deleted, so the history of who could approve when stays.
-- ============================================================================

create table if not exists public.approval_delegations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  delegator_id    uuid not null references public.profiles(id) on delete cascade,
  delegate_id     uuid not null references public.profiles(id) on delete cascade,
  from_date       date not null,
  to_date         date not null,
  -- Null: every module's approvals. Otherwise one module's.
  module_key      text references public.modules(key) on delete restrict,
  reason          text,
  cancelled_at    timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint delegation_dates_ordered check (to_date >= from_date),
  constraint delegation_not_to_self check (delegate_id <> delegator_id)
);

alter table public.approval_delegations drop constraint if exists delegation_one_at_a_time;
alter table public.approval_delegations add constraint delegation_one_at_a_time
  exclude using gist (delegator_id with =, daterange(from_date, to_date, '[]') with &&)
  where (cancelled_at is null);

create index if not exists idx_delegations_delegate
  on public.approval_delegations (delegate_id) where cancelled_at is null;

create trigger set_audit_fields before insert or update on public.approval_delegations
  for each row execute function public.set_audit_fields();
create trigger write_audit_log after insert or update or delete on public.approval_delegations
  for each row execute function public.write_audit_log();

alter table public.approval_delegations enable row level security;
revoke all on public.approval_delegations from anon, authenticated;

comment on table public.approval_delegations is
  'D92 — an approver''s approvals handed to a colleague for a date range, for every module or one.';

-- Who actually decided a step, when somebody decided it on the approver's behalf.
alter table public.approval_steps
  add column if not exists decided_by uuid references public.profiles(id) on delete set null;

-- ═══════════════════════════════════════════════════════════ in force?

create or replace function public.approval_delegation_active(
  _approver    uuid,
  _delegate    uuid,
  _entity_type text,
  _org         uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select _approver is not null and _delegate is not null and _approver <> _delegate
     and exists (
       select 1 from public.approval_delegations d
        where d.delegator_id = _approver
          and d.delegate_id = _delegate
          and d.organization_id = _org
          and d.cancelled_at is null
          and public.org_today(_org) between d.from_date and d.to_date
          and (d.module_key is null
               or d.module_key = (select l.module_key from public.approval_entity_labels l
                                   where l.entity_type = _entity_type)))
     and exists (select 1 from public.profiles p
                  where p.id = _delegate and p.organization_id = _org
                    and p.is_active and p.deleted_at is null)
$$;

comment on function public.approval_delegation_active is
  'D92 — whether _delegate may act for _approver today on an approval of _entity_type in _org.';

revoke all on function public.approval_delegation_active(uuid, uuid, text, uuid) from public, anon, authenticated;

-- Reproduced from 20260729100425_approval_engine.sql. The diff: a delegate in
-- force sees what they may decide (D92).
create or replace function public.is_approver_on(_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.approval_steps s
      join public.approval_requests r on r.id = s.approval_request_id
     where s.approval_request_id = _request_id
       and s.deleted_at is null
       and (s.approver_id = (select auth.uid())
            or public.approval_delegation_active(s.approver_id, (select auth.uid()),
                                                 r.entity_type, r.organization_id))
  )
$$;


-- ═══════════════════════════════════════════════════════════ deciding

-- Reproduced from 20261018100000_a_rejection_says_why.sql. The diff: a delegate
-- in force may decide (and is refused if already signing another level), and
-- decided_by records who did.
CREATE OR REPLACE FUNCTION public.approval_decide(_request_id uuid, _decision approval_decision, _comments text DEFAULT NULL::text, _reason_code text DEFAULT NULL::text)
 RETURNS approval_status
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- A rejection says why, twice: a code a report can count, and a note the
  -- person can read. Checked before anything is looked up, so a refusal here
  -- discloses nothing about the request.
  if _decision = 'rejected' then
    if _reason_code is null or not (_reason_code = any (public.approval_reject_reasons())) then
      raise exception 'REASON_CODE_REQUIRED' using errcode = 'P0001';
    end if;
    if length(btrim(coalesce(_comments, ''))) < 3 then
      raise exception 'NOTE_REQUIRED' using errcode = 'P0001';
    end if;
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

  -- Only the approver for the level currently in play, or somebody they have
  -- handed their approvals to for today (D92). A later-level approver acting
  -- early would skip a signature the organisation asked for.
  if v_step.approver_id is distinct from v_uid then
    if not public.approval_delegation_active(v_step.approver_id, v_uid,
                                             v_request.entity_type, v_request.organization_id) then
      raise exception 'NOT_YOUR_APPROVAL' using errcode = '42501';
    end if;
    -- One person never signs twice: a delegate who signs another level of this
    -- request cannot sign this one too.
    if exists (select 1 from public.approval_steps o
                where o.approval_request_id = _request_id and o.approver_id = v_uid
                  and o.deleted_at is null) then
      raise exception 'ALREADY_SIGNING' using errcode = '42501';
    end if;
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
     set decision = _decision, comments = nullif(btrim(coalesce(_comments, '')), ''),
         reason_code = case when _decision = 'rejected' then _reason_code end,
         decided_at = now(),
         decided_by = v_uid
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
end $function$
;

-- ═══════════════════════════════════════════════════════════ the queue

drop function if exists public.approval_queue();

-- Reproduced from 20261020100000_a_request_that_waits_moves_up.sql. The diff:
-- delegated requests are in the delegate's queue, with on_behalf_of.
create or replace function public.approval_queue()
returns table (
  approval_request_id uuid,
  entity_type         text,
  entity_id           uuid,
  requester_id        uuid,
  requester_name      text,
  level               smallint,
  required_levels     smallint,
  context             jsonb,
  created_at          timestamptz,
  level_since         timestamptz,
  target_days         integer,
  escalated_from      text,
  on_behalf_of        text
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id,
         r.entity_type,
         r.entity_id,
         r.requester_id,
         coalesce(p.full_name, 'A colleague')::text,
         r.current_level,
         r.required_levels,
         r.context,
         r.created_at,
         public.approval_step_waiting_since(s.id),
         (select c.escalate_after_days from public.approval_chains c
           where c.organization_id = r.organization_id
             and c.entity_type = r.entity_type
             and c.level = r.current_level
             and c.deleted_at is null
           limit 1),
         (select coalesce(fp.full_name, 'another approver')::text
            from public.approval_escalations e
            left join public.profiles fp on fp.id = e.from_approver_id
           where e.approval_step_id = s.id and e.to_approver_id = s.approver_id
           order by e.escalated_at desc
           limit 1),
         -- D92: whose approval this is, when it is here by delegation.
         case when s.approver_id <> (select auth.uid())
              then (select coalesce(op.full_name, 'a colleague')::text
                      from public.profiles op where op.id = s.approver_id) end
    from public.approval_requests r
    join public.approval_steps s
      on s.approval_request_id = r.id
     and s.level               = r.current_level
     and s.decision            = 'pending'
     and s.deleted_at is null
    left join public.profiles p
      on p.id = r.requester_id
     and p.deleted_at is null
   where r.status = 'pending'
     and r.deleted_at is null
     and r.organization_id = public.current_org_id()
     and (s.approver_id = (select auth.uid())
          or (public.approval_delegation_active(s.approver_id, (select auth.uid()),
                                                r.entity_type, r.organization_id)
              -- Never your own request, whoever handed it to you.
              and r.requester_id <> (select auth.uid())))
   order by r.created_at
$$;

revoke all on function public.approval_queue() from public, anon;
grant execute on function public.approval_queue() to authenticated;

-- ═══════════════════════════════════════════════════════════ the timeline

drop function if exists public.approval_timeline(uuid);

-- Reproduced from 20261020100000_a_request_that_waits_moves_up.sql. The diff:
-- decided_by names who decided, when it was not the approver.
CREATE OR REPLACE FUNCTION public.approval_timeline(_approval_request_id uuid)
 RETURNS TABLE(level smallint, approver_name text, decision approval_decision, comments text, decided_at timestamp with time zone, reason_code text, escalated_from text, escalated_at timestamp with time zone, decided_by text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org uuid;
begin
  -- Tenancy first, and separately. See 20261018100000 for why.
  select organization_id into v_org
    from public.approval_requests where id = _approval_request_id;

  if v_org is null or v_org <> public.current_org_id() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- Then the same people the request itself is visible to. Restated because
  -- SECURITY DEFINER bypasses RLS and inherits nothing.
  if not (
    public.is_requester_of(_approval_request_id)
    or public.is_approver_on(_approval_request_id)
    or public.is_admin()
    -- D84: the admin of the module this request belongs to.
    or exists (
      select 1 from public.approval_requests ar
        join public.approval_entity_labels l on l.entity_type = ar.entity_type
       where ar.id = _approval_request_id
         and l.module_key is not null
         and public.is_module_admin(l.module_key)
    )
  ) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  return query
    select s.level,
           coalesce(p.full_name, 'Approver')::text,
           s.decision,
           s.comments,
           s.decided_at,
           s.reason_code,
           e.from_name,
           e.escalated_at,
           -- D92: who actually decided, when it was not the approver.
           case when s.decided_by is not null and s.decided_by <> s.approver_id
                then (select coalesce(dp.full_name, 'a colleague')::text
                        from public.profiles dp where dp.id = s.decided_by) end
      from public.approval_steps s
      left join public.profiles p on p.id = s.approver_id
      left join lateral (
        select coalesce(fp.full_name, 'another approver')::text as from_name, x.escalated_at
          from public.approval_escalations x
          left join public.profiles fp on fp.id = x.from_approver_id
         where x.approval_step_id = s.id and x.to_approver_id is not null
         order by x.escalated_at desc
         limit 1
      ) e on true
     where s.approval_request_id = _approval_request_id
       and s.deleted_at is null
       and s.organization_id = public.current_org_id()   -- tenancy, restated
     order by s.level;
end $function$
;

revoke all on function public.approval_timeline(uuid) from public, anon;
grant execute on function public.approval_timeline(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════ who is told

-- Reproduced from 20261020100000_a_request_that_waits_moves_up.sql. The diff:
-- an approver's delegate in force is told alongside them (D92), and the
-- approval.delegated event reaches the delegate through recipient_id.
create or replace function public.resolve_notification_recipients(_event_key text, _payload jsonb)
returns setof uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_request_id uuid := nullif(_payload->>'approval_request_id', '')::uuid;
  v_org        uuid := nullif(_payload->>'organization_id', '')::uuid;
begin
  if _event_key = 'approval.submitted' then
    -- The approver whose turn it is, and whoever they have handed it to (D92).
    return query select nullif(_payload->>'approver_id', '')::uuid
                  where nullif(_payload->>'approver_id', '') is not null
                 union
                 select d.delegate_id from public.approval_delegations d
                  where nullif(_payload->>'approver_id', '') is not null
                    and public.approval_delegation_active(
                          (_payload->>'approver_id')::uuid, d.delegate_id,
                          _payload->>'entity_type', d.organization_id);

  elsif _event_key = 'approval.decided' then
    -- A level was decided and the request is still open: tell whoever is next.
    -- If it closed, approval.completed covers it and this would duplicate.
    return query
      select s.approver_id
        from public.approval_steps s
        join public.approval_requests r on r.id = s.approval_request_id
       where s.approval_request_id = v_request_id
         and r.status = 'pending'
         and s.level = r.current_level
         and s.decision = 'pending'
         and s.deleted_at is null
      union
      -- D92: and whoever that approver has handed their approvals to.
      select d.delegate_id
        from public.approval_steps s
        join public.approval_requests r on r.id = s.approval_request_id
        join public.approval_delegations d on d.delegator_id = s.approver_id
       where s.approval_request_id = v_request_id
         and r.status = 'pending'
         and s.level = r.current_level
         and s.decision = 'pending'
         and s.deleted_at is null
         and public.approval_delegation_active(s.approver_id, d.delegate_id,
                                               r.entity_type, r.organization_id);

  elsif _event_key = 'approval.completed' then
    -- The person who asked. They have been waiting.
    return query select nullif(_payload->>'requester_id', '')::uuid
                  where nullif(_payload->>'requester_id', '') is not null;

  elsif _event_key = 'approval.escalated' then
    -- D87. The one it moved to, so they act; the one it moved from, so they
    -- know it has gone.
    return query
      select p.id from public.profiles p
       where p.id in (nullif(_payload->>'to_approver_id', '')::uuid,
                      nullif(_payload->>'from_approver_id', '')::uuid)
         and p.is_active and p.deleted_at is null
         and (v_org is null or p.organization_id = v_org);

  -- ── generic audiences (E7). A module says WHO in general terms; the
  --    engine works out the people, so no module names a person.
  elsif _payload->>'audience' = 'organization_admins' and v_org is not null then
    return query
      select distinct ur.user_id
        from public.user_roles ur
        join public.profiles p on p.id = ur.user_id
       where ur.organization_id = v_org
         and ur.role in ('super_admin', 'org_admin', 'hr_admin')
         and ur.deleted_at is null
         and p.organization_id = v_org and p.is_active and p.deleted_at is null;

  elsif nullif(_payload->>'recipient_id', '') is not null then
    return query
      select p.id from public.profiles p
       where p.id = (_payload->>'recipient_id')::uuid
         and p.is_active and p.deleted_at is null
         and (v_org is null or p.organization_id = v_org);
  end if;

  return;
end $$;

-- ═══════════════════════════════════════════════════════════ setting one up

create or replace function public.approval_delegate(
  _delegate_id  uuid,
  _from_date    date,
  _to_date      date,
  _module_key   text default null,
  _reason       text default null,
  _delegator_id uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_org       uuid := public.current_org_id();
  v_delegator uuid := coalesce(_delegator_id, (select auth.uid()));
  v_id        uuid;
begin
  if v_uid is null or v_org is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;
  -- For somebody else: a company admin only.
  if v_delegator <> v_uid and not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.profiles
                  where id = v_delegator and organization_id = v_org
                    and is_active and deleted_at is null) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if _delegate_id is null or _delegate_id = v_delegator then
    raise exception 'DELEGATE_TO_SELF' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.profiles
                  where id = _delegate_id and organization_id = v_org
                    and is_active and deleted_at is null)
     or not public.can_approve(_delegate_id) then
    raise exception 'DELEGATE_CANNOT_APPROVE' using errcode = 'P0001';
  end if;
  if _from_date is null or _to_date is null or _to_date < _from_date then
    raise exception 'INVALID_DATE_RANGE' using errcode = 'P0001';
  end if;
  if _from_date < public.org_today(v_org) then
    raise exception 'PAST_DATE' using errcode = 'P0001';
  end if;
  if _to_date > _from_date + 180 then
    raise exception 'DELEGATION_TOO_LONG' using errcode = 'P0001';
  end if;
  if _module_key is not null
     and not public.module_enabled_for(v_org, _module_key) then
    raise exception 'MODULE_NOT_ENABLED' using errcode = 'P0001';
  end if;

  begin
    insert into public.approval_delegations
      (organization_id, delegator_id, delegate_id, from_date, to_date, module_key, reason)
    values
      (v_org, v_delegator, _delegate_id, _from_date, _to_date, _module_key,
       nullif(btrim(coalesce(_reason, '')), ''))
    returning id into v_id;
  exception when exclusion_violation then
    raise exception 'DELEGATION_OVERLAPS' using errcode = 'P0001';
  end;

  perform public.emit_platform_event('approval.delegated', jsonb_build_object(
    'organization_id', v_org,
    'recipient_id', _delegate_id,
    'delegator_name', (select coalesce(full_name, 'A colleague') from public.profiles where id = v_delegator),
    'from_date', to_char(_from_date, 'FMDD Mon YYYY'),
    'to_date', to_char(_to_date, 'FMDD Mon YYYY'),
    'scope', coalesce((select name from public.modules where key = _module_key), 'all their approvals')));

  return v_id;
end $$;

comment on function public.approval_delegate is
  'D92 — hands the caller''s approvals (or, for a company admin, somebody else''s) to a colleague for a date range, for every module or one.';

revoke all on function public.approval_delegate(uuid, date, date, text, text, uuid) from public, anon;
grant execute on function public.approval_delegate(uuid, date, date, text, text, uuid) to authenticated;

create or replace function public.approval_delegation_cancel(_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_d   public.approval_delegations%rowtype;
begin
  select * into v_d from public.approval_delegations
   where id = _id and organization_id = public.current_org_id();
  if v_d.id is null
     or not (v_d.delegator_id = v_uid or v_d.created_by = v_uid or public.is_admin()) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  update public.approval_delegations set cancelled_at = now()
   where id = _id and cancelled_at is null;
end $$;

revoke all on function public.approval_delegation_cancel(uuid) from public, anon;
grant execute on function public.approval_delegation_cancel(uuid) to authenticated;

/** The caller's delegations, given and received, not yet over; all of them for an admin. */
create or replace function public.approval_my_delegations()
returns table (
  id             uuid,
  direction      text,
  delegator_name text,
  delegate_name  text,
  from_date      date,
  to_date        date,
  module_key     text,
  module_name    text,
  reason         text,
  in_force       boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid := public.current_org_id();
begin
  if v_uid is null or v_org is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;
  return query
    select d.id,
           case when d.delegator_id = v_uid then 'given'
                when d.delegate_id = v_uid then 'received'
                else 'others' end,
           coalesce(a.full_name, a.email)::text,
           coalesce(b.full_name, b.email)::text,
           d.from_date, d.to_date, d.module_key,
           m.name::text, d.reason,
           public.org_today(v_org) between d.from_date and d.to_date
      from public.approval_delegations d
      join public.profiles a on a.id = d.delegator_id
      join public.profiles b on b.id = d.delegate_id
      left join public.modules m on m.key = d.module_key
     where d.organization_id = v_org and d.cancelled_at is null
       and d.to_date >= public.org_today(v_org)
       and (d.delegator_id = v_uid or d.delegate_id = v_uid or public.is_admin())
     order by d.from_date;
end $$;

revoke all on function public.approval_my_delegations() from public, anon;
grant execute on function public.approval_my_delegations() to authenticated;

/** Who approvals can be handed to: active colleagues able to approve. */
create or replace function public.approval_delegate_candidates()
returns table (id uuid, full_name text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, coalesce(p.full_name, p.email)::text
    from public.profiles p
   where p.organization_id = public.current_org_id()
     and p.is_active and p.deleted_at is null
     and p.id <> (select auth.uid())
     and public.can_approve(p.id)
   order by 2
$$;

revoke all on function public.approval_delegate_candidates() from public, anon;
grant execute on function public.approval_delegate_candidates() to authenticated;

insert into public.notification_templates
  (organization_id, event_key, channel, subject_template, body_template)
select null::uuid, v.event_key, v.channel, v.subject, v.body
  from (values
    ('approval.delegated'::text, 'email'::public.notification_channel,
     '{{ delegator_name }} has handed you their approvals'::text,
     '<p>{{ delegator_name }} has asked you to approve on their behalf from {{ from_date }} to {{ to_date }}: {{ scope }}.</p>'
     '<p>Their requests will appear in your Approvals, marked as theirs. Sign in to Neuvto to see them.</p>'::text)
  ) as v(event_key, channel, subject, body)
 where not exists (
   select 1 from public.notification_templates t
    where t.organization_id is null and t.event_key = v.event_key and t.channel = v.channel
      and t.deleted_at is null);
