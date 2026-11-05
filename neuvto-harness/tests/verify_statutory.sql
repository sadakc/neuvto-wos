-- NEUVTO WOS — statutory numbers, bank and restricted data (E6, D80, D84, D85)
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
  dan    uuid := '00000000-0000-0000-0000-00000000a003';  -- Employee Admin only (D84), below
  mark   uuid := '00000000-0000-0000-0000-00000000a004';  -- Priya's approver; Leave Admin below
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
  insert into public.module_admins (organization_id, user_id, module_key) values
    (acme, dan, 'employee'), (acme, mark, 'leave');
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
  -- mark is a Leave Admin as well as the approver: administering Leave is not
  -- administering the employee record.
  perform pg_temp.st_refused('nor a Leave Admin', mark,
    format($q$select public.employee_set_statutory(%L, '{"pan":"ABCDE1234F"}')$q$, e_ravi), 'FORBIDDEN');
  perform pg_temp.st_run(dan, format($q$select public.employee_set_statutory(%L, '{"esicNumber":"3100999999"}')$q$, e_ravi));
  perform pg_temp.st_ok('an Employee Admin who is not a company-wide Admin records numbers');

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

  perform pg_temp.st_refused('a colleague cannot write bank details', ravi,
    format($q$select public.employee_set_bank(%L, '{"account":"%s"}')$q$, e, account), 'FORBIDDEN');
  perform pg_temp.st_refused('nor a Leave Admin', mark,
    format($q$select public.employee_set_bank(%L, '{"account":"%s"}')$q$, e, account), 'FORBIDDEN');
  perform pg_temp.st_refused('nor the person themselves', priya,
    format($q$select public.employee_set_bank(%L, '{"account":"%s"}')$q$, e, account), 'FORBIDDEN');
  perform pg_temp.st_run(dan, format($q$select public.employee_set_bank(%L, '{"account":"009988776655","ifsc":"SBIN0001234"}')$q$, e_ravi));
  perform pg_temp.st_ok('an Employee Admin records bank details (D85)');
  perform pg_temp.st_refused('a malformed IFSC is refused', pay,
    format($q$select public.employee_set_bank(%L, '{"ifsc":"HDFC1234567"}')$q$, e), 'INVALID_IFSC');
  perform pg_temp.st_refused('an account with letters is refused', pay,
    format($q$select public.employee_set_bank(%L, '{"account":"12AB5678901"}')$q$, e), 'INVALID_ACCOUNT');
  perform pg_temp.st_run(pay, format($q$select public.employee_set_bank(%L, jsonb_build_object(
    'bankName','HDFC Bank','branch','Yelahanka','account',%L,'ifsc','hdfc0001234',
    'accountHolder','PRIYA E','pennyDropStatus','verified'))$q$, e, account));
  perform pg_temp.st_ok('Payroll records the bank');

  perform pg_temp.st_refused('the person cannot write their own restricted data', priya,
    format($q$select public.employee_set_restricted(%L, '{"religion":"x"}')$q$, e), 'FORBIDDEN');
  perform pg_temp.st_refused('nor a Leave Admin', mark,
    format($q$select public.employee_set_restricted(%L, '{"religion":"x"}')$q$, e), 'FORBIDDEN');
  perform pg_temp.st_run(dan, format($q$select public.employee_set_restricted(%L, '{"disabilityStatus":"not_disclosed"}')$q$, e_ravi));
  perform pg_temp.st_ok('an Employee Admin records restricted data (D85)');
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
  -- 'admin' is hema, a company-wide Admin; 'employee_admin' is dan, an
  -- Employee Admin only (D84). They must see exactly the same.
  foreach role_ in array array['self','admin','employee_admin','payroll','statutory','approver','colleague'] loop
    c := pg_temp.st_card(case role_ when 'self' then priya when 'admin' then hema
                          when 'employee_admin' then dan
                          when 'payroll' then pay when 'statutory' then stat
                          when 'approver' then mark else ravi end, e);
    if c::text like any (array['%' || aadhaar || '%', '%ABCDE1234F%', '%' || account || '%', '%Hindu%']) then
      raise exception 'STATUTORY FAIL: the % card carries a full Aadhaar, PAN, account or restricted value', role_;
    end if;
    if (c ? 'statutory') <> (role_ in ('self','admin','employee_admin','payroll','statutory')) then
      raise exception 'STATUTORY FAIL: statutory block wrong for %', role_;
    end if;
    if (c ? 'bank') <> (role_ in ('self','admin','employee_admin','payroll')) then
      raise exception 'STATUTORY FAIL: bank block wrong for %', role_;
    end if;
    if (c ? 'verification') <> (role_ in ('self','admin','employee_admin','statutory')) then
      raise exception 'STATUTORY FAIL: verification block wrong for %', role_;
    end if;
    if (c ? 'restricted') <> (role_ in ('self','admin','employee_admin','statutory')) then
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
    if c ? 'bank' and ((c -> 'bank' ? 'branch') <> (role_ in ('payroll','admin','employee_admin'))) then
      raise exception 'STATUTORY FAIL: bank detail wrong for %', role_;
    end if;
    -- The eye (D85): the Employee Admin opens numbers, bank and restricted;
    -- the person never opens their own.
    if (c -> 'capabilities' ->> 'canRevealStatutory')::boolean <> (role_ in ('admin','employee_admin','statutory'))
       or (c -> 'capabilities' ->> 'canRevealBank')::boolean <> (role_ in ('admin','employee_admin','payroll'))
       or (c -> 'capabilities' ->> 'canRevealRestricted')::boolean <> (role_ in ('admin','employee_admin','statutory'))
       or (c -> 'capabilities' ->> 'canEditBank')::boolean <> (role_ in ('admin','employee_admin','payroll'))
       or (c -> 'capabilities' ->> 'canEditRestricted')::boolean <> (role_ in ('admin','employee_admin','statutory')) then
      raise exception 'STATUTORY FAIL: the eye is offered wrongly to %: %', role_, c -> 'capabilities';
    end if;
  end loop;
  c := pg_temp.st_card(pay, e);
  if c -> 'statutory' ->> 'uan' is distinct from '101234567890' or c -> 'statutory' ->> 'epfNumber' is distinct from 'MHBAN00000640000000125' then
    raise exception 'STATUTORY FAIL: Payroll''s full UAN/EPF are wrong: %', c -> 'statutory';
  end if;
  c := pg_temp.st_card(hema, e);
  if c -> 'statutory' ? 'uan' or c -> 'statutory' ->> 'uanLast4' is distinct from '7890' then
    raise exception 'STATUTORY FAIL: the Admin''s card should show the UAN''s last four only: %', c -> 'statutory';
  end if;
  perform pg_temp.st_ok('the card gives each role exactly its blocks, and no full Aadhaar, PAN or account to anybody');

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

  -- D85: the eye. No reason asked; the look is still logged before the value
  -- comes back.
  r := pg_temp.st_reveal(hema, e, array['aadhaar','pan','uan','epf_number','esic_number','old_uan','bank_account'], null);
  if r ->> 'aadhaar' is distinct from aadhaar or r ->> 'pan' is distinct from 'ABCDE1234F'
     or r ->> 'uan' is distinct from '101234567890' or r ->> 'epfNumber' is distinct from 'MHBAN00000640000000125'
     or r ->> 'esicNumber' is distinct from '3100123456' or r ->> 'oldUan' is distinct from '100000000001'
     or r ->> 'bankAccount' is distinct from account then
    raise exception 'STATUTORY FAIL: the Admin''s eye returned %', r;
  end if;
  select count(*) into n2 from public.restricted_reads
   where employee_id = e and reader_id = hema and reason is null
     and fields = array['aadhaar','bank_account','epf_number','esic_number','old_uan','pan','uan'];
  if n2 <> 1 then raise exception 'STATUTORY FAIL: the Admin''s look wrote % log rows', n2; end if;
  r := pg_temp.st_reveal(dan, e, array['religion','disability'], '   ');
  if r ->> 'religion' is distinct from 'Hindu' or r ->> 'disabilityStatus' is distinct from 'none' then
    raise exception 'STATUTORY FAIL: the Employee Admin''s eye returned %', r;
  end if;
  if not exists (select 1 from public.restricted_reads where reader_id = dan and reason is null) then
    raise exception 'STATUTORY FAIL: a blank reason was not kept as no reason';
  end if;
  perform pg_temp.st_ok('an Employee Admin opens every number, the account and restricted data with no reason, and each look is logged');

  select count(*) into n from public.restricted_reads;
  perform pg_temp.st_refused('a Leave Admin cannot open a number', mark,
    format($q$select public.employee_reveal_restricted(%L, '{uan}')$q$, e), 'FORBIDDEN');
  perform pg_temp.st_refused('a colleague cannot open a number', ravi,
    format($q$select public.employee_reveal_restricted(%L, '{pan}')$q$, e), 'FORBIDDEN');
  perform pg_temp.st_refused('Payroll cannot reveal Aadhaar', pay,
    format($q$select public.employee_reveal_restricted(%L, '{aadhaar}', 'checking')$q$, e), 'FORBIDDEN');
  perform pg_temp.st_refused('Statutory cannot reveal the bank account', stat,
    format($q$select public.employee_reveal_restricted(%L, '{bank_account}', 'checking')$q$, e), 'FORBIDDEN');
  perform pg_temp.st_refused('one forbidden field refuses the whole reveal', pay,
    format($q$select public.employee_reveal_restricted(%L, '{bank_account,aadhaar}', 'checking')$q$, e), 'FORBIDDEN');
  perform pg_temp.st_refused('the person cannot reveal their own Aadhaar', priya,
    format($q$select public.employee_reveal_restricted(%L, '{aadhaar}', 'checking')$q$, e), 'FORBIDDEN');
  perform pg_temp.st_refused('nor their own UAN', priya,
    format($q$select public.employee_reveal_restricted(%L, '{uan}')$q$, e), 'FORBIDDEN');
  perform pg_temp.st_refused('nor their own restricted data (D85)', priya,
    format($q$select public.employee_reveal_restricted(%L, '{religion}')$q$, e), 'FORBIDDEN');
  perform pg_temp.st_refused('Payroll cannot open restricted data', pay,
    format($q$select public.employee_reveal_restricted(%L, '{religion}')$q$, e), 'FORBIDDEN');
  perform pg_temp.st_refused('an unknown field is refused', stat,
    format($q$select public.employee_reveal_restricted(%L, '{aadhar}', 'checking')$q$, e), 'UNKNOWN_FIELD');
  perform pg_temp.st_refused('another company''s person is NOT_FOUND', bob,
    format($q$select public.employee_reveal_restricted(%L, '{aadhaar}', 'checking')$q$, e), 'NOT_FOUND');
  select count(*) into n2 from public.restricted_reads;
  if n2 <> n then raise exception 'STATUTORY FAIL: a refused reveal left % log rows', n2 - n; end if;
  perform pg_temp.st_ok('a refused reveal logs nothing and shows nothing');

  r := pg_temp.st_reveal(pay, e, array['bank_account'], 'salary bounced');
  if r ->> 'bankAccount' is distinct from account then raise exception 'STATUTORY FAIL: Payroll got %', r; end if;
  r := pg_temp.st_reveal(stat, e, array['religion','caste_category'], 'checking the record');
  if r ->> 'religion' is distinct from 'Hindu' or r ->> 'casteCategory' is distinct from 'obc' then
    raise exception 'STATUTORY FAIL: Statutory''s restricted data came back as %', r;
  end if;
  perform pg_temp.st_ok('Payroll reveals the account; Statutory reveals restricted data');

  -- ── 5 · the log: append-only, readable by the person, a Super Admin and Statutory
  perform pg_temp.st_refused('the reveal log cannot be edited', null,
    'update public.restricted_reads set reason = ''x''', 'REVEAL_LOG_IS_APPEND_ONLY');
  perform pg_temp.st_refused('or deleted', null,
    'delete from public.restricted_reads', 'REVEAL_LOG_IS_APPEND_ONLY');
  perform pg_temp.st_refused('nobody signed in reads the log table directly', alice,
    'select count(*) from public.restricted_reads', 'permission denied');
  perform pg_temp.st_refused('or a restricted table', stat,
    'select count(*) from public.employee_statutory', 'permission denied');
  select count(*) into n2 from public.restricted_reads where employee_id = e;
  perform pg_temp.st_as(priya);
  select count(*) into n from public.employee_restricted_reads(e);
  perform pg_temp.st_root();
  if n is distinct from n2 or n2 < 5 then
    raise exception 'STATUTORY FAIL: Priya sees % looks at her record, expected %', n, n2;
  end if;
  perform pg_temp.st_as(alice);
  select count(*) into n from public.employee_restricted_reads(e);
  perform pg_temp.st_root();
  if n is distinct from n2 then raise exception 'STATUTORY FAIL: the Super Admin sees % looks', n; end if;
  perform pg_temp.st_refused('an Admin who is not Super Admin does not see who looked', hema,
    format('select * from public.employee_restricted_reads(%L)', e), 'FORBIDDEN');
  perform pg_temp.st_ok('the person and a Super Admin see who looked');

  -- ── 6 · rotating the key changes every cipher and no value
  if to_regprocedure('public.statutory_rotate_key()') is not null then
    perform pg_temp.st_refused('nobody signed in can rotate the key', alice,
      'select public.statutory_rotate_key()', 'permission denied');
    perform pg_temp.st_refused('rotating needs the next key first', null,
      'select public.statutory_rotate_key()', 'NEXT_KEY_NOT_SET');
    select aadhaar_cipher::text into role_ from public.employee_statutory where employee_id = e;
    select count(*) into n from public.audit_logs;
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'statutory_encryption_key_next');
    r := public.statutory_rotate_key();
    if (r ->> 'statutoryRows')::int is distinct from 3 then
      raise exception 'STATUTORY FAIL: rotation reports %', r;
    end if;
    if (select aadhaar_cipher::text from public.employee_statutory where employee_id = e) = role_ then
      raise exception 'STATUTORY FAIL: the Aadhaar cipher did not change';
    end if;
    if pg_temp.st_reveal(stat, e, array['aadhaar'], 'after rotation') ->> 'aadhaar' is distinct from aadhaar
       or pg_temp.st_reveal(pay, e, array['bank_account'], 'after rotation') ->> 'bankAccount' is distinct from account
       or pg_temp.st_reveal(hema, e, array['religion'], null) ->> 'religion' is distinct from 'Hindu'
       or pg_temp.st_card(pay, e) -> 'statutory' ->> 'uan' is distinct from '101234567890' then
      raise exception 'STATUTORY FAIL: a value read differently after rotation';
    end if;
    perform pg_temp.st_refused('the keyed index still refuses a duplicate Aadhaar after rotation', hema,
      format($q$select public.employee_set_statutory(%L, '{"aadhaar":"%s"}')$q$, e_ravi, aadhaar),
      'AADHAAR_ALREADY_RECORDED');
    if not exists (select 1 from vault.secrets where name like 'statutory_encryption_key_retired_%')
       or exists (select 1 from vault.secrets where name = 'statutory_encryption_key_next') then
      raise exception 'STATUTORY FAIL: the old key was not kept, or the next key was not promoted';
    end if;
    -- One summary row per company, not one per person.
    if (select count(*) from public.audit_logs where entity_type in ('employee_statutory','employee_bank','employee_restricted')
          and created_at = now()) > 0 and (select count(*) from public.audit_logs) - n > 3 then
      raise exception 'STATUTORY FAIL: rotation wrote % audit rows', (select count(*) from public.audit_logs) - n;
    end if;
    raise notice 'ok: rotating the key changes every cipher and no value, and keeps the old key';
  end if;

  -- ── 7 · the reveal log keeps three years, and not a day less
  if to_regprocedure('public.restricted_reads_prune()') is not null then
    insert into public.restricted_reads (organization_id, reader_id, employee_id, fields, reason, read_at)
    values (acme, stat, e, '{aadhaar}', 'an old look', now() - interval '3 years 1 day'),
           (acme, stat, e, '{aadhaar}', 'a recent look', now() - interval '2 years 11 months');
    -- Two statements: one expression would read the table in the snapshot
    -- taken before the prune deleted anything.
    n := public.restricted_reads_prune();
    if n is distinct from 1
       or exists (select 1 from public.restricted_reads where reason = 'an old look')
       or not exists (select 1 from public.restricted_reads where reason = 'a recent look') then
      raise exception 'STATUTORY FAIL: retention did not remove exactly the look older than three years';
    end if;
    perform set_config('neuvto.retention', 'on', true);
    begin
      delete from public.restricted_reads where reason = 'a recent look';
      raise exception 'STATUTORY FAIL: the retention flag erased a recent look';
    exception when others then
      if sqlerrm not like '%REVEAL_LOG_IS_APPEND_ONLY%' then raise; end if;
    end;
    perform set_config('neuvto.retention', '', true);
    perform pg_temp.st_refused('nobody signed in can prune the log', alice,
      'select public.restricted_reads_prune()', 'permission denied');
    raise notice 'ok: the reveal log keeps three years, and the retention escape cannot erase a younger look';
  end if;

  -- ── 8 · module off
  update public.organization_modules set enabled = false
   where organization_id = acme and module_key = 'employee';
  perform pg_temp.st_refused('module off: no reveal', stat,
    format($q$select public.employee_reveal_restricted(%L, '{aadhaar}', 'checking')$q$, e),
    'MODULE_NOT_ENABLED');
end $$;

rollback;
