-- ============================================================================
-- NEUVTO WOS — an invitation carries a name
--
-- Sada, 7 Aug 2026: "The name cannot be optional. Make it a regular one."
--
-- It was optional for a defensible reason: an invitation needs only an address
-- to be deliverable. That is true, and it is not the point. The name is what
-- every OTHER screen identifies a person by, and each of them falls back to the
-- email address without it:
--
--   People              m.fullName || m.email
--   Reports to          the same, in a <select> of colleagues
--   Hand their work to  the same, on the deactivation confirmation
--   Approval timeline   approver_name, from the profile
--   Every report        employee_name
--
-- So a workspace invited without names is a list of logins. The address proves
-- who somebody is; the name is how their colleagues recognise them, and those
-- are different jobs.
--
-- ── where the rule lives
--
-- Both here and in InviteInput. Not because the browser is trusted — it is not —
-- but because a form that submits and then fails is worse than a form that says
-- so, and a database that accepts what the form refuses eventually gets fed by
-- something that is not the form. The import path already refused a nameless row
-- in its dry run; this closes the single-invite path and the RPC behind both.
--
-- ── what is NOT changed, deliberately
--
-- `invitations.full_name` and `profiles.full_name` stay nullable. Rows already
-- exist with neither, and a NOT NULL constraint would refuse to apply against
-- them — a migration that cannot run on real data is not a rule, it is an
-- outage. New rows cannot be nameless; old ones are left where they are.
--
-- `provision_organization` is untouched and still accepts a null admin name. It
-- writes to `invitations` DIRECTLY rather than through this function — checked
-- before this file existed, because adding a raise here would otherwise have
-- broken the one flow that creates a customer. A platform admin naming a
-- customer's first administrator is also a different decision from a customer
-- naming their own colleague, and D42 keeps the two apart.
--
-- Reproduced from 20260806100000_invitation_carries_arrival.sql, which is the
-- current definition. The diff is the one block below INVALID_EMAIL.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.invitation_create(
  _email text,
  _phone text DEFAULT NULL::text,
  _role app_role DEFAULT 'employee'::app_role,
  _full_name text DEFAULT NULL::text,
  _joined_date date DEFAULT NULL::date,
  _manager_email text DEFAULT NULL::text,
  _department_id uuid DEFAULT NULL::uuid)
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
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
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
end $function$;

-- Grants are unchanged: CREATE OR REPLACE keeps them.
