-- NEUVTO WOS — Neuvto adds and removes a company's Super Admins (D83)
--
-- Raises on the first violation. Silence means pass. Rolled back.
--
-- PHASE-AWARE: exits quietly if platform_add_super_admin does not exist yet.
--
-- Requires seed_test_data.sql. Alice (Acme) and Bob (Vertex) are Super Admins
-- because the first_administrator_is_super_admin trigger made them so when the
-- seed gave them org_admin; verify_company_access.sql proves that part.

begin;

create or replace function pg_temp.ps_as(_uid uuid) returns void as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', _uid::text, 'role', 'authenticated')::text, true);
end $$ language plpgsql;

create or replace function pg_temp.ps_root() returns void as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$ language plpgsql;

create or replace function pg_temp.ps_refused(_label text, _uid uuid, _sql text, _needle text)
returns void as $$
declare v_msg text;
begin
  perform pg_temp.ps_as(_uid);
  begin
    execute _sql;
  exception when others then
    v_msg := sqlerrm;
  end;
  perform pg_temp.ps_root();
  if v_msg is null then
    raise exception 'PLATFORM-SUPER-ADMIN FAIL: % — it was allowed', _label;
  end if;
  if v_msg not ilike '%' || _needle || '%' then
    raise exception 'PLATFORM-SUPER-ADMIN FAIL: % — refused for the wrong reason: %', _label, v_msg;
  end if;
  raise notice 'ok: %', _label;
end $$ language plpgsql;

create or replace function pg_temp.ps_add(_staff uuid, _org uuid, _email text) returns text as $$
declare v text;
begin
  perform pg_temp.ps_as(_staff);
  v := public.platform_add_super_admin(_org, _email, null);
  perform pg_temp.ps_root();
  return v;
end $$ language plpgsql;

create or replace function pg_temp.ps_holds(_uid uuid, _role text) returns boolean as $$
  select exists (select 1 from public.user_roles
                  where user_id = _uid and role::text = _role and deleted_at is null)
$$ language sql;

do $$
declare
  acme   uuid := '00000000-0000-0000-0000-0000000000a0';
  vertex uuid := '00000000-0000-0000-0000-0000000000b0';
  alice  uuid := '00000000-0000-0000-0000-00000000a001';
  ravi   uuid := '00000000-0000-0000-0000-00000000a005';
  priya  uuid := '00000000-0000-0000-0000-00000000a006';
  staff  uuid := '00000000-0000-0000-0000-0000000000f5';
  v      text;
  inv    uuid;
  n      integer;
begin
  if to_regprocedure('public.platform_add_super_admin(uuid,text,text)') is null then
    raise notice 'skip: Neuvto cannot name Super Admins yet';
    return;
  end if;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at,
                          raw_app_meta_data, raw_user_meta_data)
  values (staff, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'staff@platform-super.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  insert into public.platform_admins (user_id, note) values (staff, 'harness');

  if not pg_temp.ps_holds(alice, 'super_admin') then
    raise exception 'PLATFORM-SUPER-ADMIN FAIL: precondition — Alice is not a Super Admin';
  end if;

  -- ── 1 · only Neuvto staff, not even the company's own Super Admin
  perform pg_temp.ps_refused('a company Super Admin cannot use the console''s add', alice,
    format('select public.platform_add_super_admin(%L, ''ravi.emp@acme.test'')', acme), 'FORBIDDEN');
  perform pg_temp.ps_refused('nor its remove', alice,
    format('select public.platform_remove_super_admin(%L, %L)', vertex,
           '00000000-0000-0000-0000-00000000b001'), 'FORBIDDEN');
  perform pg_temp.ps_refused('nor its list', ravi,
    format('select * from public.platform_list_super_admins(%L)', acme), 'FORBIDDEN');

  -- ── 2 · a member is promoted, once
  v := pg_temp.ps_add(staff, acme, ' Priya.Emp@Acme.test ');
  if v <> 'promoted' or not pg_temp.ps_holds(priya, 'super_admin') then
    raise exception 'PLATFORM-SUPER-ADMIN FAIL: promoting Priya returned % and she holds it: %',
      v, pg_temp.ps_holds(priya, 'super_admin');
  end if;
  if not pg_temp.ps_holds(priya, 'employee') then
    raise exception 'PLATFORM-SUPER-ADMIN FAIL: promotion took her other roles';
  end if;
  raise notice 'ok: a member is promoted, matched case- and space-insensitively';
  if pg_temp.ps_add(staff, acme, 'priya.emp@acme.test') <> 'already' then
    raise exception 'PLATFORM-SUPER-ADMIN FAIL: promoting twice was not "already"';
  end if;
  raise notice 'ok: promoting twice changes nothing';

  -- ── 3 · somebody new is invited as a Super Admin
  v := pg_temp.ps_add(staff, acme, 'new.boss@acme.test');
  select id into inv from public.invitations
   where organization_id = acme and email = 'new.boss@acme.test'
     and role = 'super_admin' and revoked_at is null;
  if v <> 'invited' or inv is null then
    raise exception 'PLATFORM-SUPER-ADMIN FAIL: inviting returned % and invitation %', v, inv;
  end if;
  perform pg_temp.ps_as(staff);
  select count(*) into n from public.platform_list_super_admins(acme);
  perform pg_temp.ps_root();
  if n <> 3 then
    raise exception 'PLATFORM-SUPER-ADMIN FAIL: the list has % rows, expected Alice, Priya and the invite', n;
  end if;
  raise notice 'ok: somebody new is invited, and the list shows them pending';

  -- A pending ordinary invitation is upgraded, not duplicated.
  insert into public.invitations (organization_id, email, role) values (acme, 'temp@acme.test', 'employee');
  -- Two statements, not one: a single expression reads the table in the
  -- snapshot taken before ps_add wrote to it.
  v := pg_temp.ps_add(staff, acme, 'temp@acme.test');
  if v <> 'invited'
     or not exists (select 1 from public.invitations where email = 'temp@acme.test'
                     and role = 'super_admin' and revoked_at is null) then
    raise exception 'PLATFORM-SUPER-ADMIN FAIL: a pending invitation was not upgraded';
  end if;
  raise notice 'ok: a pending invitation is upgraded in place';

  -- ── 4 · refusals
  perform pg_temp.ps_refused('somebody in another company cannot be made one here', staff,
    format('select public.platform_add_super_admin(%L, ''bob.admin@vertex.test'')', acme),
    'EMAIL_IN_ANOTHER_WORKSPACE');
  perform pg_temp.ps_refused('a malformed email is refused', staff,
    format('select public.platform_add_super_admin(%L, ''not-an-email'')', acme), 'INVALID_EMAIL');
  perform pg_temp.ps_refused('an unknown company is NOT_FOUND', staff,
    format('select public.platform_add_super_admin(%L, ''x@y.test'')', gen_random_uuid()), 'NOT_FOUND');
  update public.profiles set is_active = false where id = ravi;
  perform pg_temp.ps_refused('a deactivated member is not promoted', staff,
    format('select public.platform_add_super_admin(%L, ''ravi.emp@acme.test'')', acme),
    'MEMBER_DEACTIVATED');
  update public.profiles set is_active = true where id = ravi;

  -- ── 5 · withdrawing: Super Admin invitations only
  perform pg_temp.ps_as(staff);
  perform public.platform_withdraw_super_admin_invite(inv);
  perform pg_temp.ps_root();
  if not exists (select 1 from public.invitations where id = inv and revoked_at is not null) then
    raise exception 'PLATFORM-SUPER-ADMIN FAIL: the invitation was not withdrawn';
  end if;
  raise notice 'ok: a pending Super Admin invitation is withdrawn';
  perform pg_temp.ps_refused('withdrawing twice is NOT_FOUND', staff,
    format('select public.platform_withdraw_super_admin_invite(%L)', inv), 'NOT_FOUND');
  insert into public.invitations (organization_id, email, role)
  values (acme, 'ordinary@acme.test', 'employee') returning id into inv;
  perform pg_temp.ps_refused('the company''s own invitations are not Neuvto''s to withdraw', staff,
    format('select public.platform_withdraw_super_admin_invite(%L)', inv), 'NOT_FOUND');

  -- ── 6 · removing: the role goes, the person keeps a role
  update public.user_roles set deleted_at = now()
   where user_id = priya and role = 'employee';  -- now she holds super_admin alone
  perform pg_temp.ps_as(staff);
  perform public.platform_remove_super_admin(acme, priya);
  perform pg_temp.ps_root();
  if pg_temp.ps_holds(priya, 'super_admin') or not pg_temp.ps_holds(priya, 'employee') then
    raise exception 'PLATFORM-SUPER-ADMIN FAIL: removal left super_admin=% employee=%',
      pg_temp.ps_holds(priya, 'super_admin'), pg_temp.ps_holds(priya, 'employee');
  end if;
  raise notice 'ok: removing takes the role and leaves them a member';
  perform pg_temp.ps_refused('removing somebody who is not one is NOT_FOUND', staff,
    format('select public.platform_remove_super_admin(%L, %L)', acme, priya), 'NOT_FOUND');
  perform pg_temp.ps_refused('the wrong company is NOT_FOUND', staff,
    format('select public.platform_remove_super_admin(%L, %L)', vertex, alice), 'NOT_FOUND');

  -- ── 7 · the last one stays, even for Neuvto
  perform pg_temp.ps_refused('Neuvto cannot remove the last Super Admin either', staff,
    format('select public.platform_remove_super_admin(%L, %L)', acme, alice), 'LAST_SUPER_ADMIN');
end $$;

rollback;
