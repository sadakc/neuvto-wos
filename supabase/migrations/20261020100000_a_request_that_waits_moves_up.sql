-- ============================================================================
-- NEUVTO WOS — a request that waits past its target moves up (D87)
-- ============================================================================
--
-- escalate_after_days has been on every chain level since step 4, and nothing
-- ever read it. Approvals said so honestly ("over the 2-day target") and never
-- promised an escalation. This is the escalation.
--
-- WHAT HAPPENS WHEN THE TARGET PASSES (D87)
--
--   The level's approval moves to somebody above the approver, chosen in this
--   order, the first who qualifies:
--     1. the approver's own reporting manager;
--     2. an administrator of the module the request belongs to (D84), named by
--        the module's own approval_entity_labels row, never here (D30);
--     3. a company administrator (Super Admin, Admin, HR Admin).
--   To qualify they must be active in the same company, able to approve at all
--   (D57), not the person who asked (D13), and not already signing any level of
--   this request: one person never signs twice.
--
--   The old approver and the new are both told. The clock restarts, so a
--   request still waiting after another full target moves up again.
--
--   If nobody qualifies, nothing moves and the company's administrators are
--   told the request is stuck. It is asked again after another full target.
--
--   NEVER AUTO-APPROVED, NEVER AUTO-REJECTED. The engine has refused to approve
--   by default since step 4; waiting does not change that.
--
-- Platform, not Leave: every module's approvals escalate the same way.
-- Calendar days, measured from when the request reached its level (or last
-- moved up), as the target always was.
--
-- Scheduled here, in a migration (D43): every fifteen minutes.
-- ============================================================================

create table if not exists public.approval_escalations (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  approval_request_id uuid not null references public.approval_requests(id) on delete cascade,
  approval_step_id    uuid not null references public.approval_steps(id) on delete cascade,
  level               smallint not null,
  from_approver_id    uuid not null references public.profiles(id) on delete restrict,
  -- Null: nobody qualified, the administrators were told, nothing moved.
  to_approver_id      uuid references public.profiles(id) on delete restrict,
  waited_days         integer not null check (waited_days > 0),
  escalated_at        timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  constraint escalation_moves_somewhere_else check (to_approver_id is distinct from from_approver_id)
);

create index if not exists idx_escalations_step
  on public.approval_escalations (approval_step_id, escalated_at desc);

comment on table public.approval_escalations is
  'D87 — every time a waiting approval moved up, or could not. Read through approval_timeline() and approval_queue(); no direct access.';

-- Read only through the functions below, which restate who may see a request.
alter table public.approval_escalations enable row level security;
revoke all on public.approval_escalations from anon, authenticated;

drop trigger if exists write_audit_log on public.approval_escalations;
create trigger write_audit_log after insert or update or delete on public.approval_escalations
  for each row execute function public.write_audit_log();

-- ═══════════════════════════════════════════════════════════ when a level began

/**
 * When the step's current wait began: the last time it moved up, else when the
 * request reached its level (the previous level's decision, or when raised).
 */
create or replace function public.approval_step_waiting_since(_step_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select greatest(
           coalesce((select max(prev.decided_at) from public.approval_steps prev
                      where prev.approval_request_id = s.approval_request_id
                        and prev.level < s.level
                        and prev.deleted_at is null), r.created_at),
           coalesce((select max(e.escalated_at) from public.approval_escalations e
                      where e.approval_step_id = s.id), '-infinity'::timestamptz))
    from public.approval_steps s
    join public.approval_requests r on r.id = s.approval_request_id
   where s.id = _step_id
$$;

revoke all on function public.approval_step_waiting_since(uuid) from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════ who it moves to

create or replace function public.approval_escalation_target(_step_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_step    public.approval_steps;
  v_request public.approval_requests;
  v_module  text;
  v_cand    uuid;
begin
  select * into v_step from public.approval_steps where id = _step_id;
  select * into v_request from public.approval_requests where id = v_step.approval_request_id;
  select module_key into v_module from public.approval_entity_labels
   where entity_type = v_request.entity_type;

  for v_cand in
   select cand from (
    -- 1. the approver's own manager
    select p.manager_id as cand, 1 as rank, null::timestamptz as since, null::uuid as tiebreak
      from public.profiles p
     where p.id = v_step.approver_id and p.manager_id is not null
    union all
    -- 2. the module's administrators, longest-standing first
    select ma.user_id, 2, ma.created_at, ma.user_id
      from public.module_admins ma
     where v_module is not null
       and ma.organization_id = v_request.organization_id
       and ma.module_key = v_module
       and ma.deleted_at is null
    union all
    -- 3. the company's administrators
    select ur.user_id, 3, ur.created_at, ur.user_id
      from public.user_roles ur
     where ur.organization_id = v_request.organization_id
       and ur.role in ('super_admin', 'org_admin', 'hr_admin')
       and ur.deleted_at is null
   ) c
   order by c.rank, c.since nulls first, c.tiebreak
  loop
    if exists (
      select 1 from public.profiles c
       where c.id = v_cand
         and c.organization_id = v_request.organization_id
         and c.is_active and c.deleted_at is null)
       and public.can_approve(v_cand)
       and v_cand <> v_request.requester_id
       and not exists (select 1 from public.approval_steps o
                        where o.approval_request_id = v_request.id
                          and o.approver_id = v_cand
                          and o.deleted_at is null)
    then
      return v_cand;
    end if;
  end loop;
  return null;
end $$;

comment on function public.approval_escalation_target is
  'D87 — who a waiting approval moves to: the approver''s manager, else the module''s admin, else a company admin; active, able to approve, not the requester, not already on the request.';

revoke all on function public.approval_escalation_target(uuid) from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════ the sweep

create or replace function public.approval_escalate_due()
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_row    record;
  v_to     uuid;
  v_waited integer;
  v_moved  integer := 0;
begin
  for v_row in
    select r.id as request_id, r.organization_id, r.entity_type, r.entity_id,
           r.requester_id, s.id as step_id, s.level, s.approver_id,
           c.escalate_after_days as target,
           public.approval_step_waiting_since(s.id) as since
      from public.approval_requests r
      join public.approval_steps s
        on s.approval_request_id = r.id
       and s.level = r.current_level
       and s.decision = 'pending'
       and s.deleted_at is null
      join public.approval_chains c
        on c.organization_id = r.organization_id
       and c.entity_type = r.entity_type
       and c.level = r.current_level
       and c.deleted_at is null
     where r.status = 'pending'
       and r.deleted_at is null
       and c.escalate_after_days is not null
       for update of r, s skip locked
  loop
    continue when v_row.since + make_interval(days => v_row.target) > now();

    v_waited := greatest(1, floor(extract(epoch from now() - v_row.since) / 86400)::int);
    v_to := public.approval_escalation_target(v_row.step_id);

    insert into public.approval_escalations
      (organization_id, approval_request_id, approval_step_id, level,
       from_approver_id, to_approver_id, waited_days)
    values
      (v_row.organization_id, v_row.request_id, v_row.step_id, v_row.level,
       v_row.approver_id, v_to, v_waited);

    if v_to is not null then
      update public.approval_steps
         set approver_id = v_to
       where id = v_row.step_id and decision = 'pending';
      v_moved := v_moved + 1;

      perform public.emit_platform_event('approval.escalated', jsonb_build_object(
        'organization_id', v_row.organization_id,
        'approval_request_id', v_row.request_id,
        'entity_type', v_row.entity_type,
        'entity_id', v_row.entity_id,
        'level', v_row.level,
        'from_approver_id', v_row.approver_id,
        'to_approver_id', v_to,
        'from_name', (select coalesce(full_name, 'the approver') from public.profiles where id = v_row.approver_id),
        'to_name', (select coalesce(full_name, 'the next approver') from public.profiles where id = v_to),
        'waited_days', v_waited
      ));
    else
      perform public.emit_platform_event('approval.escalation_stuck', jsonb_build_object(
        'organization_id', v_row.organization_id,
        'audience', 'organization_admins',
        'approval_request_id', v_row.request_id,
        'entity_type', v_row.entity_type,
        'entity_id', v_row.entity_id,
        'level', v_row.level,
        'from_name', (select coalesce(full_name, 'the approver') from public.profiles where id = v_row.approver_id),
        'waited_days', v_waited
      ));
    end if;
  end loop;
  return v_moved;
end $$;

comment on function public.approval_escalate_due is
  'D87 — moves every approval waiting past its level''s target up one, or tells the administrators nobody qualifies. Never decides anything. Scheduled every 15 minutes.';

revoke all on function public.approval_escalate_due() from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════ who is told

-- Reproduced from 20261014110000_a_person_asks_for_a_correction.sql. The diff:
-- the approval.escalated branch.
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
    -- The approver whose turn it is.
    return query select nullif(_payload->>'approver_id', '')::uuid
                  where nullif(_payload->>'approver_id', '') is not null;

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
         and s.deleted_at is null;

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

insert into public.notification_templates
  (organization_id, event_key, channel, subject_template, body_template)
select null::uuid, v.event_key, v.channel, v.subject, v.body
  from (values
    ('approval.escalated'::text, 'email'::public.notification_channel,
     'A {{ entity_label }} has moved to {{ to_name }}'::text,
     '<p>A {{ entity_label }} waited {{ waited_days }} days for {{ from_name }} at level {{ level }}, '
     'longer than the company allows, and has moved to <strong>{{ to_name }}</strong> to decide.</p>'
     '<p>Sign in to Neuvto to see it.</p>'::text),
    ('approval.escalation_stuck', 'email',
     'A {{ entity_label }} has waited {{ waited_days }} days with nobody to move it to',
     '<p>A {{ entity_label }} has waited {{ waited_days }} days for {{ from_name }} at level {{ level }}, '
     'longer than the company allows, and there is nobody above them who can take it.</p>'
     '<p>Sign in to Neuvto and check the approval chain, or ask {{ from_name }} to decide it.</p>')
  ) as v(event_key, channel, subject, body)
 where not exists (
   select 1 from public.notification_templates t
    where t.organization_id is null and t.event_key = v.event_key and t.channel = v.channel
      and t.deleted_at is null);

-- ═══════════════════════════════════════════════════════════ the queue

drop function if exists public.approval_queue();

-- Reproduced from 20261018100000_a_rejection_says_why.sql. The diff:
-- level_since counts from the last move up, and escalated_from names who it
-- came from.
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
  escalated_from      text
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
           limit 1)
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
     and s.approver_id = (select auth.uid())
   order by r.created_at
$$;

revoke all on function public.approval_queue() from public, anon;
grant execute on function public.approval_queue() to authenticated;

-- ═══════════════════════════════════════════════════════════ the timeline

drop function if exists public.approval_timeline(uuid);

-- Reproduced from 20261018100000_a_rejection_says_why.sql. The diff: each level
-- says whether it moved up, from whom, and when.
CREATE OR REPLACE FUNCTION public.approval_timeline(_approval_request_id uuid)
 RETURNS TABLE(level smallint, approver_name text, decision approval_decision, comments text, decided_at timestamp with time zone, reason_code text, escalated_from text, escalated_at timestamp with time zone)
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
           e.escalated_at
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

-- ═══════════════════════════════════════════════════════════ the schedule (D43)

do $$
begin
  perform cron.unschedule('neuvto-escalate-approvals')
    where exists (select 1 from cron.job where jobname = 'neuvto-escalate-approvals');
  perform cron.schedule(
    'neuvto-escalate-approvals',
    '*/15 * * * *',
    $job$select public.approval_escalate_due()$job$
  );
end $$;
