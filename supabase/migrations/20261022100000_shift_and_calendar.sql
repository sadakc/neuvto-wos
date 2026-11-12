-- ============================================================================
-- NEUVTO WOS — shift and working calendar (D102)
-- ============================================================================
--
-- The bundle's rule (09 §Rules): "the deployed unit carries the working
-- calendar. A move to a six day site changes how absence is counted from the
-- effective date." Sada chose it on 12 Oct 2026, with:
--
--   CALENDARS. A company has its Company calendar (organization_settings'
--   weekly offs, as before, kept in step by a trigger) and any number of
--   named ones. A calendar is the days of the week that are off; the Admin
--   picks them. A new calendar starts Sunday only. A unit names its calendar;
--   a unit that names none, and a person posted nowhere, use the Company one.
--
--   COUNTING. A leave day costs leave unless, on THAT day, the calendar of
--   the unit the person was posted to then makes it a weekly off, or a holiday
--   that applies to that calendar. One rule, calendar_day(), behind every
--   count: the company-level functions are that rule on the Company calendar.
--
--   HOLIDAYS. One company list, as before. A holiday applies to every calendar
--   unless it is limited to some (a state holiday for one state's units).
--
--   SHIFTS. Name, start, end, unpaid break. A unit has a default shift; the
--   Employee Admin can give one person their own, with history, the way an
--   address has history (rule 2). Rosters, swaps, grace and overtime are
--   Attendance's.
--
-- Leave already asked for keeps the days it was counted at. Moving somebody,
-- or changing a unit's calendar, changes what new requests cost.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════ calendars

create table if not exists public.working_calendars (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null check (btrim(name) <> '' and length(name) <= 80),
  -- 0 = Sunday … 6 = Saturday, as organization_settings.weekend_days.
  weekly_off      smallint[] not null default '{0}',
  is_default      boolean not null default false,
  status          text not null default 'active' check (status in ('active', 'retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint calendar_offs_are_days check (
    weekly_off <@ '{0,1,2,3,4,5,6}'::smallint[] and coalesce(array_length(weekly_off, 1), 0) <= 6),
  constraint company_calendar_is_used check (not is_default or status = 'active')
);
create unique index if not exists working_calendars_name_per_org
  on public.working_calendars (organization_id, lower(btrim(name)));
create unique index if not exists working_calendars_one_default
  on public.working_calendars (organization_id) where is_default;

create trigger set_audit_fields before insert or update on public.working_calendars
  for each row execute function public.set_audit_fields();
create trigger write_audit_log after insert or update or delete on public.working_calendars
  for each row execute function public.write_audit_log();

alter table public.working_calendars enable row level security;
revoke all on public.working_calendars from anon, authenticated;
grant select on public.working_calendars to authenticated;
create policy "read own calendars" on public.working_calendars
  for select to authenticated using (organization_id = public.current_org_id());

comment on table public.working_calendars is
  'D102 — the weekly offs a unit works to. One is_default per company: the Company calendar, kept equal to organization_settings.weekend_days. Written through functions only.';

/** The Company calendar follows organization_settings, which the Settings screen writes. */
create or replace function public.tf_company_calendar_follows_settings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.working_calendars (organization_id, name, weekly_off, is_default)
  values (new.organization_id, 'Company calendar', new.weekend_days, true)
  on conflict (organization_id) where is_default
  do update set weekly_off = excluded.weekly_off
   where working_calendars.weekly_off is distinct from excluded.weekly_off;
  return new;
end $$;

revoke all on function public.tf_company_calendar_follows_settings() from public, anon, authenticated;

drop trigger if exists company_calendar_follows_settings on public.organization_settings;
create trigger company_calendar_follows_settings
  after insert or update of weekend_days on public.organization_settings
  for each row execute function public.tf_company_calendar_follows_settings();

-- Every existing company gets its Company calendar now.
insert into public.working_calendars (organization_id, name, weekly_off, is_default)
select s.organization_id, 'Company calendar', s.weekend_days, true
  from public.organization_settings s
on conflict do nothing;

-- ═══════════════════════════════════════════════════════════ holidays, limited

create table if not exists public.holiday_calendars (
  holiday_id      uuid not null references public.holidays(id) on delete cascade,
  calendar_id     uuid not null references public.working_calendars(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  primary key (holiday_id, calendar_id)
);
alter table public.holiday_calendars enable row level security;
revoke all on public.holiday_calendars from anon, authenticated;
grant select on public.holiday_calendars to authenticated;
create policy "read own holiday limits" on public.holiday_calendars
  for select to authenticated using (organization_id = public.current_org_id());

comment on table public.holiday_calendars is
  'D102 — a holiday limited to some calendars. A holiday with no rows here applies to every calendar.';

/** Limits a holiday to these calendars; an empty list means every calendar. A company Admin. */
create or replace function public.holiday_set_calendars(_holiday_id uuid, _calendar_ids uuid[])
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  v_ids uuid[] := coalesce(_calendar_ids, '{}');
begin
  if v_org is null or not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if not exists (select 1 from public.holidays where id = _holiday_id and organization_id = v_org and deleted_at is null) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if exists (select 1 from unnest(v_ids) x
              where not exists (select 1 from public.working_calendars c
                                 where c.id = x and c.organization_id = v_org)) then
    raise exception 'CALENDAR_NOT_AVAILABLE' using errcode = 'P0001';
  end if;
  delete from public.holiday_calendars where holiday_id = _holiday_id;
  insert into public.holiday_calendars (holiday_id, calendar_id, organization_id)
  select _holiday_id, x, v_org from (select distinct unnest(v_ids) x) d;
end $$;

revoke all on function public.holiday_set_calendars(uuid, uuid[]) from public, anon;
grant execute on function public.holiday_set_calendars(uuid, uuid[]) to authenticated;

-- ═══════════════════════════════════════════════════════════ shifts

create table if not exists public.shifts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null check (btrim(name) <> '' and length(name) <= 80),
  start_time      time not null,
  -- Earlier than the start: a night shift, ending the next morning.
  end_time        time not null,
  break_minutes   smallint not null default 0 check (break_minutes between 0 and 240),
  status          text not null default 'active' check (status in ('active', 'retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint shift_has_length check (start_time <> end_time)
);
create unique index if not exists shifts_name_per_org on public.shifts (organization_id, lower(btrim(name)));

create trigger set_audit_fields before insert or update on public.shifts
  for each row execute function public.set_audit_fields();
create trigger write_audit_log after insert or update or delete on public.shifts
  for each row execute function public.write_audit_log();

alter table public.shifts enable row level security;
revoke all on public.shifts from anon, authenticated;
grant select on public.shifts to authenticated;
create policy "read own shifts" on public.shifts
  for select to authenticated using (organization_id = public.current_org_id());

comment on table public.shifts is
  'D102 — a shift: start, end (earlier than start for a night shift) and unpaid break. Retired, never deleted. Written through functions only.';

alter table public.deployment_units
  add column if not exists working_calendar_id uuid references public.working_calendars(id) on delete restrict,
  add column if not exists default_shift_id uuid references public.shifts(id) on delete restrict;

comment on column public.deployment_units.working_calendar_id is
  'D102 — the calendar people posted here work to. Null: the Company calendar.';
comment on column public.deployment_units.default_shift_id is
  'D102 — the shift people posted here work, unless they have their own.';

/** A person's own shift, with history: closed rows never change (rule 2). */
create table if not exists public.employee_shift_overrides (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  employee_id     uuid not null references public.employees(id) on delete restrict,
  shift_id        uuid not null references public.shifts(id) on delete restrict,
  effective_from  date not null,
  effective_to    date,
  validity        daterange generated always as (daterange(effective_from, effective_to, '[)')) stored,
  reason          text check (reason is null or length(reason) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint shift_override_ends_after_it_starts check (effective_to is null or effective_to > effective_from),
  constraint shift_overrides_never_overlap exclude using gist (employee_id with =, validity with &&)
);

create trigger set_audit_fields before insert or update on public.employee_shift_overrides
  for each row execute function public.set_audit_fields();
create trigger write_audit_log after insert or update or delete on public.employee_shift_overrides
  for each row execute function public.write_audit_log();
create trigger same_organisation before insert or update on public.employee_shift_overrides
  for each row execute function public.tf_employee_child_same_org();
create trigger history_is_append_only before update or delete on public.employee_shift_overrides
  for each row execute function public.tf_history_is_append_only();

alter table public.employee_shift_overrides enable row level security;
revoke all on public.employee_shift_overrides from anon, authenticated;

comment on table public.employee_shift_overrides is
  'D102 — a person''s own shift instead of their unit''s, from a date. Closed by the next one, by clearing it, or by a move that does not keep it.';

-- ═══════════════════════════════════════════════════════════ the one day rule

create or replace function public.working_calendar_default_id(_org_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.working_calendars where organization_id = _org_id and is_default
$$;

/** The calendar a person worked to on a day: their unit's then, else the Company calendar. */
create or replace function public.employee_calendar_on(_profile_id uuid, _day date)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select u.working_calendar_id
       from public.employees e
       join public.employee_deployments d on d.employee_id = e.id
       join public.deployment_units u on u.id = d.deployment_unit_id
      where e.profile_id = _profile_id and e.deleted_at is null
        and d.effective_from <= _day and (d.effective_to is null or d.effective_to > _day)
      order by d.effective_from desc limit 1),
    (select public.working_calendar_default_id(p.organization_id)
       from public.profiles p where p.id = _profile_id))
$$;

/**
 * Whether a day costs leave on a calendar, and if not, why. THE rule: every
 * count and every explanation below is this, so they cannot disagree.
 *
 * A weekly off that is also a holiday is reported as the weekly off: it would
 * have been free without the holiday.
 */
create or replace function public.calendar_day(_org_id uuid, _calendar_id uuid, _day date)
returns table (working boolean, reason text, label text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_offs        smallint[];
  v_no_weekends boolean;
  v_no_holidays boolean;
  v_holiday     text;
begin
  select exclude_weekends, exclude_holidays into v_no_weekends, v_no_holidays
    from public.organization_settings where organization_id = _org_id;
  if v_no_weekends is null then
    raise exception 'NO_ORGANIZATION_SETTINGS' using errcode = 'P0002';
  end if;
  select weekly_off into v_offs from public.working_calendars
   where id = _calendar_id and organization_id = _org_id;

  if v_no_weekends and extract(dow from _day)::smallint = any (coalesce(v_offs, '{}')) then
    return query select false, 'weekend'::text, to_char(_day, 'FMDay');
    return;
  end if;
  if v_no_holidays then
    select h.name into v_holiday
      from public.holidays h
     where h.organization_id = _org_id and h.holiday_date = _day and h.deleted_at is null
       and (not exists (select 1 from public.holiday_calendars hc where hc.holiday_id = h.id)
            or exists (select 1 from public.holiday_calendars hc
                        where hc.holiday_id = h.id and hc.calendar_id = _calendar_id))
     limit 1;
    if v_holiday is not null then
      return query select false, 'holiday'::text, v_holiday;
      return;
    end if;
  end if;
  return query select true, null::text, null::text;
end $$;

revoke all on function public.calendar_day(uuid, uuid, date) from public, anon, authenticated;
revoke all on function public.employee_calendar_on(uuid, date) from public, anon, authenticated;
revoke all on function public.working_calendar_default_id(uuid) from public, anon, authenticated;

-- ── the company-level counts: the same rule on the Company calendar.
--    Signatures unchanged; their callers and grants stay.

create or replace function public.calculate_working_days(_org_id uuid, _from date, _to date)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_cal uuid;
begin
  perform public.assert_own_org(_org_id);
  if _from is null or _to is null or _to < _from then
    return 0;
  end if;
  if not exists (select 1 from public.organization_settings where organization_id = _org_id) then
    raise exception 'NO_ORGANIZATION_SETTINGS' using errcode = 'P0002';
  end if;
  v_cal := public.working_calendar_default_id(_org_id);
  return (select count(*) from generate_series(_from, _to, interval '1 day') g(d)
           cross join lateral public.calendar_day(_org_id, v_cal, g.d::date) c
          where c.working);
end $$;

comment on function public.calculate_working_days is
  'Working days between two dates inclusive on the Company calendar (D102: calendar_day). A person''s leave is counted by calculate_working_days_for.';

create or replace function public.working_days_excluded(_org_id uuid, _from date, _to date)
returns table (day date, reason text, label text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_cal uuid;
begin
  perform public.assert_own_org(_org_id);
  if _from is null or _to is null or _to < _from then
    return;
  end if;
  if not exists (select 1 from public.organization_settings where organization_id = _org_id) then
    raise exception 'NO_ORGANIZATION_SETTINGS' using errcode = 'P0002';
  end if;
  v_cal := public.working_calendar_default_id(_org_id);
  return query
    select g.d::date, c.reason, c.label
      from generate_series(_from, _to, interval '1 day') g(d)
     cross join lateral public.calendar_day(_org_id, v_cal, g.d::date) c
     where not c.working
     order by 1;
end $$;

-- ── a person's: each day on the calendar of the unit they were posted to then.

create or replace function public.calculate_working_days_for(_profile_id uuid, _from date, _to date)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_org uuid;
begin
  select organization_id into v_org from public.profiles where id = _profile_id;
  if v_org is null or _from is null or _to is null or _to < _from then
    return 0;
  end if;
  return (select count(*) from generate_series(_from, _to, interval '1 day') g(d)
           cross join lateral public.calendar_day(
             v_org, public.employee_calendar_on(_profile_id, g.d::date), g.d::date) c
          where c.working);
end $$;

create or replace function public.working_days_excluded_for(_profile_id uuid, _from date, _to date)
returns table (day date, reason text, label text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_org uuid;
begin
  select organization_id into v_org from public.profiles where id = _profile_id;
  if v_org is null or _from is null or _to is null or _to < _from then
    return;
  end if;
  return query
    select g.d::date, c.reason, c.label
      from generate_series(_from, _to, interval '1 day') g(d)
     cross join lateral public.calendar_day(
       v_org, public.employee_calendar_on(_profile_id, g.d::date), g.d::date) c
     where not c.working
     order by 1;
end $$;

revoke all on function public.calculate_working_days_for(uuid, date, date) from public, anon, authenticated;
revoke all on function public.working_days_excluded_for(uuid, date, date) from public, anon, authenticated;

comment on function public.calculate_working_days_for is
  'D102 — a person''s working days in a range, each day on the calendar of the unit they were posted to that day. What leave_submit charges.';

/** What the caller's own leave would cost: the apply screen's preview. */
create or replace function public.my_working_days(_from date, _to date)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select public.calculate_working_days_for((select auth.uid()), _from, _to)
$$;

create or replace function public.my_days_excluded(_from date, _to date)
returns table (day date, reason text, label text)
language sql
stable
security definer
set search_path = public
as $$
  select * from public.working_days_excluded_for((select auth.uid()), _from, _to)
$$;

revoke all on function public.my_working_days(date, date) from public, anon;
revoke all on function public.my_days_excluded(date, date) from public, anon;
grant execute on function public.my_working_days(date, date) to authenticated;
grant execute on function public.my_days_excluded(date, date) to authenticated;

-- ═══════════════════════════════════════════════════════════ configuring them

/** The company's calendars, with how many units use each. The Employee Admin. */
create or replace function public.employee_calendars()
returns table (id uuid, name text, weekly_off smallint[], is_default boolean, status text, units integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_org uuid := public.employee_require_config_admin();
begin
  return query
    select c.id, c.name, c.weekly_off, c.is_default, c.status,
           (select count(*)::int from public.deployment_units u
             where u.deleted_at is null
               and (u.working_calendar_id = c.id or (c.is_default and u.working_calendar_id is null)))
      from public.working_calendars c
     where c.organization_id = v_org
     order by (not c.is_default), (c.status = 'retired'), lower(c.name);
end $$;

revoke all on function public.employee_calendars() from public, anon;
grant execute on function public.employee_calendars() to authenticated;

/** Adds or edits a calendar. The Company calendar's offs are set on Settings, not here. */
create or replace function public.employee_save_calendar(_calendar_id uuid, _values jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org  uuid := public.employee_require_config_admin();
  v_id   uuid := _calendar_id;
  v_name text := btrim(coalesce(_values ->> 'name', ''));
  v_offs smallint[];
begin
  perform public.restricted_known_keys(_values, array['name', 'weeklyOff']);
  if v_name = '' then
    raise exception 'NAME_REQUIRED' using errcode = 'P0001';
  end if;
  begin
    select coalesce(array_agg(distinct x::smallint order by x::smallint), '{}')
      into v_offs from jsonb_array_elements_text(coalesce(_values -> 'weeklyOff', '[0]'::jsonb)) x;
  exception when others then
    raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'weeklyOff';
  end;
  if exists (select 1 from public.working_calendars
              where organization_id = v_org and lower(btrim(name)) = lower(v_name)
                and (v_id is null or id <> v_id)) then
    raise exception 'CALENDAR_NAME_TAKEN' using errcode = 'P0001';
  end if;

  begin
    if v_id is null then
      insert into public.working_calendars (organization_id, name, weekly_off)
      values (v_org, v_name, v_offs) returning id into v_id;
    else
      if exists (select 1 from public.working_calendars where id = v_id and organization_id = v_org and is_default) then
        raise exception 'COMPANY_CALENDAR_IS_SET_IN_SETTINGS' using errcode = 'P0001';
      end if;
      update public.working_calendars set name = v_name, weekly_off = v_offs
       where id = v_id and organization_id = v_org;
      if not found then
        raise exception 'NOT_FOUND' using errcode = 'P0002';
      end if;
    end if;
  exception when check_violation then
    raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'weeklyOff';
  end;
  return v_id;
end $$;

revoke all on function public.employee_save_calendar(uuid, jsonb) from public, anon;
grant execute on function public.employee_save_calendar(uuid, jsonb) to authenticated;

create or replace function public.employee_set_calendar_status(_calendar_id uuid, _status text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_org uuid := public.employee_require_config_admin();
begin
  if _status not in ('active', 'retired') then
    raise exception 'INVALID_VALUE' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.working_calendars where id = _calendar_id and organization_id = v_org and is_default) then
    raise exception 'COMPANY_CALENDAR_IS_SET_IN_SETTINGS' using errcode = 'P0001';
  end if;
  if _status = 'retired' and exists (
       select 1 from public.deployment_units
        where working_calendar_id = _calendar_id and deleted_at is null) then
    raise exception 'CALENDAR_IN_USE' using errcode = 'P0001';
  end if;
  update public.working_calendars set status = _status
   where id = _calendar_id and organization_id = v_org;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
end $$;

revoke all on function public.employee_set_calendar_status(uuid, text) from public, anon;
grant execute on function public.employee_set_calendar_status(uuid, text) to authenticated;

/** The company's shifts, with how many units default to each and how many people have it as their own. */
create or replace function public.employee_shifts()
returns table (id uuid, name text, start_time time, end_time time, break_minutes smallint,
               status text, units integer, people integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_org uuid := public.employee_require_config_admin();
begin
  return query
    select s.id, s.name, s.start_time, s.end_time, s.break_minutes, s.status,
           (select count(*)::int from public.deployment_units u
             where u.default_shift_id = s.id and u.deleted_at is null),
           (select count(*)::int from public.employee_shift_overrides o
             where o.shift_id = s.id and o.effective_to is null)
      from public.shifts s
     where s.organization_id = v_org
     order by (s.status = 'retired'), s.start_time, lower(s.name);
end $$;

revoke all on function public.employee_shifts() from public, anon;
grant execute on function public.employee_shifts() to authenticated;

create or replace function public.employee_save_shift(_shift_id uuid, _values jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org   uuid := public.employee_require_config_admin();
  v_id    uuid := _shift_id;
  v_name  text := btrim(coalesce(_values ->> 'name', ''));
  v_start time;
  v_end   time;
  v_break smallint;
begin
  perform public.restricted_known_keys(_values, array['name', 'startTime', 'endTime', 'breakMinutes']);
  if v_name = '' then
    raise exception 'NAME_REQUIRED' using errcode = 'P0001';
  end if;
  begin
    v_start := (_values ->> 'startTime')::time;
    v_end   := (_values ->> 'endTime')::time;
    v_break := coalesce((_values ->> 'breakMinutes')::smallint, 0);
  exception when others then
    raise exception 'INVALID_VALUE' using errcode = 'P0001';
  end;
  if v_start is null or v_end is null then
    raise exception 'INVALID_VALUE' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.shifts
              where organization_id = v_org and lower(btrim(name)) = lower(v_name)
                and (v_id is null or id <> v_id)) then
    raise exception 'SHIFT_NAME_TAKEN' using errcode = 'P0001';
  end if;
  begin
    if v_id is null then
      insert into public.shifts (organization_id, name, start_time, end_time, break_minutes)
      values (v_org, v_name, v_start, v_end, v_break) returning id into v_id;
    else
      update public.shifts set name = v_name, start_time = v_start, end_time = v_end, break_minutes = v_break
       where id = v_id and organization_id = v_org;
      if not found then
        raise exception 'NOT_FOUND' using errcode = 'P0002';
      end if;
    end if;
  exception when check_violation then
    raise exception 'INVALID_VALUE' using errcode = 'P0001';
  end;
  return v_id;
end $$;

revoke all on function public.employee_save_shift(uuid, jsonb) from public, anon;
grant execute on function public.employee_save_shift(uuid, jsonb) to authenticated;

create or replace function public.employee_set_shift_status(_shift_id uuid, _status text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_org uuid := public.employee_require_config_admin();
begin
  if _status not in ('active', 'retired') then
    raise exception 'INVALID_VALUE' using errcode = 'P0001';
  end if;
  if _status = 'retired' and (
       exists (select 1 from public.deployment_units where default_shift_id = _shift_id and deleted_at is null)
       or exists (select 1 from public.employee_shift_overrides where shift_id = _shift_id and effective_to is null)) then
    raise exception 'SHIFT_IN_USE' using errcode = 'P0001';
  end if;
  update public.shifts set status = _status where id = _shift_id and organization_id = v_org;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
end $$;

revoke all on function public.employee_set_shift_status(uuid, text) from public, anon;
grant execute on function public.employee_set_shift_status(uuid, text) to authenticated;

-- ═══════════════════════════════════════════════════════════ a person's shift

/**
 * Gives a person their own shift from a date, or (shiftId null) returns them
 * to their unit's. Closes the open one the day before, like an address: a date
 * on or before its start is a clash, because the past is not rewritten.
 */
create or replace function public.employee_set_shift(_employee_id uuid, _values jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org   uuid := public.current_org_id();
  v_from  date;
  v_shift uuid;
  v_open  public.employee_shift_overrides%rowtype;
begin
  perform public.employee_require_admin(_employee_id);
  perform public.restricted_known_keys(_values, array['shiftId', 'effectiveFrom', 'reason']);
  begin
    v_from := (_values ->> 'effectiveFrom')::date;
    v_shift := nullif(_values ->> 'shiftId', '')::uuid;
  exception when others then
    raise exception 'INVALID_VALUE' using errcode = 'P0001';
  end;
  if v_from is null then
    raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'effectiveFrom';
  end if;
  if v_shift is not null and not exists (
       select 1 from public.shifts where id = v_shift and organization_id = v_org and status = 'active') then
    raise exception 'SHIFT_NOT_AVAILABLE' using errcode = 'P0001';
  end if;

  select * into v_open from public.employee_shift_overrides
   where employee_id = _employee_id and effective_to is null;
  if v_open.id is null and v_shift is null then
    raise exception 'NO_OWN_SHIFT' using errcode = 'P0001';
  end if;
  if v_open.id is not null then
    if v_open.shift_id = v_shift then
      raise exception 'ALREADY_ON_THAT_SHIFT' using errcode = 'P0001';
    end if;
    if v_from <= v_open.effective_from then
      raise exception 'EFFECTIVE_DATE_CLASH' using errcode = 'P0001',
        detail = to_char(v_open.effective_from, 'YYYY-MM-DD');
    end if;
    update public.employee_shift_overrides set effective_to = v_from where id = v_open.id;
  end if;
  if v_shift is not null then
    begin
      insert into public.employee_shift_overrides (organization_id, employee_id, shift_id, effective_from, reason)
      select e.organization_id, e.id, v_shift, v_from, nullif(btrim(_values ->> 'reason'), '')
        from public.employees e where e.id = _employee_id;
    exception
      when exclusion_violation then
        raise exception 'EFFECTIVE_DATE_CLASH' using errcode = 'P0001';
      when check_violation then
        raise exception 'INVALID_VALUE' using errcode = 'P0001';
    end;
  end if;
end $$;

comment on function public.employee_set_shift is
  'D102 — an Admin gives a person their own shift from a date, or with shiftId null returns them to their unit''s. Closes the open one the day before.';

revoke all on function public.employee_set_shift(uuid, jsonb) from public, anon;
grant execute on function public.employee_set_shift(uuid, jsonb) to authenticated;

/**
 * The card's "Shift and calendar": today's calendar and shift, where each comes
 * from, and (when asked) the person's own-shift history.
 */
create or replace function public.employee_work_pattern(_employee_id uuid, _with_history boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_e     public.employees%rowtype;
  v_today date;
  v_unit  public.deployment_units%rowtype;
  v_cal   public.working_calendars%rowtype;
  v_own   public.employee_shift_overrides%rowtype;
  v_shift public.shifts%rowtype;
begin
  select * into v_e from public.employees where id = _employee_id;
  v_today := public.org_today(v_e.organization_id);
  select u.* into v_unit
    from public.employee_deployments d join public.deployment_units u on u.id = d.deployment_unit_id
   where d.employee_id = _employee_id and d.effective_from <= v_today
     and (d.effective_to is null or d.effective_to > v_today)
   order by d.effective_from desc limit 1;
  select * into v_cal from public.working_calendars
   where id = coalesce(v_unit.working_calendar_id, public.working_calendar_default_id(v_e.organization_id));
  select * into v_own from public.employee_shift_overrides
   where employee_id = _employee_id and effective_from <= v_today
     and (effective_to is null or effective_to > v_today);
  select * into v_shift from public.shifts where id = coalesce(v_own.shift_id, v_unit.default_shift_id);

  return jsonb_build_object(
    'calendar', jsonb_build_object('id', v_cal.id, 'name', v_cal.name,
                                   'weeklyOff', to_jsonb(v_cal.weekly_off), 'isDefault', v_cal.is_default),
    'calendarSource', case when v_unit.working_calendar_id is not null then 'unit' else 'company' end,
    'unitName', v_unit.name,
    'shift', case when v_shift.id is null then null else jsonb_build_object(
               'id', v_shift.id, 'name', v_shift.name,
               'startTime', to_char(v_shift.start_time, 'HH24:MI'),
               'endTime', to_char(v_shift.end_time, 'HH24:MI'),
               'breakMinutes', v_shift.break_minutes) end,
    'shiftSource', case when v_own.id is not null then 'person'
                        when v_shift.id is not null then 'unit' end,
    'ownShiftSince', v_own.effective_from
  ) || case when _with_history then jsonb_build_object('ownShifts', coalesce((
         select jsonb_agg(jsonb_build_object(
                  'id', o.id, 'shiftName', s.name,
                  'startTime', to_char(s.start_time, 'HH24:MI'), 'endTime', to_char(s.end_time, 'HH24:MI'),
                  'effectiveFrom', o.effective_from, 'effectiveTo', o.effective_to, 'reason', o.reason,
                  'setBy', (select coalesce(full_name, email) from public.profiles where id = o.created_by))
                order by (o.effective_to is not null), o.effective_from desc)
           from public.employee_shift_overrides o join public.shifts s on s.id = o.shift_id
          where o.employee_id = _employee_id), '[]'::jsonb))
       else '{}'::jsonb end;
end $$;

revoke all on function public.employee_work_pattern(uuid, boolean) from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════ reproduced
--
-- Each from its latest migration; the diff is marked D102 in each.

drop function if exists public.employee_units();

create or replace function public.employee_units()
returns table (
  id uuid, name text, unit_type text, client_name text, location text, state text,
  attendance_capture_mode text, requires_police_verification boolean, is_billable boolean,
  status text, posted_now integer, postings_ever integer,
  working_calendar_id uuid, default_shift_id uuid
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_org uuid := public.employee_require_config_admin();
begin
  return query
    select u.id, u.name, u.unit_type, u.client_name, u.location, u.state,
           u.attendance_capture_mode, u.requires_police_verification, u.is_billable, u.status,
           (select count(*)::int from public.employee_deployments d
             where d.deployment_unit_id = u.id and d.effective_to is null),
           (select count(*)::int from public.employee_deployments d where d.deployment_unit_id = u.id),
           u.working_calendar_id, u.default_shift_id
      from public.deployment_units u
     where u.organization_id = v_org and u.deleted_at is null
     order by (u.status = 'retired'), lower(u.name);
end $$;

revoke all on function public.employee_units() from public, anon;
grant execute on function public.employee_units() to authenticated;

create or replace function public.employee_save_unit(_unit_id uuid, _values jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org  uuid := public.employee_require_config_admin();
  v_id   uuid := _unit_id;
  v_name text := btrim(coalesce(_values ->> 'name', ''));
  v_type text := coalesce(_values ->> 'unitType', 'own_establishment');
  t      text;
begin
  perform public.restricted_known_keys(_values, array['name','unitType','clientName','location','state',
    'attendanceCaptureMode','requiresPoliceVerification','isBillable','workingCalendarId','defaultShiftId']);
  -- D102: a calendar or shift must be this company's and in use. Absent keys
  -- leave what is set; null means the company calendar, or no default shift.
  if nullif(_values ->> 'workingCalendarId', '') is not null and not exists (
       select 1 from public.working_calendars c
        where c.id = (_values ->> 'workingCalendarId')::uuid and c.organization_id = v_org
          and c.status = 'active') then
    raise exception 'CALENDAR_NOT_AVAILABLE' using errcode = 'P0001';
  end if;
  if nullif(_values ->> 'defaultShiftId', '') is not null and not exists (
       select 1 from public.shifts s
        where s.id = (_values ->> 'defaultShiftId')::uuid and s.organization_id = v_org
          and s.status = 'active') then
    raise exception 'SHIFT_NOT_AVAILABLE' using errcode = 'P0001';
  end if;
  if v_name = '' then
    raise exception 'NAME_REQUIRED' using errcode = 'P0001';
  end if;
  -- Two units with one name is the spreadsheet's duplicate-spelling problem
  -- the bundle's migration note warns about; refuse it at the source.
  if exists (select 1 from public.deployment_units
              where organization_id = v_org and lower(btrim(name)) = lower(v_name)
                and deleted_at is null and (v_id is null or id <> v_id)) then
    raise exception 'UNIT_NAME_TAKEN' using errcode = 'P0001';
  end if;

  begin
    if v_id is null then
      insert into public.deployment_units (organization_id, name, unit_type, client_name, location, state,
        attendance_capture_mode, requires_police_verification, is_billable)
      values (v_org, v_name, v_type, nullif(btrim(_values ->> 'clientName'), ''),
              nullif(btrim(_values ->> 'location'), ''), nullif(btrim(_values ->> 'state'), ''),
              nullif(btrim(_values ->> 'attendanceCaptureMode'), ''),
              coalesce((_values ->> 'requiresPoliceVerification')::boolean, false),
              coalesce((_values ->> 'isBillable')::boolean, false))
      returning id into v_id;
      update public.deployment_units set
        working_calendar_id = nullif(_values ->> 'workingCalendarId', '')::uuid,
        default_shift_id = nullif(_values ->> 'defaultShiftId', '')::uuid
       where id = v_id;
    else
      update public.deployment_units set
        name = v_name, unit_type = v_type,
        client_name = nullif(btrim(_values ->> 'clientName'), ''),
        location = nullif(btrim(_values ->> 'location'), ''),
        state = nullif(btrim(_values ->> 'state'), ''),
        attendance_capture_mode = nullif(btrim(_values ->> 'attendanceCaptureMode'), ''),
        requires_police_verification = coalesce((_values ->> 'requiresPoliceVerification')::boolean, false),
        is_billable = coalesce((_values ->> 'isBillable')::boolean, false),
        working_calendar_id = case when _values ? 'workingCalendarId'
                                   then nullif(_values ->> 'workingCalendarId', '')::uuid
                                   else working_calendar_id end,
        default_shift_id = case when _values ? 'defaultShiftId'
                                then nullif(_values ->> 'defaultShiftId', '')::uuid
                                else default_shift_id end
       where id = v_id and organization_id = v_org and deleted_at is null;
      if not found then
        raise exception 'NOT_FOUND' using errcode = 'P0002';
      end if;
    end if;
  exception when check_violation then
    get stacked diagnostics t = constraint_name;
    if t = 'deployment_units_client_matches_type' then
      raise exception 'CLIENT_REQUIRED' using errcode = 'P0001',
        hint = 'A client site names its client; your own establishment has none.';
    end if;
    raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = t;
  end;
  return v_id;
end $$;

create or replace function public.employee_move_unit(_employee_id uuid, _values jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_from   date;
  v_unit   public.deployment_units%rowtype;
  v_open   public.employee_deployments%rowtype;
  v_closed jsonb := null;
  v_shift  public.employee_shift_overrides%rowtype;
  v_shift_closed boolean := false;
  v_id     uuid;
  t        text;
begin
  perform public.employee_require_admin(_employee_id);
  perform public.restricted_known_keys(_values,
    array['unitId','effectiveFrom','orderRef','expectedDuration','reason','keepOwnShift']);
  begin
    v_from := (_values ->> 'effectiveFrom')::date;
    select * into v_unit from public.deployment_units
     where id = (_values ->> 'unitId')::uuid and organization_id = public.current_org_id()
       and deleted_at is null;
  exception when others then
    raise exception 'INVALID_VALUE' using errcode = 'P0001';
  end;
  if v_from is null then
    raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'effectiveFrom';
  end if;
  -- Not found and another company's unit answer alike.
  if v_unit.id is null then
    raise exception 'UNIT_NOT_AVAILABLE' using errcode = 'P0001';
  end if;
  if v_unit.status <> 'active' then
    raise exception 'UNIT_NOT_AVAILABLE' using errcode = 'P0001', detail = 'retired';
  end if;
  if btrim(coalesce(_values ->> 'orderRef', '')) = '' then
    raise exception 'ORDER_REF_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_open from public.employee_deployments
   where employee_id = _employee_id and effective_to is null;
  if found then
    if v_open.deployment_unit_id = v_unit.id then
      raise exception 'ALREADY_DEPLOYED_THERE' using errcode = 'P0001';
    end if;
    if v_from <= v_open.effective_from then
      raise exception 'EFFECTIVE_DATE_CLASH' using errcode = 'P0001',
        detail = to_char(v_open.effective_from, 'YYYY-MM-DD');
    end if;
    update public.employee_deployments set effective_to = v_from where id = v_open.id;
    v_closed := jsonb_build_object('id', v_open.id, 'lastDay', v_from - 1);
  end if;

  begin
    insert into public.employee_deployments
      (organization_id, employee_id, deployment_unit_id, effective_from, deployment_order_ref,
       expected_duration, reason)
    select e.organization_id, e.id, v_unit.id, v_from, btrim(_values ->> 'orderRef'),
           nullif(btrim(_values ->> 'expectedDuration'), ''), nullif(btrim(_values ->> 'reason'), '')
      from public.employees e where e.id = _employee_id
    returning id into v_id;
  exception
    when exclusion_violation then
      raise exception 'EFFECTIVE_DATE_CLASH' using errcode = 'P0001';
  end;

  -- D102: a person's own shift ends where the new posting begins, unless the
  -- Admin keeps it. One set for a later date is a deliberate choice and stays.
  if not coalesce((_values ->> 'keepOwnShift')::boolean, false) then
    select * into v_shift from public.employee_shift_overrides
     where employee_id = _employee_id and effective_to is null;
    if v_shift.id is not null and v_shift.effective_from < v_from then
      update public.employee_shift_overrides set effective_to = v_from where id = v_shift.id;
      v_shift_closed := true;
    end if;
  end if;

  return jsonb_build_object('id', v_id, 'closed', v_closed, 'ownShiftEnded', v_shift_closed);
end $$;

CREATE OR REPLACE FUNCTION public.leave_submit(_leave_type_id uuid, _from_date date, _to_date date, _reason text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user     uuid := (select auth.uid());
  v_org      uuid;
  v_type     public.leave_types%rowtype;
  v_settings public.organization_settings%rowtype;
  v_fy       text;
  v_balance  public.leave_balances%rowtype;
  v_days     numeric;
  v_notice   integer;
  v_today    date;
  v_request  uuid;
  v_approval uuid;
  v_blackout text;
begin
  if v_user is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;

  v_org := public.current_org_id();
  if v_org is null then
    raise exception 'NO_ORGANIZATION' using errcode = 'P0001';
  end if;

  -- D44. First, before anything is read or written. A module that is off must
  -- not create a balance row, reserve a day, or leave any other trace.
  if not public.module_enabled_for(v_org, 'leave') then
    raise exception 'MODULE_NOT_ENABLED' using errcode = 'P0001';
  end if;

  select * into v_settings from public.organization_settings where organization_id = v_org;
  select * into v_type from public.leave_types
   where id = _leave_type_id and organization_id = v_org
     and status = 'active' and deleted_at is null;
  if v_type.id is null then
    raise exception 'LEAVE_TYPE_NOT_FOUND' using errcode = 'P0001';
  end if;

  v_today := public.org_today(v_org);
  v_fy    := public.get_financial_year(v_org, _from_date);

  -- D34. Before ensure_balance, deliberately: a refused request must not leave
  -- a balance row behind for a year nobody can see yet.
  if not public.leave_year_open(v_org, _from_date) then
    raise exception 'NEXT_YEAR_NOT_OPEN_YET' using errcode = 'P0001';
  end if;

  -- D10 — the balance row is locked before anything is validated. Unpaid
  -- leave has none to lock: nothing is reserved, and overlapping requests are
  -- refused by the exclusion constraint either way.
  if v_type.kind <> 'unpaid' then
    perform public.ensure_balance(v_user, _leave_type_id, v_fy);
    select * into v_balance from public.leave_balances
     where organization_id = v_org and employee_id = v_user
       and leave_type_id = _leave_type_id and fy_label = v_fy
     for update;
  end if;

  if _to_date < _from_date then
    raise exception 'INVALID_DATE_RANGE' using errcode = 'P0001';
  end if;

  if _from_date < v_today and not coalesce(v_settings.allow_retroactive, false) then
    raise exception 'PAST_DATE' using errcode = 'P0001';
  end if;

  v_notice := coalesce(v_type.min_notice_days, v_settings.default_min_notice_days, 0);
  if v_notice > 0 and _from_date < v_today + v_notice then
    raise exception 'INSUFFICIENT_NOTICE: % days required', v_notice using errcode = 'P0001';
  end if;

  -- D102: against the calendar of the unit they were posted to, day by day.
  v_days := public.calculate_working_days_for(v_user, _from_date, _to_date);
  if v_days <= 0 then
    raise exception 'NO_WORKING_DAYS' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.leave_requests
     where employee_id = v_user
       and status in ('pending_approval', 'approved')
       and deleted_at is null
       and daterange(from_date, to_date, '[]') && daterange(_from_date, _to_date, '[]')
  ) then
    raise exception 'OVERLAPPING_REQUEST' using errcode = 'P0001';
  end if;

  -- A blackout period refuses every kind of leave, unpaid included, and says
  -- which one, so the person knows what to move.
  select b.name into v_blackout
    from public.leave_blackouts b
   where b.organization_id = v_org and b.deleted_at is null
     and daterange(b.from_date, b.to_date, '[]') && daterange(_from_date, _to_date, '[]')
   order by b.from_date
   limit 1;
  if v_blackout is not null then
    raise exception 'BLACKOUT_PERIOD: %', v_blackout using errcode = 'P0001';
  end if;

  if v_type.kind <> 'unpaid' and v_days > v_balance.available_days then
    raise exception 'INSUFFICIENT_BALANCE: requested %, available %', v_days, v_balance.available_days
      using errcode = 'P0001';
  end if;

  if v_type.max_per_request is not null and v_days > v_type.max_per_request then
    raise exception 'EXCEEDS_MAX_PER_REQUEST' using errcode = 'P0001';
  end if;

  insert into public.leave_requests
    (organization_id, employee_id, leave_type_id, from_date, to_date,
     working_days, reason, status, submitted_at)
  values
    (v_org, v_user, _leave_type_id, _from_date, _to_date,
     v_days, _reason, 'pending_approval', now())
  returning id into v_request;

  if v_type.kind <> 'unpaid' then
    update public.leave_balances
       set reserved_days = reserved_days + v_days
     where id = v_balance.id;
  end if;

  -- D38. A type needing no approval is settled here and now.
  if not v_type.approval_required then
    perform public.leave_mark_approved(v_request);
    return v_request;
  end if;

  v_approval := public.approval_submit(
    'leave_request', v_request,
    jsonb_build_object(
      'working_days', v_days,
      'leave_type_id', _leave_type_id,
      'employee_id', v_user
    )
  );

  update public.leave_requests set approval_request_id = v_approval where id = v_request;

  return v_request;

exception
  when exclusion_violation then
    raise exception 'OVERLAPPING_REQUEST' using errcode = 'P0001';
end $function$
;

create or replace function public.leave_absenteeism_report(_from date, _to date)
returns table (
  employee_id     uuid,
  employee_name   text,
  department_name text,
  spells          integer,
  days            numeric,
  unpaid_days     numeric,
  bradford_factor numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
begin
  if v_org is null or not public.is_module_admin('leave') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if not public.module_enabled_for(v_org, 'leave') then
    raise exception 'MODULE_NOT_ENABLED' using errcode = 'P0001';
  end if;
  perform public.leave_report_window(_from, _to);

  return query
    with spells as (
      select r.employee_id, t.kind,
             -- Only the working days inside the window.
             public.calculate_working_days_for(r.employee_id, greatest(r.from_date, _from), least(r.to_date, _to)) as d
        from public.leave_requests r
        join public.leave_types t on t.id = r.leave_type_id
       where r.organization_id = v_org and r.deleted_at is null
         and r.status = 'approved'
         and r.from_date <= _to and r.to_date >= _from
    ),
    per as (
      select s.employee_id, count(*)::int as n, sum(s.d) as total,
             coalesce(sum(s.d) filter (where s.kind = 'unpaid'), 0) as unpaid
        from spells s
       where s.d > 0
       group by s.employee_id
    )
    select per.employee_id, coalesce(p.full_name, p.email)::text, d.name::text,
           per.n, per.total, per.unpaid, (per.n * per.n * per.total)::numeric
      from per
      join public.profiles p on p.id = per.employee_id
      left join public.departments d on d.id = p.department_id
     order by 7 desc, 2;
end $$;

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

  -- ── D102: the calendar and shift they work to today. Everybody in the
  --    company: when somebody works is not private. The shift's history for
  --    the person, the Employee Admin and their manager.
  v_card := v_card || jsonb_build_object('workPattern', public.employee_work_pattern(v_e.id, self_ or admin_ or appr_));

  v_card := v_card || jsonb_build_object('capabilities', jsonb_build_object(
    'canEdit', admin_,
    'canSetShift', admin_,
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
