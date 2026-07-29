-- ============================================================================
-- NEUVTO WOS — Signup: creating the first organisation
--
-- Build step 2. Phase 0 left signup impossible: "admins grant roles" requires
-- is_admin(), but whoever creates a brand-new organisation has no role yet, so
-- they could never be granted org_admin. Chicken-and-egg.
--
-- A SECURITY DEFINER function resolves it by creating the organisation, its
-- settings, the profile and the first admin role in one transaction, bypassing
-- RLS exactly once and under tightly controlled conditions.
-- ============================================================================

create or replace function public.signup_organization(
  p_org_name  text,
  p_slug      text,
  p_full_name text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_email text;
  v_org   uuid;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;

  -- The email comes from the verified auth record, never from the caller.
  -- Accepting it as a parameter would let someone sign up under an address
  -- they have not proved they control.
  select email into v_email from auth.users where id = v_uid;
  if v_email is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;

  -- One organisation per person for now. Without this the function is an
  -- unlimited org factory, and the caller would end up with several profiles
  -- while current_org_id() returns whichever the planner happens to pick.
  if exists (select 1 from public.profiles where id = v_uid and deleted_at is null) then
    raise exception 'ALREADY_IN_ORGANIZATION' using errcode = '23505';
  end if;

  insert into public.organizations (name, slug)
  values (btrim(p_org_name), lower(btrim(p_slug)))
  returning id into v_org;

  insert into public.organization_settings (organization_id) values (v_org);

  insert into public.profiles (id, organization_id, full_name, email)
  values (v_uid, v_org, nullif(btrim(p_full_name), ''), v_email);

  insert into public.user_roles (user_id, organization_id, role)
  values (v_uid, v_org, 'org_admin');

  -- Leave is the only available module today; enabling it here means a new
  -- customer lands on something usable rather than an empty shell.
  insert into public.organization_modules (organization_id, module_key, enabled, enabled_at)
  values (v_org, 'leave', true, now());

  -- Activation funnel starts here (see standards/NEUVTO_ANALYTICS.md).
  insert into public.analytics_events (organization_id, user_id, event, properties)
  values (v_org, v_uid, 'organization.created', jsonb_build_object('slug', lower(btrim(p_slug))));

  return v_org;
end $$;

comment on function public.signup_organization is
  'Creates an organisation and its first org_admin atomically. The only supported way to create an organisation.';

grant execute on function public.signup_organization(text, text, text) to authenticated;

-- ─────────────────────────────────────────────────────────── tighten policies
-- Phase 0 allowed any authenticated user to insert an organisation
-- (`with check (true)`) and to insert their own profile, because signup had to
-- work somehow. Now that signup goes through the function above, both are
-- unnecessary — and the organisation policy was an unlimited-org factory.

drop policy if exists "create an organization" on public.organizations;
drop policy if exists "create own profile"     on public.profiles;

revoke insert on public.organizations from authenticated;
revoke insert on public.profiles      from authenticated;

-- Admins still create profiles for their own organisation via "admins write
-- profiles", which is how invited employees will be added in step 9.
