-- ============================================================================
-- NEUVTO WOS — an anonymous caller executes nothing
--
-- Found on production, 2 Aug 2026, minutes after the cutover completed:
--
--     curl -s -X POST "$URL/rest/v1/rpc/notify_address" \
--       -H "apikey: <the publishable key, which ships in the client bundle>" \
--       -d '{"_event_key":"...","_org_id":"...","_email":"anyone@anywhere",...}'
--
--     {"code":"23503","message":"insert or update on table \"notifications\"
--      violates foreign key constraint \"notifications_organization_id_fkey\""}
--
-- A FOREIGN KEY error. Not "not authenticated" — the function never asked who
-- was calling. It reached the INSERT and was stopped only by a deliberately
-- fake organisation id. With a real one, an anonymous caller queues mail to any
-- address, and `pg_cron` delivers it a minute later from a verified domain.
-- That is an open relay, and the reputational damage to a sending domain is not
-- quickly undone.
--
-- Production had zero organisations, so it was not exploitable. It would have
-- become so the moment the first customer was provisioned.
--
-- ── WHY THE MIGRATIONS LOOKED CORRECT AND WERE NOT
--
-- `20260730140000_notification_engine.sql` says:
--
--     revoke execute on function public.notification_claim_batch(integer)
--       from public, authenticated;
--
-- It omits `anon`, and that omission is invisible locally. The two environments
-- disagree about what a new function is granted:
--
--   pg_default_acl for role `postgres`, schema `public`, functions
--     local       {postgres=X}
--     production  {postgres=X, anon=X, authenticated=X, service_role=X}
--
-- Migrations run as `postgres`. On production every function it creates is
-- given an EXPLICIT grant to `anon`; locally it gets only the implicit grant to
-- PUBLIC. `revoke ... from public` removes the implicit one and leaves the
-- explicit one untouched — so the same statement secures the local database and
-- does nothing at all to the hosted one.
--
-- The harness could never have caught this. It asserts against a database where
-- the hole cannot exist. Part 1 below fixes that, which matters more than the
-- revocations: it is the difference between fixing 48 functions today and every
-- function anybody writes from now on.
-- ============================================================================

-- ── 1 · make the two environments agree, deny-by-default
--
-- Deliberately the opposite direction from Supabase's hosted default. A new
-- function is reachable by nobody until a later statement says otherwise, in
-- every environment, so forgetting to think about grants fails closed.
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;

-- ── 2 · take back what is already granted
--
-- Every function in `public`, including the ones whose migrations did revoke
-- correctly — repeating a revoke is free, and enumerating exceptions is how one
-- gets missed. `service_role` is left alone: the notification dispatcher runs
-- under it, and it is not reachable from a browser.
do $$
declare
  r record;
  n int := 0;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
    n := n + 1;
  end loop;
  raise notice 'revoked execute from public/anon/authenticated on % functions', n;
end $$;

-- ── 3 · grant back exactly what the browser calls
--
-- Sourced by grepping `supabase.rpc("…")` across src/ — every client call goes
-- through it, so the list is derivable rather than remembered. By NAME, so all
-- overloads are covered and a changed signature cannot silently drop a grant;
-- the loop raises if a name matches nothing, because a typo here is a feature
-- that stops working in the browser and nowhere else.
do $$
declare
  wanted text[] := array[
    -- platform · identity and membership
    'my_account_status', 'is_platform_admin',
    'invitation_create', 'invitation_accept', 'invitation_revoke',
    'admin_set_reporting_line', 'admin_set_joined_date',
    'deactivate_employee', 'deactivation_impact', 'reactivate_employee',
    -- platform · console
    'provision_organization', 'platform_list_organizations',
    'platform_list_org_modules', 'platform_set_module',
    -- platform · calendar
    'org_today', 'get_financial_year', 'calculate_working_days',
    'working_days_excluded',
    -- platform · approvals
    --
    -- `approval_submit` is not called from src/ — modules submit on an
    -- employee's behalf from SQL, where SECURITY DEFINER makes the caller's
    -- grant irrelevant. It is granted anyway because the engine is a platform
    -- API whose guards assume a human caller: it reads auth.uid() and
    -- current_org_id(), raises UNAUTHENTICATED without a session, and refuses
    -- self-approval. The harness drives it as a real user with a non-leave
    -- entity type — the entity-agnostic claim from step 4 — and that test is
    -- worth more than the grant costs.
    'approval_queue', 'approval_decide', 'approval_submit', 'approval_timeline',
    -- leave module
    'leave_submit', 'leave_cancel', 'leave_my_balances', 'leave_all_balances',
    'leave_approval_detail', 'leave_set_opening_balance'
  ];
  nm text;
  r  record;
  hits int;
begin
  foreach nm in array wanted loop
    hits := 0;
    for r in
      select p.oid::regprocedure as sig
        from pg_proc p
        join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public' and p.proname = nm
    loop
      execute format('grant execute on function %s to authenticated', r.sig);
      hits := hits + 1;
    end loop;
    if hits = 0 then
      raise exception 'GRANT_TARGET_MISSING: no function public.% exists', nm;
    end if;
  end loop;
end $$;

-- ── 3b · the functions every RLS policy calls
--
-- Not optional, and not obvious. A policy expression is evaluated as the
-- QUERYING user, so `using (is_manager_of(employee_id))` requires that user to
-- hold EXECUTE on `is_manager_of`. Without it every read against that table
-- fails with `permission denied for function is_manager_of` — the table looks
-- broken, and nothing points at a grant.
--
-- Found by the harness on the first run of this migration, not by reasoning
-- about it. Derived from pg_policies rather than listed by hand:
--
--   select distinct proname from pg_proc, pg_policies
--    where (qual || with_check) ~ ('\m' || proname || '\M');
--
-- Each takes no caller-supplied identity — they ask about `auth.uid()` and
-- answer about the caller alone — so `authenticated` may hold them. `anon` may
-- not, and does not need them: every policy also requires `current_org_id()`,
-- which is null without a session, so an anonymous read matches no rows anyway.
grant execute on function public.current_org_id()          to authenticated;
grant execute on function public.is_admin()                to authenticated;
grant execute on function public.is_manager_of(uuid)       to authenticated;
grant execute on function public.is_approver_on(uuid)      to authenticated;
grant execute on function public.is_requester_of(uuid)     to authenticated;

-- ── what is deliberately NOT granted
--
-- These are reachable today and stay unreachable. Each was checked for a caller
-- guard and has none — they are helpers invoked by functions that have already
-- established who is asking, and each is a hole if exposed directly:
--
--   notify, notify_address        queue mail to any address — the open relay
--   notification_claim_batch      drain another process's delivery batch
--   notification_mark_*           mark mail sent that never was
--   ensure_balance                materialise balances for anybody
--   leave_mark_approved           approve leave without an approval
--   install_default_approval_chain  rewrite how a workspace routes approvals
--   leave_mature_all_balances     run the annual roll-over on demand
--   calculate_entitlement, module_enabled_for,
--   organization_display_name, approval_entity_label
--                                 read across tenants given an id
--
-- The harness calls several of them; it must do so as `postgres`, which is what
-- pg_temp.as_postgres() is for. A test that needs a grant the browser does not
-- have is testing at the wrong level, and widening a grant to make a test pass
-- is how the exposure got here in the first place.

-- ── 4 · the dispatcher keeps what it had
--
-- Restated rather than assumed. Step 2 revoked from public/anon/authenticated
-- only, but these four are the reason the queue drains and a mistake here is
-- silent — mail simply stops.
grant execute on function public.notification_claim_batch(integer) to service_role;
grant execute on function public.notification_mark_sent(uuid)      to service_role;
grant execute on function public.notification_mark_failed(uuid, text) to service_role;
grant execute on function public.notification_mark_retry(uuid, text)  to service_role;

comment on function public.notify_address(text, uuid, text, text, jsonb) is
  'INTERNAL. Queues mail to an arbitrary address with no caller check — it is called by functions that have already established who is asking. Never grant this to anon or authenticated: it was reachable anonymously on production on 2 Aug 2026 and is an open relay in that state.';
