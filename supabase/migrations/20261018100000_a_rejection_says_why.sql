-- ============================================================================
-- NEUVTO WOS — a rejection says why; approve several at once; how long a
-- request has waited at its level (Leave phase 2, contained items)
-- ============================================================================
--
-- Platform, not Leave: the approval engine knows nothing about what it carries
-- (D30), and every module's approvals get these.
--
--   1. REJECTING NEEDS A REASON CODE AND A NOTE. approval_steps.reason_code,
--      from approval_reject_reasons(); the note is the existing comments, now
--      required (three characters or more) on a rejection. Approving needs
--      neither. approval_timeline() returns the code.
--   2. APPROVE SELECTED. approval_decide_many(ids) approves each through
--      approval_decide(), so every rule is the same one, and reports each
--      outcome separately: one refusal does not undo the others. Approve only:
--      a rejection needs its own reason.
--   3. HOW LONG IT HAS WAITED. approval_queue() gains level_since (when the
--      request reached its current level) and target_days (that level's
--      escalate_after_days). NOTHING ESCALATES: the column has existed since
--      step 4 with no job reading it. The screen therefore says "waiting N
--      days, over the M-day target", never "escalates in", which would be a
--      promise nothing keeps. Automatic escalation is its own decision.
-- ============================================================================

alter table public.approval_steps
  add column if not exists reason_code text;

create or replace function public.approval_reject_reasons()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array['business_need', 'insufficient_notice', 'policy', 'documents_missing', 'other']
$$;

comment on function public.approval_reject_reasons is
  'Reason codes a rejection may carry. Labels are the screen''s; the codes are what a report counts.';

grant execute on function public.approval_reject_reasons() to authenticated;

alter table public.approval_steps drop constraint if exists approval_steps_reason_code_known;
alter table public.approval_steps add constraint approval_steps_reason_code_known
  check (reason_code is null or reason_code in
         ('business_need', 'insufficient_notice', 'policy', 'documents_missing', 'other'));

-- ═══════════════════════════════════════════════════════════ deciding

drop function if exists public.approval_decide(uuid, public.approval_decision, text);

-- Reproduced from the live definition. The diff: _reason_code, the two checks
-- after INVALID_DECISION, and what the step row stores.
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
     set decision = _decision, comments = nullif(btrim(coalesce(_comments, '')), ''),
         reason_code = case when _decision = 'rejected' then _reason_code end,
         decided_at = now()
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


revoke all on function public.approval_decide(uuid, public.approval_decision, text, text) from public, anon;
grant execute on function public.approval_decide(uuid, public.approval_decision, text, text) to authenticated;

/**
 * Approves each request through approval_decide(), each in its own
 * subtransaction, and says what happened to each. A refusal (not yours, already
 * decided, your own request) is reported for that one and the rest go ahead.
 */
create or replace function public.approval_decide_many(_request_ids uuid[])
returns table (approval_request_id uuid, status text, error text)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;
  if _request_ids is null or cardinality(_request_ids) = 0 then
    return;
  end if;
  if cardinality(_request_ids) > 100 then
    raise exception 'TOO_MANY' using errcode = 'P0001', hint = 'Approve at most 100 at a time.';
  end if;
  foreach v_id in array (select array_agg(distinct x) from unnest(_request_ids) x) loop
    approval_request_id := v_id;
    begin
      status := public.approval_decide(v_id, 'approved', null, null)::text;
      error := null;
    exception when others then
      status := null;
      error := split_part(sqlerrm, ':', 1);
    end;
    return next;
  end loop;
end $$;

comment on function public.approval_decide_many is
  'Approves several requests, each through approval_decide() in its own subtransaction; one row per request saying what happened.';

revoke all on function public.approval_decide_many(uuid[]) from public, anon;
grant execute on function public.approval_decide_many(uuid[]) to authenticated;

-- ═══════════════════════════════════════════════════════════ the queue

drop function if exists public.approval_queue();

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
  target_days         integer
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
         -- When it reached this level: the previous level's decision, or when
         -- it was raised.
         coalesce((select max(prev.decided_at) from public.approval_steps prev
                    where prev.approval_request_id = r.id
                      and prev.level < r.current_level
                      and prev.deleted_at is null), r.created_at),
         (select c.escalate_after_days from public.approval_chains c
           where c.organization_id = r.organization_id
             and c.entity_type = r.entity_type
             and c.level = r.current_level
             and c.deleted_at is null
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

-- Reproduced from 20261017130000_an_approval_knows_its_module.sql. The diff:
-- reason_code is returned.
CREATE OR REPLACE FUNCTION public.approval_timeline(_approval_request_id uuid)
 RETURNS TABLE(level smallint, approver_name text, decision approval_decision, comments text, decided_at timestamp with time zone, reason_code text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org uuid;
begin
  -- Tenancy first, and separately.
  --
  -- is_admin() answers "does this person hold an admin role", NOT "in this
  -- organisation" — every RLS policy pairs it with an organization_id check for
  -- exactly that reason. Written here as an alternative rather than a conjunct,
  -- it let an admin of ANY tenant through the gate. The row filter below meant
  -- they saw nothing, so no data escaped; they simply got an empty list instead
  -- of a refusal. A gate that opens for the wrong people and relies on the next
  -- filter to save it is one edit away from being a leak.
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
    -- D84: the admin of the module this request belongs to. The module is
    -- named by the module's own approval_entity_labels row, never here (D30).
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
           s.reason_code
      from public.approval_steps s
      left join public.profiles p on p.id = s.approver_id
     where s.approval_request_id = _approval_request_id
       and s.deleted_at is null
       and s.organization_id = public.current_org_id()   -- tenancy, restated
     order by s.level;
end $function$
;


revoke all on function public.approval_timeline(uuid) from public, anon;
grant execute on function public.approval_timeline(uuid) to authenticated;
