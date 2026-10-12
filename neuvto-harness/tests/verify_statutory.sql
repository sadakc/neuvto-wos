-- NEUVTO WOS — statutory numbers, bank and restricted data (E6, D80)
--
-- Raises on the first violation. Silence means pass. Rolled back.
--
-- PHASE-AWARE: exits quietly if employee_reveal_restricted does not exist yet.
--
-- What "encrypted" is proved to mean here: the plaintext appears in no table
-- row, no audit row and no card response for a role §5 does not give it to;
-- it comes back only from the reveal, and only after the reveal's log row.

begin;

create or replace function pg_temp.st_as(_uid uuid) returns void as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', _uid::text, 'role', 'authenticated')::text, true);
end $$ language plpgsql;

create or replace function pg_temp.st_root() returns void as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$ language plpgsql;

create or replace function pg_temp.st_ok(_label text) returns void as $$
begin raise notice 'ok: %', _label; end $$ language plpgsql;

create or replace function pg_temp.st_refused(_label text, _uid uuid, _sql text, _needle text)
returns void as $$
declare v_msg text;
begin
  if _uid is null then perform pg_temp.st_root(); else perform pg_temp.st_as(_uid); end if;
  begin
    execute _sql;
  exception when others then
    v_msg := sqlerrm;
  end;
  perform pg_temp.st_root();
  if v_msg is null then
    raise exception 'STATUTORY FAIL: % — it was allowed', _label;
  end if;
  if v_msg not ilike '%' || _needle || '%' then
    raise exception 'STATUTORY FAIL: % — refused for the wrong reason: %', _label, v_msg;
  end if;
  perform pg_temp.st_ok(_label);
end $$ language plpgsql;

create or replace function pg_temp.st_run(_uid uuid, _sql text) returns void as $$
begin
  perform pg_temp.st_as(_uid);
  execute _sql;
  perform pg_temp.st_root();
exception when others then
  perform pg_temp.st_root();
  raise exception 'STATUTORY FAIL: refused: % — %', _sql, sqlerrm;
end $$ language plpgsql;

create or replace function pg_temp.st_card(_uid uuid, _of uuid) returns jsonb as $$
declare v jsonb;
begin
  perform pg_temp.st_as(_uid);
  v := public.employee_card(_of);
  perform pg_temp.st_root();
  return v;
end $$ language plpgsql;

create or replace function pg_temp.st_reveal(_uid uuid, _of uuid, _fields text[], _reason text)
returns jsonb as $$
declare v jsonb;
begin
  perform pg_temp.st_as(_uid);
  v := public.employee_reveal_restricted(_of, _fields, _reason);
  perform pg_temp.st_root();
  return v;
end $$ language plpgsql;

/** The first 12-digit number from _stem that passes the Verhoeff check. */
create or replace function pg_temp.st_aadhaar(_stem text) returns text as $$
declare d int;
begin
  for d in 0 .. 9 loop
    if public.aadhaar_is_valid(_stem || d) then return _stem || d; end if;
  end loop;
  raise exception 'no check digit for %', _stem;
end $$ language plpgsql;

do $$
declare
  acme   uuid := '00000000-0000-0000-0000-0000000000a0';
  vertex uuid := '00000000-0000-0000-0000-0000000000b0';
  alice  uuid := '00000000-0000-0000-0000-00000000a001';  -- Super Admin
  hema   uuid := '00000000-0000-0000-0000-00000000a002';  -- hr_admin: Admin, not Super
  mark   uuid := '00000000-0000-0000-0000-00000000a004';  -- Priya's approver
  ravi   uuid := '00000000-0000-0000-0000-00000000a005';  -- colleague
  priya  uuid := '00000000-0000-0000-0000-00000000a006';
  stat   uuid := '00000000-0000-0000-0000-00000000a007';  -- given statutory_officer below
  pay    uuid := '00000000-0000-0000-0000-00000000a008';  -- given payroll_officer below
  bob    uuid := '00000000-0000-0000-0000-00000000b001';
  e      uuid;
  e_ravi uuid;
  e_sara uuid;
  aadhaar text := pg_temp.st_aadhaar('23456789012');
  account text := '004512345678';
  c      jsonb;
  r      jsonb;
  n      integer;
  n2     integer;
  role_  text;
begin
  if to_regprocedure('public.employee_reveal_restricted(uuid,text[],text)') is null then
    raise notice 'skip: restricted data does not exist yet';
    return;
  end if;

  insert into public.organization_modules (organization_id, module_key, enabled, enabled_at)
  values (acme, 'employee', true, now()), (vertex, 'employee', true, now())
  on conflict (organization_id, module_key) do update set enabled = true, deleted_at = null;
  insert into public.user_roles (user_id, organization_id, role) values
    (stat, acme, 'statutory_officer'), (pay, acme, 'payroll_officer');
  select id into e      from public.employees where profile_id = priya;
  select id into e_ravi from public.employees where profile_id = ravi;
  select id into e_sara from public.employees where profile_id = '00000000-0000-0000-0000-00000000b002';

  -- ── 0 · no key, no storage
  perform vault.update_secret((select id from vault.secrets where name = 'statutory_encryption_key'),
                             null, 'statutory_encryption_key_away');
  perform pg_temp.st_refused('without the key nothing is stored', hema,
    format($q$select public.employee_set_statutory(%L, '{"pan":"ABCDE1234F"}')$q$, e),
    'STATUTORY_KEY_NOT_SET');
  perform vault.update_secret((select id from vault.secrets where name = 'statutory_encryption_key_away'),
                             null, 'statutory_encryption_key');

  -- ── 1 · who writes what
  perform pg_temp.st_refused('a colleague cannot write statutory numbers', ravi,
    format($q$select public.employee_set_statutory(%L, '{"pan":"ABCDE1234F"}')$q$, e), 'FORBIDDEN');
  perform pg_temp.st_refused('nor can the approver', mark,
    format($q$select public.employee_set_statutory(%L, '{"pan":"ABCDE1234F"}')$q$, e), 'FORBIDDEN');
  perform pg_temp.st_refused('nor Payroll, for Aadhaar', pay,
    format($q$select public.employee_set_statutory(%L, '{"aadhaar":%s}')$q$, e, to_json(aadhaar)), 'FORBIDDEN');
  perform pg_temp.st_refused('nor the person themselves', priya,
    format($q$select public.employee_set_statutory(%L, '{"pan":"ABCDE1234F"}')$q$, e), 'FORBIDDEN');

  perform pg_temp.st_run(hema, format($q$select public.employee_set_statutory(%L,
    jsonb_build_object('aadhaar', %L, 'pan', 'abcde 1234 f', 'uan', '1012 3456 7890',
                       'epfNumber', 'MH/BAN/0000064/000/0000125', 'esicNumber', '3100123456',
                       'identityDocumentType', 'aadhaar'))$q$,
    e, substr(aadhaar, 1, 4) || ' ' || substr(aadhaar, 5, 4) || ' ' || substr(aadhaar, 9)));
  perform pg_temp.st_ok('an Admin records the numbers, typed with spaces and slashes');

  perform pg_temp.st_refused('a wrong Aadhaar check digit is refused', hema,
    format($q$select public.employee_set_statutory(%L, '{"aadhaar":"%s"}')$q$, e_ravi,
           substr(aadhaar, 1, 11) || ((substr(aadhaar, 12, 1)::int + 1) % 10)), 'INVALID_AADHAAR');
  perform pg_temp.st_refused('an Aadhaar starting with 1 is refused', hema,
    format($q$select public.employee_set_statutory(%L, '{"aadhaar":"123456789012"}')$q$, e_ravi), 'INVALID_AADHAAR');
  perform pg_temp.st_refused('a malformed PAN is refused', hema,
    format($q$select public.employee_set_statutory(%L, '{"pan":"ABCD12345F"}')$q$, e_ravi), 'INVALID_PAN');
  perform pg_temp.st_refused('an unknown field is refused, not ignored', hema,
    format($q$select public.employee_set_statutory(%L, '{"aadhar":"x"}')$q$, e_ravi), 'UNKNOWN_FIELD');
  perform pg_temp.st_refused('the same Aadhaar twice in one company is refused', hema,
    format($q$select public.employee_set_statutory(%L, '{"aadhaar":"%s"}')$q$, e_ravi, aadhaar),
    'AADHAAR_ALREADY_RECORDED');
  perform pg_temp.st_run(bob, format($q$select public.employee_set_statutory(%L, '{"aadhaar":"%s"}')$q$,
    e_sara, aadhaar));
  perform pg_temp.st_ok('the same Aadhaar in another company is that company''s business');
  perform pg_temp.st_refused('another company''s person is NOT_FOUND', bob,
    format($q$select public.employee_set_statutory(%L, '{"pan":"ABCDE1234F"}')$q$, e), 'NOT_FOUND');

  perform pg_temp.st_refused('Statutory cannot write verification', stat,
    format($q$select public.employee_set_statutory(%L, '{"policeVerification":"verified"}')$q$, e), 'FORBIDDEN');
  perform pg_temp.st_run(hema, format($q$select public.employee_set_statutory(%L,
    '{"policeVerification":"verified","policeVerifiedOn":"2024-05-01"}')$q$, e));
  perform pg_temp.st_run(stat, format($q$select public.employee_set_statutory(%L, '{"oldUan":"100000000001"}')$q$, e));
  perform pg_temp.st_ok('Statutory records numbers; an Admin records verification');

  perform pg_temp.st_refused('an Admin cannot write bank details', hema,
    format($q$select public.employee_set_bank(%L, '{"account":"%s"}')$q$, e, account), 'FORBIDDEN');
  perform pg_temp.st_refused('a malformed IFSC is refused', pay,
    format($q$select public.employee_set_bank(%L, '{"ifsc":"HDFC1234567"}')$q$, e), 'INVALID_IFSC');
  perform pg_temp.st_refused('an account with letters is refused', pay,
    format($q$select public.employee_set_bank(%L, '{"account":"12AB5678901"}')$q$, e), 'INVALID_ACCOUNT');
  perform pg_temp.st_run(pay, format($q$select public.employee_set_bank(%L, jsonb_build_object(
    'bankName','HDFC Bank','branch','Yelahanka','account',%L,'ifsc','hdfc0001234',
    'accountHolder','PRIYA E','pennyDropStatus','verified'))$q$, e, account));
  perform pg_temp.st_ok('Payroll records the bank');

  perform pg_temp.st_refused('an Admin cannot write restricted data', hema,
    format($q$select public.employee_set_restricted(%L, '{"religion":"x"}')$q$, e), 'FORBIDDEN');
  perform pg_temp.st_refused('nor Payroll', pay,
    format($q$select public.employee_set_restricted(%L, '{"religion":"x"}')$q$, e), 'FORBIDDEN');
  perform pg_temp.st_refused('a caste category off the list is refused', stat,
    format($q$select public.employee_set_restricted(%L, '{"casteCategory":"other"}')$q$, e), 'INVALID_VALUE');
  perform pg_temp.st_run(stat, format($q$select public.employee_set_restricted(%L,
    '{"religion":"Hindu","casteCategory":"obc","disabilityStatus":"none"}')$q$, e));
  perform pg_temp.st_ok('Statutory records restricted data');

  -- ── 2 · at rest it is ciphertext, and the audit trail holds no value
  select count(*) into n from public.employee_statutory
   where employee_id = e
     and (position(convert_to(aadhaar, 'UTF8') in aadhaar_cipher) > 0
          or position(convert_to('ABCDE1234F', 'UTF8') in pan_cipher) > 0
          or aadhaar_last4 <> right(aadhaar, 4) or pan_last4 <> '234F');
  if n <> 0 then raise exception 'STATUTORY FAIL: plaintext at rest, or a wrong last four'; end if;
  select count(*) into n from public.employee_bank
   where employee_id = e and (position(convert_to(account, 'UTF8') in account_cipher) > 0
                              or account_last4 <> '5678' or ifsc <> 'HDFC0001234');
  if n <> 0 then raise exception 'STATUTORY FAIL: the account is in clear at rest'; end if;
  select count(*) into n from public.employee_restricted
   where position(convert_to('Hindu', 'UTF8') in values_cipher) > 0;
  if n <> 0 then raise exception 'STATUTORY FAIL: restricted data in clear at rest'; end if;
  perform pg_temp.st_ok('every number is ciphertext at rest, with the right last four');

  select count(*) into n from public.audit_logs
   where coalesce(before::text, '') || coalesce(after::text, '') like any
         (array['%' || aadhaar || '%', '%ABCDE1234F%', '%' || account || '%', '%Hindu%', '%\\x%']);
  if n <> 0 then
    raise exception 'STATUTORY FAIL: % audit rows carry a value or ciphertext', n;
  end if;
  select count(*) into n from public.audit_logs
   where entity_type = 'employee_statutory' and entity_id = e
     and after -> 'fieldsChanged' ? 'aadhaar';
  if n = 0 then raise exception 'STATUTORY FAIL: the Aadhaar write left no audit row'; end if;
  perform pg_temp.st_ok('the audit trail says which fields changed, and never a value');

  -- ── 3 · the card, per role (§5)
  foreach role_ in array array['self','admin','payroll','statutory','approver','colleague'] loop
    c := pg_temp.st_card(case role_ when 'self' then priya when 'admin' then hema
                          when 'payroll' then pay when 'statutory' then stat
                          when 'approver' then mark else ravi end, e);
    if c::text like any (array['%' || aadhaar || '%', '%ABCDE1234F%', '%' || account || '%', '%Hindu%']) then
      raise exception 'STATUTORY FAIL: the % card carries a full Aadhaar, PAN, account or restricted value', role_;
    end if;
    if (c ? 'statutory') <> (role_ in ('self','admin','payroll','statutory')) then
      raise exception 'STATUTORY FAIL: statutory block wrong for %', role_;
    end if;
    if (c ? 'bank') <> (role_ in ('self','payroll')) then
      raise exception 'STATUTORY FAIL: bank block wrong for %', role_;
    end if;
    if (c ? 'verification') <> (role_ in ('self','admin','statutory')) then
      raise exception 'STATUTORY FAIL: verification block wrong for %', role_;
    end if;
    if (c ? 'restricted') <> (role_ in ('self','statutory')) then
      raise exception 'STATUTORY FAIL: restricted block wrong for %', role_;
    end if;
    if c ? 'statutory' then
      if (c -> 'statutory' ? 'uan') <> (role_ in ('payroll','statutory')) then
        raise exception 'STATUTORY FAIL: full UAN wrong for %', role_;
      end if;
      if c -> 'statutory' ->> 'aadhaarLast4' is distinct from right(aadhaar, 4) then
        raise exception 'STATUTORY FAIL: % does not get the Aadhaar last four', role_;
      end if;
    end if;
    if c ? 'bank' and ((c -> 'bank' ? 'branch') <> (role_ = 'payroll')) then
      raise exception 'STATUTORY FAIL: bank detail wrong for %', role_;
    end if;
  end loop;
  c := pg_temp.st_card(pay, e);
  if c -> 'statutory' ->> 'uan' is distinct from '101234567890' or c -> 'statutory' ->> 'epfNumber' is distinct from 'MHBAN00000640000000125' then
    raise exception 'STATUTORY FAIL: Payroll''s full UAN/EPF are wrong: %', c -> 'statutory';
  end if;
  perform pg_temp.st_ok('the card gives each role exactly its §5 blocks, and no full Aadhaar, PAN or account to anybody');

  -- ── 4 · the reveal
  select count(*) into n from public.restricted_reads where employee_id = e;
  r := pg_temp.st_reveal(stat, e, array['aadhaar','pan'], 'ECR filing for September');
  if r ->> 'aadhaar' is distinct from aadhaar or r ->> 'pan' is distinct from 'ABCDE1234F' then
    raise exception 'STATUTORY FAIL: the reveal returned %', r;
  end if;
  select count(*) into n2 from public.restricted_reads
   where employee_id = e and reader_id = stat and fields = array['aadhaar','pan']
     and reason = 'ECR filing for September';
  if n2 <> 1 then raise exception 'STATUTORY FAIL: the reveal wrote % log rows', n2; end if;
  perform pg_temp.st_ok('Statutory reveals Aadhaar and PAN, and the look is logged with its reason');

  select count(*) into n from public.restricted_reads;
  perform pg_temp.st_refused('a reveal without a reason is refused', stat,
    format($q$select public.employee_reveal_restricted(%L, '{aadhaar}', '  ')$q$, e), 'REASON_REQUIRED');
  perform pg_temp.st_refused('an Admin cannot reveal Aadhaar', alice,
    format($q$select public.employee_reveal_restricted(%L, '{aadhaar}', 'checking')$q$, e), 'FORBIDDEN');
  perform pg_temp.st_refused('Payroll cannot reveal Aadhaar', pay,
    format($q$select public.employee_reveal_restricted(%L, '{aadhaar}', 'checking')$q$, e), 'FORBIDDEN');
  perform pg_temp.st_refused('Statutory cannot reveal the bank account', stat,
    format($q$select public.employee_reveal_restricted(%L, '{bank_account}', 'checking')$q$, e), 'FORBIDDEN');
  perform pg_temp.st_refused('one forbidden field refuses the whole reveal', pay,
    format($q$select public.employee_reveal_restricted(%L, '{bank_account,aadhaar}', 'checking')$q$, e), 'FORBIDDEN');
  perform pg_temp.st_refused('the person cannot reveal their own Aadhaar', priya,
    format($q$select public.employee_reveal_restricted(%L, '{aadhaar}', 'checking')$q$, e), 'FORBIDDEN');
  perform pg_temp.st_refused('an unknown field is refused', stat,
    format($q$select public.employee_reveal_restricted(%L, '{aadhar}', 'checking')$q$, e), 'UNKNOWN_FIELD');
  perform pg_temp.st_refused('another company''s person is NOT_FOUND', bob,
    format($q$select public.employee_reveal_restricted(%L, '{aadhaar}', 'checking')$q$, e), 'NOT_FOUND');
  select count(*) into n2 from public.restricted_reads;
  if n2 <> n then raise exception 'STATUTORY FAIL: a refused reveal left % log rows', n2 - n; end if;
  perform pg_temp.st_ok('a refused reveal logs nothing and shows nothing');

  r := pg_temp.st_reveal(pay, e, array['bank_account'], 'salary bounced');
  if r ->> 'bankAccount' is distinct from account then raise exception 'STATUTORY FAIL: Payroll got %', r; end if;
  r := pg_temp.st_reveal(priya, e, array['religion','caste_category'], 'checking my record');
  if r ->> 'religion' is distinct from 'Hindu' or r ->> 'casteCategory' is distinct from 'obc' then
    raise exception 'STATUTORY FAIL: the person''s own restricted data came back as %', r;
  end if;
  perform pg_temp.st_ok('Payroll reveals the account; a person reveals their own restricted data');

  -- ── 5 · the log: append-only, readable by the person, a Super Admin and Statutory
  perform pg_temp.st_refused('the reveal log cannot be edited', null,
    'update public.restricted_reads set reason = ''x''', 'REVEAL_LOG_IS_APPEND_ONLY');
  perform pg_temp.st_refused('or deleted', null,
    'delete from public.restricted_reads', 'REVEAL_LOG_IS_APPEND_ONLY');
  perform pg_temp.st_refused('nobody signed in reads the log table directly', alice,
    'select count(*) from public.restricted_reads', 'permission denied');
  perform pg_temp.st_refused('or a restricted table', stat,
    'select count(*) from public.employee_statutory', 'permission denied');
  perform pg_temp.st_as(priya);
  select count(*) into n from public.employee_restricted_reads(e);
  perform pg_temp.st_root();
  if n <> 3 then raise exception 'STATUTORY FAIL: Priya sees % looks at her record, expected 3', n; end if;
  perform pg_temp.st_as(alice);
  select count(*) into n from public.employee_restricted_reads(e);
  perform pg_temp.st_root();
  if n <> 3 then raise exception 'STATUTORY FAIL: the Super Admin sees % looks', n; end if;
  perform pg_temp.st_refused('an Admin who is not Super Admin does not see who looked', hema,
    format('select * from public.employee_restricted_reads(%L)', e), 'FORBIDDEN');
  perform pg_temp.st_ok('the person and a Super Admin see who looked');

  -- ── 6 · module off
  update public.organization_modules set enabled = false
   where organization_id = acme and module_key = 'employee';
  perform pg_temp.st_refused('module off: no reveal', stat,
    format($q$select public.employee_reveal_restricted(%L, '{aadhaar}', 'checking')$q$, e),
    'MODULE_NOT_ENABLED');
end $$;

rollback;
