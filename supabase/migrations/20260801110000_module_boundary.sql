-- ============================================================================
-- NEUVTO WOS — the module boundary, enforced
--
-- Neuvto is a platform onto which modules are deployed multi-tenant. That
-- sentence has been the design since step 6 and, until now, `module_enabled()`
-- was called by nothing at all.
--
-- Test scenario 12 has always read: "Disable the `leave` module for an org →
-- routes AND functions refuse." Half of it was true. The route registry filters
-- by enablement, so the screens disappear — but `leave_submit` never asked, and
-- would happily accept a request for a company that had Leave switched off.
--
-- The third dead capability in two steps, after `ensure_balance` (D36) and
-- `approval_required` (D38). scripts/verify-functions-wired.sh now fails CI on
-- the pattern.
--
-- TWO LEVELS, deliberately, because they answer different questions:
--
--   the ROW exists   Neuvto sells this customer this module.  Platform admins.
--   enabled = true   the customer has switched it on.         Their admins.
--
-- Both are needed. Without the first, a customer's own administrator could
-- grant themselves Payroll by inserting a row — which the previous "admins
-- toggle modules" policy, being FOR ALL, allowed outright.
--
-- D44 — a module is off unless Neuvto granted it AND the customer enabled it,
-- and that is enforced in the database rather than in the router.
-- ============================================================================

-- ═══════════════════════════════════════════════ asking about an explicit org
--
-- `module_enabled()` resolves the organisation from the caller's profile, which
-- is right for a request and useless for scheduled work: a cron job runs as
-- postgres, has no profile, and would be told every module is off.
--
-- So the real question takes the organisation, and the convenient one delegates.
create or replace function public.module_enabled_for(_org_id uuid, _module_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select om.enabled
      from public.organization_modules om
      join public.modules m on m.key = om.module_key
     where om.organization_id = _org_id
       and om.module_key = _module_key
       and om.deleted_at is null
       -- A retired module is off however the row reads. Retiring one must not
       -- require finding every customer who still has it switched on.
       and m.status <> 'retired'
  ), false)
$$;

comment on function public.module_enabled_for is
  'D44 — whether a named organisation has a module both granted and switched on. Takes the org explicitly so scheduled work can ask.';

-- module_enabled(text) is DROPPED rather than kept as a convenience wrapper.
--
-- It resolved the organisation from the caller, which reads nicely in a request
-- and is silently wrong everywhere else: scheduled work has no profile, so it
-- would be told every module is off. Keeping both means two ways to ask one
-- question and a coin-flip about which is right in any given place.
--
-- Caught by scripts/verify-functions-wired.sh immediately after this migration
-- was first written: the guard was rewritten to call module_enabled_for, and the
-- original went straight back to being called by nothing — which is how it had
-- spent the previous three build steps.
drop function if exists public.module_enabled(text);

grant execute on function public.module_enabled_for(uuid, text) to authenticated;

-- ═══════════════════════════════════════════════════ who may grant, who may toggle

-- The row is Neuvto's decision. Insert and delete leave the application
-- entirely: a customer's administrator can no longer create their own
-- entitlement, which the old FOR ALL policy permitted.
revoke insert, delete on public.organization_modules from authenticated;

-- Column-level, so an admin can flip the switch and nothing else. Without this
-- an UPDATE could rewrite `module_key` on a row they legitimately hold and turn
-- a Leave grant into a Payroll one — an escalation dressed as an edit.
revoke update on public.organization_modules from authenticated;
grant update (enabled, enabled_at) on public.organization_modules to authenticated;

drop policy if exists "admins toggle modules" on public.organization_modules;

create policy "admins switch granted modules" on public.organization_modules
  for update to authenticated
  using (organization_id = public.current_org_id() and public.is_admin() and deleted_at is null)
  with check (organization_id = public.current_org_id() and public.is_admin());

-- ═══════════════════════════════════════════════════════ Neuvto's grant

create or replace function public.platform_set_module(
  _org_id     uuid,
  _module_key text,
  _granted    boolean
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if not exists (select 1 from public.modules where key = _module_key) then
    raise exception 'MODULE_NOT_FOUND' using errcode = 'P0001';
  end if;

  if _granted then
    -- Granted, and switched ON. A customer who has just been sold a module
    -- should find it working, not find a second switch nobody mentioned.
    insert into public.organization_modules
      (organization_id, module_key, enabled, enabled_at)
    values (_org_id, _module_key, true, now())
    on conflict (organization_id, module_key)
      do update set enabled = true, enabled_at = coalesce(public.organization_modules.enabled_at, now()),
                    deleted_at = null;
  else
    -- Withdrawn. Soft, per D17 — the customer's leave requests, balances and
    -- approvals are still theirs, and a hard delete would strand every row that
    -- references them. Re-granting restores access to all of it.
    update public.organization_modules
       set enabled = false, deleted_at = now()
     where organization_id = _org_id and module_key = _module_key;
  end if;
end $$;

comment on function public.platform_set_module is
  'D42/D44 — Neuvto grants or withdraws a module for a customer. Withdrawal is soft: their data stays and re-granting restores it.';

grant execute on function public.platform_set_module(uuid, text, boolean) to authenticated;

-- ═══════════════════════════════════════════════ what the console can read

-- Extends the platform's read surface by exactly one thing: which modules each
-- customer holds. Still no employee, no leave, no balance, no approval (D42).
create or replace function public.platform_list_org_modules(_org_id uuid)
returns table (module_key text, name text, status text, granted boolean, enabled boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  return query
    select m.key, m.name, m.status,
           (om.organization_id is not null and om.deleted_at is null),
           coalesce(om.enabled, false)
      from public.modules m
      left join public.organization_modules om
        on om.module_key = m.key and om.organization_id = _org_id
     order by m.name;
end $$;

comment on function public.platform_list_org_modules is
  'D42 — every module and whether this customer holds it. Discloses nothing about the customer beyond that.';

grant execute on function public.platform_list_org_modules(uuid) to authenticated;
