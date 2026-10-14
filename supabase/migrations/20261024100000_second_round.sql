-- Sada's second round (D104). Two things the database holds that it did not:
--
--   1. Experience before joining, typed by an Admin as years and months. When
--      it is set it stands in for the previous organisations' sum, which is
--      what a record without those rows had no other way to say; service here
--      is still added, so the total keeps counting by itself.
--   2. Indian as the nationality a new record starts with. Existing records
--      are left as they are: an empty nationality stays empty until somebody
--      saves one.
--
-- Everything else in the round is on the screen.

alter table public.employees
  add column prior_experience_months smallint
    constraint employees_prior_experience_months_check
    check (prior_experience_months between 0 and 720);

comment on column public.employees.prior_experience_months is
  'D104: experience before joining, in months, typed by an Admin. When set, employee_experience_months uses it in place of the previous organisations'' sum.';

alter table public.employees alter column nationality set default 'Indian';

create or replace function public.employee_experience_months(_employee_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select (
    coalesce(e.prior_experience_months,
      (select sum((date_part('year', age(po.to_date, po.from_date)) * 12
                   + date_part('month', age(po.to_date, po.from_date)))::integer)
         from public.previous_organisations po
        where po.employee_id = e.id),
      0)
    + coalesce((select (date_part('year', age(public.org_today(e.organization_id),
                         coalesce(e.re_joining_date, p.joined_date))) * 12
                        + date_part('month', age(public.org_today(e.organization_id),
                         coalesce(e.re_joining_date, p.joined_date))))::integer
                  from public.profiles p where p.id = e.profile_id), 0)
  )::integer
    from public.employees e
   where e.id = _employee_id
$$;

-- employee_update, as 20261023100000 left it, taking priorExperienceMonths.
create or replace function public.employee_update(_employee_id uuid, _values jsonb)
 returns void
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare
  v_known text[] := array[
    'employeeCode','nameAsPerId','sex','dateOfBirth','maritalStatus','nationality','nativeState',
    'bloodGroup','educationQualification','alternateMobile','personalEmail','designationId',
    'employmentType','reJoiningDate','confirmedOn','status','terminationDate','terminationReason',
    'reasonForLeavingLastOrg','heightCm','chestCm','weightKg','nearestPoliceStation',
    'emergencyContactName','emergencyContactRelation','emergencyContactPhone',
    'fullName','mobile','departmentId','managerId','priorExperienceMonths'];
  v_e    public.employees%rowtype;
  v_mgr  uuid;
  v_dept uuid;
  t      text := '';
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

  -- A name can be corrected, never removed: everything that lists people
  -- needs one.
  if _values ? 'fullName' and nullif(btrim(coalesce(_values ->> 'fullName', '')), '') is null then
    raise exception 'NAME_REQUIRED' using errcode = 'P0001';
  end if;

  if _values ? 'departmentId' then
    v_dept := (_values ->> 'departmentId')::uuid;
    if v_dept is not null and not exists (
         select 1 from public.departments
          where id = v_dept and organization_id = v_e.organization_id and deleted_at is null) then
      raise exception 'DEPARTMENT_NOT_FOUND' using errcode = 'P0002';
    end if;
  end if;

  -- The same rules as admin_set_reporting_line (D57, the cycle walk), for a
  -- record that may not have a profile yet.
  if _values ? 'managerId' then
    v_mgr := (_values ->> 'managerId')::uuid;
    if v_mgr is not null then
      if v_mgr = v_e.profile_id then
        raise exception 'SELF_MANAGED' using errcode = 'P0001';
      end if;
      if not exists (select 1 from public.profiles
                      where id = v_mgr and organization_id = v_e.organization_id
                        and deleted_at is null and is_active) then
        raise exception 'MANAGER_NOT_FOUND' using errcode = 'P0002';
      end if;
      if not public.can_approve(v_mgr) then
        raise exception 'MANAGER_CANNOT_APPROVE' using errcode = 'P0001';
      end if;
      if v_e.profile_id is not null and exists (
        with recursive up as (
          select p.id, p.manager_id, 1 as depth
            from public.profiles p
           where p.id = v_mgr and p.deleted_at is null
          union all
          select p.id, p.manager_id, up.depth + 1
            from public.profiles p
            join up on p.id = up.manager_id
           where p.deleted_at is null and up.depth < 64
        )
        select 1 from up where id = v_e.profile_id
      ) then
        raise exception 'REPORTING_CYCLE' using errcode = 'P0001';
      end if;
    end if;
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
      emergency_contact_phone = case when _values ? 'emergencyContactPhone' then nullif(btrim(_values ->> 'emergencyContactPhone'), '') else emergency_contact_phone end,
      prior_experience_months = case when _values ? 'priorExperienceMonths' then (_values ->> 'priorExperienceMonths')::smallint else prior_experience_months end
    where id = _employee_id;

    if _values ?| array['fullName', 'mobile', 'departmentId', 'managerId'] then
      if v_e.profile_id is not null then
        update public.profiles set
          full_name     = case when _values ? 'fullName' then btrim(_values ->> 'fullName') else full_name end,
          phone         = case when _values ? 'mobile' then nullif(btrim(_values ->> 'mobile'), '') else phone end,
          department_id = case when _values ? 'departmentId' then v_dept else department_id end,
          manager_id    = case when _values ? 'managerId' then v_mgr else manager_id end
         where id = v_e.profile_id;
      elsif v_e.invitation_id is not null then
        -- The invitation names the manager by email: it is what the person's
        -- profile is matched against when they accept.
        update public.invitations set
          full_name     = case when _values ? 'fullName' then btrim(_values ->> 'fullName') else full_name end,
          phone         = case when _values ? 'mobile' then nullif(btrim(_values ->> 'mobile'), '') else phone end,
          department_id = case when _values ? 'departmentId' then v_dept else department_id end,
          manager_email = case when _values ? 'managerId'
                               then (select p.email from public.profiles p where p.id = v_mgr)
                               else manager_email end
         where id = v_e.invitation_id;
      else
        update public.employees set
          draft_full_name     = case when _values ? 'fullName' then btrim(_values ->> 'fullName') else draft_full_name end,
          draft_phone         = case when _values ? 'mobile' then nullif(btrim(_values ->> 'mobile'), '') else draft_phone end,
          draft_department_id = case when _values ? 'departmentId' then v_dept else draft_department_id end,
          draft_manager_id    = case when _values ? 'managerId' then v_mgr else draft_manager_id end
         where id = _employee_id;
      end if;
    end if;
  exception
    when check_violation then
      get stacked diagnostics t = constraint_name;
      raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = t;
    when unique_violation then
      raise exception 'MOBILE_TAKEN' using errcode = 'P0001';
    when invalid_text_representation or invalid_datetime_format or numeric_value_out_of_range
         or datetime_field_overflow then
      raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = sqlerrm;
  end;
end;
$function$;

-- The card sends it to whoever sees the identity block (self and admin).
do $$
declare
  v_def text := pg_get_functiondef('public.employee_card(uuid)'::regprocedure);
  v_old text := $q$'educationQualification', v_e.education_qualification,$q$;
  v_new text := $q$'educationQualification', v_e.education_qualification,
      'priorExperienceMonths', v_e.prior_experience_months,$q$;
begin
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'employee_card no longer sends educationQualification once as expected; restate it here instead';
  end if;
  execute replace(v_def, v_old, v_new);
end $$;
