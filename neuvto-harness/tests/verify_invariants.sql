-- NEUVTO WOS — Data invariant verification
--
-- Raises an exception on the first violation. Silence means pass.
-- Run after every build step, and always after any approve/reject/cancel work.
--
-- PHASE-AWARE: leave and approval checks guard themselves on table existence,
-- so this runs usefully from Phase 0 onward.
--
-- Runs as postgres (RLS bypassed) deliberately: these assert what is TRUE in the
-- data, not what any particular role can see. verify_rls.sql covers visibility.

do $$
declare
  bad record;
  n   bigint;
  offenders text;
begin
  -- ══════════════════════════════════════════════════ PHASE 0 — platform

  ---------------------------------------------------------------- tenancy integrity
  -- A row must never reference a parent belonging to a different organisation.
  -- This is the corruption RLS cannot prevent, because RLS filters reads rather
  -- than validating writes made by a service role or a migration.
  select count(*) into n
  from profiles p join departments d on d.id = p.department_id
  where p.organization_id <> d.organization_id;
  if n > 0 then
    raise exception 'INVARIANT FAIL: % profiles reference a department in another organisation', n;
  end if;

  select count(*) into n
  from profiles p join profiles m on m.id = p.manager_id
  where p.organization_id <> m.organization_id;
  if n > 0 then
    raise exception 'INVARIANT FAIL: % profiles report to a manager in another organisation', n;
  end if;

  select count(*) into n
  from user_roles r join profiles p on p.id = r.user_id
  where r.organization_id <> p.organization_id;
  if n > 0 then
    raise exception 'INVARIANT FAIL: % roles granted in an organisation the user does not belong to', n;
  end if;

  select count(*) into n
  from departments d join departments parent on parent.id = d.parent_department_id
  where d.organization_id <> parent.organization_id;
  if n > 0 then
    raise exception 'INVARIANT FAIL: % departments nested under a parent in another organisation', n;
  end if;
  raise notice 'ok: no cross-tenant references';

  ---------------------------------------------------------------- every org configured
  select count(*) into n
  from organizations o left join organization_settings s on s.organization_id = o.id
  where s.organization_id is null and o.deleted_at is null;
  if n > 0 then
    raise exception 'INVARIANT FAIL: % organisations have no settings row — every date and balance calculation depends on it', n;
  end if;
  raise notice 'ok: every organisation has settings';

  ---------------------------------------------------------------- timezone resolvable (D9)
  -- An unresolvable timezone silently corrupts every date comparison.
  for bad in select organization_id, timezone from organization_settings loop
    begin
      perform now() at time zone bad.timezone;
    exception when others then
      raise exception 'INVARIANT FAIL: organisation % has unresolvable timezone %',
        bad.organization_id, bad.timezone;
    end;
  end loop;
  raise notice 'ok: every organisation timezone resolves';

  ---------------------------------------------------------------- audit fields (D16)
  select count(*) into n from profiles     where created_at is null or updated_at is null;
  if n > 0 then raise exception 'INVARIANT FAIL: % profiles missing audit timestamps', n; end if;
  select count(*) into n from organizations where created_at is null or updated_at is null;
  if n > 0 then raise exception 'INVARIANT FAIL: % organisations missing audit timestamps', n; end if;
  select count(*) into n from profiles where updated_at < created_at;
  if n > 0 then raise exception 'INVARIANT FAIL: % profiles updated before they were created', n; end if;
  raise notice 'ok: audit timestamps present and ordered';

  ---------------------------------------------------------------- analytics naming (D25)
  -- Event names are as permanent as error codes; a malformed one is forever.
  if to_regclass('public.analytics_events') is not null then
    select count(*) into n from analytics_events where event !~ '^[a-z_]+\.[a-z_]+$';
    if n > 0 then
      raise exception 'INVARIANT FAIL: % analytics events do not follow noun.verb naming', n;
    end if;
    raise notice 'ok: analytics event names well-formed';
  end if;

  ---------------------------------------------------------------- notification templates
  -- Two assertions, and they fail on different things on purpose.
  --
  -- The FIRST catches the state that reached production on 6 Aug 2026: the
  -- table empty, all four system defaults gone, every notification event in the
  -- product dead. It cost a real customer's first invitation. Nothing anywhere
  -- said so, because a workspace with no members yet sends nothing, so the first
  -- send attempt after the defaults vanished was also the first one a customer
  -- was waiting on.
  --
  -- The list lives in the migration, not here — one definition, so the harness
  -- and prod-cutover.sh cannot ask subtly different questions.
  if to_regprocedure('public.missing_system_notification_templates()') is not null then
    select array_to_string(public.missing_system_notification_templates(), ', ')
      into offenders;
    if offenders <> '' then
      raise exception
        'INVARIANT FAIL: no active system template for: %. Every notification for these events fails with NO_TEMPLATE, silently — run select public.ensure_system_notification_templates()', offenders;
    end if;
    raise notice 'ok: every system notification event has a template';
  end if;

  -- The SECOND needs no list, and that is the point of having it as well.
  -- `notify()` takes its event key as a runtime argument, so there is no honest
  -- way to derive "which templates must exist" from the schema — meaning the
  -- list above can go stale the day somebody emits a new event. This assertion
  -- cannot: emit anything with no template and it lands as a row saying so.
  --
  -- ── why `deleted_at is null`, and why that is not a loophole
  --
  -- A NO_TEMPLATE row is a permanent record of a past failure. Without this
  -- clause the first one ever recorded fails this check forever, so the only
  -- way to get the harness green again is to hard-delete the evidence — which
  -- is the opposite of what should happen to an incident record, and is what
  -- the soft-delete discipline (D16–D19) exists to avoid everywhere else.
  --
  -- So soft-delete is the acknowledgement: the row stays, and it stops being
  -- reported as open. Production carries exactly one, from the invitation that
  -- never arrived on 6 Aug 2026.
  --
  -- It is not a way to make a real problem go away, and that is worth being
  -- precise about rather than trusting. Soft-deleting these rows CANNOT hide a
  -- missing template, because the check directly above asks
  -- `missing_system_notification_templates()` — it reads the template table, not
  -- the notification table, and nothing done to a notification row affects it.
  -- Somebody who soft-deletes their way out of this assertion while a template
  -- is genuinely absent still fails, one check earlier, with a clearer message.
  --
  -- What soft-delete CAN hide is the other case: an event emitted with a key
  -- nobody wrote a template for. That one is a live fault until somebody adds
  -- the template, and it will simply come back on the next emit.
  if to_regclass('public.notifications') is not null then
    select count(*) into n
    from notifications
    where failed_reason = 'NO_TEMPLATE'
      and deleted_at is null;
    if n > 0 then
      select coalesce(string_agg(distinct event_key, ', '), '') into offenders
      from notifications
      where failed_reason = 'NO_TEMPLATE'
        and deleted_at is null;
      raise exception
        'INVARIANT FAIL: % unacknowledged notification(s) failed with NO_TEMPLATE, for: %. The event was emitted with no template to render it, so nobody was told anything. Fix the template first; soft-delete the row only once it is a closed incident', n, offenders;
    end if;
    raise notice 'ok: no unacknowledged notification failed for want of a template';
  end if;

  -- ══════════════════════════════════════════════════ PHASE 1 — working calendar

  if to_regprocedure('public.calculate_working_days(uuid,date,date)') is null then
    raise notice 'skipped: calendar invariants (service not built yet)';
  else
    ---------------------------------------------------------------- PRD Case 4
    -- "Given weekends are excluded, when an employee applies Fri–Mon,
    --  then the system calculates 2 leave days."
    if public.calculate_working_days(
         '00000000-0000-0000-0000-0000000000a0','2026-08-07','2026-08-10') <> 2 then
      raise exception 'INVARIANT FAIL: PRD Case 4 — Fri to Mon with weekends excluded must be 2 days';
    end if;
    raise notice 'ok: PRD Case 4 — weekend days excluded';

    ---------------------------------------------------------------- weekends are per-org
    -- Acme is Sat/Sun, Vertex is Fri/Sat. The same dates must give different
    -- answers, or the weekend is hardcoded somewhere.
    if public.calculate_working_days('00000000-0000-0000-0000-0000000000a0','2026-08-07','2026-08-08')
       = public.calculate_working_days('00000000-0000-0000-0000-0000000000b0','2026-08-07','2026-08-08') then
      raise exception 'INVARIANT FAIL: Fri–Sat counts the same for a Sat/Sun org and a Fri/Sat org — the weekend is hardcoded';
    end if;
    raise notice 'ok: weekend configuration is per-organisation';

    ---------------------------------------------------------------- six-day week
    -- Plenty of companies work Monday to Saturday and rest only on Sunday.
    -- Two-day weekends are a default, not an assumption, and this proves the
    -- calendar honours a one-day one rather than quietly counting Saturday off.
    --
    -- Applied to a scratch organisation and rolled back, so it cannot leave the
    -- seed in a state later assertions read.
    declare
      v_six numeric;
      v_two numeric;
    begin
      select public.calculate_working_days(
        '00000000-0000-0000-0000-0000000000a0', date '2026-09-07', date '2026-09-13') into v_two;

      update organization_settings set weekend_days = '{0}'
       where organization_id = '00000000-0000-0000-0000-0000000000a0';
      select public.calculate_working_days(
        '00000000-0000-0000-0000-0000000000a0', date '2026-09-07', date '2026-09-13') into v_six;
      update organization_settings set weekend_days = '{0,6}'
       where organization_id = '00000000-0000-0000-0000-0000000000a0';

      if v_two <> 5 then
        raise exception 'INVARIANT FAIL: a Sat/Sun weekend gave % working days in a week, not 5', v_two;
      end if;
      if v_six <> 6 then
        raise exception 'INVARIANT FAIL: a Sunday-only weekend gave % working days in a week, not 6', v_six;
      end if;
      raise notice 'ok: a six-day working week counts Saturday, a five-day one does not';
    end;

    ---------------------------------------------------------------- holidays actually exclude
    -- A holiday on a WORKING day, so the weekend rule cannot mask the result.
    -- Thu 1 Oct to Fri 2 Oct is 2 calendar weekdays; Gandhi Jayanti falls on the
    -- Friday, so the answer must be 1.
    if to_regclass('public.holidays') is not null then
      if public.calculate_working_days(
           '00000000-0000-0000-0000-0000000000a0','2026-10-01','2026-10-02') <> 1 then
        raise exception 'INVARIANT FAIL: a holiday on a working day was still counted';
      end if;
      raise notice 'ok: holidays excluded from working days';

      -- Guards the test itself. Every Acme holiday used to fall on a weekend, so
      -- exclusion was never exercised and the assertion above would have passed
      -- with the holiday logic entirely broken.
      select count(*) into n
      from holidays h
      join organization_settings s on s.organization_id = h.organization_id
      where h.organization_id = '00000000-0000-0000-0000-0000000000a0'
        and extract(dow from h.holiday_date)::smallint <> all (s.weekend_days);
      if n = 0 then
        raise exception
          'INVARIANT FAIL: no seeded holiday falls on a working day, so holiday exclusion is untestable';
      end if;
      raise notice 'ok: seed contains a holiday that genuinely tests exclusion';
    end if;

    --------------------------------------------- a report counts in org-local days
    --
    -- `days_waiting` on the pending report is org_today minus the submission
    -- date, and the submission date has to be resolved in the ORGANISATION's
    -- timezone. `submitted_at::date` resolves in the session's, which is UTC —
    -- so a request submitted at 19:00 UTC, half past midnight in Kolkata, was
    -- reported as one day old the moment it arrived.
    --
    -- Asserted against the boundary rather than "now", because at most times of
    -- day the two dates agree and the bug is invisible. Acme is Asia/Kolkata in
    -- the seed, which is the point of the fixture.
    if to_regprocedure('public.leave_pending_report()') is not null then
      declare
        v_tz      text;
        v_admin   uuid;
        v_req     uuid;
        v_at      timestamptz;
        v_waiting int;
      begin
        select coalesce(s.timezone,'UTC') into v_tz
          from public.organization_settings s
         where s.organization_id = '00000000-0000-0000-0000-0000000000a0';

        -- The fixture has to be capable of showing the fault, or the assertion
        -- below passes for the wrong reason.
        if v_tz = 'UTC' then
          raise exception
            'INVARIANT FAIL: Acme''s timezone is UTC, so this cannot detect a UTC/org-local mix-up';
        end if;

        -- A SOURCE check, deliberately, and not because behaviour is beside the
        -- point. Behaviour cannot be asserted here without a pending request,
        -- and the suite that precedes this one clears them — so a behavioural
        -- test would skip silently on most runs and report green. This one
        -- cannot pass vacuously: the function either contains the naive cast or
        -- it does not.
        -- Comments stripped first. The first version of this check matched the
        -- COMMENT that explains the bug and failed against the corrected
        -- function — a source assertion cannot tell code from prose about code
        -- unless you make it.
        if regexp_replace(
             pg_get_functiondef(to_regprocedure('public.leave_pending_report()')),
             '--[^\n]*', '', 'g') ~ 'submitted_at::date' then
          raise exception
            'INVARIANT FAIL: leave_pending_report ages a request with submitted_at::date, which resolves in the SESSION timezone (UTC), not the organisation''s — every request submitted after 18:30 UTC reads a day older than it is';
        end if;
        raise notice 'ok: a report ages a request in the organisation''s own days';

        -- And over whatever pending rows happen to exist, which is the real
        -- thing when there are any.
        select id into v_admin from public.profiles
         where email = 'alice.admin@acme.test';

        if v_admin is not null then
          perform set_config('request.jwt.claims',
                   json_build_object('sub', v_admin, 'role','authenticated')::text, true);
          perform set_config('role', 'authenticated', true);

          select count(*) into n
            from public.leave_pending_report() rep
            join public.leave_requests r on r.id = rep.leave_request_id
           where rep.days_waiting
                 <> (public.org_today('00000000-0000-0000-0000-0000000000a0'::uuid)
                     - (r.submitted_at at time zone v_tz)::date);

          perform set_config('role', 'postgres', true);
          perform set_config('request.jwt.claims', null, true);

          if n > 0 then
            raise exception
              'INVARIANT FAIL: % pending row(s) report an age that is not the organisation''s own', n;
          end if;
        end if;
      end;
    end if;

    -------------------------------------- a report refuses, and never crosses a tenant
    --
    -- Two properties, and the fixture that makes both of them mean something.
    --
    -- FIRST: a non-admin must be REFUSED, not handed an empty set. On screen the
    -- two are the same picture — a table with nothing in it — and only one of
    -- them is a bug. A check that merely counted rows would pass just as happily
    -- against a report that had quietly started returning nothing to everybody,
    -- which is why what is asserted here is that an exception was RAISED.
    --
    -- SECOND: tenancy. These are SECURITY DEFINER functions, so RLS does not
    -- apply inside them and `current_org_id()` is the only thing standing
    -- between Acme's leave and Vertex's administrator. Nothing else in this file
    -- covers that, because everywhere else the policies do the work.
    --
    -- Both need leave to exist in BOTH organisations. Every suite that runs
    -- before this one cleans up after itself, so the taken and pending reports
    -- would otherwise be compared across two empty sets — green, and proving
    -- nothing whatsoever. This block creates its own leave and takes it away
    -- again.
    if to_regprocedure('public.leave_taken_report(date,date)') is not null then
      declare
        acme       uuid := '00000000-0000-0000-0000-0000000000a0';
        vertex     uuid := '00000000-0000-0000-0000-0000000000b0';
        alice      uuid;
        bob        uuid;
        ravi       uuid;
        sara       uuid;
        d_acme     date;
        d_vertex   date;
        req_acme   uuid;
        req_vertex uuid;
        ar_acme    uuid;
        ar_vertex  uuid;
        fn         text;
        raised     boolean;
        cnt        bigint;
      begin
        select id into alice from public.profiles where email = 'alice.admin@acme.test';
        select id into bob   from public.profiles where email = 'bob.admin@vertex.test';
        select id into ravi  from public.profiles where email = 'ravi.emp@acme.test';
        select id into sara  from public.profiles where email = 'sara.emp@vertex.test';

        if alice is null or bob is null or ravi is null or sara is null then
          raise exception
            'INVARIANT FAIL: the two-tenant fixture is missing, so report isolation cannot be tested';
        end if;

        -- A working day in each organisation's own calendar. They keep different
        -- weekends and holidays in the seed, so one date does not serve both.
        select g::date into d_acme
          from generate_series(public.org_today(acme) + 20,
                               public.org_today(acme) + 140, '1 day') g
         where public.calculate_working_days(acme, g::date, g::date) = 1
         limit 1;

        select g::date into d_vertex
          from generate_series(public.org_today(vertex) + 20,
                               public.org_today(vertex) + 140, '1 day') g
         where public.calculate_working_days(vertex, g::date, g::date) = 1
         limit 1;

        if d_acme is null or d_vertex is null then
          raise exception
            'INVARIANT FAIL: no working day found in one of the two calendars, so the fixture cannot be built';
        end if;

        perform set_config('role', 'authenticated', true);

        perform set_config('request.jwt.claims',
                 json_build_object('sub', ravi, 'role','authenticated')::text, true);
        req_acme := public.leave_submit(
          '00000000-0000-0000-0000-0000000000c1', d_acme, d_acme, 'acme fixture');

        perform set_config('request.jwt.claims',
                 json_build_object('sub', sara, 'role','authenticated')::text, true);
        req_vertex := public.leave_submit(
          '00000000-0000-0000-0000-0000000000c4', d_vertex, d_vertex, 'vertex fixture');

        select approval_request_id into ar_acme
          from public.leave_requests where id = req_acme;
        select approval_request_id into ar_vertex
          from public.leave_requests where id = req_vertex;

        -- ── refused, not empty ────────────────────────────────────────────────
        --
        -- Ravi holds `employee` and nothing else. Were he somehow an admin the
        -- calls would succeed and this would fail, which is the right way round.
        perform set_config('request.jwt.claims',
                 json_build_object('sub', ravi, 'role','authenticated')::text, true);

        foreach fn in array array[
          'public.leave_all_balances()',
          'public.leave_taken_report(date ''2000-01-01'', date ''2099-12-31'')',
          'public.leave_pending_report()'
        ] loop
          raised := false;
          begin
            execute format('select count(*) from %s', fn) into cnt;
          exception when others then
            -- Only FORBIDDEN counts. Anything else — a missing column, a broken
            -- join — would otherwise be swallowed and reported as a refusal.
            if sqlerrm not like '%FORBIDDEN%' then raise; end if;
            raised := true;
          end;

          if not raised then
            raise exception
              'INVARIANT FAIL: % returned % row(s) to a non-admin instead of raising FORBIDDEN — an empty report and a forbidden report are the same picture on screen, and only one of them is a bug',
              fn, cnt;
          end if;
        end loop;
        raise notice 'ok: every report refuses a non-admin rather than returning an empty set';

        -- The refusal above has to be about the ROLE. If these functions raised
        -- for everybody the loop would pass and mean nothing.
        perform set_config('request.jwt.claims',
                 json_build_object('sub', alice, 'role','authenticated')::text, true);
        select count(*) into cnt from public.leave_all_balances();
        if cnt = 0 then
          raise exception
            'INVARIANT FAIL: leave_all_balances returns nothing to an administrator, so the refusal above proves nothing about roles';
        end if;

        -- ── one tenant at a time ──────────────────────────────────────────────
        select count(*) into cnt
          from public.leave_all_balances() rep
          join public.profiles p on p.id = rep.employee_id
         where p.organization_id <> acme;
        if cnt > 0 then
          raise exception
            'INVARIANT FAIL: leave_all_balances handed Acme''s administrator % row(s) belonging to another organisation', cnt;
        end if;

        select count(*) into cnt
          from public.leave_taken_report(date '2000-01-01', date '2099-12-31')
         where leave_request_id = req_vertex;
        if cnt > 0 then
          raise exception
            'INVARIANT FAIL: leave_taken_report showed Acme''s administrator a Vertex leave request';
        end if;

        -- ...and it does see its OWN, so the absence above is isolation rather
        -- than an empty report.
        select count(*) into cnt
          from public.leave_taken_report(date '2000-01-01', date '2099-12-31')
         where leave_request_id = req_acme;
        if cnt <> 1 then
          raise exception
            'INVARIANT FAIL: leave_taken_report did not return Acme''s own request, so its tenant isolation is untested';
        end if;

        select count(*) into cnt
          from public.leave_pending_report() where leave_request_id = req_vertex;
        if cnt > 0 then
          raise exception
            'INVARIANT FAIL: leave_pending_report showed Acme''s administrator a Vertex leave request';
        end if;

        select count(*) into cnt
          from public.leave_pending_report() where leave_request_id = req_acme;
        if cnt <> 1 then
          raise exception
            'INVARIANT FAIL: leave_pending_report did not return Acme''s own pending request, so its tenant isolation is untested';
        end if;

        -- And the same from the other side, because a function that returned
        -- only Acme's rows to everybody would pass every assertion above.
        perform set_config('request.jwt.claims',
                 json_build_object('sub', bob, 'role','authenticated')::text, true);

        select count(*) into cnt
          from public.leave_taken_report(date '2000-01-01', date '2099-12-31')
         where leave_request_id = req_acme;
        if cnt > 0 then
          raise exception
            'INVARIANT FAIL: leave_taken_report showed Vertex''s administrator an Acme leave request';
        end if;

        select count(*) into cnt
          from public.leave_pending_report() where leave_request_id = req_vertex;
        if cnt <> 1 then
          raise exception
            'INVARIANT FAIL: leave_pending_report did not return Vertex''s own pending request';
        end if;

        select count(*) into cnt
          from public.leave_all_balances() rep
          join public.profiles p on p.id = rep.employee_id
         where p.organization_id <> vertex;
        if cnt > 0 then
          raise exception
            'INVARIANT FAIL: leave_all_balances handed Vertex''s administrator % row(s) belonging to another organisation', cnt;
        end if;

        raise notice 'ok: no report crosses a tenant boundary, in either direction';

        -- ── put the database back ─────────────────────────────────────────────
        --
        -- Cancelled first, as the employee, so the reserved days go back where
        -- they came from — the balance reconciliation later in this file would
        -- otherwise fail on this block's own fixture. Then removed outright, so
        -- nothing downstream sees leave that a test invented.
        perform set_config('request.jwt.claims',
                 json_build_object('sub', ravi, 'role','authenticated')::text, true);
        perform public.leave_cancel(req_acme);
        perform set_config('request.jwt.claims',
                 json_build_object('sub', sara, 'role','authenticated')::text, true);
        perform public.leave_cancel(req_vertex);

        perform set_config('role', 'postgres', true);
        perform set_config('request.jwt.claims', null, true);

        delete from public.leave_requests where id in (req_acme, req_vertex);
        delete from public.approval_steps
         where approval_request_id in (ar_acme, ar_vertex);
        delete from public.approval_requests where id in (ar_acme, ar_vertex);
      end;
    end if;

    ------------------------------------------- nothing is reachable anonymously
    --
    -- On 2 Aug 2026, minutes after the cutover, `notify_address` was callable on
    -- production by anyone holding the publishable key — which ships in the
    -- client bundle. It takes an arbitrary recipient and queues mail, and cron
    -- delivers it from a verified domain. An open relay.
    --
    -- The migrations looked correct. `revoke ... from public` secures a local
    -- database and does nothing to a hosted one, because the two disagree about
    -- what a new function is granted, and `anon` holds an EXPLICIT grant there
    -- that a revoke from PUBLIC never touches.
    select count(*) into n
      from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public'
       and p.prosecdef
       and has_function_privilege('anon', p.oid, 'EXECUTE');
    if n > 0 then
      raise exception
        'INVARIANT FAIL: % SECURITY DEFINER function(s) are executable by anon — they bypass RLS by definition', n;
    end if;
    raise notice 'ok: no SECURITY DEFINER function is executable without signing in';

    -- NON-VACUITY. The check above passes trivially on a database where anon
    -- was never granted anything, which is exactly the local one — so on its own
    -- it would have gone green throughout the window in which production was
    -- exposed. Grant a probe and confirm the check can actually see it.
    declare
      v_seen int;
    begin
      create function public.__anon_probe() returns int
        language sql security definer as 'select 1';
      grant execute on function public.__anon_probe() to anon;

      select count(*) into v_seen
        from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public' and p.prosecdef
         and has_function_privilege('anon', p.oid, 'EXECUTE');

      drop function public.__anon_probe();

      if v_seen <> 1 then
        raise exception
          'INVARIANT FAIL: the anon-executable check cannot see a function that IS anon-executable';
      end if;
      raise notice 'ok: that check can see an exposure when there is one';
    end;

    -- And the default that caused it. This is the assertion that would have
    -- caught the divergence: production granted `anon` EXECUTE on every new
    -- function automatically, local did not, and no test compared them.
    select count(*) into n
      from pg_default_acl d
     where d.defaclnamespace = 'public'::regnamespace
       and d.defaclobjtype = 'f'
       and pg_get_userbyid(d.defaclrole) = 'postgres'
       and array_to_string(d.defaclacl, ',') ~ '\manon=';
    if n > 0 then
      raise exception
        'INVARIANT FAIL: default privileges grant anon EXECUTE on new functions — every future migration ships exposed';
    end if;
    raise notice 'ok: a new function is granted to nobody until something says otherwise';

    ------------------------------------------------- the count explains itself
    -- working_days_excluded is the complement of calculate_working_days. If the
    -- two ever drift, the apply screen tells an employee that five days were
    -- charged for reasons that do not add up to the days they lost — worse than
    -- saying nothing, because it looks authoritative.
    --
    -- Asserted as a partition over every window in a year rather than on one
    -- example: counted + excluded must equal the calendar days, always. A single
    -- example passes happily when one of the two ignores holidays entirely.
    if to_regprocedure('public.working_days_excluded(uuid,date,date)') is not null then
      select count(*) into n
      from generate_series('2026-04-01'::date,'2027-03-01'::date,'1 day') f,
           lateral (select (f + (i||' days')::interval)::date as t
                      from generate_series(0,20) i) g
      where public.calculate_working_days('00000000-0000-0000-0000-0000000000a0', f::date, g.t)
          + (select count(*) from public.working_days_excluded(
               '00000000-0000-0000-0000-0000000000a0', f::date, g.t))
         <> (g.t - f::date + 1);
      if n > 0 then
        raise exception
          'INVARIANT FAIL: % windows where the days counted and the days explained do not add up', n;
      end if;
      raise notice 'ok: every day is either counted or explained, over a year of windows';

      -- The reason has to be the RIGHT one. Sat 15 Aug 2026 is Independence Day
      -- AND a weekend under the seed's five-day week, so it must be reported as
      -- the weekend — the structural rule, which would have excluded it anyway.
      -- Reported as the holiday, an administrator would believe deleting the
      -- holiday gives the day back.
      if (select reason from public.working_days_excluded(
            '00000000-0000-0000-0000-0000000000a0','2026-08-15','2026-08-15')) <> 'weekend' then
        raise exception
          'INVARIANT FAIL: a day that is both a holiday and a non-working day must be reported as the non-working day';
      end if;
      raise notice 'ok: a day that is both is explained by the rule that would have excluded it anyway';
    end if;

    ---------------------------------------------------------------- empty ranges
    if public.calculate_working_days('00000000-0000-0000-0000-0000000000a0','2026-08-08','2026-08-09') <> 0 then
      raise exception 'INVARIANT FAIL: a weekend-only range must be 0 working days';
    end if;
    if public.calculate_working_days('00000000-0000-0000-0000-0000000000a0','2026-08-10','2026-08-07') <> 0 then
      raise exception 'INVARIANT FAIL: a reversed range must be 0, not negative';
    end if;
    raise notice 'ok: empty and reversed ranges return zero';

    ---------------------------------------------------------------- financial year (D3)
    -- April–March spans two calendar years; January–December does not.
    if public.get_financial_year('00000000-0000-0000-0000-0000000000a0','2026-06-15') <> '2026-27' then
      raise exception 'INVARIANT FAIL: June 2026 in an April-start year should be 2026-27';
    end if;
    if public.get_financial_year('00000000-0000-0000-0000-0000000000a0','2026-03-31') <> '2025-26' then
      raise exception 'INVARIANT FAIL: 31 March 2026 is still the previous financial year';
    end if;
    if public.get_financial_year('00000000-0000-0000-0000-0000000000a0','2026-04-01') <> '2026-27' then
      raise exception 'INVARIANT FAIL: 1 April 2026 starts the new financial year';
    end if;
    if public.get_financial_year('00000000-0000-0000-0000-0000000000b0','2026-06-15') <> '2026' then
      raise exception 'INVARIANT FAIL: a January-start year should be labelled 2026, not 2026-27';
    end if;
    raise notice 'ok: financial year labels follow each organisation''s own start';

    ---------------------------------------------------------------- org-local today (D9)
    -- Acme is IST (+5:30), Vertex GST (+4). Neither may fall back to the
    -- server clock, and for part of every UTC day IST is already tomorrow.
    if public.org_today('00000000-0000-0000-0000-0000000000a0')
       <> (now() at time zone 'Asia/Kolkata')::date then
      raise exception 'INVARIANT FAIL: org_today did not resolve in the organisation timezone';
    end if;
    if public.org_today('00000000-0000-0000-0000-0000000000b0')
       <> (now() at time zone 'Asia/Dubai')::date then
      raise exception 'INVARIANT FAIL: org_today ignored the second organisation timezone';
    end if;
    raise notice 'ok: org_today resolves per organisation, not from the server clock';
  end if;

  -- ══════════════════════════════════════════════════ PHASE 2 — leave module

  if to_regclass('public.leave_balances') is null then
    raise notice 'skipped: leave invariants (module not built yet)';
  else
    ---------------------------------------------------------------- balance arithmetic
    -- available_days is a generated column, so a mismatch means the column
    -- definition itself drifted from spec.
    execute $q$
      select count(*) from leave_balances
      where available_days is distinct from
            (entitled_days + carryforward_days - used_days - reserved_days - pending_days)
    $q$ into n;
    if n > 0 then
      raise exception 'INVARIANT FAIL: % balance rows where available_days does not match the formula', n;
    end if;
    raise notice 'ok: available_days formula holds';

    execute $q$
      select count(*) from leave_balances
      where used_days < 0 or reserved_days < 0 or pending_days < 0
         or entitled_days < 0 or carryforward_days < 0
    $q$ into n;
    if n > 0 then
      raise exception 'INVARIANT FAIL: % balance rows with a negative bucket', n;
    end if;
    raise notice 'ok: no negative balance buckets';

    execute 'select count(*) from leave_balances where available_days < 0' into n;
    if n > 0 then
      raise exception 'INVARIANT FAIL: % employees have negative available balance (the D2 overdraw bug)', n;
    end if;
    raise notice 'ok: no overdrawn balances';

    ---------------------------------------------------------------- reservation reconciles
    -- Every day in reserved_days must be backed by a request awaiting approval.
    -- Catches reservations that leak when a request is rejected and never released.
    if to_regclass('public.leave_requests') is not null then
      execute $q$
        select count(*) from (
          select b.employee_id, b.leave_type_id, b.reserved_days,
                 coalesce(sum(r.working_days), 0) as actual
          from leave_balances b
          left join leave_requests r
            on r.employee_id = b.employee_id
           and r.leave_type_id = b.leave_type_id
           and r.status = 'pending_approval'
           and r.deleted_at is null
          group by b.employee_id, b.leave_type_id, b.reserved_days
          having b.reserved_days is distinct from coalesce(sum(r.working_days), 0)
        ) x
      $q$ into n;
      if n > 0 then
        raise exception 'INVARIANT FAIL: % balances where reserved_days does not reconcile with pending requests', n;
      end if;
      raise notice 'ok: reserved_days reconciles with pending requests';

      ---------------------------------------------------------------- cross-tenant FKs
      execute $q$
        select count(*) from leave_requests r join leave_types t on t.id = r.leave_type_id
         where r.organization_id <> t.organization_id
      $q$ into n;
      if n > 0 then
        raise exception 'INVARIANT FAIL: % leave requests reference a leave type from another organisation', n;
      end if;

      execute $q$
        select count(*) from leave_requests r join profiles p on p.id = r.employee_id
         where r.organization_id <> p.organization_id
      $q$ into n;
      if n > 0 then
        raise exception 'INVARIANT FAIL: % leave requests whose employee belongs to another organisation', n;
      end if;
      raise notice 'ok: no cross-tenant leave references';

      ---------------------------------------------------------------- date sanity
      execute 'select count(*) from leave_requests where to_date < from_date' into n;
      if n > 0 then
        raise exception 'INVARIANT FAIL: % requests with to_date before from_date', n;
      end if;
      execute $q$
        select count(*) from leave_requests
         where working_days <= 0 and status <> 'cancelled' and deleted_at is null
      $q$ into n;
      if n > 0 then
        raise exception 'INVARIANT FAIL: % active requests with zero or negative working days', n;
      end if;
      raise notice 'ok: request dates sane';

      ---------------------------------------------------------------- soft delete (D17)
      execute $q$
        select count(*) from leave_requests
         where deleted_at is not null and status in ('pending_approval','approved')
      $q$ into n;
      if n > 0 then
        raise exception
          'INVARIANT FAIL: % soft-deleted requests still hold an active status — they will be counted in balances', n;
      end if;
      raise notice 'ok: no soft-deleted requests in an active status';

      ---------------------------------------------------------------- overlap constraint (D18)
      -- The database, not the application, must reject this.
      if exists (select 1 from pg_constraint where conname = 'no_overlapping_leave') then
        begin
          execute $q$
            insert into leave_requests
              (organization_id, employee_id, leave_type_id, from_date, to_date, working_days, status)
            values
              ('00000000-0000-0000-0000-0000000000a0','00000000-0000-0000-0000-00000000a005',
               '00000000-0000-0000-0000-0000000000c1','2027-05-10','2027-05-14',5,'approved'),
              ('00000000-0000-0000-0000-0000000000a0','00000000-0000-0000-0000-00000000a005',
               '00000000-0000-0000-0000-0000000000c1','2027-05-12','2027-05-16',5,'approved')
          $q$;
          raise exception
            'INVARIANT FAIL: two overlapping approved requests were accepted — the exclusion constraint is not enforcing';
        exception
          when exclusion_violation then
            raise notice 'ok: overlapping leave rejected by the database';
        end;
        execute $q$delete from leave_requests where from_date in ('2027-05-10','2027-05-12')$q$;
      else
        raise warning 'no_overlapping_leave constraint absent — overlap is only checked in application code (D18)';
      end if;
    end if;
  end if;

  -- ══════════════════════════════════════════════════ PHASE 1 — approval engine

  if to_regclass('public.approval_requests') is null then
    raise notice 'skipped: approval invariants (engine not built yet)';
  else
    execute $q$
      select count(*) from approval_requests ar
       where ar.status = 'approved'
         and (select count(*) from approval_steps s
               where s.approval_request_id = ar.id and s.decision = 'approved')
             < ar.required_levels
    $q$ into n;
    if n > 0 then
      raise exception 'INVARIANT FAIL: % approvals completed without all required levels approving', n;
    end if;
    raise notice 'ok: approved requests have all levels decided';

    execute $q$
      select count(*) from approval_steps s
        join approval_requests ar on ar.id = s.approval_request_id
       where s.approver_id = ar.requester_id and s.decision <> 'pending'
    $q$ into n;
    if n > 0 then
      raise exception 'INVARIANT FAIL: % approval steps were decided by the requester themselves', n;
    end if;
    raise notice 'ok: no self-approvals';
  end if;

  -- ══════════════════════════════ PHASE 2 — every function pins its search_path
  --
  -- Supabase linter 0011 already catches this, on a dashboard nobody opens on
  -- the day it starts mattering. Asserted here so it fails on the run that
  -- introduces it instead.
  --
  -- Why it matters depends on the function. SECURITY DEFINER + mutable
  -- search_path is privilege escalation: the function runs as its owner, so
  -- bending what `profiles` resolves to executes the caller's code as postgres.
  -- IMMUTABLE + mutable search_path is a lie to the planner, which is entitled
  -- to constant-fold and index on that promise. Neither is a thing to leave to a
  -- linter somebody remembers to read.
  --
  -- Extension-owned functions are excluded: btree_gist installs into public, its
  -- several hundred gbt_* helpers set no search_path, and none of them are ours
  -- to alter. Anything NOT owned by an extension is ours and has no excuse.
  select coalesce(string_agg(p.proname, ', ' order by p.proname), '')
    into offenders
  from pg_proc p
  join pg_namespace nsp on nsp.oid = p.pronamespace
  where nsp.nspname = 'public'
    and p.prokind = 'f'
    and not exists (
      select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e'
    )
    and (p.proconfig is null
         or not exists (
           select 1 from unnest(p.proconfig) c where c like 'search\_path=%'
         ));
  if offenders <> '' then
    raise exception
      'INVARIANT FAIL: these functions do not pin search_path: %', offenders;
  end if;
  raise notice 'ok: every function in public pins its search_path';

  raise notice '--- invariant verification passed ---';
end $$;
