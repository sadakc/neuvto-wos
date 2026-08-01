-- ============================================================================
-- NEUVTO WOS — what is waiting on me, and who it is from
--
-- Two problems, one function.
--
-- ── 1. A LEVEL-2 APPROVER CANNOT SEE WHO THEY ARE APPROVING
--
-- is_manager_of() is direct-reports-only. The ACME chain routes level 2 to
-- manager_of_manager above three days, so a four-day request from Ravi lands on
-- Dan Director — who is a manager, not an admin, and not Ravi's manager. Dan can
-- read the leave_requests row (is_approver_on is in that policy) and the
-- approval steps, and can read neither Ravi's profile nor Ravi's balance. He
-- would be shown an unnamed request, for an unknown balance, and asked to decide.
--
-- D35 settled the mirror image of this: an employee could not see the name of
-- the person sitting on their request, and the fix disclosed the NAME through a
-- function rather than widening the profiles policy — which would have handed
-- over email, joined date, manager and department to answer a question about a
-- name. The same reasoning, the same shape, the other direction.
--
-- NO RLS POLICY IS WIDENED BY THIS MIGRATION.
--
-- ── 2. approval_pending_for() LET ANY EMPLOYEE READ ANY COLLEAGUE'S QUEUE
--
-- It is SECURITY DEFINER, granted to authenticated, and took the user whose
-- queue to return AS AN ARGUMENT:
--
--     approval_pending_for(_user_id uuid default null)
--
-- Every caller in this repository passed nothing, so it behaved as "my queue"
-- and read that way for four build steps. Nothing stopped anybody passing
-- somebody else's id, and an employee knows at least one: manager_id is on their
-- own profile.
--
-- Demonstrated on the seed before this was written. As Priya, an ordinary
-- employee holding no management role:
--
--     select context from approval_pending_for('<Mark, her manager>');
--     → {"employee_id": "<Ravi>", "working_days": 2, "leave_type_id": "..."}
--
-- Ravi's leave request, read by a colleague with no part in it. It returns
-- setof approval_requests, so the whole row goes with it.
--
-- The harness called this function three times and passed an argument on none
-- of them. An optional parameter that every caller omits is a parameter nobody
-- tests, and this one was the entire authorisation decision.
--
-- approval_queue() takes NO parameter. The caller's own identity is the only
-- identity it will answer for, which is not a rule that can be forgotten at a
-- call site.
-- ============================================================================

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
  created_at          timestamptz
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
         -- The disclosure, and the whole of it. Not the profile, not the email,
         -- not the department: the name of somebody whose request you have been
         -- asked to decide.
         coalesce(p.full_name, 'A colleague')::text,
         r.current_level,
         r.required_levels,
         r.context,
         r.created_at
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
     -- The authorisation, inlined rather than parameterised. auth.uid() is null
     -- for an unauthenticated caller and this comparison is then never true, so
     -- the empty set is the safe default rather than an accident.
     and s.approver_id = (select auth.uid())
   order by r.created_at
$$;

comment on function public.approval_queue is
  'Approvals waiting on the CALLER, with the requester''s name and nothing else about them (D35). Takes no user id, deliberately — see the migration header.';

grant execute on function public.approval_queue() to authenticated;

-- ═══════════════════════════════════════════════════════ the old one goes
--
-- Dropped rather than kept alongside. Two functions answering "what is waiting
-- on me", one of which cannot name the requester and will answer for anybody, is
-- the module_enabled / module_enabled_for shape from D44 — the insufficient one
-- stays reachable and something eventually calls it.
--
-- Nothing in src/ ever called it; its three harness call sites move across.
drop function if exists public.approval_pending_for(uuid);

-- ═══════════════════════════════════════════════════════ a note on modules
--
-- This function names no module and filters by none. entity_type is an opaque
-- string here; the screen looks up whichever module registered a view for it.
--
-- Deliberately, a request whose module has since been switched off still
-- appears. It was legitimately raised, somebody is still waiting on it, and a
-- disabled module must not turn a pending decision into a row that silently
-- vanishes from the one screen that would have surfaced it. The queue renders
-- it through a neutral fallback instead.
