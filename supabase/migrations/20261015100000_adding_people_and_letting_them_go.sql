-- ============================================================================
-- NEUVTO WOS — adding people, and letting them go (E8, NEUVTO_EMPLOYEE_MASTER §6)
-- ============================================================================
--
--   employee_create_draft(values)        an Admin starts a record before anybody
--                                        is invited (D82: the record exists from
--                                        the moment an admin starts it)
--   employee_update_draft(id, values)    who they are, until the invitation exists
--   employee_send_invite(id, role)       invites them; an incomplete record can
--                                        be invited (bundle §7.6)
--   employee_deactivate(id, successor, last day, reason)
--                                        the platform's deactivation, plus what
--                                        the record owes it: the open posting
--                                        closed, status Left, the last day kept
--   employee_admin_overview()            the Add Employee page's tiles and list
--
-- WHERE A DRAFT'S NAME LIVES. D82 keeps name, email, phone, joining date,
-- manager and department on `profiles`, and on the invitation before that, and
-- never copies them to `employees`. A draft has neither yet, so it holds them
-- in `draft_*` columns that exist only until the invitation is sent, which
-- moves them onto the invitation and clears them. One home per fact, at every
-- stage.
--
-- EVERY DEACTIVATION CLOSES THE POSTING. employee_deactivate closes it on the
-- last working day the Admin gives. The People screen's deactivation is the
-- platform's and knows nothing of postings (D30), so a trigger on profiles
-- closes any posting still open when somebody becomes inactive, by any path.
-- ============================================================================

alter table public.employees
  add column draft_full_name     text,
  add column draft_email         text check (draft_email is null or draft_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  add column draft_phone         text,
  add column draft_joined_date   date,
  add column draft_department_id uuid references public.departments(id) on delete set null,
  add column draft_manager_id    uuid references public.profiles(id) on delete set null,
  -- A draft is somebody who is neither invited nor arrived.
  add constraint employees_draft_fields_only_on_a_draft check (
    (profile_id is null and invitation_id is null)
    or (draft_full_name is null and draft_email is null and draft_phone is null
        and draft_joined_date is null and draft_department_id is null and draft_manager_id is null));

create unique index uq_employees_draft_email
  on public.employees (organization_id, lower(draft_email))
  where draft_email is not null and deleted_at is null;

comment on column public.employees.draft_full_name is
  'E8 — a draft''s name, held only until the invitation exists (then on the invitation, then on the profile). See the migration header.';

-- ═══════════════════════════════════════════════════════════ drafts

/** Refuses an email somebody in this company already has, at any stage. */
create or replace function public.employee_email_is_free(_org uuid, _email text, _except uuid default null)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.profiles where organization_id = _org and lower(email) = _email and deleted_at is null) then
    raise exception 'ALREADY_A_MEMBER' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.invitations where organization_id = _org and lower(email) = _email
              and deleted_at is null and revoked_at is null and accepted_at is null) then
    raise exception 'ALREADY_INVITED' using errcode = 'P0001';
  end if;
  -- Another draft with this email is refused by uq_employees_draft_email,
  -- which employee_apply_draft maps to ALREADY_A_DRAFT. One rule, one place.
end $$;

revoke all on function public.employee_email_is_free(uuid, text, uuid) from public, anon, authenticated;

create or replace function public.employee_apply_draft(_employee_id uuid, _values jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org   uuid := public.current_org_id();
  v_email text;
  v_mgr   uuid;
  v_dep   uuid;
begin
  perform public.restricted_known_keys(_values,
    array['fullName','email','phone','joinedDate','departmentId','managerId']);
  if _values ? 'email' then
    v_email := nullif(lower(btrim(_values ->> 'email')), '');
    if v_email is not null then
      if v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
        raise exception 'INVALID_EMAIL' using errcode = 'P0001';
      end if;
      perform public.employee_email_is_free(v_org, v_email, _employee_id);
    end if;
  end if;
  if _values ? 'managerId' and _values ->> 'managerId' is not null then
    v_mgr := (_values ->> 'managerId')::uuid;
    if not exists (select 1 from public.profiles where id = v_mgr and organization_id = v_org
                    and is_active and deleted_at is null) then
      raise exception 'MANAGER_NOT_FOUND' using errcode = 'P0001';
    end if;
    if not public.can_approve(v_mgr) then
      raise exception 'MANAGER_CANNOT_APPROVE' using errcode = 'P0001';
    end if;
  end if;
  if _values ? 'departmentId' and _values ->> 'departmentId' is not null then
    v_dep := (_values ->> 'departmentId')::uuid;
    if not exists (select 1 from public.departments where id = v_dep and organization_id = v_org
                    and deleted_at is null) then
      raise exception 'DEPARTMENT_NOT_FOUND' using errcode = 'P0001';
    end if;
  end if;

  update public.employees set
    draft_full_name     = case when _values ? 'fullName' then nullif(btrim(_values ->> 'fullName'), '') else draft_full_name end,
    draft_email         = case when _values ? 'email' then v_email else draft_email end,
    draft_phone         = case when _values ? 'phone' then nullif(btrim(_values ->> 'phone'), '') else draft_phone end,
    draft_joined_date   = case when _values ? 'joinedDate' then (_values ->> 'joinedDate')::date else draft_joined_date end,
    draft_department_id = case when _values ? 'departmentId' then v_dep else draft_department_id end,
    draft_manager_id    = case when _values ? 'managerId' then v_mgr else draft_manager_id end
   where id = _employee_id;
exception
  when unique_violation then
    raise exception 'ALREADY_A_DRAFT' using errcode = 'P0001';
  when invalid_text_representation or invalid_datetime_format then
    raise exception 'INVALID_VALUE' using errcode = 'P0001';
end $$;

revoke all on function public.employee_apply_draft(uuid, jsonb) from public, anon, authenticated;

create or replace function public.employee_create_draft(_values jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  v_id  uuid;
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
  if length(btrim(coalesce(_values ->> 'fullName', ''))) = 0 then
    raise exception 'NAME_REQUIRED' using errcode = 'P0001';
  end if;
  insert into public.employees (organization_id) values (v_org) returning id into v_id;
  perform public.employee_apply_draft(v_id, _values);
  return v_id;
end $$;

comment on function public.employee_create_draft is
  'E8 — an Admin starts a record before anybody is invited. Needs only a name; everything else can be added before or after the invitation.';

revoke all on function public.employee_create_draft(jsonb) from public, anon;
grant execute on function public.employee_create_draft(jsonb) to authenticated;

create or replace function public.employee_update_draft(_employee_id uuid, _values jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  perform public.employee_require_admin(_employee_id);
  if exists (select 1 from public.employees where id = _employee_id
              and (profile_id is not null or invitation_id is not null)) then
    raise exception 'NO_LONGER_A_DRAFT' using errcode = 'P0001',
      hint = 'Once invited, their name and email live on the invitation; change them from People.';
  end if;
  if _values ? 'fullName' and length(btrim(coalesce(_values ->> 'fullName', ''))) = 0 then
    raise exception 'NAME_REQUIRED' using errcode = 'P0001';
  end if;
  perform public.employee_apply_draft(_employee_id, _values);
end $$;

revoke all on function public.employee_update_draft(uuid, jsonb) from public, anon;
grant execute on function public.employee_update_draft(uuid, jsonb) to authenticated;

/**
 * Sends the invitation for a draft, through invitation_create so every rule it
 * enforces (D78's role rule, duplicates, phone) applies unchanged, then moves
 * the draft's details onto the invitation and clears them here.
 */
create or replace function public.employee_send_invite(_employee_id uuid, _role public.app_role default 'employee')
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_e   public.employees%rowtype;
  v_inv uuid;
begin
  perform public.employee_require_admin(_employee_id);
  select * into v_e from public.employees where id = _employee_id;
  if v_e.profile_id is not null or v_e.invitation_id is not null then
    raise exception 'NO_LONGER_A_DRAFT' using errcode = 'P0001';
  end if;
  if v_e.draft_email is null then
    raise exception 'EMAIL_REQUIRED' using errcode = 'P0001',
      hint = 'An invitation is sent to an email address. Add one to the record first.';
  end if;

  -- Free the draft's email first, or invitation_create's own duplicate check
  -- would not see it and the unique index on drafts would refuse nothing.
  update public.employees set draft_email = null where id = _employee_id;

  v_inv := public.invitation_create(
    v_e.draft_email, v_e.draft_phone, _role, v_e.draft_full_name, v_e.draft_joined_date,
    (select email from public.profiles where id = v_e.draft_manager_id), v_e.draft_department_id);

  update public.employees set
    invitation_id = v_inv,
    draft_full_name = null, draft_phone = null, draft_joined_date = null,
    draft_department_id = null, draft_manager_id = null
   where id = _employee_id;
  return v_inv;
end $$;

comment on function public.employee_send_invite is
  'E8 — invites a draft through invitation_create (every rule unchanged), then moves its details onto the invitation. An incomplete record can be invited.';

revoke all on function public.employee_send_invite(uuid, public.app_role) from public, anon;
grant execute on function public.employee_send_invite(uuid, public.app_role) to authenticated;

-- ═══════════════════════════════════════════════════════════ letting go

/** Closes an open posting so it last ran on _last_day. */
create or replace function public.employee_close_posting(_employee_id uuid, _last_day date)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_d   public.employee_deployments%rowtype;
  v_end date;
begin
  select * into v_d from public.employee_deployments
   where employee_id = _employee_id and effective_to is null;
  if not found then return null; end if;
  -- A posting that had not started by the last day is closed one day after
  -- it starts: the table cannot hold a row that ends before it begins, and
  -- rule 2 forbids deleting it.
  v_end := greatest(_last_day + 1, v_d.effective_from + 1);
  update public.employee_deployments set effective_to = v_end where id = v_d.id;
  return jsonb_build_object('unitName', (select name from public.deployment_units where id = v_d.deployment_unit_id),
                            'lastDay', v_end - 1);
end $$;

revoke all on function public.employee_close_posting(uuid, date) from public, anon, authenticated;

create or replace function public.tf_inactive_profile_closes_posting()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.is_active and not new.is_active then
    perform public.employee_close_posting(e.id, public.org_today(new.organization_id))
       from public.employees e where e.profile_id = new.id;
  end if;
  return new;
end $$;

revoke all on function public.tf_inactive_profile_closes_posting() from public, anon, authenticated;

create trigger inactive_profile_closes_posting
  after update of is_active on public.profiles
  for each row execute function public.tf_inactive_profile_closes_posting();

create or replace function public.employee_deactivate(
  _employee_id     uuid,
  _successor_id    uuid,
  _last_working_day date,
  _reason          text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_e       public.employees%rowtype;
  v_posting jsonb;
  v_moved   jsonb;
begin
  perform public.employee_require_admin(_employee_id);
  select * into v_e from public.employees where id = _employee_id;
  if v_e.profile_id is null then
    raise exception 'NOT_SIGNED_IN_YET' using errcode = 'P0001',
      hint = 'Somebody who never arrived is not deactivated; revoke their invitation from People.';
  end if;
  if _last_working_day is null then
    raise exception 'LAST_DAY_REQUIRED' using errcode = 'P0001';
  end if;
  if length(btrim(coalesce(_reason, ''))) < 3 then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;

  -- The posting first, on the Admin's date; the trigger the platform's
  -- deactivation fires then finds nothing open.
  v_posting := public.employee_close_posting(_employee_id, _last_working_day);
  v_moved := public.deactivate_employee(v_e.profile_id, _successor_id);

  update public.employees set
    status = 'left', termination_date = _last_working_day, termination_reason = btrim(_reason)
   where id = _employee_id;

  return v_moved || jsonb_build_object(
    'postingClosed', v_posting,
    'status', 'left',
    'lastWorkingDay', _last_working_day);
end $$;

comment on function public.employee_deactivate is
  'E8 — the platform''s deactivation (sign-in blocked, reports and approvals moved) plus the record: the open posting closed on the last working day, status Left with the date and reason. Returns what it did (criterion 10).';

revoke all on function public.employee_deactivate(uuid, uuid, date, text) from public, anon;
grant execute on function public.employee_deactivate(uuid, uuid, date, text) to authenticated;

-- ═══════════════════════════════════════════════════════════ the overview

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
          'gaps', to_jsonb(array_remove(array[
            case when coalesce(p.email, i.email, e.draft_email) is null then 'email' end,
            case when e.designation_id is null then 'designation' end,
            case when not exists (select 1 from public.employee_deployments d where d.employee_id = e.id and d.effective_to is null) then 'deployment' end,
            case when not exists (select 1 from public.employee_addresses a where a.employee_id = e.id and a.effective_to is null) then 'address' end,
            case when e.emergency_contact_phone is null then 'emergency contact' end,
            case when not exists (select 1 from public.employee_statutory s where s.employee_id = e.id and s.uan_last4 is not null) then 'statutory' end,
            case when not exists (select 1 from public.nomination_versions n where n.employee_id = e.id and n.effective_to is null) then 'nominees' end
          ], null))
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

-- ═══════════════════════════════════════════════════════════ the card, again
--
-- Reproduced from 20261013100000_statutory_and_bank_encrypted.sql. The diff:
-- a draft's or invitee's name, email, phone, joining date, department and
-- manager are read from wherever they live at that stage; `stage`; and three
-- capabilities.

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
  v_st    public.employee_statutory%rowtype;
  v_bk    public.employee_bank%rowtype;
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

  -- E8: a draft is somebody the company has not even invited yet. Only an
  -- Admin knows they exist; to anybody else the id answers like any other
  -- that is not theirs to see.
  if v_p.id is null and v_inv.id is null and not admin_ then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  -- ── everybody in the organisation: who they are and where they work
  v_card := jsonb_build_object(
    'id',            v_e.id,
    'employeeCode',  v_e.employee_code,
    'fullName',      coalesce(v_p.full_name, v_inv.full_name, v_e.draft_full_name),
    'workEmail',     coalesce(v_p.email, v_inv.email, v_e.draft_email),
    'mobile',        coalesce(v_p.phone, v_inv.phone, v_e.draft_phone),
    'alternateMobile', v_e.alternate_mobile,
    'status',        v_e.status,
    'isActive',      coalesce(v_p.is_active, false),
    'hasSignedIn',   v_p.id is not null,
    'stage',         case when v_p.id is not null then (case when v_p.is_active then 'active' else 'deactivated' end)
                          when v_inv.id is not null then 'invited'
                          when v_e.draft_full_name is not null then 'draft' else 'removed' end,
    'dateOfJoining', coalesce(v_p.joined_date, v_inv.joined_date, v_e.draft_joined_date),
    'designation',   (select jsonb_build_object('id', d.id, 'name', d.name, 'grade', d.grade)
                        from public.designations d where d.id = v_e.designation_id),
    'department',    (select jsonb_build_object('id', d.id, 'name', d.name)
                        from public.departments d
                       where d.id = coalesce(v_p.department_id, v_inv.department_id, v_e.draft_department_id)),
    'reportsTo',     (select jsonb_build_object('id', me.id, 'fullName', m.full_name)
                        from public.profiles m
                        left join public.employees me on me.profile_id = m.id
                       where m.id = coalesce(v_p.manager_id, v_e.draft_manager_id,
                                     (select x.id from public.profiles x
                                       where v_p.id is null and lower(x.email) = lower(v_inv.manager_email)
                                         and x.organization_id = v_org limit 1))),
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
  -- ── E6: statutory numbers, verification, bank, restricted (§5, D80).
  --    Last-four for self and Admin; UAN, EPF and ESIC in full for Payroll
  --    and Statutory; Aadhaar, PAN and the account in full only through
  --    employee_reveal_restricted().
  select * into v_st from public.employee_statutory where employee_id = v_e.id;
  if self_ or admin_ or pay_ or stat_ then
    v_card := v_card || jsonb_build_object('statutory', jsonb_build_object(
      'recorded',             v_st.employee_id is not null,
      'identityDocumentType', v_st.identity_document_type,
      'aadhaarLast4',         v_st.aadhaar_last4,
      'panLast4',             v_st.pan_last4,
      'verifiedOn',           v_st.verified_on,
      'uanLast4',             v_st.uan_last4,
      'epfLast4',             v_st.epf_last4,
      'esicLast4',            v_st.esic_last4,
      'oldUanLast4',          v_st.old_uan_last4,
      'oldEsicLast4',         v_st.old_esic_last4
    ) || case when pay_ or stat_ then jsonb_build_object(
      'uan',           public.restricted_decrypt(v_st.uan_cipher),
      'epfNumber',     public.restricted_decrypt(v_st.epf_cipher),
      'esicNumber',    public.restricted_decrypt(v_st.esic_cipher),
      'oldUan',        public.restricted_decrypt(v_st.old_uan_cipher),
      'oldEsicNumber', public.restricted_decrypt(v_st.old_esic_cipher)
    ) else '{}'::jsonb end);
  end if;

  if self_ or admin_ or stat_ then
    v_card := v_card || jsonb_build_object('verification', jsonb_build_object(
      'policeVerification',    coalesce(v_st.police_verification, 'not_started'),
      'policeVerifiedOn',      v_st.police_verified_on,
      'previousEmployerCheck', coalesce(v_st.previous_employer_check, 'not_started'),
      'educationCheck',        coalesce(v_st.education_check, 'not_started'),
      'reverificationDue',     v_st.reverification_due
    ));
  end if;

  -- Bank: the person themselves (last four) and Payroll. Not Admin, not
  -- Statutory (§5: "two rows where Admin sees less than expected").
  if self_ or pay_ then
    select * into v_bk from public.employee_bank where employee_id = v_e.id;
    v_card := v_card || jsonb_build_object('bank', jsonb_build_object(
      'recorded',        v_bk.employee_id is not null,
      'bankName',        v_bk.bank_name,
      'ifsc',            v_bk.ifsc,
      'accountLast4',    v_bk.account_last4,
      'pennyDropStatus', coalesce(v_bk.penny_drop_status, 'not_checked')
    ) || case when pay_ then jsonb_build_object(
      'branch',        v_bk.branch,
      'accountHolder', v_bk.account_holder
    ) else '{}'::jsonb end);
  end if;

  -- Restricted: only whether anything is held. The values come by reveal.
  if self_ or stat_ then
    v_card := v_card || jsonb_build_object('restricted', jsonb_build_object(
      'recorded', exists (select 1 from public.employee_restricted where employee_id = v_e.id)));
  end if;

  v_card := v_card || jsonb_build_object('capabilities', jsonb_build_object(
    'canEdit', admin_,
    'canRequestChange', self_ and not admin_,
    'canSeeHistory', self_ or admin_ or pay_ or stat_,
    'canRevealStatutory', stat_,
    'canRevealBank', pay_,
    'canRevealRestricted', stat_ or self_,
    'canEditStatutory', admin_ or stat_,
    'canEditVerification', admin_,
    'canEditBank', pay_,
    'canEditRestricted', stat_,
    'canSeeReveals', self_ or stat_ or public.is_super_admin(),
    -- E8: the Admin's lifecycle actions, offered only where they can work.
    'canSendInvite', admin_ and v_p.id is null and v_inv.id is null and v_e.draft_full_name is not null,
    'canDeactivate', admin_ and v_p.id is not null and coalesce(v_p.is_active, false) and not self_,
    'canEditDraft',  admin_ and v_p.id is null and v_inv.id is null and v_e.draft_full_name is not null
  ));

  return v_card;
end $$;

comment on function public.employee_card is
  'E5 — one person''s record, shaped by the caller''s relationship to them (NEUVTO_EMPLOYEE_MASTER §5). Blocks a role may not see are absent from the JSON, not nulled. NOT_FOUND for absent and for other organisations alike.';

revoke all on function public.employee_card(uuid) from public, anon;
grant execute on function public.employee_card(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════ the directory, again
--
-- Reproduced from 20261012110000_the_card_answers_by_role.sql with the same
-- fallbacks and a `stage` column. Dropped first: the return type changes.

drop function if exists public.employee_directory(text);

create or replace function public.employee_directory(_q text default null)
returns table (
  id uuid, employee_code text, full_name text, work_email text, mobile text,
  designation text, department text, reports_to text, deployed_unit text,
  date_of_joining date, status text, is_active boolean, has_signed_in boolean,
  admin_role text, stage text
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
         coalesce(p.full_name, i.full_name, e.draft_full_name),
         coalesce(p.email, i.email, e.draft_email),
         coalesce(p.phone, i.phone, e.draft_phone),
         dsg.name, dep.name, mgr.full_name, u.name,
         coalesce(p.joined_date, i.joined_date, e.draft_joined_date),
         e.status,
         coalesce(p.is_active, false),
         p.id is not null,
         (select case when bool_or(ur.role = 'super_admin') then 'Super Admin'
                      when bool_or(ur.role in ('org_admin', 'hr_admin')) then 'Admin' end
            from public.user_roles ur
           where ur.user_id = p.id and ur.organization_id = v_org and ur.deleted_at is null),
         case when p.id is not null then (case when p.is_active then 'active' else 'deactivated' end)
              when i.id is not null then 'invited'
              when e.draft_full_name is not null then 'draft' else 'removed' end
    from public.employees e
    left join public.profiles p on p.id = e.profile_id
    left join public.invitations i on i.id = e.invitation_id
    left join public.designations dsg on dsg.id = e.designation_id
    left join public.departments dep on dep.id = coalesce(p.department_id, i.department_id, e.draft_department_id)
    left join public.profiles mgr on mgr.id = coalesce(p.manager_id, e.draft_manager_id)
                                  or (p.id is null and e.draft_manager_id is null and i.manager_email is not null
                                      and lower(mgr.email) = lower(i.manager_email)
                                      and mgr.organization_id = v_org)
    left join lateral (
      select du.name from public.employee_deployments d
        join public.deployment_units du on du.id = d.deployment_unit_id
       where d.employee_id = e.id and d.effective_to is null
         and d.effective_from <= public.org_today(v_org)
       order by d.effective_from desc limit 1
    ) u on true
   where e.organization_id = v_org
     and e.deleted_at is null
     -- Drafts are an Admin's work in progress, not people in the company yet.
     and (p.id is not null or i.id is not null or (e.draft_full_name is not null and public.is_admin()))
     and (v_q is null
          or lower(coalesce(p.full_name, i.full_name, e.draft_full_name, '')) like '%' || v_q || '%'
          or lower(coalesce(e.employee_code, '')) like '%' || v_q || '%'
          or lower(coalesce(dsg.name, '')) like '%' || v_q || '%'
          or lower(coalesce(dep.name, '')) like '%' || v_q || '%'
          or lower(coalesce(p.email, i.email, e.draft_email, '')) like '%' || v_q || '%')
   order by coalesce(p.is_active, false) desc, lower(coalesce(p.full_name, i.full_name, e.draft_full_name, ''));
end $$;

comment on function public.employee_directory is
  'E5 — everybody in the organisation with the fields everybody may see (§5): no personal, family, address, statutory or bank data, for any caller.';

revoke all on function public.employee_directory(text) from public, anon;
grant execute on function public.employee_directory(text) to authenticated;

-- ═══════════════════════════════════════════════════════════ before letting go

/**
 * What deactivating this person will do, for the dialog to say before anybody
 * presses anything: their reports, the approvals waiting on them, the posting
 * that will close, and who could take their work over.
 */
create or replace function public.employee_deactivation_preview(_employee_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  v_e   public.employees%rowtype;
begin
  perform public.employee_require_admin(_employee_id);
  select * into v_e from public.employees where id = _employee_id;
  if v_e.profile_id is null then
    raise exception 'NOT_SIGNED_IN_YET' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'directReports', (select count(*) from public.profiles
                       where manager_id = v_e.profile_id and organization_id = v_org
                         and deleted_at is null and is_active),
    'pendingApprovals', (select count(distinct s.approval_request_id)
                           from public.approval_steps s
                           join public.approval_requests r on r.id = s.approval_request_id
                          where s.approver_id = v_e.profile_id and s.decision = 'pending'
                            and s.deleted_at is null and r.status = 'pending'
                            and r.organization_id = v_org),
    'openPosting', (select jsonb_build_object('unitName', u.name, 'since', d.effective_from)
                      from public.employee_deployments d
                      join public.deployment_units u on u.id = d.deployment_unit_id
                     where d.employee_id = _employee_id and d.effective_to is null),
    -- Who can take the work: active, not this person, and able to approve
    -- (D57), because reports and approvals move to them.
    'successors', coalesce((
      select jsonb_agg(jsonb_build_object('profileId', p.id, 'fullName', coalesce(p.full_name, p.email))
                       order by lower(coalesce(p.full_name, p.email)))
        from public.profiles p
       where p.organization_id = v_org and p.is_active and p.deleted_at is null
         and p.id <> v_e.profile_id and public.can_approve(p.id)), '[]'::jsonb)
  );
end $$;

revoke all on function public.employee_deactivation_preview(uuid) from public, anon;
grant execute on function public.employee_deactivation_preview(uuid) to authenticated;
