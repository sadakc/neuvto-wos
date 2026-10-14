-- D103 · Every field is checked, and an Admin can complete a record before the
-- person has accepted.
--
-- Sada, 13 Oct 2026, testing PR 95: an 11-digit alternate mobile was saved with
-- no message, a person added by invitation could not have their name or mobile
-- corrected, and a department or a manager that was not yet on the list meant
-- leaving the form.
--
-- 1. Field rules, in the database. A trigger per table checks the fields an
--    INSERT sets or an UPDATE changes. Only what changed: a row that already
--    holds a bad value (Deepak's 11-digit mobile) must not block an unrelated
--    edit, or the refusal names a field the person did not touch. The import,
--    the card and any future caller all pass through them.
-- 2. employee_update also writes the full name, mobile, department and reports
--    to, wherever they live: the profile once somebody has signed in, the
--    invitation until then, the draft before that.
-- 3. employee_add_department, so an Employee Admin can add a department from
--    the field that needs it. It is the company's one list (public.departments),
--    the same rows Organisation and the leave reports read.
-- 4. employee_manager_candidates and employee_make_manager, so "Reports to" can
--    name somebody who cannot approve yet by making them a Manager first (D57:
--    only somebody who can approve has reports).

-- ════════════════════════════════════════════════════════════ 1 · field rules

-- A phone number: a 10-digit Indian mobile, the same after +91, or any other
-- country code with 8 to 15 digits. Spaces, dashes and brackets are allowed
-- between digits; letters and other symbols are not.
create or replace function public.valid_phone(_p text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select _p is null
      or regexp_replace(btrim(_p), '[[:space:]()-]', '', 'g')
         ~ '^(\+91[6-9][0-9]{9}|\+(9[02-9]|[1-8])[0-9]{7,13}|[6-9][0-9]{9})$'
$$;

-- Words only: a name, a relation, a place. Letters in any script, spaces and
-- . ' - ; no digits and no other symbols. A blacklist rather than a list of
-- letters, because a vowel sign in Devanagari or Tamil is not a "letter" to a
-- regex character class, and a rule that refuses Indian names is worse than
-- no rule.
create or replace function public.valid_words(_t text, _max integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select _t is null
      or (char_length(btrim(_t)) between 1 and _max
          and btrim(_t) !~ '[0-9!"#$%&()*+,/:;<=>?@^_`{|}~\[\]\\]'
          and btrim(_t) ~ '[^[:space:].''-]')
$$;

-- Free text with a length: a qualification, a reason, a police station.
create or replace function public.valid_text(_t text, _max integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select _t is null or char_length(btrim(_t)) between 1 and _max
$$;

-- An employee code: letters and digits, with / . _ - between them.
create or replace function public.valid_code(_t text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select _t is null or btrim(_t) ~ '^[A-Za-z0-9][A-Za-z0-9/._-]{0,29}$'
$$;

-- Raises as a CHECK constraint would, naming the rule, so every caller that
-- already maps a check_violation to INVALID_VALUE carries the name through.
create or replace function public.field_check(_ok boolean, _rule text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if _ok is not true then
    raise exception 'INVALID_VALUE'
      using errcode = '23514', constraint = _rule, detail = _rule;
  end if;
end;
$$;

-- Left executable: a trigger runs as whoever wrote the row, and a person
-- updating their own profile must reach it. It can only refuse.

create or replace function public.tf_employee_fields_are_valid()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  ins boolean := tg_op = 'INSERT';
begin
  if ins or new.alternate_mobile is distinct from old.alternate_mobile then
    perform public.field_check(public.valid_phone(new.alternate_mobile), 'alternate_mobile_format');
  end if;
  if ins or new.emergency_contact_phone is distinct from old.emergency_contact_phone then
    perform public.field_check(public.valid_phone(new.emergency_contact_phone), 'emergency_contact_phone_format');
  end if;
  if ins or new.draft_phone is distinct from old.draft_phone then
    perform public.field_check(public.valid_phone(new.draft_phone), 'mobile_format');
  end if;
  if ins or new.draft_full_name is distinct from old.draft_full_name then
    perform public.field_check(public.valid_words(new.draft_full_name, 100), 'full_name_format');
  end if;
  if ins or new.name_as_per_id is distinct from old.name_as_per_id then
    perform public.field_check(public.valid_words(new.name_as_per_id, 100), 'name_as_per_id_format');
  end if;
  if ins or new.emergency_contact_name is distinct from old.emergency_contact_name then
    perform public.field_check(public.valid_words(new.emergency_contact_name, 100), 'emergency_contact_name_format');
  end if;
  if ins or new.emergency_contact_relation is distinct from old.emergency_contact_relation then
    perform public.field_check(public.valid_words(new.emergency_contact_relation, 60), 'emergency_contact_relation_format');
  end if;
  if ins or new.nationality is distinct from old.nationality then
    perform public.field_check(public.valid_words(new.nationality, 60), 'nationality_format');
  end if;
  if ins or new.native_state is distinct from old.native_state then
    perform public.field_check(public.valid_words(new.native_state, 60), 'native_state_format');
  end if;
  if ins or new.employee_code is distinct from old.employee_code then
    perform public.field_check(public.valid_code(new.employee_code), 'employee_code_format');
  end if;
  if ins or new.education_qualification is distinct from old.education_qualification then
    perform public.field_check(public.valid_text(new.education_qualification, 200), 'education_qualification_length');
  end if;
  if ins or new.nearest_police_station is distinct from old.nearest_police_station then
    perform public.field_check(public.valid_text(new.nearest_police_station, 100), 'nearest_police_station_length');
  end if;
  if ins or new.termination_reason is distinct from old.termination_reason then
    perform public.field_check(public.valid_text(new.termination_reason, 500), 'termination_reason_length');
  end if;
  if ins or new.reason_for_leaving_last_org is distinct from old.reason_for_leaving_last_org then
    perform public.field_check(public.valid_text(new.reason_for_leaving_last_org, 500), 'reason_for_leaving_length');
  end if;
  -- Fourteen: nobody younger may be employed at all (Child and Adolescent
  -- Labour Act, 1986). A stricter age for a particular job is the company's.
  if ins or new.date_of_birth is distinct from old.date_of_birth then
    perform public.field_check(
      new.date_of_birth is null or new.date_of_birth <= current_date - interval '14 years',
      'date_of_birth_age');
  end if;
  if ins or new.confirmed_on is distinct from old.confirmed_on
         or new.date_of_birth is distinct from old.date_of_birth then
    perform public.field_check(
      new.confirmed_on is null or new.date_of_birth is null or new.confirmed_on > new.date_of_birth,
      'confirmed_on_after_birth');
  end if;
  return new;
end;
$$;

create trigger employee_fields_are_valid
  before insert or update on public.employees
  for each row execute function public.tf_employee_fields_are_valid();

create or replace function public.tf_person_fields_are_valid()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  ins boolean := tg_op = 'INSERT';
begin
  if ins or new.full_name is distinct from old.full_name then
    perform public.field_check(public.valid_words(new.full_name, 100), 'full_name_format');
  end if;
  if ins or new.phone is distinct from old.phone then
    perform public.field_check(public.valid_phone(new.phone), 'mobile_format');
  end if;
  return new;
end;
$$;

create trigger person_fields_are_valid
  before insert or update on public.profiles
  for each row execute function public.tf_person_fields_are_valid();
create trigger person_fields_are_valid
  before insert or update on public.invitations
  for each row execute function public.tf_person_fields_are_valid();

create or replace function public.tf_relative_fields_are_valid()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  ins boolean := tg_op = 'INSERT';
begin
  if ins or new.name is distinct from old.name then
    perform public.field_check(public.valid_words(new.name, 100), 'relative_name_format');
  end if;
  if ins or new.date_of_birth is distinct from old.date_of_birth then
    perform public.field_check(
      new.date_of_birth is null or new.date_of_birth <= current_date, 'relative_date_of_birth_future');
  end if;
  return new;
end;
$$;

create trigger relative_fields_are_valid
  before insert or update on public.family_members
  for each row execute function public.tf_relative_fields_are_valid();
create trigger relative_fields_are_valid
  before insert or update on public.nominees
  for each row execute function public.tf_relative_fields_are_valid();

create or replace function public.tf_previous_org_fields_are_valid()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  ins boolean := tg_op = 'INSERT';
begin
  if ins or new.organisation_name is distinct from old.organisation_name then
    perform public.field_check(public.valid_text(new.organisation_name, 200), 'organisation_name_length');
  end if;
  if ins or new.designation is distinct from old.designation then
    perform public.field_check(public.valid_text(new.designation, 100), 'previous_designation_length');
  end if;
  if ins or new.reason_for_leaving is distinct from old.reason_for_leaving then
    perform public.field_check(public.valid_text(new.reason_for_leaving, 500), 'reason_for_leaving_length');
  end if;
  if ins or new.from_date is distinct from old.from_date or new.to_date is distinct from old.to_date then
    perform public.field_check(
      (new.from_date is null or new.from_date <= current_date)
        and (new.to_date is null or new.to_date <= current_date),
      'previous_org_dates_future');
    perform public.field_check(
      new.from_date is null or new.to_date is null or new.to_date >= new.from_date,
      'previous_org_dates_order');
  end if;
  return new;
end;
$$;

create trigger previous_org_fields_are_valid
  before insert or update on public.previous_organisations
  for each row execute function public.tf_previous_org_fields_are_valid();

-- Address rows are history: only effective_to ever changes after the insert,
-- and it is not a field checked here, so closing a row is never refused.
create or replace function public.tf_address_fields_are_valid()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  ins boolean := tg_op = 'INSERT';
begin
  if ins or new.line is distinct from old.line then
    perform public.field_check(public.valid_text(new.line, 300), 'address_line_length');
  end if;
  if ins or new.city is distinct from old.city then
    perform public.field_check(public.valid_words(new.city, 60), 'city_format');
  end if;
  if ins or new.district is distinct from old.district then
    perform public.field_check(public.valid_words(new.district, 60), 'district_format');
  end if;
  if ins or new.state is distinct from old.state then
    perform public.field_check(public.valid_words(new.state, 60), 'state_format');
  end if;
  if ins or new.nearest_police_station is distinct from old.nearest_police_station then
    perform public.field_check(public.valid_text(new.nearest_police_station, 100), 'nearest_police_station_length');
  end if;
  return new;
end;
$$;

create trigger address_fields_are_valid
  before insert or update on public.employee_addresses
  for each row execute function public.tf_address_fields_are_valid();

create or replace function public.tf_bank_fields_are_valid()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  ins boolean := tg_op = 'INSERT';
begin
  if ins or new.account_holder is distinct from old.account_holder then
    perform public.field_check(public.valid_words(new.account_holder, 100), 'account_holder_format');
  end if;
  if ins or new.bank_name is distinct from old.bank_name then
    perform public.field_check(public.valid_text(new.bank_name, 100), 'bank_name_length');
  end if;
  if ins or new.branch is distinct from old.branch then
    perform public.field_check(public.valid_text(new.branch, 100), 'branch_length');
  end if;
  return new;
end;
$$;

create trigger bank_fields_are_valid
  before insert or update on public.employee_bank
  for each row execute function public.tf_bank_fields_are_valid();

revoke execute on function public.tf_employee_fields_are_valid() from public, anon, authenticated;
revoke execute on function public.tf_person_fields_are_valid() from public, anon, authenticated;
revoke execute on function public.tf_relative_fields_are_valid() from public, anon, authenticated;
revoke execute on function public.tf_previous_org_fields_are_valid() from public, anon, authenticated;
revoke execute on function public.tf_address_fields_are_valid() from public, anon, authenticated;
revoke execute on function public.tf_bank_fields_are_valid() from public, anon, authenticated;

-- ════════════════════════════════════════════ 2 · the whole record, before acceptance

-- The record's own fields as before, plus the four that live with the person
-- rather than the record. Where they live depends on how far the person has
-- got: a profile once they have signed in, the invitation until then, the
-- draft before an invitation exists.
create or replace function public.employee_update(_employee_id uuid, _values jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_known text[] := array[
    'employeeCode','nameAsPerId','sex','dateOfBirth','maritalStatus','nationality','nativeState',
    'bloodGroup','educationQualification','alternateMobile','personalEmail','designationId',
    'employmentType','reJoiningDate','confirmedOn','status','terminationDate','terminationReason',
    'reasonForLeavingLastOrg','heightCm','chestCm','weightKg','nearestPoliceStation',
    'emergencyContactName','emergencyContactRelation','emergencyContactPhone',
    'fullName','mobile','departmentId','managerId'];
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
      emergency_contact_phone = case when _values ? 'emergencyContactPhone' then nullif(btrim(_values ->> 'emergencyContactPhone'), '') else emergency_contact_phone end
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
$$;

-- ══════════════════════════════════════════════════ 3 · a department, from the field

-- Returns the department's id. One that already exists under the same name
-- (any case) is returned rather than refused: the person typing it wants that
-- department, and a second "Operations" is the mistake to prevent.
create or replace function public.employee_add_department(_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org  uuid := public.employee_require_config_admin();
  v_name text := btrim(coalesce(_name, ''));
  v_id   uuid;
begin
  if v_name = '' then
    raise exception 'NAME_REQUIRED' using errcode = 'P0001';
  end if;
  perform public.field_check(public.valid_text(v_name, 100), 'department_name_length');
  select id into v_id from public.departments
   where organization_id = v_org and lower(name) = lower(v_name) and deleted_at is null;
  if v_id is null then
    insert into public.departments (organization_id, name) values (v_org, v_name)
    returning id into v_id;
  end if;
  return v_id;
exception
  when check_violation then
    raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'department_name_length';
end;
$$;

revoke all on function public.employee_add_department(text) from public, anon;
grant execute on function public.employee_add_department(text) to authenticated;

-- ══════════════════════════════════════════════════ 4 · somebody to report to

-- People who have signed in, are active, and cannot approve yet: the ones
-- "Reports to" does not list, and who could be made a Manager.
create or replace function public.employee_manager_candidates()
returns table (profile_id uuid, full_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.employee_require_config_admin();
begin
  return query
    select p.id, coalesce(p.full_name, p.email)::text
      from public.profiles p
     where p.organization_id = v_org and p.deleted_at is null and p.is_active
       and not public.can_approve(p.id)
     order by lower(coalesce(p.full_name, p.email));
end;
$$;

revoke all on function public.employee_manager_candidates() from public, anon;
grant execute on function public.employee_manager_candidates() to authenticated;

-- Adds Manager to the roles they hold, through member_set_roles, so every rule
-- about who may grant what (D78) is the one that already applies.
create or replace function public.employee_make_manager(_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.current_org_id();
begin
  perform public.member_set_roles(
    _profile_id,
    array(select r.role from public.user_roles r
           where r.user_id = _profile_id and r.organization_id = v_org and r.deleted_at is null)
      || 'manager'::public.app_role);
end;
$$;

revoke all on function public.employee_make_manager(uuid) from public, anon;
grant execute on function public.employee_make_manager(uuid) to authenticated;

-- ═══════════════════════════════════════════ 5 · the card names the manager's profile

-- "Reports to" is chosen by profile, so the card says which profile the
-- current manager is; it carried only their employee record and name. One
-- expression changes, patched rather than restating the whole function, and
-- refused loudly if the expression is not there to patch.
do $$
declare
  v_def text := pg_get_functiondef('public.employee_card(uuid)'::regprocedure);
  v_old text := $q$jsonb_build_object('id', me.id, 'fullName', m.full_name)$q$;
  v_new text := $q$jsonb_build_object('id', me.id, 'fullName', m.full_name, 'profileId', m.id)$q$;
begin
  if position(v_old in v_def) = 0 then
    raise exception 'employee_card no longer builds reportsTo as expected; restate it here instead';
  end if;
  execute replace(v_def, v_old, v_new);
end $$;
