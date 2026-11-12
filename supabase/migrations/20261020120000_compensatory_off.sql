-- ============================================================================
-- NEUVTO WOS — compensatory off: leave earned by working (D89)
-- ============================================================================
--
-- Leave phase 2, criteria 2–4. A third kind of leave type, 'earned': it has no
-- yearly allowance; its balance is what has been credited for days worked.
--
--   CLAIMING. The person lists the days they worked (any date, weekdays
--   included; a full day or a half; as many as they like, the "repeating work
--   log"), says why they are owed (required), and may attach proof. A type can
--   require proof, and limits how far back a day can be claimed. A day can be
--   claimed once: the same date in two live claims is refused by an index.
--
--   APPROVING. Through the Approval Engine as 'comp_off_claim', by its own
--   chain (installed by default: the reporting manager). Nothing is credited
--   until it is approved; rejecting or cancelling frees the days to be claimed
--   again.
--
--   CREDITING. On approval the days are added to the person's balance of that
--   type for the current leave year, and an expiry date is set from the type's
--   expiry (none, if the type has none).
--
--   EXPIRING. Hourly, every credit past its expiry gives up what has not been
--   used. Days are used first-in-first-out: whatever is booked or taken against
--   the balance (used, reserved or pending) is counted against the oldest
--   credits first, so expiry never takes a day somebody has booked.
--
--   PROOF. A private bucket, leave-proofs, one folder per company and person.
--   Read by the person, the approvers of the claim it is attached to, and the
--   Leave Admin.
--
-- Leave reacts to the engine with its own trigger (D30).
-- ============================================================================

-- ═══════════════════════════════════════════════════════════ the kind

alter table public.leave_types drop constraint if exists leave_type_kind_known;
alter table public.leave_types add constraint leave_type_kind_known
  check (kind in ('paid', 'unpaid', 'earned'));
alter table public.leave_types drop constraint if exists leave_type_unpaid_has_no_allowance;
alter table public.leave_types add constraint leave_type_unpaid_has_no_allowance
  check (kind = 'paid' or max_days_per_year = 0);

alter table public.leave_types
  add column if not exists earned_expires_after_days integer
    check (earned_expires_after_days is null or earned_expires_after_days between 1 and 730),
  add column if not exists earned_claim_within_days integer
    check (earned_claim_within_days is null or earned_claim_within_days between 1 and 365),
  add column if not exists earned_proof_required boolean not null default false;

comment on column public.leave_types.earned_expires_after_days is
  'D89 — an earned type''s credit expires this many days after it is approved. Null: never.';
comment on column public.leave_types.earned_claim_within_days is
  'D89 — how far back a day worked can be claimed. Null: any time.';

-- ═══════════════════════════════════════════════════════════ claims

create table if not exists public.comp_off_claims (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  employee_id         uuid not null references public.profiles(id) on delete restrict,
  leave_type_id       uuid not null references public.leave_types(id) on delete restrict,
  reason              text not null check (length(btrim(reason)) >= 3),
  total_days          numeric not null check (total_days > 0 and total_days * 2 = floor(total_days * 2)),
  status              text not null default 'pending_approval'
                        check (status in ('pending_approval', 'approved', 'rejected', 'cancelled')),
  approval_request_id uuid references public.approval_requests(id) on delete set null,
  proof_path          text,
  decided_at          timestamptz,
  credited_fy         text,
  -- The order credits are used in. clock_timestamp(), not now(): several
  -- claims approved in one transaction ("Approve selected") share now(), and
  -- first-in-first-out would then be decided by a random id.
  credited_at         timestamptz,
  expires_on          date,
  expired_days        numeric not null default 0 check (expired_days >= 0),
  expired_at          timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  deleted_at timestamptz,
  constraint comp_off_credited_when_approved check (
    (status = 'approved') = (credited_fy is not null and credited_at is not null)),
  constraint comp_off_expired_within check (expired_days <= total_days)
);

create index if not exists idx_comp_off_claims_employee
  on public.comp_off_claims (organization_id, employee_id) where deleted_at is null;
create index if not exists idx_comp_off_claims_expiry
  on public.comp_off_claims (expires_on) where status = 'approved' and expired_at is null;

create table if not exists public.comp_off_claim_days (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  claim_id        uuid not null references public.comp_off_claims(id) on delete cascade,
  employee_id     uuid not null references public.profiles(id) on delete restrict,
  worked_on       date not null,
  days            numeric not null check (days in (0.5, 1)),
  note            text,
  -- False once the claim is rejected or cancelled, so the date can be claimed again.
  live            boolean not null default true,
  created_at      timestamptz not null default now()
);

-- A day worked is owed once.
create unique index if not exists uq_comp_off_day_once
  on public.comp_off_claim_days (employee_id, worked_on) where live;

create trigger set_audit_fields before insert or update on public.comp_off_claims
  for each row execute function public.set_audit_fields();
create trigger write_audit_log after insert or update or delete on public.comp_off_claims
  for each row execute function public.write_audit_log();
create trigger write_audit_log after insert or update or delete on public.comp_off_claim_days
  for each row execute function public.write_audit_log();

-- Read and written only through the functions below.
alter table public.comp_off_claims enable row level security;
alter table public.comp_off_claim_days enable row level security;
revoke all on public.comp_off_claims, public.comp_off_claim_days from anon, authenticated;

comment on table public.comp_off_claims is
  'D89 — a claim for compensatory off: days worked, why, proof; credited on approval, expiring by the type''s rule.';

-- ═══════════════════════════════════════════════════════════ its approval

insert into public.approval_entity_labels (entity_type, label, module_key)
values ('comp_off_claim', 'compensatory off claim', 'leave')
on conflict (entity_type) do update
  set label = excluded.label, module_key = excluded.module_key, updated_at = now();

-- Reproduced from 20260731150000_first_run.sql. The diff: a company also starts
-- with a comp-off chain, and each entity type is installed on its own, so a
-- company that already has one gets the other.
create or replace function public.install_default_approval_chain(_org_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.approval_chains
     where organization_id = _org_id and entity_type = 'leave_request'
       and deleted_at is null
  ) then
    insert into public.approval_chains
      (organization_id, entity_type, level, approver_rule, escalate_after_days)
    values
      (_org_id, 'leave_request', 1, 'reporting_manager', 2);
    insert into public.approval_chains
      (organization_id, entity_type, level, approver_rule, approver_role,
       condition_field, condition_op, condition_value, escalate_after_days)
    values
      (_org_id, 'leave_request', 2, 'role', 'hr_admin', 'working_days', '>', 3, 2);
  end if;

  -- D89. The manager who saw them work.
  if not exists (
    select 1 from public.approval_chains
     where organization_id = _org_id and entity_type = 'comp_off_claim'
       and deleted_at is null
  ) then
    insert into public.approval_chains
      (organization_id, entity_type, level, approver_rule, escalate_after_days)
    values
      (_org_id, 'comp_off_claim', 1, 'reporting_manager', 2);
  end if;
end $$;

do $$
declare
  v_org uuid;
begin
  for v_org in select id from public.organizations where deleted_at is null loop
    perform public.install_default_approval_chain(v_org);
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════ claiming

create or replace function public.comp_off_submit(
  _leave_type_id uuid,
  _days          jsonb,
  _reason        text,
  _proof_path    text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_user   uuid := (select auth.uid());
  v_org    uuid := public.current_org_id();
  v_type   public.leave_types%rowtype;
  v_today  date;
  v_claim  uuid;
  v_total  numeric := 0;
  v_day    jsonb;
  v_date   date;
  v_amount numeric;
  v_dates  date[] := '{}';
  v_approval uuid;
begin
  if v_user is null or v_org is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;
  if not public.module_enabled_for(v_org, 'leave') then
    raise exception 'MODULE_NOT_ENABLED' using errcode = 'P0001';
  end if;

  select * into v_type from public.leave_types
   where id = _leave_type_id and organization_id = v_org
     and status = 'active' and deleted_at is null;
  if v_type.id is null then
    raise exception 'LEAVE_TYPE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_type.kind <> 'earned' then
    raise exception 'NOT_AN_EARNED_TYPE' using errcode = 'P0001';
  end if;

  if length(btrim(coalesce(_reason, ''))) < 3 then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if _days is null or jsonb_typeof(_days) <> 'array' or jsonb_array_length(_days) = 0 then
    raise exception 'NO_DAYS_CLAIMED' using errcode = 'P0001';
  end if;
  if jsonb_array_length(_days) > 31 then
    raise exception 'TOO_MANY_DAYS' using errcode = 'P0001';
  end if;

  -- The proof, if any, must be the person's own upload in this company.
  if _proof_path is not null and _proof_path not like v_org::text || '/' || v_user::text || '/%' then
    raise exception 'PROOF_NOT_YOURS' using errcode = 'P0001';
  end if;
  if v_type.earned_proof_required and _proof_path is null then
    raise exception 'PROOF_REQUIRED' using errcode = 'P0001';
  end if;

  v_today := public.org_today(v_org);

  for v_day in select * from jsonb_array_elements(_days) loop
    begin
      v_date := (v_day ->> 'date')::date;
      v_amount := (v_day ->> 'days')::numeric;
    exception when others then
      raise exception 'INVALID_DAY' using errcode = 'P0001';
    end;
    if v_date is null or v_amount is null or v_amount not in (0.5, 1) then
      raise exception 'INVALID_DAY' using errcode = 'P0001';
    end if;
    if v_date > v_today then
      raise exception 'WORKED_DATE_IN_FUTURE' using errcode = 'P0001';
    end if;
    if v_type.earned_claim_within_days is not null
       and v_date < v_today - v_type.earned_claim_within_days then
      raise exception 'CLAIM_TOO_LATE: % days', v_type.earned_claim_within_days using errcode = 'P0001';
    end if;
    if v_date = any (v_dates) then
      raise exception 'SAME_DAY_TWICE' using errcode = 'P0001';
    end if;
    v_dates := v_dates || v_date;
    v_total := v_total + v_amount;
  end loop;

  insert into public.comp_off_claims
    (organization_id, employee_id, leave_type_id, reason, total_days, proof_path)
  values (v_org, v_user, v_type.id, btrim(_reason), v_total, _proof_path)
  returning id into v_claim;

  begin
    insert into public.comp_off_claim_days (organization_id, claim_id, employee_id, worked_on, days, note)
    select v_org, v_claim, v_user, (d ->> 'date')::date, (d ->> 'days')::numeric,
           nullif(btrim(coalesce(d ->> 'note', '')), '')
      from jsonb_array_elements(_days) d;
  exception when unique_violation then
    raise exception 'ALREADY_CLAIMED' using errcode = 'P0001';
  end;

  v_approval := public.approval_submit('comp_off_claim', v_claim,
                  jsonb_build_object('days', v_total));
  update public.comp_off_claims set approval_request_id = v_approval where id = v_claim;

  return v_claim;
end $$;

comment on function public.comp_off_submit is
  'D89 — claims compensatory off for days worked: [{date, days (1 or 0.5), note}], a reason, optional proof. Goes for approval; nothing is credited until approved.';

revoke all on function public.comp_off_submit(uuid, jsonb, text, text) from public, anon;
grant execute on function public.comp_off_submit(uuid, jsonb, text, text) to authenticated;

create or replace function public.comp_off_cancel(_claim_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_user  uuid := (select auth.uid());
  v_claim public.comp_off_claims%rowtype;
begin
  if v_user is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;
  select * into v_claim from public.comp_off_claims where id = _claim_id and deleted_at is null;
  if v_claim.id is null or v_claim.employee_id <> v_user then
    raise exception 'NOT_YOUR_REQUEST' using errcode = 'P0001';
  end if;
  -- An approved claim is a credit; taking it back is the Leave Admin's
  -- correction, not the person's.
  if v_claim.status <> 'pending_approval' then
    raise exception 'ALREADY_DECIDED' using errcode = 'P0001';
  end if;
  -- Closing the approval fires comp_off_on_approval_decided. One writer.
  update public.approval_requests
     set status = 'cancelled', completed_at = now()
   where id = v_claim.approval_request_id and status = 'pending';
end $$;

revoke all on function public.comp_off_cancel(uuid) from public, anon;
grant execute on function public.comp_off_cancel(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════ the decision

create or replace function public.comp_off_on_approval_decided()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim public.comp_off_claims%rowtype;
  v_type  public.leave_types%rowtype;
  v_today date;
  v_fy    text;
begin
  if new.entity_type <> 'comp_off_claim' then return new; end if;
  if new.status = old.status then return new; end if;
  if new.status not in ('approved', 'rejected', 'cancelled') then return new; end if;

  select * into v_claim from public.comp_off_claims where id = new.entity_id for update;
  if v_claim.id is null or v_claim.status <> 'pending_approval' then return new; end if;

  if new.status = 'approved' then
    select * into v_type from public.leave_types where id = v_claim.leave_type_id;
    v_today := public.org_today(v_claim.organization_id);
    v_fy := public.get_financial_year(v_claim.organization_id, v_today);
    perform public.ensure_balance(v_claim.employee_id, v_claim.leave_type_id, v_fy);
    update public.leave_balances
       set entitled_days = entitled_days + v_claim.total_days
     where organization_id = v_claim.organization_id
       and employee_id = v_claim.employee_id
       and leave_type_id = v_claim.leave_type_id
       and fy_label = v_fy;
    update public.comp_off_claims
       set status = 'approved', decided_at = now(), credited_fy = v_fy, credited_at = clock_timestamp(),
           expires_on = case when v_type.earned_expires_after_days is null then null
                             else v_today + v_type.earned_expires_after_days end
     where id = v_claim.id;
  else
    update public.comp_off_claims
       set status = case when new.status = 'rejected' then 'rejected' else 'cancelled' end,
           decided_at = now()
     where id = v_claim.id;
    update public.comp_off_claim_days set live = false where claim_id = v_claim.id;
  end if;
  return new;
end $$;

revoke all on function public.comp_off_on_approval_decided() from public, anon, authenticated;

drop trigger if exists comp_off_on_approval_decided on public.approval_requests;
create trigger comp_off_on_approval_decided
  after update of status on public.approval_requests
  for each row execute function public.comp_off_on_approval_decided();

-- Somebody who leaves takes no claim with them: a pending one is cancelled.
create or replace function public.comp_off_on_member_deactivated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.is_active and not new.is_active then
    update public.approval_requests r
       set status = 'cancelled', completed_at = now()
      from public.comp_off_claims c
     where c.employee_id = new.id and c.status = 'pending_approval'
       and r.id = c.approval_request_id and r.status = 'pending';
  end if;
  return new;
end $$;

revoke all on function public.comp_off_on_member_deactivated() from public, anon, authenticated;

drop trigger if exists comp_off_on_member_deactivated on public.profiles;
create trigger comp_off_on_member_deactivated
  after update of is_active on public.profiles
  for each row execute function public.comp_off_on_member_deactivated();

-- ═══════════════════════════════════════════════════════════ expiry

/** Expires every credit past its date, oldest first, never a day already booked. */
create or replace function public.comp_off_expire_due()
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_c         record;
  v_bal       public.leave_balances%rowtype;
  v_committed numeric;
  v_before    numeric;
  v_drawn     numeric;
  v_unused    numeric;
  v_n         integer := 0;
begin
  for v_c in
    select c.* from public.comp_off_claims c
     where c.status = 'approved' and c.expired_at is null and c.expires_on is not null
       and c.deleted_at is null
       and c.expires_on < public.org_today(c.organization_id)
     order by c.credited_at, c.id
  loop
    select * into v_bal from public.leave_balances
     where organization_id = v_c.organization_id and employee_id = v_c.employee_id
       and leave_type_id = v_c.leave_type_id and fy_label = v_c.credited_fy
     for update;
    if v_bal.id is null then continue; end if;

    v_committed := v_bal.used_days + v_bal.reserved_days + v_bal.pending_days;
    -- What the older credits on this balance can hold, as they stand now.
    select coalesce(sum(o.total_days - o.expired_days), 0) into v_before
      from public.comp_off_claims o
     where o.organization_id = v_c.organization_id and o.employee_id = v_c.employee_id
       and o.leave_type_id = v_c.leave_type_id and o.credited_fy = v_c.credited_fy
       and o.status = 'approved' and o.deleted_at is null
       and (o.credited_at, o.id) < (v_c.credited_at, v_c.id);
    v_drawn  := least(greatest(v_committed - v_before, 0), v_c.total_days);
    v_unused := v_c.total_days - v_drawn;

    if v_unused > 0 then
      update public.leave_balances set entitled_days = entitled_days - v_unused where id = v_bal.id;
    end if;
    update public.comp_off_claims
       set expired_days = v_unused, expired_at = now()
     where id = v_c.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

comment on function public.comp_off_expire_due is
  'D89 — expires compensatory off past its date: the unused part of each credit, first-in-first-out, never a booked day. Hourly.';

revoke all on function public.comp_off_expire_due() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule('neuvto-leave-comp-off-expiry')
    where exists (select 1 from cron.job where jobname = 'neuvto-leave-comp-off-expiry');
  perform cron.schedule(
    'neuvto-leave-comp-off-expiry',
    '5 * * * *',
    $job$select public.comp_off_expire_due()$job$
  );
end $$;

-- ═══════════════════════════════════════════════════════════ reading

create or replace function public.comp_off_my_claims()
returns table (
  claim_id      uuid,
  leave_type_id uuid,
  leave_type_name text,
  reason        text,
  total_days    numeric,
  status        text,
  approval_request_id uuid,
  has_proof     boolean,
  submitted_at  timestamptz,
  decided_at    timestamptz,
  expires_on    date,
  expired_days  numeric,
  days          jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := (select auth.uid());
  v_org  uuid := public.current_org_id();
begin
  if v_user is null or v_org is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;
  if not public.module_enabled_for(v_org, 'leave') then
    raise exception 'MODULE_NOT_ENABLED' using errcode = 'P0001';
  end if;
  return query
    select c.id, c.leave_type_id, t.name::text, c.reason, c.total_days, c.status,
           c.approval_request_id, c.proof_path is not null, c.created_at, c.decided_at,
           c.expires_on, c.expired_days,
           coalesce((select jsonb_agg(jsonb_build_object('date', d.worked_on, 'days', d.days, 'note', d.note)
                                      order by d.worked_on)
                       from public.comp_off_claim_days d where d.claim_id = c.id), '[]'::jsonb)
      from public.comp_off_claims c
      join public.leave_types t on t.id = c.leave_type_id
     where c.employee_id = v_user and c.organization_id = v_org and c.deleted_at is null
     order by c.created_at desc;
end $$;

revoke all on function public.comp_off_my_claims() from public, anon;
grant execute on function public.comp_off_my_claims() to authenticated;

/** Everything an approver needs to decide a claim. Visible to whom the request is. */
create or replace function public.comp_off_approval_detail(_approval_request_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org   uuid;
  v_claim public.comp_off_claims%rowtype;
begin
  select organization_id into v_org from public.approval_requests
   where id = _approval_request_id and deleted_at is null and entity_type = 'comp_off_claim';
  if v_org is null or v_org <> public.current_org_id() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if not (public.is_requester_of(_approval_request_id)
          or public.is_approver_on(_approval_request_id)
          or public.is_module_admin('leave')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if not public.module_enabled_for(v_org, 'leave') then
    raise exception 'MODULE_NOT_ENABLED' using errcode = 'P0001';
  end if;

  select * into v_claim from public.comp_off_claims where approval_request_id = _approval_request_id;
  return jsonb_build_object(
    'claimId', v_claim.id,
    'employeeName', (select coalesce(full_name, 'A colleague') from public.profiles where id = v_claim.employee_id),
    'leaveTypeName', (select name from public.leave_types where id = v_claim.leave_type_id),
    'reason', v_claim.reason,
    'totalDays', v_claim.total_days,
    'status', v_claim.status,
    'proofPath', v_claim.proof_path,
    'days', coalesce((select jsonb_agg(jsonb_build_object('date', d.worked_on, 'days', d.days, 'note', d.note)
                                       order by d.worked_on)
                        from public.comp_off_claim_days d where d.claim_id = v_claim.id), '[]'::jsonb));
end $$;

revoke all on function public.comp_off_approval_detail(uuid) from public, anon;
grant execute on function public.comp_off_approval_detail(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════ proof

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('leave-proofs', 'leave-proofs', false, 5 * 1024 * 1024,
        array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

/** Who may read a proof file other than the person who uploaded it. */
create or replace function public.leave_proof_readable(_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.comp_off_claims c
     where c.proof_path = _name
       and c.organization_id = public.current_org_id()
       and c.deleted_at is null
       and (public.is_approver_on(c.approval_request_id) or public.is_module_admin('leave')))
$$;

revoke all on function public.leave_proof_readable(text) from public, anon;
grant execute on function public.leave_proof_readable(text) to authenticated;

drop policy if exists "upload own leave proof" on storage.objects;
drop policy if exists "read leave proof" on storage.objects;

create policy "upload own leave proof" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'leave-proofs'
    and (storage.foldername(name))[1] = public.current_org_id()::text
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );

create policy "read leave proof" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'leave-proofs'
    and (storage.foldername(name))[1] = public.current_org_id()::text
    and ((storage.foldername(name))[2] = (select auth.uid())::text
         or public.leave_proof_readable(name))
  );

-- ═══════════════════════════════════════════════════════════ an earned balance is a balance

-- Reproduced from 20261018110000_unpaid_leave_and_blackouts.sql. The diff: what
-- was true of 'paid' (a balance is reserved and checked) is true of everything
-- but 'unpaid', so an earned type is booked against what was credited.
CREATE OR REPLACE FUNCTION public.leave_submit(_leave_type_id uuid, _from_date date, _to_date date, _reason text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_blackout text;
begin
  if v_user is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;

  v_org := public.current_org_id();
  if v_org is null then
    raise exception 'NO_ORGANIZATION' using errcode = 'P0001';
  end if;

  -- D44. First, before anything is read or written. A module that is off must
  -- not create a balance row, reserve a day, or leave any other trace.
  if not public.module_enabled_for(v_org, 'leave') then
    raise exception 'MODULE_NOT_ENABLED' using errcode = 'P0001';
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

  -- D10 — the balance row is locked before anything is validated. Unpaid
  -- leave has none to lock: nothing is reserved, and overlapping requests are
  -- refused by the exclusion constraint either way.
  if v_type.kind <> 'unpaid' then
    perform public.ensure_balance(v_user, _leave_type_id, v_fy);
    select * into v_balance from public.leave_balances
     where organization_id = v_org and employee_id = v_user
       and leave_type_id = _leave_type_id and fy_label = v_fy
     for update;
  end if;

  if _to_date < _from_date then
    raise exception 'INVALID_DATE_RANGE' using errcode = 'P0001';
  end if;

  if _from_date < v_today and not coalesce(v_settings.allow_retroactive, false) then
    raise exception 'PAST_DATE' using errcode = 'P0001';
  end if;

  v_notice := coalesce(v_type.min_notice_days, v_settings.default_min_notice_days, 0);
  if v_notice > 0 and _from_date < v_today + v_notice then
    raise exception 'INSUFFICIENT_NOTICE: % days required', v_notice using errcode = 'P0001';
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

  -- A blackout period refuses every kind of leave, unpaid included, and says
  -- which one, so the person knows what to move.
  select b.name into v_blackout
    from public.leave_blackouts b
   where b.organization_id = v_org and b.deleted_at is null
     and daterange(b.from_date, b.to_date, '[]') && daterange(_from_date, _to_date, '[]')
   order by b.from_date
   limit 1;
  if v_blackout is not null then
    raise exception 'BLACKOUT_PERIOD: %', v_blackout using errcode = 'P0001';
  end if;

  if v_type.kind <> 'unpaid' and v_days > v_balance.available_days then
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

  if v_type.kind <> 'unpaid' then
    update public.leave_balances
       set reserved_days = reserved_days + v_days
     where id = v_balance.id;
  end if;

  -- D38. A type needing no approval is settled here and now.
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
end $function$
;

-- Reproduced from the same. The diff: earned balances are listed, on the
-- balances report and on Opening balances, where carried-over comp off is set.
CREATE OR REPLACE FUNCTION public.leave_all_balances()
 RETURNS TABLE(employee_id uuid, employee_name text, department_name text, leave_type_id uuid, leave_type_name text, fy_label text, entitled_days numeric, carryforward_days numeric, used_days numeric, available_days numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org uuid := public.current_org_id();
  v_fy  text;
begin
  if v_org is null or not public.is_module_admin('leave') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if not public.module_enabled_for(v_org, 'leave') then
    raise exception 'MODULE_NOT_ENABLED' using errcode = 'P0001';
  end if;

  v_fy := public.get_financial_year(v_org, public.org_today(v_org));

  -- Every active person against every active type, whether or not a balance row
  -- exists yet. Entitlement is computed for the ones that do not, so the screen
  -- shows what they WOULD get — otherwise the person most needing an opening
  -- balance is the one missing from the list.
  return query
    select p.id, coalesce(p.full_name, p.email)::text,
           d.name::text,
           t.id, t.name::text, v_fy,
           coalesce(b.entitled_days, public.calculate_entitlement(p.id, t.id, v_fy)),
           coalesce(b.carryforward_days, 0),
           coalesce(b.used_days, 0),
           coalesce(b.available_days,
                    public.calculate_entitlement(p.id, t.id, v_fy))
      from public.profiles p
      cross join public.leave_types t
      left join public.departments d on d.id = p.department_id
      left join public.leave_balances b
        on b.employee_id = p.id and b.leave_type_id = t.id and b.fy_label = v_fy
       and b.deleted_at is null
     where p.organization_id = v_org and p.deleted_at is null and p.is_active
       and t.organization_id = v_org and t.deleted_at is null and t.status = 'active'
       and t.kind <> 'unpaid'
     order by coalesce(p.full_name, p.email), t.name;
end $function$
;
