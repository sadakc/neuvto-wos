-- NEUVTO WOS — adding people and letting them go (E8)
--
-- Raises on the first violation. Silence means pass. Rolled back.
--
-- PHASE-AWARE: exits quietly if employee_create_draft does not exist yet.
--
-- The stage's acceptance criteria: an incomplete record can be invited, and
-- deactivating closes the open posting and says what it did (criterion 10).
-- Plus the record surviving the whole path: draft, invitation, acceptance,
-- with one record throughout, never two.

begin;

create or replace function pg_temp.lc_as(_uid uuid) returns void as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', _uid::text, 'role', 'authenticated')::text, true);
end $$ language plpgsql;

create or replace function pg_temp.lc_root() returns void as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$ language plpgsql;

create or replace function pg_temp.lc_refused(_label text, _uid uuid, _sql text, _needle text)
returns void as $$
declare v_msg text;
begin
  perform pg_temp.lc_as(_uid);
  begin
    execute _sql;
  exception when others then
    v_msg := sqlerrm;
  end;
  perform pg_temp.lc_root();
  if v_msg is null then
    raise exception 'LIFECYCLE FAIL: % — it was allowed', _label;
  end if;
  if v_msg not ilike '%' || _needle || '%' then
    raise exception 'LIFECYCLE FAIL: % — refused for the wrong reason: %', _label, v_msg;
  end if;
  raise notice 'ok: %', _label;
end $$ language plpgsql;

create or replace function pg_temp.lc_json(_uid uuid, _sql text) returns jsonb as $$
declare v jsonb;
begin
  perform pg_temp.lc_as(_uid);
  execute _sql into v;
  perform pg_temp.lc_root();
  return v;
exception when others then
  perform pg_temp.lc_root();
  raise exception 'LIFECYCLE FAIL: refused: % — %', _sql, sqlerrm;
end $$ language plpgsql;

create or replace function pg_temp.lc_do(_uid uuid, _sql text) returns void as $$
begin
  perform pg_temp.lc_as(_uid);
  execute _sql;
  perform pg_temp.lc_root();
exception when others then
  perform pg_temp.lc_root();
  raise exception 'LIFECYCLE FAIL: refused: % — %', _sql, sqlerrm;
end $$ language plpgsql;

do $$
declare
  acme   uuid := '00000000-0000-0000-0000-0000000000a0';
  alice  uuid := '00000000-0000-0000-0000-00000000a001';  -- Super Admin
  hema   uuid := '00000000-0000-0000-0000-00000000a002';  -- Admin
  mark   uuid := '00000000-0000-0000-0000-00000000a004';  -- a manager
  ravi   uuid := '00000000-0000-0000-0000-00000000a005';
  priya  uuid := '00000000-0000-0000-0000-00000000a006';
  ops    uuid := '00000000-0000-0000-0000-0000000000d1';  -- Operations
  newbie uuid := '00000000-0000-0000-0000-0000000000e1';
  d      uuid;   -- the draft
  d2     uuid;
  inv    public.invitations%rowtype;
  unit   uuid;
  e_ravi uuid;
  e_priya uuid;
  c      jsonb;
  r      jsonb;
  n      integer;
  drafts0 integer;
  gone   uuid;
begin
  if to_regprocedure('public.employee_create_draft(jsonb)') is null then
    raise notice 'skip: drafts do not exist yet';
    return;
  end if;

  insert into public.organization_modules (organization_id, module_key, enabled, enabled_at)
  values (acme, 'employee', true, now())
  on conflict (organization_id, module_key) do update set enabled = true, deleted_at = null;
  insert into public.deployment_units (organization_id, name, unit_type)
  values (acme, 'Acme HQ', 'own_establishment') returning id into unit;
  select id into e_ravi from public.employees where profile_id = ravi;
  select id into e_priya from public.employees where profile_id = priya;

  -- ── 1 · a draft: only an Admin starts one, and it needs only a name
  perform pg_temp.lc_refused('an employee cannot start a record', ravi,
    $q$select public.employee_create_draft('{"fullName":"Nisha"}')$q$, 'FORBIDDEN');
  perform pg_temp.lc_refused('a record needs a name', hema,
    $q$select public.employee_create_draft('{"email":"x@acme.test"}')$q$, 'NAME_REQUIRED');
  perform pg_temp.lc_refused('a member''s email is refused', hema,
    $q$select public.employee_create_draft('{"fullName":"X","email":"Ravi.Emp@acme.test"}')$q$, 'ALREADY_A_MEMBER');
  perform pg_temp.lc_refused('a manager who cannot approve is refused', hema,
    format($q$select public.employee_create_draft(jsonb_build_object('fullName','X','managerId',%L))$q$, ravi),
    'MANAGER_CANNOT_APPROVE');

  -- Other suites leave records behind; count from here, not from zero.
  drafts0 := (pg_temp.lc_json(hema, 'select public.employee_admin_overview()') ->> 'drafts')::int;
  d := (pg_temp.lc_json(hema, format($q$select to_jsonb(public.employee_create_draft(jsonb_build_object(
    'fullName','Nisha Rao','email','Nisha.Rao@acme.test','phone','+91 90000 11111',
    'joinedDate','2026-11-01','departmentId',%L,'managerId',%L)))$q$, ops, mark)) #>> '{}')::uuid;
  perform pg_temp.lc_refused('the same email twice as drafts is refused', hema,
    $q$select public.employee_create_draft('{"fullName":"Y","email":"nisha.rao@acme.test"}')$q$, 'ALREADY_A_DRAFT');
  d2 := (pg_temp.lc_json(hema, $q$select to_jsonb(public.employee_create_draft('{"fullName":"No Email Yet"}'))$q$) #>> '{}')::uuid;
  raise notice 'ok: an Admin starts a record with only a name, and duplicates are refused';

  c := pg_temp.lc_json(hema, format('select public.employee_card(%L)', d));
  if c ->> 'stage' is distinct from 'draft' or c ->> 'fullName' is distinct from 'Nisha Rao' or c ->> 'workEmail' is distinct from 'nisha.rao@acme.test'
     or c -> 'department' ->> 'name' is distinct from 'Operations' or c -> 'reportsTo' ->> 'fullName' is distinct from 'Mark Manager'
     or (c -> 'capabilities' ->> 'canSendInvite')::boolean is not true then
    raise exception 'LIFECYCLE FAIL: the draft''s card reads %', c;
  end if;
  raise notice 'ok: a draft''s card carries its name, department and manager';

  -- Drafts are the Admin's alone.
  perform pg_temp.lc_refused('a colleague cannot open a draft''s card', ravi,
    format('select public.employee_card(%L)', d), 'NOT_FOUND');
  -- A colleague cannot read the directory at all (D108), drafts or not.
  perform pg_temp.lc_refused('a colleague cannot list a draft in the directory', ravi,
    'select * from public.employee_directory(null)', 'FORBIDDEN');
  perform pg_temp.lc_as(hema);
  select count(*) into n from public.employee_directory('nisha') x where x.id = d and x.stage = 'draft';
  perform pg_temp.lc_root();
  if n <> 1 then raise exception 'LIFECYCLE FAIL: the Admin cannot find the draft'; end if;
  raise notice 'ok: a draft is visible to Admins only';

  -- The record's own writers work on a draft.
  perform pg_temp.lc_do(hema, format($q$select public.employee_move_unit(%L, jsonb_build_object(
    'unitId', %L, 'effectiveFrom', '2026-11-01', 'orderRef', 'DO-NEW-1'))$q$, d, unit));
  perform pg_temp.lc_do(hema, format($q$select public.employee_update_draft(%L, '{"fullName":"Nisha R. Rao"}')$q$, d));
  raise notice 'ok: a draft can be deployed and corrected before anybody is invited';

  -- ── 2 · an incomplete record can be invited (E8's criterion)
  perform pg_temp.lc_refused('no email, no invitation', hema,
    format('select public.employee_send_invite(%L)', d2), 'EMAIL_REQUIRED');
  perform pg_temp.lc_refused('an employee cannot send it', ravi,
    format('select public.employee_send_invite(%L)', d), 'FORBIDDEN');
  perform pg_temp.lc_refused('an Admin cannot invite an Admin (D78)', hema,
    format($q$select public.employee_send_invite(%L, 'org_admin')$q$, d), 'ROLE_NOT_YOURS_TO_GRANT');
  perform pg_temp.lc_do(hema, format('select public.employee_send_invite(%L)', d));
  -- D110: the record is the one way in. Inviting from it leaves no opening
  -- behind it, and the invite function on its own refuses even an Admin.
  perform pg_temp.lc_refused('nobody invites except from a record', hema,
    $q$select public.invitation_create('round.the.record@acme.test', null, 'employee', 'Round It')$q$,
    'INVITE_FROM_THE_RECORD');
  select i.* into inv from public.invitations i join public.employees e on e.invitation_id = i.id where e.id = d;
  if inv.email <> 'nisha.rao@acme.test' or inv.full_name <> 'Nisha R. Rao' or inv.joined_date <> '2026-11-01'
     or inv.department_id <> ops or inv.manager_email <> 'mark.manager@acme.test' then
    raise exception 'LIFECYCLE FAIL: the invitation did not carry the draft: %', to_jsonb(inv);
  end if;
  select count(*) into n from public.employees
   where id = d and (draft_full_name is not null or draft_email is not null or draft_manager_id is not null);
  if n <> 0 then raise exception 'LIFECYCLE FAIL: the draft kept a second copy of its details'; end if;
  c := pg_temp.lc_json(hema, format('select public.employee_card(%L)', d));
  if c ->> 'stage' is distinct from 'invited' or c ->> 'fullName' is distinct from 'Nisha R. Rao' then
    raise exception 'LIFECYCLE FAIL: the invited card reads %', c;
  end if;
  perform pg_temp.lc_refused('an invited record is no longer a draft', hema,
    format($q$select public.employee_update_draft(%L, '{"fullName":"Z"}')$q$, d), 'NO_LONGER_A_DRAFT');
  perform pg_temp.lc_refused('nor is it invited twice', hema,
    format('select public.employee_send_invite(%L)', d), 'NO_LONGER_A_DRAFT');
  raise notice 'ok: an incomplete record is invited, and its details move onto the invitation';

  -- ── 3 · accepting claims the record; it never becomes two
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values (newbie, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'nisha.rao@acme.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  perform pg_temp.lc_do(newbie, format('select public.invitation_accept(%L)', inv.token));
  select count(*) into n from public.employees where profile_id = newbie;
  if n <> 1 or not exists (select 1 from public.employees where id = d and profile_id = newbie) then
    raise exception 'LIFECYCLE FAIL: accepting made % records, or not the drafted one', n;
  end if;
  if not exists (select 1 from public.employee_deployments where employee_id = d and effective_to is null) then
    raise exception 'LIFECYCLE FAIL: the posting made on the draft was lost on acceptance';
  end if;
  raise notice 'ok: accepting claims the drafted record, posting and all';

  -- ── 4 · letting go (criterion 10)
  perform pg_temp.lc_do(hema, format($q$select public.employee_move_unit(%L, jsonb_build_object(
    'unitId', %L, 'effectiveFrom', '2025-01-01', 'orderRef', 'DO-R-1'))$q$, e_ravi, unit));
  r := pg_temp.lc_json(hema, format('select public.employee_deactivation_preview(%L)', e_ravi));
  if r -> 'openPosting' ->> 'unitName' is distinct from 'Acme HQ'
     or exists (select 1 from jsonb_array_elements(r -> 'successors') x where x ->> 'profileId' = ravi::text)
     or not exists (select 1 from jsonb_array_elements(r -> 'successors') x where x ->> 'profileId' = mark::text)
     or exists (select 1 from jsonb_array_elements(r -> 'successors') x where x ->> 'profileId' = priya::text) then
    raise exception 'LIFECYCLE FAIL: the preview reads %', r;
  end if;
  perform pg_temp.lc_refused('only an Admin previews a deactivation', priya,
    format('select public.employee_deactivation_preview(%L)', e_ravi), 'FORBIDDEN');
  raise notice 'ok: the preview names the posting and offers only people who can approve, never the person';

  perform pg_temp.lc_refused('deactivating needs a reason', hema,
    format($q$select public.employee_deactivate(%L, %L, '2026-10-10', '')$q$, e_ravi, mark), 'REASON_REQUIRED');
  perform pg_temp.lc_refused('and a last working day', hema,
    format($q$select public.employee_deactivate(%L, %L, null, 'Resigned')$q$, e_ravi, mark), 'LAST_DAY_REQUIRED');
  perform pg_temp.lc_refused('an employee cannot deactivate anybody', priya,
    format($q$select public.employee_deactivate(%L, %L, '2026-10-10', 'Resigned')$q$, e_ravi, mark), 'FORBIDDEN');
  perform pg_temp.lc_refused('a draft is not deactivated, its invitation is revoked', hema,
    format($q$select public.employee_deactivate(%L, %L, '2026-10-10', 'Resigned')$q$, d2, mark), 'NOT_SIGNED_IN_YET');

  r := pg_temp.lc_json(hema, format($q$select public.employee_deactivate(%L, %L, '2026-10-10', 'Resigned')$q$, e_ravi, mark));
  if r -> 'postingClosed' ->> 'lastDay' is distinct from '2026-10-10' or r -> 'postingClosed' ->> 'unitName' is distinct from 'Acme HQ'
     or r ->> 'status' is distinct from 'left' or not (r ? 'reports_moved') then
    raise exception 'LIFECYCLE FAIL: deactivation reported %', r;
  end if;
  if exists (select 1 from public.employee_deployments where employee_id = e_ravi and effective_to is null)
     or not exists (select 1 from public.employees where id = e_ravi and status = 'left'
                     and termination_date = '2026-10-10' and termination_reason = 'Resigned')
     or exists (select 1 from public.profiles where id = ravi and is_active) then
    raise exception 'LIFECYCLE FAIL: deactivation did not do what it reported';
  end if;
  raise notice 'ok: deactivating closes the posting on the last day and says what it did';

  -- Every path: the People screen's deactivation knows nothing of postings.
  perform pg_temp.lc_do(hema, format($q$select public.employee_move_unit(%L, jsonb_build_object(
    'unitId', %L, 'effectiveFrom', '2025-01-01', 'orderRef', 'DO-P-1'))$q$, e_priya, unit));
  perform pg_temp.lc_do(hema, format('select public.deactivate_employee(%L, %L)', priya, mark));
  if exists (select 1 from public.employee_deployments where employee_id = e_priya and effective_to is null) then
    raise exception 'LIFECYCLE FAIL: deactivating from People left the posting open';
  end if;
  raise notice 'ok: a deactivation by any path closes the posting';

  -- ── 5 · the Add Employee overview
  -- A record whose person was deleted is history, not a draft. Made the way
  -- it happens: the profile goes, and the foreign key empties profile_id.
  insert into public.employees (organization_id) values (acme) returning id into gone;
  r := pg_temp.lc_json(hema, 'select public.employee_admin_overview()');
  if (r ->> 'drafts')::int is distinct from drafts0 + 1
     or exists (select 1 from jsonb_array_elements(r -> 'recent') x where x ->> 'id' = gone::text) then
    raise exception 'LIFECYCLE FAIL: a nameless record counts as a draft: %', r -> 'drafts';
  end if;
  if pg_temp.lc_json(hema, format('select public.employee_card(%L)', gone)) ->> 'stage' is distinct from 'removed' then
    raise exception 'LIFECYCLE FAIL: a nameless record is not marked removed';
  end if;
  raise notice 'ok: a record whose person was removed is neither listed nor counted as a draft';

  -- Mark, not Priya: she was deactivated above, and a deactivated person is
  -- refused everything (D52), which would prove nothing about this rule.
  perform pg_temp.lc_refused('the overview is an Admin''s', mark,
    'select public.employee_admin_overview()', 'FORBIDDEN');
  r := pg_temp.lc_json(hema, 'select public.employee_admin_overview()');
  if (r ->> 'drafts')::int is distinct from drafts0 + 1
     or not exists (select 1 from jsonb_array_elements(r -> 'recent') x
                     where x ->> 'id' = d2::text and x ->> 'stage' = 'draft'
                       and x -> 'gaps' @> '[{"key":"work_email"}]'
                       and x -> 'gaps' @> '[{"key":"uan"}]') then
    raise exception 'LIFECYCLE FAIL: the overview reads %', r;
  end if;
  raise notice 'ok: the overview counts drafts and lists each record''s gaps';
end $$;

rollback;
