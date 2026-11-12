-- ============================================================================
-- NEUVTO WOS — Leave asks for a Leave Admin, not for any Admin (D84)
-- ============================================================================
--
-- Every check Leave made for "may administer leave" asked is_admin(). Each now
-- asks is_module_admin('leave'), which is is_admin() OR a module_admins row for
-- leave, so a company-wide Admin keeps everything they had and a Leave Admin
-- gains exactly this:
--
--   the three leave reports           leave_all_balances, leave_taken_report,
--                                     leave_pending_report
--   opening balances                  leave_set_opening_balance
--   any leave request's detail        leave_approval_detail
--   every leave request and balance   the two "read ... in scope" policies
--   leave types                       the two leave_types write policies
--   Leave's own settings              module_settings, for its own module only
--   scheduling a report               report_schedule_save / _remove, for the
--                                     reports of a module they administer
--
-- Not widened: People, departments, holidays, approval rules, company
-- settings. Those are the platform's and stay is_admin().
--
-- The functions are reproduced from the live definitions (pg_get_functiondef
-- after every earlier migration). The only diff in each is the admin check.
-- ============================================================================

-- ── leave_all_balances
CREATE OR REPLACE FUNCTION public.leave_all_balances()
 RETURNS TABLE(employee_id uuid, employee_name text, department_name text, leave_type_id uuid, leave_type_name text, fy_label text, entitled_days numeric, carryforward_days numeric, used_days numeric, available_days numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org uuid := public.current_org_id();
  v_fy  text;
begin
  if v_org is null or not public.is_module_admin('leave') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if not public.module_enabled_for(v_org, 'leave') then
    raise exception 'MODULE_NOT_ENABLED' using errcode = 'P0001';
  end if;

  v_fy := public.get_financial_year(v_org, public.org_today(v_org));

  -- Every active person against every active type, whether or not a balance row
  -- exists yet. Entitlement is computed for the ones that do not, so the screen
  -- shows what they WOULD get — otherwise the person most needing an opening
  -- balance is the one missing from the list.
  return query
    select p.id, coalesce(p.full_name, p.email)::text,
           d.name::text,
           t.id, t.name::text, v_fy,
           coalesce(b.entitled_days, public.calculate_entitlement(p.id, t.id, v_fy)),
           coalesce(b.carryforward_days, 0),
           coalesce(b.used_days, 0),
           coalesce(b.available_days,
                    public.calculate_entitlement(p.id, t.id, v_fy))
      from public.profiles p
      cross join public.leave_types t
      left join public.departments d on d.id = p.department_id
      left join public.leave_balances b
        on b.employee_id = p.id and b.leave_type_id = t.id and b.fy_label = v_fy
       and b.deleted_at is null
     where p.organization_id = v_org and p.deleted_at is null and p.is_active
       and t.organization_id = v_org and t.deleted_at is null and t.status = 'active'
     order by coalesce(p.full_name, p.email), t.name;
end $function$
;

-- ── leave_taken_report
CREATE OR REPLACE FUNCTION public.leave_taken_report(_from date, _to date)
 RETURNS TABLE(leave_request_id uuid, employee_name text, department_name text, leave_type_name text, from_date date, to_date date, working_days numeric, status text, submitted_at timestamp with time zone, decided_at timestamp with time zone, decided_by text, decision_note text, reason text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org uuid := public.current_org_id();
begin
  if v_org is null or not public.is_module_admin('leave') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  return query select * from public.leave_taken_report_for(v_org, _from, _to);
end $function$
;

-- ── leave_pending_report
CREATE OR REPLACE FUNCTION public.leave_pending_report()
 RETURNS TABLE(leave_request_id uuid, employee_name text, department_name text, leave_type_name text, from_date date, to_date date, working_days numeric, submitted_at timestamp with time zone, days_waiting integer, current_level smallint, required_levels smallint, waiting_on text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org uuid := public.current_org_id();
begin
  if v_org is null or not public.is_module_admin('leave') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  return query select * from public.leave_pending_report_for(v_org);
end $function$
;

-- ── leave_set_opening_balance
CREATE OR REPLACE FUNCTION public.leave_set_opening_balance(_employee_id uuid, _leave_type_id uuid, _used numeric, _carryforward numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org uuid := public.current_org_id();
  v_fy  text;
begin
  if v_org is null or not public.is_module_admin('leave') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- D44. A customer without Leave switched on has no balances to open.
  if not public.module_enabled_for(v_org, 'leave') then
    raise exception 'MODULE_NOT_ENABLED' using errcode = 'P0001';
  end if;

  if _used < 0 or _carryforward < 0 then
    raise exception 'NEGATIVE_DAYS' using errcode = 'P0001';
  end if;

  -- The screen sends step="0.5". That is a browser attribute, not a rule, and
  -- this function is granted to `authenticated`.
  if _used * 2 <> floor(_used * 2) or _carryforward * 2 <> floor(_carryforward * 2) then
    raise exception 'NOT_A_HALF_DAY' using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.profiles
                  where id = _employee_id and organization_id = v_org
                    and deleted_at is null) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.leave_types
                  where id = _leave_type_id and organization_id = v_org
                    and deleted_at is null) then
    raise exception 'LEAVE_TYPE_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_fy := public.get_financial_year(v_org, public.org_today(v_org));

  -- The row may not exist yet: balances materialise when they are READ (D12,
  -- D36), and an administrator setting an opening balance is very often the
  -- first time anybody has looked. ensure_balance seeds entitled_days from
  -- calculate_entitlement, which is what these numbers are then measured
  -- against, so it has to run first rather than be worked around.
  perform public.ensure_balance(_employee_id, _leave_type_id, v_fy);

  begin
    update public.leave_balances
       set used_days = _used, carryforward_days = _carryforward
     where organization_id = v_org
       and employee_id = _employee_id
       and leave_type_id = _leave_type_id
       and fy_label = v_fy;
  exception when check_violation then
    -- balance_not_overdrawn. The administrator has said somebody has taken more
    -- than they were ever entitled to, which is either a typo or an
    -- entitlement that needs correcting first.
    raise exception 'OPENING_BALANCE_OVERDRAWN' using errcode = 'P0001';
  end;
end $function$
;

-- ── leave_approval_detail
CREATE OR REPLACE FUNCTION public.leave_approval_detail(_approval_request_id uuid)
 RETURNS TABLE(leave_request_id uuid, employee_name text, leave_type_id uuid, leave_type_name text, from_date date, to_date date, working_days numeric, reason text, status leave_status, fy_label text, entitled_days numeric, carryforward_days numeric, used_days numeric, reserved_days numeric, pending_days numeric, available_days numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org uuid;
  v_fy  text;
begin
  -- ── tenancy, on its own.
  --
  -- is_admin() answers "holds an admin role", not "in this organisation". The
  -- entitlement test below is a disjunction, so folding tenancy into it as
  -- another alternative would let an admin of ANY tenant past the gate and
  -- leave the row filter as the only thing between them and the data.
  -- approval_timeline had exactly that bug.
  select organization_id into v_org
    from public.approval_requests
   where id = _approval_request_id and deleted_at is null;

  if v_org is null or v_org <> public.current_org_id() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- ── the same people the request itself is visible to.
  -- Restated because SECURITY DEFINER bypasses RLS and inherits nothing.
  if not (
    public.is_requester_of(_approval_request_id)
    or public.is_approver_on(_approval_request_id)
    or public.is_module_admin('leave')
  ) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- ── D44, after the two above. A caller with no business here learns only
  -- FORBIDDEN; whether this customer has Leave switched on is not their answer
  -- to have.
  if not public.module_enabled_for(v_org, 'leave') then
    raise exception 'MODULE_NOT_ENABLED' using errcode = 'P0001';
  end if;

  return query
    select r.id,
           coalesce(p.full_name, 'A colleague')::text,
           r.leave_type_id,
           t.name::text,
           r.from_date,
           r.to_date,
           r.working_days,
           r.reason,
           r.status,
           b.fy_label,
           b.entitled_days,
           b.carryforward_days,
           b.used_days,
           b.reserved_days,
           b.pending_days,
           b.available_days
      from public.leave_requests r
      join public.leave_types    t on t.id = r.leave_type_id
      left join public.profiles  p on p.id = r.employee_id and p.deleted_at is null
      -- The financial year of the FROM DATE, which is the row the reservation
      -- was taken from — leave_submit and leave_on_approval_decided both resolve
      -- it that way. Resolving it from today instead would show the wrong year's
      -- numbers for a request booked into next year under D34.
      --
      -- LEFT joined, and joined on the request's own leave_type_id: this is
      -- where "one type, not all" is actually enforced, not in the caller.
      left join public.leave_balances b
             on b.employee_id   = r.employee_id
            and b.leave_type_id = r.leave_type_id
            and b.fy_label      = public.get_financial_year(r.organization_id, r.from_date)
            and b.deleted_at is null
     where r.approval_request_id = _approval_request_id
       and r.deleted_at is null
       and r.organization_id = v_org;
end $function$
;

-- ── report_schedule_save: the gate moves below the report lookup
CREATE OR REPLACE FUNCTION public.report_schedule_save(_report_key text, _cadence report_cadence, _recipients text[], _id uuid DEFAULT NULL::uuid, _day_of_week smallint DEFAULT NULL::smallint, _day_of_month smallint DEFAULT NULL::smallint, _is_active boolean DEFAULT true)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org   uuid := public.current_org_id();
  v_clean text[];
  v_one   text;
begin
  if v_org is null then
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

  -- D84: whoever administers the report's module. A company-wide Admin
  -- administers every module; a Leave Admin schedules Leave's reports only.
  -- After the existence check, so FORBIDDEN never says a report exists.
  if not exists (
    select 1 from public.report_definitions d
     where d.report_key = _report_key
       and public.is_module_admin(d.module_key)
  ) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
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

  -- D84: editing a schedule is taking it over, so the report it sends now must
  -- also be one the caller administers, or a Leave Admin could repoint another
  -- module's schedule.
  if exists (
    select 1 from public.report_schedules s
      join public.report_definitions d on d.report_key = s.report_key
     where s.id = _id and s.organization_id = v_org and s.deleted_at is null
       and not public.is_module_admin(d.module_key)
  ) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
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
end $function$
;


-- ── report_schedule_remove
CREATE OR REPLACE FUNCTION public.report_schedule_remove(_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org uuid := public.current_org_id();
begin
  if v_org is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- D84: the schedule's report must belong to a module the caller administers.
  if exists (
    select 1 from public.report_schedules s
      join public.report_definitions d on d.report_key = s.report_key
     where s.id = _id and s.organization_id = v_org and s.deleted_at is null
       and not public.is_module_admin(d.module_key)
  ) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  update public.report_schedules
     set deleted_at = now(), is_active = false, updated_at = now()
   where id = _id and organization_id = v_org and deleted_at is null;

  if not found then
    raise exception 'SCHEDULE_NOT_FOUND' using errcode = 'P0002';
  end if;
end $function$
;


-- ═══════════════════════════════════════════════════════════ the policies

drop policy if exists "read leave balances in scope" on public.leave_balances;
create policy "read leave balances in scope" on public.leave_balances
  for select to authenticated
  using (organization_id = public.current_org_id() and deleted_at is null
         and (employee_id = (select auth.uid())
              or public.is_manager_of(employee_id)
              or public.is_module_admin('leave')));

drop policy if exists "read leave requests in scope" on public.leave_requests;
create policy "read leave requests in scope" on public.leave_requests
  for select to authenticated
  using (organization_id = public.current_org_id() and deleted_at is null
         and (employee_id = (select auth.uid())
              or public.is_manager_of(employee_id)
              or public.is_module_admin('leave')
              or exists (select 1 from public.approval_requests ar
                          where ar.id = leave_requests.approval_request_id
                            and public.is_approver_on(ar.id))));

drop policy if exists "admins write leave types" on public.leave_types;
create policy "admins write leave types" on public.leave_types
  for insert to authenticated
  with check (organization_id = public.current_org_id() and public.is_module_admin('leave'));

drop policy if exists "admins update leave types" on public.leave_types;
create policy "admins update leave types" on public.leave_types
  for update to authenticated
  using (organization_id = public.current_org_id() and public.is_module_admin('leave') and deleted_at is null)
  with check (organization_id = public.current_org_id());

-- A module's settings row is written by whoever administers that module.
drop policy if exists "admins write module settings" on public.module_settings;
create policy "admins write module settings" on public.module_settings
  for all to authenticated
  using (organization_id = public.current_org_id() and public.is_module_admin(module_key) and deleted_at is null)
  with check (organization_id = public.current_org_id() and public.is_module_admin(module_key));
