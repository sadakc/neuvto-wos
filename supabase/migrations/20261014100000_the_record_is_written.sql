-- ============================================================================
-- NEUVTO WOS — writing the record (E7, NEUVTO_EMPLOYEE_MASTER §2, §5, §7)
-- ============================================================================
--
-- Six writers, every one an Admin's (§5: "read, write" and "read, append"):
--
--   employee_update(id, values)           the record's own fields
--   employee_add_address(id, values)      closes the open address of that type
--                                         the day before, and opens the new one
--   employee_move_unit(id, values)        the same for the deployment
--   employee_save_family(id, rows)        the whole list, as the screen holds it
--   employee_save_previous_orgs(id, rows) likewise
--   employee_save_nomination(id, values)  supersedes the scheme's open version
--
-- Rule 2 (history is closed, never overwritten) was enforced in E4 by
-- triggers and an exclusion constraint. These functions are the polite way to
-- do the only thing those allow: close a row and open its successor, in one
-- transaction, so a reader never sees a person with no address in between.
--
-- An end date is EXCLUSIVE in the table (validity is '[)'): a row closed with
-- effective_to = 1 Mar ends on 28 Feb. The screen shows the last day; the
-- functions take and return the first day of the new row.
-- ============================================================================

/** The caller must be an Admin of this person's company. Returns nothing; raises otherwise. */
create or replace function public.employee_require_admin(_employee_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not ('admin' = any (public.restricted_target(_employee_id))) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
end $$;

revoke all on function public.employee_require_admin(uuid) from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════ the record

create or replace function public.employee_update(_employee_id uuid, _values jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_known text[] := array[
    'employeeCode','nameAsPerId','sex','dateOfBirth','maritalStatus','nationality','nativeState',
    'bloodGroup','educationQualification','alternateMobile','personalEmail','designationId',
    'employmentType','reJoiningDate','confirmedOn','status','terminationDate','terminationReason',
    'reasonForLeavingLastOrg','heightCm','chestCm','weightKg','nearestPoliceStation',
    'emergencyContactName','emergencyContactRelation','emergencyContactPhone'];
  v_e public.employees%rowtype;
  t   text := '';
begin
  perform public.employee_require_admin(_employee_id);
  perform public.restricted_known_keys(_values, v_known);

  select * into v_e from public.employees where id = _employee_id;
  if _values ? 'designationId' and _values ->> 'designationId' is not null
     and not exists (select 1 from public.designations
                      where id = (_values ->> 'designationId')::uuid
                        and organization_id = v_e.organization_id
                        and status = 'active' and deleted_at is null) then
    raise exception 'DESIGNATION_NOT_AVAILABLE' using errcode = 'P0001';
  end if;

  begin
    update public.employees set
      employee_code     = case when _values ? 'employeeCode' then nullif(btrim(_values ->> 'employeeCode'), '') else employee_code end,
      name_as_per_id    = case when _values ? 'nameAsPerId' then nullif(btrim(_values ->> 'nameAsPerId'), '') else name_as_per_id end,
      sex               = case when _values ? 'sex' then _values ->> 'sex' else sex end,
      date_of_birth     = case when _values ? 'dateOfBirth' then (_values ->> 'dateOfBirth')::date else date_of_birth end,
      marital_status    = case when _values ? 'maritalStatus' then _values ->> 'maritalStatus' else marital_status end,
      nationality       = case when _values ? 'nationality' then nullif(btrim(_values ->> 'nationality'), '') else nationality end,
      native_state      = case when _values ? 'nativeState' then nullif(btrim(_values ->> 'nativeState'), '') else native_state end,
      blood_group       = case when _values ? 'bloodGroup' then _values ->> 'bloodGroup' else blood_group end,
      education_qualification = case when _values ? 'educationQualification' then nullif(btrim(_values ->> 'educationQualification'), '') else education_qualification end,
      alternate_mobile  = case when _values ? 'alternateMobile' then nullif(btrim(_values ->> 'alternateMobile'), '') else alternate_mobile end,
      personal_email    = case when _values ? 'personalEmail' then nullif(lower(btrim(_values ->> 'personalEmail')), '') else personal_email end,
      designation_id    = case when _values ? 'designationId' then (_values ->> 'designationId')::uuid else designation_id end,
      employment_type   = case when _values ? 'employmentType' then _values ->> 'employmentType' else employment_type end,
      re_joining_date   = case when _values ? 'reJoiningDate' then (_values ->> 'reJoiningDate')::date else re_joining_date end,
      confirmed_on      = case when _values ? 'confirmedOn' then (_values ->> 'confirmedOn')::date else confirmed_on end,
      status            = case when _values ? 'status' then coalesce(_values ->> 'status', 'working') else status end,
      termination_date  = case when _values ? 'terminationDate' then (_values ->> 'terminationDate')::date else termination_date end,
      termination_reason = case when _values ? 'terminationReason' then nullif(btrim(_values ->> 'terminationReason'), '') else termination_reason end,
      reason_for_leaving_last_org = case when _values ? 'reasonForLeavingLastOrg' then nullif(btrim(_values ->> 'reasonForLeavingLastOrg'), '') else reason_for_leaving_last_org end,
      height_cm         = case when _values ? 'heightCm' then (_values ->> 'heightCm')::smallint else height_cm end,
      chest_cm          = case when _values ? 'chestCm' then (_values ->> 'chestCm')::smallint else chest_cm end,
      weight_kg         = case when _values ? 'weightKg' then (_values ->> 'weightKg')::smallint else weight_kg end,
      nearest_police_station = case when _values ? 'nearestPoliceStation' then nullif(btrim(_values ->> 'nearestPoliceStation'), '') else nearest_police_station end,
      emergency_contact_name = case when _values ? 'emergencyContactName' then nullif(btrim(_values ->> 'emergencyContactName'), '') else emergency_contact_name end,
      emergency_contact_relation = case when _values ? 'emergencyContactRelation' then nullif(btrim(_values ->> 'emergencyContactRelation'), '') else emergency_contact_relation end,
      emergency_contact_phone = case when _values ? 'emergencyContactPhone' then nullif(btrim(_values ->> 'emergencyContactPhone'), '') else emergency_contact_phone end
    where id = _employee_id;
  exception
    when check_violation then
      get stacked diagnostics t = constraint_name;
      raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = t;
    when invalid_text_representation or invalid_datetime_format or numeric_value_out_of_range
         or datetime_field_overflow then
      raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = sqlerrm;
  end;
end $$;

comment on function public.employee_update is
  'E7 — an Admin edits the record''s own fields. Present keys are set (null clears), absent keys are left. Profile fields (name, phone, joined date, manager, department) keep their own writers.';

revoke all on function public.employee_update(uuid, jsonb) from public, anon;
grant execute on function public.employee_update(uuid, jsonb) to authenticated;

-- ═══════════════════════════════════════════════════════════ temporal rows

/**
 * A new address. Closes the open one of the same type the day before the new
 * one starts. A date on or before the open row's own start is a clash, not a
 * correction: rule 2 has no way to rewrite the past, so the screen says so on
 * the date field (bundle §7.2's 409).
 */
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
    exception
      when exclusion_violation then
        raise exception 'EFFECTIVE_DATE_CLASH' using errcode = 'P0001';
      when check_violation or not_null_violation then
        get stacked diagnostics t = constraint_name;
        raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = coalesce(nullif(t, ''), sqlerrm);
    end;
  end loop;

  return jsonb_build_object('id', v_id, 'closed', v_closed);
end $$;

comment on function public.employee_add_address is
  'E7 — adds an address, closing the open one of the same type the day before (rule 2). "This is also the permanent address" does the same for permanent. EFFECTIVE_DATE_CLASH when the date is not after the open row''s start.';

revoke all on function public.employee_add_address(uuid, jsonb) from public, anon;
grant execute on function public.employee_add_address(uuid, jsonb) to authenticated;

/** Moves somebody to another unit: closes the current posting the day before, opens the new one. */
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
  v_id     uuid;
  t        text;
begin
  perform public.employee_require_admin(_employee_id);
  perform public.restricted_known_keys(_values,
    array['unitId','effectiveFrom','orderRef','expectedDuration','reason']);
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

  return jsonb_build_object('id', v_id, 'closed', v_closed);
end $$;

comment on function public.employee_move_unit is
  'E7 — closes the current posting the day before and opens one at an active unit of this company, with a deployment order reference (bundle §7.3). The unit is an id, never free text.';

revoke all on function public.employee_move_unit(uuid, jsonb) from public, anon;
grant execute on function public.employee_move_unit(uuid, jsonb) to authenticated;

/**
 * A new nomination for one scheme. The whole set of nominees, totalling
 * exactly 100, supersedes the open version, which is closed the day before
 * and kept: the superseded form is what a claim is settled against.
 */
create or replace function public.employee_save_nomination(_employee_id uuid, _values jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_scheme text := coalesce(_values ->> 'scheme', 'pf_and_gratuity');
  v_from   date;
  v_rows   jsonb := _values -> 'nominees';
  v_open   public.nomination_versions%rowtype;
  v_id     uuid;
  v_org    uuid;
  t        text;
begin
  perform public.employee_require_admin(_employee_id);
  perform public.restricted_known_keys(_values, array['scheme','effectiveFrom','nominees']);
  begin
    v_from := coalesce((_values ->> 'effectiveFrom')::date, public.org_today(public.current_org_id()));
  exception when others then
    raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'effectiveFrom';
  end;
  if v_rows is null or jsonb_typeof(v_rows) <> 'array' or jsonb_array_length(v_rows) = 0 then
    raise exception 'NOMINEES_REQUIRED' using errcode = 'P0001';
  end if;

  select organization_id into v_org from public.employees where id = _employee_id;
  select * into v_open from public.nomination_versions
   where employee_id = _employee_id and scheme = v_scheme and effective_to is null;
  if found then
    if v_from <= v_open.effective_from then
      raise exception 'EFFECTIVE_DATE_CLASH' using errcode = 'P0001',
        detail = to_char(v_open.effective_from, 'YYYY-MM-DD');
    end if;
    update public.nomination_versions set effective_to = v_from where id = v_open.id;
  end if;

  begin
    insert into public.nomination_versions (organization_id, employee_id, scheme, effective_from)
    values (v_org, _employee_id, v_scheme, v_from) returning id into v_id;
    insert into public.nominees (organization_id, version_id, name, relation, date_of_birth, share_percent)
    select v_org, v_id, btrim(r ->> 'name'), r ->> 'relation', (r ->> 'dateOfBirth')::date,
           (r ->> 'sharePercent')::numeric
      from jsonb_array_elements(v_rows) r;
    -- The total is the E4 constraint trigger's to enforce (one rule, one
    -- place); made immediate so it refuses here, with the version and its
    -- nominees rolled back together, rather than at commit.
    set constraints nominee_shares_add_up immediate;
  exception
    when check_violation or not_null_violation or invalid_text_representation or invalid_datetime_format then
      get stacked diagnostics t = constraint_name;
      raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = coalesce(nullif(t, ''), sqlerrm);
    when exclusion_violation then
      raise exception 'EFFECTIVE_DATE_CLASH' using errcode = 'P0001';
  end;
  return v_id;
end $$;

revoke all on function public.employee_save_nomination(uuid, jsonb) from public, anon;
grant execute on function public.employee_save_nomination(uuid, jsonb) to authenticated;

-- ═══════════════════════════════════════════════════════════ repeating rows

/**
 * The family list, saved whole, as the screen holds it: rows with an id are
 * updated, rows without one are added, and rows no longer present are removed.
 * Family is a repeating list, not history (§3); a third son is a third row.
 */
create or replace function public.employee_save_family(_employee_id uuid, _rows jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid;
  r     jsonb;
  i     integer := 0;
  v_keep uuid[] := '{}';
  v_id  uuid;
  t     text;
begin
  perform public.employee_require_admin(_employee_id);
  if _rows is null or jsonb_typeof(_rows) <> 'array' then
    raise exception 'INVALID_VALUE' using errcode = 'P0001';
  end if;
  select organization_id into v_org from public.employees where id = _employee_id;
  begin
    for r in select * from jsonb_array_elements(_rows) loop
      perform public.restricted_known_keys(r, array['id','relation','name','dateOfBirth','isDependent']);
      v_id := nullif(r ->> 'id', '')::uuid;
      if v_id is not null then
        update public.family_members set
          relation = r ->> 'relation', name = btrim(r ->> 'name'),
          date_of_birth = (r ->> 'dateOfBirth')::date,
          is_dependent = coalesce((r ->> 'isDependent')::boolean, true), sort_order = i
         where id = v_id and employee_id = _employee_id;
        if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
      else
        insert into public.family_members
          (organization_id, employee_id, relation, name, date_of_birth, is_dependent, sort_order)
        values (v_org, _employee_id, r ->> 'relation', btrim(r ->> 'name'), (r ->> 'dateOfBirth')::date,
                coalesce((r ->> 'isDependent')::boolean, true), i)
        returning id into v_id;
      end if;
      v_keep := v_keep || v_id;
      i := i + 1;
    end loop;
  exception
    when check_violation or not_null_violation or invalid_text_representation or invalid_datetime_format then
      get stacked diagnostics t = constraint_name;
      raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = coalesce(nullif(t, ''), sqlerrm);
  end;
  delete from public.family_members where employee_id = _employee_id and id <> all (v_keep);
end $$;

revoke all on function public.employee_save_family(uuid, jsonb) from public, anon;
grant execute on function public.employee_save_family(uuid, jsonb) to authenticated;

/** Previous organisations, saved whole, like the family list. They feed total experience. */
create or replace function public.employee_save_previous_orgs(_employee_id uuid, _rows jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid;
  r     jsonb;
  v_keep uuid[] := '{}';
  v_id  uuid;
  t     text;
begin
  perform public.employee_require_admin(_employee_id);
  if _rows is null or jsonb_typeof(_rows) <> 'array' then
    raise exception 'INVALID_VALUE' using errcode = 'P0001';
  end if;
  select organization_id into v_org from public.employees where id = _employee_id;
  begin
    for r in select * from jsonb_array_elements(_rows) loop
      perform public.restricted_known_keys(r,
        array['id','organisationName','designation','fromDate','toDate','reasonForLeaving']);
      v_id := nullif(r ->> 'id', '')::uuid;
      if v_id is not null then
        update public.previous_organisations set
          organisation_name = btrim(r ->> 'organisationName'),
          designation = nullif(btrim(r ->> 'designation'), ''),
          from_date = (r ->> 'fromDate')::date, to_date = (r ->> 'toDate')::date,
          reason_for_leaving = nullif(btrim(r ->> 'reasonForLeaving'), '')
         where id = v_id and employee_id = _employee_id;
        if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
      else
        insert into public.previous_organisations
          (organization_id, employee_id, organisation_name, designation, from_date, to_date, reason_for_leaving)
        values (v_org, _employee_id, btrim(r ->> 'organisationName'), nullif(btrim(r ->> 'designation'), ''),
                (r ->> 'fromDate')::date, (r ->> 'toDate')::date, nullif(btrim(r ->> 'reasonForLeaving'), ''))
        returning id into v_id;
      end if;
      v_keep := v_keep || v_id;
    end loop;
  exception
    when check_violation or not_null_violation or invalid_text_representation or invalid_datetime_format then
      get stacked diagnostics t = constraint_name;
      raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = coalesce(nullif(t, ''), sqlerrm);
  end;
  delete from public.previous_organisations where employee_id = _employee_id and id <> all (v_keep);
end $$;

revoke all on function public.employee_save_previous_orgs(uuid, jsonb) from public, anon;
grant execute on function public.employee_save_previous_orgs(uuid, jsonb) to authenticated;
