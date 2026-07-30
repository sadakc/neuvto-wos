-- ============================================================================
-- NEUVTO WOS — Platform service: Notification Engine
--
-- Build step 5. Like the Approval Engine, this knows nothing about leave.
-- Modules emit an event key and a payload of facts; the engine decides who
-- hears about it, which template renders it, and how it is delivered.
--
-- D26 — the emitter names the event, the engine names the recipients.
-- approval_submit() does not say "email the approver". It says
-- 'approval.submitted' happened and here are the facts. A module that named
-- recipients would have to be edited every time an organisation wanted its HR
-- admin copied in, and Attendance would repeat the same logic differently.
--
-- D27 — substituted values are HTML-escaped. A leave request's reason is user
-- input landing in an HTML email that a manager opens. Without escaping, an
-- employee can inject markup into mail their manager receives.
--
-- D28 — a notification never fails the transaction that caused it. A missing
-- template records a failed notification and returns; it does not roll back
-- somebody's approved leave. Delivery problems are visible in the queue rather
-- than fatal at the call site.
-- ============================================================================

create type public.notification_channel as enum ('email', 'in_app');
create type public.notification_status  as enum ('pending', 'sent', 'failed');

-- ─────────────────────────────────────────────────────────── templates
-- organization_id null is the system default, used when an organisation has not
-- written its own. Every event therefore renders on day one, before a customer
-- has configured anything.

create table public.notification_templates (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid references public.organizations(id) on delete cascade,
  event_key        text not null,
  channel          public.notification_channel not null,
  subject_template text not null,
  body_template    text not null,
  is_active        boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  deleted_at timestamptz,

  constraint template_event_format check (event_key ~ '^[a-z_]+\.[a-z_]+$'),
  constraint template_subject_present check (length(btrim(subject_template)) > 0),
  constraint template_body_present    check (length(btrim(body_template)) > 0)
);

-- Two partial indexes rather than one unique constraint, because a NULL
-- organization_id would not collide with itself and duplicate system defaults
-- could be inserted silently — leaving which template renders up to chance.
create unique index uq_template_org on public.notification_templates
  (organization_id, event_key, channel)
  where organization_id is not null and deleted_at is null;

create unique index uq_template_system on public.notification_templates
  (event_key, channel)
  where organization_id is null and deleted_at is null;

create index idx_templates_lookup on public.notification_templates
  (event_key, channel, organization_id)
  where deleted_at is null and is_active;

-- ─────────────────────────────────────────────────────────── the queue
-- Rendered at enqueue time, not at send time. The subject and body a customer
-- received are then a matter of record, even if the template is edited later —
-- which is exactly the question asked when somebody disputes what they were
-- told.

create table public.notifications (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  recipient_id    uuid not null references public.profiles(id) on delete cascade,
  event_key       text not null,
  channel         public.notification_channel not null,
  payload         jsonb not null default '{}',
  subject         text not null,
  body            text not null,
  status          public.notification_status not null default 'pending',
  attempts        smallint not null default 0,
  sent_at         timestamptz,
  failed_reason   text,
  read_at         timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  deleted_at timestamptz,

  -- Status and its evidence move together. A 'sent' row with no sent_at cannot
  -- answer "when did we tell them", and a 'failed' row with no reason cannot be
  -- acted on.
  constraint notification_status_evidence check (
    (status = 'pending' and sent_at is null and failed_reason is null)
    or (status = 'sent'    and sent_at is not null)
    or (status = 'failed'  and failed_reason is not null)
  ),
  constraint notification_attempts_sane check (attempts >= 0)
);

create index idx_notifications_queue on public.notifications
  (created_at)
  where status = 'pending' and deleted_at is null;

create index idx_notifications_inbox on public.notifications
  (recipient_id, created_at desc)
  where deleted_at is null;

create index idx_notifications_org on public.notifications (organization_id);

create trigger set_audit_fields before insert or update on public.notification_templates
  for each row execute function public.set_audit_fields();
create trigger set_audit_fields before insert or update on public.notifications
  for each row execute function public.set_audit_fields();

-- Templates are configuration and are audited. `notifications` is deliberately
-- exempt from write_audit_log: it is an append-mostly delivery queue whose rows
-- already record who, what and when, so auditing it duplicates the table into
-- audit_logs at the same volume. Recorded as an exemption in
-- docs/standards/NEUVTO_DATA_STANDARDS.md.
create trigger write_audit_log after insert or update or delete on public.notification_templates
  for each row execute function public.write_audit_log();

-- ═══════════════════════════════════════════════════════════ rendering

-- D27. Ampersand first: escaping it after the others would double-escape the
-- entities they produce.
create or replace function public.escape_html(_text text)
returns text
language sql
immutable
set search_path = public
as $$
  select replace(replace(replace(replace(replace(
    coalesce(_text, ''),
    '&', '&amp;'),
    '<', '&lt;'),
    '>', '&gt;'),
    '"', '&quot;'),
    '''', '&#39;')
$$;

comment on function public.escape_html is
  'HTML entity escaping for values substituted into templates (D27).';

-- Substitutes {{ key }} from the payload. Two injection surfaces are closed
-- here, and neither is obvious:
--
--   1. The key is interpolated into a regular expression, so a payload key of
--      '.*' would match everything. Only well-formed keys are substituted.
--   2. The value is a regexp_replace REPLACEMENT, where backslash is special.
--      A value containing \1 would be read as a backreference. Backslashes are
--      escaped before substitution. Ampersand needs no such care because
--      escape_html has already turned it into &amp;.
create or replace function public.render_template(_template text, _payload jsonb)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_out text := _template;
  v_key text;
  v_val text;
begin
  if _template is null then return null; end if;

  for v_key, v_val in select key, value from jsonb_each_text(coalesce(_payload, '{}'::jsonb)) loop
    continue when v_key !~ '^[a-z_][a-z0-9_]*$';
    v_out := regexp_replace(
      v_out,
      '\{\{\s*' || v_key || '\s*\}\}',
      replace(public.escape_html(v_val), '\', '\\'),
      'g'
    );
  end loop;

  -- Anything still unsubstituted is a placeholder the event does not provide.
  -- Removed rather than left visible: a customer should not receive an email
  -- containing {{ approver_name }}. The harness asserts that system templates
  -- only reference keys their event actually supplies, so this is a safety net
  -- and not the mechanism.
  return regexp_replace(v_out, '\{\{[^}]*\}\}', '', 'g');
end $$;

comment on function public.render_template is
  'Substitutes {{ key }} from a payload, HTML-escaped (D27). Safe against regex injection via keys and backreference injection via values.';

-- ═══════════════════════════════════════════════════════════ recipients
-- D26. Event in, people out. Modules never name a recipient; adding
-- 'attendance.correction_submitted' later adds a branch here and changes no
-- module. Reading approval state to answer "whose turn is it now" is a platform
-- service consulting another platform service, which is allowed — what is not
-- allowed is either of them consulting a module.

create or replace function public.resolve_notification_recipients(_event_key text, _payload jsonb)
returns setof uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_request_id uuid := nullif(_payload->>'approval_request_id', '')::uuid;
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
  end if;

  return;
end $$;

comment on function public.resolve_notification_recipients is
  'Maps a platform event to the people who should hear about it (D26). Modules never name recipients.';

-- ═══════════════════════════════════════════════════════════ enqueue

create or replace function public.notify(_event_key text, _recipient_id uuid, _payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org      uuid;
  v_template public.notification_templates%rowtype;
  v_id       uuid;
begin
  if _recipient_id is null then return null; end if;

  select organization_id into v_org
    from public.profiles
   where id = _recipient_id and deleted_at is null;

  if v_org is null then return null; end if;   -- deactivated or deleted recipient

  -- The organisation's own template wins; the system default is the fallback.
  -- Ordering by organization_id NULLS LAST expresses exactly that.
  select * into v_template
    from public.notification_templates
   where event_key = _event_key
     and channel = 'email'
     and is_active
     and deleted_at is null
     and (organization_id = v_org or organization_id is null)
   order by organization_id nulls last
   limit 1;

  -- D28. A missing template is recorded as a failure, not raised. Silence would
  -- mean nobody learns the email was never sent; raising would roll back the
  -- approval that triggered it.
  if v_template.id is null then
    insert into public.notifications
      (organization_id, recipient_id, event_key, channel, payload, subject, body, status, failed_reason)
    values
      (v_org, _recipient_id, _event_key, 'email', coalesce(_payload, '{}'::jsonb),
       '(no template)', '(no template)', 'failed', 'NO_TEMPLATE')
    returning id into v_id;
    return v_id;
  end if;

  insert into public.notifications
    (organization_id, recipient_id, event_key, channel, payload, subject, body)
  values
    (v_org, _recipient_id, _event_key, v_template.channel, coalesce(_payload, '{}'::jsonb),
     public.render_template(v_template.subject_template, _payload),
     public.render_template(v_template.body_template, _payload))
  returning id into v_id;

  return v_id;
end $$;

comment on function public.notify is
  'Renders and enqueues one notification. Never raises — see D28.';

-- ═══════════════════════════════════════════════════════════ the seam, realised
-- Step 4 left this a documented no-op so the call sites would already be right.
-- This is that one function body.

create or replace function public.emit_platform_event(_event_key text, _payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipient uuid;
begin
  for v_recipient in
    select * from public.resolve_notification_recipients(_event_key, _payload)
  loop
    begin
      perform public.notify(_event_key, v_recipient, _payload);
    exception when others then
      -- D28 taken seriously. One unrenderable notification must not cost
      -- somebody their approved leave. Warned rather than swallowed silently so
      -- it appears in the Postgres log.
      raise warning 'notification failed for % / %: %', _event_key, v_recipient, sqlerrm;
    end;
  end loop;
end $$;

comment on function public.emit_platform_event is
  'Platform event entry point. Resolves recipients, renders and enqueues. Never fails the calling transaction (D28).';

-- ═══════════════════════════════════════════════════════════ delivery support
-- Called by the edge function under the service role. Not granted to
-- authenticated: a signed-in user has no business claiming the send queue.

-- Returns the address alongside the message. The dispatcher would otherwise
-- have to look up every recipient separately, and a notification whose
-- recipient was deleted between claiming and sending would fail confusingly
-- rather than simply not being claimed.
create or replace function public.notification_claim_batch(_limit integer default 20)
returns table (
  id              uuid,
  organization_id uuid,
  recipient_email text,
  recipient_name  text,
  event_key       text,
  subject         text,
  body            text
)
language sql
volatile
security definer
set search_path = public
as $$
  with claimed as (
    update public.notifications n
       set attempts = n.attempts + 1,
           updated_at = now()
     where n.id in (
       select id from public.notifications
        where status = 'pending' and deleted_at is null
        order by created_at
        limit greatest(_limit, 0)
        for update skip locked
     )
    returning n.*
  )
  select c.id, c.organization_id, p.email, p.full_name, c.event_key, c.subject, c.body
    from claimed c
    join public.profiles p on p.id = c.recipient_id
   where p.deleted_at is null;
$$;

comment on function public.notification_claim_batch is
  'Claims pending notifications for delivery. FOR UPDATE SKIP LOCKED so two dispatchers never send the same email twice.';

create or replace function public.notification_mark_sent(_id uuid)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  update public.notifications
     set status = 'sent', sent_at = now(), failed_reason = null
   where id = _id and status <> 'sent';
$$;

create or replace function public.notification_mark_failed(_id uuid, _reason text)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  update public.notifications
     set status = 'failed', failed_reason = coalesce(nullif(btrim(_reason), ''), 'UNKNOWN')
   where id = _id and status <> 'sent';
$$;

-- ═══════════════════════════════════════════════════════════ system templates
-- Plain, readable, and free of anything an organisation would want to change on
-- day one. Placeholders are limited to what each event actually carries — the
-- harness asserts that, because a template referencing a key its event does not
-- supply renders a sentence with a hole in it.
--
-- A function rather than a bare INSERT, for one reason that matters: the
-- defaults are the only copy of this text. Restoring them after a truncate by
-- pasting the same strings into the test seed would mean the harness verifies
-- templates that are not the ones production sends, and the two would drift
-- apart without anything failing. One definition, re-assertable from anywhere.

create or replace function public.ensure_system_notification_templates()
returns void
language plpgsql
set search_path = public
as $$
begin
  insert into public.notification_templates
    (organization_id, event_key, channel, subject_template, body_template)
  select null::uuid, v.event_key, v.channel, v.subject, v.body
    from (values
      ('approval.submitted'::text, 'email'::public.notification_channel,
       'Approval needed: {{ entity_type }}'::text,
       '<p>A {{ entity_type }} request is waiting for your approval.</p>'
       '<p>This is level {{ level }} of {{ required_levels }}.</p>'
       '<p>Sign in to Neuvto to approve or decline it.</p>'::text),

      ('approval.decided', 'email',
       'Approval needed: {{ entity_type }}',
       '<p>A {{ entity_type }} request has moved to you for approval.</p>'
       '<p>Sign in to Neuvto to approve or decline it.</p>'),

      ('approval.completed', 'email',
       'Your {{ entity_type }} request was {{ status }}',
       '<p>Your {{ entity_type }} request was <strong>{{ status }}</strong>.</p>'
       '<p>Sign in to Neuvto for the details.</p>')
    ) as v(event_key, channel, subject, body)
   where not exists (
     select 1 from public.notification_templates t
      where t.organization_id is null
        and t.event_key = v.event_key
        and t.channel = v.channel
        and t.deleted_at is null
   );
end $$;

comment on function public.ensure_system_notification_templates is
  'Idempotently installs the system default templates. The single definition of that copy — the test seed calls this rather than restating it.';

select public.ensure_system_notification_templates();

-- ═══════════════════════════════════════════════════════════ grants
-- RLS restricts; GRANT permits. A table with flawless policies and no GRANT is
-- unreachable, which cost an afternoon in Phase 0.

grant select, insert, update on public.notification_templates to authenticated;
grant select                 on public.notifications          to authenticated;

-- Column-scoped: a recipient marks their own notification read and can change
-- nothing else about it. RLS cannot restrict columns; GRANT can.
grant update (read_at) on public.notifications to authenticated;

grant execute on function public.escape_html(text)                              to authenticated;
grant execute on function public.render_template(text, jsonb)                   to authenticated;
grant execute on function public.resolve_notification_recipients(text, jsonb)   to authenticated;
grant execute on function public.notify(text, uuid, jsonb)                      to authenticated;

-- Delivery functions are service-role only. Deliberately not granted to
-- authenticated: marking your own notification 'sent' would let a user hide
-- mail they were meant to receive.
revoke execute on function public.notification_claim_batch(integer) from public, authenticated;
revoke execute on function public.notification_mark_sent(uuid)      from public, authenticated;
revoke execute on function public.notification_mark_failed(uuid, text) from public, authenticated;
grant execute on function public.notification_claim_batch(integer)     to service_role;
grant execute on function public.notification_mark_sent(uuid)          to service_role;
grant execute on function public.notification_mark_failed(uuid, text)  to service_role;

-- ═══════════════════════════════════════════════════════════ RLS

alter table public.notification_templates enable row level security;
alter table public.notifications          enable row level security;

-- Everyone may read the templates that govern their mail, including the system
-- defaults, so an admin can see what they are overriding.
create policy "read templates in scope" on public.notification_templates
  for select to authenticated
  using (
    deleted_at is null
    and (organization_id = public.current_org_id() or organization_id is null)
  );

-- Admins write their own organisation's templates only. The `with check` on
-- organization_id is what stops an admin writing a row belonging to another
-- tenant, or overwriting a system default every customer depends on.
create policy "admins write own templates" on public.notification_templates
  for insert to authenticated
  with check (
    organization_id = public.current_org_id()
    and public.is_admin()
  );

create policy "admins update own templates" on public.notification_templates
  for update to authenticated
  using (
    organization_id = public.current_org_id()
    and public.is_admin()
    and deleted_at is null
  )
  with check (organization_id = public.current_org_id());

-- Your own mail, and an admin's view of their organisation's. No insert policy:
-- rows arrive exclusively through notify(), which is SECURITY DEFINER.
create policy "read own notifications" on public.notifications
  for select to authenticated
  using (
    deleted_at is null
    and organization_id = public.current_org_id()
    and (recipient_id = (select auth.uid()) or public.is_admin())
  );

create policy "recipient marks own read" on public.notifications
  for update to authenticated
  using (
    deleted_at is null
    and organization_id = public.current_org_id()
    and recipient_id = (select auth.uid())
  )
  with check (recipient_id = (select auth.uid()));

comment on table public.notification_templates is
  'Per-organisation email templates; organization_id null is the system default (step 5).';
comment on table public.notifications is
  'Delivery queue and record of what was sent. Rendered at enqueue so the text received is a matter of record.';
