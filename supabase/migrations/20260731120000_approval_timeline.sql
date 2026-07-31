-- ============================================================================
-- NEUVTO WOS — who is sitting on my request
--
-- An employee can read the approval steps for their own request
-- (is_requester_of), but not the approver's profile — an employee sees only
-- their own. So the timeline rendered "Level 1 Approver" instead of "Level 1
-- Mark Manager", and "waiting on Approver" tells somebody nothing they can act
-- on. Found by opening the screen, not by any assertion.
--
-- D35 — the fix discloses exactly one thing more: the NAME of a person who has
-- to decide on your request, and only to people already entitled to see that
-- request. Widening the profiles policy so employees can read approvers'
-- profiles would hand over email, joined date, manager and department as well,
-- to solve a question about a name.
-- ============================================================================

create or replace function public.approval_timeline(_approval_request_id uuid)
returns table (
  level         smallint,
  approver_name text,
  decision      public.approval_decision,
  comments      text,
  decided_at    timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
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
  ) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  return query
    select s.level,
           coalesce(p.full_name, 'Approver')::text,
           s.decision,
           s.comments,
           s.decided_at
      from public.approval_steps s
      left join public.profiles p on p.id = s.approver_id
     where s.approval_request_id = _approval_request_id
       and s.deleted_at is null
       and s.organization_id = public.current_org_id()   -- tenancy, restated
     order by s.level;
end $$;

comment on function public.approval_timeline is
  'D35 — approval steps with the approver''s name, for people already entitled to see the request. Discloses the name and nothing else about them.';

grant execute on function public.approval_timeline(uuid) to authenticated;
