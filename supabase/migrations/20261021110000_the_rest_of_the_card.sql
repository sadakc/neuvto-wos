-- ============================================================================
-- NEUVTO WOS — the rest of the Employee Card (D97, D98, D99, D100)
-- ============================================================================
--
-- Four things the card still lacked (NEUVTO_EMPLOYEE_MASTER §6, §7):
--
--   D97  THIS YEAR. Overview's fourth card: leave left of each kind and what
--        the person is still waiting on. employee_this_year(). For the person,
--        the Employee Admin and their manager; nobody else. Attendance and the
--        last appraisal join it when those modules exist.
--
--   D98  PROOF ON AN ADDRESS. A document attached to one address row
--        (employee_documents.address_id), filed, opened and logged exactly as
--        the Documents tab's are (D95), by the same two people. An address row
--        never changes (rule 2); the proof is a document pointing at it, so it
--        can be added after the fact, to an archived row too, and replaced
--        without touching the address.
--
--   D99  ONBOARDING REMINDERS. Each company sets how often its Employee Admins
--        are reminded of records with mandatory checklist items past due, and
--        after how many days past due its Super Admins are told instead. A
--        daily job sends one email per company, never one per record.
--
--   D100 EVERY LOOK IS LOGGED. employee_card() writes who opened whose record
--        before it returns any of it (bundle §05: "log every record view, not
--        just every change"). Looks at your own record are not logged. The
--        person and a Super Admin see who looked. Kept three years.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════ D100 the log

create table if not exists public.employee_card_views (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id     uuid not null references public.employees(id) on delete cascade,
  viewer_id       uuid not null references public.profiles(id) on delete cascade,
  viewed_at       timestamptz not null default now()
);

create index if not exists idx_card_views_record
  on public.employee_card_views (employee_id, viewed_at desc);
create index if not exists idx_card_views_viewer
  on public.employee_card_views (viewer_id, employee_id, viewed_at desc);

alter table public.employee_card_views enable row level security;
revoke all on public.employee_card_views from anon, authenticated;

comment on table public.employee_card_views is
  'D100 — every opening of somebody else''s record, by whom and when; ten minutes of looking is one row. Append-only; kept three years.';

/** Append-only, like the reveal log: only the operator's purge and the three-year rule delete. */
create or replace function public.tf_card_views_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_setting('neuvto.purge', true) = 'on' then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE'
     and current_setting('neuvto.retention', true) = 'on'
     and old.viewed_at < now() - interval '3 years' then
    return old;
  end if;
  raise exception 'VIEW_LOG_IS_APPEND_ONLY' using errcode = 'P0001';
end $$;

drop trigger if exists card_views_append_only on public.employee_card_views;
create trigger card_views_append_only
  before update or delete on public.employee_card_views
  for each row execute function public.tf_card_views_append_only();

create or replace function public.employee_card_views_prune()
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare n integer;
begin
  perform set_config('neuvto.retention', 'on', true);
  delete from public.employee_card_views where viewed_at < now() - interval '3 years';
  get diagnostics n = row_count;
  perform set_config('neuvto.retention', '', true);
  return n;
end $$;

comment on function public.employee_card_views_prune is
  'D100 — deletes record-view rows older than three years. Scheduled daily; never callable by a signed-in user.';

revoke all on function public.employee_card_views_prune() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule('neuvto-employee-view-retention')
    where exists (select 1 from cron.job where jobname = 'neuvto-employee-view-retention');
  perform cron.schedule(
    'neuvto-employee-view-retention',
    '10 19 * * *',
    $job$select public.employee_card_views_prune()$job$
  );
end $$;

/** Who has looked at a record, newest first: the person themselves and a Super Admin. */
create or replace function public.employee_card_views_list(_employee_id uuid)
returns table (viewer_name text, viewed_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rel text[] := public.employee_relationship(_employee_id);
begin
  if v_rel is null or not public.module_enabled_for(public.current_org_id(), 'employee')
     or not ('self' = any (v_rel) or public.is_super_admin()) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  return query
    select coalesce(p.full_name, p.email)::text, v.viewed_at
      from public.employee_card_views v
      join public.profiles p on p.id = v.viewer_id
     where v.employee_id = _employee_id
     order by v.viewed_at desc
     limit 200;
end $$;

comment on function public.employee_card_views_list is
  'D100 — who opened this record and when, newest first. The person and a Super Admin only.';

revoke all on function public.employee_card_views_list(uuid) from public, anon;
grant execute on function public.employee_card_views_list(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════ D98 proof on an address

alter table public.employee_documents drop constraint if exists employee_documents_doc_type_check;
alter table public.employee_documents add constraint employee_documents_doc_type_check
  check (doc_type in (
    'offer_letter', 'appointment_letter', 'aadhaar', 'pan', 'pf_nomination',
    'bank_proof', 'education', 'relieving_letter', 'police_verification',
    'passport', 'insurance_nomination', 'other', 'address_proof'));

alter table public.employee_documents
  add column if not exists address_id uuid references public.employee_addresses(id) on delete restrict;

-- An address proof is about one address, and only an address proof is.
alter table public.employee_documents drop constraint if exists address_proof_names_its_address;
alter table public.employee_documents add constraint address_proof_names_its_address
  check ((doc_type = 'address_proof') = (address_id is not null));

create index if not exists idx_employee_documents_address
  on public.employee_documents (address_id)
  where address_id is not null and replaced_at is null and removed_at is null;

comment on column public.employee_documents.address_id is
  'D98 — the address row an address proof is for. Set for address_proof and nothing else.';

/**
 * Files an uploaded proof against one address row, replacing (never
 * overwriting) the proof before it. The person or the Employee Admin, on any
 * of the record's addresses, current or archived. Opened, verified and
 * removed with the D95 functions.
 */
create or replace function public.employee_address_attach_proof(
  _address_id  uuid,
  _file_path   text,
  _file_name   text,
  _mime_type   text,
  _size_bytes  integer
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  v_a   public.employee_addresses%rowtype;
  v_id  uuid;
begin
  select * into v_a from public.employee_addresses
   where id = _address_id and organization_id = v_org and deleted_at is null;
  if v_a.id is null or not public.employee_documents_allowed(v_a.employee_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if _file_path is null or _file_path not like v_org::text || '/' || v_a.employee_id::text || '/%' then
    raise exception 'FILE_NOT_IN_RECORD' using errcode = 'P0001';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'employee-documents' and o.name = _file_path) then
    raise exception 'FILE_NOT_UPLOADED' using errcode = 'P0001';
  end if;

  update public.employee_documents
     set replaced_at = now()
   where address_id = v_a.id and replaced_at is null and removed_at is null;

  begin
    insert into public.employee_documents
      (organization_id, employee_id, doc_type, address_id, file_path, file_name, mime_type,
       size_bytes, uploaded_by)
    values
      (v_org, v_a.employee_id, 'address_proof', v_a.id, _file_path,
       left(coalesce(nullif(btrim(_file_name), ''), 'proof'), 200), _mime_type, _size_bytes,
       (select auth.uid()))
    returning id into v_id;
  exception when check_violation then
    raise exception 'INVALID_DOCUMENT' using errcode = 'P0001';
  when unique_violation then
    raise exception 'FILE_ALREADY_FILED' using errcode = 'P0001';
  end;
  return v_id;
end $$;

comment on function public.employee_address_attach_proof is
  'D98 — files an uploaded proof against one address row, replacing the one before it. The person or the Employee Admin.';

revoke all on function public.employee_address_attach_proof(uuid, text, text, text, integer) from public, anon;
grant execute on function public.employee_address_attach_proof(uuid, text, text, text, integer) to authenticated;

-- Reproduced from 20261014100000_the_record_is_written.sql. The diff: the
-- result names every row it added ('added'), so the screen can attach the
-- proof to the address it was given for.

create or replace function public.employee_add_address(_employee_id uuid, _values jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_from  date;
  v_type  text := _values ->> 'addressType';
  v_open  public.employee_addresses%rowtype;
  v_types text[];
  v_closed jsonb := '[]'::jsonb;
  v_id    uuid;
  v_ids   jsonb := '[]'::jsonb;
  t       text;
begin
  perform public.employee_require_admin(_employee_id);
  perform public.restricted_known_keys(_values, array['addressType','effectiveFrom','line','city',
    'district','state','pincode','nearestPoliceStation','alsoPermanent']);
  begin
    v_from := (_values ->> 'effectiveFrom')::date;
  exception when others then
    raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'effectiveFrom';
  end;
  if v_from is null then
    raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'effectiveFrom';
  end if;

  v_types := array[v_type];
  if v_type = 'present' and coalesce((_values ->> 'alsoPermanent')::boolean, false) then
    v_types := v_types || 'permanent'::text;
  end if;

  foreach t in array v_types loop
    select * into v_open from public.employee_addresses
     where employee_id = _employee_id and address_type = t and effective_to is null;
    if found then
      if v_from <= v_open.effective_from then
        raise exception 'EFFECTIVE_DATE_CLASH' using errcode = 'P0001',
          detail = to_char(v_open.effective_from, 'YYYY-MM-DD');
      end if;
      update public.employee_addresses set effective_to = v_from where id = v_open.id;
      v_closed := v_closed || jsonb_build_object('id', v_open.id, 'addressType', t,
                                                 'lastDay', v_from - 1);
    end if;
    begin
      insert into public.employee_addresses
        (organization_id, employee_id, address_type, line, city, district, state, pincode,
         nearest_police_station, effective_from)
      select e.organization_id, e.id, t, btrim(_values ->> 'line'), btrim(_values ->> 'city'),
             nullif(btrim(_values ->> 'district'), ''), btrim(_values ->> 'state'),
             btrim(_values ->> 'pincode'), nullif(btrim(_values ->> 'nearestPoliceStation'), ''), v_from
        from public.employees e where e.id = _employee_id
      returning id into v_id;
      v_ids := v_ids || jsonb_build_object('id', v_id, 'addressType', t);
    exception
      when exclusion_violation then
        raise exception 'EFFECTIVE_DATE_CLASH' using errcode = 'P0001';
      when check_violation or not_null_violation then
        get stacked diagnostics t = constraint_name;
        raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = coalesce(nullif(t, ''), sqlerrm);
    end;
  end loop;

  return jsonb_build_object('id', v_id, 'closed', v_closed, 'added', v_ids);
end $$;



-- ═══════════════════════════════════════════════════════════ D97 this year

/**
 * Overview's "This year" card. Leave: every type with a balance (paid and
 * earned; unpaid has none), this leave year's, as the person's own Leave
 * screen shows it. Null when the company has not switched Leave on. Open
 * requests: what the person has asked for and is still waiting on, by kind,
 * and their open record corrections.
 *
 * The person, the Employee Admin and the person's manager. Nobody else; a
 * colleague's leave is not a colleague's business.
 *
 * Read only: a balance row not yet made is worked out, never created, so
 * looking at somebody's card cannot change their leave.
 */
create or replace function public.employee_this_year(_employee_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  v_rel text[] := public.employee_relationship(_employee_id);
  v_e   public.employees%rowtype;
  v_fy  text;
  v_leave jsonb;
begin
  if v_rel is null or not public.module_enabled_for(v_org, 'employee')
     or not ('self' = any (v_rel) or 'admin' = any (v_rel) or 'approver' = any (v_rel)) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  select * into v_e from public.employees where id = _employee_id;

  if v_e.profile_id is not null and public.module_enabled_for(v_org, 'leave') then
    v_fy := public.get_financial_year(v_org, public.org_today(v_org));
    select coalesce(jsonb_agg(jsonb_build_object(
             'leaveTypeId', t.id,
             'name',        t.name,
             'kind',        t.kind,
             'entitled',    coalesce(b.entitled_days, public.calculate_entitlement(v_e.profile_id, t.id, v_fy))
                              + coalesce(b.carryforward_days, 0),
             'used',        coalesce(b.used_days, 0),
             'pending',     coalesce(b.pending_days, 0),
             'available',   coalesce(b.available_days, public.calculate_entitlement(v_e.profile_id, t.id, v_fy)))
           order by t.name), '[]'::jsonb)
      into v_leave
      from public.leave_types t
      left join public.leave_balances b
        on b.employee_id = v_e.profile_id and b.leave_type_id = t.id and b.fy_label = v_fy
       and b.deleted_at is null
     where t.organization_id = v_org and t.deleted_at is null and t.status = 'active'
       and t.kind <> 'unpaid';
  end if;

  return jsonb_build_object(
    'leaveYear', v_fy,
    'leave', v_leave,
    'openRequests', coalesce((
      select jsonb_agg(jsonb_build_object('label', x.label, 'count', x.n) order by x.label)
        from (select public.approval_entity_label(r.entity_type) as label, count(*) as n
                from public.approval_requests r
               where v_e.profile_id is not null
                 and r.requester_id = v_e.profile_id and r.organization_id = v_org
                 and r.status = 'pending' and r.deleted_at is null
               group by 1) x), '[]'::jsonb),
    'openCorrections', (select count(*) from public.employee_change_requests c
                         where c.employee_id = _employee_id and c.status = 'open')
  );
end $$;

comment on function public.employee_this_year is
  'D97 — the card''s "This year": leave left of each kind (null without Leave) and what the person is waiting on. The person, the Employee Admin and their manager.';

revoke all on function public.employee_this_year(uuid) from public, anon;
grant execute on function public.employee_this_year(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════ D99 onboarding reminders

create table if not exists public.employee_onboarding_settings (
  organization_id     uuid primary key references public.organizations(id) on delete cascade,
  -- 0: never remind.
  remind_every_days   smallint not null default 3 check (remind_every_days between 0 and 30),
  -- 0: never tell the Super Admins.
  escalate_after_days smallint not null default 7 check (escalate_after_days between 0 and 90),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null
);

create trigger set_audit_fields before insert or update on public.employee_onboarding_settings
  for each row execute function public.set_audit_fields();
create trigger write_audit_log after insert or update or delete on public.employee_onboarding_settings
  for each row execute function public.write_audit_log();
alter table public.employee_onboarding_settings enable row level security;
revoke all on public.employee_onboarding_settings from anon, authenticated;

create table if not exists public.employee_onboarding_reminders (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind            text not null check (kind in ('reminder', 'escalation')),
  people          integer not null check (people > 0),
  detail          jsonb not null,
  sent_at         timestamptz not null default now()
);
create index if not exists idx_onboarding_reminders_recent
  on public.employee_onboarding_reminders (organization_id, kind, sent_at desc);
alter table public.employee_onboarding_reminders enable row level security;
revoke all on public.employee_onboarding_reminders from anon, authenticated;

comment on table public.employee_onboarding_settings is
  'D99 — how often a company''s Employee Admins are reminded of overdue onboarding items, and when its Super Admins are told. No row: every 3 days, after 7.';
comment on table public.employee_onboarding_reminders is
  'D99 — each reminder and escalation sent: when, to whom in general terms, and which records were in it.';

/** The company's reminder settings and the last of each sent. The Employee Admin. */
create or replace function public.employee_onboarding_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := public.employee_require_config_admin();
  v_s   public.employee_onboarding_settings%rowtype;
begin
  select * into v_s from public.employee_onboarding_settings where organization_id = v_org;
  return jsonb_build_object(
    'remindEveryDays',   coalesce(v_s.remind_every_days, 3),
    'escalateAfterDays', coalesce(v_s.escalate_after_days, 7),
    'lastReminder', (select jsonb_build_object('sentAt', r.sent_at, 'people', r.people)
                       from public.employee_onboarding_reminders r
                      where r.organization_id = v_org and r.kind = 'reminder'
                      order by r.sent_at desc limit 1),
    'lastEscalation', (select jsonb_build_object('sentAt', r.sent_at, 'people', r.people)
                         from public.employee_onboarding_reminders r
                        where r.organization_id = v_org and r.kind = 'escalation'
                        order by r.sent_at desc limit 1)
  );
end $$;

revoke all on function public.employee_onboarding_settings() from public, anon;
grant execute on function public.employee_onboarding_settings() to authenticated;

create or replace function public.employee_save_onboarding_settings(_remind_every_days integer, _escalate_after_days integer)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_org uuid := public.employee_require_config_admin();
begin
  if _remind_every_days is null or _remind_every_days not between 0 and 30
     or _escalate_after_days is null or _escalate_after_days not between 0 and 90 then
    raise exception 'INVALID_VALUE' using errcode = 'P0001';
  end if;
  insert into public.employee_onboarding_settings (organization_id, remind_every_days, escalate_after_days)
  values (v_org, _remind_every_days, _escalate_after_days)
  on conflict (organization_id)
  do update set remind_every_days = excluded.remind_every_days,
                escalate_after_days = excluded.escalate_after_days;
end $$;

revoke all on function public.employee_save_onboarding_settings(integer, integer) from public, anon;
grant execute on function public.employee_save_onboarding_settings(integer, integer) to authenticated;

/**
 * Every record in a company still being onboarded or working, with the
 * mandatory items past due and how many days past due the oldest is.
 * Deactivated and removed records are not chased.
 */
create or replace function public.employee_onboarding_overdue(_org_id uuid)
returns table (employee_id uuid, full_name text, items text[], days_overdue integer)
language sql
stable
security definer
set search_path = public
as $$
  select e.id,
         coalesce(p.full_name, i.full_name, e.draft_full_name)::text,
         array_agg(g ->> 'label' order by g ->> 'dueOn'),
         max(public.org_today(_org_id) - (g ->> 'dueOn')::date)::integer
    from public.employees e
    left join public.profiles p on p.id = e.profile_id
    left join public.invitations i on i.id = e.invitation_id
   cross join lateral jsonb_array_elements(public.employee_onboarding_gaps(e.id)) g
   where e.organization_id = _org_id and e.deleted_at is null
     and (p.is_active or (p.id is null and (i.id is not null or e.draft_full_name is not null)))
     and (g ->> 'overdue')::boolean
   group by e.id, p.full_name, i.full_name, e.draft_full_name
$$;

revoke all on function public.employee_onboarding_overdue(uuid) from public, anon, authenticated;

/**
 * The daily job. For each company with the Employee module on: when its
 * cadence has come round since the last one, one email to its Employee Admins
 * naming every record with a mandatory item past due; and one to its Super
 * Admins naming those past due by the escalation window or more. Nothing
 * overdue, nothing sent and nothing recorded.
 *
 * "Come round" allows an hour's slack, so a daily job a few seconds late does
 * not slip a whole day.
 */
create or replace function public.employee_onboarding_remind_due()
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  o        record;
  v_remind integer;
  v_after  integer;
  v_list   jsonb;
  v_names  text;
  v_n      integer;
  v_sent   integer := 0;
  k        text;
begin
  for o in
    select om.organization_id as id
      from public.organization_modules om
     where om.module_key = 'employee' and om.enabled and om.deleted_at is null
  loop
    select coalesce(s.remind_every_days, 3), coalesce(s.escalate_after_days, 7)
      into v_remind, v_after
      from (select 1) one
      left join public.employee_onboarding_settings s on s.organization_id = o.id;
    continue when v_remind = 0;

    foreach k in array array['reminder', 'escalation'] loop
      continue when k = 'escalation' and v_after = 0;
      continue when exists (
        select 1 from public.employee_onboarding_reminders r
         where r.organization_id = o.id and r.kind = k
           and r.sent_at > now() - make_interval(days => v_remind) + interval '1 hour');

      select coalesce(jsonb_agg(jsonb_build_object(
               'employeeId', x.employee_id, 'name', x.full_name,
               'items', to_jsonb(x.items), 'daysOverdue', x.days_overdue)
             order by x.days_overdue desc, x.full_name), '[]'::jsonb)
        into v_list
        from public.employee_onboarding_overdue(o.id) x
       where k = 'reminder' or x.days_overdue >= v_after;
      v_n := jsonb_array_length(v_list);
      continue when v_n = 0;

      -- Plain text, escaped by the engine: names and item labels, never a value.
      select string_agg(format('%s (%s)', coalesce(e ->> 'name', 'Unnamed'),
                               (select string_agg(it, ', ') from jsonb_array_elements_text(e -> 'items') it)),
                        '; ' order by ord)
        into v_names
        from jsonb_array_elements(v_list) with ordinality as t(e, ord)
       where ord <= 20;
      if v_n > 20 then
        v_names := v_names || format('; and %s more', v_n - 20);
      end if;

      insert into public.employee_onboarding_reminders (organization_id, kind, people, detail)
      values (o.id, k, v_n, v_list);

      perform public.emit_platform_event(
        case k when 'reminder' then 'employee.onboarding_overdue' else 'employee.onboarding_escalated' end,
        jsonb_build_object(
          'organization_id', o.id,
          'audience',        case k when 'reminder' then 'module_admins' else 'super_admins' end,
          'module_key',      'employee',
          'count',           v_n,
          'people',          v_names,
          'days',            v_after));
      v_sent := v_sent + 1;
    end loop;
  end loop;
  return v_sent;
end $$;

comment on function public.employee_onboarding_remind_due is
  'D99 — the daily onboarding reminder: the Employee Admins on each company''s cadence, the Super Admins for items past the escalation window. One email per company and kind.';

revoke all on function public.employee_onboarding_remind_due() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule('neuvto-employee-onboarding-reminders')
    where exists (select 1 from cron.job where jobname = 'neuvto-employee-onboarding-reminders');
  -- 03:30 UTC is 09:00 in India: the start of an Admin's day.
  perform cron.schedule(
    'neuvto-employee-onboarding-reminders',
    '30 3 * * *',
    $job$select public.employee_onboarding_remind_due()$job$
  );
end $$;

insert into public.notification_templates
  (organization_id, event_key, channel, subject_template, body_template)
select null::uuid, v.event_key, v.channel, v.subject, v.body
  from (values
    ('employee.onboarding_overdue'::text, 'email'::public.notification_channel,
     'Onboarding items past due for {{ count }} people'::text,
     '<p>These records have mandatory onboarding items past due: {{ people }}.</p>'
     '<p>Sign in to Neuvto and open Employees, then Add Employee, to see what each one still needs.</p>'::text),
    ('employee.onboarding_escalated', 'email',
     'Onboarding items {{ days }} or more days past due for {{ count }} people',
     '<p>These records have mandatory onboarding items {{ days }} or more days past due: {{ people }}.</p>'
     '<p>Your Employee Admins have been reminded. Sign in to Neuvto and open Employees, then Add Employee, to see what each one still needs.</p>')
  ) as v(event_key, channel, subject, body)
 where not exists (
   select 1 from public.notification_templates t
    where t.organization_id is null and t.event_key = v.event_key and t.channel = v.channel
      and t.deleted_at is null);

-- Reproduced from 20261020150000_approvals_can_be_delegated.sql. The diff: two
-- generic audiences, a module's admins and the Super Admins (D99).
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
    -- The approver whose turn it is, and whoever they have handed it to (D92).
    return query select nullif(_payload->>'approver_id', '')::uuid
                  where nullif(_payload->>'approver_id', '') is not null
                 union
                 select d.delegate_id from public.approval_delegations d
                  where nullif(_payload->>'approver_id', '') is not null
                    and public.approval_delegation_active(
                          (_payload->>'approver_id')::uuid, d.delegate_id,
                          _payload->>'entity_type', d.organization_id);

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
         and s.deleted_at is null
      union
      -- D92: and whoever that approver has handed their approvals to.
      select d.delegate_id
        from public.approval_steps s
        join public.approval_requests r on r.id = s.approval_request_id
        join public.approval_delegations d on d.delegator_id = s.approver_id
       where s.approval_request_id = v_request_id
         and r.status = 'pending'
         and s.level = r.current_level
         and s.decision = 'pending'
         and s.deleted_at is null
         and public.approval_delegation_active(s.approver_id, d.delegate_id,
                                               r.entity_type, r.organization_id);

  elsif _event_key = 'approval.completed' then
    -- The person who asked. They have been waiting.
    return query select nullif(_payload->>'requester_id', '')::uuid
                  where nullif(_payload->>'requester_id', '') is not null;

  elsif _event_key = 'approval.escalated' then
    -- D87. The one it moved to, so they act; the one it moved from, so they
    -- know it has gone.
    return query
      select p.id from public.profiles p
       where p.id in (nullif(_payload->>'to_approver_id', '')::uuid,
                      nullif(_payload->>'from_approver_id', '')::uuid)
         and p.is_active and p.deleted_at is null
         and (v_org is null or p.organization_id = v_org);

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

  -- D99. A module's administrators: the company-wide Admins, who administer
  -- every module, and whoever was made that module's admin (D84).
  elsif _payload->>'audience' = 'module_admins' and v_org is not null
        and nullif(_payload->>'module_key', '') is not null then
    return query
      select ur.user_id
        from public.user_roles ur
        join public.profiles p on p.id = ur.user_id
       where ur.organization_id = v_org
         and ur.role in ('super_admin', 'org_admin', 'hr_admin')
         and ur.deleted_at is null
         and p.organization_id = v_org and p.is_active and p.deleted_at is null
      union
      select ma.user_id
        from public.module_admins ma
        join public.profiles p on p.id = ma.user_id
       where ma.organization_id = v_org
         and ma.module_key = _payload->>'module_key'
         and ma.deleted_at is null
         and p.organization_id = v_org and p.is_active and p.deleted_at is null;

  -- D99. The company's Super Admins: where something left too long goes.
  elsif _payload->>'audience' = 'super_admins' and v_org is not null then
    return query
      select distinct ur.user_id
        from public.user_roles ur
        join public.profiles p on p.id = ur.user_id
       where ur.organization_id = v_org
         and ur.role = 'super_admin'
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

-- ═══════════════════════════════════════════════════════════ what a record still needs, dated

-- Reproduced from 20261016100000_configuration.sql. The diff: each gap says
-- when it fell due (dueOn), which the reminders count from (D99).
create or replace function public.employee_onboarding_gaps(_employee_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_e   public.employees%rowtype;
  v_p   public.profiles%rowtype;
  v_inv public.invitations%rowtype;
  v_st  public.employee_statutory%rowtype;
  v_joined date;
  v_today  date;
  v_out jsonb := '[]'::jsonb;
  it    record;
  met   boolean;
begin
  select * into v_e from public.employees where id = _employee_id;
  select * into v_p from public.profiles where id = v_e.profile_id;
  select * into v_inv from public.invitations where id = v_e.invitation_id;
  select * into v_st from public.employee_statutory where employee_id = _employee_id;
  v_joined := coalesce(v_p.joined_date, v_inv.joined_date, v_e.draft_joined_date);
  v_today := public.org_today(v_e.organization_id);

  for it in
    select d.item_key, d.label, coalesce(o.due_within_days, d.due_within_days) as due,
           coalesce(o.mandatory, d.mandatory) as mandatory
      from public.employee_onboarding_defaults() d
      left join public.employee_onboarding_items o
        on o.organization_id = v_e.organization_id and o.item_key = d.item_key
     order by d.sort
  loop
    continue when not it.mandatory;
    met := case it.item_key
      when 'work_email'        then coalesce(v_p.email, v_inv.email, v_e.draft_email) is not null
      when 'designation'       then v_e.designation_id is not null
      when 'reports_to'        then coalesce(v_p.manager_id::text, v_e.draft_manager_id::text, v_inv.manager_email) is not null
      when 'deployment'        then exists (select 1 from public.employee_deployments d
                                             where d.employee_id = _employee_id and d.effective_to is null)
      when 'present_address'   then exists (select 1 from public.employee_addresses a
                                             where a.employee_id = _employee_id and a.address_type = 'present'
                                               and a.effective_to is null)
      when 'emergency_contact' then v_e.emergency_contact_phone is not null
      when 'date_of_birth'     then v_e.date_of_birth is not null
      when 'identity_number'   then v_st.aadhaar_last4 is not null or v_st.pan_last4 is not null
      when 'uan'               then v_st.uan_last4 is not null
      when 'bank'              then exists (select 1 from public.employee_bank b
                                             where b.employee_id = _employee_id and b.account_last4 is not null)
      when 'nominees'          then exists (select 1 from public.nomination_versions n
                                             where n.employee_id = _employee_id and n.effective_to is null)
      when 'police_verification' then v_st.police_verification = 'verified'
      else true end;
    if not coalesce(met, false) then
      v_out := v_out || jsonb_build_object(
        'key', it.item_key, 'label', it.label,
        'overdue', v_joined is not null and v_today > v_joined + it.due,
        -- D99: when it fell due, for the reminders.
        'dueOn', v_joined + it.due);
    end if;
  end loop;
  return v_out;
end $$;

-- ═══════════════════════════════════════════════════════════ the card, logged

-- Reproduced from 20261017120000_the_employee_admin_holds_the_numbers.sql. The
-- diff: VOLATILE, the view written before anything is returned (D100), each
-- address's proof for the person and the Employee Admin (D98), and two
-- capabilities, canSeeViews and canSeeThisYear.
CREATE OR REPLACE FUNCTION public.employee_card(_employee_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid   uuid := (select auth.uid());
  v_org   uuid := public.current_org_id();
  v_id    uuid := _employee_id;
  v_rel   text[];
  v_e     public.employees%rowtype;
  v_p     public.profiles%rowtype;
  v_inv   public.invitations%rowtype;
  v_card  jsonb;
  v_st    public.employee_statutory%rowtype;
  v_bk    public.employee_bank%rowtype;
  self_   boolean;
  admin_  boolean;
  pay_    boolean;
  stat_   boolean;
  appr_   boolean;
begin
  if v_uid is null or v_org is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;
  if not public.module_enabled_for(v_org, 'employee') then
    raise exception 'MODULE_NOT_ENABLED' using errcode = 'P0001';
  end if;

  if v_id is null then
    select id into v_id from public.employees
     where profile_id = v_uid and organization_id = v_org and deleted_at is null;
  end if;

  v_rel := public.employee_relationship(v_id);
  -- Absent and other-organisation answer identically: NOT_FOUND, never
  -- FORBIDDEN, so the card cannot be used to test whether an id exists
  -- somewhere else (D40's rule, applied to records).
  if v_rel is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  self_  := 'self' = any (v_rel);
  admin_ := 'admin' = any (v_rel);
  pay_   := 'payroll' = any (v_rel);
  stat_  := 'statutory' = any (v_rel);
  appr_  := 'approver' = any (v_rel);

  select * into v_e from public.employees where id = v_id;
  select * into v_p from public.profiles where id = v_e.profile_id;
  select * into v_inv from public.invitations where id = v_e.invitation_id;

  -- E8: a draft is somebody the company has not even invited yet. Only an
  -- Admin knows they exist; to anybody else the id answers like any other
  -- that is not theirs to see.
  if v_p.id is null and v_inv.id is null and not admin_ then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  -- D100. Every look at somebody else's record is written down before any of
  -- it is returned: if the log cannot be written, nothing is shown. Looks by
  -- the same person at the same record within ten minutes are one look (the
  -- screen re-reads the card after every save).
  if not self_ and not exists (
    select 1 from public.employee_card_views cv
     where cv.viewer_id = v_uid and cv.employee_id = v_e.id
       and cv.viewed_at > now() - interval '10 minutes')
  then
    insert into public.employee_card_views (organization_id, employee_id, viewer_id)
    values (v_org, v_e.id, v_uid);
  end if;

  -- ── everybody in the organisation: who they are and where they work
  v_card := jsonb_build_object(
    'id',            v_e.id,
    'employeeCode',  v_e.employee_code,
    'fullName',      coalesce(v_p.full_name, v_inv.full_name, v_e.draft_full_name),
    'workEmail',     coalesce(v_p.email, v_inv.email, v_e.draft_email),
    'mobile',        coalesce(v_p.phone, v_inv.phone, v_e.draft_phone),
    'alternateMobile', v_e.alternate_mobile,
    'status',        v_e.status,
    'isActive',      coalesce(v_p.is_active, false),
    'hasSignedIn',   v_p.id is not null,
    'stage',         case when v_p.id is not null then (case when v_p.is_active then 'active' else 'deactivated' end)
                          when v_inv.id is not null then 'invited'
                          when v_e.draft_full_name is not null then 'draft' else 'removed' end,
    'dateOfJoining', coalesce(v_p.joined_date, v_inv.joined_date, v_e.draft_joined_date),
    'designation',   (select jsonb_build_object('id', d.id, 'name', d.name, 'grade', d.grade)
                        from public.designations d where d.id = v_e.designation_id),
    'department',    (select jsonb_build_object('id', d.id, 'name', d.name)
                        from public.departments d
                       where d.id = coalesce(v_p.department_id, v_inv.department_id, v_e.draft_department_id)),
    'reportsTo',     (select jsonb_build_object('id', me.id, 'fullName', m.full_name)
                        from public.profiles m
                        left join public.employees me on me.profile_id = m.id
                       where m.id = coalesce(v_p.manager_id, v_e.draft_manager_id,
                                     (select x.id from public.profiles x
                                       where v_p.id is null and lower(x.email) = lower(v_inv.manager_email)
                                         and x.organization_id = v_org limit 1))),
    'directReportCount', (select count(*) from public.profiles r
                           where r.manager_id = v_p.id and r.deleted_at is null and r.is_active),
    'currentDeployment', (select jsonb_build_object(
                              'unitId', u.id, 'unitName', u.name, 'unitType', u.unit_type,
                              'effectiveFrom', d.effective_from)
                            from public.employee_deployments d
                            join public.deployment_units u on u.id = d.deployment_unit_id
                           where d.employee_id = v_e.id and d.effective_to is null
                             and d.effective_from <= public.org_today(v_org)
                           order by d.effective_from desc limit 1),
    'relationship',  to_jsonb(v_rel)
  );

  -- ── self, admin, payroll, statutory, and their approver: the work record
  if self_ or admin_ or pay_ or stat_ or appr_ then
    v_card := v_card || jsonb_build_object(
      'totalExperienceMonths', public.employee_experience_months(v_e.id),
      'employmentType',  v_e.employment_type,
      'confirmedOn',     v_e.confirmed_on
    );
  end if;

  -- ── self and admin: identity, employment detail, contact beyond the work one
  if self_ or admin_ then
    v_card := v_card || jsonb_build_object(
      'nameAsPerId',     v_e.name_as_per_id,
      'sex',             v_e.sex,
      'dateOfBirth',     v_e.date_of_birth,
      'age',             public.employee_age(v_e.date_of_birth, v_org),
      'maritalStatus',   v_e.marital_status,
      'nationality',     v_e.nationality,
      'nativeState',     v_e.native_state,
      'bloodGroup',      v_e.blood_group,
      'educationQualification', v_e.education_qualification,
      'personalEmail',   v_e.personal_email,
      'reJoiningDate',   v_e.re_joining_date,
      'terminationDate', v_e.termination_date,
      'terminationReason', v_e.termination_reason,
      'reasonForLeavingLastOrg', v_e.reason_for_leaving_last_org,
      'physical', jsonb_build_object('heightCm', v_e.height_cm, 'chestCm', v_e.chest_cm,
                                     'weightKg', v_e.weight_kg),
      'previousOrganisations', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', po.id, 'organisationName', po.organisation_name,
                 'designation', po.designation, 'fromDate', po.from_date, 'toDate', po.to_date,
                 'reasonForLeaving', po.reason_for_leaving) order by po.from_date desc)
          from public.previous_organisations po where po.employee_id = v_e.id), '[]'::jsonb)
    );
  end if;

  -- ── self, admin and their approver: who to call in an emergency
  if self_ or admin_ or appr_ then
    v_card := v_card || jsonb_build_object(
      'emergencyContact', jsonb_build_object(
        'name', v_e.emergency_contact_name,
        'relation', v_e.emergency_contact_relation,
        'phone', v_e.emergency_contact_phone)
    );
  end if;

  -- ── self, admin, statutory: police station, and every address ever held
  if self_ or admin_ or stat_ then
    v_card := v_card || jsonb_build_object(
      'nearestPoliceStation', v_e.nearest_police_station,
      'addresses', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', a.id, 'addressType', a.address_type, 'line', a.line, 'city', a.city,
                 'district', a.district, 'state', a.state, 'pincode', a.pincode,
                 'nearestPoliceStation', a.nearest_police_station,
                 'effectiveFrom', a.effective_from, 'effectiveTo', a.effective_to,
                 'recordedBy', (select coalesce(full_name, email) from public.profiles where id = a.created_by),
                 'recordedAt', a.created_at)
               -- D98: the proof on file, for the two who may open it.
               || case when self_ or admin_ then jsonb_build_object('proof', (
                    select jsonb_build_object('documentId', d.id, 'fileName', d.file_name,
                                              'uploadedAt', d.uploaded_at,
                                              'verified', d.verified_at is not null)
                      from public.employee_documents d
                     where d.address_id = a.id and d.replaced_at is null and d.removed_at is null))
                  else '{}'::jsonb end
               -- Open rows first, then newest first (§2).
               order by (a.effective_to is not null), a.effective_from desc)
          from public.employee_addresses a where a.employee_id = v_e.id), '[]'::jsonb)
    );
  end if;

  -- ── self, admin, payroll, statutory: family and nominations
  if self_ or admin_ or pay_ or stat_ then
    v_card := v_card || jsonb_build_object(
      'familyMembers', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', f.id, 'relation', f.relation, 'name', f.name,
                 'dateOfBirth', f.date_of_birth, 'isDependent', f.is_dependent)
               order by f.sort_order, f.created_at)
          from public.family_members f where f.employee_id = v_e.id), '[]'::jsonb),
      'nominations', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', nv.id, 'scheme', nv.scheme,
                 'effectiveFrom', nv.effective_from, 'effectiveTo', nv.effective_to,
                 'nominees', (select coalesce(jsonb_agg(jsonb_build_object(
                                 'id', n.id, 'name', n.name, 'relation', n.relation,
                                 'dateOfBirth', n.date_of_birth, 'sharePercent', n.share_percent)
                               order by n.share_percent desc, n.name), '[]'::jsonb)
                                from public.nominees n where n.version_id = nv.id))
               order by (nv.effective_to is not null), nv.effective_from desc)
          from public.nomination_versions nv where nv.employee_id = v_e.id), '[]'::jsonb)
    );
  end if;

  -- ── deployments: the whole history for these, only the current one above
  --    for an approver and everybody else (§5)
  if self_ or admin_ or pay_ or stat_ then
    v_card := v_card || jsonb_build_object(
      'deployments', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', d.id, 'unitId', u.id, 'unitName', u.name, 'unitType', u.unit_type,
                 'unitRetired', u.status = 'retired',
                 'effectiveFrom', d.effective_from, 'effectiveTo', d.effective_to,
                 'deploymentOrderRef', d.deployment_order_ref,
                 'expectedDuration', d.expected_duration, 'reason', d.reason,
                 'movedBy', (select coalesce(full_name, email) from public.profiles where id = d.created_by))
               order by (d.effective_to is not null), d.effective_from desc)
          from public.employee_deployments d
          join public.deployment_units u on u.id = d.deployment_unit_id
         where d.employee_id = v_e.id), '[]'::jsonb)
    );
  end if;

  -- ── what the screen may offer. The database still refuses every write it
  --    does not allow; this only stops the screen offering a dead control.
  -- ── E6: statutory numbers, verification, bank, restricted (§5, D80, D85).
  --    Last-four for self and the Employee Admin; UAN, EPF and ESIC in full
  --    for Payroll and Statutory. Everything else in full only through
  --    employee_reveal_restricted(), which logs the opening.
  select * into v_st from public.employee_statutory where employee_id = v_e.id;
  if self_ or admin_ or pay_ or stat_ then
    v_card := v_card || jsonb_build_object('statutory', jsonb_build_object(
      'recorded',             v_st.employee_id is not null,
      'identityDocumentType', v_st.identity_document_type,
      'aadhaarLast4',         v_st.aadhaar_last4,
      'panLast4',             v_st.pan_last4,
      'verifiedOn',           v_st.verified_on,
      'uanLast4',             v_st.uan_last4,
      'epfLast4',             v_st.epf_last4,
      'esicLast4',            v_st.esic_last4,
      'oldUanLast4',          v_st.old_uan_last4,
      'oldEsicLast4',         v_st.old_esic_last4
    ) || case when pay_ or stat_ then jsonb_build_object(
      'uan',           public.restricted_decrypt(v_st.uan_cipher),
      'epfNumber',     public.restricted_decrypt(v_st.epf_cipher),
      'esicNumber',    public.restricted_decrypt(v_st.esic_cipher),
      'oldUan',        public.restricted_decrypt(v_st.old_uan_cipher),
      'oldEsicNumber', public.restricted_decrypt(v_st.old_esic_cipher)
    ) else '{}'::jsonb end);
  end if;

  if self_ or admin_ or stat_ then
    v_card := v_card || jsonb_build_object('verification', jsonb_build_object(
      'policeVerification',    coalesce(v_st.police_verification, 'not_started'),
      'policeVerifiedOn',      v_st.police_verified_on,
      'previousEmployerCheck', coalesce(v_st.previous_employer_check, 'not_started'),
      'educationCheck',        coalesce(v_st.education_check, 'not_started'),
      'reverificationDue',     v_st.reverification_due
    ));
  end if;

  -- Bank: the person themselves (last four), Payroll and, since D85, the
  -- Employee Admin. Not Statutory.
  if self_ or pay_ or admin_ then
    select * into v_bk from public.employee_bank where employee_id = v_e.id;
    v_card := v_card || jsonb_build_object('bank', jsonb_build_object(
      'recorded',        v_bk.employee_id is not null,
      'bankName',        v_bk.bank_name,
      'ifsc',            v_bk.ifsc,
      'accountLast4',    v_bk.account_last4,
      'pennyDropStatus', coalesce(v_bk.penny_drop_status, 'not_checked')
    ) || case when pay_ or admin_ then jsonb_build_object(
      'branch',        v_bk.branch,
      'accountHolder', v_bk.account_holder
    ) else '{}'::jsonb end);
  end if;

  -- Restricted: only whether anything is held. The values come by reveal.
  if self_ or stat_ or admin_ then
    v_card := v_card || jsonb_build_object('restricted', jsonb_build_object(
      'recorded', exists (select 1 from public.employee_restricted where employee_id = v_e.id)));
  end if;

  v_card := v_card || jsonb_build_object('capabilities', jsonb_build_object(
    'canEdit', admin_,
    'canRequestChange', self_ and not admin_,
    'canSeeHistory', self_ or admin_ or pay_ or stat_,
    'canRevealStatutory', stat_ or admin_,
    'canRevealBank', pay_ or admin_,
    'canRevealRestricted', stat_ or admin_,
    'canEditStatutory', admin_ or stat_,
    'canEditVerification', admin_,
    'canEditBank', pay_ or admin_,
    'canEditRestricted', stat_ or admin_,
    'canSeeReveals', self_ or stat_ or public.is_super_admin(),
    -- D100: who has looked at the record, for the person and a Super Admin.
    'canSeeViews', self_ or public.is_super_admin(),
    -- D97: the year so far, for the person, the Employee Admin and their manager.
    'canSeeThisYear', self_ or admin_ or appr_,
    -- E8: the Admin's lifecycle actions, offered only where they can work.
    'canSendInvite', admin_ and v_p.id is null and v_inv.id is null and v_e.draft_full_name is not null,
    'canDeactivate', admin_ and v_p.id is not null and coalesce(v_p.is_active, false) and not self_,
    'canEditDraft',  admin_ and v_p.id is null and v_inv.id is null and v_e.draft_full_name is not null
  ));

  return v_card;
end $function$
;
