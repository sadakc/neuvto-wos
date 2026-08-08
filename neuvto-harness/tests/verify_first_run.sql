-- NEUVTO WOS — First-run verification
--
-- Raises on the first violation. Silence means pass.
--
-- WHY THIS FILE EXISTS
--
-- The rest of the harness runs against `seed_test_data.sql`, which hands it two
-- fully configured organisations: leave types, balances, approval chains, the
-- lot. Every assertion in the suite therefore starts from a state no real
-- customer has ever been in.
--
-- On 31 Jul 2026 Sada signed up the way a customer would and found a dashboard
-- he could do nothing with. Four faults, all of them live while the harness was
-- green, all of them invisible because the seed had already done by hand what
-- the product was supposed to do by itself:
--
--   1. no screen to configure leave types          (interface — not testable here)
--   2. an "Apply for leave" button with nothing to apply for  (interface)
--   3. balances never materialise — D12 says "created lazily on first read",
--      and ensure_balance's only caller is leave_submit. Nothing reads.
--   4. a new organisation gets no approval chain, so the first submission
--      raises APPROVER_UNRESOLVED — "ask your administrator", shown to the
--      administrator
--
-- So this file seeds NOTHING. It creates an organisation the way the product
-- does, and asserts that a person can then actually use it. That is the whole
-- point: the assertions below are worthless if anything sets up their
-- preconditions for them.
--
-- Runs standalone — it defines its own helpers rather than borrowing
-- verify_rls.sql's, because pg_temp lives and dies with a psql session.

-- ---------------------------------------------------------------- helpers

create or replace function pg_temp.as_user(_uid uuid) returns void as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', _uid::text, 'role', 'authenticated')::text, true);
end $$ language plpgsql;

create or replace function pg_temp.as_postgres() returns void as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$ language plpgsql;

create or replace function pg_temp.fail(_label text, _detail text) returns void as $$
begin
  raise exception 'FIRST RUN FAIL: % — %', _label, _detail;
end $$ language plpgsql;

-- A working day comfortably in the future, so notice periods and weekend rules
-- never make a test fail for a reason it is not testing.
create or replace function pg_temp.next_working_day(_org uuid, _from date)
returns date as $$
declare
  d date := _from;
begin
  for i in 1 .. 14 loop
    if public.calculate_working_days(_org, d, d) > 0 then return d; end if;
    d := d + 1;
  end loop;
  raise exception 'no working day found within a fortnight of % — check weekend configuration', _from;
end $$ language plpgsql;

-- ---------------------------------------------------------------- the test

do $$
declare
  v_founder uuid := '00000000-0000-0000-0000-00000000f1f1';
  v_staff   uuid := '00000000-0000-0000-0000-00000000f1f0';   -- Neuvto, not a tenant
  v_token   text;
  v_org     uuid;
  v_type    uuid;
  v_free    uuid;
  v_req     uuid;
  v_from    date;
  v_to      date;
  v_status  text;
  v_appr    uuid;
  v_bal     record;
  -- Captured while acting as the founder and reused thereafter. org_today() and
  -- get_financial_year() both call assert_own_org(), so asking them anything as
  -- postgres raises TENANT_MISMATCH — current_org_id() is null for a role with
  -- no profile. Which is the isolation working, not a fault.
  v_today   date;
  v_fy      text;
  -- The FY the REQUESTED dates fall in, which is not always this one: a request
  -- made in late March lands in the next financial year.
  v_fy_from text;
  n         bigint;
begin
  -- BY NAME, NOT BY SIGNATURE.
  --
  -- This read `to_regprocedure('public.provision_organization(text,text,text,
  -- text,text)')` until 8 Aug 2026, when `_is_test boolean` was added
  -- (20260821100000) and the function was dropped and recreated with six
  -- arguments. The five-argument signature stopped resolving, this guard went
  -- permanently null, and all 317 lines below skipped with one notice and
  -- **exit 0** — the file whose own header says it exists because "three faults
  -- lived through a green harness".
  --
  -- A signature is a detail of how the function is called. Whether provisioning
  -- exists is the question being asked, and only the name answers it.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'provision_organization'
  ) then
    raise notice 'skipped: first-run checks (provisioning not built yet)';
    return;
  end if;

  -- ══════════════════════════════════════════════════ a workspace, from nothing
  --
  -- Exactly the path a real customer takes, and no other: Sada provisions the
  -- workspace and names its first administrator, who then accepts an invitation
  -- like anybody else (D39). There is no self-serve signup to shortcut through
  -- any more, and nothing here creates a profile, a leave type, a balance or an
  -- approval chain by hand. That restraint is the whole value of this file.

  perform pg_temp.as_postgres();

  delete from public.invitations   where email = 'founder@first-run.test';
  delete from public.organizations where slug = 'first-run-test';
  delete from public.platform_admins where user_id = v_staff;
  delete from auth.users where id in (v_founder, v_staff);

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at,
                          raw_app_meta_data, raw_user_meta_data)
  values
    (v_staff, '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'staff@neuvto.test',
     crypt('x', gen_salt('bf')), now(), now(), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb),
    (v_founder, '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'founder@first-run.test',
     crypt('x', gen_salt('bf')), now(), now(), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb);

  -- Neuvto staff. No profile, and deliberately never given one — that absence is
  -- what makes current_org_id() null and every tenant policy refuse them (D42).
  insert into public.platform_admins (user_id, note) values (v_staff, 'harness');

  perform pg_temp.as_user(v_staff);
  v_org := public.provision_organization(
    'First Run Test Co', 'first-run-test',
    'founder@first-run.test', '+91 90000 00001', 'First Founder');

  perform pg_temp.as_postgres();
  select token into v_token from public.invitations
   where organization_id = v_org and role = 'org_admin' and accepted_at is null;
  if v_token is null then
    perform pg_temp.fail(
      'provisioning created no administrator invitation',
      'provision_organization must invite the named admin — it creates no profile, so without an invitation nobody can ever reach the workspace (D39)');
  end if;

  perform pg_temp.as_user(v_founder);
  perform public.invitation_accept(v_token);
  raise notice 'ok: provisioning invites an administrator who accepts their way in';

  v_today := public.org_today(v_org);
  v_fy    := public.get_financial_year(v_org, v_today);

  -- ══════════════════════════════════════════════════ 1 · an approval chain

  -- D37. Without this the very first leave request raises APPROVER_UNRESOLVED,
  -- and the message tells the administrator to ask an administrator.
  perform pg_temp.as_postgres();
  select count(*) into n from public.approval_chains
   where organization_id = v_org and entity_type = 'leave_request' and deleted_at is null;

  if n = 0 then
    perform pg_temp.fail(
      'a new organisation has no approval chain',
      'signup created no approval_chains row, so approval_submit resolves no level and the first request dies with APPROVER_UNRESOLVED (D37)');
  end if;
  raise notice 'ok: a new organisation gets a default approval chain';

  -- ══════════════════════════════════════════════════ 2 · balances on first read

  -- The admin creates a leave type, exactly as the new screen will.
  perform pg_temp.as_user(v_founder);
  insert into public.leave_types (organization_id, name, max_days_per_year, approval_required)
  values (v_org, 'Casual', 12, true)
  returning id into v_type;

  -- D12/D36. The employee now opens the dashboard. That read alone must produce
  -- a balance — the alternative is a card reading "no balance yet" until they
  -- guess their way through a submission, which is where this was found.
  if to_regprocedure('public.leave_my_balances()') is null then
    perform pg_temp.fail(
      'nothing materialises a balance on read',
      'D12 says balance rows are created lazily on first read and ensure_balance is commented that way, but its only caller is leave_submit. leave_my_balances() does not exist, so getMyBalances() reads an empty table (D36)');
  end if;

  select count(*) into n from public.leave_my_balances();
  if n = 0 then
    perform pg_temp.fail(
      'leave_my_balances returned nothing for an active leave type',
      'the type exists and is active, so a balance row for the current financial year should have been created on this read');
  end if;
  raise notice 'ok: reading a balance creates it (D12/D36)';

  -- D34 must survive the change. Materialising eagerly would recreate exactly
  -- the next-year buckets that decision exists to hide.
  select count(*) into n from public.leave_balances
   where organization_id = v_org and fy_label <> v_fy;
  if n > 0 then
    perform pg_temp.fail(
      'a balance was materialised outside the current financial year',
      format('%s row(s) for another year — D34 keeps next year hidden until its booking window opens', n));
  end if;
  raise notice 'ok: only the current financial year is materialised (D34 holds)';

  -- ══════════════════════════════════════════════════ 3 · leave without an approver

  -- D38. A one-person workspace has nobody to approve anything: the founder is
  -- the only profile, and D13 forbids self-approval. approval_required exists in
  -- the schema for exactly this and has been read by nothing since step 6.
  perform pg_temp.as_user(v_founder);
  insert into public.leave_types (organization_id, name, max_days_per_year, approval_required)
  values (v_org, 'Comp Off', 5, false)
  returning id into v_free;

  v_from  := pg_temp.next_working_day(v_org, v_today + 7);
  v_to    := v_from;
  v_fy_from := public.get_financial_year(v_org, v_from);

  begin
    v_req := public.leave_submit(v_free, v_from, v_to, 'first run');
  exception when others then
    perform pg_temp.fail(
      'a no-approval leave type could not be submitted',
      format('leave_submit raised %s. approval_required = false must mean approved on submission, not routed to an approver who does not exist (D38)', sqlerrm));
  end;

  perform pg_temp.as_postgres();
  select status, approval_request_id into v_status, v_appr
    from public.leave_requests where id = v_req;

  if v_status <> 'approved' then
    perform pg_temp.fail(
      'a no-approval leave type was not approved on submission',
      format('status is %s, expected approved (D38)', v_status));
  end if;
  if v_appr is not null then
    perform pg_temp.fail(
      'a no-approval request was routed to the approval engine anyway',
      'approval_request_id should be null — there is no chain to freeze and nobody to decide');
  end if;
  raise notice 'ok: approval_required = false is honoured (D38)';

  -- The days must have moved, and to the right bucket. A request marked approved
  -- whose balance never changed is the same class of fault as the stranded
  -- reservation D33 was written for, and just as invisible.
  select * into v_bal from public.leave_balances
   where organization_id = v_org and employee_id = v_founder
     and leave_type_id = v_free
     and fy_label = v_fy_from;

  if v_bal.pending_days <> 1 then
    perform pg_temp.fail(
      'approved leave did not land in pending_days',
      format('pending_days is %s, expected 1 — future approved leave sits in pending until it is taken', v_bal.pending_days));
  end if;
  if v_bal.reserved_days <> 0 then
    perform pg_temp.fail(
      'a reservation was left behind',
      format('reserved_days is %s, expected 0 — the days were reserved on submission and must not stay there once approved', v_bal.reserved_days));
  end if;
  raise notice 'ok: the days moved to the right bucket';

  -- ══════════════════════════════════════════════════ 4 · and it cancels cleanly

  -- leave_cancel's null-approval branch was written as defensive and never
  -- taken. D38 makes it a live path, so it is now worth asserting: cancelling
  -- must return the days exactly once.
  perform pg_temp.as_user(v_founder);
  perform public.leave_cancel(v_req);

  perform pg_temp.as_postgres();
  select * into v_bal from public.leave_balances
   where organization_id = v_org and employee_id = v_founder
     and leave_type_id = v_free
     and fy_label = v_fy_from;

  if v_bal.pending_days <> 0 or v_bal.reserved_days <> 0 then
    perform pg_temp.fail(
      'cancelling a no-approval request did not return the days',
      format('reserved %s, pending %s — both should be 0', v_bal.reserved_days, v_bal.pending_days));
  end if;
  if v_bal.available_days <> v_bal.entitled_days + v_bal.carryforward_days then
    perform pg_temp.fail(
      'the balance did not return to its starting value',
      format('available %s against entitled %s — a double release inflates the balance and violates nothing, which is what makes it dangerous',
             v_bal.available_days, v_bal.entitled_days));
  end if;
  raise notice 'ok: cancellation returns the days exactly once';

  -- ---------------------------------------------------------------- cleanup
  --
  -- Child-first, explicitly. Every foreign key in this schema names its own
  -- ON DELETE (D19 — never a Postgres default), and the ones pointing at a
  -- person or an organisation are deliberately RESTRICT: leave history must not
  -- evaporate because somebody was removed. Which is correct, and means a test
  -- has to take its own fixtures down in order.
  perform pg_temp.as_postgres();

  delete from public.notifications   where organization_id = v_org;
  delete from public.invitations     where organization_id = v_org;
  delete from public.leave_requests  where organization_id = v_org;
  delete from public.leave_balances  where organization_id = v_org;
  delete from public.leave_types     where organization_id = v_org;
  delete from public.approval_steps    where organization_id = v_org;
  delete from public.approval_requests where organization_id = v_org;
  delete from public.approval_chains   where organization_id = v_org;
  delete from public.notifications     where organization_id = v_org;
  delete from public.audit_logs        where organization_id = v_org;
  delete from public.analytics_events  where organization_id = v_org;
  delete from public.user_roles        where organization_id = v_org;
  delete from public.profiles          where organization_id = v_org;
  delete from public.organizations     where id = v_org;
  delete from public.platform_admins   where user_id = v_staff;
  delete from auth.users               where id in (v_founder, v_staff);

  raise notice '--- first-run verification passed ---';
end $$;

reset role;
