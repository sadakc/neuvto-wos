-- Sada, 14 Oct 2026 (D111): a bell, top right, that lists what has happened
-- for you, newest first, the way Teams does; pressing one opens the screen it
-- is about.
--
-- Nothing new is written for it. Every notice the engine already makes for a
-- person (an approval waiting, a decision, a change request) is a row in
-- `notifications` with them as recipient, and that row is what the bell lists:
-- it is there whether or not the email got through. Two additions:
--
--   · a notice can be in the bell only, never emailed: a template whose
--     channel is in_app. Its row is written as already delivered, so the email
--     sender never claims it;
--   · the first such notice: when a person changes their own record (D107,
--     saved at once with no approval), the Employee Admins are told. Every
--     such change was already in the audit log, row before and after; this
--     makes it visible without anybody going looking.
--
--   notifications_feed(limit)        the caller's own, newest first
--   notifications_unread()           how many the caller has not opened
--   notifications_mark_read(ids)     opened; null is every one

-- ═══════════════════════════════════════════════════════ 1 · in the bell only

do $$
declare
  v_def text := pg_get_functiondef('public.notify(text,uuid,jsonb)'::regprocedure);
  v_new text;
begin
  v_new := replace(v_def, $q$     and channel = 'email'
     and is_active$q$, $q$     and channel in ('email', 'in_app')
     and is_active$q$);
  v_new := replace(v_new, $q$  insert into public.notifications
    (organization_id, recipient_id, event_key, channel, payload, subject, body)
  values
    (v_org, _recipient_id, _event_key, v_template.channel, coalesce(_payload, '{}'::jsonb),
     public.render_template(v_template.subject_template, _payload),
     public.render_template(v_template.body_template, _payload))
  returning id into v_id;$q$, $q$  -- D111. A notice for the bell alone is delivered the moment it is written,
  -- so the email sender, which claims only what is pending, never sees it.
  insert into public.notifications
    (organization_id, recipient_id, event_key, channel, payload, subject, body, status, sent_at)
  values
    (v_org, _recipient_id, _event_key, v_template.channel, coalesce(_payload, '{}'::jsonb),
     public.render_template(v_template.subject_template, _payload),
     public.render_template(v_template.body_template, _payload),
     case when v_template.channel = 'in_app' then 'sent'::public.notification_status
          else 'pending'::public.notification_status end,
     case when v_template.channel = 'in_app' then now() end)
  returning id into v_id;$q$);
  if v_new = v_def or position($q$channel in ('email', 'in_app')$q$ in v_new) = 0
     or position('D111. A notice for the bell' in v_new) = 0 then
    raise exception 'notify no longer chooses and writes as expected; restate it here';
  end if;
  execute v_new;
end $$;

-- ═══════════════════════════════════════════════════════ 2 · a person changed their own record

insert into public.notification_templates
  (organization_id, event_key, channel, subject_template, body_template)
select null::uuid, 'employee.changed_own_record', 'in_app'::public.notification_channel,
       '{{ person_name }} changed their {{ fields }}',
       '{{ person_name }} changed their own record: {{ fields }}.'
 where not exists (
   select 1 from public.notification_templates t
    where t.organization_id is null and t.event_key = 'employee.changed_own_record'
      and t.deleted_at is null);

/**
 * The person's own save has passed every check: tell the Employee Admins what
 * it changes. Written in the same transaction as the save, so a save that is
 * refused further on tells nobody. An Admin's edits say nothing: they are the
 * ones who would be told.
 */
do $$
declare
  v_def text := pg_get_functiondef('public.employee_require_writer(uuid,text[])'::regprocedure);
  v_anchor text := $q$  if found then
    raise exception 'NOT_YOURS_TO_CHANGE' using errcode = '42501', detail = v_no;
  end if;
$q$;
begin
  if position(v_anchor in v_def) = 0 then
    raise exception 'employee_require_writer no longer refuses as expected; restate it here';
  end if;
  execute replace(v_def, v_anchor, v_anchor || $q$  -- A save that changes nothing of theirs (a family list sent back as it was)
  -- tells nobody.
  if coalesce(cardinality(_fields), 0) = 0 then
    return;
  end if;
  perform public.emit_platform_event('employee.changed_own_record', jsonb_build_object(
    'organization_id', public.current_org_id(),
    'audience',        'module_admins',
    'module_key',      'employee',
    'employee_id',     _employee_id,
    'person_name',     (select coalesce(full_name, email) from public.profiles
                         where id = (select auth.uid())),
    'fields',          coalesce((
      select lower(string_agg(r.label, ', ' order by r.sort))
        from public.employee_field_rules(public.current_org_id()) r
       where r.field_key = any (_fields)), 'record')));
$q$);
end $$;

-- It writes now, so it is no longer read-only.
alter function public.employee_require_writer(uuid, text[]) volatile;

-- ═══════════════════════════════════════════════════════ 3 · the bell

/** The caller's own notices, newest first. Never anybody else's, admins included. */
create or replace function public.notifications_feed(_limit integer default 30)
returns table (id uuid, event_key text, subject text, payload jsonb,
               created_at timestamptz, read_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select n.id, n.event_key, n.subject, n.payload, n.created_at, n.read_at
    from public.notifications n
   where n.recipient_id = (select auth.uid())
     and n.organization_id = public.current_org_id()
     and n.deleted_at is null
     and n.failed_reason is distinct from 'NO_TEMPLATE'
   order by n.created_at desc, n.id desc
   limit least(greatest(coalesce(_limit, 30), 1), 100)
$$;

revoke all on function public.notifications_feed(integer) from public, anon;
grant execute on function public.notifications_feed(integer) to authenticated;

create or replace function public.notifications_unread()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
    from public.notifications n
   where n.recipient_id = (select auth.uid())
     and n.organization_id = public.current_org_id()
     and n.deleted_at is null
     and n.read_at is null
     and n.failed_reason is distinct from 'NO_TEMPLATE'
$$;

revoke all on function public.notifications_unread() from public, anon;
grant execute on function public.notifications_unread() to authenticated;

/** Marks the caller's own as opened: the ones named, or every one for null. */
create or replace function public.notifications_mark_read(_ids uuid[] default null)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare n integer;
begin
  if (select auth.uid()) is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;
  update public.notifications set read_at = now()
   where recipient_id = (select auth.uid())
     and organization_id = public.current_org_id()
     and deleted_at is null
     and read_at is null
     and failed_reason is distinct from 'NO_TEMPLATE'
     and (_ids is null or id = any (_ids));
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.notifications_mark_read(uuid[]) from public, anon;
grant execute on function public.notifications_mark_read(uuid[]) to authenticated;
