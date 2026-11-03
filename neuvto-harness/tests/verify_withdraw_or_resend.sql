-- NEUVTO WOS — withdraw or resend an invitation (D118)
--
-- Raises on the first violation. Silence means pass. Rolled back.
--
-- PHASE-AWARE: exits quietly if employee_withdraw_invite does not exist yet.
--
--   withdraw   an Admin withdraws an invitation waiting on a record; its link
--              is dead and the record is a draft again, with every detail it
--              was sent with; it can be invited again;
--   resend     a fresh invitation replaces the waiting one, same details and
--              role, a new link;
--   People     Withdraw there does the same; Send again there too;
--   refusals   nobody else; nothing waiting; another company's record.

begin;

create or replace function pg_temp.wi_as(_uid uuid) returns void as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', _uid::text, 'role', 'authenticated')::text, true);
end $$ language plpgsql;

create or replace function pg_temp.wi_root() returns void as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$ language plpgsql;

create or replace function pg_temp.wi_refused(_label text, _uid uuid, _sql text, _needle text)
returns void as $$
declare v_msg text;
begin
  perform pg_temp.wi_as(_uid);
  begin
    execute _sql;
  exception when others then
    v_msg := sqlerrm;
  end;
  perform pg_temp.wi_root();
  if v_msg is null then
    raise exception 'INVITE FAIL: % — it was allowed', _label;
  end if;
  if v_msg not ilike '%' || _needle || '%' then
    raise exception 'INVITE FAIL: % — refused for the wrong reason: %', _label, v_msg;
  end if;
  raise notice 'ok: %', _label;
end $$ language plpgsql;

create or replace function pg_temp.wi_json(_uid uuid, _sql text) returns jsonb as $$
declare v jsonb;
begin
  perform pg_temp.wi_as(_uid);
  execute _sql into v;
  perform pg_temp.wi_root();
  return v;
exception when others then
  perform pg_temp.wi_root();
  raise exception 'INVITE FAIL: refused: % — %', _sql, sqlerrm;
end $$ language plpgsql;

create or replace function pg_temp.wi_do(_uid uuid, _sql text) returns void as $$
begin
  perform pg_temp.wi_as(_uid);
  execute _sql;
  perform pg_temp.wi_root();
exception when others then
  perform pg_temp.wi_root();
  raise exception 'INVITE FAIL: refused: % — %', _sql, sqlerrm;
end $$ language plpgsql;

do $$
declare
  acme   uuid := '00000000-0000-0000-0000-0000000000a0';
  alice  uuid := '00000000-0000-0000-0000-00000000a001';  -- Super Admin
  hema   uuid := '00000000-0000-0000-0000-00000000a002';  -- Admin
  mark   uuid := '00000000-0000-0000-0000-00000000a004';  -- a manager
  ravi   uuid := '00000000-0000-0000-0000-00000000a005';
  bob    uuid := '00000000-0000-0000-0000-00000000b001';  -- another company's admin
  ops    uuid := '00000000-0000-0000-0000-0000000000d1';  -- Operations
  d      uuid;
  inv1   uuid;
  inv2   uuid;
  c      jsonb;
  e      public.employees%rowtype;
begin
  if to_regprocedure('public.employee_withdraw_invite(uuid)') is null then
    raise notice 'skip: no withdrawing invitations yet';
    return;
  end if;
  insert into public.organization_modules (organization_id, module_key, enabled, enabled_at)
  values (acme, 'employee', true, now()), ('00000000-0000-0000-0000-0000000000b0', 'employee', true, now())
  on conflict (organization_id, module_key) do update set enabled = true, deleted_at = null;

  d := (pg_temp.wi_json(hema, format($q$select to_jsonb(public.employee_create_draft(jsonb_build_object(
    'fullName','Kavya Rao','email','kavya.rao@acme.test','phone','+91 90000 22222',
    'joinedDate','2026-12-01','departmentId',%L,'managerId',%L)))$q$, ops, mark)) #>> '{}')::uuid;
  inv1 := (pg_temp.wi_json(hema, format('select to_jsonb(public.employee_send_invite(%L))', d)) #>> '{}')::uuid;

  c := pg_temp.wi_json(hema, format('select public.employee_card(%L)', d));
  if (c -> 'capabilities' ->> 'canWithdrawInvite')::boolean is not true then
    raise exception 'INVITE FAIL: an invited record does not offer Withdraw';
  end if;
  if c -> 'capabilities' ->> 'invitationExpiresAt' is null then
    raise exception 'INVITE FAIL: the card does not say when the invitation expires';
  end if;
  raise notice 'ok: an invited record offers Withdraw and Send a fresh one, and says when it expires';

  -- ── refusals
  perform pg_temp.wi_refused('the person''s manager cannot withdraw it', mark,
    format('select public.employee_withdraw_invite(%L)', d), 'FORBIDDEN');
  perform pg_temp.wi_refused('nor an employee', ravi,
    format('select public.employee_withdraw_invite(%L)', d), 'FORBIDDEN');
  perform pg_temp.wi_refused('nor another company''s admin', bob,
    format('select public.employee_resend_invite(%L)', d), 'NOT_FOUND');

  -- ── a fresh one
  inv2 := (pg_temp.wi_json(hema, format('select to_jsonb(public.employee_resend_invite(%L))', d)) #>> '{}')::uuid;
  if inv2 = inv1 then raise exception 'INVITE FAIL: the fresh invitation is the old one'; end if;
  if (select revoked_at from public.invitations where id = inv1) is null then
    raise exception 'INVITE FAIL: the old link still works';
  end if;
  if (select email || '/' || full_name || '/' || coalesce(phone, '') || '/' || joined_date || '/' || department_id || '/' || manager_email
        from public.invitations where id = inv2)
     is distinct from 'kavya.rao@acme.test/Kavya Rao/+91 90000 22222/2026-12-01/' || ops || '/' || (select email from public.profiles where id = mark) then
    raise exception 'INVITE FAIL: the fresh invitation lost a detail: %', (select to_jsonb(i) from public.invitations i where id = inv2);
  end if;
  if (select invitation_id from public.employees where id = d) is distinct from inv2 then
    raise exception 'INVITE FAIL: the record does not point at the fresh invitation';
  end if;
  raise notice 'ok: a fresh invitation kills the old link and carries every detail';

  -- ── withdrawn: a draft again
  perform pg_temp.wi_do(hema, format('select public.employee_withdraw_invite(%L)', d));
  select * into e from public.employees where id = d;
  if (select revoked_at from public.invitations where id = inv2) is null then
    raise exception 'INVITE FAIL: the withdrawn link still works';
  end if;
  if e.invitation_id is not null
     or e.draft_full_name is distinct from 'Kavya Rao' or e.draft_email is distinct from 'kavya.rao@acme.test'
     or e.draft_phone is distinct from '+91 90000 22222' or e.draft_joined_date is distinct from '2026-12-01'
     or e.draft_department_id is distinct from ops or e.draft_manager_id is distinct from mark then
    raise exception 'INVITE FAIL: withdrawn, the record is not the draft it was: %', to_jsonb(e);
  end if;
  if pg_temp.wi_json(hema, format('select public.employee_card(%L)', d)) ->> 'stage' <> 'draft' then
    raise exception 'INVITE FAIL: withdrawn, the card does not say Draft';
  end if;
  raise notice 'ok: withdrawn, the link is dead and the record is the draft it was';
  perform pg_temp.wi_refused('nothing waiting: nothing to withdraw', hema,
    format('select public.employee_withdraw_invite(%L)', d), 'NO_INVITATION_WAITING');
  perform pg_temp.wi_refused('nor to send afresh', hema,
    format('select public.employee_resend_invite(%L)', d), 'NO_INVITATION_WAITING');

  -- ── invited again, sent again and withdrawn from People
  inv1 := (pg_temp.wi_json(hema, format('select to_jsonb(public.employee_send_invite(%L))', d)) #>> '{}')::uuid;
  raise notice 'ok: a withdrawn record can be invited again';
  inv2 := (pg_temp.wi_json(alice, format('select to_jsonb(public.invitation_resend(%L))', inv1)) #>> '{}')::uuid;
  if inv2 = inv1 or (select invitation_id from public.employees where id = d) <> inv2 then
    raise exception 'INVITE FAIL: People''s Send again did not send a fresh one';
  end if;
  raise notice 'ok: People''s Send again sends a fresh one';
  perform pg_temp.wi_do(alice, format('select public.invitation_revoke(%L)', inv2));
  if (select invitation_id is null and draft_email = 'kavya.rao@acme.test' from public.employees where id = d) is not true then
    raise exception 'INVITE FAIL: withdrawn from People, the record is left behind';
  end if;
  raise notice 'ok: withdrawn from People, the record is a draft again too';

  raise notice 'withdraw or resend: all checks passed';
end $$;

rollback;
