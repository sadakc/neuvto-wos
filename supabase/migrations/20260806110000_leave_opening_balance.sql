-- ============================================================================
-- NEUVTO WOS — the leave a customer's staff have already taken
--
-- A company adopting Neuvto in August does not have a workforce with a clean
-- ledger. Somebody has taken six days; somebody else carried four over from
-- last year. Until now there was nowhere to say so, and the runbook is blunt
-- about the consequence:
--
--   "An employee who has taken 6 days this year but shows a full balance will
--    be allowed to book leave they have not got."
--
-- ── WHY THIS IS THE MODULE'S AND NOT THE PLATFORM'S
--
-- A balance is Leave's own idea. The platform has never heard of one (D30), and
-- the CSV import that brings these people in cannot set balances anyway —
-- nobody has a profile until they accept, and a balance needs a profile.
--
-- ── WHAT IS DELIBERATELY NOT WRITTEN HERE
--
-- No audit code. leave_balances already carries write_audit_log, so the row
-- before and after is recorded by the trigger — including the previous value,
-- which is the part `07` actually asks for. What makes an override traceable is
-- that this function is the only way to perform one, not that it writes a log
-- line of its own.
--
-- No overdraw check either. balance_not_overdrawn (D31) makes the bad state
-- unrepresentable, and it was added because two locks were once defending an
-- invariant nothing asserted. Re-checking it here in plpgsql would be a second
-- opinion that can drift from the constraint; catching the constraint and
-- explaining it cannot.
-- ============================================================================

create or replace function public.leave_set_opening_balance(
  _employee_id   uuid,
  _leave_type_id uuid,
  _used          numeric,
  _carryforward  numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  v_fy  text;
begin
  if v_org is null or not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- D44. A customer without Leave switched on has no balances to open.
  if not public.module_enabled_for(v_org, 'leave') then
    raise exception 'MODULE_NOT_ENABLED' using errcode = 'P0001';
  end if;

  if _used < 0 or _carryforward < 0 then
    raise exception 'NEGATIVE_DAYS' using errcode = 'P0001';
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
end $$;

comment on function public.leave_set_opening_balance is
  'Records leave already taken and carried forward, for a customer onboarding mid-year. Admin-only; audited by the trigger on leave_balances; overdraw refused by the CHECK rather than by a second opinion here.';

revoke all on function public.leave_set_opening_balance(uuid, uuid, numeric, numeric) from public, anon;
grant execute on function public.leave_set_opening_balance(uuid, uuid, numeric, numeric) to authenticated;

-- ═══════════════════════════════════════════════════════ what an admin reads
--
-- The balances screen needs everybody's numbers, and `read leave balances in
-- scope` already lets an admin see them. What it cannot do is show a row for
-- somebody whose balance has never been materialised — and that is exactly the
-- person an opening balance is for.

create or replace function public.leave_all_balances()
returns table (
  employee_id       uuid,
  employee_name     text,
  leave_type_id     uuid,
  leave_type_name   text,
  fy_label          text,
  entitled_days     numeric,
  carryforward_days numeric,
  used_days         numeric,
  available_days    numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  v_fy  text;
begin
  if v_org is null or not public.is_admin() then
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
           t.id, t.name::text, v_fy,
           coalesce(b.entitled_days, public.calculate_entitlement(p.id, t.id, v_fy)),
           coalesce(b.carryforward_days, 0),
           coalesce(b.used_days, 0),
           coalesce(b.available_days,
                    public.calculate_entitlement(p.id, t.id, v_fy))
      from public.profiles p
      cross join public.leave_types t
      left join public.leave_balances b
        on b.employee_id = p.id and b.leave_type_id = t.id and b.fy_label = v_fy
       and b.deleted_at is null
     where p.organization_id = v_org and p.deleted_at is null and p.is_active
       and t.organization_id = v_org and t.deleted_at is null and t.status = 'active'
     order by coalesce(p.full_name, p.email), t.name;
end $$;

comment on function public.leave_all_balances is
  'Every active person against every active leave type for the current year, including those whose balance has not materialised yet — which is precisely who an opening balance is for.';

revoke all on function public.leave_all_balances() from public, anon;
grant execute on function public.leave_all_balances() to authenticated;
