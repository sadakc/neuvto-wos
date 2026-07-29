-- ============================================================================
-- Fix: the audit trigger made auth users undeletable
--
-- Phase 0's set_audit_fields() restored created_at/created_by from the previous
-- row on every UPDATE, so that authorship could not be rewritten by a crafted
-- request. Correct intent, too broad in practice.
--
-- Deleting an auth user fires `created_by ... on delete set null`, which is an
-- UPDATE setting created_by to NULL. The trigger immediately put the old value
-- back, and the foreign key then failed against a user that no longer exists:
--
--   ERROR: insert or update on table "organizations" violates foreign key
--          constraint "organizations_created_by_fkey"
--
-- Net effect: nobody who had ever created a row could be deleted. That silently
-- blocks D23's erase_employee(), which is a compliance obligation, and it was
-- invisible until the harness tried to clean up after itself.
--
-- The fix narrows the guard to what it was actually defending against: a
-- request from an authenticated user. System contexts — cascades, migrations,
-- seeds, scheduled jobs — have no auth.uid() and are allowed to change these
-- columns. A client still cannot forge or rewrite authorship, because a client
-- always has an auth.uid().
-- ============================================================================

create or replace function public.set_audit_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    -- The authenticated user always wins; the fallback covers system contexts.
    new.created_by := coalesce(v_uid, new.created_by);
  elsif v_uid is not null then
    -- A real user request: authorship is immutable.
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;
  -- else: system context (FK cascade, migration, seed) — leave the values alone.

  new.updated_at := now();
  new.updated_by := v_uid;
  return new;
end $$;

comment on function public.set_audit_fields is
  'D16 — maintains created_at/by and updated_at/by. Authorship is immutable for authenticated requests; system contexts (FK cascades, migrations) may change it, or auth users could never be deleted.';
