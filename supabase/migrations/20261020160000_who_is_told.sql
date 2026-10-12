-- ============================================================================
-- NEUVTO WOS — who is told of what, set by the company (D93)
-- ============================================================================
--
-- Leave phase 2, criterion 9: "an event-by-recipient matrix with mandatory rows
-- locked, and custom recipients scoped to a department".
--
--   THE MATRIX. For each of a module's approval events (a request raised, a
--   decision reached, a request moved up) and each audience (the approver,
--   the person who asked, their manager, the module's admins):
--     - MANDATORY, and shown locked: the approver is told a request needs
--       them; the person who asked is told the outcome; both approvers are told
--       when a request moves up (D87). These are the engine's own rules,
--       unchanged, and cannot be switched off.
--     - OPTIONAL, off until the module's admin switches it on: everything else.
--
--   CUSTOM RECIPIENTS. Named people told of an event as well, for every
--   request or only for requests from people in one department.
--
--   THE WORDING. An optional copy is "for your information" and has its own
--   template (event_key || '_fyi'): an admin told of a request must never read
--   "needs your approval". Nobody receives both: somebody already told by the
--   mandatory rule gets no copy.
--
-- Platform: the matrix is keyed by entity type, so every module's approvals
-- can use it. Each module's admin sets their own module's rows (D84).
-- ============================================================================

create table if not exists public.notification_rules (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_type     text not null,
  event_key       text not null check (event_key in ('approval.submitted', 'approval.completed', 'approval.escalated')),
  audience        text not null check (audience in ('requester', 'requester_manager', 'module_admins')),
  enabled         boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  -- The person who asked always hears the outcome; that is not a choice.
  constraint rule_not_a_mandatory_one check (not (event_key = 'approval.completed' and audience = 'requester')),
  unique (organization_id, entity_type, event_key, audience)
);

create table if not exists public.notification_custom_recipients (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_type     text not null,
  event_key       text not null check (event_key in ('approval.submitted', 'approval.completed', 'approval.escalated')),
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  -- Null: every request. Otherwise only requests from people in this department.
  department_id   uuid references public.departments(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null
);

create unique index if not exists uq_custom_recipient
  on public.notification_custom_recipients
     (organization_id, entity_type, event_key, profile_id, coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid));

create trigger set_audit_fields before insert or update on public.notification_rules
  for each row execute function public.set_audit_fields();
create trigger write_audit_log after insert or update or delete on public.notification_rules
  for each row execute function public.write_audit_log();
create trigger set_audit_fields before insert or update on public.notification_custom_recipients
  for each row execute function public.set_audit_fields();
create trigger write_audit_log after insert or update or delete on public.notification_custom_recipients
  for each row execute function public.write_audit_log();

alter table public.notification_rules enable row level security;
alter table public.notification_custom_recipients enable row level security;
revoke all on public.notification_rules, public.notification_custom_recipients from anon, authenticated;

-- ═══════════════════════════════════════════════════════════ who gets a copy

create or replace function public.resolve_notification_fyi(_event_key text, _payload jsonb)
returns setof uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_req    public.approval_requests%rowtype;
  v_module text;
  v_dept   uuid;
  v_mgr    uuid;
begin
  if _event_key not in ('approval.submitted', 'approval.completed', 'approval.escalated') then
    return;
  end if;
  select * into v_req from public.approval_requests
   where id = nullif(_payload->>'approval_request_id', '')::uuid;
  if v_req.id is null then return; end if;
  select module_key into v_module from public.approval_entity_labels where entity_type = v_req.entity_type;
  select department_id, manager_id into v_dept, v_mgr from public.profiles where id = v_req.requester_id;

  return query
    with wanted as (
      select v_req.requester_id as id
       where exists (select 1 from public.notification_rules r
                      where r.organization_id = v_req.organization_id and r.entity_type = v_req.entity_type
                        and r.event_key = _event_key and r.audience = 'requester' and r.enabled)
      union
      select v_mgr
       where exists (select 1 from public.notification_rules r
                      where r.organization_id = v_req.organization_id and r.entity_type = v_req.entity_type
                        and r.event_key = _event_key and r.audience = 'requester_manager' and r.enabled)
      union
      select ma.user_id from public.module_admins ma
       where v_module is not null and ma.module_key = v_module
         and ma.organization_id = v_req.organization_id and ma.deleted_at is null
         and exists (select 1 from public.notification_rules r
                      where r.organization_id = v_req.organization_id and r.entity_type = v_req.entity_type
                        and r.event_key = _event_key and r.audience = 'module_admins' and r.enabled)
      union
      select c.profile_id from public.notification_custom_recipients c
       where c.organization_id = v_req.organization_id and c.entity_type = v_req.entity_type
         and c.event_key = _event_key
         and (c.department_id is null or c.department_id = v_dept)
    )
    select w.id from wanted w
      join public.profiles p on p.id = w.id
     where w.id is not null
       and p.organization_id = v_req.organization_id and p.is_active and p.deleted_at is null
       -- Never a copy to somebody the event itself already reaches.
       and w.id not in (select x from public.resolve_notification_recipients(_event_key, _payload) x
                         where x is not null);
end $$;

comment on function public.resolve_notification_fyi is
  'D93 — who the company asked to be told of an approval event as well, by rule or by name; never somebody the event already reaches.';

revoke all on function public.resolve_notification_fyi(text, jsonb) from public, anon, authenticated;

-- Reproduced from 20260803100000_approval_entity_labels.sql. The diff: the
-- copies (D93), between the people and the plain addresses.
create or replace function public.emit_platform_event(_event_key text, _payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipient uuid;
  v_address   record;
  v_org       uuid  := nullif(_payload->>'organization_id', '')::uuid;
  v_payload   jsonb := coalesce(_payload, '{}'::jsonb);
begin
  -- The whole of this migration's effect on delivery. Added here rather than at
  -- each call site because the engine's functions are not worth rebuilding to
  -- carry one string — see the header.
  if v_payload ? 'entity_type' then
    v_payload := v_payload || jsonb_build_object(
      'entity_label', public.approval_entity_label(v_payload->>'entity_type'));
  end if;

  for v_recipient in
    select * from public.resolve_notification_recipients(_event_key, v_payload)
  loop
    begin
      perform public.notify(_event_key, v_recipient, v_payload);
    exception when others then
      -- D28. One unrenderable notification must not cost somebody their
      -- approved leave. Warned rather than swallowed, so it reaches the log.
      raise warning 'notification failed for % / %: %', _event_key, v_recipient, sqlerrm;
    end;
  end loop;

  -- D93. Copies for whoever the company asked to be told as well. Their own
  -- wording (event_key || '_fyi'): "for your information", never "needs your
  -- approval". Never to somebody who already received the event itself.
  for v_recipient in
    select * from public.resolve_notification_fyi(_event_key, v_payload)
  loop
    begin
      perform public.notify(_event_key || '_fyi', v_recipient, v_payload || jsonb_build_object(
        'requester_name', (select coalesce(p.full_name, 'A colleague')
                             from public.approval_requests r join public.profiles p on p.id = r.requester_id
                            where r.id = nullif(v_payload->>'approval_request_id', '')::uuid)));
    exception when others then
      raise warning 'notification failed for %_fyi / %: %', _event_key, v_recipient, sqlerrm;
    end;
  end loop;

  for v_address in
    select * from public.resolve_notification_addresses(_event_key, v_payload)
  loop
    begin
      perform public.notify_address(_event_key, v_org, v_address.email, v_address.name, v_payload);
    exception when others then
      raise warning 'notification failed for % / %: %', _event_key, v_address.email, sqlerrm;
    end;
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════ the matrix

/** Every event and audience for one module's approvals: on, off, or locked on. */
create or replace function public.notification_matrix(_module_key text)
returns table (
  entity_type  text,
  entity_label text,
  event_key    text,
  audience     text,
  enabled      boolean,
  mandatory    boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
begin
  if v_org is null or not public.is_module_admin(_module_key) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  return query
    select l.entity_type, l.label, e.event_key, a.audience,
           case when m.mandatory then true else coalesce(r.enabled, false) end,
           m.mandatory
      from public.approval_entity_labels l
     cross join (values ('approval.submitted', 1), ('approval.completed', 2), ('approval.escalated', 3)) e(event_key, eo)
     cross join (values ('approver', 1), ('requester', 2), ('requester_manager', 3), ('module_admins', 4)) a(audience, ao)
     cross join lateral (select (e.event_key, a.audience) in (
                    ('approval.submitted', 'approver'),
                    ('approval.completed', 'requester'),
                    ('approval.escalated', 'approver')) as mandatory) m
      left join public.notification_rules r
        on r.organization_id = v_org and r.entity_type = l.entity_type
       and r.event_key = e.event_key and r.audience = a.audience
     where l.module_key = _module_key
       -- The approver hears what concerns them by the engine's own rules; only
       -- their mandatory cells are shown.
       and (a.audience <> 'approver' or m.mandatory)
     order by l.entity_type, e.eo, a.ao;
end $$;

revoke all on function public.notification_matrix(text) from public, anon;
grant execute on function public.notification_matrix(text) to authenticated;

create or replace function public.notification_rule_set(
  _entity_type text,
  _event_key   text,
  _audience    text,
  _enabled     boolean
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org    uuid := public.current_org_id();
  v_module text;
begin
  select module_key into v_module from public.approval_entity_labels where entity_type = _entity_type;
  if v_org is null or v_module is null or not public.is_module_admin(v_module) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if (_event_key, _audience) in (('approval.submitted', 'approver'), ('approval.completed', 'requester'),
                                 ('approval.escalated', 'approver')) then
    raise exception 'MANDATORY_NOTIFICATION' using errcode = 'P0001';
  end if;
  insert into public.notification_rules (organization_id, entity_type, event_key, audience, enabled)
  values (v_org, _entity_type, _event_key, _audience, coalesce(_enabled, false))
  on conflict (organization_id, entity_type, event_key, audience)
  do update set enabled = excluded.enabled;
end $$;

revoke all on function public.notification_rule_set(text, text, text, boolean) from public, anon;
grant execute on function public.notification_rule_set(text, text, text, boolean) to authenticated;

create or replace function public.notification_custom_list(_module_key text)
returns table (
  id              uuid,
  entity_type     text,
  entity_label    text,
  event_key       text,
  profile_id      uuid,
  person_name     text,
  department_id   uuid,
  department_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
begin
  if v_org is null or not public.is_module_admin(_module_key) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  return query
    select c.id, c.entity_type, l.label, c.event_key, c.profile_id,
           coalesce(p.full_name, p.email)::text, c.department_id, d.name::text
      from public.notification_custom_recipients c
      join public.approval_entity_labels l on l.entity_type = c.entity_type
      join public.profiles p on p.id = c.profile_id
      left join public.departments d on d.id = c.department_id
     where c.organization_id = v_org and l.module_key = _module_key
     order by l.label, c.event_key, 6;
end $$;

revoke all on function public.notification_custom_list(text) from public, anon;
grant execute on function public.notification_custom_list(text) to authenticated;

create or replace function public.notification_custom_add(
  _entity_type   text,
  _event_key     text,
  _profile_id    uuid,
  _department_id uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org    uuid := public.current_org_id();
  v_module text;
  v_id     uuid;
begin
  select module_key into v_module from public.approval_entity_labels where entity_type = _entity_type;
  if v_org is null or v_module is null or not public.is_module_admin(v_module) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if _event_key not in ('approval.submitted', 'approval.completed', 'approval.escalated') then
    raise exception 'UNKNOWN_EVENT' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.profiles
                  where id = _profile_id and organization_id = v_org and is_active and deleted_at is null) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if _department_id is not null
     and not exists (select 1 from public.departments where id = _department_id and organization_id = v_org) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  begin
    insert into public.notification_custom_recipients (organization_id, entity_type, event_key, profile_id, department_id)
    values (v_org, _entity_type, _event_key, _profile_id, _department_id)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'ALREADY_TOLD' using errcode = 'P0001';
  end;
  return v_id;
end $$;

revoke all on function public.notification_custom_add(text, text, uuid, uuid) from public, anon;
grant execute on function public.notification_custom_add(text, text, uuid, uuid) to authenticated;

create or replace function public.notification_custom_remove(_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_c      public.notification_custom_recipients%rowtype;
  v_module text;
begin
  select * into v_c from public.notification_custom_recipients
   where id = _id and organization_id = public.current_org_id();
  select module_key into v_module from public.approval_entity_labels where entity_type = v_c.entity_type;
  if v_c.id is null or v_module is null or not public.is_module_admin(v_module) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  delete from public.notification_custom_recipients where id = _id;
end $$;

revoke all on function public.notification_custom_remove(uuid) from public, anon;
grant execute on function public.notification_custom_remove(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════ the words

insert into public.notification_templates
  (organization_id, event_key, channel, subject_template, body_template)
select null::uuid, v.event_key, v.channel, v.subject, v.body
  from (values
    ('approval.submitted_fyi'::text, 'email'::public.notification_channel,
     'For your information: {{ requester_name }} raised a {{ entity_label }}'::text,
     '<p>{{ requester_name }} has raised a {{ entity_label }}. It is with their approver; nothing is needed from you.</p>'
     '<p>You are told because your company asked for you to be. Sign in to Neuvto to see it.</p>'::text),
    ('approval.completed_fyi', 'email',
     'For your information: {{ requester_name }}''s {{ entity_label }} was {{ status }}',
     '<p>{{ requester_name }}''s {{ entity_label }} was <strong>{{ status }}</strong>. Nothing is needed from you.</p>'
     '<p>You are told because your company asked for you to be.</p>'),
    ('approval.escalated_fyi', 'email',
     'For your information: {{ requester_name }}''s {{ entity_label }} has moved to {{ to_name }}',
     '<p>{{ requester_name }}''s {{ entity_label }} waited {{ waited_days }} days for {{ from_name }} and has moved to {{ to_name }}. Nothing is needed from you.</p>'
     '<p>You are told because your company asked for you to be.</p>')
  ) as v(event_key, channel, subject, body)
 where not exists (
   select 1 from public.notification_templates t
    where t.organization_id is null and t.event_key = v.event_key and t.channel = v.channel
      and t.deleted_at is null);

/** Who can be named: everybody active in the company, for the module's admin. */
create or replace function public.notification_people(_module_key text)
returns table (id uuid, full_name text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.current_org_id() is null or not public.is_module_admin(_module_key) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  return query
    select p.id, coalesce(p.full_name, p.email)::text
      from public.profiles p
     where p.organization_id = public.current_org_id() and p.is_active and p.deleted_at is null
     order by 2;
end $$;

revoke all on function public.notification_people(text) from public, anon;
grant execute on function public.notification_people(text) to authenticated;
