-- NEUVTO WOS — shift and working calendar (D102)
--
-- Raises on the first violation. Silence means pass. Rolled back.
--
-- PHASE-AWARE: exits quietly if working_calendars does not exist yet.
--
--   CALENDARS  every company has its Company calendar, equal to its Settings;
--              the Employee Admin adds others; the Company one is not edited
--              here; one in use is not retired; another company's is never
--              usable.
--   COUNTING   leave costs each day on the calendar of the unit the person was
--              posted to that day; a holiday limited to some calendars frees
--              only those; what is charged, what the preview says and what it
--              explains all agree, and partition the range.
--   SHIFTS     a unit's default, a person's own from a date with history that
--              never changes, cleared back to the unit's, ended by a move
--              unless kept; nothing usable across companies.

begin;

create or replace function pg_temp.sc_as(_uid uuid) returns void as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', _uid::text, 'role', 'authenticated')::text, true);
end $$ language plpgsql;

create or replace function pg_temp.sc_root() returns void as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$ language plpgsql;

create or replace function pg_temp.sc_ok(_label text) returns void as $$
begin raise notice 'ok: %', _label; end $$ language plpgsql;

create or replace function pg_temp.sc_refused(_label text, _uid uuid, _sql text, _needle text)
returns void as $$
declare v_msg text;
begin
  if _uid is null then perform pg_temp.sc_root(); else perform pg_temp.sc_as(_uid); end if;
  begin
    execute _sql;
  exception when others then
    v_msg := sqlerrm;
  end;
  perform pg_temp.sc_root();
  if v_msg is null then
    raise exception 'CALENDAR FAIL: % — it was allowed', _label;
  end if;
  if v_msg not ilike '%' || _needle || '%' then
    raise exception 'CALENDAR FAIL: % — refused for the wrong reason: %', _label, v_msg;
  end if;
  perform pg_temp.sc_ok(_label);
end $$ language plpgsql;

create or replace function pg_temp.sc_val(_uid uuid, _sql text) returns text as $$
declare v text;
begin
  perform pg_temp.sc_as(_uid);
  execute _sql into v;
  perform pg_temp.sc_root();
  return v;
exception when others then
  perform pg_temp.sc_root();
  raise exception 'CALENDAR FAIL: refused: % — %', _sql, sqlerrm;
end $$ language plpgsql;

create or replace function pg_temp.sc_check(_label text, _got text, _want text) returns void as $$
begin
  if _got is distinct from _want then
    raise exception 'CALENDAR FAIL: % — got %, wanted %', _label, _got, _want;
  end if;
  perform pg_temp.sc_ok(_label);
end $$ language plpgsql;

do $$
declare
  acme   uuid := '00000000-0000-0000-0000-0000000000a0';
  vertex uuid := '00000000-0000-0000-0000-0000000000b0';
  hema   uuid := '00000000-0000-0000-0000-00000000a002';  -- company Admin
  dan    uuid := '00000000-0000-0000-0000-00000000a003';  -- Employee Admin
  mark   uuid := '00000000-0000-0000-0000-00000000a004';  -- Ravi's manager
  ravi   uuid := '00000000-0000-0000-0000-00000000a005';
  priya  uuid := '00000000-0000-0000-0000-00000000a006';
  bob    uuid := '00000000-0000-0000-0000-00000000b001';
  e_ravi uuid; e_priya uuid;
  c_company uuid; c_six uuid; c_spare uuid; c_vertex uuid;
  u_hq uuid; u_hosur uuid; u_pune uuid;
  s_day uuid; s_night uuid; s_spare uuid; s_vertex uuid;
  h_mid uuid;
  today date;
  j jsonb;
  n numeric; m numeric;
  r_ravi uuid; r_priya uuid;
begin
  if to_regclass('public.working_calendars') is null then
    raise notice 'skip: working calendars do not exist yet';
    return;
  end if;

  insert into public.organization_modules (organization_id, module_key, enabled, enabled_at)
  values (acme, 'employee', true, now()), (vertex, 'employee', true, now())
  on conflict (organization_id, module_key) do update set enabled = true, deleted_at = null;
  delete from public.module_admins;
  insert into public.module_admins (organization_id, user_id, module_key) values (acme, dan, 'employee');
  select id into e_ravi from public.employees where profile_id = ravi;
  select id into e_priya from public.employees where profile_id = priya;
  today := public.org_today(acme);

  -- ════════════════════════════════════════════ the Company calendar

  select id into c_company from public.working_calendars where organization_id = acme and is_default;
  select id into c_vertex from public.working_calendars where organization_id = vertex and is_default;
  perform pg_temp.sc_check('each company has its Company calendar, equal to its Settings',
    (select string_agg((c.weekly_off = s.weekend_days)::text, ',' order by c.organization_id)
       from public.working_calendars c join public.organization_settings s using (organization_id)
      where c.is_default and c.organization_id in (acme, vertex)), 'true,true');
  -- Acme's Settings are what the Settings screen writes; the calendar follows.
  update public.organization_settings set weekend_days = '{0}' where organization_id = acme;
  perform pg_temp.sc_check('changing Settings changes the Company calendar',
    (select weekly_off::text from public.working_calendars where id = c_company), '{0}');
  update public.organization_settings set weekend_days = '{0,6}' where organization_id = acme;

  -- ════════════════════════════════════════════ other calendars

  c_six := pg_temp.sc_val(dan, 'select public.employee_save_calendar(null, ''{"name":"Six-day sites"}'')')::uuid;
  perform pg_temp.sc_check('a new calendar starts with Sunday off',
    (select weekly_off::text from public.working_calendars where id = c_six), '{0}');
  c_spare := pg_temp.sc_val(hema, 'select public.employee_save_calendar(null, ''{"name":"Gulf week","weeklyOff":[6,5,5]}'')')::uuid;
  perform pg_temp.sc_check('the Admin picks the offs; repeats are dropped',
    (select weekly_off::text from public.working_calendars where id = c_spare), '{5,6}');
  perform pg_temp.sc_refused('a week with no working day is refused', dan,
    'select public.employee_save_calendar(null, ''{"name":"Never","weeklyOff":[0,1,2,3,4,5,6]}'')', 'INVALID_VALUE');
  perform pg_temp.sc_refused('a day that is not a day is refused', dan,
    'select public.employee_save_calendar(null, ''{"name":"Odd","weeklyOff":[7]}'')', 'INVALID_VALUE');
  perform pg_temp.sc_refused('nor a word', dan,
    'select public.employee_save_calendar(null, ''{"name":"Odd","weeklyOff":["sun"]}'')', 'INVALID_VALUE');
  perform pg_temp.sc_refused('a name already used, however spelt, is refused', dan,
    'select public.employee_save_calendar(null, ''{"name":"  six-DAY sites "}'')', 'CALENDAR_NAME_TAKEN');
  perform pg_temp.sc_refused('the Company calendar is set on Settings, not here', dan,
    format('select public.employee_save_calendar(%L, ''{"name":"Mine","weeklyOff":[0]}'')', c_company),
    'COMPANY_CALENDAR_IS_SET_IN_SETTINGS');
  perform pg_temp.sc_refused('nor retired', dan,
    format('select public.employee_set_calendar_status(%L, %L)', c_company, 'retired'),
    'COMPANY_CALENDAR_IS_SET_IN_SETTINGS');
  perform pg_temp.sc_refused('an employee cannot add one', ravi,
    'select public.employee_save_calendar(null, ''{"name":"Mine"}'')', 'FORBIDDEN');
  perform pg_temp.sc_refused('the manager cannot either', mark,
    'select public.employee_save_calendar(null, ''{"name":"Mine"}'')', 'FORBIDDEN');
  perform pg_temp.sc_refused('another company''s admin cannot edit Acme''s', bob,
    format('select public.employee_save_calendar(%L, ''{"name":"Taken"}'')', c_six), 'NOT_FOUND');
  perform pg_temp.sc_refused('calendars are not written directly', hema,
    format('insert into public.working_calendars (organization_id, name) values (%L, %L)', acme, 'Direct'),
    'permission denied');
  perform pg_temp.sc_check('another company''s calendars cannot be read',
    pg_temp.sc_val(bob, format('select count(*) from public.working_calendars where organization_id = %L', acme)), '0');

  -- ════════════════════════════════════════════ units carry a calendar

  insert into public.deployment_units (organization_id, name, unit_type) values (acme, 'Acme HQ', 'own_establishment')
  returning id into u_hq;
  u_hosur := pg_temp.sc_val(dan, format(
    'select public.employee_save_unit(null, ''{"name":"Tata AIG, Hosur","unitType":"client_site","clientName":"Tata AIG","workingCalendarId":"%s"}'')', c_six))::uuid;
  perform pg_temp.sc_check('a unit names its calendar',
    (select working_calendar_id::text from public.deployment_units where id = u_hosur), c_six::text);
  perform pg_temp.sc_val(dan, format(
    'select public.employee_save_unit(%L, ''{"name":"Tata AIG, Hosur","unitType":"client_site","clientName":"Tata AIG"}'')', u_hosur));
  perform pg_temp.sc_check('saving a unit without the key keeps its calendar',
    (select working_calendar_id::text from public.deployment_units where id = u_hosur), c_six::text);
  perform pg_temp.sc_refused('another company''s calendar is not usable', dan,
    format('select public.employee_save_unit(%L, ''{"name":"Acme HQ","unitType":"own_establishment","workingCalendarId":"%s"}'')', u_hq, c_vertex),
    'CALENDAR_NOT_AVAILABLE');
  perform pg_temp.sc_refused('a calendar a unit uses is not retired', dan,
    format('select public.employee_set_calendar_status(%L, %L)', c_six, 'retired'), 'CALENDAR_IN_USE');
  perform pg_temp.sc_val(dan, format('select public.employee_set_calendar_status(%L, %L)::text', c_spare, 'retired'));
  perform pg_temp.sc_refused('a retired calendar is not usable', dan,
    format('select public.employee_save_unit(%L, ''{"name":"Acme HQ","unitType":"own_establishment","workingCalendarId":"%s"}'')', u_hq, c_spare),
    'CALENDAR_NOT_AVAILABLE');
  perform pg_temp.sc_check('the list counts the units on each calendar',
    pg_temp.sc_val(dan, 'select string_agg(name || ''='' || units, '','' order by is_default desc, name) from public.employee_calendars()'),
    'Company calendar=1,Gulf week=0,Six-day sites=1');

  -- ════════════════════════════════════════════ counting, day by day

  -- Ravi at HQ (Company calendar, Saturday and Sunday off) until he moves to
  -- Hosur (Sunday only) on Monday 2 Nov 2026. Priya stays at HQ.
  insert into public.employee_deployments (organization_id, employee_id, deployment_unit_id, effective_from, effective_to, deployment_order_ref)
  values (acme, e_ravi, u_hq, '2026-01-01', '2026-11-02', 'DO-1'),
         (acme, e_ravi, u_hosur, '2026-11-02', null, 'DO-2'),
         (acme, e_priya, u_hq, '2026-01-01', null, 'DO-3');

  perform pg_temp.sc_check('the week before the move: five days',
    public.calculate_working_days_for(ravi, '2026-10-26', '2026-11-01')::text, '5');
  perform pg_temp.sc_check('the week after: six',
    public.calculate_working_days_for(ravi, '2026-11-02', '2026-11-08')::text, '6');
  perform pg_temp.sc_check('a range across the move counts each side by its own calendar',
    public.calculate_working_days_for(ravi, '2026-10-31', '2026-11-07')::text, '6');
  perform pg_temp.sc_check('Priya, never moved, five',
    public.calculate_working_days_for(priya, '2026-11-02', '2026-11-08')::text, '5');
  perform pg_temp.sc_check('the company count is the Company calendar''s',
    public.calculate_working_days(acme, '2026-11-02', '2026-11-08')::text, '5');
  perform pg_temp.sc_check('somebody posted nowhere counts on the Company calendar',
    public.calculate_working_days_for('00000000-0000-0000-0000-00000000a008', '2026-11-02', '2026-11-08')::text, '5');

  -- A Wednesday holiday for the six-day sites only.
  insert into public.holidays (organization_id, name, holiday_date) values (acme, 'Site day', '2026-11-04')
  returning id into h_mid;
  perform pg_temp.sc_val(hema, format('select public.holiday_set_calendars(%L, array[%L]::uuid[])::text', h_mid, c_six));
  perform pg_temp.sc_check('a holiday limited to a calendar frees its people',
    public.calculate_working_days_for(ravi, '2026-11-02', '2026-11-08')::text, '5');
  perform pg_temp.sc_check('and nobody else',
    public.calculate_working_days_for(priya, '2026-11-02', '2026-11-08')::text, '5');
  perform pg_temp.sc_check('the company count does not see it either',
    public.calculate_working_days(acme, '2026-11-04', '2026-11-04')::text, '1');
  perform pg_temp.sc_val(hema, format('select public.holiday_set_calendars(%L, array[%L]::uuid[])::text', h_mid, c_company));
  perform pg_temp.sc_check('limited to the Company calendar, it frees Priya',
    public.calculate_working_days_for(priya, '2026-11-04', '2026-11-04')::text, '0');
  perform pg_temp.sc_check('and not Ravi',
    public.calculate_working_days_for(ravi, '2026-11-04', '2026-11-04')::text, '1');
  perform pg_temp.sc_val(hema, format('select public.holiday_set_calendars(%L, %L::uuid[])::text', h_mid, '{}'));
  perform pg_temp.sc_check('limited to nothing, it is everybody''s',
    public.calculate_working_days_for(ravi, '2026-11-04', '2026-11-04') || '/' ||
    public.calculate_working_days_for(priya, '2026-11-04', '2026-11-04'), '0/0');
  perform pg_temp.sc_refused('an employee cannot limit a holiday', ravi,
    format('select public.holiday_set_calendars(%L, array[%L]::uuid[])', h_mid, c_six), 'FORBIDDEN');
  perform pg_temp.sc_refused('nor the Employee Admin, who is not a company Admin', dan,
    format('select public.holiday_set_calendars(%L, array[%L]::uuid[])', h_mid, c_six), 'FORBIDDEN');
  perform pg_temp.sc_refused('another company''s calendar is refused', hema,
    format('select public.holiday_set_calendars(%L, array[%L]::uuid[])', h_mid, c_vertex), 'CALENDAR_NOT_AVAILABLE');
  perform pg_temp.sc_refused('another company''s holiday is not found', bob,
    format('select public.holiday_set_calendars(%L, %L::uuid[])', h_mid, '{}'), 'NOT_FOUND');
  delete from public.holidays where id = h_mid;

  -- The preview, its explanation and the charge agree.
  perform pg_temp.sc_check('Ravi''s preview counts on his calendar',
    pg_temp.sc_val(ravi, 'select public.my_working_days(''2026-11-02'', ''2026-11-08'')'), '6');
  perform pg_temp.sc_check('and says the Sunday is why',
    pg_temp.sc_val(ravi, 'select string_agg(label, '','' order by day) from public.my_days_excluded(''2026-11-02'', ''2026-11-08'')'),
    'Sunday');
  perform pg_temp.sc_check('Priya''s says Saturday and Sunday',
    pg_temp.sc_val(priya, 'select string_agg(label, '','' order by day) from public.my_days_excluded(''2026-11-02'', ''2026-11-08'')'),
    'Saturday,Sunday');
  perform pg_temp.sc_check('counted and explained days partition the range',
    pg_temp.sc_val(ravi, 'select public.my_working_days(''2026-10-01'', ''2026-11-30'') + (select count(*) from public.my_days_excluded(''2026-10-01'', ''2026-11-30''))'),
    '61');
  perform pg_temp.sc_refused('the per-person rule is not callable directly', ravi,
    format('select public.calculate_working_days_for(%L, current_date, current_date)', priya), 'permission denied');
  perform pg_temp.sc_refused('nor the day rule', ravi,
    format('select * from public.calendar_day(%L, %L, current_date)', acme, c_six), 'permission denied');

  r_ravi := pg_temp.sc_val(ravi, 'select public.leave_submit(''00000000-0000-0000-0000-0000000000c1'', ''2026-11-05'', ''2026-11-07'')')::uuid;
  r_priya := pg_temp.sc_val(priya, 'select public.leave_submit(''00000000-0000-0000-0000-0000000000c1'', ''2026-11-05'', ''2026-11-07'')')::uuid;
  perform pg_temp.sc_check('Thursday to Saturday costs Ravi three days and Priya two',
    (select working_days from public.leave_requests where id = r_ravi) || '/' ||
    (select working_days from public.leave_requests where id = r_priya), '3/2');

  -- Moving Priya to Hosur after she asked does not change what she asked for.
  update public.employee_deployments set effective_to = '2026-11-01' where employee_id = e_priya and effective_to is null;
  insert into public.employee_deployments (organization_id, employee_id, deployment_unit_id, effective_from, deployment_order_ref)
  values (acme, e_priya, u_hosur, '2026-11-01', 'DO-4');
  perform pg_temp.sc_check('leave already asked for keeps its count',
    (select working_days::text from public.leave_requests where id = r_priya), '2');

  -- The absenteeism report counts each person's days on their own calendar.
  update public.leave_requests set status = 'approved' where id in (r_ravi, r_priya);
  perform pg_temp.sc_check('the absenteeism report counts Ravi''s three',
    pg_temp.sc_val(hema, format('select days from public.leave_absenteeism_report(''2026-11-01'', ''2026-11-30'') where employee_id = %L', ravi)),
    '3');

  -- ════════════════════════════════════════════ shifts

  s_day := pg_temp.sc_val(dan, 'select public.employee_save_shift(null, ''{"name":"General","startTime":"09:00","endTime":"18:00","breakMinutes":60}'')')::uuid;
  s_night := pg_temp.sc_val(dan, 'select public.employee_save_shift(null, ''{"name":"Night","startTime":"20:00","endTime":"08:00","breakMinutes":30}'')')::uuid;
  s_spare := pg_temp.sc_val(dan, 'select public.employee_save_shift(null, ''{"name":"Spare","startTime":"06:00","endTime":"14:00"}'')')::uuid;
  perform pg_temp.sc_ok('a night shift ends the next morning');
  perform pg_temp.sc_refused('a shift that starts when it ends is refused', dan,
    'select public.employee_save_shift(null, ''{"name":"Zero","startTime":"09:00","endTime":"09:00"}'')', 'INVALID_VALUE');
  perform pg_temp.sc_refused('a break over four hours is refused', dan,
    'select public.employee_save_shift(null, ''{"name":"Long","startTime":"09:00","endTime":"18:00","breakMinutes":300}'')', 'INVALID_VALUE');
  perform pg_temp.sc_refused('a time that is not a time is refused', dan,
    'select public.employee_save_shift(null, ''{"name":"Bad","startTime":"25:00","endTime":"18:00"}'')', 'INVALID_VALUE');
  perform pg_temp.sc_refused('a name already used is refused', dan,
    'select public.employee_save_shift(null, ''{"name":"general","startTime":"10:00","endTime":"19:00"}'')', 'SHIFT_NAME_TAKEN');
  perform pg_temp.sc_refused('an employee cannot add one', ravi,
    'select public.employee_save_shift(null, ''{"name":"Mine","startTime":"10:00","endTime":"19:00"}'')', 'FORBIDDEN');
  insert into public.shifts (organization_id, name, start_time, end_time) values (vertex, 'Gulf day', '08:00', '17:00')
  returning id into s_vertex;
  perform pg_temp.sc_refused('another company''s shift is not a unit''s default', dan,
    format('select public.employee_save_unit(%L, ''{"name":"Tata AIG, Hosur","unitType":"client_site","clientName":"Tata AIG","defaultShiftId":"%s"}'')', u_hosur, s_vertex),
    'SHIFT_NOT_AVAILABLE');
  perform pg_temp.sc_val(dan, format(
    'select public.employee_save_unit(%L, ''{"name":"Tata AIG, Hosur","unitType":"client_site","clientName":"Tata AIG","defaultShiftId":"%s"}'')', u_hosur, s_day));

  j := pg_temp.sc_val(ravi, 'select public.employee_card() -> ''workPattern''')::jsonb;
  if today >= '2026-11-02' then
    raise exception 'CALENDAR FAIL: fixture — this suite assumes today is before 2 Nov 2026 (%)', today;
  end if;
  -- Today Ravi is still at HQ: Company calendar, no unit shift.
  perform pg_temp.sc_check('today: HQ''s Company calendar, no shift',
    (j -> 'calendar' ->> 'name') || '/' || (j ->> 'calendarSource') || '/' || coalesce(j ->> 'shift', 'none'),
    'Company calendar/company/none');
  -- Bring the move to today, and read again.
  perform set_config('neuvto.purge', 'on', true);
  update public.employee_deployments set effective_to = today where employee_id = e_ravi and deployment_unit_id = u_hq;
  update public.employee_deployments set effective_from = today where employee_id = e_ravi and deployment_unit_id = u_hosur;
  perform set_config('neuvto.purge', '', true);
  j := pg_temp.sc_val(ravi, 'select public.employee_card() -> ''workPattern''')::jsonb;
  perform pg_temp.sc_check('posted to Hosur: its calendar and its shift',
    (j -> 'calendar' ->> 'name') || '/' || (j ->> 'calendarSource') || '/' || (j -> 'shift' ->> 'name') || '/' || (j ->> 'shiftSource')
      || '/' || (j -> 'shift' ->> 'startTime') || '-' || (j -> 'shift' ->> 'endTime'),
    'Six-day sites/unit/General/unit/09:00-18:00');
  perform pg_temp.sc_check('a colleague sees when he works',
    pg_temp.sc_val(priya, format('select public.employee_card(%L) -> ''workPattern'' -> ''shift'' ->> ''name''', e_ravi)), 'General');
  perform pg_temp.sc_check('but not his shift history',
    pg_temp.sc_val(priya, format('select (public.employee_card(%L) -> ''workPattern'') ? ''ownShifts''', e_ravi)), 'false');

  -- His own shift.
  perform pg_temp.sc_val(dan, format('select public.employee_set_shift(%L, ''{"shiftId":"%s","effectiveFrom":"%s","reason":"Night post"}'')::text', e_ravi, s_night, today));
  j := pg_temp.sc_val(ravi, 'select public.employee_card() -> ''workPattern''')::jsonb;
  perform pg_temp.sc_check('his own shift wins over the unit''s',
    (j -> 'shift' ->> 'name') || '/' || (j ->> 'shiftSource') || '/' || (j ->> 'ownShiftSince'), 'Night/person/' || today);
  perform pg_temp.sc_check('his manager sees the history',
    pg_temp.sc_val(mark, format('select jsonb_array_length(public.employee_card(%L) -> ''workPattern'' -> ''ownShifts'')', e_ravi)), '1');
  perform pg_temp.sc_refused('the same shift again is refused', dan,
    format('select public.employee_set_shift(%L, ''{"shiftId":"%s","effectiveFrom":"%s"}'')', e_ravi, s_night, today + 3), 'ALREADY_ON_THAT_SHIFT');
  perform pg_temp.sc_refused('a date on or before the open one''s start is a clash', dan,
    format('select public.employee_set_shift(%L, ''{"shiftId":"%s","effectiveFrom":"%s"}'')', e_ravi, s_spare, today), 'EFFECTIVE_DATE_CLASH');
  perform pg_temp.sc_refused('the manager cannot set it', mark,
    format('select public.employee_set_shift(%L, ''{"shiftId":"%s","effectiveFrom":"%s"}'')', e_ravi, s_spare, today + 5), 'FORBIDDEN');
  perform pg_temp.sc_refused('nor Ravi', ravi,
    format('select public.employee_set_shift(%L, ''{"shiftId":"%s","effectiveFrom":"%s"}'')', e_ravi, s_spare, today + 5), 'FORBIDDEN');
  perform pg_temp.sc_refused('nor another company''s admin', bob,
    format('select public.employee_set_shift(%L, ''{"shiftId":"%s","effectiveFrom":"%s"}'')', e_ravi, s_vertex, today + 5), 'NOT_FOUND');
  perform pg_temp.sc_refused('another company''s shift is refused', dan,
    format('select public.employee_set_shift(%L, ''{"shiftId":"%s","effectiveFrom":"%s"}'')', e_ravi, s_vertex, today + 5), 'SHIFT_NOT_AVAILABLE');
  perform pg_temp.sc_refused('a shift somebody has is not retired', dan,
    format('select public.employee_set_shift_status(%L, %L)', s_night, 'retired'), 'SHIFT_IN_USE');
  perform pg_temp.sc_refused('nor a unit''s default', dan,
    format('select public.employee_set_shift_status(%L, %L)', s_day, 'retired'), 'SHIFT_IN_USE');
  perform pg_temp.sc_val(dan, format('select public.employee_set_shift_status(%L, %L)::text', s_spare, 'retired'));
  perform pg_temp.sc_refused('a retired shift is not given to anybody', dan,
    format('select public.employee_set_shift(%L, ''{"shiftId":"%s","effectiveFrom":"%s"}'')', e_ravi, s_spare, today + 5), 'SHIFT_NOT_AVAILABLE');

  -- Back to the unit's.
  perform pg_temp.sc_val(dan, format('select public.employee_set_shift(%L, ''{"shiftId":null,"effectiveFrom":"%s"}'')::text', e_ravi, today + 7));
  perform pg_temp.sc_check('clearing closes his own shift the day before',
    (select effective_to::text from public.employee_shift_overrides where employee_id = e_ravi), (today + 7)::text);
  perform pg_temp.sc_refused('clearing again is refused', dan,
    format('select public.employee_set_shift(%L, ''{"shiftId":null,"effectiveFrom":"%s"}'')', e_ravi, today + 9), 'NO_OWN_SHIFT');
  perform pg_temp.sc_refused('a closed shift row never changes', null,
    format('update public.employee_shift_overrides set reason = %L where employee_id = %L', 'edited', e_ravi), 'ARCHIVED_IMMUTABLE');
  perform pg_temp.sc_refused('nor is deleted', null,
    format('delete from public.employee_shift_overrides where employee_id = %L', e_ravi), 'HISTORY_IS_NEVER_DELETED');
  perform pg_temp.sc_refused('nor written directly', dan,
    format('insert into public.employee_shift_overrides (organization_id, employee_id, shift_id, effective_from) values (%L, %L, %L, %L)', acme, e_ravi, s_night, today + 20),
    'permission denied');

  -- A move ends his own shift, unless kept.
  perform pg_temp.sc_val(dan, format('select public.employee_set_shift(%L, ''{"shiftId":"%s","effectiveFrom":"%s"}'')::text', e_ravi, s_night, today + 10));
  u_pune := pg_temp.sc_val(dan, 'select public.employee_save_unit(null, ''{"name":"Pune office","unitType":"own_establishment"}'')')::uuid;
  j := pg_temp.sc_val(dan, format('select public.employee_move_unit(%L, ''{"unitId":"%s","effectiveFrom":"%s","orderRef":"DO-5","keepOwnShift":true}'')', e_ravi, u_pune, today + 12));
  perform pg_temp.sc_check('kept: his own shift carries on',
    (j ->> 'ownShiftEnded') || '/' || (select count(*) from public.employee_shift_overrides where employee_id = e_ravi and effective_to is null),
    'false/1');
  j := pg_temp.sc_val(dan, format('select public.employee_move_unit(%L, ''{"unitId":"%s","effectiveFrom":"%s","orderRef":"DO-6"}'')', e_ravi, u_hosur, today + 15));
  perform pg_temp.sc_check('not kept: it ends where the new posting begins',
    (j ->> 'ownShiftEnded') || '/' ||
    (select effective_to::text from public.employee_shift_overrides where employee_id = e_ravi and effective_from = today + 10),
    'true/' || (today + 15));

  raise notice 'shift and calendar: all checks passed';
end $$;

rollback;
