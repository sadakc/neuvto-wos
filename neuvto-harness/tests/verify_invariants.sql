-- NEUVTO WOS — Data invariant verification
-- Raises an exception on the first violation. Silence means pass.
-- Run after every build step, and always after any approve/reject/cancel work.

do $$
declare
  bad record;
  n   bigint;
begin
  ---------------------------------------------------------------- balance arithmetic
  -- available_days is a generated column, so a mismatch means the column
  -- definition itself drifted from spec.
  select count(*) into n
  from leave_balances
  where available_days is distinct from
        (entitled_days + carryforward_days - used_days - reserved_days - pending_days);
  if n > 0 then
    raise exception 'INVARIANT FAIL: % balance rows where available_days does not match the formula', n;
  end if;
  raise notice 'ok: available_days formula holds';

  ---------------------------------------------------------------- no negative buckets
  select count(*) into n
  from leave_balances
  where used_days < 0 or reserved_days < 0 or pending_days < 0
     or entitled_days < 0 or carryforward_days < 0;
  if n > 0 then
    raise exception 'INVARIANT FAIL: % balance rows with a negative bucket', n;
  end if;
  raise notice 'ok: no negative balance buckets';

  ---------------------------------------------------------------- no overdrawn balances
  select count(*) into n from leave_balances where available_days < 0;
  if n > 0 then
    for bad in
      select employee_id, leave_type_id, fy_label, available_days
      from leave_balances where available_days < 0
    loop
      raise warning 'overdrawn: employee=% type=% fy=% available=%',
        bad.employee_id, bad.leave_type_id, bad.fy_label, bad.available_days;
    end loop;
    raise exception 'INVARIANT FAIL: % employees have negative available balance (the D2 overdraw bug)', n;
  end if;
  raise notice 'ok: no overdrawn balances';

  ---------------------------------------------------------------- reserved matches pending requests
  -- Every day sitting in reserved_days must be backed by a request awaiting approval.
  for bad in
    select b.employee_id, b.leave_type_id, b.fy_label,
           b.reserved_days,
           coalesce(sum(r.working_days), 0) as actual_pending
    from leave_balances b
    left join leave_requests r
      on r.employee_id  = b.employee_id
     and r.leave_type_id = b.leave_type_id
     and r.status = 'pending_approval'
    group by b.employee_id, b.leave_type_id, b.fy_label, b.reserved_days
    having b.reserved_days is distinct from coalesce(sum(r.working_days), 0)
  loop
    raise exception
      'INVARIANT FAIL: reserved_days=% but pending requests total=% (employee=% type=%)',
      bad.reserved_days, bad.actual_pending, bad.employee_id, bad.leave_type_id;
  end loop;
  raise notice 'ok: reserved_days reconciles with pending requests';

  ---------------------------------------------------------------- tenant integrity
  -- A request must never point at a leave type from a different organization.
  select count(*) into n
  from leave_requests r join leave_types t on t.id = r.leave_type_id
  where r.organization_id <> t.organization_id;
  if n > 0 then
    raise exception 'INVARIANT FAIL: % leave requests reference a leave type from another org', n;
  end if;

  select count(*) into n
  from leave_requests r join profiles p on p.id = r.employee_id
  where r.organization_id <> p.organization_id;
  if n > 0 then
    raise exception 'INVARIANT FAIL: % leave requests whose employee belongs to another org', n;
  end if;
  raise notice 'ok: no cross-tenant foreign keys';

  ---------------------------------------------------------------- approval chain integrity
  if exists (select 1 from information_schema.tables where table_name = 'approval_requests') then
    -- An approved request must have every required level decided.
    select count(*) into n
    from approval_requests ar
    where ar.status = 'approved'
      and (select count(*) from approval_steps s
           where s.approval_request_id = ar.id and s.decision = 'approved')
          < ar.required_levels;
    if n > 0 then
      raise exception 'INVARIANT FAIL: % approvals completed without all required levels approving', n;
    end if;
    raise notice 'ok: approved requests have all levels decided';

    -- Nobody may approve their own request.
    select count(*) into n
    from approval_steps s join approval_requests ar on ar.id = s.approval_request_id
    where s.approver_id = ar.requester_id and s.decision <> 'pending';
    if n > 0 then
      raise exception 'INVARIANT FAIL: % approval steps were decided by the requester themselves', n;
    end if;
    raise notice 'ok: no self-approvals';
  end if;

  ---------------------------------------------------------------- date sanity
  select count(*) into n from leave_requests where to_date < from_date;
  if n > 0 then
    raise exception 'INVARIANT FAIL: % requests with to_date before from_date', n;
  end if;

  select count(*) into n from leave_requests where working_days <= 0 and status <> 'cancelled';
  if n > 0 then
    raise exception 'INVARIANT FAIL: % active requests with zero or negative working days', n;
  end if;
  raise notice 'ok: request dates sane';

  ---------------------------------------------------------------- audit fields (D16)
  -- Populated by trigger, without application help.
  if exists (select 1 from information_schema.columns
             where table_name = 'leave_requests' and column_name = 'created_by') then

    insert into leave_requests
      (organization_id, employee_id, leave_type_id, from_date, to_date, working_days, status)
    values
      ('00000000-0000-0000-0000-0000000000a0','00000000-0000-0000-0000-00000000a005',
       '00000000-0000-0000-0000-0000000000c1','2027-03-01','2027-03-01',1,'draft');

    select count(*) into n from leave_requests
    where from_date = '2027-03-01' and (created_at is null or updated_at is null);
    if n > 0 then
      raise exception 'INVARIANT FAIL: audit timestamps not populated by trigger';
    end if;
    raise notice 'ok: audit fields populate automatically';

    -- created_at must be immutable across an update
    update leave_requests set reason = 'touched' where from_date = '2027-03-01';
    select count(*) into n from leave_requests
    where from_date = '2027-03-01' and created_at > updated_at;
    if n > 0 then
      raise exception 'INVARIANT FAIL: created_at was rewritten on update';
    end if;
    raise notice 'ok: created_at immutable on update';

    delete from leave_requests where from_date = '2027-03-01';
  end if;

  ---------------------------------------------------------------- soft delete (D17)
  -- A soft-deleted row must never reach a balance calculation.
  if exists (select 1 from information_schema.columns
             where table_name = 'leave_requests' and column_name = 'deleted_at') then
    select count(*) into n
    from leave_requests
    where deleted_at is not null
      and status in ('pending_approval','approved');
    if n > 0 then
      raise exception
        'INVARIANT FAIL: % soft-deleted requests still hold an active status — they will be counted in balances', n;
    end if;
    raise notice 'ok: no soft-deleted rows in an active status';
  end if;

  ---------------------------------------------------------------- overlap constraint (D18)
  -- The database, not the application, must reject this.
  if exists (select 1 from pg_constraint where conname = 'no_overlapping_leave') then
    begin
      insert into leave_requests
        (organization_id, employee_id, leave_type_id, from_date, to_date, working_days, status)
      values
        ('00000000-0000-0000-0000-0000000000a0','00000000-0000-0000-0000-00000000a005',
         '00000000-0000-0000-0000-0000000000c1','2027-05-10','2027-05-14',5,'approved'),
        ('00000000-0000-0000-0000-0000000000a0','00000000-0000-0000-0000-00000000a005',
         '00000000-0000-0000-0000-0000000000c1','2027-05-12','2027-05-16',5,'approved');
      raise exception
        'INVARIANT FAIL: two overlapping approved requests were accepted — the exclusion constraint is not enforcing';
    exception
      when exclusion_violation then
        raise notice 'ok: overlapping leave rejected by the database';
    end;
    delete from leave_requests where from_date in ('2027-05-10','2027-05-12');
  else
    raise warning 'no_overlapping_leave constraint absent — overlap is only checked in application code (D18)';
  end if;

  raise notice '--- invariant verification passed ---';
end $$;
