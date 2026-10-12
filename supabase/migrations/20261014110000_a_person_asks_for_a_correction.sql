-- ============================================================================
-- NEUVTO WOS — "Request a change" (E7, NEUVTO_EMPLOYEE_MASTER §5)
-- ============================================================================
--
-- §5 gives a person "read, request change" on their own contact details,
-- emergency contact, addresses, family and nominees. Only an Admin writes the
-- record (E7), so a person's route to a correction is a request an Admin acts
-- on. Deliberately not an automatic apply: an address change closes a row
-- forever (rule 2), and a nominee change produces the form a claim is settled
-- against, so a person checks what they asked for and an Admin makes it.
--
--   employee_request_change(id, section, details)   the person, about themselves
--   employee_change_requests(status)                 an Admin: everybody's;
--                                                     anybody else: their own
--   employee_resolve_change(id, outcome, note)       an Admin closes it
--
-- Two notifications. The engine names the recipients (D26), so the platform
-- gains two GENERIC audiences rather than learning this module's event names:
-- `audience = 'organization_admins'` and `recipient_id`.
-- ============================================================================

create table public.employee_change_requests (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  employee_id     uuid not null references public.employees(id) on delete cascade,
  requested_by    uuid references auth.users(id) on delete set null,
  section         text not null check (section in
                    ('contact', 'emergency_contact', 'address', 'family', 'nominees', 'other')),
  details         text not null check (length(btrim(details)) between 3 and 2000),
  status          text not null default 'open' check (status in ('open', 'done', 'declined')),
  resolution_note text,
  resolved_by     uuid references auth.users(id) on delete set null,
  resolved_at     timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint employee_change_requests_resolved_whole
    check ((status = 'open') = (resolved_at is null))
);
create index idx_employee_change_requests_open
  on public.employee_change_requests (organization_id, created_at) where status = 'open';
create index idx_employee_change_requests_employee
  on public.employee_change_requests (employee_id, created_at desc);

create trigger set_audit_fields before insert or update on public.employee_change_requests
  for each row execute function public.set_audit_fields();
create trigger write_audit_log after insert or update or delete on public.employee_change_requests
  for each row execute function public.write_audit_log();
create trigger same_organisation before insert or update on public.employee_change_requests
  for each row execute function public.tf_restricted_same_org();

alter table public.employee_change_requests enable row level security;
revoke all on public.employee_change_requests from anon, authenticated;

-- ═══════════════════════════════════════════════════════════ ask

create or replace function public.employee_request_change(
  _employee_id uuid,
  _section     text,
  _details     text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_rel  text[] := public.restricted_target(_employee_id);
  v_org  uuid := public.current_org_id();
  v_uid  uuid := (select auth.uid());
  v_id   uuid;
begin
  if not ('self' = any (v_rel)) then
    raise exception 'FORBIDDEN' using errcode = '42501',
      hint = 'A change request is about your own record.';
  end if;
  if length(btrim(coalesce(_details, ''))) < 3 then
    raise exception 'DETAILS_REQUIRED' using errcode = 'P0001';
  end if;
  -- A ceiling, so a stuck button cannot fill an Admin's inbox.
  if (select count(*) from public.employee_change_requests
       where employee_id = _employee_id and status = 'open') >= 10 then
    raise exception 'TOO_MANY_OPEN_REQUESTS' using errcode = 'P0001';
  end if;

  begin
    insert into public.employee_change_requests (organization_id, employee_id, requested_by, section, details)
    values (v_org, _employee_id, v_uid, _section, btrim(_details))
    returning id into v_id;
  exception when check_violation then
    raise exception 'INVALID_VALUE' using errcode = 'P0001';
  end;

  perform public.emit_platform_event('employee.change_requested', jsonb_build_object(
    'organization_id', v_org,
    'audience',        'organization_admins',
    'person_name',     (select coalesce(full_name, email) from public.profiles where id = v_uid),
    'section',         replace(_section, '_', ' ')
  ));
  return v_id;
end $$;

comment on function public.employee_request_change is
  'E7 — a person asks an Admin to correct their own record. Tells the company''s admins. Nothing changes until an Admin makes the change.';

revoke all on function public.employee_request_change(uuid, text, text) from public, anon;
grant execute on function public.employee_request_change(uuid, text, text) to authenticated;

-- ═══════════════════════════════════════════════════════════ read

create or replace function public.employee_change_requests(_status text default 'open')
returns table (
  id uuid, employee_id uuid, employee_name text, section text, details text, status text,
  resolution_note text, resolved_by_name text, resolved_at timestamptz, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org   uuid := public.current_org_id();
  v_uid   uuid := (select auth.uid());
  v_admin boolean;
begin
  if v_uid is null or v_org is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;
  if not public.module_enabled_for(v_org, 'employee') then
    raise exception 'MODULE_NOT_ENABLED' using errcode = 'P0001';
  end if;
  v_admin := public.is_admin();
  return query
    select c.id, c.employee_id, coalesce(p.full_name, p.email), c.section, c.details, c.status,
           c.resolution_note, (select coalesce(rp.full_name, rp.email) from public.profiles rp where rp.id = c.resolved_by),
           c.resolved_at, c.created_at
      from public.employee_change_requests c
      join public.employees e on e.id = c.employee_id
      left join public.profiles p on p.id = e.profile_id
     where c.organization_id = v_org
       and (_status is null or c.status = _status)
       -- An Admin sees everybody's; anybody else, only their own.
       and (v_admin or e.profile_id = v_uid)
     order by c.created_at desc
     limit 500;
end $$;

revoke all on function public.employee_change_requests(text) from public, anon;
grant execute on function public.employee_change_requests(text) to authenticated;

-- ═══════════════════════════════════════════════════════════ close

create or replace function public.employee_resolve_change(_request_id uuid, _outcome text, _note text default null)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_req public.employee_change_requests%rowtype;
  v_org uuid := public.current_org_id();
begin
  select * into v_req from public.employee_change_requests
   where id = _request_id and organization_id = v_org;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  perform public.employee_require_admin(v_req.employee_id);
  if _outcome not in ('done', 'declined') then
    raise exception 'INVALID_VALUE' using errcode = 'P0001';
  end if;
  if v_req.status <> 'open' then
    raise exception 'ALREADY_RESOLVED' using errcode = 'P0001';
  end if;
  -- Declining without saying why leaves the person guessing.
  if _outcome = 'declined' and length(btrim(coalesce(_note, ''))) < 3 then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;

  update public.employee_change_requests
     set status = _outcome, resolution_note = nullif(btrim(_note), ''),
         resolved_by = (select auth.uid()), resolved_at = now()
   where id = _request_id;

  perform public.emit_platform_event('employee.change_resolved', jsonb_build_object(
    'organization_id', v_org,
    'recipient_id',    v_req.requested_by,
    'section',         replace(v_req.section, '_', ' '),
    'outcome',         case _outcome when 'done' then 'made' else 'declined' end,
    'note',            coalesce(nullif(btrim(_note), ''), 'No note was added.')
  ));
end $$;

revoke all on function public.employee_resolve_change(uuid, text, text) from public, anon;
grant execute on function public.employee_resolve_change(uuid, text, text) to authenticated;

-- ═══════════════════════════════════════════════════════════ the engine
--
-- Reproduced from 20260730140000_notification_engine.sql, which it replaces.
-- The diff is the two generic audiences at the end: no module's event name.

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

-- ═══════════════════════════════════════════════════════════ the words

insert into public.notification_templates
  (organization_id, event_key, channel, subject_template, body_template)
select null::uuid, v.event_key, v.channel, v.subject, v.body
  from (values
    ('employee.change_requested'::text, 'email'::public.notification_channel,
     '{{ person_name }} asked for a change to their record'::text,
     '<p><strong>{{ person_name }}</strong> asked for a change to their {{ section }}.</p>'
     '<p>Sign in to Neuvto and open Employees, then Change requests, to see what they asked for and make it.</p>'::text),
    ('employee.change_resolved', 'email',
     'Your change request was {{ outcome }}',
     '<p>The change you asked for to your {{ section }} was {{ outcome }}.</p>'
     '<p>{{ note }}</p>'
     '<p>Sign in to Neuvto to see your record.</p>')
  ) as v(event_key, channel, subject, body)
 where not exists (
   select 1 from public.notification_templates t
    where t.organization_id is null and t.event_key = v.event_key and t.channel = v.channel
      and t.deleted_at is null);
