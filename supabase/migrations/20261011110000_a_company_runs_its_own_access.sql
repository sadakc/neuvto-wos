-- ============================================================================
-- NEUVTO WOS — a company runs its own access, and only a Super Admin hands out
-- administrator rights (D78)
-- ============================================================================
--
-- Sada, 11 Oct 2026: when he names somebody at a customer as its administrator,
-- that person must be able to make their own colleagues administrators. And
-- only that tier may: an Admin runs HR and does not hand out admin rights.
--
-- What was true until now, and why it was not good enough:
--
--   Four phase-0 policies let any `is_admin()` INSERT, UPDATE or DELETE any
--   `user_roles` row in their organisation. So an `hr_admin` could make
--   themselves, or anybody, an `org_admin` with one PostgREST call, and the
--   People screen offered no way to change a role at all after invitation. The
--   rule existed in nobody's head and the database allowed everything.
--
-- What this does:
--
--   1. `is_super_admin()`; `is_admin()` and `is_approver_role()` include it.
--   2. `member_set_roles()` becomes the ONLY writer of `user_roles` for a
--      signed-in person. The four direct-write policies are dropped and the
--      table write grants revoked, because a role on a table a user can write
--      is the privilege-escalation hole D4 exists to prevent. GRANT and RLS are
--      separate layers (D65); both are closed.
--   3. Administrator-tier roles (super_admin, org_admin, hr_admin,
--      payroll_officer, statutory_officer) are granted and removed only by a
--      Super Admin, in `member_set_roles` and in `invitation_create` alike. An
--      invitation is a role grant that arrives later.
--   4. Nobody changes their own roles.
--   5. The last Super Admin cannot be removed or deactivated. Enforced by
--      triggers, not by the function, so every path is covered: a role change,
--      `deactivate_employee`, `erase_employee`, anything written later.
--   6. An organisation with no Super Admin makes its first Administrator one.
--      A trigger, so the administrator Sada names at provisioning becomes Super
--      Admin when they ACCEPT, through the existing acceptance path, with no
--      change to provisioning, the console or invitations.
--   7. Every existing organisation gets one: the person who accepted its
--      earliest administrator invitation (which is provisioning's), and failing
--      that, its longest-standing active administrator.
--
-- What it does not do: revoke sessions on a role change. Nothing has to,
-- because every policy and function reads `user_roles` at query time, so a
-- removed role stops working on the person's next request.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════ who is what

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role((select auth.uid()), 'super_admin')
$$;

comment on function public.is_super_admin is
  'D78 — the caller holds super_admin in their current organisation. The only tier that grants administrator roles.';

revoke all on function public.is_super_admin() from public, anon;
grant execute on function public.is_super_admin() to authenticated;

-- A Super Admin is an administrator. Everything that asks `is_admin()` (People,
-- Settings, reports, every admin RPC) now answers yes for them, so a Super
-- Admin who holds nothing else is not locked out of the workspace they run.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role((select auth.uid()), 'super_admin')
      or public.has_role((select auth.uid()), 'org_admin')
      or public.has_role((select auth.uid()), 'hr_admin')
$$;

-- Payroll and Statutory are deliberately NOT here. They read data; they do not
-- approve anybody's leave.
create or replace function public.is_approver_role(_role public.app_role)
returns boolean
language sql
immutable
set search_path = public
as $$
  select _role in ('super_admin', 'org_admin', 'hr_admin', 'manager', 'supervisor', 'coordinator')
$$;

/** The roles only a Super Admin may grant or take away. */
create or replace function public.is_reserved_for_super_admin(_role public.app_role)
returns boolean
language sql
immutable
set search_path = public
as $$
  select _role in ('super_admin', 'org_admin', 'hr_admin', 'payroll_officer', 'statutory_officer')
$$;

comment on function public.is_reserved_for_super_admin is
  'D78 — administrator-tier roles, and the two data grants (D80). Granted and removed by a Super Admin only.';

revoke all on function public.is_reserved_for_super_admin(public.app_role) from public, anon;
grant execute on function public.is_reserved_for_super_admin(public.app_role) to authenticated;

/** Active Super Admins in an organisation, optionally not counting one person. */
create or replace function public.active_super_admin_count(_org uuid, _except uuid default null)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
    from public.user_roles ur
    join public.profiles p on p.id = ur.user_id
   where ur.organization_id = _org
     and ur.role = 'super_admin'
     and ur.deleted_at is null
     and p.organization_id = _org
     and p.deleted_at is null
     and p.is_active
     and (_except is null or ur.user_id <> _except)
$$;

-- Internal. Called by the triggers below, which run as definer.
revoke all on function public.active_super_admin_count(uuid, uuid) from public, anon, authenticated;

-- ═══════════════════════════════════════════════ the last Super Admin stays

create or replace function public.tf_user_roles_keep_a_super_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.role = 'super_admin' and old.deleted_at is null
     and (new.deleted_at is not null or new.role <> 'super_admin')
     and public.active_super_admin_count(old.organization_id, old.user_id) = 0 then
    raise exception 'LAST_SUPER_ADMIN' using errcode = 'P0001',
      hint = 'Make somebody else a Super Admin first.';
  end if;
  return new;
end $$;

-- UPDATE only, deliberately. Removing a role in this product is a soft delete,
-- and nobody signed in can hard-DELETE a role row at all (the grant is revoked
-- above). The only hard delete left is an operator's, removing a whole
-- workspace (operations/TEST_DATA_PURGE.md), and refusing that would make a
-- workspace undeletable. verify_rls.sql's own cleanup found this on the first
-- run, when the guard covered DELETE too.
revoke all on function public.tf_user_roles_keep_a_super_admin() from public, anon, authenticated;

drop trigger if exists keep_a_super_admin on public.user_roles;
create trigger keep_a_super_admin
  before update on public.user_roles
  for each row execute function public.tf_user_roles_keep_a_super_admin();

create or replace function public.tf_profiles_keep_a_super_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if ((old.is_active and not new.is_active)
      or (old.deleted_at is null and new.deleted_at is not null))
     and exists (select 1 from public.user_roles
                  where user_id = old.id and organization_id = old.organization_id
                    and role = 'super_admin' and deleted_at is null)
     and public.active_super_admin_count(old.organization_id, old.id) = 0 then
    raise exception 'LAST_SUPER_ADMIN' using errcode = 'P0001',
      hint = 'Make somebody else a Super Admin before deactivating them.';
  end if;
  return new;
end $$;

revoke all on function public.tf_profiles_keep_a_super_admin() from public, anon, authenticated;

drop trigger if exists keep_a_super_admin on public.profiles;
create trigger keep_a_super_admin
  before update of is_active, deleted_at on public.profiles
  for each row execute function public.tf_profiles_keep_a_super_admin();

-- ═════════════════════════════ the first Administrator is the Super Admin

create or replace function public.tf_first_administrator_is_super_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role = 'org_admin' and new.deleted_at is null
     and not exists (select 1 from public.user_roles
                      where organization_id = new.organization_id
                        and role = 'super_admin' and deleted_at is null) then
    insert into public.user_roles (user_id, organization_id, role)
    values (new.user_id, new.organization_id, 'super_admin')
    on conflict (user_id, organization_id, role) do update set deleted_at = null;
  end if;
  return new;
end $$;

revoke all on function public.tf_first_administrator_is_super_admin() from public, anon, authenticated;

drop trigger if exists first_administrator_is_super_admin on public.user_roles;
create trigger first_administrator_is_super_admin
  after insert on public.user_roles
  for each row execute function public.tf_first_administrator_is_super_admin();

-- ═══════════════════════════════════════════════════════════ the backfill

-- 1. The administrator Neuvto named: whoever accepted the organisation's
--    earliest administrator invitation, which provisioning creates first.
insert into public.user_roles (user_id, organization_id, role)
select distinct on (i.organization_id) p.id, i.organization_id, 'super_admin'
  from public.invitations i
  join public.profiles p
    on p.organization_id = i.organization_id and lower(p.email) = i.email
 where i.role = 'org_admin'
   and i.accepted_at is not null
   and i.deleted_at is null
   and p.deleted_at is null
   and p.is_active
   and exists (select 1 from public.user_roles ur
                where ur.user_id = p.id and ur.organization_id = i.organization_id
                  and ur.role = 'org_admin' and ur.deleted_at is null)
   and not exists (select 1 from public.user_roles s
                    where s.organization_id = i.organization_id
                      and s.role = 'super_admin' and s.deleted_at is null)
 order by i.organization_id, i.created_at
on conflict (user_id, organization_id, role) do update set deleted_at = null;

-- 2. Any organisation still without one (created before invitations existed):
--    its longest-standing active administrator.
insert into public.user_roles (user_id, organization_id, role)
select distinct on (ur.organization_id) ur.user_id, ur.organization_id, 'super_admin'
  from public.user_roles ur
  join public.profiles p on p.id = ur.user_id
 where ur.role = 'org_admin'
   and ur.deleted_at is null
   and p.deleted_at is null
   and p.is_active
   and not exists (select 1 from public.user_roles s
                    where s.organization_id = ur.organization_id
                      and s.role = 'super_admin' and s.deleted_at is null)
 order by ur.organization_id, ur.created_at
on conflict (user_id, organization_id, role) do update set deleted_at = null;

-- ═════════════════════════════════════ one writer of user_roles, not four

drop policy if exists "admins grant roles" on public.user_roles;
drop policy if exists "admins revoke roles" on public.user_roles;
drop policy if exists "admins delete roles" on public.user_roles;
revoke insert, update, delete on public.user_roles from authenticated;

create or replace function public.member_set_roles(_user_id uuid, _roles public.app_role[])
returns public.app_role[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org   uuid := public.current_org_id();
  v_actor uuid := (select auth.uid());
  v_want  public.app_role[];
  v_role  public.app_role;
begin
  if v_actor is null or v_org is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  -- A Super Admin promotes other people. Letting anybody edit their own row is
  -- how a role table becomes a self-service escalation.
  if _user_id = v_actor then
    raise exception 'CANNOT_CHANGE_OWN_ROLES' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.profiles
                  where id = _user_id and organization_id = v_org and deleted_at is null) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Everybody is at least an employee. An empty set means exactly that.
  select coalesce(array_agg(distinct r order by r), '{employee}')
    into v_want
    from unnest(coalesce(_roles, '{}')) r;

  -- Every change, in either direction, must be one this caller may make.
  -- Checked per role, before anything is written: a set that mixes one
  -- permitted change with one forbidden one is refused whole.
  for v_role in
    select x from (
      (select unnest(v_want)
        except
       select role from public.user_roles
        where user_id = _user_id and organization_id = v_org and deleted_at is null)
      union
      (select role from public.user_roles
        where user_id = _user_id and organization_id = v_org and deleted_at is null
        except
       select unnest(v_want))
    ) changed(x)
  loop
    if public.is_reserved_for_super_admin(v_role) and not public.is_super_admin() then
      raise exception 'ROLE_NOT_YOURS_TO_GRANT' using errcode = '42501', detail = v_role::text;
    end if;
  end loop;

  -- D57 from the other side: somebody people report to must keep a role that
  -- approves, or their reports' requests resolve to nobody.
  if exists (select 1 from public.profiles
              where manager_id = _user_id and organization_id = v_org
                and deleted_at is null and is_active)
     and not exists (select 1 from unnest(v_want) r where public.is_approver_role(r)) then
    raise exception 'STILL_HAS_REPORTS' using errcode = 'P0001';
  end if;

  -- Removed roles are soft-deleted, so the audit log keeps who held what and
  -- when. The keep_a_super_admin trigger refuses removing the last one.
  update public.user_roles
     set deleted_at = now()
   where user_id = _user_id and organization_id = v_org and deleted_at is null
     and role <> all (v_want);

  -- Added, or restored: the unique key ignores deleted_at, so a role held once
  -- before comes back by clearing the stamp rather than a second row.
  insert into public.user_roles (user_id, organization_id, role)
  select _user_id, v_org, r from unnest(v_want) r
  on conflict (user_id, organization_id, role)
  do update set deleted_at = null where public.user_roles.deleted_at is not null;

  return v_want;
end $$;

comment on function public.member_set_roles is
  'D78 — the only way a signed-in person changes anybody''s roles. Sets the whole set; administrator-tier roles need a Super Admin; never your own; the last Super Admin stays (trigger); somebody with reports keeps an approver role (D57).';

revoke all on function public.member_set_roles(uuid, public.app_role[]) from public, anon;
grant execute on function public.member_set_roles(uuid, public.app_role[]) to authenticated;

-- ═══════════════════════════════════ an invitation is a grant that arrives later

-- Reproduced from 20260817100000_a_person_has_a_name.sql, which is the current
-- definition. The diff is the ROLE_NOT_YOURS_TO_GRANT block after FORBIDDEN.
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
end $function$;

-- ═══════════════════════════════════════════ shorter sessions for the sensitive

-- Reproduced from 20260813100000_session_policy.sql. The diff: the three new
-- roles get the organisation's (short) idle setting. A Statutory officer can
-- reveal an Aadhaar number; they get the admin's session, not an employee's.
create or replace function public.session_policy()
returns table (idle_minutes integer, absolute_hours integer)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;

  if public.is_platform_admin() then
    return query select 30, 8;
    return;
  end if;

  v_org := public.current_org_id();
  if v_org is null then
    return query select 30, 8;
    return;
  end if;

  return query
  select
    case
      when exists (
        select 1 from public.user_roles ur
         where ur.user_id = v_uid
           and ur.organization_id = v_org
           and ur.deleted_at is null
           and ur.role in ('super_admin', 'org_admin', 'hr_admin', 'manager',
                           'payroll_officer', 'statutory_officer')
      ) then s.session_idle_minutes
      else greatest(s.session_idle_minutes, 480)
    end,
    s.session_absolute_hours
  from public.organization_settings s
  where s.organization_id = v_org;

  if not found then
    return query select 30, 24;
  end if;
end $function$;
