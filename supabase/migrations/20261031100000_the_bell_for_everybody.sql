-- Sada, 14 Oct 2026 (D112): the bell for somebody who neither approves nor
-- administers. Only their own: their leave sent, their leave decided, and
-- what is still missing from their own card. Nothing about anybody else.
--
-- The bell was already the person's own (notifications_feed reads only rows
-- addressed to them). What an ordinary person was told was only the final
-- decision on their own request (approval.completed). Two more, both in the
-- bell only:
--
--   approval.sent                 what you raised is waiting for somebody,
--                                 named. Any module's approvals, not leave alone.
--   employee.your_record_needs    what is still missing from your own record
--                                 that is yours to give (an address, a UAN,
--                                 nominees), on the onboarding reminder's
--                                 cadence. Never the company's own items:
--                                 nobody is told their designation is missing.

-- ═══════════════════════════════════════════════════════ 1 · what you raised is waiting

insert into public.notification_templates
  (organization_id, event_key, channel, subject_template, body_template)
select null::uuid, v.event_key, 'in_app'::public.notification_channel, v.subject, v.body
  from (values
    ('approval.sent'::text,
     'Your {{ entity_label }} is waiting for {{ approver_name }}'::text,
     'Your {{ entity_label }} was sent. It is waiting for {{ approver_name }}.'::text),
    ('employee.your_record_needs',
     'Your record still needs {{ items }}',
     'Your record still needs {{ items }}. Add it on your card, or ask with Request a change.')
  ) as v(event_key, subject, body)
 where not exists (
   select 1 from public.notification_templates t
    where t.organization_id is null and t.event_key = v.event_key and t.deleted_at is null);

do $$
declare
  v_def text := pg_get_functiondef('public.approval_submit(text,uuid,jsonb)'::regprocedure);
  v_anchor text := $q$    'required_levels', array_length(v_levels, 1)
  ));
$q$;
begin
  if position(v_anchor in v_def) = 0 then
    raise exception 'approval_submit no longer tells the approver as expected; restate it here';
  end if;
  execute replace(v_def, v_anchor, v_anchor || $q$
  -- D112. And the person who raised it, in their bell: who it is waiting for.
  perform public.emit_platform_event('approval.sent', jsonb_build_object(
    'organization_id',     v_org,
    'recipient_id',        v_requester,
    'approval_request_id', v_request,
    'entity_type',         _entity_type,
    'entity_id',           _entity_id,
    'approver_name',       coalesce((select full_name from public.profiles where id = v_approvers[1]),
                                    'your approver')));
$q$);
end $$;

-- ═══════════════════════════════════════════════════════ 2 · what your own record needs

/** The onboarding items a person can give themselves; the rest are the company's. */
create or replace function public.employee_items_for_the_person()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array['present_address', 'emergency_contact', 'date_of_birth', 'identity_number',
               'uan', 'bank', 'nominees']
$$;

revoke all on function public.employee_items_for_the_person() from public, anon, authenticated;

/**
 * Tells each person who has signed in what their own record still needs, at
 * most once in each reminder period (`every` days). Returns how many were told.
 */
create or replace function public.employee_remind_people(_org uuid, _every integer)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  e      record;
  v_items text;
  v_told integer := 0;
begin
  for e in
    select emp.id, emp.profile_id
      from public.employees emp
      join public.profiles p on p.id = emp.profile_id
     where emp.organization_id = _org and emp.deleted_at is null
       and p.is_active and p.deleted_at is null
  loop
    continue when exists (
      select 1 from public.notifications n
       where n.recipient_id = e.profile_id and n.event_key = 'employee.your_record_needs'
         and n.created_at > now() - make_interval(days => greatest(_every, 1)) + interval '1 hour');
    select lower(string_agg(g ->> 'label', ', ' order by g ->> 'dueOn' nulls last))
      into v_items
      from jsonb_array_elements(public.employee_onboarding_gaps(e.id)) g
     where g ->> 'key' = any (public.employee_items_for_the_person());
    continue when v_items is null;
    perform public.emit_platform_event('employee.your_record_needs', jsonb_build_object(
      'organization_id', _org,
      'recipient_id',    e.profile_id,
      'employee_id',     e.id,
      'items',           v_items));
    v_told := v_told + 1;
  end loop;
  return v_told;
end $$;

revoke all on function public.employee_remind_people(uuid, integer) from public, anon, authenticated;

-- On the onboarding reminder's own run and cadence; a company that switched
-- reminders off (every 0 days) tells nobody.
do $$
declare
  v_def text := pg_get_functiondef('public.employee_onboarding_remind_due()'::regprocedure);
  v_anchor text := $q$    continue when v_remind = 0;
$q$;
begin
  if position(v_anchor in v_def) = 0 then
    raise exception 'employee_onboarding_remind_due no longer reads its cadence as expected; restate it here';
  end if;
  execute replace(v_def, v_anchor, v_anchor || $q$    -- D112. Each person, about their own record.
    perform public.employee_remind_people(o.id, v_remind);
$q$);
end $$;
