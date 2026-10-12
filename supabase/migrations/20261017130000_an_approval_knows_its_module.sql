-- ============================================================================
-- NEUVTO WOS — an approval type says which module it belongs to (D84)
-- ============================================================================
--
-- approval_timeline() let in the requester, the approvers and any company-wide
-- Admin. A Leave Admin, who can open any leave request's detail, was refused
-- its approval history, because the platform's approval engine has no idea
-- which module a request comes from, and must not learn it by name (D30).
--
-- So each module's approval_entity_labels row, which it already registers in
-- its own migration, now also names its module. The timeline lets in whoever
-- administers that module. A type with no module named lets in nobody new.
-- ============================================================================

alter table public.approval_entity_labels
  add column if not exists module_key text references public.modules(key) on delete restrict;

comment on column public.approval_entity_labels.module_key is
  'D84 — the module this approval type belongs to, set by that module''s own migration. Its admins may read the approval history.';

-- Reproduced from the live definition (pg_get_functiondef). The diff is the
-- module-admin clause in the entitlement test; tenancy is still checked first
-- and on its own.
CREATE OR REPLACE FUNCTION public.approval_timeline(_approval_request_id uuid)
 RETURNS TABLE(level smallint, approver_name text, decision approval_decision, comments text, decided_at timestamp with time zone)
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
           s.decided_at
      from public.approval_steps s
      left join public.profiles p on p.id = s.approver_id
     where s.approval_request_id = _approval_request_id
       and s.deleted_at is null
       and s.organization_id = public.current_org_id()   -- tenancy, restated
     order by s.level;
end $function$
;

