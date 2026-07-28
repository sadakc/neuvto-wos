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

  raise notice '--- invariant verification passed ---';
end $$;
