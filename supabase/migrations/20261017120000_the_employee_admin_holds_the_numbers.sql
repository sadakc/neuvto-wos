-- ============================================================================
-- NEUVTO WOS — the Employee Admin enters the numbers and opens them with a
-- click (D84, D85)
-- ============================================================================
--
-- Sada, 12 Oct 2026, reversing parts of §5 of NEUVTO_EMPLOYEE_MASTER and D80:
--
--   1. "Admin" on an employee record now means Employee Admin:
--      is_module_admin('employee'), so a company-wide Admin still is one and a
--      Leave Admin is not. Adding, inviting and letting people go (E8) come
--      with it, so invitation_create, deactivation_impact, deactivate_employee
--      and reactivate_employee accept an Employee Admin. Granting an
--      administrator-tier role still needs a Super Admin (D78), unchanged.
--   2. The Employee Admin enters statutory numbers, bank details, and
--      religion, caste category and disability. Payroll keeps bank; Statutory
--      keeps statutory and restricted.
--   3. After saving, the Admin sees the last four digits. The eye opens the
--      full number: UAN, EPF, ESIC, the old UAN and ESIC, Aadhaar, PAN and the
--      bank account, and the restricted values.
--   4. The eye asks for no reason. Every opening is still written to
--      restricted_reads before the value is returned, so the person and a
--      Super Admin can see who looked, at what, and when. A reason, if a
--      screen ever sends one, is kept.
--   5. The person themselves sees last four digits and that restricted data is
--      held, never the full values: there is no eye on their own card.
--   6. Aadhaar is optional. "Aadhaar or PAN" leaves the default onboarding
--      checklist's mandatory items; a company can still make it mandatory.
--
-- What does not change: storage. Every one of these numbers stays encrypted in
-- the database (Sada chose this, 12 Oct). Encryption is what a stolen backup
-- meets; the lock on screen is what a colleague over the shoulder meets.
-- ============================================================================

alter table public.restricted_reads alter column reason drop not null;

-- ── employee_relationship: is_admin() becomes is_module_admin('employee')
CREATE OR REPLACE FUNCTION public.employee_relationship(_employee_id uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if public.is_module_admin('employee') then v_out := v_out || 'admin'::text; end if;
  if public.has_role(v_uid, 'payroll_officer') then v_out := v_out || 'payroll'::text; end if;
  if public.has_role(v_uid, 'statutory_officer') then v_out := v_out || 'statutory'::text; end if;
  if v_emp.profile_id is not null and exists (
    select 1 from public.profiles where id = v_emp.profile_id and manager_id = v_uid
  ) then v_out := v_out || 'approver'::text; end if;
  return v_out;
end $function$
;


-- ── employee_admin_overview: is_admin() becomes is_module_admin('employee')
CREATE OR REPLACE FUNCTION public.employee_admin_overview()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org uuid := public.current_org_id();
begin
  if (select auth.uid()) is null or v_org is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;
  if not public.module_enabled_for(v_org, 'employee') then
    raise exception 'MODULE_NOT_ENABLED' using errcode = 'P0001';
  end if;
  if not public.is_module_admin('employee') then
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
end $function$
;


-- ── employee_change_requests: is_admin() becomes is_module_admin('employee')
CREATE OR REPLACE FUNCTION public.employee_change_requests(_status text DEFAULT 'open'::text)
 RETURNS TABLE(id uuid, employee_id uuid, employee_name text, section text, details text, status text, resolution_note text, resolved_by_name text, resolved_at timestamp with time zone, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org   uuid := public.current_org_id();
  v_uid   uuid := (select auth.uid());
  v_admin boolean;
begin
  if v_uid is null or v_org is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;
  if not public.module_enabled_for(v_org, 'employee') then
    raise exception 'MODULE_NOT_ENABLED' using errcode = 'P0001';
  end if;
  v_admin := public.is_module_admin('employee');
  return query
    select c.id, c.employee_id, coalesce(p.full_name, p.email), c.section, c.details, c.status,
           c.resolution_note, (select coalesce(rp.full_name, rp.email) from public.profiles rp where rp.id = c.resolved_by),
           c.resolved_at, c.created_at
      from public.employee_change_requests c
      join public.employees e on e.id = c.employee_id
      left join public.profiles p on p.id = e.profile_id
     where c.organization_id = v_org
       and (_status is null or c.status = _status)
       -- An Admin sees everybody's; anybody else, only their own.
       and (v_admin or e.profile_id = v_uid)
     order by c.created_at desc
     limit 500;
end $function$
;


-- ── employee_create_draft: is_admin() becomes is_module_admin('employee')
CREATE OR REPLACE FUNCTION public.employee_create_draft(_values jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if not public.is_module_admin('employee') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if length(btrim(coalesce(_values ->> 'fullName', ''))) = 0 then
    raise exception 'NAME_REQUIRED' using errcode = 'P0001';
  end if;
  insert into public.employees (organization_id) values (v_org) returning id into v_id;
  perform public.employee_apply_draft(v_id, _values);
  return v_id;
end $function$
;


-- ── employee_directory: is_admin() becomes is_module_admin('employee')
CREATE OR REPLACE FUNCTION public.employee_directory(_q text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, employee_code text, full_name text, work_email text, mobile text, designation text, department text, reports_to text, deployed_unit text, date_of_joining date, status text, is_active boolean, has_signed_in boolean, admin_role text, stage text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
     and (p.id is not null or i.id is not null or (e.draft_full_name is not null and public.is_module_admin('employee')))
     and (v_q is null
          or lower(coalesce(p.full_name, i.full_name, e.draft_full_name, '')) like '%' || v_q || '%'
          or lower(coalesce(e.employee_code, '')) like '%' || v_q || '%'
          or lower(coalesce(dsg.name, '')) like '%' || v_q || '%'
          or lower(coalesce(dep.name, '')) like '%' || v_q || '%'
          or lower(coalesce(p.email, i.email, e.draft_email, '')) like '%' || v_q || '%')
   order by coalesce(p.is_active, false) desc, lower(coalesce(p.full_name, i.full_name, e.draft_full_name, ''));
end $function$
;


-- ── employee_require_config_admin: is_admin() becomes is_module_admin('employee')
CREATE OR REPLACE FUNCTION public.employee_require_config_admin()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_org uuid := public.current_org_id();
begin
  if (select auth.uid()) is null or v_org is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;
  if not public.module_enabled_for(v_org, 'employee') then
    raise exception 'MODULE_NOT_ENABLED' using errcode = 'P0001';
  end if;
  if not public.is_module_admin('employee') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return v_org;
end $function$
;


-- ── invitation_create: is_admin() becomes is_module_admin('employee')
CREATE OR REPLACE FUNCTION public.invitation_create(_email text, _phone text DEFAULT NULL::text, _role app_role DEFAULT 'employee'::app_role, _full_name text DEFAULT NULL::text, _joined_date date DEFAULT NULL::date, _manager_email text DEFAULT NULL::text, _department_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org     uuid := public.current_org_id();
  v_actor   uuid := (select auth.uid());
  v_email   text := lower(btrim(_email));
  v_phone   text := nullif(regexp_replace(coalesce(_phone, ''), '[^0-9+]', '', 'g'), '');
  v_id      uuid;
  v_row     public.invitations%rowtype;
  v_orgname text;
  v_inviter text;
begin
  if v_actor is null or v_org is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;
  if not public.is_module_admin('employee') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  -- D78. Inviting somebody as an administrator is granting them that role, a
  -- few days later. The same rule as member_set_roles, or the invite box is the
  -- way round it.
  if public.is_reserved_for_super_admin(_role) and not public.is_super_admin() then
    raise exception 'ROLE_NOT_YOURS_TO_GRANT' using errcode = '42501', detail = _role::text;
  end if;

  if v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'INVALID_EMAIL' using errcode = 'P0001';
  end if;

  -- Whitespace is not a name. btrim before the test, because "   " arrives from
  -- a form as readily as "" does and reads as a name to nothing but length().
  if btrim(coalesce(_full_name, '')) = '' then
    raise exception 'NAME_REQUIRED' using errcode = 'P0001';
  end if;

  -- D40. Duplicates INSIDE this organisation are the admin's own data and are
  -- named plainly. Whether the address exists in another customer's workspace
  -- is never disclosed, here or anywhere.
  if exists (
    select 1 from public.profiles
     where organization_id = v_org and lower(email) = v_email and deleted_at is null
  ) then
    raise exception 'ALREADY_A_MEMBER' using errcode = 'P0001';
  end if;

  if v_phone is not null and exists (
    select 1 from public.profiles
     where organization_id = v_org and phone_normalized = v_phone and deleted_at is null
  ) then
    raise exception 'PHONE_ALREADY_A_MEMBER' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.invitations
     where organization_id = v_org and email = v_email
       and deleted_at is null and revoked_at is null and accepted_at is null
  ) then
    raise exception 'ALREADY_INVITED' using errcode = 'P0001';
  end if;

  if v_phone is not null and exists (
    select 1 from public.invitations
     where organization_id = v_org and phone_normalized = v_phone
       and deleted_at is null and revoked_at is null and accepted_at is null
  ) then
    raise exception 'PHONE_ALREADY_INVITED' using errcode = 'P0001';
  end if;

  -- What this person arrives with, carried until they accept. None of it can be
  -- written to a profile now: profiles.id references auth.users, so nobody has
  -- one until they have proved their address (D39).
  insert into public.invitations
    (organization_id, email, phone, role, full_name,
     joined_date, manager_email, department_id)
  values
    (v_org, v_email, nullif(btrim(_phone), ''), _role, nullif(btrim(_full_name), ''),
     _joined_date, lower(nullif(btrim(_manager_email), '')), _department_id)
  returning * into v_row;

  v_id := v_row.id;

  v_orgname := public.organization_display_name(v_org);
  select coalesce(full_name, email) into v_inviter from public.profiles where id = v_actor;

  perform public.emit_platform_event('member.invited', jsonb_build_object(
    'organization_id',   v_org,
    'organization_name', v_orgname,
    'inviter_name',      coalesce(v_inviter, 'Your administrator'),
    'email',             v_email,
    'full_name',         v_row.full_name,
    'role',              _role,
    'invite_url',        public.app_base_url() || '/auth?invite=' || v_row.token,
    'expires_on',        to_char(v_row.expires_at, 'DD Mon YYYY')
  ));

  insert into public.analytics_events (organization_id, user_id, event, properties)
  values (v_org, v_actor, 'member.invited', jsonb_build_object('role', _role));

  return v_id;
end $function$
;


-- ── deactivation_impact: is_admin() becomes is_module_admin('employee')
CREATE OR REPLACE FUNCTION public.deactivation_impact(_employee_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org uuid := public.current_org_id();
begin
  if v_org is null or not public.is_module_admin('employee') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'reports', (select count(*) from public.profiles
                 where manager_id = _employee_id and organization_id = v_org
                   and deleted_at is null),
    'approvals', (select count(*) from public.approval_steps s
                    join public.approval_requests r on r.id = s.approval_request_id
                   where s.approver_id = _employee_id and s.decision = 'pending'
                     and s.deleted_at is null and r.status = 'pending'
                     and r.deleted_at is null and r.organization_id = v_org));
end $function$
;


-- ── deactivate_employee: is_admin() becomes is_module_admin('employee')
CREATE OR REPLACE FUNCTION public.deactivate_employee(_employee_id uuid, _successor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org       uuid := public.current_org_id();
  v_uid       uuid := (select auth.uid());
  v_reports   int;
  v_steps     int;
  v_collapsed int;
  v_requests  uuid[];
begin
  if v_org is null or not public.is_module_admin('employee') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if _employee_id = v_uid then
    raise exception 'CANNOT_DEACTIVATE_SELF' using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.profiles
                  where id = _employee_id and organization_id = v_org
                    and deleted_at is null and is_active) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  -- The workspace must keep somebody who can administer it — including somebody
  -- who could reverse this.
  if exists (select 1 from public.user_roles
              where user_id = _employee_id and organization_id = v_org
                and role = 'org_admin' and deleted_at is null)
     and (select count(*) from public.user_roles ur
            join public.profiles p on p.id = ur.user_id
           where ur.organization_id = v_org and ur.role = 'org_admin'
             and ur.deleted_at is null and p.deleted_at is null and p.is_active) <= 1
  then
    raise exception 'LAST_ADMIN' using errcode = 'P0001';
  end if;

  if _successor_id is null or _successor_id = _employee_id then
    raise exception 'SUCCESSOR_REQUIRED' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.profiles
                  where id = _successor_id and organization_id = v_org
                    and deleted_at is null and is_active) then
    raise exception 'SUCCESSOR_NOT_FOUND' using errcode = 'P0002';
  end if;

  select coalesce(array_agg(distinct s.approval_request_id), '{}')
    into v_requests
    from public.approval_steps s
    join public.approval_requests r on r.id = s.approval_request_id
   where s.approver_id = _employee_id
     and s.decision = 'pending'
     and s.deleted_at is null
     and r.status = 'pending'
     and r.deleted_at is null
     and r.organization_id = v_org;

  if exists (
    select 1 from public.approval_requests r
     where r.id = any (v_requests) and r.requester_id = _successor_id
  ) then
    raise exception 'SUCCESSOR_IS_REQUESTER' using errcode = 'P0001';
  end if;

  -- D57, through the other door.
  --
  -- admin_set_reporting_line refuses to make an Employee somebody's manager.
  -- This function reassigns reports and pending approval steps WITHOUT going
  -- through it, so handing a leaver's team to an Employee produced exactly the
  -- arrangement that guard exists to prevent — and produced it in bulk.
  --
  -- Only when something is actually handed over. A leaver holding no reports and
  -- no waiting approvals can be succeeded by anybody, and refusing on the
  -- successor's role there would block an ordinary departure over a rule with
  -- nothing to bite on.
  if not public.can_approve(_successor_id)
     and (array_length(v_requests, 1) > 0
          or exists (select 1 from public.profiles
                      where manager_id = _employee_id
                        and organization_id = v_org
                        and deleted_at is null)) then
    raise exception 'SUCCESSOR_CANNOT_APPROVE' using errcode = 'P0001';
  end if;

  update public.profiles
     set manager_id = _successor_id
   where manager_id = _employee_id
     and organization_id = v_org
     and deleted_at is null;
  get diagnostics v_reports = row_count;

  update public.approval_steps s
     set approver_id = _successor_id
    from public.approval_requests r
   where r.id = s.approval_request_id
     and s.approver_id = _employee_id
     and s.decision = 'pending'
     and s.deleted_at is null
     and r.status = 'pending'
     and r.deleted_at is null
     and r.organization_id = v_org;
  get diagnostics v_steps = row_count;

  with ranked as (
    select s.id,
           row_number() over (partition by s.approval_request_id order by s.level) as rn
      from public.approval_steps s
     where s.approver_id = _successor_id
       and s.decision = 'pending'
       and s.deleted_at is null
       and s.approval_request_id = any (v_requests)
  )
  update public.approval_steps
     set deleted_at = now()
   where id in (select id from ranked where rn > 1);
  get diagnostics v_collapsed = row_count;

  update public.approval_requests r
     set required_levels = (
           select count(*) from public.approval_steps s
            where s.approval_request_id = r.id and s.deleted_at is null),
         current_level = coalesce((
           select min(s.level) from public.approval_steps s
            where s.approval_request_id = r.id
              and s.decision = 'pending' and s.deleted_at is null), r.current_level)
   where r.id = any (v_requests);

  update public.profiles
     set is_active = false
   where id = _employee_id and organization_id = v_org;

  insert into public.audit_logs
    (organization_id, actor_id, action, entity_type, entity_id, before, after)
  values
    (v_org, v_uid, 'member.deactivated', 'profiles', _employee_id,
     jsonb_build_object('is_active', true),
     jsonb_build_object('is_active', false,
                        'successor_id', _successor_id,
                        'reports_moved', v_reports,
                        'approvals_moved', v_steps,
                        'levels_collapsed', v_collapsed));

  return jsonb_build_object(
    'reports_moved',    v_reports,
    'approvals_moved',  v_steps,
    'levels_collapsed', v_collapsed);
end $function$
;


-- ── reactivate_employee: is_admin() becomes is_module_admin('employee')
CREATE OR REPLACE FUNCTION public.reactivate_employee(_employee_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org uuid := public.current_org_id();
  v_uid uuid := (select auth.uid());
begin
  if v_org is null or not public.is_module_admin('employee') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.profiles
                  where id = _employee_id and organization_id = v_org
                    and deleted_at is null and not is_active) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Access, and only access.
  --
  -- Their reports and approvals moved to a successor who has been carrying them
  -- since; taking those back weeks later would change who a third person reports
  -- to, decided by a click on somebody else's record and without either of them
  -- being asked. Cancelled leave stays cancelled — they re-apply, against a
  -- balance that never went anywhere.
  update public.profiles
     set is_active = true
   where id = _employee_id and organization_id = v_org;

  insert into public.audit_logs
    (organization_id, actor_id, action, entity_type, entity_id, before, after)
  values
    (v_org, v_uid, 'member.reactivated', 'profiles', _employee_id,
     jsonb_build_object('is_active', false),
     jsonb_build_object('is_active', true, 'restored', 'access only'));
end $function$
;


-- ── employee_set_bank: the Employee Admin as well as Payroll
CREATE OR REPLACE FUNCTION public.employee_set_bank(_employee_id uuid, _values jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_rel text[] := public.restricted_target(_employee_id);
  v_org uuid := public.current_org_id();
  v_row public.employee_bank%rowtype;
  v     text;
begin
  perform public.restricted_known_keys(_values,
    array['bankName','branch','account','ifsc','accountHolder','pennyDropStatus']);
  if not (v_rel && array['payroll','admin']) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select * into v_row from public.employee_bank where employee_id = _employee_id;
  if not found then
    v_row.employee_id := _employee_id;
    v_row.organization_id := v_org;
    v_row.penny_drop_status := 'not_checked';
  end if;

  if _values ? 'account' then
    v := public.statutory_normalise(_values ->> 'account');
    if v is not null and v !~ '^[0-9]{9,18}$' then
      raise exception 'INVALID_ACCOUNT' using errcode = 'P0001';
    end if;
    v_row.account_cipher := public.restricted_encrypt(v);
    v_row.account_last4 := right(v, 4);
    -- A new account has not been penny-dropped, whatever the old one was.
    if not (_values ? 'pennyDropStatus') then v_row.penny_drop_status := 'not_checked'; end if;
  end if;
  if _values ? 'ifsc' then
    v := public.statutory_normalise(_values ->> 'ifsc');
    if v is not null and v !~ '^[A-Z]{4}0[A-Z0-9]{6}$' then
      raise exception 'INVALID_IFSC' using errcode = 'P0001';
    end if;
    v_row.ifsc := v;
  end if;
  if _values ? 'bankName' then v_row.bank_name := nullif(btrim(_values ->> 'bankName'), ''); end if;
  if _values ? 'branch' then v_row.branch := nullif(btrim(_values ->> 'branch'), ''); end if;
  if _values ? 'accountHolder' then v_row.account_holder := nullif(btrim(_values ->> 'accountHolder'), ''); end if;
  if _values ? 'pennyDropStatus' then v_row.penny_drop_status := coalesce(_values ->> 'pennyDropStatus', 'not_checked'); end if;

  begin
    insert into public.employee_bank values (v_row.*)
    on conflict (employee_id) do update set
      bank_name = excluded.bank_name, branch = excluded.branch,
      account_cipher = excluded.account_cipher, account_last4 = excluded.account_last4,
      ifsc = excluded.ifsc, account_holder = excluded.account_holder,
      penny_drop_status = excluded.penny_drop_status;
  exception when check_violation then
    raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = sqlerrm;
  end;
end $function$
;


-- ── employee_set_restricted: the Employee Admin as well as Statutory
CREATE OR REPLACE FUNCTION public.employee_set_restricted(_employee_id uuid, _values jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_rel  text[] := public.restricted_target(_employee_id);
  v_org  uuid := public.current_org_id();
  v_old  jsonb;
  v_new  jsonb;
  v_pct  numeric;
begin
  perform public.restricted_known_keys(_values,
    array['religion','casteCategory','disabilityStatus','disabilityPercent']);
  if not (v_rel && array['statutory','admin']) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if _values ? 'casteCategory' and _values ->> 'casteCategory' is not null
     and _values ->> 'casteCategory' not in ('general','obc','sc','st','ews','not_disclosed') then
    raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'casteCategory';
  end if;
  if _values ? 'disabilityStatus' and _values ->> 'disabilityStatus' is not null
     and _values ->> 'disabilityStatus' not in ('none','disabled','not_disclosed') then
    raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'disabilityStatus';
  end if;
  if _values ? 'disabilityPercent' and _values ->> 'disabilityPercent' is not null then
    begin
      v_pct := (_values ->> 'disabilityPercent')::numeric;
    exception when others then
      raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'disabilityPercent';
    end;
    if v_pct < 0 or v_pct > 100 then
      raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'disabilityPercent';
    end if;
  end if;

  select public.restricted_decrypt(values_cipher)::jsonb into v_old
    from public.employee_restricted where employee_id = _employee_id;
  v_new := coalesce(v_old, '{}'::jsonb) || _values;

  insert into public.employee_restricted (employee_id, organization_id, values_cipher)
  values (_employee_id, v_org, public.restricted_encrypt(v_new::text))
  on conflict (employee_id) do update set values_cipher = excluded.values_cipher;
end $function$
;


-- ── employee_card: bank and restricted for the Employee Admin; the eye for them
CREATE OR REPLACE FUNCTION public.employee_card(_employee_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- ── E6: statutory numbers, verification, bank, restricted (§5, D80, D85).
  --    Last-four for self and the Employee Admin; UAN, EPF and ESIC in full
  --    for Payroll and Statutory. Everything else in full only through
  --    employee_reveal_restricted(), which logs the opening.
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

  -- Bank: the person themselves (last four), Payroll and, since D85, the
  -- Employee Admin. Not Statutory.
  if self_ or pay_ or admin_ then
    select * into v_bk from public.employee_bank where employee_id = v_e.id;
    v_card := v_card || jsonb_build_object('bank', jsonb_build_object(
      'recorded',        v_bk.employee_id is not null,
      'bankName',        v_bk.bank_name,
      'ifsc',            v_bk.ifsc,
      'accountLast4',    v_bk.account_last4,
      'pennyDropStatus', coalesce(v_bk.penny_drop_status, 'not_checked')
    ) || case when pay_ or admin_ then jsonb_build_object(
      'branch',        v_bk.branch,
      'accountHolder', v_bk.account_holder
    ) else '{}'::jsonb end);
  end if;

  -- Restricted: only whether anything is held. The values come by reveal.
  if self_ or stat_ or admin_ then
    v_card := v_card || jsonb_build_object('restricted', jsonb_build_object(
      'recorded', exists (select 1 from public.employee_restricted where employee_id = v_e.id)));
  end if;

  v_card := v_card || jsonb_build_object('capabilities', jsonb_build_object(
    'canEdit', admin_,
    'canRequestChange', self_ and not admin_,
    'canSeeHistory', self_ or admin_ or pay_ or stat_,
    'canRevealStatutory', stat_ or admin_,
    'canRevealBank', pay_ or admin_,
    'canRevealRestricted', stat_ or admin_,
    'canEditStatutory', admin_ or stat_,
    'canEditVerification', admin_,
    'canEditBank', pay_ or admin_,
    'canEditRestricted', stat_ or admin_,
    'canSeeReveals', self_ or stat_ or public.is_super_admin(),
    -- E8: the Admin's lifecycle actions, offered only where they can work.
    'canSendInvite', admin_ and v_p.id is null and v_inv.id is null and v_e.draft_full_name is not null,
    'canDeactivate', admin_ and v_p.id is not null and coalesce(v_p.is_active, false) and not self_,
    'canEditDraft',  admin_ and v_p.id is null and v_inv.id is null and v_e.draft_full_name is not null
  ));

  return v_card;
end $function$
;

-- ═══════════════════════════════════════════════════════════ the eye

/**
 * The only way a full number or restricted value reaches a browser, besides
 * the UAN, EPF and ESIC that Payroll and Statutory see on the card. All or
 * nothing: one field the caller may not open refuses the whole call.
 *
 *   uan, epf_number, esic_number,
 *   old_uan, old_esic_number, aadhaar, pan  the Employee Admin, Statutory
 *   bank_account                           the Employee Admin, Payroll
 *   religion, caste_category, disability   the Employee Admin, Statutory
 *
 * Not the person themselves (D85): their own card shows the last four.
 *
 * The restricted_reads row is written in this transaction, before the values
 * are returned: if the log cannot be written, nothing is revealed. The reason
 * is optional since D85, and kept when given.
 */
create or replace function public.employee_reveal_restricted(
  _employee_id uuid,
  _fields      text[],
  _reason      text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_rel   text[] := public.restricted_target(_employee_id);
  v_uid   uuid := (select auth.uid());
  v_admin boolean := 'admin' = any (v_rel);
  v_stat  boolean := 'statutory' = any (v_rel);
  v_pay   boolean := 'payroll' = any (v_rel);
  v_nums  text[] := array['uan','epf_number','esic_number','old_uan','old_esic_number','aadhaar','pan'];
  v_known text[] := v_nums || array['bank_account','religion','caste_category','disability'];
  v_out   jsonb := '{}'::jsonb;
  v_r     jsonb;
  f       text;
  v_s     public.employee_statutory%rowtype;
begin
  if _fields is null or cardinality(_fields) = 0 then
    raise exception 'UNKNOWN_FIELD' using errcode = 'P0001';
  end if;
  foreach f in array _fields loop
    if not (f = any (v_known)) then
      raise exception 'UNKNOWN_FIELD' using errcode = 'P0001', detail = f;
    end if;
    if (f = any (v_nums) and not (v_admin or v_stat))
       or (f = 'bank_account' and not (v_admin or v_pay))
       or (f in ('religion','caste_category','disability') and not (v_admin or v_stat)) then
      raise exception 'FORBIDDEN' using errcode = '42501', detail = f;
    end if;
  end loop;

  insert into public.restricted_reads (organization_id, reader_id, reader_name, employee_id, fields, reason)
  values (public.current_org_id(), v_uid,
          (select coalesce(full_name, email) from public.profiles where id = v_uid),
          _employee_id, (select array_agg(distinct x order by x) from unnest(_fields) x),
          nullif(btrim(coalesce(_reason, '')), ''));

  select * into v_s from public.employee_statutory where employee_id = _employee_id;
  if 'uan' = any (_fields) then v_out := v_out || jsonb_build_object('uan', public.restricted_decrypt(v_s.uan_cipher)); end if;
  if 'epf_number' = any (_fields) then v_out := v_out || jsonb_build_object('epfNumber', public.restricted_decrypt(v_s.epf_cipher)); end if;
  if 'esic_number' = any (_fields) then v_out := v_out || jsonb_build_object('esicNumber', public.restricted_decrypt(v_s.esic_cipher)); end if;
  if 'old_uan' = any (_fields) then v_out := v_out || jsonb_build_object('oldUan', public.restricted_decrypt(v_s.old_uan_cipher)); end if;
  if 'old_esic_number' = any (_fields) then v_out := v_out || jsonb_build_object('oldEsicNumber', public.restricted_decrypt(v_s.old_esic_cipher)); end if;
  if 'aadhaar' = any (_fields) then v_out := v_out || jsonb_build_object('aadhaar', public.restricted_decrypt(v_s.aadhaar_cipher)); end if;
  if 'pan' = any (_fields) then v_out := v_out || jsonb_build_object('pan', public.restricted_decrypt(v_s.pan_cipher)); end if;
  if 'bank_account' = any (_fields) then
    v_out := v_out || jsonb_build_object('bankAccount',
      (select public.restricted_decrypt(account_cipher) from public.employee_bank where employee_id = _employee_id));
  end if;
  if _fields && array['religion','caste_category','disability'] then
    select public.restricted_decrypt(values_cipher)::jsonb into v_r
      from public.employee_restricted where employee_id = _employee_id;
    if 'religion' = any (_fields) then v_out := v_out || jsonb_build_object('religion', v_r -> 'religion'); end if;
    if 'caste_category' = any (_fields) then v_out := v_out || jsonb_build_object('casteCategory', v_r -> 'casteCategory'); end if;
    if 'disability' = any (_fields) then
      v_out := v_out || jsonb_build_object('disabilityStatus', v_r -> 'disabilityStatus',
                                           'disabilityPercent', v_r -> 'disabilityPercent');
    end if;
  end if;
  return v_out;
end $$;

comment on function public.employee_reveal_restricted is
  'D80, D85 — opens full numbers and restricted values for the Employee Admin (and Payroll for bank, Statutory for the rest), after writing the restricted_reads row in the same transaction. All or nothing; a reason is optional.';

revoke all on function public.employee_reveal_restricted(uuid, text[], text) from public, anon;
grant execute on function public.employee_reveal_restricted(uuid, text[], text) to authenticated;

-- ═══════════════════════════════════════════════════════════ Aadhaar is optional

-- Reproduced from 20261016100000_configuration.sql. The diff: identity_number
-- is not mandatory by default, and bank is no longer labelled Payroll's.
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
    ('identity_number',       'Aadhaar or PAN',                           15::smallint, false, 8::smallint),
    ('uan',                   'UAN',                                      15::smallint, true,  9::smallint),
    ('bank',                  'Bank account',                             15::smallint, true,  10::smallint),
    ('nominees',              'Nominees totalling 100%',                  30::smallint, true,  11::smallint),
    ('police_verification',   'Police verification done',                 30::smallint, false, 12::smallint)
$$;
