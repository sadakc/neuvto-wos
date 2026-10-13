-- NEUVTO WOS — Sada's third round (D105): postings, nominations, numbers
--
-- Raises on the first violation. Silence means pass. Rolled back.
--
-- PHASE-AWARE: exits quietly if record_withdrawals does not exist yet.
--
--   moving        the current posting can end on its own day and the next
--                 start later; a start on or before that end, or an end
--                 before the posting began, is refused;
--   current       is the posting covering today, so a move dated ahead
--                 leaves today's unit on the card and the directory, with
--                 the next one beside it;
--   removing      only an Admin, only with a reason, only the latest; the row
--                 is kept with who and why, the posting it cut short carries
--                 on, and nothing else can be deleted on the way;
--   nominating    one nomination for every scheme; saving again the same day
--                 corrects it, keeping the first; older per-scheme ones close;
--   numbers       an old UAN or ESIC that is the current one is refused; a
--                 licence number is encrypted, shown as its last four, opened
--                 like any other number.

begin;

create or replace function pg_temp.tr_as(_uid uuid) returns void as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', _uid::text, 'role', 'authenticated')::text, true);
end $$ language plpgsql;

create or replace function pg_temp.tr_root() returns void as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$ language plpgsql;

/** Refused, and for the named reason: the message, its detail or the rule it broke. */
create or replace function pg_temp.tr_refused(_label text, _uid uuid, _sql text, _needle text)
returns void as $$
declare v_msg text; v_detail text; v_rule text;
begin
  if _uid is null then perform pg_temp.tr_root(); else perform pg_temp.tr_as(_uid); end if;
  begin
    execute _sql;
  exception when others then
    get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail, v_rule = constraint_name;
  end;
  perform pg_temp.tr_root();
  if v_msg is null then
    raise exception 'ROUND3 FAIL: % — it was allowed', _label;
  end if;
  if concat_ws(' ', v_msg, v_detail, v_rule) not ilike '%' || _needle || '%' then
    raise exception 'ROUND3 FAIL: % — refused for the wrong reason: % / % / %', _label, v_msg, v_detail, v_rule;
  end if;
  raise notice 'ok: %', _label;
end $$ language plpgsql;

create or replace function pg_temp.tr_do(_uid uuid, _sql text) returns void as $$
begin
  perform pg_temp.tr_as(_uid);
  execute _sql;
  perform pg_temp.tr_root();
exception when others then
  perform pg_temp.tr_root();
  raise exception 'ROUND3 FAIL: refused: % — %', _sql, sqlerrm;
end $$ language plpgsql;

create or replace function pg_temp.tr_val(_uid uuid, _sql text) returns text as $$
declare v text;
begin
  perform pg_temp.tr_as(_uid);
  execute _sql into v;
  perform pg_temp.tr_root();
  return v;
exception when others then
  perform pg_temp.tr_root();
  raise exception 'ROUND3 FAIL: refused: % — %', _sql, sqlerrm;
end $$ language plpgsql;

do $$
declare
  acme    uuid := '00000000-0000-0000-0000-0000000000a0';
  hema    uuid := '00000000-0000-0000-0000-00000000a002';
  ravi    uuid := '00000000-0000-0000-0000-00000000a005';
  priya   uuid := '00000000-0000-0000-0000-00000000a006';
  e_priya uuid; u_a uuid; u_b uuid; u_c uuid; d_b uuid; d_c uuid;
  today date; seen text; n int;
begin
  if to_regclass('public.record_withdrawals') is null then
    raise notice 'skip: withdrawals do not exist yet';
    return;
  end if;

  insert into public.organization_modules (organization_id, module_key, enabled, enabled_at)
  values (acme, 'employee', true, now())
  on conflict (organization_id, module_key) do update set enabled = true, deleted_at = null;
  select id into e_priya from public.employees where profile_id = priya;
  today := public.org_today(acme);
  insert into public.deployment_units (organization_id, name, unit_type) values (acme, 'R3 Alpha', 'own_establishment') returning id into u_a;
  insert into public.deployment_units (organization_id, name, unit_type) values (acme, 'R3 Bravo', 'own_establishment') returning id into u_b;
  insert into public.deployment_units (organization_id, name, unit_type) values (acme, 'R3 Charlie', 'own_establishment') returning id into u_c;

  -- ── moving: end one posting, start the next later
  perform pg_temp.tr_do(hema, format($q$select public.employee_move_unit(%L, jsonb_build_object(
    'unitId', %L, 'effectiveFrom', %L, 'orderRef', 'DO/1'))$q$, e_priya, u_a, today - 30));
  perform pg_temp.tr_refused('a next posting starting on the day the last ends is refused', hema,
    format($q$select public.employee_move_unit(%L, jsonb_build_object(
      'unitId', %L, 'effectiveFrom', %L, 'currentEndsOn', %L, 'orderRef', 'DO/2'))$q$, e_priya, u_b, today - 10, today - 10),
    'STARTS_BEFORE_THE_LAST_ENDS');
  perform pg_temp.tr_refused('an end before the posting began is refused', hema,
    format($q$select public.employee_move_unit(%L, jsonb_build_object(
      'unitId', %L, 'effectiveFrom', %L, 'currentEndsOn', %L, 'orderRef', 'DO/2'))$q$, e_priya, u_b, today - 5, today - 40),
    'ENDS_BEFORE_IT_BEGAN');
  perform pg_temp.tr_do(hema, format($q$select public.employee_move_unit(%L, jsonb_build_object(
    'unitId', %L, 'effectiveFrom', %L, 'currentEndsOn', %L, 'orderRef', 'DO/2'))$q$, e_priya, u_b, today - 7, today - 10));
  if (select effective_to from public.employee_deployments where employee_id = e_priya and deployment_unit_id = u_a)
       is distinct from today - 9 then
    raise exception 'ROUND3 FAIL: Alpha should end on % (its last day), it ends on %', today - 10,
      (select effective_to - 1 from public.employee_deployments where employee_id = e_priya and deployment_unit_id = u_a);
  end if;
  if (select effective_from from public.employee_deployments where employee_id = e_priya and deployment_unit_id = u_b)
       is distinct from today - 7 then
    raise exception 'ROUND3 FAIL: Bravo did not start on the day chosen';
  end if;
  raise notice 'ok: a posting ends on its own last day and the next starts on a later one';

  -- ── current: a move dated ahead leaves today's unit in place
  perform pg_temp.tr_do(hema, format($q$select public.employee_move_unit(%L, jsonb_build_object(
    'unitId', %L, 'effectiveFrom', %L, 'orderRef', 'DO/3'))$q$, e_priya, u_c, today + 5));
  seen := pg_temp.tr_val(hema, format($q$select public.employee_card(%L) -> 'currentDeployment' ->> 'unitName'$q$, e_priya));
  if seen is distinct from 'R3 Bravo' then
    raise exception 'ROUND3 FAIL: with a move dated ahead the card says the current unit is %', seen;
  end if;
  seen := pg_temp.tr_val(hema, format($q$select public.employee_card(%L) -> 'nextDeployment' ->> 'unitName'$q$, e_priya));
  if seen is distinct from 'R3 Charlie' then
    raise exception 'ROUND3 FAIL: the card does not say where they go next (%)', seen;
  end if;
  seen := pg_temp.tr_val(hema, $q$select deployed_unit from public.employee_directory(null) where full_name = 'Priya Employee'$q$);
  if seen is distinct from 'R3 Bravo' then
    raise exception 'ROUND3 FAIL: the directory says the deployed unit is %', seen;
  end if;
  raise notice 'ok: today''s unit stays on the card and the directory until the next one starts';

  -- ── removing a posting added by mistake
  select id into d_b from public.employee_deployments where employee_id = e_priya and deployment_unit_id = u_b;
  select id into d_c from public.employee_deployments where employee_id = e_priya and deployment_unit_id = u_c;
  perform pg_temp.tr_refused('a colleague cannot remove a posting', ravi,
    format('select public.employee_withdraw_posting(%L, %L)', d_c, 'Wrong unit'), 'FORBIDDEN');
  perform pg_temp.tr_refused('a removal needs a reason', hema,
    format('select public.employee_withdraw_posting(%L, %L)', d_c, ' x '), 'REASON_REQUIRED');
  perform pg_temp.tr_refused('only the latest posting can be removed', hema,
    format('select public.employee_withdraw_posting(%L, %L)', d_b, 'Wrong unit'), 'NOT_THE_LATEST');
  perform pg_temp.tr_refused('a posting is still never deleted directly', null,
    format('delete from public.employee_deployments where id = %L', d_c), 'HISTORY_IS_NEVER_DELETED');
  perform pg_temp.tr_refused('naming one row does not let another be deleted', null,
    format($q$select set_config('neuvto.withdrawing', %L, true); delete from public.employee_deployments where id = %L$q$, d_c, d_b),
    'HISTORY_IS_NEVER_DELETED');
  perform set_config('neuvto.withdrawing', '', true);

  seen := pg_temp.tr_val(hema, format('select public.employee_withdraw_posting(%L, %L)::text', d_c, 'Sent to Charlie by mistake'));
  if seen::jsonb ->> 'resumed' is distinct from 'R3 Bravo' then
    raise exception 'ROUND3 FAIL: removing Charlie did not say Bravo carries on: %', seen;
  end if;
  if exists (select 1 from public.employee_deployments where id = d_c) then
    raise exception 'ROUND3 FAIL: the removed posting is still a posting';
  end if;
  if (select effective_to from public.employee_deployments where id = d_b) is not null then
    raise exception 'ROUND3 FAIL: Bravo was not carried on after Charlie was removed';
  end if;
  if not exists (select 1 from public.record_withdrawals
                  where employee_id = e_priya and kind = 'deployment' and reason = 'Sent to Charlie by mistake'
                    and withdrawn_by = hema and record ->> 'unitName' = 'R3 Charlie') then
    raise exception 'ROUND3 FAIL: the removed posting was not kept with who and why';
  end if;
  seen := pg_temp.tr_val(hema, format($q$select public.employee_card(%L) -> 'withdrawnPostings' -> 0 ->> 'reason'$q$, e_priya));
  if seen is distinct from 'Sent to Charlie by mistake' then
    raise exception 'ROUND3 FAIL: the Admin''s card does not list the removed posting';
  end if;
  seen := pg_temp.tr_val(priya, format($q$select (public.employee_card(%L) ? 'withdrawnPostings')::text$q$, e_priya));
  if seen is distinct from 'false' then
    raise exception 'ROUND3 FAIL: the person''s own card lists removed postings';
  end if;
  raise notice 'ok: a posting added by mistake is removed with a reason, kept, and the one it cut short carries on';

  -- ── one nomination for every scheme
  insert into public.nomination_versions (organization_id, employee_id, scheme, effective_from)
  values (acme, e_priya, 'esic', today - 100);
  insert into public.nominees (organization_id, version_id, name, relation, share_percent)
  select acme, id, 'Old ESIC', 'mother', 100 from public.nomination_versions
   where employee_id = e_priya and scheme = 'esic' and effective_to is null;
  perform pg_temp.tr_do(hema, format($q$select public.employee_save_nomination(%L, jsonb_build_object(
    'scheme', 'pf_and_gratuity', 'effectiveFrom', %L,
    'nominees', jsonb_build_array(jsonb_build_object('name', 'Ravi Kumar', 'relation', 'husband', 'dateOfBirth', '1988-02-01', 'sharePercent', 100))))$q$,
    e_priya, today));
  select count(*) into n from public.nomination_versions where employee_id = e_priya and effective_to is null;
  if n <> 1 or (select scheme from public.nomination_versions where employee_id = e_priya and effective_to is null) <> 'all' then
    raise exception 'ROUND3 FAIL: % open nominations, or the open one is not for every scheme', n;
  end if;
  raise notice 'ok: one nomination covers every scheme, and the older per-scheme one is closed';

  perform pg_temp.tr_do(hema, format($q$select public.employee_save_nomination(%L, jsonb_build_object(
    'scheme', 'esic', 'effectiveFrom', %L,
    'nominees', jsonb_build_array(jsonb_build_object('name', 'Lata Kumar', 'relation', 'mother', 'dateOfBirth', '1962-07-15', 'sharePercent', 100))))$q$,
    e_priya, today));
  select count(*) into n from public.nomination_versions where employee_id = e_priya and effective_to is null;
  seen := (select n2.name from public.nomination_versions v join public.nominees n2 on n2.version_id = v.id
            where v.employee_id = e_priya and v.effective_to is null);
  if n <> 1 or seen is distinct from 'Lata Kumar' then
    raise exception 'ROUND3 FAIL: a same-day correction left % open, naming %', n, seen;
  end if;
  if not exists (select 1 from public.record_withdrawals where employee_id = e_priya and kind = 'nomination'
                    and record -> 'nominees' -> 0 ->> 'name' = 'Ravi Kumar') then
    raise exception 'ROUND3 FAIL: the nomination corrected the same day was not kept';
  end if;
  perform pg_temp.tr_refused('a nominee is still never deleted directly', null,
    format('delete from public.nominees where name = %L', 'Lata Kumar'), 'NOMINATION_IS_VERSIONED');
  raise notice 'ok: saving again the same day corrects the nomination and keeps the first';

  -- ── numbers
  perform pg_temp.tr_refused('an old UAN that is the current UAN is refused', hema,
    format($q$select public.employee_set_statutory(%L, '{"uan":"100200300400","oldUan":"1002 0030 0400"}')$q$, e_priya),
    'OLD_UAN_IS_CURRENT');
  perform pg_temp.tr_do(hema, format($q$select public.employee_set_statutory(%L, '{"uan":"100200300400","esicNumber":"1234567890"}')$q$, e_priya));
  perform pg_temp.tr_refused('an old UAN matching the one on record is refused', hema,
    format($q$select public.employee_set_statutory(%L, '{"oldUan":"100200300400"}')$q$, e_priya),
    'OLD_UAN_IS_CURRENT');
  perform pg_temp.tr_refused('an old ESIC number matching the one on record is refused', hema,
    format($q$select public.employee_set_statutory(%L, '{"oldEsicNumber":"1234567890"}')$q$, e_priya),
    'OLD_ESIC_IS_CURRENT');
  perform pg_temp.tr_do(hema, format($q$select public.employee_set_statutory(%L, '{"oldUan":"100200300999"}')$q$, e_priya));
  raise notice 'ok: an old UAN or ESIC that is the current one is refused; a different one is kept';

  perform pg_temp.tr_refused('a licence number that cannot be one is refused', hema,
    format($q$select public.employee_set_statutory(%L, '{"drivingLicence":"12345"}')$q$, e_priya), 'INVALID_LICENCE');
  perform pg_temp.tr_do(hema, format($q$select public.employee_set_statutory(%L, '{"drivingLicence":"KA-01 2011 0012345"}')$q$, e_priya));
  if (select licence_last4 from public.employee_statutory where employee_id = e_priya) is distinct from '2345'
     or (select licence_cipher from public.employee_statutory where employee_id = e_priya)::text like '%KA01%' then
    raise exception 'ROUND3 FAIL: the licence number is not held encrypted with its last four';
  end if;
  seen := pg_temp.tr_val(hema, format($q$select public.employee_card(%L) -> 'statutory' ->> 'licenceLast4'$q$, e_priya));
  if seen is distinct from '2345' then raise exception 'ROUND3 FAIL: the card does not show the licence''s last four'; end if;
  seen := pg_temp.tr_val(hema, format($q$select public.employee_reveal_restricted(%L, array['driving_licence']) ->> 'drivingLicence'$q$, e_priya));
  if seen is distinct from 'KA012011001234' || '5' then raise exception 'ROUND3 FAIL: the licence opened as %', seen; end if;
  perform pg_temp.tr_refused('a colleague cannot open the licence number', ravi,
    format($q$select public.employee_reveal_restricted(%L, array['driving_licence'])$q$, e_priya), 'FORBIDDEN');
  raise notice 'ok: a licence number is encrypted, shown as its last four, and opened like any other number';
end $$;

rollback;
