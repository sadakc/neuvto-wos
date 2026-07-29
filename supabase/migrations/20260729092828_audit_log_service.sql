-- ============================================================================
-- NEUVTO WOS — Platform service: Audit Log
--
-- Build step 3. A shared service, not a leave feature: Attendance, Payroll and
-- every later module write here through the same trigger.
--
-- Two properties matter more than the schema:
--   1. Immutable. INSERT is the only verb granted, to anyone, including
--      org_admin. There is no legitimate reason to edit an audit trail, and the
--      moment one exists the trail stops being evidence.
--   2. Written by trigger, never by application code. Code that must remember
--      to log is code that will eventually forget — and the omission is
--      invisible, because a missing row looks exactly like nothing happening.
-- ============================================================================

-- No foreign keys, deliberately. An audit trail has to outlive everything it
-- describes, and a reference in either direction breaks that:
--
--   • ON DELETE CASCADE erases the trail for whatever was deleted — destroying
--     precisely the evidence you need about a deletion.
--   • ON DELETE SET NULL keeps the row but forgets who did it, or which tenant
--     it belonged to.
--   • Any FK at all makes auditing a DELETE impossible: the trigger fires while
--     the row is going away, so the insert fails against a parent that no
--     longer exists. That is exactly how this was found.
--
-- These are therefore plain identifiers. Referential integrity is traded away
-- on purpose for a record that survives.

create table public.audit_logs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid,
  actor_id        uuid,
  action          text not null,          -- 'profiles.update', 'user_roles.insert'
  entity_type     text not null,
  entity_id       uuid,
  before          jsonb,
  after           jsonb,
  ip_address      text,
  user_agent      text,
  created_at      timestamptz not null default now(),
  constraint audit_action_format check (action ~ '^[a-z_]+\.[a-z_]+$')
);

create index idx_audit_org_time    on public.audit_logs (organization_id, created_at desc);
create index idx_audit_entity      on public.audit_logs (entity_type, entity_id, created_at desc);
create index idx_audit_actor       on public.audit_logs (actor_id, created_at desc);

-- ─────────────────────────────────────────────────────────── the trigger

create or replace function public.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
  v_after  jsonb;
  v_org    uuid;
  v_entity uuid;
  v_headers json;
begin
  if tg_op = 'DELETE' then
    v_before := to_jsonb(old);
    v_after  := null;
  elsif tg_op = 'INSERT' then
    v_before := null;
    v_after  := to_jsonb(new);
  else
    v_before := to_jsonb(old);
    v_after  := to_jsonb(new);
    -- Nothing actually changed: skip rather than write a row saying so.
    if v_before = v_after then
      return coalesce(new, old);
    end if;
  end if;

  -- `organizations` is its own tenant, so its key is `id`; every other table
  -- carries `organization_id`.
  v_org := nullif(coalesce(v_after, v_before) ->> 'organization_id', '')::uuid;
  if v_org is null and tg_table_name = 'organizations' then
    v_org := nullif(coalesce(v_after, v_before) ->> 'id', '')::uuid;
  end if;

  v_entity := nullif(coalesce(v_after, v_before) ->> 'id', '')::uuid;

  -- Request context is present for API calls and absent for migrations, seeds
  -- and scheduled jobs. Absence is normal, not an error.
  begin
    v_headers := current_setting('request.headers', true)::json;
  exception when others then
    v_headers := null;
  end;

  insert into public.audit_logs (
    organization_id, actor_id, action, entity_type, entity_id,
    before, after, ip_address, user_agent
  ) values (
    v_org,
    (select auth.uid()),
    tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    v_entity,
    v_before,
    v_after,
    v_headers ->> 'x-forwarded-for',
    v_headers ->> 'user-agent'
  );

  return coalesce(new, old);
end $$;

comment on function public.write_audit_log is
  'Generic audit trigger. Attach AFTER insert/update/delete to any table that mutates business state. Never call from application code.';

-- ─────────────────────────────────────────────────────────── attach
-- AFTER, so a failed write never leaves an audit row claiming it succeeded.
-- Deliberately NOT attached to:
--   audit_logs        — would recurse infinitely
--   analytics_events  — append-only telemetry; auditing it doubles the volume
--                       and tells you nothing you cannot read from the events
--   modules           — a global registry seeded by migration, with no tenant

create trigger write_audit_log after insert or update or delete on public.organizations
  for each row execute function public.write_audit_log();
create trigger write_audit_log after insert or update or delete on public.organization_settings
  for each row execute function public.write_audit_log();
create trigger write_audit_log after insert or update or delete on public.module_settings
  for each row execute function public.write_audit_log();
create trigger write_audit_log after insert or update or delete on public.departments
  for each row execute function public.write_audit_log();
create trigger write_audit_log after insert or update or delete on public.profiles
  for each row execute function public.write_audit_log();
create trigger write_audit_log after insert or update or delete on public.organization_modules
  for each row execute function public.write_audit_log();

-- user_roles is the privilege boundary. Every grant and revoke is recorded.
create trigger write_audit_log after insert or update or delete on public.user_roles
  for each row execute function public.write_audit_log();

-- ─────────────────────────────────────────────────────────── grants and RLS
-- INSERT only. No UPDATE, no DELETE, for any role. The trigger is SECURITY
-- DEFINER so it writes regardless; this grant covers nothing else.

grant insert, select on public.audit_logs to authenticated;

alter table public.audit_logs enable row level security;

create policy "admins read own-org audit trail" on public.audit_logs
  for select to authenticated
  using (organization_id = public.current_org_id() and public.is_admin());

-- There is intentionally no INSERT policy for authenticated: rows arrive only
-- through the SECURITY DEFINER trigger, so nobody can forge an entry.
--
-- There is intentionally no UPDATE or DELETE policy at all. Without one, RLS
-- denies both to every role — which is the whole point, and is asserted by
-- neuvto-harness/tests/verify_rls.sql.

comment on table public.audit_logs is
  'Immutable audit trail. Insert-only via trigger; no UPDATE or DELETE policy exists for any role. Retained 7 years.';
