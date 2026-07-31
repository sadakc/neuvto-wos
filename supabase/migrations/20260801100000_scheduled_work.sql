-- ============================================================================
-- NEUVTO WOS — something has to actually run
--
-- Sada provisioned a customer, waited for the administrator's invitation email,
-- and nothing came. The email had been generated perfectly and was sitting in
-- `notifications` with status = 'pending', where it would have stayed forever.
--
-- notification-dispatch/index.ts says "Invoked on a schedule" at line 11. That
-- comment was the only occurrence of the word "schedule" in the repository.
-- There was no cron, no scheduled function, nothing in config.toml — and this
-- affected every email the product sends, not just invitations. It went
-- unnoticed for four build steps because the dispatcher had only ever been
-- invoked by hand, during verification, twice.
--
-- A queue nobody drains is indistinguishable from a queue with nothing in it.
--
-- The same fault, twice more:
--   leave_mature_balances  moves days from pending to used once leave has been
--                          taken. Granted to service_role, meant to be
--                          scheduled, never scheduled. Approved leave in the
--                          past sat in pending_days indefinitely.
--   module_enabled         see 20260801110000_module_boundary.sql
--
-- D43 — work that has to happen on a schedule is scheduled HERE, in a migration,
-- not clicked into a dashboard. A schedule that lives only in somebody's console
-- cannot be reviewed, cannot be restored after a rebuild, and cannot be seen by
-- the next person wondering why no email arrived.
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ═══════════════════════════════════════════════════════ configuration
--
-- The dispatcher lives outside the database, so calling it needs a URL and a
-- credential — both of which differ per environment and neither of which may
-- ever appear in a migration, because a migration is a file in git.
--
-- They go in Vault, set once per environment by hand. See
-- docs/operations/DEPLOYMENT.md.
create or replace function public.platform_secret(_name text)
returns text
language sql
stable
security definer
set search_path = public, vault
as $$
  select decrypted_secret from vault.decrypted_secrets where name = _name limit 1
$$;

comment on function public.platform_secret is
  'Reads a platform secret from Vault. Never granted to authenticated — this is for scheduled work running as postgres.';

revoke all on function public.platform_secret(text) from public, authenticated, anon;

-- ═══════════════════════════════════════════════════════ draining the queue

create or replace function public.dispatch_notifications()
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_url     text := public.platform_secret('notification_dispatch_url');
  v_key     text := public.platform_secret('notification_dispatch_key');
  v_pending bigint;
begin
  select count(*) into v_pending
    from public.notifications
   where status = 'pending' and deleted_at is null and next_attempt_at <= now();

  if v_pending = 0 then return; end if;

  -- UNCONFIGURED IS LOUD, NOT SILENT.
  --
  -- The whole defect this migration exists to fix was a delivery path that
  -- failed by doing nothing at all. So an unconfigured environment says so, in
  -- the Postgres log, every time it has mail it cannot send — rather than
  -- returning quietly and looking exactly like success.
  --
  -- A warning and not an exception: a fresh database, and CI, legitimately have
  -- no Vault secrets, and failing the job there would be noise that trains
  -- people to ignore it.
  if v_url is null or v_key is null then
    raise warning
      'dispatch_notifications: % notification(s) waiting but Vault has no notification_dispatch_url/key — nothing will be delivered. See docs/operations/DEPLOYMENT.md.',
      v_pending;
    return;
  end if;

  -- Fire and forget. pg_net queues the request and the dispatcher records the
  -- outcome against each row itself; waiting for the response here would hold a
  -- transaction open across a network call for no benefit.
  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || v_key),
    body    := '{}'::jsonb
  );
end $$;

comment on function public.dispatch_notifications is
  'D43 — hands the pending queue to the dispatcher. Warns rather than failing when unconfigured, because silence is what hid this for four steps.';

revoke all on function public.dispatch_notifications() from public, authenticated, anon;

-- ═══════════════════════════════════════════════════════ the schedule itself
--
-- ONLY THE PLATFORM'S OWN WORK IS SCHEDULED HERE.
--
-- The first draft of this migration also defined mature_all_balances(), which
-- looped organisations calling leave_mature_balances() — platform code naming a
-- module, which is the one thing D30 exists to forbid. A module schedules its
-- own work in its own migration; see 20260801120000_leave_module_guard.sql.

do $$
begin
  -- Idempotent: re-running this migration, or applying it to a database that
  -- already has the jobs, must not produce a second copy of either.
  perform cron.unschedule('neuvto-dispatch-notifications')
    where exists (select 1 from cron.job where jobname = 'neuvto-dispatch-notifications');

  -- Every minute. An invitation that takes a minute reads as "sent"; one that
  -- takes fifteen reads as broken, and the person is already emailing support.
  perform cron.schedule(
    'neuvto-dispatch-notifications',
    '* * * * *',
    $job$select public.dispatch_notifications()$job$
  );
end $$;
