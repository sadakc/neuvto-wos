-- NEUVTO WOS — a missing notification template announces itself
--
-- ── what happened
--
-- On 6 Aug 2026 an org_admin was invited to the first real customer workspace
-- and no email arrived. The invitation itself was fine. The notification row
-- was there too, and it said everything:
--
--     event_key: member.invited   status: failed
--     attempts: 0                 failed_reason: NO_TEMPLATE
--
-- Zero attempts. It never reached Resend, never reached the dispatcher, never
-- reached a queue. `notification_templates` was EMPTY in production — all four
-- system defaults gone — so `notify_address` took the branch it is designed to
-- take when a template cannot be found: record the failure, do not raise, let
-- the invitation stand. That branch is correct and it did its job. Nothing was
-- corrupted. The email was simply never composed.
--
-- What emptied the table is not known. The row counters are consistent with
-- the delete/re-seed pair in 20260803100000 being replayed several times during
-- the migration-ledger divergence and ending on a delete, but that is a story
-- that fits the numbers, not evidence, and it is written here as a story.
--
-- ── why this migration is not the fix
--
-- Re-asserting the defaults below repairs any environment that is missing them
-- on the next push. It does nothing whatsoever about the NEXT time, because a
-- migration runs once. The actual protection is `missing_system_notification_
-- templates()`, which the harness and prod-cutover.sh both call — see the
-- comment on that function.
--
-- ── why nobody noticed for the better part of a week
--
-- Every notification event in the product routes through the same lookup:
-- approval.submitted, approval.decided, approval.completed, member.invited.
-- All four were dead. Nothing said so, because on a workspace with no members
-- yet, nothing had tried to send anything. The first attempt was also the
-- first customer-visible one.

-- ─────────────────────────────────────────────────────────── repair
--
-- Idempotent by construction: the function inserts only what is absent (see
-- its `where not exists`). On an environment that already has all four this
-- is a no-op, which is what makes it safe to re-run from a migration.
select public.ensure_system_notification_templates();

-- ─────────────────────────────────────────────────────────── the guard
--
-- Returns the system event keys that have NO active template, so a caller can
-- print them. Empty array means healthy.
--
-- A function rather than a query pasted into two test files, for the same
-- reason `ensure_system_notification_templates` is a function rather than a
-- bare INSERT: the harness and the production cutover must ask the SAME
-- question. Two copies of "which templates must exist" is one copy plus a
-- copy that silently stops matching.
--
-- The required list is stated here rather than derived from the emit sites,
-- because there is no honest way to derive it — `notify()` takes its event key
-- as a runtime argument. It is kept correct by the second assertion in
-- verify_invariants.sql, which fails on ANY notification recorded with
-- NO_TEMPLATE. That one needs no list: emit an event with no template and the
-- harness fails on the row it produces.
create or replace function public.missing_system_notification_templates()
returns text[]
language sql
stable
set search_path = public
as $$
  select coalesce(array_agg(k order by k), array[]::text[])
  from unnest(array[
    'approval.submitted',
    'approval.decided',
    'approval.completed',
    'member.invited'
  ]) as k
  where not exists (
    select 1
      from public.notification_templates t
     where t.event_key = k
       and t.channel = 'email'
       and t.organization_id is null
       and t.is_active
       and t.deleted_at is null
  );
$$;

comment on function public.missing_system_notification_templates is
  'System notification event keys with no active default template. Empty array means healthy. Called by verify_invariants.sql and by prod-cutover.sh after a push — a missing template is silent everywhere else until a customer does not receive an email.';

-- Platform infrastructure, and it names no customer data. Readable by any
-- signed-in caller for the same reason platform_mail_health is: the console
-- needs it, and the answer is a list of four constants either way.
revoke all on function public.missing_system_notification_templates() from public, anon;
grant execute on function public.missing_system_notification_templates() to authenticated;
