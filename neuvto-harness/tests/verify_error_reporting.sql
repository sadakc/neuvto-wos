-- NEUVTO WOS — the error store keeps its promises
--
-- Raises on the first violation. Silence means pass.
--
-- These were all checked by hand on 4 Aug 2026 and all passed. That is exactly
-- why they are here: a check that ran once, in a session nobody can replay, is a
-- claim rather than a guarantee. Every one of them is a property somebody could
-- remove in a later migration without any other test noticing.
--
-- PHASE-AWARE: exits quietly if client_errors does not exist yet.

create or replace function pg_temp.err_check(_label text, _actual text, _expected text)
returns void as $$
begin
  if _actual is distinct from _expected then
    raise exception 'ERROR-STORE FAIL: % — expected %, got %', _label, _expected, _actual;
  end if;
  raise notice 'ok: %', _label;
end $$ language plpgsql;

do $$
declare
  v_count   bigint;
  v_msg     text;
  v_stack   text;
  v_len     integer;
begin
  if to_regclass('public.client_errors') is null then
    raise notice 'skip: client_errors does not exist yet';
    return;
  end if;

  delete from public.client_errors where fingerprint like 'harness-%';

  -- ── 1 · anon executes nothing, and this function is not an exception
  --
  -- The whole reason record_client_error is granted to `authenticated` and not
  -- `anon`: 20260808100000_anon_executes_nothing.sql, written after an
  -- anonymous caller could reach notify_address on production and queue mail
  -- from a verified domain. Widening this grant "just for error reporting" is
  -- the exact move that guarded against, so it is asserted rather than trusted.
  perform pg_temp.err_check(
    'anon holds no execute on record_client_error',
    (select case when has_function_privilege('anon',
        'public.record_client_error(text,text,text,text,text,text,text,text)', 'execute')
      then 'granted' else 'denied' end),
    'denied');

  perform pg_temp.err_check(
    'authenticated CAN call record_client_error',
    (select case when has_function_privilege('authenticated',
        'public.record_client_error(text,text,text,text,text,text,text,text)', 'execute')
      then 'granted' else 'denied' end),
    'granted');

  -- ── 2 · the table is unreachable from a browser, by any role
  --
  -- RLS with zero policies plus no grant. Either one alone would be enough;
  -- both are asserted because a later migration adding a "convenience" policy
  -- would silently open it.
  perform pg_temp.err_check('client_errors has RLS enabled',
    (select case when relrowsecurity then 'on' else 'off' end
       from pg_class where oid = 'public.client_errors'::regclass), 'on');

  perform pg_temp.err_check('client_errors has no policies',
    (select count(*)::text from pg_policies
      where schemaname = 'public' and tablename = 'client_errors'), '0');

  perform pg_temp.err_check('no table grants to anon or authenticated',
    (select count(*)::text from information_schema.role_table_grants
      where table_name = 'client_errors' and grantee in ('anon', 'authenticated')), '0');

  -- ── 3 · repeats increment, they do not insert
  --
  -- The design that stops a render loop filling a 500MB free-tier database.
  -- Without it, one crash in a hot component is an outage of its own.
  perform public.record_client_error('harness-repeat', 'the same fault', 'boundary');
  perform public.record_client_error('harness-repeat', 'the same fault', 'boundary');
  perform public.record_client_error('harness-repeat', 'the same fault', 'boundary');

  select count(*) into v_count from public.client_errors where fingerprint = 'harness-repeat';
  perform pg_temp.err_check('three reports of one fault make one row', v_count::text, '1');

  select occurrences into v_count from public.client_errors where fingerprint = 'harness-repeat';
  perform pg_temp.err_check('and that row counts three', v_count::text, '3');

  -- ── 4 · D42 — addresses and numbers never survive the write
  --
  -- The client scrubs too, but the client can be an old cached bundle or a
  -- hand-rolled curl. The database is the only place this can be a guarantee.
  perform public.record_client_error(
    'harness-pii',
    'no balance for priya.sharma@customer.test on +919663333364',
    'boundary',
    'at handler (user=someone@else.example)');

  select message, stack into v_msg, v_stack
    from public.client_errors where fingerprint = 'harness-pii';

  if v_msg like '%@%' then
    raise exception 'ERROR-STORE FAIL: an email address survived into message: %', v_msg;
  end if;
  if v_msg like '%9663333364%' then
    raise exception 'ERROR-STORE FAIL: a phone number survived into message: %', v_msg;
  end if;
  if v_stack like '%@%' then
    raise exception 'ERROR-STORE FAIL: an email address survived into stack: %', v_stack;
  end if;
  raise notice 'ok: addresses and numbers are stripped from message and stack';

  -- ── 5 · a hostile payload cannot be large
  perform public.record_client_error('harness-long', repeat('x', 5000), 'boundary', repeat('y', 9000));
  select length(message) into v_len from public.client_errors where fingerprint = 'harness-long';
  perform pg_temp.err_check('message is truncated to 500', v_len::text, '500');
  select length(stack) into v_len from public.client_errors where fingerprint = 'harness-long';
  perform pg_temp.err_check('stack is truncated to 4000', v_len::text, '4000');

  -- ── 6 · junk is dropped, never raised
  --
  -- A reporter that throws inside an error handler turns one broken page into a
  -- broken page plus an unhandled rejection — which the global handler then
  -- tries to report.
  begin
    perform public.record_client_error('', 'no fingerprint', 'boundary');
    perform public.record_client_error('harness-nomsg', '', 'boundary');
    raise notice 'ok: junk input does not raise';
  exception when others then
    raise exception 'ERROR-STORE FAIL: junk input raised %', sqlerrm;
  end;

  select count(*) into v_count from public.client_errors
   where fingerprint in ('', 'harness-nomsg');
  perform pg_temp.err_check('and junk input writes nothing', v_count::text, '0');

  -- ── 7 · severity cannot be an arbitrary string
  perform public.record_client_error('harness-sev', 'x', 'boundary', null, null, 'catastrophic');
  perform pg_temp.err_check('an unknown severity is clamped to error',
    (select severity from public.client_errors where fingerprint = 'harness-sev'), 'error');

  -- ── 8 · the read is platform-admin only
  --
  -- Raises rather than returning an empty set, for the same reason
  -- platform_mail_health does: a monitor that answers "all clear" to somebody
  -- not entitled to ask is the worst possible failure for a monitor. The seed's
  -- org_admin is a tenant administrator, which is precisely the role that must
  -- NOT see other customers' faults.
  begin
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
      json_build_object('sub', '00000000-0000-0000-0000-00000000a001',
                        'role', 'authenticated')::text, true);
    perform * from public.platform_client_errors(7);
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', '', true);
    raise exception 'ERROR-STORE FAIL: a non-platform-admin read the error store';
  exception
    when sqlstate 'P0001' then
      perform set_config('role', 'postgres', true);
      perform set_config('request.jwt.claims', '', true);
      -- Distinguish our own FORBIDDEN from the failure message above, which is
      -- also P0001. Without this the test passes when it should fail.
      if sqlerrm like '%non-platform-admin read%' then
        raise exception '%', sqlerrm;
      end if;
      raise notice 'ok: a non-platform-admin is refused, not given an empty list';
    when insufficient_privilege then
      perform set_config('role', 'postgres', true);
      perform set_config('request.jwt.claims', '', true);
      raise notice 'ok: a non-platform-admin cannot execute the read at all';
  end;

  delete from public.client_errors where fingerprint like 'harness-%';
  raise notice 'ok: error store verified';
end $$;

-- ═════════════════════════════════════ the public channel and its own ceiling
--
-- Added 6 Aug 2026, after `client_errors` recorded nothing at all through a
-- thirteen-hour sign-in outage. Every caller who cannot sign in is anonymous,
-- and the store took signed-in callers only. `record_public_client_error` plus
-- the `client-error` edge function close that.
--
-- The property that earns most of these lines is NOT "an anonymous error is
-- recorded". It is that the public channel CANNOT SUPPRESS THE SIGNED-IN ONE.
-- Reusing the existing function would have worked on the first try and left an
-- endpoint where anybody could post 500 junk fingerprints, exhaust a shared
-- silent ceiling, and blind the error store for the rest of the day.
do $$
declare
  v_n       bigint;
  v_src     text;
  v_org     uuid;
  v_msg     text;
begin
  if to_regprocedure('public.record_public_client_error(text,text,text,text,text,text,text,text)') is null then
    raise notice 'skip: record_public_client_error not present yet';
    return;
  end if;

  delete from public.client_errors where fingerprint like 'pubtest-%';

  ---------------------------------------------------------------- it records
  perform public.record_public_client_error(
    'pubtest-basic', 'sign-in screen exploded', 'boundary', null, '/auth');

  select count(*) into v_n
    from public.client_errors where fingerprint = 'pubtest-basic';
  perform pg_temp.err_check('an anonymous error is recorded at all', v_n::text, '1');

  select source, organization_id into v_src, v_org
    from public.client_errors where fingerprint = 'pubtest-basic';
  perform pg_temp.err_check('it is marked source=public', v_src, 'public');
  -- Never attributed. There is no session, and a caller that could name an
  -- organisation could pin its errors on somebody else's customer.
  perform pg_temp.err_check('it carries no organisation',
    coalesce(v_org::text, 'null'), 'null');

  ---------------------------------------------------------------- it scrubs (D42)
  perform public.record_public_client_error(
    'pubtest-pii', 'no account for priya@customer.test on +919663333364', 'boundary');
  select message into v_msg
    from public.client_errors where fingerprint = 'pubtest-pii';
  perform pg_temp.err_check('the address is removed on the public path',
    (v_msg like '%@customer.test%')::text, 'false');
  perform pg_temp.err_check('the phone number is removed on the public path',
    (v_msg like '%9663333364%')::text, 'false');

  ---------------------------------------------------------------- THE ceiling test
  --
  -- Fill the public budget past its 100, then assert a signed-in report still
  -- lands. Before the budgets were split this is the assertion that would have
  -- failed, and its failure is a public endpoint able to silence customer
  -- error reporting.
  for i in 1..105 loop
    perform public.record_public_client_error(
      'pubtest-flood-' || i, 'flooding the public budget ' || i, 'boundary');
  end loop;

  select count(*) into v_n
    from public.client_errors
   where fingerprint like 'pubtest-flood-%'
     and occurred_on = (now() at time zone 'utc')::date;
  if v_n > 100 then
    raise exception
      'ERROR-STORE FAIL: the public ceiling did not hold — % rows written past 100', v_n;
  end if;
  raise notice 'ok: the public ceiling stops writing (% of 105 accepted)', v_n;

  -- And now the point of all of it — INSERTED DIRECTLY, not through the
  -- endpoint, and that detail is the whole reason this assertion is worth
  -- anything.
  --
  -- The first version of this test flooded through `record_public_client_error`
  -- and then asserted a signed-in write still landed. It passed. It also passed
  -- with the two ceilings sharing a single counter — because the public ceiling
  -- caps public rows at 100, 100 never reaches the app's 500, and the signed-in
  -- write succeeded either way. An assertion that holds in the broken state is
  -- not a test; it is the mechanism by which the idle timeout shipped dead on
  -- 5 Aug 2026.
  --
  -- So: put 500 public rows in the table for today by any means, and ask
  -- whether the signed-in channel still works. With separate counters it does.
  -- With one shared counter it cannot, and that is the failure this guards.
  insert into public.client_errors (fingerprint, message, mechanism, source)
  select 'pubtest-bulk-' || g, 'bulk public row ' || g, 'boundary', 'public'
    from generate_series(1, 500) g
  on conflict (fingerprint, occurred_on) do nothing;

  perform public.record_client_error(
    'pubtest-app-after-flood', 'a signed-in error, after the public flood', 'boundary');

  select count(*) into v_n
    from public.client_errors where fingerprint = 'pubtest-app-after-flood';
  if v_n <> 1 then
    raise exception
      'ERROR-STORE FAIL: 500 public rows suppressed a SIGNED-IN report. The two '
      'daily ceilings are sharing a counter, so anything able to write through '
      'the public endpoint can blind the error store for the rest of the day — '
      'silently, because the ceiling is deliberately silent.';
  end if;
  raise notice 'ok: 500 public rows do not suppress signed-in reports';

  -- Non-vacuity, in the other direction: the app ceiling must still EXIST.
  -- Without this, deleting the ceiling from record_client_error entirely would
  -- make the assertion above pass more easily rather than fail.
  insert into public.client_errors (fingerprint, message, mechanism, source)
  select 'pubtest-appbulk-' || g, 'bulk app row ' || g, 'boundary', 'app'
    from generate_series(1, 500) g
  on conflict (fingerprint, occurred_on) do nothing;

  perform public.record_client_error(
    'pubtest-app-over-ceiling', 'this one must be refused', 'boundary');

  select count(*) into v_n
    from public.client_errors where fingerprint = 'pubtest-app-over-ceiling';
  if v_n <> 0 then
    raise exception
      'ERROR-STORE FAIL: the signed-in ceiling did not hold at 500 app rows — '
      'the cap that keeps a render loop from filling a free-tier database is gone.';
  end if;
  raise notice 'ok: the signed-in ceiling still holds at 500 app rows';

  ---------------------------------------------------------------- grants
  -- service_role only. anon holding this would be the 2 Aug open relay shape;
  -- authenticated holding it would let a signed-in caller spend the public
  -- budget and dodge organisation attribution.
  perform pg_temp.err_check('anon cannot execute the public writer',
    has_function_privilege('anon',
      'public.record_public_client_error(text,text,text,text,text,text,text,text)',
      'EXECUTE')::text, 'false');
  perform pg_temp.err_check('authenticated cannot execute the public writer',
    has_function_privilege('authenticated',
      'public.record_public_client_error(text,text,text,text,text,text,text,text)',
      'EXECUTE')::text, 'false');
  perform pg_temp.err_check('service_role can',
    has_function_privilege('service_role',
      'public.record_public_client_error(text,text,text,text,text,text,text,text)',
      'EXECUTE')::text, 'true');
  perform pg_temp.err_check('anon cannot execute the shared scrubber either',
    has_function_privilege('anon', 'public.scrub_client_text(text,integer)', 'EXECUTE')::text,
    'false');

  delete from public.client_errors where fingerprint like 'pubtest-%';
  raise notice '--- public error channel verified ---';
end $$;
