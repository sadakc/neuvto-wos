-- ============================================================================
-- NEUVTO WOS — Neuvto adds and removes a company's Super Admins (D83)
-- ============================================================================
--
-- Until now Neuvto named a company's FIRST administrator at provisioning and
-- then had no say: every later change to who runs the company went through the
-- company's own Super Admin (D78). That leaves no way back when the Super Admin
-- leaves without handing over, or when the customer asks Neuvto to change it.
--
-- Four functions, platform admins only:
--
--   platform_list_super_admins(org)        who holds it, and who is invited to
--   platform_add_super_admin(org, email)   a member is promoted; anybody else
--                                          is invited and becomes one on accepting
--   platform_remove_super_admin(org, user) the role goes; their other roles stay
--   platform_withdraw_super_admin_invite(invitation)
--
-- What this does NOT widen (D42): the console learns the names and emails of a
-- company's Super Admins, which is the same kind of fact it already shows for
-- the first administrator. It still reads no employee record, leave, balance
-- or approval, and it cannot grant any role except super_admin.
--
-- The last Super Admin still stays. keep_a_super_admin (20261011110000) is a
-- trigger, so it refuses Neuvto exactly as it refuses the company. To replace
-- the only one: add the new person, wait for them to accept, then remove.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════ the list

create or replace function public.platform_list_super_admins(_org_id uuid)
returns table (
  kind          text,         -- 'member' or 'invited'
  user_id       uuid,
  invitation_id uuid,
  full_name     text,
  email         text,
  is_active     boolean,
  since         timestamptz,
  invite_url    text
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
  if not exists (select 1 from public.organizations where id = _org_id and deleted_at is null) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  return query
    select 'member'::text, p.id, null::uuid, p.full_name, p.email, p.is_active,
           ur.created_at, null::text
      from public.user_roles ur
      join public.profiles p on p.id = ur.user_id
     where ur.organization_id = _org_id and ur.role = 'super_admin'
       and ur.deleted_at is null
       and p.organization_id = _org_id and p.deleted_at is null
    union all
    select 'invited'::text, null::uuid, i.id, i.full_name, i.email, false,
           i.created_at, public.app_base_url() || '/auth?invite=' || i.token
      from public.invitations i
     where i.organization_id = _org_id and i.role = 'super_admin'
       and i.deleted_at is null and i.revoked_at is null and i.accepted_at is null
     order by 1, 7;
end $$;

comment on function public.platform_list_super_admins is
  'D83 — a company''s Super Admins and pending Super Admin invitations. Names and emails only (D42).';

revoke all on function public.platform_list_super_admins(uuid) from public, anon;
grant execute on function public.platform_list_super_admins(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════ add

create or replace function public.platform_add_super_admin(
  _org_id    uuid,
  _email     text,
  _full_name text default null
)
returns text   -- 'promoted', 'invited' or 'already'
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(_email, '')));
  v_org   public.organizations%rowtype;
  v_p     public.profiles%rowtype;
  v_inv   public.invitations%rowtype;
begin
  if not public.is_platform_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select * into v_org from public.organizations where id = _org_id and deleted_at is null;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'INVALID_EMAIL' using errcode = 'P0001';
  end if;

  -- One person, one workspace (D39). Somebody who belongs elsewhere cannot be
  -- made a Super Admin here by a back door the invitation would refuse anyway.
  if exists (select 1 from public.profiles
              where lower(email) = v_email and organization_id <> _org_id
                and deleted_at is null) then
    raise exception 'EMAIL_IN_ANOTHER_WORKSPACE' using errcode = 'P0001';
  end if;

  -- Already a member: promote.
  select * into v_p from public.profiles
   where lower(email) = v_email and organization_id = _org_id and deleted_at is null;
  if found then
    if not v_p.is_active then
      raise exception 'MEMBER_DEACTIVATED' using errcode = 'P0001',
        hint = 'Reactivate them in the company first.';
    end if;
    if exists (select 1 from public.user_roles
                where user_id = v_p.id and organization_id = _org_id
                  and role = 'super_admin' and deleted_at is null) then
      return 'already';
    end if;
    insert into public.user_roles (user_id, organization_id, role)
    values (v_p.id, _org_id, 'super_admin')
    on conflict (user_id, organization_id, role) do update set deleted_at = null;

    insert into public.analytics_events (organization_id, user_id, event, properties)
    values (_org_id, (select auth.uid()), 'platform.super_admin_added',
            jsonb_build_object('target', v_p.id, 'how', 'promoted'));
    return 'promoted';
  end if;

  -- Invited but not yet arrived: the invitation becomes a Super Admin one. The
  -- link already sent keeps working; it now grants more.
  select * into v_inv from public.invitations
   where organization_id = _org_id and lower(email) = v_email
     and deleted_at is null and revoked_at is null and accepted_at is null;
  if found then
    if v_inv.role = 'super_admin' then
      return 'already';
    end if;
    update public.invitations set role = 'super_admin',
           full_name = coalesce(full_name, nullif(btrim(_full_name), ''))
     where id = v_inv.id;
    insert into public.analytics_events (organization_id, user_id, event, properties)
    values (_org_id, (select auth.uid()), 'platform.super_admin_added',
            jsonb_build_object('invitation', v_inv.id, 'how', 'invitation_upgraded'));
    return 'invited';
  end if;

  -- Nobody yet: invite, exactly as provisioning invites the first one.
  insert into public.invitations (organization_id, email, role, full_name)
  values (_org_id, v_email, 'super_admin', nullif(btrim(_full_name), ''))
  returning * into v_inv;

  perform public.emit_platform_event('member.invited', jsonb_build_object(
    'organization_id',   _org_id,
    'organization_name', v_org.name,
    'inviter_name',      'Neuvto',
    'email',             v_email,
    'full_name',         v_inv.full_name,
    'role',              'super_admin',
    'invite_url',        public.app_base_url() || '/auth?invite=' || v_inv.token,
    'expires_on',        to_char(v_inv.expires_at, 'DD Mon YYYY')
  ));

  insert into public.analytics_events (organization_id, user_id, event, properties)
  values (_org_id, (select auth.uid()), 'platform.super_admin_added',
          jsonb_build_object('invitation', v_inv.id, 'how', 'invited'));
  return 'invited';
end $$;

comment on function public.platform_add_super_admin is
  'D83 — Neuvto makes somebody a company''s Super Admin: promotes a member, upgrades a pending invitation, or invites. Grants no other role.';

revoke all on function public.platform_add_super_admin(uuid, text, text) from public, anon;
grant execute on function public.platform_add_super_admin(uuid, text, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════ remove

create or replace function public.platform_remove_super_admin(_org_id uuid, _user_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  -- keep_a_super_admin raises LAST_SUPER_ADMIN here when this is the only one.
  update public.user_roles set deleted_at = now()
   where organization_id = _org_id and user_id = _user_id
     and role = 'super_admin' and deleted_at is null;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Their other roles stay. Somebody invited straight in as Super Admin holds
  -- no other, and a member with no role at all is a state nothing else in the
  -- product expects, so they keep the base one.
  if not exists (select 1 from public.user_roles
                  where organization_id = _org_id and user_id = _user_id
                    and deleted_at is null) then
    insert into public.user_roles (user_id, organization_id, role)
    values (_user_id, _org_id, 'employee')
    on conflict (user_id, organization_id, role) do update set deleted_at = null;
  end if;

  insert into public.analytics_events (organization_id, user_id, event, properties)
  values (_org_id, (select auth.uid()), 'platform.super_admin_removed',
          jsonb_build_object('target', _user_id));
end $$;

comment on function public.platform_remove_super_admin is
  'D83 — Neuvto removes a company''s Super Admin role from somebody. Other roles stay. Never the last one (trigger).';

revoke all on function public.platform_remove_super_admin(uuid, uuid) from public, anon;
grant execute on function public.platform_remove_super_admin(uuid, uuid) to authenticated;

-- ═══════════════════════════════════════════════════════ withdraw an invite

create or replace function public.platform_withdraw_super_admin_invite(_invitation_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  update public.invitations set revoked_at = now()
   where id = _invitation_id and role = 'super_admin'
     and deleted_at is null and revoked_at is null and accepted_at is null;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
end $$;

comment on function public.platform_withdraw_super_admin_invite is
  'D83 — Neuvto withdraws a pending Super Admin invitation. Only Super Admin ones: the company''s own invitations are the company''s.';

revoke all on function public.platform_withdraw_super_admin_invite(uuid) from public, anon;
grant execute on function public.platform_withdraw_super_admin_invite(uuid) to authenticated;
