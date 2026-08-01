-- ============================================================================
-- NEUVTO WOS — an invitation carries what somebody arrives with
--
-- A customer's first import is not a list of new hires. It is their existing
-- staff: people who joined years ago and have already taken leave this year.
-- Two things stood in the way, and one of them was live.
--
-- ── THE DEFECT
--
-- invitation_accept inserted (id, organization_id, full_name, email, phone) and
-- NOT joined_date, which defaults to CURRENT_DATE. Every seeded person has a
-- sensible date only because the seed writes it directly; anybody arriving the
-- way the product actually requires — by invitation, D39 — got today.
--
-- calculate_entitlement pro-rates the year from that date (D3). Measured on the
-- seed before this migration, inviting somebody who joined in 2022:
--
--     joined_date recorded : 2026-08-01     (the day they clicked)
--     entitlement 2026-27  : 8.0 days       (a full year is 12)
--
-- A third of their leave, gone, silently. And 2026-08-01 was the SERVER's date
-- while the organisation's own today was 2026-08-02 — which is the entire
-- reason org_today exists (D9).
--
-- ── WHY THIS LIVES ON THE INVITATION AND NOT IN THE IMPORT
--
-- profiles.id references auth.users, so a profile cannot exist until somebody
-- has an auth account, and D39 says the only way to one is accepting an
-- invitation. An import therefore creates INVITATIONS, not people. Everything a
-- CSV knows about somebody has to wait on the invitation until they arrive.
--
-- Both functions below were produced by substituting into their live
-- definitions and diffing, not retyped. Rebuilding a function by hand to change
-- a few lines is how four guards were silently dropped from the approval engine
-- earlier in this project.
-- ============================================================================

alter table public.invitations
  add column if not exists joined_date   date,
  add column if not exists manager_email text,
  add column if not exists department_id uuid references public.departments(id) on delete set null;

comment on column public.invitations.joined_date is
  'The real start date, applied to the profile on acceptance. Null means "today" — a genuinely new hire.';
comment on column public.invitations.manager_email is
  'Who they report to, by address, because nobody has a profile id until they accept. Resolved both ways in invitation_accept.';

-- THE OLD SIGNATURE HAS TO GO, NOT JUST BE REPLACED.
--
-- `create or replace` with extra parameters does not replace anything — it
-- creates a second function, and the two then overlap because the new
-- parameters all have defaults. Every existing four-argument call becomes:
--
--     ERROR:  function public.invitation_create(unknown, unknown, unknown, unknown)
--             is not unique
--     HINT:   Could not choose a best candidate function.
--
-- Which is to say: the single-invite form, and the harness, both stop working.
-- Found by looking at pg_proc after applying, rather than by assuming a replace
-- had replaced something.
drop function if exists public.invitation_create(text, text, app_role, text);

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

CREATE OR REPLACE FUNCTION public.invitation_accept(_token text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid   uuid := (select auth.uid());
  v_email text;
  v_inv   public.invitations%rowtype;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;

  select email into v_email from auth.users where id = v_uid;
  if v_email is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;

  select * into v_inv from public.invitations
   where token = btrim(_token)
     and deleted_at is null
     and revoked_at is null
     and accepted_at is null
     and expires_at > now();

  -- ONE message for expired, revoked, already-accepted, non-existent and
  -- addressed-to-someone-else alike. Distinguishing them turns this function
  -- into an oracle for probing tokens, and there is nothing an honest invitee
  -- could do differently with the more specific answer.
  if v_inv.id is null or lower(v_email) <> v_inv.email then
    raise exception 'INVITATION_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- D40. One person, one workspace — the constraint signup_organization has
  -- always enforced, restated where the second entrance is.
  --
  -- Deliberately not recorded on the invitation row. The admin can read that
  -- row; writing "already in another workspace" onto it would hand them, by the
  -- back door, exactly the cross-tenant fact invitation_create refuses to give
  -- them at the front. The person in front of us is told, because it is their
  -- own address, and the server log carries it for support.
  if exists (select 1 from public.profiles where id = v_uid and deleted_at is null) then
    raise warning 'invitation % not accepted: % already has a profile', v_inv.id, v_uid;
    raise exception 'EMAIL_IN_ANOTHER_WORKSPACE' using errcode = 'P0001';
  end if;

  -- joined_date was NOT set here, and the column defaults to CURRENT_DATE — so
  -- somebody who joined the company in 2022 was recorded as having started the
  -- day they clicked the link, and calculate_entitlement (D3) pro-rated their
  -- year from there. Measured on the seed before this change: 8 days instead of
  -- 12. CURRENT_DATE is also the server's date rather than the organisation's,
  -- which is the whole reason org_today exists (D9).
  insert into public.profiles
    (id, organization_id, full_name, email, phone, joined_date, department_id)
  values
    (v_uid, v_inv.organization_id, v_inv.full_name, v_email, v_inv.phone,
     -- NOT org_today(): it calls assert_own_org, and somebody accepting an
     -- invitation has no profile yet, so current_org_id() is null and every
     -- invitation without a start date would die with TENANT_MISMATCH. Caught
     -- by the harness on the seed's own provisioning invitation; the earlier
     -- hand test passed only because coalesce short-circuits when the date IS
     -- present. Same timezone resolution, without a guard that cannot apply to
     -- somebody who is not a member yet.
     coalesce(v_inv.joined_date,
              (now() at time zone coalesce(
                 (select s.timezone from public.organization_settings s
                   where s.organization_id = v_inv.organization_id), 'UTC'))::date),
     v_inv.department_id);

  insert into public.user_roles (user_id, organization_id, role)
  values (v_uid, v_inv.organization_id, v_inv.role);

  -- ── the reporting line, resolved BOTH ways
  --
  -- A CSV lists people in whatever order the customer's spreadsheet had them,
  -- and the spec promises that order does not matter. It only does not matter
  -- if both halves of this run: a report accepting before their manager, and a
  -- manager accepting after their reports.
  --
  -- Matched on email because that is what the file carries — nobody has a
  -- profile id until they accept, which is the whole difficulty.
  if v_inv.manager_email is not null then
    update public.profiles p
       set manager_id = m.id
      from public.profiles m
     where p.id = v_uid
       and m.organization_id = v_inv.organization_id
       and lower(m.email) = lower(v_inv.manager_email)
       and m.deleted_at is null
       and m.id <> v_uid;
  end if;

  -- Anyone already here who named THIS person as their manager and is still
  -- unattached. Without this half, a file listing reports first leaves them
  -- reporting to nobody forever.
  update public.profiles p
     set manager_id = v_uid
    from public.invitations i
   where i.accepted_by = p.id
     and i.organization_id = v_inv.organization_id
     and lower(i.manager_email) = lower(v_email)
     and p.manager_id is null
     and p.deleted_at is null
     and p.id <> v_uid;

  update public.invitations
     set accepted_at = now(), accepted_by = v_uid
   where id = v_inv.id;

  insert into public.analytics_events (organization_id, user_id, event, properties)
  values (v_inv.organization_id, v_uid, 'member.joined',
          jsonb_build_object('role', v_inv.role));

  return v_inv.organization_id;
end $function$;

-- The 4-argument form is gone: the new parameters all default, so every existing
-- caller — the single-invite form, the harness — reaches this same function
-- unchanged. Re-granting because the signature changed.
revoke all on function public.invitation_create(text, text, app_role, text, date, text, uuid) from public, anon;
grant execute on function public.invitation_create(text, text, app_role, text, date, text, uuid) to authenticated;
