-- ============================================================================
-- NEUVTO WOS — the day count explains itself
--
-- Sada applied for leave from 10 to 15 August, counted six days, was charged
-- five, and reported it as broken arithmetic. It was not: Acme is on a six-day
-- week (weekend_days = {0}), so Saturday the 15th IS worked — but it is also
-- Independence Day, a configured holiday, and exclude_holidays is on.
--
-- Five was right. The screen simply never said why, and no employee is going to
-- reason their way from "Requested: 5" to a public holiday. They will conclude
-- the product cannot count, and they will tell their administrator so.
--
-- ── WHY THIS IS A DATABASE FUNCTION AND NOT A LOOP IN THE BROWSER
--
-- ApplyLeave.tsx says it plainly at the top: "A weekend rule computed in the
-- browser will one day disagree with the one in Postgres, and the employee
-- meets that as a form which accepts a request the server then refuses." That
-- applies with more force to the EXPLANATION, which would be a second
-- implementation of the same rule whose only job is to describe the first.
--
-- So this is the complement of calculate_working_days, over the same settings,
-- with the same guard, inverting the same predicate. If the two ever disagree
-- the harness says so, because it asserts they partition the range exactly.
-- ============================================================================

create or replace function public.working_days_excluded(
  _org_id uuid,
  _from   date,
  _to     date)
returns table (day date, reason text, label text)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_weekend     smallint[];
  v_no_weekends boolean;
  v_no_holidays boolean;
begin
  -- The same guard calculate_working_days uses. Without it this function is a
  -- way to read another organisation's holiday calendar by guessing an id.
  perform public.assert_own_org(_org_id);

  if _from is null or _to is null or _to < _from then
    return;
  end if;

  select weekend_days, exclude_weekends, exclude_holidays
    into v_weekend, v_no_weekends, v_no_holidays
    from public.organization_settings
   where organization_id = _org_id;

  if v_weekend is null then
    raise exception 'NO_ORGANIZATION_SETTINGS' using errcode = 'P0002';
  end if;

  return query
  select d.day::date,
         case when v_no_weekends and extract(dow from d.day)::smallint = any (v_weekend)
              then 'weekend' else 'holiday' end as reason,
         case when v_no_weekends and extract(dow from d.day)::smallint = any (v_weekend)
              -- The day's own name. A six-day week excluding only Sunday should
              -- say "Sunday", not the word "weekend", which reads as two days.
              then to_char(d.day, 'FMDay')
              else (select h.name from public.holidays h
                     where h.organization_id = _org_id
                       and h.holiday_date = d.day::date
                       and h.deleted_at is null
                     limit 1)
         end as label
    from generate_series(_from, _to, interval '1 day') as d(day)
   where
     -- Exactly the inverse of calculate_working_days' WHERE clause. Written as
     -- the negation of the same two conditions rather than as its own rule, so
     -- there is one place a change has to be made.
     not (
       (not v_no_weekends or extract(dow from d.day)::smallint <> all (v_weekend))
       and (
         not v_no_holidays
         or not exists (
           select 1 from public.holidays h
            where h.organization_id = _org_id
              and h.holiday_date = d.day::date
              and h.deleted_at is null
         )
       )
     )
   order by d.day;
end $function$;

comment on function public.working_days_excluded(uuid, date, date) is
  'Which days in a range do not cost leave, and why. The complement of calculate_working_days over the same settings — see the migration header before changing either.';

-- A weekend day that is ALSO a holiday is reported as the weekend day. The
-- weekend is the structural rule; labelling it with the holiday would imply the
-- holiday is what saved them, and it would still have been free without it.

revoke all on function public.working_days_excluded(uuid, date, date) from public, anon;
grant execute on function public.working_days_excluded(uuid, date, date) to authenticated;
