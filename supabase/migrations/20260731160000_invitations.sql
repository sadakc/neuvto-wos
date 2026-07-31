-- ============================================================================
-- NEUVTO WOS — Invitations
--
-- Sada signed in with a second email expecting to join his workspace. It became
-- an administrator instead — of a brand-new organisation of its own. Nothing
-- leaked; RLS held perfectly. But it showed the model was wrong: every sign-in
-- was a signup, and an employee who signed in before anyone invited them would
-- silently create a rival tenant instead of landing in their employer's.
--
-- D39 — the ONE way into a workspace is an invitation. That holds for the first
-- administrator, provisioned by Neuvto, exactly as it holds for the hundredth
-- employee. One path, one set of rules, one thing to get right.
--
-- D40 — a duplicate inside the organisation is reported plainly to the admin. A
-- clash across organisations is refused when the person themselves arrives, and
-- the admin is never told the reason. Answering "already in another workspace"
-- at invite time would make the invite box a staff-directory oracle: type
-- addresses, watch which come back duplicate, enumerate a competitor's payroll.
-- FIRST_CUSTOMER_RUNBOOK.md calls tenant isolation what a customer is really
-- buying, and it has to mean this too.
--
-- D41 — the phone number is stored and unique within an organisation, and it is
-- NOT an identity key. The intent behind asking for it is right: one human, not
-- one email address, and phone is the correct key for that. But an admin types
-- this number and nothing verifies it, so treating it as proof of identity
-- would be security theatre. Real enforcement needs phone OTP, which D8 defers
-- pending an SMS provider and Indian DLT registration. Recorded so it is a
-- decision rather than an oversight.
-- ============================================================================

-- ═══════════════════════════════════════════════════ where the app lives
--
-- The database has to put a link in an email and cannot discover its own public
-- address. One definition, changed in one place at cutover, rather than the
-- string appearing in a template, an edge function and a test.
create or replace function public.app_base_url()
returns text
language sql
immutable
as $$ select 'https://neuvto.com'::text $$;

comment on function public.app_base_url is
  'The public origin of this deployment. Change here at cutover, or override the notification template per organisation.';

-- ═══════════════════════════════════════════════════ phone, normalised
--
-- Generated rather than normalised by whoever writes the row. "+91 98765 43210"
-- and "+919876543210" are the same number, and a uniqueness rule that cannot
-- see that is not a uniqueness rule.
alter table public.profiles
  add column phone_normalized text
    generated always as (nullif(regexp_replace(coalesce(phone, ''), '[^0-9+]', '', 'g'), '')) stored;

create unique index uq_profile_phone_in_org on public.profiles (organization_id, phone_normalized)
  where phone_normalized is not null and deleted_at is null;

comment on column public.profiles.phone_normalized is
  'D41 — digits and a leading +, for uniqueness within the organisation. Not verified, and not an identity key until phone OTP exists (D8).';

-- ═══════════════════════════════════════════════════════════ the invitation

create table public.invitations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email           text not null,
  phone           text,
  role            public.app_role not null,
  full_name       text,

  -- 24 random bytes as hex. URL-safe without encoding tricks, and enough
  -- entropy that guessing is not a threat model worth modelling.
  token           text not null default encode(gen_random_bytes(24), 'hex'),
  expires_at      timestamptz not null default now() + interval '14 days',

  accepted_at     timestamptz,
  accepted_by     uuid references auth.users(id) on delete set null,
  revoked_at      timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  deleted_at timestamptz,

  phone_normalized text
    generated always as (nullif(regexp_replace(coalesce(phone, ''), '[^0-9+]', '', 'g'), '')) stored,

  constraint invitation_email_format check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint invitation_email_lower  check (email = lower(email)),
  constraint invitation_expiry_sane  check (expires_at > created_at),
  -- Accepted means somebody accepted it. A row claiming acceptance with no
  -- account behind it cannot answer "who is this person".
  constraint invitation_accepted_evidence check (
    (accepted_at is null and accepted_by is null)
    or (accepted_at is not null and accepted_by is not null)
  )
);

-- "Live" means still worth accepting. A revoked invitation must not block a
-- re-invitation at a different role, which is the ordinary reason to revoke one.
create unique index uq_invitation_email_live on public.invitations (organization_id, email)
  where deleted_at is null and revoked_at is null and accepted_at is null;

create unique index uq_invitation_phone_live on public.invitations (organization_id, phone_normalized)
  where phone_normalized is not null
    and deleted_at is null and revoked_at is null and accepted_at is null;

create unique index uq_invitation_token on public.invitations (token) where deleted_at is null;

create index idx_invitations_org on public.invitations (organization_id, created_at desc)
  where deleted_at is null;

comment on table public.invitations is
  'D39 — the only way into a workspace, for the first admin and the hundredth employee alike.';

alter table public.invitations enable row level security;

create trigger set_audit_fields before insert or update on public.invitations
  for each row execute function public.set_audit_fields();
create trigger write_audit_log after insert or update or delete on public.invitations
  for each row execute function public.write_audit_log();

grant select, insert, update on public.invitations to authenticated;

-- Admins of the organisation, and nobody else. An employee has no business
-- reading who else has been invited, and the token is a credential.
create policy "admins read own invitations" on public.invitations
  for select to authenticated
  using (organization_id = public.current_org_id() and public.is_admin() and deleted_at is null);

create policy "admins write invitations" on public.invitations
  for insert to authenticated
  with check (organization_id = public.current_org_id() and public.is_admin());

create policy "admins update invitations" on public.invitations
  for update to authenticated
  using (organization_id = public.current_org_id() and public.is_admin() and deleted_at is null)
  with check (organization_id = public.current_org_id());

-- ═══════════════════════════════════════════════ notifying a non-user
--
-- The engine could only ever reach a profile: notify() takes a recipient_id and
-- notification_claim_batch joins profiles for the address. An invitee has no
-- profile — that is the entire point of inviting them.
--
-- Widened rather than worked around, because this recurs: every product
-- eventually emails somebody who is not a user yet.

alter table public.notifications
  alter column recipient_id drop not null;

alter table public.notifications
  add column recipient_email text,
  add column recipient_name  text;

alter table public.notifications
  add constraint notification_recipient_present check (
    recipient_id is not null or recipient_email is not null
  );

comment on column public.notifications.recipient_email is
  'Set instead of recipient_id when the recipient has no profile yet — an invitation, for instance.';

-- The dispatcher's view. LEFT JOIN now, so a row addressed to a plain email is
-- claimed rather than silently filtered out by the join it could never satisfy.
--
-- `next_attempt_at <= now()` is D29's backoff and MUST survive every rewrite of
-- this function. The first draft of this migration was based on the step 5
-- definition and dropped it, which would have had the dispatcher retry a failed
-- send on every tick — a hot loop against Resend, on the one code path nobody
-- watches. The harness caught it in the same run. Whoever edits this next:
-- start from the current definition, not from the original.
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
        where status = 'pending'
          and deleted_at is null
          and next_attempt_at <= now()      -- D29 — respect the backoff
        order by created_at
        limit greatest(_limit, 0)
        for update skip locked
     )
    returning n.*
  )
  select c.id, c.organization_id,
         coalesce(p.email, c.recipient_email),
         coalesce(p.full_name, c.recipient_name),
         c.event_key, c.subject, c.body
    from claimed c
    left join public.profiles p on p.id = c.recipient_id and p.deleted_at is null
   where coalesce(p.email, c.recipient_email) is not null;
$$;

comment on function public.notification_claim_batch is
  'Claims pending notifications for delivery, addressed by profile or by plain email. FOR UPDATE SKIP LOCKED so two dispatchers never send the same message twice.';

-- The address counterpart of resolve_notification_recipients. Same seam, same
-- rule: the emitter names the event, the engine names who hears about it (D26).
-- invitation_create emits `member.invited` and decides nothing about delivery.
create or replace function public.resolve_notification_addresses(_event_key text, _payload jsonb)
returns table (email text, name text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if _event_key = 'member.invited' then
    return query
      select nullif(_payload->>'email', ''), nullif(_payload->>'full_name', '')
       where nullif(_payload->>'email', '') is not null;
  end if;
  return;
end $$;

comment on function public.resolve_notification_addresses is
  'D26 for recipients who have no account yet. Maps an event to plain addresses.';

create or replace function public.notify_address(
  _event_key text,
  _org_id    uuid,
  _email     text,
  _name      text,
  _payload   jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template public.notification_templates%rowtype;
  v_id       uuid;
begin
  if _email is null or _org_id is null then return null; end if;

  select * into v_template
    from public.notification_templates
   where event_key = _event_key
     and channel = 'email'
     and is_active
     and deleted_at is null
     and (organization_id = _org_id or organization_id is null)
   order by organization_id nulls last
   limit 1;

  -- D28, as for notify(): a missing template is a recorded failure, never a
  -- raise. An invitation that was created must not roll back because the email
  -- could not be rendered.
  if v_template.id is null then
    insert into public.notifications
      (organization_id, recipient_email, recipient_name, event_key, channel,
       payload, subject, body, status, failed_reason)
    values
      (_org_id, _email, _name, _event_key, 'email', coalesce(_payload, '{}'::jsonb),
       '(no template)', '(no template)', 'failed', 'NO_TEMPLATE')
    returning id into v_id;
    return v_id;
  end if;

  insert into public.notifications
    (organization_id, recipient_email, recipient_name, event_key, channel,
     payload, subject, body)
  values
    (_org_id, _email, _name, _event_key, v_template.channel, coalesce(_payload, '{}'::jsonb),
     public.render_template(v_template.subject_template, _payload),
     public.render_template(v_template.body_template, _payload))
  returning id into v_id;

  return v_id;
end $$;

comment on function public.notify_address is
  'Renders and enqueues one notification to a plain address. Never raises — see D28.';

-- Now resolves both kinds of recipient. Profile-based events are unaffected.
create or replace function public.emit_platform_event(_event_key text, _payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipient uuid;
  v_address   record;
  v_org       uuid := nullif(_payload->>'organization_id', '')::uuid;
begin
  for v_recipient in
    select * from public.resolve_notification_recipients(_event_key, _payload)
  loop
    begin
      perform public.notify(_event_key, v_recipient, _payload);
    exception when others then
      -- D28. One unrenderable notification must not cost somebody their
      -- approved leave. Warned rather than swallowed, so it reaches the log.
      raise warning 'notification failed for % / %: %', _event_key, v_recipient, sqlerrm;
    end;
  end loop;

  for v_address in
    select * from public.resolve_notification_addresses(_event_key, _payload)
  loop
    begin
      perform public.notify_address(_event_key, v_org, v_address.email, v_address.name, _payload);
    exception when others then
      raise warning 'notification failed for % / %: %', _event_key, v_address.email, sqlerrm;
    end;
  end loop;
end $$;

comment on function public.emit_platform_event is
  'Platform event entry point. Resolves recipients — by profile or by address — renders and enqueues. Never fails the calling transaction (D28).';

-- The invitation email. Placeholders are exactly what invitation_create supplies.
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
       '<p>Sign in to Neuvto for the details.</p>'),

      -- The first email anybody at a new customer ever receives. It says who
      -- invited them and to what, because an unexplained link asking for a
      -- work email is indistinguishable from phishing.
      ('member.invited', 'email',
       'You have been invited to {{ organization_name }} on Neuvto',
       '<p>{{ inviter_name }} has invited you to join <strong>{{ organization_name }}</strong> on Neuvto.</p>'
       '<p><a href="{{ invite_url }}">Accept the invitation</a></p>'
       '<p>You will be asked for your email address and a six-digit code, to confirm the invitation reached the right person.</p>'
       '<p>This invitation expires on {{ expires_on }}.</p>')
    ) as v(event_key, channel, subject, body)
   where not exists (
     select 1 from public.notification_templates t
      where t.organization_id is null
        and t.event_key = v.event_key
        and t.channel = v.channel
        and t.deleted_at is null
   );
end $$;

select public.ensure_system_notification_templates();

-- ═══════════════════════════════════════════════════════════ creating one

create or replace function public.invitation_create(
  _email     text,
  _phone     text default null,
  _role      public.app_role default 'employee',
  _full_name text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org     uuid := public.current_org_id();
  v_actor   uuid := (select auth.uid());
  v_email   text := lower(btrim(_email));
  v_phone   text := nullif(regexp_replace(coalesce(_phone, ''), '[^0-9+]', '', 'g'), '');
  v_id      uuid;
  v_row     public.invitations%rowtype;
  v_orgname text;
  v_inviter text;
begin
  if v_actor is null or v_org is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'INVALID_EMAIL' using errcode = 'P0001';
  end if;

  -- ─────────────────────────────────── duplicates, INSIDE this organisation
  -- D40. These are the admin's own data and are reported plainly. What is not
  -- reported, here or anywhere, is whether the address exists in some other
  -- customer's workspace.
  if exists (
    select 1 from public.profiles
     where organization_id = v_org and lower(email) = v_email and deleted_at is null
  ) then
    raise exception 'ALREADY_A_MEMBER' using errcode = 'P0001';
  end if;

  if v_phone is not null and exists (
    select 1 from public.profiles
     where organization_id = v_org and phone_normalized = v_phone and deleted_at is null
  ) then
    raise exception 'PHONE_ALREADY_A_MEMBER' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.invitations
     where organization_id = v_org and email = v_email
       and deleted_at is null and revoked_at is null and accepted_at is null
  ) then
    raise exception 'ALREADY_INVITED' using errcode = 'P0001';
  end if;

  if v_phone is not null and exists (
    select 1 from public.invitations
     where organization_id = v_org and phone_normalized = v_phone
       and deleted_at is null and revoked_at is null and accepted_at is null
  ) then
    raise exception 'PHONE_ALREADY_INVITED' using errcode = 'P0001';
  end if;

  insert into public.invitations (organization_id, email, phone, role, full_name)
  values (v_org, v_email, nullif(btrim(_phone), ''), _role, nullif(btrim(_full_name), ''))
  returning * into v_row;

  v_id := v_row.id;

  select name into v_orgname from public.organizations where id = v_org;
  select coalesce(full_name, email) into v_inviter from public.profiles where id = v_actor;

  -- D26. The event is named here; who receives it and what it says are the
  -- engine's business.
  perform public.emit_platform_event('member.invited', jsonb_build_object(
    'organization_id',   v_org,
    'organization_name', v_orgname,
    'inviter_name',      coalesce(v_inviter, 'Your administrator'),
    'email',             v_email,
    'full_name',         v_row.full_name,
    'role',              _role,
    'invite_url',        public.app_base_url() || '/auth?invite=' || v_row.token,
    'expires_on',        to_char(v_row.expires_at, 'DD Mon YYYY')
  ));

  insert into public.analytics_events (organization_id, user_id, event, properties)
  values (v_org, v_actor, 'member.invited', jsonb_build_object('role', _role));

  return v_id;
end $$;

comment on function public.invitation_create is
  'D39/D40 — invites somebody into the caller''s organisation. Duplicates within it are named; a clash elsewhere is never disclosed.';

grant execute on function public.invitation_create(text, text, public.app_role, text) to authenticated;

-- ═══════════════════════════════════════════════════════════ accepting one

create or replace function public.invitation_accept(_token text)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_email text;
  v_inv   public.invitations%rowtype;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;

  select email into v_email from auth.users where id = v_uid;
  if v_email is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;

  select * into v_inv from public.invitations
   where token = btrim(_token)
     and deleted_at is null
     and revoked_at is null
     and accepted_at is null
     and expires_at > now();

  -- ONE message for expired, revoked, already-accepted, non-existent and
  -- addressed-to-someone-else alike. Distinguishing them turns this function
  -- into an oracle for probing tokens, and there is nothing an honest invitee
  -- could do differently with the more specific answer.
  if v_inv.id is null or lower(v_email) <> v_inv.email then
    raise exception 'INVITATION_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- D40. One person, one workspace — the constraint signup_organization has
  -- always enforced, restated where the second entrance is.
  --
  -- Deliberately not recorded on the invitation row. The admin can read that
  -- row; writing "already in another workspace" onto it would hand them, by the
  -- back door, exactly the cross-tenant fact invitation_create refuses to give
  -- them at the front. The person in front of us is told, because it is their
  -- own address, and the server log carries it for support.
  if exists (select 1 from public.profiles where id = v_uid and deleted_at is null) then
    raise warning 'invitation % not accepted: % already has a profile', v_inv.id, v_uid;
    raise exception 'EMAIL_IN_ANOTHER_WORKSPACE' using errcode = 'P0001';
  end if;

  insert into public.profiles (id, organization_id, full_name, email, phone)
  values (v_uid, v_inv.organization_id, v_inv.full_name, v_email, v_inv.phone);

  insert into public.user_roles (user_id, organization_id, role)
  values (v_uid, v_inv.organization_id, v_inv.role);

  update public.invitations
     set accepted_at = now(), accepted_by = v_uid
   where id = v_inv.id;

  insert into public.analytics_events (organization_id, user_id, event, properties)
  values (v_inv.organization_id, v_uid, 'member.joined',
          jsonb_build_object('role', v_inv.role));

  return v_inv.organization_id;
end $$;

comment on function public.invitation_accept is
  'D39 — redeems an invitation into a profile and a role. One refusal message for every reason a token might not work.';

grant execute on function public.invitation_accept(text) to authenticated;

-- ═══════════════════════════════════════════════════════════ revoking one

create or replace function public.invitation_revoke(_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
begin
  if v_org is null or not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  update public.invitations
     set revoked_at = now()
   where id = _id
     and organization_id = v_org
     and deleted_at is null
     and accepted_at is null;

  if not found then
    raise exception 'INVITATION_NOT_FOUND' using errcode = 'P0001';
  end if;
end $$;

comment on function public.invitation_revoke is
  'Withdraws an unaccepted invitation. Revoking frees the address and phone to be invited again at a different role.';

grant execute on function public.invitation_revoke(uuid) to authenticated;
