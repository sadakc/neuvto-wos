-- ============================================================================
-- NEUVTO WOS — the first run
--
-- Steps 0–7 built a product that works beautifully for an organisation somebody
-- has already configured. On 31 Jul 2026 Sada signed up the way a customer
-- would and found a dashboard he could do nothing with.
--
-- Three of the four faults were here, in the database, and all three passed
-- every test because `seed_test_data.sql` hands the harness two organisations
-- with leave types, balances and approval chains already in place. The harness
-- has never started from the state a real customer starts from.
--
--   D36 — a balance materialises when it is READ, which is what D12 always said
--   D37 — an organisation is created with an approval chain
--   D38 — a leave type marked "no approval needed" is approved on submission
--
-- `neuvto-harness/tests/verify_first_run.sql` seeds nothing and asserts all
-- three. Every one of them was watched failing against the code before this
-- migration was written.
-- ============================================================================

-- ═══════════════════════════════════════════════════════ D36 · balances on read
--
-- D12: "Balance rows created lazily on first read for a financial year, not by a
-- scheduled job." ensure_balance() is commented exactly that way. Its only
-- caller was leave_submit — so nothing read, nothing was created, and
-- getMyBalances() selected from an empty table.
--
-- The employee's experience: "You don't have a leave balance yet" on a workspace
-- whose administrator had just set up leave types. The only way to get a balance
-- was to submit a request blind, against a number the screen could not show.
--
-- Deliberately takes no employee id. A function that materialises and returns
-- balances for an arbitrary person is one bad RLS day away from being a way to
-- read a colleague's leave; there is no reason for this to be that function.
create or replace function public.leave_my_balances()
returns table (
  leave_type_id     uuid,
  leave_type_name   text,
  fy_label          text,
  entitled_days     numeric,
  carryforward_days numeric,
  used_days         numeric,
  reserved_days     numeric,
  pending_days      numeric,
  available_days    numeric
)
language plpgsql
volatile                     -- it inserts; it is not stable and must not be marked so
security definer
set search_path = public
as $$
declare
  v_user uuid := (select auth.uid());
  v_org  uuid;
  v_fy   text;
  v_type record;
begin
  if v_user is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;

  select organization_id into v_org
    from public.profiles where id = v_user and deleted_at is null;
  if v_org is null then
    raise exception 'NO_ORGANIZATION' using errcode = 'P0001';
  end if;

  -- THE CURRENT YEAR ONLY. Materialising further ahead would create exactly the
  -- next-year buckets D34 exists to hide — two "Casual" cards, one showing 6 and
  -- one showing 12, which is how that decision came to be made in the first
  -- place. Next year's row is created by leave_submit when somebody books into
  -- it, which D34 only permits once the booking window opens.
  v_fy := public.get_financial_year(v_org, public.org_today(v_org));

  for v_type in
    select id from public.leave_types
     where organization_id = v_org
       and status = 'active'
       and deleted_at is null
  loop
    perform public.ensure_balance(v_user, v_type.id, v_fy);
  end loop;

  -- SECURITY DEFINER bypasses RLS, so the policy's predicate is restated here
  -- rather than inherited. It is the "own balance" arm of "read leave balances
  -- in scope" and nothing wider: not the manager arm, not the admin arm.
  return query
    select b.leave_type_id,
           t.name::text,
           b.fy_label,
           b.entitled_days,
           b.carryforward_days,
           b.used_days,
           b.reserved_days,
           b.pending_days,
           b.available_days
      from public.leave_balances b
      join public.leave_types t on t.id = b.leave_type_id
     where b.organization_id = v_org
       and b.employee_id = v_user
       and b.deleted_at is null
     order by b.fy_label desc, t.name;
end $$;

comment on function public.leave_my_balances is
  'D36 — the caller''s own balances, creating this year''s rows on read as D12 always specified. Never takes an employee id.';

grant execute on function public.leave_my_balances() to authenticated;

-- ═══════════════════════════════════════════════════ D37 · a chain from the start
--
-- signup_organization created the organisation, its settings, the founder's
-- profile, their org_admin role and the leave module — and no approval chain.
-- approval_submit resolves no level from zero rows, and refuses to auto-approve
-- (correctly, D13), so the first leave request anyone submitted died with
-- APPROVER_UNRESOLVED. The interface renders that as "There's nobody set up to
-- approve this. Ask your administrator to assign a manager", shown to the
-- administrator, about themselves.
--
-- The default matches what the spec has documented since D5 and what test
-- scenario 6 has always assumed exists: L1 always, L2 above three days. It is
-- rows, not code, so the chain editor changes it without a deploy.
create or replace function public.install_default_approval_chain(_org_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  -- Idempotent: re-running provisioning, or repairing an organisation created
  -- before this migration, must not produce a second level 1.
  if exists (
    select 1 from public.approval_chains
     where organization_id = _org_id and entity_type = 'leave_request'
       and deleted_at is null
  ) then
    return;
  end if;

  insert into public.approval_chains
    (organization_id, entity_type, level, approver_rule, escalate_after_days)
  values
    (_org_id, 'leave_request', 1, 'reporting_manager', 2);

  -- D5's default threshold. A separate statement because chain_role_present
  -- requires approver_role alongside a 'role' rule in the same row.
  insert into public.approval_chains
    (organization_id, entity_type, level, approver_rule, approver_role,
     condition_field, condition_op, condition_value, escalate_after_days)
  values
    (_org_id, 'leave_request', 2, 'role', 'hr_admin', 'working_days', '>', 3, 2);
end $$;

comment on function public.install_default_approval_chain is
  'D37 — the approval chain every new organisation starts with. L1 reporting manager, L2 HR above three days (D5''s default). Idempotent.';

-- Every organisation that already exists. Sada's own workspace was created
-- before this migration and would otherwise stay unable to approve anything.
do $$
declare
  v_org uuid;
begin
  for v_org in select id from public.organizations where deleted_at is null loop
    perform public.install_default_approval_chain(v_org);
  end loop;
end $$;

-- Rebuilt so a newly created organisation gets one. The rest is unchanged.
create or replace function public.signup_organization(
  p_org_name  text,
  p_slug      text,
  p_full_name text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_email text;
  v_org   uuid;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;

  -- The email comes from the verified auth record, never from the caller.
  select email into v_email from auth.users where id = v_uid;
  if v_email is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;

  if exists (select 1 from public.profiles where id = v_uid and deleted_at is null) then
    raise exception 'ALREADY_IN_ORGANIZATION' using errcode = '23505';
  end if;

  insert into public.organizations (name, slug)
  values (btrim(p_org_name), lower(btrim(p_slug)))
  returning id into v_org;

  insert into public.organization_settings (organization_id) values (v_org);

  insert into public.profiles (id, organization_id, full_name, email)
  values (v_uid, v_org, nullif(btrim(p_full_name), ''), v_email);

  insert into public.user_roles (user_id, organization_id, role)
  values (v_uid, v_org, 'org_admin');

  insert into public.organization_modules (organization_id, module_key, enabled, enabled_at)
  values (v_org, 'leave', true, now());

  -- D37.
  perform public.install_default_approval_chain(v_org);

  insert into public.analytics_events (organization_id, user_id, event, properties)
  values (v_org, v_uid, 'organization.created', jsonb_build_object('slug', lower(btrim(p_slug))));

  return v_org;
end $$;

comment on function public.signup_organization is
  'Creates an organisation, its first org_admin and its default approval chain atomically.';

-- ═══════════════════════════════════════════════ D38 · leave with no approver
--
-- `leave_types.approval_required` has existed since step 6 and has been read by
-- nothing. Meanwhile a one-person workspace cannot book a single day: the
-- founder is the only profile, D13 forbids self-approval, and every level
-- resolves to nobody.
--
-- Honouring the column is the configuration answer rather than a bypass. An
-- organisation decides that compensatory time off, or work-from-home, needs no
-- signature; leave that does need one is entirely unaffected.

-- ─────────────────────────────────────────────────────────── one transition
--
-- The move a request makes when it becomes approved, defined ONCE.
--
-- Before this there was one writer of balances — the trigger — and the comment
-- at the top of 20260730220000_leave_cancel.sql said so, correctly. D38 adds a
-- second path that approves without an approval request, and the honest choice
-- was between two copies of this arithmetic or one function with two callers.
--
-- Two copies is how a balance quietly diverges: someone fixes the pending/used
-- split in the trigger and does not know this exists. So the trigger and
-- leave_submit both call this, and neither one contains the arithmetic.
create or replace function public.leave_mark_approved(_request_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_req   public.leave_requests%rowtype;
  v_fy    text;
  v_today date;
begin
  select * into v_req from public.leave_requests where id = _request_id;
  if v_req.id is null then
    raise exception 'LEAVE_REQUEST_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- Already approved: do nothing rather than move the days twice. A double
  -- move violates no constraint — the balance simply grows — which is what
  -- makes it the dangerous kind of bug.
  if v_req.status = 'approved' then
    return;
  end if;

  v_fy    := public.get_financial_year(v_req.organization_id, v_req.from_date);
  v_today := public.org_today(v_req.organization_id);

  update public.leave_requests
     set status = 'approved', decided_at = now()
   where id = v_req.id;

  -- Out of the reservation, and into whichever bucket the dates call for:
  -- leave still ahead is pending, leave already taken is used.
  update public.leave_balances
     set reserved_days = greatest(reserved_days - v_req.working_days, 0),
         pending_days  = pending_days
                         + case when v_req.to_date >= v_today then v_req.working_days else 0 end,
         used_days     = used_days
                         + case when v_req.to_date <  v_today then v_req.working_days else 0 end
   where organization_id = v_req.organization_id
     and employee_id = v_req.employee_id
     and leave_type_id = v_req.leave_type_id
     and fy_label = v_fy;
end $$;

comment on function public.leave_mark_approved is
  'The approved transition, defined once. Called by the approval trigger and by leave_submit for types needing no approval (D38).';

-- ─────────────────────────────────────────────── the trigger, now delegating
--
-- D30/D33 unchanged in behaviour. The approved branch calls the shared function
-- instead of holding its own copy of the arithmetic; the release branches are
-- exactly as D33 left them.
create or replace function public.leave_on_approval_decided()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.leave_requests%rowtype;
  v_fy  text;
begin
  if new.entity_type <> 'leave_request' then return new; end if;
  if new.status = old.status then return new; end if;
  if new.status not in ('approved', 'rejected', 'cancelled') then return new; end if;

  select * into v_req from public.leave_requests where id = new.entity_id;
  if v_req.id is null then return new; end if;

  -- Already in a final state: nothing to release, and releasing again would
  -- inflate the balance.
  if v_req.status in ('rejected', 'cancelled') then return new; end if;

  if new.status = 'approved' then
    perform public.leave_mark_approved(v_req.id);
    return new;
  end if;

  v_fy := public.get_financial_year(v_req.organization_id, v_req.from_date);

  update public.leave_requests
     set status = case when new.status = 'rejected' then 'rejected' else 'cancelled' end::public.leave_status,
         decided_at = now()
   where id = v_req.id;

  -- D33. Whichever bucket actually holds them.
  --
  --   pending_approval → the days are reserved, never spent
  --   approved         → they moved to pending_days on approval, or to
  --                      used_days if the leave had already been taken
  --
  -- Cancelling leave already taken is refused by leave_cancel, so used_days is
  -- not unwound here. If that ever changes, this is the place.
  if v_req.status = 'pending_approval' then
    update public.leave_balances
       set reserved_days = greatest(reserved_days - v_req.working_days, 0)
     where organization_id = v_req.organization_id
       and employee_id = v_req.employee_id
       and leave_type_id = v_req.leave_type_id
       and fy_label = v_fy;

  elsif v_req.status = 'approved' then
    update public.leave_balances
       set pending_days = greatest(pending_days - v_req.working_days, 0)
     where organization_id = v_req.organization_id
       and employee_id = v_req.employee_id
       and leave_type_id = v_req.leave_type_id
       and fy_label = v_fy;
  end if;

  return new;
end $$;

comment on function public.leave_on_approval_decided is
  'D30/D33 — reacts to an approval decision. Releases from the bucket that holds the days; delegates the approved transition to leave_mark_approved.';

-- ─────────────────────────────────────────────────────────────── submission
--
-- Rebuilt with the approval_required branch. Everything before it — D34's year
-- check, D10's lock, the validation order — is unchanged.
create or replace function public.leave_submit(
  _leave_type_id uuid,
  _from_date     date,
  _to_date       date,
  _reason        text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_user     uuid := (select auth.uid());
  v_org      uuid;
  v_type     public.leave_types%rowtype;
  v_settings public.organization_settings%rowtype;
  v_fy       text;
  v_balance  public.leave_balances%rowtype;
  v_days     numeric;
  v_notice   integer;
  v_today    date;
  v_request  uuid;
  v_approval uuid;
begin
  if v_user is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;

  select organization_id into v_org
    from public.profiles where id = v_user and deleted_at is null;
  if v_org is null then
    raise exception 'NO_ORGANIZATION' using errcode = 'P0001';
  end if;

  select * into v_settings from public.organization_settings where organization_id = v_org;
  select * into v_type from public.leave_types
   where id = _leave_type_id and organization_id = v_org
     and status = 'active' and deleted_at is null;
  if v_type.id is null then
    raise exception 'LEAVE_TYPE_NOT_FOUND' using errcode = 'P0001';
  end if;

  v_today := public.org_today(v_org);
  v_fy    := public.get_financial_year(v_org, _from_date);

  -- D34. Before ensure_balance, deliberately: a refused request must not leave
  -- a balance row behind for a year nobody can see yet.
  if not public.leave_year_open(v_org, _from_date) then
    raise exception 'NEXT_YEAR_NOT_OPEN_YET' using errcode = 'P0001';
  end if;

  -- D10 — the balance row is locked before anything is validated.
  perform public.ensure_balance(v_user, _leave_type_id, v_fy);
  select * into v_balance from public.leave_balances
   where organization_id = v_org and employee_id = v_user
     and leave_type_id = _leave_type_id and fy_label = v_fy
   for update;

  if _to_date < _from_date then
    raise exception 'INVALID_DATE_RANGE' using errcode = 'P0001';
  end if;

  if _from_date < v_today and not coalesce(v_settings.allow_retroactive, false) then
    raise exception 'PAST_DATE' using errcode = 'P0001';
  end if;

  v_notice := coalesce(v_type.min_notice_days, v_settings.default_min_notice_days, 0);
  if v_notice > 0 and _from_date < v_today + v_notice then
    raise exception 'INSUFFICIENT_NOTICE' using errcode = 'P0001';
  end if;

  v_days := public.calculate_working_days(v_org, _from_date, _to_date);
  if v_days <= 0 then
    raise exception 'NO_WORKING_DAYS' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.leave_requests
     where employee_id = v_user
       and status in ('pending_approval', 'approved')
       and deleted_at is null
       and daterange(from_date, to_date, '[]') && daterange(_from_date, _to_date, '[]')
  ) then
    raise exception 'OVERLAPPING_REQUEST' using errcode = 'P0001';
  end if;

  if v_days > v_balance.available_days then
    raise exception 'INSUFFICIENT_BALANCE: requested %, available %', v_days, v_balance.available_days
      using errcode = 'P0001';
  end if;

  if v_type.max_per_request is not null and v_days > v_type.max_per_request then
    raise exception 'EXCEEDS_MAX_PER_REQUEST' using errcode = 'P0001';
  end if;

  insert into public.leave_requests
    (organization_id, employee_id, leave_type_id, from_date, to_date,
     working_days, reason, status, submitted_at)
  values
    (v_org, v_user, _leave_type_id, _from_date, _to_date,
     v_days, _reason, 'pending_approval', now())
  returning id into v_request;

  -- Reserved first, in both paths. The reservation is what makes the balance
  -- correct for the instant between insert and decision, and leave_mark_approved
  -- expects to be releasing one.
  update public.leave_balances
     set reserved_days = reserved_days + v_days
   where id = v_balance.id;

  -- D38. A type needing no approval is settled here and now.
  --
  -- No approval request is created, so approval_request_id stays null and the
  -- timeline is empty — correctly: nobody decided this, and inventing a step
  -- saying otherwise would put a fiction in the audit trail. leave_cancel's
  -- null-approval branch, written as defensive and never taken, becomes the
  -- live cancellation path for these.
  --
  -- Nothing is emitted. approval.submitted and approval.decided both describe an
  -- approval that does not exist here, and the one person who needs to know
  -- already does — they are the person who just pressed the button.
  if not v_type.approval_required then
    perform public.leave_mark_approved(v_request);
    return v_request;
  end if;

  v_approval := public.approval_submit(
    'leave_request', v_request,
    jsonb_build_object(
      'working_days', v_days,
      'leave_type_id', _leave_type_id,
      'employee_id', v_user
    )
  );

  update public.leave_requests set approval_request_id = v_approval where id = v_request;

  return v_request;

exception
  when exclusion_violation then
    raise exception 'OVERLAPPING_REQUEST' using errcode = 'P0001';
end $$;

comment on function public.leave_submit is
  'Submits a leave request. Refuses a year not yet open (D34), locks the balance first (D10), validates, then either routes for approval or settles it where the type needs none (D38).';
