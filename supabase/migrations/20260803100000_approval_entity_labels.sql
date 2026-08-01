-- ============================================================================
-- NEUVTO WOS — emails that say "leave request", not "leave_request"
--
-- What a manager actually received, from the first approval onwards:
--
--     Approval needed: leave_request
--     Your leave_request request was approved
--
-- A database column name in the subject line, and "request request" in the
-- body. Found by reading the inbox during step 10's verification, not by
-- reading the code.
--
-- The cause is not carelessness in the template. It is D30 doing its job: the
-- templates belong to the platform, the platform must never name a module, and
-- `entity_type` was the only thing to hand. Substituting it was the honest
-- expedient — it is simply not English.
--
-- ── A MODULE NAMES ITSELF, IN A ROW
--
-- The same shape as `modules`. A module declares its own label in its own
-- migration; the platform reads a table and still names nothing. Nothing in SQL
-- maps an entity type to a module — `approvalEntityTypes` lives in a TypeScript
-- manifest the database cannot see — so this is a declaration, not a derivation.
--
-- ── ENRICHED AT THE EVENT BUS, NOT IN THE ENGINE
--
-- The first draft of this migration rebuilt approval_submit and approval_decide
-- to add the label to their payloads. Diffing the result against the live
-- definitions showed the rebuild had silently dropped:
--
--   · the SELF_APPROVAL_FORBIDDEN guard in approval_decide
--   · the "approver has left the company" check
--   · the "already approving a lower level" de-duplication
--   · the exact condition semantics for level 1
--
-- Four real behaviours, gone, to add one string to a payload. So nothing in the
-- engine is touched. emit_platform_event already receives every payload on its
-- way to the templates and is the platform's own seam; the label is added
-- there, once, for any event that carries an entity_type.
--
-- ── WHY THE FALLBACK IS NOT `entity_type`
--
-- render_template strips any placeholder the payload does not supply, so a
-- missing label does not leak "{{ entity_label }}" into an inbox — it produces
-- "A  needs your approval", with a hole where the noun should be. Confirmed by
-- unwiring the enrichment and reading the result, after this comment first
-- claimed the opposite.
--
-- Either way the key is ALWAYS present, and an unregistered entity type falls
-- back to the generic "request": never pretty, never wrong, and never a column
-- name. Falling back to entity_type would silently restore the original defect
-- for any module that forgot to register — the failure mode this codebase keeps
-- rediscovering.
-- ============================================================================

create table if not exists public.approval_entity_labels (
  entity_type text primary key,
  -- A singular noun phrase, lowercase, that reads inside a sentence:
  --   "A {label} needs your approval"  →  "A leave request needs your approval"
  --   "Your {label} was approved"      →  "Your leave request was approved"
  -- Lowercase because it is nearly always mid-sentence; a template needing it
  -- capitalised should say so itself rather than every module guessing.
  label      text not null check (label = lower(label) and length(trim(label)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.approval_entity_labels is
  'How each approval entity type is named to a human. Declared by the owning module in its own migration — the platform never names a module (D30).';

alter table public.approval_entity_labels enable row level security;

-- Readable by anyone signed in, like the module registry it mirrors: knowing
-- that "leave_request" is called "a leave request" discloses nothing.
create policy "anyone may read approval entity labels"
  on public.approval_entity_labels
  for select to authenticated
  using (true);

grant select on public.approval_entity_labels to authenticated;

-- ═══════════════════════════════════════════════════════ the lookup

create or replace function public.approval_entity_label(_entity_type text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select label from public.approval_entity_labels where entity_type = _entity_type),
    'request'
  )
$$;

comment on function public.approval_entity_label is
  'The human name for an approval entity type, or the generic "request". Never returns entity_type — a column name in an email is the defect this exists to fix.';

grant execute on function public.approval_entity_label(text) to authenticated;

-- ═══════════════════════════════════════════════════════ carried on every event
--
-- The ONLY behavioural change: a payload that names an entity type gains a
-- human label on its way to the templates. Recipient resolution, the D28
-- warn-don't-fail contract, and both loops are exactly as they were.

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

comment on function public.emit_platform_event(text, jsonb) is
  'Fans one platform event out to whoever the engine resolves, adding a human label for any entity_type it carries.';

-- ═══════════════════════════════════════════════════════ and say it properly
--
-- THE TEXT LIVES IN THE FUNCTION, AND ONLY THERE.
--
-- The first attempt UPDATEd the three template rows and left this function
-- alone. It appeared to work, and the very next re-seed put the old wording
-- straight back — because seed_test_data.sql restores system defaults by
-- calling this function rather than restating the text, precisely so the two
-- cannot drift. Its comment says so. The UPDATE was the second copy that
-- comment exists to prevent.
--
-- It only inserts what is missing, so the rows already installed keep their old
-- wording no matter how often it runs. Hence the delete below: remove the three
-- system rows, let the function reinstall them, and the wording exists in one
-- place. `member.invited` is untouched and simply not reinserted.

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
       'A {{ entity_label }} needs your approval'::text,
       '<p>A {{ entity_label }} is waiting for your approval.</p>'
       '<p>This is level {{ level }} of {{ required_levels }}.</p>'
       '<p>Sign in to Neuvto to approve or decline it.</p>'::text),

      ('approval.decided', 'email',
       'A {{ entity_label }} needs your approval',
       '<p>A {{ entity_label }} has moved to you for approval.</p>'
       '<p>Sign in to Neuvto to approve or decline it.</p>'),

      ('approval.completed', 'email',
       'Your {{ entity_label }} was {{ status }}',
       '<p>Your {{ entity_label }} was <strong>{{ status }}</strong>.</p>'
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

comment on function public.ensure_system_notification_templates is
  'Installs the system default templates that are missing. The single source of their wording — the seed calls this rather than restating it.';

-- Only the system defaults. An organisation that has written its own template
-- owns its own wording and is left alone; `notifications` stores rendered text,
-- so nothing already sent is disturbed.
delete from public.notification_templates
 where organization_id is null
   and event_key in ('approval.submitted', 'approval.decided', 'approval.completed');

select public.ensure_system_notification_templates();
