-- ============================================================================
-- NEUVTO WOS — a report can arrive without anybody opening the product
--
-- Sada, 7 Aug 2026: "let the admin decide if the report should be triggered
-- automatically every week... There can also be a configuration where reports
-- can be triggered on a monthly basis by the end of the month... Let them decide
-- what date to pick when the report should be triggered to the admin's email,
-- to the CEO's email, etc."
--
-- THIS FILE NAMES NO MODULE, AND THAT IS THE POINT.
--
-- The platform owns the schedule: when it is due, who it goes to, and the fact
-- that it has already gone out today. It owns none of the content. A module
-- registers what it can send, reads its own due schedules, renders its own
-- email, and schedules its own cron job in its own migration — the arrangement
-- 20260801120000_leave_module_guard.sql arrived at after the first draft of the
-- nightly balance sweep sat in the platform's scheduled-work file, looping
-- organisations and calling a leave function. D30.
--
-- Nothing new is paid for. pg_cron and pg_net are installed, `notifications`
-- queues and retries, the dispatcher drains it every minute, Resend delivers.
-- ============================================================================

-- ═══════════════════════════════════════════════ what can be scheduled at all
--
-- A registry rather than a free-text key, because a schedule pointing at a key
-- no module serves is a screen that says "every Monday" and an inbox that stays
-- empty — the exact failure shape as the queue nobody drained. The platform
-- owns the table; each module inserts its own row from its own migration and
-- names itself in `module_key`, which is opaque here.

create table if not exists public.report_definitions (
  report_key  text primary key,
  module_key  text not null,
  title       text not null,
  description text,
  created_at  timestamptz not null default now()
);

comment on table public.report_definitions is
  'D30 — reports a module can deliver by email. Modules insert their own rows; the platform never reads module_key for meaning.';

alter table public.report_definitions enable row level security;

-- Only what THIS workspace can actually receive. The table is global — it is a
-- list of what the product can do — but a workspace with Leave switched off
-- must not be offered a leave summary in a dropdown, pick it, and then wait for
-- an email the runner will always skip (D44).
--
-- The platform is not naming a module here: module_key is a value in the row,
-- passed to a platform function that treats it as opaque. Writable only by
-- migrations, so a module registers itself and nothing else can.
drop policy if exists "read report definitions" on public.report_definitions;
create policy "read report definitions"
  on public.report_definitions for select
  to authenticated
  using (public.module_enabled_for(public.current_org_id(), module_key));

-- ═══════════════════════════════════════════════════════════════ the schedule

do $$
begin
  if not exists (select 1 from pg_type where typname = 'report_cadence') then
    create type public.report_cadence as enum ('weekly', 'monthly');
  end if;
end $$;

create table if not exists public.report_schedules (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  report_key      text not null references public.report_definitions(report_key),
  cadence         public.report_cadence not null,

  -- ISO day of week: Monday = 1, Sunday = 7. Matches extract(isodow), so the
  -- comparison in report_schedules_due needs no translation table.
  day_of_week     smallint,

  -- 1..31, and 31 is not a trap here: see report_schedules_due, which clamps to
  -- the length of the actual month. A schedule set to the 31st fires on 28
  -- February, which is what "by the end of the month" means to the person who
  -- set it. A plain `= day_of_month` would silently never fire in February and
  -- look exactly like a broken email.
  day_of_month    smallint,

  -- Plain addresses, not member ids. Sada asked for "the CEO's email", who may
  -- have no account. notify_address() already sends to an arbitrary address in
  -- an organisation's context. This grants no reach an administrator lacks —
  -- they can export the same rows as CSV from the Reports page today — and
  -- every change here is written to audit_logs by the trigger below.
  recipients      text[] not null default '{}',

  is_active       boolean not null default true,

  -- The double-send guard. The runner fires hourly so that every timezone's
  -- chosen day is reachable, which means "is it Monday" is true twelve times
  -- over. Set only after the send actually happened.
  last_run_on     date,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  deleted_at timestamptz,

  constraint schedule_day_matches_cadence check (
    (cadence = 'weekly'
       and day_of_week between 1 and 7
       and day_of_month is null)
    or
    (cadence = 'monthly'
       and day_of_month between 1 and 31
       and day_of_week is null)
  ),
  constraint schedule_recipients_sane check (
    cardinality(recipients) between 1 and 20
  )
);

comment on table public.report_schedules is
  'When a module report is emailed, and to whom. The platform owns the timing; the module owns the content.';

create index if not exists idx_report_schedules_due
  on public.report_schedules (report_key)
  where is_active and deleted_at is null;

create index if not exists idx_report_schedules_org
  on public.report_schedules (organization_id)
  where deleted_at is null;

alter table public.report_schedules enable row level security;

drop policy if exists "read own report schedules" on public.report_schedules;
create policy "read own report schedules"
  on public.report_schedules for select
  to authenticated
  using (organization_id = public.current_org_id() and deleted_at is null);

-- Writes go through the RPCs below, which validate. The policy is the floor,
-- not the door: it exists so that a direct write can never cross a tenant.
drop policy if exists "admins write report schedules" on public.report_schedules;
create policy "admins write report schedules"
  on public.report_schedules for all
  to authenticated
  using (organization_id = public.current_org_id() and public.is_admin() and deleted_at is null)
  with check (organization_id = public.current_org_id() and public.is_admin());

drop trigger if exists set_audit_fields on public.report_schedules;
create trigger set_audit_fields
  before insert or update on public.report_schedules
  for each row execute function public.set_audit_fields();

drop trigger if exists write_audit_log on public.report_schedules;
create trigger write_audit_log
  after insert or update or delete on public.report_schedules
  for each row execute function public.write_audit_log();

-- ═══════════════════════════════════════════════════════════ writing one down

-- The optional arguments carry DEFAULT NULL rather than being merely nullable,
-- which is what makes the generated TypeScript type them as optional. Without
-- it the client is forced to pass a literal null for "no id" and "no weekday",
-- and the type checker refuses — the caller and the callee disagreeing about
-- what "absent" means is how an optional field becomes a required one by
-- accident.
create or replace function public.report_schedule_save(
  _report_key   text,
  _cadence      public.report_cadence,
  _recipients   text[],
  _id           uuid     default null,
  _day_of_week  smallint default null,
  _day_of_month smallint default null,
  _is_active    boolean  default true
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org   uuid := public.current_org_id();
  v_clean text[];
  v_one   text;
begin
  if v_org is null or not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- Runs as definer, so RLS does not filter this the way it filters the screen.
  -- The module check has to be made explicitly here or an admin could schedule
  -- a report from a module their workspace does not have.
  if not exists (
    select 1 from public.report_definitions d
     where d.report_key = _report_key
       and public.module_enabled_for(v_org, d.module_key)
  ) then
    raise exception 'REPORT_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Trim, drop blanks, and refuse anything that is not an address. A CHECK
  -- constraint cannot do this — Postgres forbids a subquery in one — so it is
  -- done here, which is where every other write in this product validates.
  v_clean := array[]::text[];
  foreach v_one in array coalesce(_recipients, array[]::text[]) loop
    v_one := btrim(v_one);
    if v_one <> '' then
      if v_one !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
        raise exception 'BAD_EMAIL: %', v_one using errcode = 'P0001';
      end if;
      if not (lower(v_one) = any (select lower(x) from unnest(v_clean) x)) then
        v_clean := v_clean || lower(v_one);
      end if;
    end if;
  end loop;

  if cardinality(v_clean) = 0 then
    raise exception 'NO_RECIPIENTS' using errcode = 'P0001';
  end if;

  if _id is null then
    insert into public.report_schedules
      (organization_id, report_key, cadence, day_of_week, day_of_month,
       recipients, is_active)
    values
      (v_org, _report_key, _cadence,
       case when _cadence = 'weekly'  then _day_of_week  end,
       case when _cadence = 'monthly' then _day_of_month end,
       v_clean, coalesce(_is_active, true))
    returning id into _id;
    return _id;
  end if;

  update public.report_schedules
     set report_key   = _report_key,
         cadence      = _cadence,
         day_of_week  = case when _cadence = 'weekly'  then _day_of_week  end,
         day_of_month = case when _cadence = 'monthly' then _day_of_month end,
         recipients   = v_clean,
         is_active    = coalesce(_is_active, true),
         -- Changing WHEN it goes out must not be blocked by the fact that
         -- today's already went. Clearing this is deliberate: an admin who
         -- moves Monday's report to Wednesday expects Wednesday's to arrive.
         last_run_on  = case
                          when cadence is distinct from _cadence
                            or day_of_week is distinct from _day_of_week
                            or day_of_month is distinct from _day_of_month
                          then null else last_run_on
                        end,
         updated_at   = now()
   where id = _id
     and organization_id = v_org
     and deleted_at is null;

  if not found then
    raise exception 'SCHEDULE_NOT_FOUND' using errcode = 'P0002';
  end if;

  return _id;
end $$;

comment on function public.report_schedule_save is
  'Creates or updates a scheduled report for the caller''s own organisation. Validates recipients, which a CHECK constraint cannot.';

revoke all on function public.report_schedule_save(text, public.report_cadence, text[], uuid, smallint, smallint, boolean)
  from public, anon;
grant execute on function public.report_schedule_save(text, public.report_cadence, text[], uuid, smallint, smallint, boolean)
  to authenticated;

create or replace function public.report_schedule_remove(_id uuid)
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
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  update public.report_schedules
     set deleted_at = now(), is_active = false, updated_at = now()
   where id = _id and organization_id = v_org and deleted_at is null;

  if not found then
    raise exception 'SCHEDULE_NOT_FOUND' using errcode = 'P0002';
  end if;
end $$;

revoke all on function public.report_schedule_remove(uuid) from public, anon;
grant execute on function public.report_schedule_remove(uuid) to authenticated;

-- ═══════════════════════════════════════════════════ does this day count as due
--
-- Pulled out of the query below so it can be asked about a date that is not
-- today. The February trap lives here and is invisible in a query you can only
-- run once a day: `= day_of_month` looks obviously right and means a schedule
-- set to the 31st never fires in February, or April, or June, or September, or
-- November — silently, for ever, looking exactly like a broken email.
create or replace function public.report_schedule_fires_on(
  _cadence      public.report_cadence,
  _day_of_week  smallint,
  _day_of_month smallint,
  _on           date
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case _cadence
    when 'weekly'  then extract(isodow from _on)::int = _day_of_week
    when 'monthly' then extract(day from _on)::int = least(
      _day_of_month,
      -- The length of THIS month, so 31 means "the last day of it".
      extract(day from (date_trunc('month', _on::timestamp)
                        + interval '1 month - 1 day'))::int)
  end
$$;

comment on function public.report_schedule_fires_on is
  'Whether a schedule is due on a given date. Monthly days are clamped to the length of the month, so 31 means the last day and February is not skipped for ever.';

revoke all on function public.report_schedule_fires_on(public.report_cadence, smallint, smallint, date)
  from public, anon;
grant execute on function public.report_schedule_fires_on(public.report_cadence, smallint, smallint, date)
  to authenticated;

-- ═══════════════════════════════════════════════════════ what is due, and when
--
-- SYSTEM ONLY. The caller is cron, running as postgres with no auth.uid(), and
-- this function crosses every organisation by design — so an authenticated
-- caller reaching it would be enumerating other tenants' schedules and
-- recipients. Revoked below, and refused here as well, because a grant is one
-- careless migration away from coming back.
create or replace function public.report_schedules_due(_report_key text)
returns table (
  id              uuid,
  organization_id uuid,
  cadence         public.report_cadence,
  recipients      text[],
  local_today     date)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is not null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  return query
    select s.id, s.organization_id, s.cadence, s.recipients, t.today
      from public.report_schedules s
      -- THE ORGANISATION'S OWN DATE, NEVER THE SERVER'S (D9).
      --
      -- org_today() works here where most helpers do not: assert_own_org()
      -- says so in as many words — "System contexts (no auth.uid()) are
      -- unrestricted." Using current_date instead would fire an Indian
      -- customer's Monday report at 18:30 on Sunday, every week, and the
      -- report would be a day short at both ends.
      cross join lateral (select public.org_today(s.organization_id) as today) t
     where s.report_key  = _report_key
       and s.is_active
       and s.deleted_at is null
       -- Already sent today. The runner fires hourly so that every timezone's
       -- chosen hour is reachable, which makes "is it Monday" true twelve
       -- times over.
       and (s.last_run_on is null or s.last_run_on < t.today)
       and public.report_schedule_fires_on(
             s.cadence, s.day_of_week, s.day_of_month, t.today);
end $$;

comment on function public.report_schedules_due is
  'Schedules due today in their own organisation''s timezone, not the server''s. System context only — it crosses tenants by design.';

revoke all on function public.report_schedules_due(text) from public, anon, authenticated;

create or replace function public.report_schedule_mark_run(_id uuid, _on date)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is not null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- Separate from the due query on purpose: a runner that marked everything it
  -- selected would swallow a whole week's report the first time rendering threw
  -- halfway down the list. Nothing is marked until it has actually been queued.
  update public.report_schedules
     set last_run_on = _on, updated_at = now()
   where id = _id;
end $$;

revoke all on function public.report_schedule_mark_run(uuid, date) from public, anon, authenticated;
