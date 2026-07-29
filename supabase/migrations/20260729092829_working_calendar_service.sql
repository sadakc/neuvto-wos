-- ============================================================================
-- NEUVTO WOS — Platform service: Working Calendar
--
-- Build step 3. Platform-level, not part of Leave: Attendance and Shift
-- Management consume the same holidays and the same definition of a working
-- day. A module that computed its own would eventually disagree with another.
--
-- Everything here reads organization_settings. Nothing about a financial year,
-- a weekend, or a timezone may be hardcoded — an Indian security firm on
-- April–March with a Sat/Sun weekend and a Gulf facilities company on
-- January–December with a Fri/Sat weekend are both ordinary customers.
-- ============================================================================

create table public.holidays (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  holiday_date    date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  deleted_at timestamptz,
  constraint holidays_name_not_blank check (char_length(btrim(name)) > 0),
  unique (organization_id, holiday_date)
);

create index idx_holidays_org_date on public.holidays (organization_id, holiday_date)
  where deleted_at is null;

create trigger set_audit_fields before insert or update on public.holidays
  for each row execute function public.set_audit_fields();

create trigger write_audit_log after insert or update or delete on public.holidays
  for each row execute function public.write_audit_log();

grant select, insert, update on public.holidays to authenticated;

alter table public.holidays enable row level security;

create policy "read own holidays" on public.holidays
  for select to authenticated
  using (organization_id = public.current_org_id() and deleted_at is null);

create policy "admins manage holidays" on public.holidays
  for all to authenticated
  using (organization_id = public.current_org_id() and public.is_admin() and deleted_at is null)
  with check (organization_id = public.current_org_id() and public.is_admin());

-- ═══════════════════════════════════════════════════════════ tenant guard
-- Every function below is SECURITY DEFINER and takes an organisation id, so
-- without this an authenticated user could pass someone else's id and read back
-- their weekend, holiday and timezone configuration by probing the results.
-- Configuration is not employee data, but "no cross-tenant reads" is absolute.
--
-- System contexts — triggers, migrations, scheduled jobs — have no auth.uid()
-- and may compute for any organisation. A request always has one.

create or replace function public.assert_own_org(_org_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is not null and _org_id is distinct from public.current_org_id() then
    raise exception 'TENANT_MISMATCH' using errcode = '42501';
  end if;
end $$;

comment on function public.assert_own_org is
  'Refuses a cross-tenant organisation id for an authenticated caller. System contexts (no auth.uid()) are unrestricted.';

-- ═══════════════════════════════════════════════════════════ org-local today (D9)
-- The server runs in UTC. An Indian organisation is 5½ hours ahead, so for part
-- of every day the server's date is behind the customer's. Comparing a leave
-- date against the server clock therefore rejects "tomorrow" as being in the
-- past for anyone applying late in the evening.

create or replace function public.org_today(_org_id uuid)
returns date
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_own_org(_org_id);
  return (now() at time zone coalesce(
    (select timezone from public.organization_settings where organization_id = _org_id),
    'UTC'
  ))::date;
end $$;

comment on function public.org_today is
  'D9 — today in the organisation''s own timezone. Every "is this date in the past" check must use this, never current_date.';

-- ═══════════════════════════════════════════════════════════ financial year
-- Returns '2026-27' when the year spans two calendar years, '2026' when it does
-- not. The label is what appears on a balance row, so it has to be stable and
-- human-readable.

create or replace function public.get_financial_year(_org_id uuid, _ref date default null)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_month smallint;
  v_day   smallint;
  v_ref   date;
  v_start date;
  v_year  int;
begin
  perform public.assert_own_org(_org_id);

  select fy_start_month, fy_start_day
    into v_month, v_day
    from public.organization_settings
   where organization_id = _org_id;

  if v_month is null then
    raise exception 'NO_ORGANIZATION_SETTINGS' using errcode = 'P0002';
  end if;

  -- Defaults to the organisation's own today, not the server's (D9).
  v_ref := coalesce(_ref, public.org_today(_org_id));

  v_start := make_date(extract(year from v_ref)::int, v_month, v_day);
  v_year  := extract(year from v_ref)::int;

  -- Before this year's start date means we are still in the previous year.
  if v_ref < v_start then
    v_year := v_year - 1;
  end if;

  if v_month = 1 and v_day = 1 then
    return v_year::text;                                    -- '2026'
  end if;

  return v_year::text || '-' || lpad(((v_year + 1) % 100)::text, 2, '0');  -- '2026-27'
end $$;

comment on function public.get_financial_year is
  'Financial-year label for a date, from the organisation''s configured start. 2026-27 when the year spans two calendar years, 2026 when it does not.';

-- ═══════════════════════════════════════════════════════════ working days
-- PRD Case 4: with weekends excluded, Friday to Monday is 2 days, not 4.

create or replace function public.calculate_working_days(
  _org_id uuid,
  _from   date,
  _to     date
)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_weekend      smallint[];
  v_no_weekends  boolean;
  v_no_holidays  boolean;
  v_days         numeric;
begin
  perform public.assert_own_org(_org_id);

  if _from is null or _to is null or _to < _from then
    return 0;
  end if;

  select weekend_days, exclude_weekends, exclude_holidays
    into v_weekend, v_no_weekends, v_no_holidays
    from public.organization_settings
   where organization_id = _org_id;

  if v_weekend is null then
    raise exception 'NO_ORGANIZATION_SETTINGS' using errcode = 'P0002';
  end if;

  select count(*)
    into v_days
    from generate_series(_from, _to, interval '1 day') as d(day)
   where
     -- extract(dow) is 0=Sunday..6=Saturday, matching weekend_days.
     (not v_no_weekends or extract(dow from d.day)::smallint <> all (v_weekend))
     and (
       not v_no_holidays
       or not exists (
         select 1 from public.holidays h
          where h.organization_id = _org_id
            and h.holiday_date = d.day::date
            and h.deleted_at is null
       )
     );

  return v_days;
end $$;

comment on function public.calculate_working_days is
  'Working days between two dates inclusive, honouring the organisation''s weekend and holiday configuration. Returns 0 when the range contains no working day.';

grant execute on function public.assert_own_org(uuid)                   to authenticated;
grant execute on function public.org_today(uuid)                        to authenticated;
grant execute on function public.get_financial_year(uuid, date)         to authenticated;
grant execute on function public.calculate_working_days(uuid, date, date) to authenticated;
