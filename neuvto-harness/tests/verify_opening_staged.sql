-- NEUVTO WOS — an opening balance for somebody who has not joined yet (D88)
--
-- Raises on the first violation. Silence means pass. Rolled back.
--
-- PHASE-AWARE: exits quietly if leave_opening_staged does not exist yet.
--
-- The Leave Admin, and only they, stage what a draft or invited person has
-- already taken and carried over; it is checked against the entitlement their
-- joining date gives, applied exactly once when they accept, and never fails
-- the acceptance: a number that no longer fits is kept, marked and listed, and
-- setting the balance by hand settles it.

begin;

create or replace function pg_temp.os_as(_uid uuid) returns void as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', _uid::text, 'role', 'authenticated')::text, true);
end $$ language plpgsql;

create or replace function pg_temp.os_root() returns void as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$ language plpgsql;

create or replace function pg_temp.os_ok(_label text) returns void as $$
begin raise notice 'ok: %', _label; end $$ language plpgsql;

create or replace function pg_temp.os_refused(_label text, _uid uuid, _sql text, _needle text)
returns void as $$
declare v_msg text;
begin
  perform pg_temp.os_as(_uid);
  begin
    execute _sql;
  exception when others then
    v_msg := sqlerrm;
  end;
  perform pg_temp.os_root();
  if v_msg is null then
    raise exception 'STAGED FAIL: % — it was allowed', _label;
  end if;
  if v_msg not ilike '%' || _needle || '%' then
    raise exception 'STAGED FAIL: % — refused for the wrong reason: %', _label, v_msg;
  end if;
  perform pg_temp.os_ok(_label);
end $$ language plpgsql;

create or replace function pg_temp.os_do(_uid uuid, _sql text) returns jsonb as $$
declare v jsonb;
begin
  perform pg_temp.os_as(_uid);
  execute _sql into v;
  perform pg_temp.os_root();
  return v;
exception when others then
  perform pg_temp.os_root();
  raise exception 'STAGED FAIL: refused: % — %', _sql, sqlerrm;
end $$ language plpgsql;

create or replace function pg_temp.os_user(_id uuid, _email text) returns void as $$
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values (_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          _email, '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb)
$$ language sql;

do $$
declare
  acme   uuid := '00000000-0000-0000-0000-0000000000a0';
  globex uuid := '00000000-0000-0000-0000-0000000000b0';
  hema   uuid := '00000000-0000-0000-0000-00000000a002';  -- Admin
  dan    uuid := '00000000-0000-0000-0000-00000000a003';  -- Employee Admin only
  mark   uuid := '00000000-0000-0000-0000-00000000a004';  -- Leave Admin only
  ravi   uuid := '00000000-0000-0000-0000-00000000a005';
  casual uuid := '00000000-0000-0000-0000-0000000000c1';
  sick   uuid := '00000000-0000-0000-0000-0000000000c2';
  nisha  uuid := '00000000-0000-0000-0000-0000000000e7';
  kiran  uuid := '00000000-0000-0000-0000-0000000000e8';
  lop    uuid;
  fy     text;
  fy_start date;
  d1 uuid; d2 uuid; e_ravi uuid; e_other uuid;
  inv public.invitations%rowtype;
  rec record;
  n  integer;
begin
  if to_regclass('public.leave_opening_staged') is null then
    raise notice 'skip: staged opening balances do not exist yet';
    return;
  end if;
  insert into public.organization_modules (organization_id, module_key, enabled, enabled_at)
  values (acme, 'employee', true, now())
  on conflict (organization_id, module_key) do update set enabled = true, deleted_at = null;
  delete from public.module_admins;
  insert into public.module_admins (organization_id, user_id, module_key) values
    (acme, mark, 'leave'), (acme, dan, 'employee');

  select make_date(case when extract(month from current_date) >= s.fy_start_month
                        then extract(year from current_date)::int
                        else extract(year from current_date)::int - 1 end,
                   s.fy_start_month, s.fy_start_day)
    into fy_start from public.organization_settings s where s.organization_id = acme;
  fy := public.get_financial_year(acme, fy_start);

  -- Nisha joins seven months into the year: five months of Casual's twelve.
  d1 := (pg_temp.os_do(hema, format($q$select to_jsonb(public.employee_create_draft(jsonb_build_object(
    'fullName','Nisha Staged','email','nisha.staged@acme.test','joinedDate',%L)))$q$,
    fy_start + interval '7 months')) #>> '{}')::uuid;
  -- Kiran has no joining date yet: priced as the whole year.
  d2 := (pg_temp.os_do(hema, $q$select to_jsonb(public.employee_create_draft('{"fullName":"Kiran Staged","email":"kiran.staged@acme.test"}'))$q$) #>> '{}')::uuid;
  select id into e_ravi from public.employees where profile_id = ravi;
  insert into public.employees (organization_id, draft_full_name) values (globex, 'Elsewhere') returning id into e_other;
  insert into public.leave_types (organization_id, name, kind, max_days_per_year) values (acme, 'LOP staged', 'unpaid', 0) returning id into lop;

  -- ── 1 · only the Leave Admin
  perform pg_temp.os_refused('an employee cannot stage a balance', ravi,
    format('select public.leave_stage_opening_balance(%L, %L, 1, 0)', d1, casual), 'FORBIDDEN');
  perform pg_temp.os_refused('nor can the Employee Admin', dan,
    format('select public.leave_stage_opening_balance(%L, %L, 1, 0)', d1, casual), 'FORBIDDEN');
  perform pg_temp.os_refused('nor list them', dan,
    'select * from public.leave_staged_opening_balances()', 'FORBIDDEN');
  perform pg_temp.os_refused('a record in another company is not found', mark,
    format('select public.leave_stage_opening_balance(%L, %L, 1, 0)', e_other, casual), 'NOT_FOUND');
  perform pg_temp.os_refused('somebody who has joined is set on their own balance', mark,
    format('select public.leave_stage_opening_balance(%L, %L, 1, 0)', e_ravi, casual), 'ALREADY_JOINED');
  perform pg_temp.os_refused('unpaid leave has no balance to stage', mark,
    format('select public.leave_stage_opening_balance(%L, %L, 1, 0)', d1, lop), 'UNPAID_HAS_NO_BALANCE');
  perform pg_temp.os_refused('days come in halves', mark,
    format('select public.leave_stage_opening_balance(%L, %L, 1.25, 0)', d1, casual), 'NOT_A_HALF_DAY');
  perform pg_temp.os_refused('and are never negative', mark,
    format('select public.leave_stage_opening_balance(%L, %L, 0, -1)', d1, casual), 'NEGATIVE_DAYS');

  -- ── 2 · checked against the joining date's entitlement
  perform pg_temp.os_refused('more than their joining date entitles them to is refused', mark,
    format('select public.leave_stage_opening_balance(%L, %L, 6, 0)', d1, casual), 'OPENING_BALANCE_OVERDRAWN');
  perform pg_temp.os_do(mark, format('select to_jsonb(public.leave_stage_opening_balance(%L, %L, 5.5, 1))', d1, casual));
  perform pg_temp.os_do(mark, format('select to_jsonb(public.leave_stage_opening_balance(%L, %L, 5, 1))', d1, casual));
  perform pg_temp.os_do(mark, format('select to_jsonb(public.leave_stage_opening_balance(%L, %L, 12, 0))', d2, casual));
  perform pg_temp.os_ok('within the entitlement plus carry-over it is staged, and staging again replaces it');

  perform pg_temp.os_as(mark);
  select * into rec from public.leave_staged_opening_balances() where employee_record_id = d1 and leave_type_id = casual;
  select count(*) into n from public.leave_staged_opening_balances() where employee_record_id in (e_ravi, e_other);
  perform pg_temp.os_root();
  if rec.entitled_days <> 5 or rec.used_days <> 5 or rec.carryforward_days <> 1 or not rec.staged or rec.stage <> 'draft'
     or rec.employee_name <> 'Nisha Staged' then
    raise exception 'STAGED FAIL: the list reads %', to_jsonb(rec);
  end if;
  if n <> 0 then raise exception 'STAGED FAIL: the list includes somebody joined, or from another company'; end if;
  perform pg_temp.os_ok('the list shows the not-yet-joined with their would-be entitlement and what is staged');

  -- ── 3 · applied, once, when they accept
  perform pg_temp.os_do(hema, format('select to_jsonb(public.employee_send_invite(%L))', d1));
  perform pg_temp.os_as(mark);
  select stage into rec from public.leave_staged_opening_balances() where employee_record_id = d1 limit 1;
  perform pg_temp.os_root();
  if rec.stage <> 'invited' then raise exception 'STAGED FAIL: an invited person reads as %', rec.stage; end if;
  perform pg_temp.os_refused('once invited, the invitation''s joining date is what it is checked against', mark,
    format('select public.leave_stage_opening_balance(%L, %L, 6, 0)', d1, casual), 'OPENING_BALANCE_OVERDRAWN');
  select i.* into inv from public.invitations i join public.employees e on e.invitation_id = i.id where e.id = d1;
  perform pg_temp.os_user(nisha, 'nisha.staged@acme.test');
  perform pg_temp.os_do(nisha, format('select to_jsonb(public.invitation_accept(%L))', inv.token));
  select * into rec from public.leave_balances where employee_id = nisha and leave_type_id = casual and fy_label = fy;
  if rec.id is null or rec.entitled_days <> 5 or rec.used_days <> 5 or rec.carryforward_days <> 1 then
    raise exception 'STAGED FAIL: on joining the balance reads %', to_jsonb(rec);
  end if;
  if exists (select 1 from public.leave_balances where employee_id = nisha and leave_type_id = sick) then
    raise exception 'STAGED FAIL: a type with nothing staged was materialised';
  end if;
  if not exists (select 1 from public.leave_opening_staged where employee_record_id = d1 and applied_at is not null and problem is null) then
    raise exception 'STAGED FAIL: the staged row is not marked applied';
  end if;
  perform pg_temp.os_as(mark);
  select count(*) into n from public.leave_staged_opening_balances() where employee_record_id = d1;
  perform pg_temp.os_root();
  if n <> 0 then raise exception 'STAGED FAIL: somebody who has joined is still listed as waiting'; end if;
  perform pg_temp.os_refused('once joined it cannot be staged again', mark,
    format('select public.leave_stage_opening_balance(%L, %L, 1, 0)', d1, casual), 'ALREADY_JOINED');
  -- A later change of the profile link does not apply it a second time.
  update public.leave_balances set used_days = 0 where employee_id = nisha and leave_type_id = casual;
  update public.employees set profile_id = nisha where id = d1;
  update public.employees set profile_id = null where id = d1;
  update public.employees set profile_id = nisha where id = d1;
  if (select used_days from public.leave_balances where employee_id = nisha and leave_type_id = casual and fy_label = fy) <> 0 then
    raise exception 'STAGED FAIL: a staged balance was applied twice';
  end if;
  perform pg_temp.os_ok('accepting applies what was staged, to the types staged, exactly once');

  -- ── 4 · a number that no longer fits never fails the acceptance
  perform pg_temp.os_do(hema, format('select to_jsonb(public.employee_send_invite(%L))', d2));
  select i.* into inv from public.invitations i join public.employees e on e.invitation_id = i.id where e.id = d2;
  -- Their joining date is corrected to the last month of the year: one day of Casual.
  update public.invitations set joined_date = fy_start + interval '11 months' where id = inv.id;
  perform pg_temp.os_user(kiran, 'kiran.staged@acme.test');
  perform pg_temp.os_do(kiran, format('select to_jsonb(public.invitation_accept(%L))', inv.token));
  if not exists (select 1 from public.profiles where id = kiran) then
    raise exception 'STAGED FAIL: the acceptance failed';
  end if;
  if exists (select 1 from public.leave_balances where employee_id = kiran and leave_type_id = casual and used_days > 0) then
    raise exception 'STAGED FAIL: a number beyond the entitlement was applied';
  end if;
  perform pg_temp.os_as(mark);
  select * into rec from public.leave_staged_opening_problems() where employee_id = kiran;
  perform pg_temp.os_root();
  if rec.problem is distinct from 'OPENING_BALANCE_OVERDRAWN' or rec.used_days <> 12 then
    raise exception 'STAGED FAIL: the problem reads %', to_jsonb(rec);
  end if;
  perform pg_temp.os_refused('only the Leave Admin sees what did not apply', ravi,
    'select * from public.leave_staged_opening_problems()', 'FORBIDDEN');
  perform pg_temp.os_do(mark, format('select to_jsonb(public.leave_set_opening_balance(%L, %L, 1, 0))', kiran, casual));
  perform pg_temp.os_as(mark);
  select count(*) into n from public.leave_staged_opening_problems() where employee_id = kiran;
  perform pg_temp.os_root();
  if n <> 0 then raise exception 'STAGED FAIL: setting it by hand did not settle the problem'; end if;
  perform pg_temp.os_ok('a staged number that no longer fits is kept and listed, the acceptance goes through, and setting it by hand settles it');
end $$;

rollback;
