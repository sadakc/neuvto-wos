-- NEUVTO WOS — compensatory off (D89)
--
-- Raises on the first violation. Silence means pass. Rolled back.
--
-- PHASE-AWARE: exits quietly if comp_off_claims does not exist yet.
--
-- A claim lists days worked with a reason; every rule about which days can be
-- claimed is the database's; a day is owed once; nothing is credited until the
-- manager approves; a rejected or cancelled claim frees its days; a credit
-- expires first-in-first-out and never takes a booked day; proof is readable
-- by the person, their approver and the Leave Admin, and nobody else.

begin;

create or replace function pg_temp.co_as(_uid uuid) returns void as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', _uid::text, 'role', 'authenticated')::text, true);
end $$ language plpgsql;

create or replace function pg_temp.co_root() returns void as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$ language plpgsql;

create or replace function pg_temp.co_ok(_label text) returns void as $$
begin raise notice 'ok: %', _label; end $$ language plpgsql;

create or replace function pg_temp.co_refused(_label text, _uid uuid, _sql text, _needle text)
returns void as $$
declare v_msg text;
begin
  if _uid is null then perform pg_temp.co_root(); else perform pg_temp.co_as(_uid); end if;
  begin
    execute _sql;
  exception when others then
    v_msg := sqlerrm;
  end;
  perform pg_temp.co_root();
  if v_msg is null then
    raise exception 'COMP OFF FAIL: % — it was allowed', _label;
  end if;
  if v_msg not ilike '%' || _needle || '%' then
    raise exception 'COMP OFF FAIL: % — refused for the wrong reason: %', _label, v_msg;
  end if;
  perform pg_temp.co_ok(_label);
end $$ language plpgsql;

create or replace function pg_temp.co_claim(_uid uuid, _type uuid, _days jsonb, _reason text default 'Worked the audit weekend', _proof text default null)
returns uuid as $$
declare v uuid;
begin
  perform pg_temp.co_as(_uid);
  v := public.comp_off_submit(_type, _days, _reason, _proof);
  perform pg_temp.co_root();
  return v;
exception when others then
  perform pg_temp.co_root();
  raise exception 'COMP OFF FAIL: claim refused: %', sqlerrm;
end $$ language plpgsql;

create or replace function pg_temp.co_decide(_uid uuid, _claim uuid, _decision text) returns void as $$
declare v_ar uuid := (select approval_request_id from public.comp_off_claims where id = _claim);
begin
  perform pg_temp.co_as(_uid);
  perform public.approval_decide(v_ar, _decision::public.approval_decision,
    case when _decision = 'rejected' then 'Not a working day' end,
    case when _decision = 'rejected' then 'policy' end);
  perform pg_temp.co_root();
exception when others then
  perform pg_temp.co_root();
  raise exception 'COMP OFF FAIL: decision refused: %', sqlerrm;
end $$ language plpgsql;

create or replace function pg_temp.co_bal(_uid uuid, _type uuid) returns public.leave_balances as $$
  select * from public.leave_balances
   where employee_id = _uid and leave_type_id = _type
     and fy_label = public.get_financial_year(organization_id, current_date)
$$ language sql;

create or replace function pg_temp.co_day(_offset int, _days numeric default 1) returns jsonb as $$
  select jsonb_build_object('date', current_date - _offset, 'days', _days)
$$ language sql;

do $$
declare
  acme   uuid := '00000000-0000-0000-0000-0000000000a0';
  alice  uuid := '00000000-0000-0000-0000-00000000a001';
  mark   uuid := '00000000-0000-0000-0000-00000000a004';  -- Ravi's and Priya's manager
  ravi   uuid := '00000000-0000-0000-0000-00000000a005';
  priya  uuid := '00000000-0000-0000-0000-00000000a006';
  dan    uuid := '00000000-0000-0000-0000-00000000a003';  -- a Leave Admin below
  casual uuid := '00000000-0000-0000-0000-0000000000c1';
  coff   uuid;
  cproof uuid;
  a uuid; b uuid; c uuid; d uuid; e uuid; lr uuid;
  bal public.leave_balances;
  rec record;
  j   jsonb;
  n   integer;
  v   text;
  mon date := (date_trunc('week', current_date + 7) + interval '7 days')::date;
begin
  if to_regclass('public.comp_off_claims') is null then
    raise notice 'skip: compensatory off does not exist yet';
    return;
  end if;
  delete from public.module_admins;
  insert into public.module_admins (organization_id, user_id, module_key) values (acme, dan, 'leave');

  insert into public.leave_types (organization_id, name, kind, max_days_per_year, earned_expires_after_days, earned_claim_within_days)
  values (acme, 'Comp off', 'earned', 0, 30, 14) returning id into coff;
  insert into public.leave_types (organization_id, name, kind, max_days_per_year, earned_proof_required)
  values (acme, 'Comp off, proof', 'earned', 0, true) returning id into cproof;
  perform pg_temp.co_refused('an earned type has no yearly allowance', null,
    format($q$insert into public.leave_types (organization_id, name, kind, max_days_per_year) values (%L, 'CO2', 'earned', 5)$q$, acme),
    'leave_type_unpaid_has_no_allowance');
  if not exists (select 1 from cron.job where jobname = 'neuvto-leave-comp-off-expiry' and active) then
    raise exception 'COMP OFF FAIL: expiry is not scheduled';
  end if;

  -- ── 1 · which days can be claimed is the database's rule
  perform pg_temp.co_refused('only an earned type takes claims', ravi,
    format('select public.comp_off_submit(%L, %L, ''Worked'')', casual, jsonb_build_array(pg_temp.co_day(2))), 'NOT_AN_EARNED_TYPE');
  perform pg_temp.co_refused('a claim needs a reason', ravi,
    format('select public.comp_off_submit(%L, %L, '' a '')', coff, jsonb_build_array(pg_temp.co_day(2))), 'REASON_REQUIRED');
  perform pg_temp.co_refused('and at least one day', ravi,
    format('select public.comp_off_submit(%L, ''[]'', ''Worked'')', coff), 'NO_DAYS_CLAIMED');
  perform pg_temp.co_refused('a day not yet worked cannot be claimed', ravi,
    format('select public.comp_off_submit(%L, %L, ''Worked'')', coff, jsonb_build_array(pg_temp.co_day(-1))), 'WORKED_DATE_IN_FUTURE');
  perform pg_temp.co_refused('nor one older than the type allows', ravi,
    format('select public.comp_off_submit(%L, %L, ''Worked'')', coff, jsonb_build_array(pg_temp.co_day(15))), 'CLAIM_TOO_LATE');
  perform pg_temp.co_refused('a day is a whole or a half', ravi,
    format('select public.comp_off_submit(%L, %L, ''Worked'')', coff, jsonb_build_array(pg_temp.co_day(2, 0.75))), 'INVALID_DAY');
  perform pg_temp.co_refused('the same day twice in one claim', ravi,
    format('select public.comp_off_submit(%L, %L, ''Worked'')', coff, jsonb_build_array(pg_temp.co_day(2), pg_temp.co_day(2, 0.5))), 'SAME_DAY_TWICE');
  perform pg_temp.co_refused('a type can require proof', ravi,
    format('select public.comp_off_submit(%L, %L, ''Worked'')', cproof, jsonb_build_array(pg_temp.co_day(2))), 'PROOF_REQUIRED');
  perform pg_temp.co_refused('proof must be the person''s own upload', ravi,
    format('select public.comp_off_submit(%L, %L, ''Worked'', %L)', cproof, jsonb_build_array(pg_temp.co_day(2)), acme::text || '/' || priya::text || '/x.pdf'), 'PROOF_NOT_YOURS');

  -- ── 2 · a claim waits for its approver and credits nothing until then
  a := pg_temp.co_claim(ravi, coff, jsonb_build_array(pg_temp.co_day(3), pg_temp.co_day(2, 0.5)));
  select * into rec from public.comp_off_claims where id = a;
  if rec.total_days <> 1.5 or rec.status <> 'pending_approval' or rec.approval_request_id is null then
    raise exception 'COMP OFF FAIL: the claim reads %', to_jsonb(rec);
  end if;
  bal := pg_temp.co_bal(ravi, coff);
  if coalesce(bal.entitled_days, 0) <> 0 then raise exception 'COMP OFF FAIL: credited before approval'; end if;
  perform pg_temp.co_refused('a day already claimed cannot be claimed again', ravi,
    format('select public.comp_off_submit(%L, %L, ''Worked'')', coff, jsonb_build_array(pg_temp.co_day(3))), 'ALREADY_CLAIMED');
  perform pg_temp.co_as(mark);
  select count(*) into n from public.approval_queue() where approval_request_id = rec.approval_request_id and entity_type = 'comp_off_claim';
  j := public.comp_off_approval_detail(rec.approval_request_id);
  perform pg_temp.co_root();
  if n <> 1 then raise exception 'COMP OFF FAIL: the manager does not have the claim'; end if;
  if (j ->> 'totalDays')::numeric <> 1.5 or jsonb_array_length(j -> 'days') <> 2 or j ->> 'reason' <> 'Worked the audit weekend' then
    raise exception 'COMP OFF FAIL: the approver sees %', j;
  end if;
  perform pg_temp.co_refused('a colleague cannot read the claim', priya,
    format('select public.comp_off_approval_detail(%L)', rec.approval_request_id), 'FORBIDDEN');
  perform pg_temp.co_ok('a claim waits for the manager, who sees its days and reason; a colleague does not');

  -- ── 3 · approved, it is credited with an expiry
  perform pg_temp.co_decide(mark, a, 'approved');
  bal := pg_temp.co_bal(ravi, coff);
  select * into rec from public.comp_off_claims where id = a;
  if bal.entitled_days <> 1.5 or rec.status <> 'approved' or rec.expires_on <> current_date + 30 then
    raise exception 'COMP OFF FAIL: on approval: balance %, claim %', bal.entitled_days, to_jsonb(rec);
  end if;
  perform pg_temp.co_refused('another company''s administrator cannot read the claim', '00000000-0000-0000-0000-00000000b001',
    format('select public.comp_off_approval_detail(%L)', rec.approval_request_id), 'FORBIDDEN');
  -- An approval closed again after the credit does not undo or repeat it.
  update public.approval_requests set status = 'cancelled' where id = rec.approval_request_id;
  if (select status from public.comp_off_claims where id = a) <> 'approved'
     or (pg_temp.co_bal(ravi, coff)).entitled_days <> 1.5
     or not exists (select 1 from public.comp_off_claim_days where claim_id = a and live) then
    raise exception 'COMP OFF FAIL: closing a decided approval again changed the credited claim';
  end if;
  update public.approval_requests set status = 'approved' where id = rec.approval_request_id;
  perform pg_temp.co_refused('an approved claim cannot be taken back by the person', ravi,
    format('select public.comp_off_cancel(%L)', a), 'ALREADY_DECIDED');
  perform pg_temp.co_ok('approved, the days are credited and an expiry set');

  -- ── 4 · used like any leave, and expiry never takes a booked day
  perform pg_temp.co_refused('comp off cannot be booked beyond what was credited', ravi,
    format('select public.leave_submit(%L, %L, %L, null)', coff, mon, mon + 1), 'INSUFFICIENT_BALANCE');
  perform pg_temp.co_as(ravi);
  lr := public.leave_submit(coff, mon, mon, null);
  perform pg_temp.co_root();
  b := pg_temp.co_claim(ravi, coff, jsonb_build_array(pg_temp.co_day(5)));
  perform pg_temp.co_decide(mark, b, 'approved');
  if (pg_temp.co_bal(ravi, coff)).entitled_days <> 2.5 then raise exception 'COMP OFF FAIL: the second credit did not add'; end if;
  -- The first credit (1.5) passes its date with one day booked.
  update public.comp_off_claims set expires_on = current_date - 1 where id = a;
  perform public.comp_off_expire_due();
  bal := pg_temp.co_bal(ravi, coff);
  select * into rec from public.comp_off_claims where id = a;
  if rec.expired_days <> 0.5 or bal.entitled_days <> 2 or bal.available_days <> 1 then
    raise exception 'COMP OFF FAIL: expiry took % (balance now %, available %)', rec.expired_days, bal.entitled_days, bal.available_days;
  end if;
  -- The second credit (1) expires too: the booked day is held by the first.
  update public.comp_off_claims set expires_on = current_date - 1 where id = b;
  perform public.comp_off_expire_due();
  bal := pg_temp.co_bal(ravi, coff);
  if (select expired_days from public.comp_off_claims where id = b) <> 1 or bal.entitled_days <> 1 or bal.available_days <> 0 then
    raise exception 'COMP OFF FAIL: first-in-first-out failed: balance %, available %', bal.entitled_days, bal.available_days;
  end if;
  perform public.comp_off_expire_due();
  if (pg_temp.co_bal(ravi, coff)).entitled_days <> 1 then raise exception 'COMP OFF FAIL: a credit expired twice'; end if;
  perform pg_temp.co_ok('expiry takes the unused part, oldest first, never a booked day, and once');

  -- ── 5 · rejected or cancelled, the days are free again
  c := pg_temp.co_claim(ravi, coff, jsonb_build_array(pg_temp.co_day(6)));
  perform pg_temp.co_decide(mark, c, 'rejected');
  if (select status from public.comp_off_claims where id = c) <> 'rejected' or (pg_temp.co_bal(ravi, coff)).entitled_days <> 1 then
    raise exception 'COMP OFF FAIL: a rejected claim credited or kept its status wrong';
  end if;
  d := pg_temp.co_claim(ravi, coff, jsonb_build_array(pg_temp.co_day(6)));
  perform pg_temp.co_refused('nobody else can cancel it', priya,
    format('select public.comp_off_cancel(%L)', d), 'NOT_YOUR_REQUEST');
  perform pg_temp.co_as(ravi);
  perform public.comp_off_cancel(d);
  perform pg_temp.co_root();
  if (select status from public.comp_off_claims where id = d) <> 'cancelled' then
    raise exception 'COMP OFF FAIL: cancelling did not cancel';
  end if;
  perform pg_temp.co_claim(ravi, coff, jsonb_build_array(pg_temp.co_day(6)));
  perform pg_temp.co_ok('a rejected or cancelled claim frees its day to be claimed again');

  -- ── 6 · somebody who leaves takes no pending claim with them
  e := pg_temp.co_claim(priya, coff, jsonb_build_array(pg_temp.co_day(1)));
  update public.profiles set is_active = false where id = priya;
  if (select status from public.comp_off_claims where id = e) <> 'cancelled' then
    raise exception 'COMP OFF FAIL: a leaver''s pending claim stayed open';
  end if;
  update public.profiles set is_active = true where id = priya;
  perform pg_temp.co_ok('deactivating somebody cancels their pending claims');

  -- ── 7 · proof: the person, their approver, the Leave Admin, nobody else
  perform pg_temp.co_as(ravi);
  insert into storage.objects (bucket_id, name, owner) values ('leave-proofs', acme::text || '/' || ravi::text || '/roster.pdf', ravi);
  perform pg_temp.co_root();
  perform pg_temp.co_refused('nobody uploads into somebody else''s folder', ravi,
    format($q$insert into storage.objects (bucket_id, name) values ('leave-proofs', %L)$q$, acme::text || '/' || priya::text || '/x.pdf'),
    'row-level security');
  d := pg_temp.co_claim(ravi, cproof, jsonb_build_array(pg_temp.co_day(4)), 'Covered the night shift', acme::text || '/' || ravi::text || '/roster.pdf');
  perform pg_temp.co_as(mark);
  select count(*) into n from storage.objects where bucket_id = 'leave-proofs' and name like '%/roster.pdf';
  perform pg_temp.co_root();
  if n <> 1 then raise exception 'COMP OFF FAIL: the approver cannot read the proof'; end if;
  perform pg_temp.co_as(dan);
  select count(*) into n from storage.objects where bucket_id = 'leave-proofs' and name like '%/roster.pdf';
  perform pg_temp.co_root();
  if n <> 1 then raise exception 'COMP OFF FAIL: the Leave Admin cannot read the proof'; end if;
  perform pg_temp.co_as(priya);
  select count(*) into n from storage.objects where bucket_id = 'leave-proofs' and name like '%/roster.pdf';
  perform pg_temp.co_root();
  if n <> 0 then raise exception 'COMP OFF FAIL: a colleague can read the proof'; end if;
  perform pg_temp.co_as(ravi);
  select count(*) into n from storage.objects where bucket_id = 'leave-proofs' and name like '%/roster.pdf';
  perform pg_temp.co_root();
  if n <> 1 then raise exception 'COMP OFF FAIL: the person cannot read their own proof'; end if;
  perform pg_temp.co_ok('proof is read by the person, their approver and the Leave Admin, and nobody else');

  -- ── 8 · the person sees their own claims, and nothing reads the tables directly
  perform pg_temp.co_as(ravi);
  select count(*) into n from public.comp_off_my_claims();
  perform pg_temp.co_root();
  if n <> 6 then raise exception 'COMP OFF FAIL: the person sees % of their 6 claims', n; end if;
  perform pg_temp.co_as(priya);
  select count(*) into n from public.comp_off_my_claims();
  perform pg_temp.co_root();
  if n <> 1 then raise exception 'COMP OFF FAIL: a colleague''s claims appear in my list (%)', n; end if;
  perform pg_temp.co_refused('the claims table is not readable directly', ravi,
    'select count(*) from public.comp_off_claims', 'permission denied');
  perform pg_temp.co_refused('nor is expiry runnable by anybody signed in', alice,
    'select public.comp_off_expire_due()', 'permission denied');
  perform pg_temp.co_ok('each person reads only their own claims, through the function');
end $$;

rollback;
