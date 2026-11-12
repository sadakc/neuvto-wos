-- ============================================================================
-- NEUVTO WOS — Employee Master configuration (E9, bundle §7.8)
-- ============================================================================
--
-- The managed lists every select on the record reads from, and the
-- onboarding checklist, written through functions (rule 3: anything a report
-- groups by comes from a managed list, and only an Admin maintains one).
--
--   employee_units()                         units, with who is and was posted
--   employee_save_unit(id, values)           add or edit; a rename relabels
--                                            every posting, because postings
--                                            point at the id
--   employee_set_unit_status(id, status)     retire or bring back; never delete
--   employee_save_designation(id, values)    likewise for designations
--   employee_set_designation_status(id, s)
--   employee_onboarding_items()              the checklist, defaults included
--   employee_save_onboarding_item(key, values)
--
-- Retiring is refused for a unit somebody is posted to NOW: they would hold
-- a posting the Move dialog can no longer offer, and the muster roll would
-- still need it. Move them first.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════ units

create or replace function public.employee_require_config_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_org uuid := public.current_org_id();
begin
  if (select auth.uid()) is null or v_org is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;
  if not public.module_enabled_for(v_org, 'employee') then
    raise exception 'MODULE_NOT_ENABLED' using errcode = 'P0001';
  end if;
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return v_org;
end $$;

revoke all on function public.employee_require_config_admin() from public, anon, authenticated;

create or replace function public.employee_units()
returns table (
  id uuid, name text, unit_type text, client_name text, location text, state text,
  attendance_capture_mode text, requires_police_verification boolean, is_billable boolean,
  status text, posted_now integer, postings_ever integer
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
           (select count(*)::int from public.employee_deployments d where d.deployment_unit_id = u.id)
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
    'attendanceCaptureMode','requiresPoliceVerification','isBillable']);
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
    else
      update public.deployment_units set
        name = v_name, unit_type = v_type,
        client_name = nullif(btrim(_values ->> 'clientName'), ''),
        location = nullif(btrim(_values ->> 'location'), ''),
        state = nullif(btrim(_values ->> 'state'), ''),
        attendance_capture_mode = nullif(btrim(_values ->> 'attendanceCaptureMode'), ''),
        requires_police_verification = coalesce((_values ->> 'requiresPoliceVerification')::boolean, false),
        is_billable = coalesce((_values ->> 'isBillable')::boolean, false)
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

revoke all on function public.employee_save_unit(uuid, jsonb) from public, anon;
grant execute on function public.employee_save_unit(uuid, jsonb) to authenticated;

create or replace function public.employee_set_unit_status(_unit_id uuid, _status text)
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
  if _status = 'retired' and exists (select 1 from public.employee_deployments
                                       where deployment_unit_id = _unit_id and effective_to is null) then
    raise exception 'UNIT_HAS_PEOPLE' using errcode = 'P0001',
      hint = 'Move the people posted there first.';
  end if;
  update public.deployment_units set status = _status
   where id = _unit_id and organization_id = v_org and deleted_at is null;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
end $$;

revoke all on function public.employee_set_unit_status(uuid, text) from public, anon;
grant execute on function public.employee_set_unit_status(uuid, text) to authenticated;

-- ═══════════════════════════════════════════════════════════ designations

create or replace function public.employee_save_designation(_designation_id uuid, _values jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org  uuid := public.employee_require_config_admin();
  v_id   uuid := _designation_id;
  v_name text := btrim(coalesce(_values ->> 'name', ''));
begin
  perform public.restricted_known_keys(_values, array['name','grade']);
  if v_name = '' then
    raise exception 'NAME_REQUIRED' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.designations
              where organization_id = v_org and lower(btrim(name)) = lower(v_name)
                and deleted_at is null and (v_id is null or id <> v_id)) then
    raise exception 'DESIGNATION_NAME_TAKEN' using errcode = 'P0001';
  end if;
  if v_id is null then
    insert into public.designations (organization_id, name, grade)
    values (v_org, v_name, nullif(btrim(_values ->> 'grade'), ''))
    returning id into v_id;
  else
    update public.designations set name = v_name, grade = nullif(btrim(_values ->> 'grade'), '')
     where id = v_id and organization_id = v_org and deleted_at is null;
    if not found then
      raise exception 'NOT_FOUND' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end $$;

revoke all on function public.employee_save_designation(uuid, jsonb) from public, anon;
grant execute on function public.employee_save_designation(uuid, jsonb) to authenticated;

create or replace function public.employee_set_designation_status(_designation_id uuid, _status text)
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
  -- Retiring a designation people hold is fine: they keep it, nobody new
  -- gets it, and the card says it is retired.
  update public.designations set status = _status
   where id = _designation_id and organization_id = v_org and deleted_at is null;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
end $$;

revoke all on function public.employee_set_designation_status(uuid, text) from public, anon;
grant execute on function public.employee_set_designation_status(uuid, text) to authenticated;

-- An Admin also needs to see retired designations to bring one back; the
-- table's read policy already lets everybody in the company read them, so
-- the screen reads it directly.

-- ═══════════════════════════════════════════════════════════ onboarding checklist

create table public.employee_onboarding_items (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  item_key        text not null,
  due_within_days smallint not null check (due_within_days between 0 and 365),
  mandatory       boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  primary key (organization_id, item_key)
);

create trigger set_audit_fields before insert or update on public.employee_onboarding_items
  for each row execute function public.set_audit_fields();
create trigger write_audit_log after insert or update or delete on public.employee_onboarding_items
  for each row execute function public.write_audit_log();
alter table public.employee_onboarding_items enable row level security;
revoke all on public.employee_onboarding_items from anon, authenticated;

/**
 * The twelve items (bundle §7.8), each checkable against the record, with
 * Neuvto's defaults. A company's row overrides the default due window and
 * whether it is mandatory; the item itself is fixed, because each one is a
 * check the database knows how to run.
 */
create or replace function public.employee_onboarding_defaults()
returns table (item_key text, label text, due_within_days smallint, mandatory boolean, sort smallint)
language sql
immutable
set search_path = public
as $$
  values
    ('work_email'::text,      'Work email, so they can be invited'::text, 0::smallint,  true,  1::smallint),
    ('designation',           'Designation',                              0::smallint,  true,  2::smallint),
    ('reports_to',            'Who they report to',                       0::smallint,  true,  3::smallint),
    ('deployment',            'Deployed to a unit',                       0::smallint,  true,  4::smallint),
    ('present_address',       'Present address',                          7::smallint,  true,  5::smallint),
    ('emergency_contact',     'Emergency contact',                        7::smallint,  true,  6::smallint),
    ('date_of_birth',         'Date of birth',                            7::smallint,  true,  7::smallint),
    ('identity_number',       'Aadhaar or PAN',                           15::smallint, true,  8::smallint),
    ('uan',                   'UAN',                                      15::smallint, true,  9::smallint),
    ('bank',                  'Bank account (Payroll role)',              15::smallint, true,  10::smallint),
    ('nominees',              'Nominees totalling 100%',                  30::smallint, true,  11::smallint),
    ('police_verification',   'Police verification done',                 30::smallint, false, 12::smallint)
$$;

grant execute on function public.employee_onboarding_defaults() to authenticated;

create or replace function public.employee_onboarding_items()
returns table (item_key text, label text, due_within_days smallint, mandatory boolean, customised boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_org uuid := public.employee_require_config_admin();
begin
  return query
    select d.item_key, d.label, coalesce(o.due_within_days, d.due_within_days),
           coalesce(o.mandatory, d.mandatory), o.item_key is not null
      from public.employee_onboarding_defaults() d
      left join public.employee_onboarding_items o
        on o.organization_id = v_org and o.item_key = d.item_key
     order by d.sort;
end $$;

revoke all on function public.employee_onboarding_items() from public, anon;
grant execute on function public.employee_onboarding_items() to authenticated;

create or replace function public.employee_save_onboarding_item(_item_key text, _due_within_days integer, _mandatory boolean)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_org uuid := public.employee_require_config_admin();
begin
  if not exists (select 1 from public.employee_onboarding_defaults() where item_key = _item_key) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if _due_within_days is null or _due_within_days < 0 or _due_within_days > 365 or _mandatory is null then
    raise exception 'INVALID_VALUE' using errcode = 'P0001';
  end if;
  insert into public.employee_onboarding_items (organization_id, item_key, due_within_days, mandatory)
  values (v_org, _item_key, _due_within_days, _mandatory)
  on conflict (organization_id, item_key)
  do update set due_within_days = excluded.due_within_days, mandatory = excluded.mandatory;
end $$;

revoke all on function public.employee_save_onboarding_item(text, integer, boolean) from public, anon;
grant execute on function public.employee_save_onboarding_item(text, integer, boolean) to authenticated;

-- ═══════════════════════════════════════════════════════════ what a record still needs

/**
 * The company's mandatory checklist items this record has not met, each with
 * whether it is past its due window (counted from the joining date). This is
 * how "the gaps become onboarding items" (bundle §7.6): the checklist decides
 * what counts as missing, not a list written into a screen.
 */
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
        'overdue', v_joined is not null and v_today > v_joined + it.due);
    end if;
  end loop;
  return v_out;
end $$;

revoke all on function public.employee_onboarding_gaps(uuid) from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════ the overview, again
--
-- Reproduced from 20261015100000_adding_people_and_letting_them_go.sql. The
-- diff is `gaps`: the company's checklist, not a fixed list.

create or replace function public.employee_admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
begin
  if (select auth.uid()) is null or v_org is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;
  if not public.module_enabled_for(v_org, 'employee') then
    raise exception 'MODULE_NOT_ENABLED' using errcode = 'P0001';
  end if;
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  return jsonb_build_object(
    -- For the form's selects. Only somebody who can approve can be a manager (D57).
    'managers', coalesce((
      select jsonb_agg(jsonb_build_object('profileId', p.id, 'fullName', coalesce(p.full_name, p.email))
                       order by lower(coalesce(p.full_name, p.email)))
        from public.profiles p
       where p.organization_id = v_org and p.is_active and p.deleted_at is null
         and public.can_approve(p.id)), '[]'::jsonb),
    'departments', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name) order by lower(d.name))
        from public.departments d
       where d.organization_id = v_org and d.deleted_at is null), '[]'::jsonb),
    'active', (select count(*) from public.profiles
                where organization_id = v_org and is_active and deleted_at is null),
    'invitedNotSignedIn', (select count(*) from public.invitations
                            where organization_id = v_org and accepted_at is null
                              and revoked_at is null and deleted_at is null),
    'drafts', (select count(*) from public.employees
                where organization_id = v_org and profile_id is null and invitation_id is null
                  and draft_full_name is not null and deleted_at is null),
    'deployedToClientUnits', (select count(distinct d.employee_id)
                                from public.employee_deployments d
                                join public.deployment_units u on u.id = d.deployment_unit_id
                               where d.organization_id = v_org and d.effective_to is null
                                 and u.unit_type = 'client_site'),
    -- "Blocks the payroll run" (bundle §7.6): no UAN, or no Aadhaar and no PAN.
    'missingStatutory', (select count(*) from public.employees e
                          left join public.profiles p on p.id = e.profile_id
                          left join public.employee_statutory s on s.employee_id = e.id
                         where e.organization_id = v_org and e.deleted_at is null
                           and coalesce(p.is_active, true)
                           and (s.employee_id is null or s.uan_last4 is null
                                or (s.aadhaar_last4 is null and s.pan_last4 is null))),
    'recent', coalesce((
      select jsonb_agg(x order by x ->> 'createdAt' desc) from (
        select jsonb_build_object(
          'id', e.id,
          'fullName', coalesce(p.full_name, i.full_name, e.draft_full_name),
          'email', coalesce(p.email, i.email, e.draft_email),
          'stage', case when p.id is not null then (case when p.is_active then 'active' else 'deactivated' end)
                        when i.id is not null then 'invited'
              when e.draft_full_name is not null then 'draft' else 'removed' end,
          'createdAt', e.created_at,
          'gaps', public.employee_onboarding_gaps(e.id)
        ) x
          from public.employees e
          left join public.profiles p on p.id = e.profile_id
          left join public.invitations i on i.id = e.invitation_id
         where e.organization_id = v_org and e.deleted_at is null
           -- A record whose person was removed is history, not somebody being added.
           and (p.id is not null or i.id is not null or e.draft_full_name is not null)
         order by e.created_at desc
         limit 50) q), '[]'::jsonb)
  );
end $$;

revoke all on function public.employee_admin_overview() from public, anon;
grant execute on function public.employee_admin_overview() to authenticated;
