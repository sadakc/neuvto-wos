-- ============================================================================
-- NEUVTO WOS — Leave delivers its own summary
--
-- The other half of 20260820100000. The platform decided WHEN; this decides
-- WHAT, and schedules its own cron job, because a module that needs the
-- platform edited to add it is not a module (D30).
--
-- ── the trap that shaped this file
--
-- cron runs as postgres with NO auth.uid(). That splits the existing helpers
-- cleanly in two:
--
--   org_today(_org)               works — assert_own_org() says so in as many
--                                 words: "System contexts (no auth.uid()) are
--                                 unrestricted."
--   leave_taken_report(_from,_to) raises FORBIDDEN — it resolves
--                                 current_org_id() and is_admin(), both empty
--                                 without a JWT.
--
-- So the report bodies move to an org-scoped `_for` sibling and the existing
-- caller-scoped function becomes a four-line wrapper over it. ONE BODY, TWO
-- DOORS. Two copies of "what counts as leave taken" drift, and the drift
-- arrives as an email that disagrees with the screen — which is worse than no
-- email, because nobody knows which one to believe.
--
-- The bodies below were taken from pg_get_functiondef against a freshly reset
-- database and only their headers were edited. That is deliberate: on 7 Aug
-- 2026, reproducing deactivate_employee from a migration file silently reverted
-- it to an older definition and deleted a guard, because a truncated grep had
-- hidden the newer one. leave_taken_report has exactly that shape — TWO
-- definitions, and the later one (20260808120000) added decision_note and a
-- lateral join. Retyping it from the earlier file would have thrown that away.
--
-- ── what the email actually contains
--
-- Counts and names, inside <pre>, not an HTML table. render_template() runs
-- every substituted value through escape_html() (D27), so a payload carrying
-- markup arrives as literal &lt;table&gt;. That is the correct behaviour and
-- this works with it rather than around it: plain text keeps its newlines
-- inside <pre>, and an employee named "<script>" can never reach an inbox as
-- markup.
-- ============================================================================

-- ═════════════════════════════════════════ 1 · the bodies, org-scoped
--
-- Revoked from every client role. The only callers are the wrappers below and
-- the runner at the bottom of this file, all of which are SECURITY DEFINER and
-- do their own gating.

CREATE OR REPLACE FUNCTION public.leave_taken_report_for(_org uuid, _from date, _to date)
 RETURNS TABLE(leave_request_id uuid, employee_name text, department_name text, leave_type_name text, from_date date, to_date date, working_days numeric, status text, submitted_at timestamp with time zone, decided_at timestamp with time zone, decided_by text, decision_note text, reason text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org uuid := _org;
begin
  if not public.module_enabled_for(v_org, 'leave') then
    raise exception 'MODULE_NOT_ENABLED' using errcode = 'P0001';
  end if;
  if _from is null or _to is null or _to < _from then
    return;
  end if;

  return query
    select r.id,
           coalesce(p.full_name, p.email)::text,
           d.name::text,
           t.name::text,
           r.from_date, r.to_date, r.working_days,
           r.status::text,
           r.submitted_at, r.decided_at,
           -- The last person to act and what they said, taken together from the
           -- SAME step. Two subqueries each ordering independently could name
           -- one approver and quote another's comment — rare, and impossible to
           -- spot in a spreadsheet.
           s.approver_name,
           s.comments,
           r.reason
      from public.leave_requests r
      join public.profiles p on p.id = r.employee_id
      join public.leave_types t on t.id = r.leave_type_id
      left join public.departments d on d.id = p.department_id
      left join lateral (
        select coalesce(ap.full_name, ap.email)::text as approver_name,
               st.comments::text                      as comments
          from public.approval_steps st
          join public.profiles ap on ap.id = st.approver_id
         where st.approval_request_id = r.approval_request_id
           and st.decision <> 'pending'
           and st.deleted_at is null
         order by st.decided_at desc
         limit 1
      ) s on true
     where r.organization_id = v_org
       and r.deleted_at is null
       -- OVERLAPS the window, not "starts within it". Leave running from the
       -- 28th to the 3rd belongs in both months' reports; a request that
       -- straddles a quarter boundary is exactly the one payroll asks about.
       and r.from_date <= _to
       and r.to_date   >= _from
     order by r.from_date desc, coalesce(p.full_name, p.email);
end $function$;

revoke all on function public.leave_taken_report_for(uuid, date, date) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.leave_pending_report_for(_org uuid)
 RETURNS TABLE(leave_request_id uuid, employee_name text, department_name text, leave_type_name text, from_date date, to_date date, working_days numeric, submitted_at timestamp with time zone, days_waiting integer, current_level smallint, required_levels smallint, waiting_on text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org uuid := _org;
  v_tz  text;
begin
  if not public.module_enabled_for(v_org, 'leave') then
    raise exception 'MODULE_NOT_ENABLED' using errcode = 'P0001';
  end if;

  select coalesce(s.timezone, 'UTC') into v_tz
    from public.organization_settings s where s.organization_id = v_org;

  return query
    select r.id,
           coalesce(p.full_name, p.email)::text,
           d.name::text,
           t.name::text,
           r.from_date, r.to_date, r.working_days,
           r.submitted_at,
           -- Age in the ORGANISATION's days, not the server's (D9).
           --
           -- `submitted_at::date` does NOT do that. The cast resolves in the
           -- SESSION timezone, which is UTC on Supabase, so only one side of
           -- this subtraction was ever org-local. For Asia/Kolkata that is
           -- wrong for five and a half hours of every day:
           --
           --   submitted_at  2026-08-02 19:00 UTC
           --   local clock   2026-08-03 00:30   → submitted today
           --   ::date        2026-08-02         → yesterday
           --   days_waiting  1                  → for a request a minute old
           --
           -- Invisible whenever the two dates happen to agree, which is most of
           -- the working day, and wrong every evening.
           (public.org_today(v_org)
              - (r.submitted_at at time zone v_tz)::date)::integer,
           ar.current_level, ar.required_levels,
           -- Everyone who could act right now. A level can have more than one
           -- approver and any of them unblocks it, so naming only the first
           -- would send the administrator to chase the wrong person.
           (select string_agg(coalesce(ap.full_name, ap.email), ', '
                              order by coalesce(ap.full_name, ap.email))
              from public.approval_steps s
              join public.profiles ap on ap.id = s.approver_id
             where s.approval_request_id = ar.id
               and s.level = ar.current_level
               and s.decision = 'pending'
               and s.deleted_at is null)
      from public.leave_requests r
      join public.approval_requests ar on ar.id = r.approval_request_id
      join public.profiles p on p.id = r.employee_id
      join public.leave_types t on t.id = r.leave_type_id
      left join public.departments d on d.id = p.department_id
     where r.organization_id = v_org
       and r.deleted_at is null
       and r.status = 'pending_approval'
       and ar.status = 'pending'
       and ar.deleted_at is null
     -- Oldest first. The report exists to surface what has been ignored, and
     -- sorting by date submitted puts that at the top where it belongs.
     order by r.submitted_at;
end $function$;

revoke all on function public.leave_pending_report_for(uuid) from public, anon, authenticated;

-- ═════════════════════════════════════ 2 · the doors the screens already use
--
-- Same signatures, same return shapes, same refusals. The three report
-- components call these unchanged.

create or replace function public.leave_taken_report(_from date, _to date)
returns table (
  leave_request_id uuid, employee_name text, department_name text,
  leave_type_name text, from_date date, to_date date, working_days numeric,
  status text, submitted_at timestamptz, decided_at timestamptz,
  decided_by text, decision_note text, reason text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
begin
  if v_org is null or not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  return query select * from public.leave_taken_report_for(v_org, _from, _to);
end $$;

revoke all on function public.leave_taken_report(date, date) from public, anon;
grant execute on function public.leave_taken_report(date, date) to authenticated;

create or replace function public.leave_pending_report()
returns table (
  leave_request_id uuid, employee_name text, department_name text,
  leave_type_name text, from_date date, to_date date, working_days numeric,
  submitted_at timestamptz, days_waiting integer, current_level smallint,
  required_levels smallint, waiting_on text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
begin
  if v_org is null or not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  return query select * from public.leave_pending_report_for(v_org);
end $$;

revoke all on function public.leave_pending_report() from public, anon;
grant execute on function public.leave_pending_report() to authenticated;

-- ═════════════════════════════════════════ 3 · what Leave offers to schedule

insert into public.report_definitions (report_key, module_key, title, description)
values (
  'leave.summary',
  'leave',
  'Leave summary',
  'Who was away, who is away next, and what is still waiting for a decision.'
)
on conflict (report_key) do update
  set title = excluded.title, description = excluded.description;

-- ═════════════════════════════════════════════════════ 4 · the two templates
--
-- Deliberately NOT added to missing_system_notification_templates(). That is a
-- platform function and listing a module's event keys in it is the coupling D30
-- forbids — and its own comment says the list is belt-and-braces anyway: the
-- real guard is the assertion in verify_invariants.sql that fails on ANY
-- notification recorded with NO_TEMPLATE, which needs no list at all.

insert into public.notification_templates
  (organization_id, event_key, channel, subject_template, body_template)
select null::uuid, v.event_key, v.channel, v.subject, v.body
  from (values
    ('leave_summary.weekly'::text, 'email'::public.notification_channel,
     'Leave at {{ organization_name }} — week of {{ period_label }}'::text,
     '<p>Here is the leave summary for <strong>{{ organization_name }}</strong>.</p>'
     '<h3>Last week — {{ period_label }}</h3>'
     '<p>{{ taken_count }}</p>'
     '<pre style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;line-height:1.6;white-space:pre-wrap;margin:0">{{ taken_lines }}</pre>'
     '<h3>Next week — {{ upcoming_label }}</h3>'
     '<p>{{ upcoming_count }}</p>'
     '<pre style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;line-height:1.6;white-space:pre-wrap;margin:0">{{ upcoming_lines }}</pre>'
     '<h3>Waiting for a decision</h3>'
     '<p>{{ pending_count }}</p>'
     '<pre style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;line-height:1.6;white-space:pre-wrap;margin:0">{{ pending_lines }}</pre>'
     '<p style="color:#666;font-size:12px">Sign in to Neuvto for the full report, including a spreadsheet export.</p>'::text),

    ('leave_summary.monthly', 'email',
     'Leave at {{ organization_name }} — {{ period_label }}',
     '<p>Here is the leave summary for <strong>{{ organization_name }}</strong>.</p>'
     '<h3>{{ period_label }}</h3>'
     '<p>{{ taken_count }}</p>'
     '<pre style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;line-height:1.6;white-space:pre-wrap;margin:0">{{ taken_lines }}</pre>'
     '<h3>Waiting for a decision</h3>'
     '<p>{{ pending_count }}</p>'
     '<pre style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;line-height:1.6;white-space:pre-wrap;margin:0">{{ pending_lines }}</pre>'
     '<p style="color:#666;font-size:12px">Sign in to Neuvto for the full report, including a spreadsheet export.</p>')
  ) as v(event_key, channel, subject, body)
 where not exists (
   select 1 from public.notification_templates t
    where t.organization_id is null
      and t.event_key = v.event_key
      and t.channel   = v.channel
      and t.deleted_at is null
 );

-- ═══════════════════════════════════════════════════════════ 5 · the renderer

-- "12–14 Aug" · "12 Aug" · "28 Aug – 3 Sep". Small, but it is the difference
-- between an email somebody reads and one they skim past.
--
-- STABLE and not IMMUTABLE: to_char's month names follow lc_time.
create or replace function public.leave_summary_when(_from date, _to date)
returns text
language sql
stable
set search_path = public
as $$
  select case
    when _from = _to then to_char(_from, 'FMDD Mon')
    when date_trunc('month', _from::timestamp) = date_trunc('month', _to::timestamp)
      then to_char(_from, 'FMDD') || '–' || to_char(_to, 'FMDD Mon')
    else to_char(_from, 'FMDD Mon') || ' – ' || to_char(_to, 'FMDD Mon')
  end
$$;

revoke all on function public.leave_summary_when(date, date) from public, anon;
grant execute on function public.leave_summary_when(date, date) to authenticated;

-- Days read as a person writes them: "1 day", "2.5 days" — never "1.0 day".
create or replace function public.leave_summary_days(_days numeric)
returns text
language sql
immutable
set search_path = public
as $$
  select case when _days = floor(_days)
              then _days::integer::text
              else trim(to_char(_days, 'FM999990.0'))
         end
      || ' day'
      || case when _days = 1 then '' else 's' end
$$;

revoke all on function public.leave_summary_days(numeric) from public, anon;
grant execute on function public.leave_summary_days(numeric) to authenticated;

create or replace function public.leave_summary_lines(
  _org uuid, _from date, _to date, _kind text)
returns table (line_count integer, lines text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  -- An organisation of five hundred produces an unreadable email and a slow
  -- one. Twenty-five is a screenful; the rest is a number and a nudge to open
  -- the real report.
  c_cap constant integer := 25;
  v_rows text[];
  v_n    integer;
begin
  -- Refused rather than defaulted. `else` on a two-branch string parameter means
  -- a typo silently renders the OTHER report — an email headed "waiting for a
  -- decision" listing leave that was taken, which reads as correct and is not.
  if _kind not in ('taken', 'pending') then
    raise exception 'UNKNOWN_SUMMARY_KIND: %', _kind using errcode = 'P0001';
  end if;

  if _kind = 'pending' then
    select array_agg(
             format('%s — %s, %s (%s), waiting %s day%s on %s',
                    r.employee_name, r.leave_type_name,
                    public.leave_summary_when(r.from_date, r.to_date),
                    public.leave_summary_days(r.working_days),
                    r.days_waiting,
                    case when r.days_waiting = 1 then '' else 's' end,
                    coalesce(r.waiting_on, 'nobody — no approver is assigned'))
             order by r.submitted_at)
      into v_rows
      from public.leave_pending_report_for(_org) r;
  else
    select array_agg(
             format('%s — %s, %s (%s)',
                    r.employee_name, r.leave_type_name,
                    public.leave_summary_when(r.from_date, r.to_date),
                    public.leave_summary_days(r.working_days))
             order by r.from_date, r.employee_name)
      into v_rows
      from public.leave_taken_report_for(_org, _from, _to) r
      -- Approved only. A rejected request is not an absence, and a summary that
      -- counted one would tell a chief executive somebody was away who was at
      -- their desk. The full report keeps every status precisely because the
      -- auditor needs the rejections; a digest does not.
     where r.status = 'approved';
  end if;

  v_rows := coalesce(v_rows, array[]::text[]);
  v_n := cardinality(v_rows);

  return query select
    v_n,
    case
      when v_n = 0 then ''
      when v_n <= c_cap then array_to_string(v_rows, E'\n')
      else array_to_string(v_rows[1:c_cap], E'\n')
           || format(E'\n…and %s more', v_n - c_cap)
    end;
end $$;

revoke all on function public.leave_summary_lines(uuid, date, date, text)
  from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════ 6 · the runner

create or replace function public.leave_report_schedule_run()
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_due       record;
  v_org_name  text;
  v_event     text;
  v_from      date;
  v_to        date;
  v_next_from date;
  v_next_to   date;
  v_label     text;
  v_next_lab  text;
  v_taken     record;
  v_upcoming  record;
  v_pending   record;
  v_payload   jsonb;
  v_to_addr   text;
  v_queued    integer := 0;
  v_month_end date;
begin
  -- System context only. This crosses every organisation, so an authenticated
  -- caller reaching it would be reading other tenants' leave.
  if (select auth.uid()) is not null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  for v_due in select * from public.report_schedules_due('leave.summary') loop
    -- D44. A workspace with Leave switched off gets nothing, and is not marked
    -- as run — so switching it back on resumes at the next occurrence rather
    -- than skipping one.
    if not public.module_enabled_for(v_due.organization_id, 'leave') then
      continue;
    end if;

    select name into v_org_name from public.organizations
     where id = v_due.organization_id;

    if v_due.cadence = 'weekly' then
      v_event     := 'leave_summary.weekly';
      -- date_trunc('week') is ISO: Monday. The window is the week that has
      -- FINISHED, not the one in progress — a Monday-morning email about the
      -- week it is sent in would be empty by definition.
      v_from      := date_trunc('week', v_due.local_today::timestamp)::date - 7;
      v_to        := v_from + 6;
      v_next_from := date_trunc('week', v_due.local_today::timestamp)::date + 7;
      v_next_to   := v_next_from + 6;
      v_label     := public.leave_summary_when(v_from, v_to);
      v_next_lab  := public.leave_summary_when(v_next_from, v_next_to);
    else
      v_event    := 'leave_summary.monthly';
      v_month_end := (date_trunc('month', v_due.local_today::timestamp)
                      + interval '1 month - 1 day')::date;
      if v_due.local_today = v_month_end then
        -- The admin picked the last day of the month, so the month finishing
        -- TODAY is the one they meant. Sada's words were "by the end of the
        -- month"; a report that arrived on 31 August covering July would read
        -- as a bug, and be one.
        v_from := date_trunc('month', v_due.local_today::timestamp)::date;
        v_to   := v_due.local_today;
      else
        v_from := (date_trunc('month', v_due.local_today::timestamp)
                   - interval '1 month')::date;
        v_to   := (date_trunc('month', v_due.local_today::timestamp)
                   - interval '1 day')::date;
      end if;
      v_label := to_char(v_from, 'FMMonth YYYY');
    end if;

    select * into v_taken
      from public.leave_summary_lines(v_due.organization_id, v_from, v_to, 'taken');
    select * into v_pending
      from public.leave_summary_lines(v_due.organization_id, null, null, 'pending');

    v_payload := jsonb_build_object(
      'organization_name', coalesce(v_org_name, 'your workspace'),
      'period_label',      v_label,
      'taken_count',       case v_taken.line_count
                             when 0 then 'Nobody took leave.'
                             when 1 then '1 person took leave.'
                             else v_taken.line_count || ' periods of leave were taken.'
                           end,
      'taken_lines',       v_taken.lines,
      'pending_count',     case v_pending.line_count
                             when 0 then 'Nothing is waiting for a decision.'
                             when 1 then '1 request is waiting for a decision.'
                             else v_pending.line_count || ' requests are waiting for a decision.'
                           end,
      'pending_lines',     v_pending.lines
    );

    if v_due.cadence = 'weekly' then
      select * into v_upcoming
        from public.leave_summary_lines(v_due.organization_id, v_next_from, v_next_to, 'taken');
      v_payload := v_payload || jsonb_build_object(
        'upcoming_label', v_next_lab,
        'upcoming_count', case v_upcoming.line_count
                            when 0 then 'Nobody is away next week.'
                            when 1 then '1 person is away next week.'
                            else v_upcoming.line_count || ' periods of leave are booked.'
                          end,
        'upcoming_lines', v_upcoming.lines
      );
    end if;

    foreach v_to_addr in array v_due.recipients loop
      -- notify_address never raises (D28): a template it cannot find lands as a
      -- row saying NO_TEMPLATE, which the harness fails on. So one bad address
      -- cannot cost the other recipients their email.
      perform public.notify_address(v_event, v_due.organization_id,
                                    v_to_addr, null, v_payload);
      v_queued := v_queued + 1;
    end loop;

    -- Only now. A runner that marked everything it selected would swallow a
    -- whole week's report the first time rendering threw halfway down the list.
    perform public.report_schedule_mark_run(v_due.id, v_due.local_today);
  end loop;

  return v_queued;
end $$;

comment on function public.leave_report_schedule_run is
  'D30/D43 — Leave renders and queues its own scheduled summaries. The platform supplies only the timing.';

revoke all on function public.leave_report_schedule_run() from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════ 7 · the schedule
--
-- D43 — scheduled work is declared HERE, in a migration, not clicked into a
-- dashboard. A schedule that lives only in somebody's console cannot be
-- reviewed, cannot be restored after a rebuild, and cannot be seen by the next
-- person wondering why no email arrived.

do $$
begin
  perform cron.unschedule('neuvto-leave-report-schedules')
    where exists (select 1 from cron.job where jobname = 'neuvto-leave-report-schedules');

  -- HOURLY, not daily. The due test is made in each organisation's own
  -- timezone, so "it is Monday somewhere" is true for twenty-six hours and a
  -- once-a-day job in UTC would miss whichever customers are on the wrong side
  -- of it. last_run_on is what makes the other twenty-five runs no-ops.
  perform cron.schedule(
    'neuvto-leave-report-schedules',
    '7 * * * *',
    $job$select public.leave_report_schedule_run()$job$
  );
end $$;
