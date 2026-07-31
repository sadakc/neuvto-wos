-- ============================================================================
-- NEUVTO WOS — Platform ownership
--
-- Neuvto is deployed to named customers. Sada decides who administers a
-- workspace; it is not whoever happens to sign in first. Self-serve signup —
-- where any verified email created an organisation and became its org_admin —
-- is closed here and replaced by provisioning.
--
-- This is the Super Admin console the build spec has listed as a known gap
-- since the beginning: "07 defines the role; nothing implements it.
-- Provisioning customer #1 is manual SQL — fine, if deliberate."
--
-- D42 — a platform admin provisions and never reads tenant data.
--
-- That second half is not a promise made in a comment. It falls out of the
-- design: a platform admin has no profile, so current_org_id() returns null and
-- every tenant policy already refuses them. Nothing here weakens that, and
-- verify_rls.sql asserts it — including by sabotage, because an isolation test
-- that would pass against an empty database proves nothing.
--
-- THE MOST DANGEROUS TABLE IN THE SCHEMA IS BELOW. Read the grants twice.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════ who owns Neuvto

create table public.platform_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  note       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.platform_admins is
  'Neuvto staff, above every tenant. Writable only by service_role or direct SQL — never from the application. D42.';

alter table public.platform_admins enable row level security;

-- DELIBERATELY EMPTY. No policy, and no grant to `authenticated` either.
--
-- Both are needed: RLS restricts, GRANT permits, and a table with RLS enabled
-- and no policy still refuses everything — but only because nothing was granted
-- in the first place. Membership of this table is god-mode over provisioning,
-- so there must be no path to it from a signed-in session. Adding one later,
-- for convenience, would be the single worst change anyone could make to this
-- schema.
--
-- Bootstrap is one manual INSERT as service_role. See
-- docs/operations/FIRST_CUSTOMER_RUNBOOK.md.

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.platform_admins where user_id = (select auth.uid())
  );
$$;

comment on function public.is_platform_admin is
  'Whether the caller is Neuvto staff. Used by the provisioning functions and by NO RLS policy — tenant policies must keep refusing platform admins.';

grant execute on function public.is_platform_admin() to authenticated;

-- ═══════════════════════════════════════════════════════════ provisioning

-- Creates a customer workspace and invites the person who will administer it.
--
-- Note what it does NOT do: create a profile. The designated admin arrives
-- through invitation_accept like everybody else, proving they control the
-- address before they hold the role. One entrance (D39), no exceptions carved
-- for the important user.
create or replace function public.provision_organization(
  _name        text,
  _slug        text,
  _admin_email text,
  _admin_phone text default null,
  _admin_name  text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org   uuid;
  v_slug  text := lower(btrim(_slug));
  v_email text := lower(btrim(_admin_email));
  v_inv   public.invitations%rowtype;
begin
  if not public.is_platform_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if btrim(coalesce(_name, '')) = '' then
    raise exception 'ORGANIZATION_NAME_REQUIRED' using errcode = 'P0001';
  end if;
  if v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'INVALID_EMAIL' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.organizations where slug = v_slug and deleted_at is null) then
    raise exception 'SLUG_TAKEN' using errcode = 'P0001';
  end if;

  insert into public.organizations (name, slug)
  values (btrim(_name), v_slug)
  returning id into v_org;

  insert into public.organization_settings (organization_id) values (v_org);

  -- Leave is the only module today. Enabled so the customer lands on something
  -- usable; the module registry screen turns others on as they arrive.
  insert into public.organization_modules (organization_id, module_key, enabled, enabled_at)
  values (v_org, 'leave', true, now());

  -- D37.
  perform public.install_default_approval_chain(v_org);

  -- The org_admin invitation. Written directly rather than through
  -- invitation_create, which resolves the organisation from current_org_id() —
  -- and a platform admin deliberately has no organisation of their own to
  -- resolve. The duplicate checks it performs are meaningless here anyway: the
  -- organisation was created a moment ago and has no members.
  insert into public.invitations (organization_id, email, phone, role, full_name)
  values (v_org, v_email, nullif(btrim(_admin_phone), ''), 'org_admin',
          nullif(btrim(_admin_name), ''))
  returning * into v_inv;

  perform public.emit_platform_event('member.invited', jsonb_build_object(
    'organization_id',   v_org,
    'organization_name', btrim(_name),
    'inviter_name',      'Neuvto',
    'email',             v_email,
    'full_name',         v_inv.full_name,
    'role',              'org_admin',
    'invite_url',        public.app_base_url() || '/auth?invite=' || v_inv.token,
    'expires_on',        to_char(v_inv.expires_at, 'DD Mon YYYY')
  ));

  insert into public.analytics_events (organization_id, user_id, event, properties)
  values (v_org, (select auth.uid()), 'organization.created',
          jsonb_build_object('slug', v_slug, 'provisioned', true));

  return v_org;
end $$;

comment on function public.provision_organization is
  'D39/D42 — creates a customer workspace and invites its first administrator. Platform admins only. Creates no profile: the admin accepts an invitation like anyone else.';

grant execute on function public.provision_organization(text, text, text, text, text) to authenticated;

-- ═══════════════════════════════════════════════════════════ the console's read
--
-- THE ENTIRE READ SURFACE a platform admin has. Columns enumerated one by one
-- and never `select *`: adding a column to organizations should not silently
-- widen what Neuvto staff can see about a customer.
--
-- Names, counts and the state of the admin invitation. No employee, no leave,
-- no balance, no approval — support access was considered and declined, and
-- this is where declining it is enforced rather than asserted.
create or replace function public.platform_list_organizations()
returns table (
  id              uuid,
  name            text,
  slug            text,
  created_at      timestamptz,
  member_count    bigint,
  admin_email     text,
  admin_accepted  boolean,
  admin_invite_url text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  return query
    select o.id,
           o.name,
           o.slug,
           o.created_at,
           (select count(*) from public.profiles p
             where p.organization_id = o.id and p.deleted_at is null),
           i.email,
           (i.accepted_at is not null),
           -- The link, for the case the invitation email does not arrive and
           -- somebody has to be let in by hand. Sada provisioned this workspace
           -- and can revoke and reissue the invitation at will, so showing it
           -- grants nothing he did not already have. It disappears the moment
           -- the invitation is accepted.
           case when i.accepted_at is null and i.token is not null
                then public.app_base_url() || '/auth?invite=' || i.token
           end
      from public.organizations o
      left join lateral (
        select * from public.invitations inv
         where inv.organization_id = o.id
           and inv.role = 'org_admin'
           and inv.deleted_at is null
           and inv.revoked_at is null
         order by inv.created_at desc
         limit 1
      ) i on true
     where o.deleted_at is null
     order by o.created_at desc;
end $$;

comment on function public.platform_list_organizations is
  'D42 — every customer workspace, by name and count. Discloses nothing about any employee, and no leave, balance or approval data.';

grant execute on function public.platform_list_organizations() to authenticated;

-- ═══════════════════════════════════════════════════════ closing self-serve
--
-- signup_organization existed so that the founder of a brand-new organisation
-- could be granted org_admin despite holding no role yet. That problem is now
-- solved by provisioning, and the function's remaining behaviour — any verified
-- email creates a workspace and administers it — is precisely what has to stop.
--
-- Dropped rather than merely revoked. A SECURITY DEFINER function that creates
-- organisations and grants org_admin is not something to leave lying in the
-- schema with a comment asking people not to grant it.
drop function if exists public.signup_organization(text, text, text);

-- Organisations created before this migration are untouched and keep working.
-- Sada's own workspace from 31 July is one of them.
