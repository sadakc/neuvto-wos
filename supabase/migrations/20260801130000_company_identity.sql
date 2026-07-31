-- ============================================================================
-- NEUVTO WOS — a workspace that looks like the customer's own
--
-- Sada's framing: the platform is the product. A company is provisioned, their
-- administrator is invited, and from there they configure THEIR workspace —
-- their details, their logo, their title. Until now `organizations` held a
-- name, a slug and an `industry_type` that nothing had ever written.
--
-- D45 — company IDENTITY now; company THEMING still deferred.
--
-- Identity is a name and a mark: it makes a workspace recognisably theirs and
-- it belongs in the emails their staff receive. Theming is a colour system, and
-- D15's deferral still holds for a good reason — every colour already resolves
-- through a CSS variable, so adding per-organisation palettes later touches no
-- component. Doing it now would buy a colour picker and a contrast checker
-- before anyone has asked for one.
-- ============================================================================

alter table public.organizations
  add column display_name           text,
  add column logo_path              text,
  add column logo_updated_at        timestamptz,
  add column onboarding_completed_at timestamptz;

comment on column public.organizations.display_name is
  'What the workspace calls itself. `name` is the registered company name — "Acme Security Services Private Limited" belongs on a contract, not in a header.';
comment on column public.organizations.logo_path is
  'Object path in the private org-logos bucket. Never a URL: the bucket is private and reads go through a short-lived signed URL.';
comment on column public.organizations.onboarding_completed_at is
  'D46 — that they chose to finish setup, and nothing else. What is DONE is derived from the data itself.';

alter table public.organizations
  add constraint organizations_display_name_sane
    check (display_name is null or char_length(btrim(display_name)) between 1 and 60);

-- The logo lives under the organisation's own id, so the storage policy is a
-- prefix match and cannot be fooled by a crafted filename.
alter table public.organizations
  add constraint organizations_logo_path_scoped
    check (logo_path is null or logo_path like id::text || '/%');

-- ═══════════════════════════════════════════════ what an admin may change
--
-- `authenticated` held UPDATE on EVERY column of organizations, scoped by RLS to
-- their own row. Two of those columns should never have been reachable:
--
--   slug        the workspace address. Changing it breaks every link anyone has
--               and can collide with another customer.
--   deleted_at  an administrator could SOFT-DELETE THEIR OWN ORGANISATION.
--               Every policy filters `deleted_at is null`, so the workspace
--               would vanish for everyone including them, with no way back that
--               does not involve Neuvto and a SQL prompt.
--
-- Column-level, the same tool as the module grant. Nothing about the RLS policy
-- changes; this decides which columns an UPDATE may even name.
revoke update on public.organizations from authenticated;
grant update (name, display_name, logo_path, logo_updated_at, industry_type,
              onboarding_completed_at)
  on public.organizations to authenticated;

-- ═══════════════════════════════════════════════════════ the logo bucket
--
-- PRIVATE. NEUVTO_SECURITY_POLICY.md:89 says so and it is worth restating why:
-- a public bucket makes every customer's identity enumerable by anyone who can
-- guess a UUID, and "who are Neuvto's customers" is not ours to publish.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'org-logos', 'org-logos', false,
  2 * 1024 * 1024,
  -- No SVG. An SVG is a document that can carry script, and while an <img> tag
  -- will not execute it, anything that ever renders one inline would. A logo is
  -- not worth that, and every design tool exports PNG.
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Tenancy, on storage, by the same rule as every table: the first path segment
-- is the organisation id, and it must be the caller's own.
drop policy if exists "read own organization logo"   on storage.objects;
drop policy if exists "admins write organization logo" on storage.objects;
drop policy if exists "admins replace organization logo" on storage.objects;
drop policy if exists "admins remove organization logo"  on storage.objects;

create policy "read own organization logo" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'org-logos'
    and (storage.foldername(name))[1] = public.current_org_id()::text
  );

create policy "admins write organization logo" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'org-logos'
    and (storage.foldername(name))[1] = public.current_org_id()::text
    and public.is_admin()
  );

create policy "admins replace organization logo" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'org-logos'
    and (storage.foldername(name))[1] = public.current_org_id()::text
    and public.is_admin()
  )
  with check (
    bucket_id = 'org-logos'
    and (storage.foldername(name))[1] = public.current_org_id()::text
  );

create policy "admins remove organization logo" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'org-logos'
    and (storage.foldername(name))[1] = public.current_org_id()::text
    and public.is_admin()
  );

-- ═══════════════════════════════════════════ the name people actually see
--
-- The invitation is the first thing anyone at a new customer receives from this
-- product. It should carry their employer's name as their employer writes it,
-- not the registered entity from a provisioning form.
create or replace function public.organization_display_name(_org_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(nullif(btrim(display_name), ''), name)
    from public.organizations where id = _org_id
$$;

comment on function public.organization_display_name is
  'D45 — what to call this company on screen and in email. Falls back to the registered name.';

grant execute on function public.organization_display_name(uuid) to authenticated;

-- Rebuilt to use it. Everything else about invitation_create is unchanged.
create or replace function public.invitation_create(
  _email     text,
  _phone     text default null,
  _role      public.app_role default 'employee',
  _full_name text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
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

  insert into public.invitations (organization_id, email, phone, role, full_name)
  values (v_org, v_email, nullif(btrim(_phone), ''), _role, nullif(btrim(_full_name), ''))
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
end $$;

comment on function public.invitation_create is
  'D39/D40 — invites somebody into the caller''s organisation, under the name that organisation calls itself (D45).';
