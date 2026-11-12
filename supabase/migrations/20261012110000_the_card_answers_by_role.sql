-- ============================================================================
-- NEUVTO WOS — the Employee Card answers by role (E5, NEUVTO_EMPLOYEE_MASTER §5)
-- ============================================================================
--
-- Three readers, and they are the ONLY way into the employee tables, which
-- have RLS on and no policy (20261012100000):
--
--   employee_card(id)      one person's record, shaped by who is asking
--   employee_directory(q)  everybody, with the fields everybody may see
--   employee_org_chart()   who reports to whom
--
-- The shaping is the point. The design's field-by-role table (§5) is written
-- here as code: each block of the card is added to the JSON only when the
-- caller's relationship to the person allows it. A block that is not allowed
-- is not nulled, masked or flagged; it is not in the response. A browser that
-- never received a field cannot leak it, cache it or show it by mistake.
--
-- The relationships, additive (somebody can be an approver AND payroll):
--
--   self       it is your own record
--   admin      super_admin, org_admin, hr_admin
--   payroll    payroll_officer
--   statutory  statutory_officer
--   approver   the person reports to you
--   colleague  everybody else in your organisation
--
-- Statutory numbers, bank details and the restricted block are NOT here. They
-- are encrypted and revealed by a separate, audited call (E6, D80).
-- ============================================================================

-- ═══════════════════════════════════════════ who the caller is to a person

create or replace function public.employee_relationship(_employee_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_org  uuid := public.current_org_id();
  v_emp  public.employees%rowtype;
  v_out  text[] := array['colleague'];
begin
  select * into v_emp from public.employees
   where id = _employee_id and organization_id = v_org and deleted_at is null;
  if not found then
    return null;
  end if;
  if v_emp.profile_id = v_uid then v_out := v_out || 'self'::text; end if;
  if public.is_admin() then v_out := v_out || 'admin'::text; end if;
  if public.has_role(v_uid, 'payroll_officer') then v_out := v_out || 'payroll'::text; end if;
  if public.has_role(v_uid, 'statutory_officer') then v_out := v_out || 'statutory'::text; end if;
  if v_emp.profile_id is not null and exists (
    select 1 from public.profiles where id = v_emp.profile_id and manager_id = v_uid
  ) then v_out := v_out || 'approver'::text; end if;
  return v_out;
end $$;

revoke all on function public.employee_relationship(uuid) from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════ derived values

/** Whole years between a date of birth and the organisation's today. Never stored. */
create or replace function public.employee_age(_dob date, _org uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case when _dob is null then null
              else date_part('year', age(public.org_today(_org), _dob))::integer end
$$;

/**
 * Previous organisations plus service here, in months. Service here counts from
 * the re-joining date when there is one, because the earlier stint is already
 * a previous-organisation row if it counts at all; the original joining date
 * stays on the record for continuity.
 */
create or replace function public.employee_experience_months(_employee_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select (
    coalesce((select sum((date_part('year', age(po.to_date, po.from_date)) * 12
                          + date_part('month', age(po.to_date, po.from_date)))::integer)
                from public.previous_organisations po
               where po.employee_id = e.id), 0)
    + coalesce((select (date_part('year', age(public.org_today(e.organization_id),
                         coalesce(e.re_joining_date, p.joined_date))) * 12
                        + date_part('month', age(public.org_today(e.organization_id),
                         coalesce(e.re_joining_date, p.joined_date))))::integer
                  from public.profiles p where p.id = e.profile_id), 0)
  )::integer
    from public.employees e
   where e.id = _employee_id
$$;

revoke all on function public.employee_age(date, uuid) from public, anon, authenticated;
revoke all on function public.employee_experience_months(uuid) from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════ the card

create or replace function public.employee_card(_employee_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_org   uuid := public.current_org_id();
  v_id    uuid := _employee_id;
  v_rel   text[];
  v_e     public.employees%rowtype;
  v_p     public.profiles%rowtype;
  v_inv   public.invitations%rowtype;
  v_card  jsonb;
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

  -- ── everybody in the organisation: who they are and where they work
  v_card := jsonb_build_object(
    'id',            v_e.id,
    'employeeCode',  v_e.employee_code,
    'fullName',      coalesce(v_p.full_name, v_inv.full_name),
    'workEmail',     coalesce(v_p.email, v_inv.email),
    'mobile',        coalesce(v_p.phone, v_inv.phone),
    'alternateMobile', v_e.alternate_mobile,
    'status',        v_e.status,
    'isActive',      coalesce(v_p.is_active, false),
    'hasSignedIn',   v_p.id is not null,
    'dateOfJoining', coalesce(v_p.joined_date, v_inv.joined_date),
    'designation',   (select jsonb_build_object('id', d.id, 'name', d.name, 'grade', d.grade)
                        from public.designations d where d.id = v_e.designation_id),
    'department',    (select jsonb_build_object('id', d.id, 'name', d.name)
                        from public.departments d where d.id = v_p.department_id),
    'reportsTo',     (select jsonb_build_object('id', me.id, 'fullName', m.full_name)
                        from public.profiles m
                        left join public.employees me on me.profile_id = m.id
                       where m.id = v_p.manager_id),
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
  v_card := v_card || jsonb_build_object('capabilities', jsonb_build_object(
    'canEdit', admin_,
    'canRequestChange', self_ and not admin_,
    'canSeeHistory', self_ or admin_ or pay_ or stat_,
    'canRevealStatutory', stat_
  ));

  return v_card;
end $$;

comment on function public.employee_card is
  'E5 — one person''s record, shaped by the caller''s relationship to them (NEUVTO_EMPLOYEE_MASTER §5). Blocks a role may not see are absent from the JSON, not nulled. NOT_FOUND for absent and for other organisations alike.';

revoke all on function public.employee_card(uuid) from public, anon;
grant execute on function public.employee_card(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════ the directory

create or replace function public.employee_directory(_q text default null)
returns table (
  id uuid, employee_code text, full_name text, work_email text, mobile text,
  designation text, department text, reports_to text, deployed_unit text,
  date_of_joining date, status text, is_active boolean, has_signed_in boolean,
  admin_role text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  v_q   text := nullif(lower(btrim(coalesce(_q, ''))), '');
begin
  if (select auth.uid()) is null or v_org is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;
  if not public.module_enabled_for(v_org, 'employee') then
    raise exception 'MODULE_NOT_ENABLED' using errcode = 'P0001';
  end if;

  return query
  select e.id, e.employee_code,
         coalesce(p.full_name, i.full_name),
         coalesce(p.email, i.email),
         coalesce(p.phone, i.phone),
         dsg.name, dep.name, mgr.full_name, u.name,
         coalesce(p.joined_date, i.joined_date),
         e.status,
         coalesce(p.is_active, false),
         p.id is not null,
         (select case when bool_or(ur.role = 'super_admin') then 'Super Admin'
                      when bool_or(ur.role in ('org_admin', 'hr_admin')) then 'Admin' end
            from public.user_roles ur
           where ur.user_id = p.id and ur.organization_id = v_org and ur.deleted_at is null)
    from public.employees e
    left join public.profiles p on p.id = e.profile_id
    left join public.invitations i on i.id = e.invitation_id
    left join public.designations dsg on dsg.id = e.designation_id
    left join public.departments dep on dep.id = p.department_id
    left join public.profiles mgr on mgr.id = p.manager_id
    left join lateral (
      select du.name from public.employee_deployments d
        join public.deployment_units du on du.id = d.deployment_unit_id
       where d.employee_id = e.id and d.effective_to is null
         and d.effective_from <= public.org_today(v_org)
       order by d.effective_from desc limit 1
    ) u on true
   where e.organization_id = v_org
     and e.deleted_at is null
     and (v_q is null
          or lower(coalesce(p.full_name, i.full_name, '')) like '%' || v_q || '%'
          or lower(coalesce(e.employee_code, '')) like '%' || v_q || '%'
          or lower(coalesce(dsg.name, '')) like '%' || v_q || '%'
          or lower(coalesce(dep.name, '')) like '%' || v_q || '%'
          or lower(coalesce(p.email, i.email, '')) like '%' || v_q || '%')
   order by coalesce(p.is_active, false) desc, lower(coalesce(p.full_name, i.full_name, ''));
end $$;

comment on function public.employee_directory is
  'E5 — everybody in the organisation with the fields everybody may see (§5): no personal, family, address, statutory or bank data, for any caller.';

revoke all on function public.employee_directory(text) from public, anon;
grant execute on function public.employee_directory(text) to authenticated;

-- ═══════════════════════════════════════════════════════════ the org chart

create or replace function public.employee_org_chart()
returns table (id uuid, profile_id uuid, manager_profile_id uuid, full_name text,
               designation text, direct_reports integer)
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
  return query
  select e.id, p.id, p.manager_id, p.full_name, dsg.name,
         (select count(*)::integer from public.profiles r
           where r.manager_id = p.id and r.deleted_at is null and r.is_active)
    from public.employees e
    join public.profiles p on p.id = e.profile_id
    left join public.designations dsg on dsg.id = e.designation_id
   where e.organization_id = v_org and e.deleted_at is null
     and p.deleted_at is null and p.is_active;
end $$;

revoke all on function public.employee_org_chart() from public, anon;
grant execute on function public.employee_org_chart() to authenticated;
