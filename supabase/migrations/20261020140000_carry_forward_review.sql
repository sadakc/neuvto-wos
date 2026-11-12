-- ============================================================================
-- NEUVTO WOS — carrying leave into the next year, reviewed and locked (D91)
-- ============================================================================
--
-- Leave phase 2, criterion 8: "a carry-forward review that does nothing until
-- an Admin locks it."
--
--   THE RULE. leave_types.carry_forward_max: the most days of a paid type a
--   person takes into next year. Null: none carried. Unpaid and earned types
--   carry nothing (earned credits expire on their own rule, D89).
--
--   PREPARE. The Leave Admin prepares the review of a leave year. Each person
--   with a balance of a type that carries is listed with what they have left
--   and what the rule proposes: the smaller of the two. Nothing is written to
--   any balance. Preparing again refreshes the proposals and keeps any number
--   the Admin has changed.
--
--   ADJUST. The Admin may change any line to anything from zero to what that
--   person has left, in halves. Over the rule's maximum is allowed: it is the
--   Admin's decision, and the line says it was changed.
--
--   LOCK. Applies every line to next year's balance as its carried-over days,
--   in one transaction, and closes the review. Refused while next year is not
--   open yet (D34), and refused if any balance has moved since the review was
--   prepared, so what is applied is exactly what was on the screen. A locked
--   review is never changed.
--
-- One review per company per leave year.
-- ============================================================================

alter table public.leave_types
  add column if not exists carry_forward_max numeric
    check (carry_forward_max is null or (carry_forward_max >= 0 and carry_forward_max * 2 = floor(carry_forward_max * 2)));
alter table public.leave_types drop constraint if exists leave_type_only_paid_carries;
alter table public.leave_types add constraint leave_type_only_paid_carries
  check (kind = 'paid' or carry_forward_max is null);

comment on column public.leave_types.carry_forward_max is
  'D91 — the most days of this type carried into next year, applied only when a carry-forward review is locked. Null: none.';

create table if not exists public.leave_carry_reviews (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  from_fy         text not null,
  to_fy           text not null,
  status          text not null default 'draft' check (status in ('draft', 'locked')),
  prepared_at     timestamptz not null default now(),
  locked_at       timestamptz,
  locked_by       uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint carry_locked_when_locked check ((status = 'locked') = (locked_at is not null)),
  unique (organization_id, from_fy)
);

create table if not exists public.leave_carry_lines (
  id              uuid primary key default gen_random_uuid(),
  review_id       uuid not null references public.leave_carry_reviews(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id     uuid not null references public.profiles(id) on delete restrict,
  leave_type_id   uuid not null references public.leave_types(id) on delete restrict,
  -- What they had left when the review was prepared, and what the rule says.
  available_days  numeric not null,
  proposed_days   numeric not null check (proposed_days >= 0),
  -- The Admin's number, if they changed it.
  adjusted_days   numeric check (adjusted_days is null or (adjusted_days >= 0 and adjusted_days * 2 = floor(adjusted_days * 2))),
  unique (review_id, employee_id, leave_type_id)
);

create trigger set_audit_fields before insert or update on public.leave_carry_reviews
  for each row execute function public.set_audit_fields();
create trigger write_audit_log after insert or update or delete on public.leave_carry_reviews
  for each row execute function public.write_audit_log();
create trigger write_audit_log after insert or update or delete on public.leave_carry_lines
  for each row execute function public.write_audit_log();

alter table public.leave_carry_reviews enable row level security;
alter table public.leave_carry_lines enable row level security;
revoke all on public.leave_carry_reviews, public.leave_carry_lines from anon, authenticated;

-- ═══════════════════════════════════════════════════════════ helpers

/** The label of the year after _fy, in this company's own convention. */
create or replace function public.leave_next_fy(_org_id uuid, _fy text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select public.get_financial_year(_org_id,
           (public.financial_year_start(_org_id, _fy) + interval '1 year')::date)
$$;

revoke all on function public.leave_next_fy(uuid, text) from public, anon, authenticated;

create or replace function public.tf_leave_carry_review_is_final()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_table_name = 'leave_carry_reviews' then
    if old.status = 'locked' then
      raise exception 'REVIEW_LOCKED' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if exists (select 1 from public.leave_carry_reviews
              where id = coalesce(new.review_id, old.review_id) and status = 'locked') then
    raise exception 'REVIEW_LOCKED' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;

revoke all on function public.tf_leave_carry_review_is_final() from public, anon, authenticated;

drop trigger if exists carry_review_is_final on public.leave_carry_reviews;
create trigger carry_review_is_final before update or delete on public.leave_carry_reviews
  for each row execute function public.tf_leave_carry_review_is_final();
drop trigger if exists carry_lines_are_final on public.leave_carry_lines;
create trigger carry_lines_are_final before insert or update or delete on public.leave_carry_lines
  for each row execute function public.tf_leave_carry_review_is_final();

-- ═══════════════════════════════════════════════════════════ prepare

create or replace function public.leave_carry_prepare(_from_fy text)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org    uuid := public.current_org_id();
  v_review public.leave_carry_reviews%rowtype;
begin
  if v_org is null or not public.is_module_admin('leave') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if not public.module_enabled_for(v_org, 'leave') then
    raise exception 'MODULE_NOT_ENABLED' using errcode = 'P0001';
  end if;
  if _from_fy is null or public.financial_year_start(v_org, _from_fy) is null then
    raise exception 'INVALID_YEAR' using errcode = 'P0001';
  end if;
  -- A year not yet begun has nothing to carry.
  if _from_fy > public.get_financial_year(v_org, public.org_today(v_org)) then
    raise exception 'INVALID_YEAR' using errcode = 'P0001';
  end if;

  select * into v_review from public.leave_carry_reviews
   where organization_id = v_org and from_fy = _from_fy;
  if v_review.status = 'locked' then
    raise exception 'REVIEW_LOCKED' using errcode = 'P0001';
  end if;
  if v_review.id is null then
    insert into public.leave_carry_reviews (organization_id, from_fy, to_fy)
    values (v_org, _from_fy, public.leave_next_fy(v_org, _from_fy))
    returning * into v_review;
  else
    update public.leave_carry_reviews set prepared_at = now() where id = v_review.id;
  end if;

  -- Lines nobody has a balance for any longer go; the rest are refreshed and
  -- keep the Admin's number.
  delete from public.leave_carry_lines l
   where l.review_id = v_review.id
     and not exists (
       select 1 from public.leave_balances b
         join public.leave_types t on t.id = b.leave_type_id
         join public.profiles p on p.id = b.employee_id
        where b.organization_id = v_org and b.fy_label = _from_fy and b.deleted_at is null
          and b.employee_id = l.employee_id and b.leave_type_id = l.leave_type_id
          and t.kind = 'paid' and t.carry_forward_max is not null and t.deleted_at is null
          and p.is_active and p.deleted_at is null);

  insert into public.leave_carry_lines
    (review_id, organization_id, employee_id, leave_type_id, available_days, proposed_days)
  select v_review.id, v_org, b.employee_id, b.leave_type_id,
         b.available_days,
         least(greatest(b.available_days, 0), t.carry_forward_max)
    from public.leave_balances b
    join public.leave_types t on t.id = b.leave_type_id
    join public.profiles p on p.id = b.employee_id
   where b.organization_id = v_org and b.fy_label = _from_fy and b.deleted_at is null
     and t.kind = 'paid' and t.carry_forward_max is not null and t.deleted_at is null
     and p.is_active and p.deleted_at is null
  on conflict (review_id, employee_id, leave_type_id) do update
     set available_days = excluded.available_days,
         proposed_days  = excluded.proposed_days,
         -- A changed number above what is now left is cut to what is left.
         adjusted_days  = case when public.leave_carry_lines.adjusted_days is null then null
                               else least(public.leave_carry_lines.adjusted_days,
                                          greatest(excluded.available_days, 0)) end;

  return v_review.id;
end $$;

revoke all on function public.leave_carry_prepare(text) from public, anon;
grant execute on function public.leave_carry_prepare(text) to authenticated;

-- ═══════════════════════════════════════════════════════════ read

create or replace function public.leave_carry_review(_from_fy text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org    uuid := public.current_org_id();
  v_review public.leave_carry_reviews%rowtype;
begin
  if v_org is null or not public.is_module_admin('leave') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_review from public.leave_carry_reviews
   where organization_id = v_org and from_fy = _from_fy;
  if v_review.id is null then
    return null;
  end if;
  return jsonb_build_object(
    'id', v_review.id,
    'fromFy', v_review.from_fy,
    'toFy', v_review.to_fy,
    'status', v_review.status,
    'preparedAt', v_review.prepared_at,
    'lockedAt', v_review.locked_at,
    'lockedBy', (select full_name from public.profiles where id = v_review.locked_by),
    'nextYearOpen', public.leave_year_open(v_org, public.financial_year_start(v_org, v_review.to_fy)),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', l.id,
               'employeeName', coalesce(p.full_name, p.email),
               'leaveTypeName', t.name,
               'availableDays', l.available_days,
               'proposedDays', l.proposed_days,
               'adjustedDays', l.adjusted_days,
               'carryForwardMax', t.carry_forward_max)
             order by coalesce(p.full_name, p.email), t.name)
        from public.leave_carry_lines l
        join public.profiles p on p.id = l.employee_id
        join public.leave_types t on t.id = l.leave_type_id
       where l.review_id = v_review.id), '[]'::jsonb));
end $$;

revoke all on function public.leave_carry_review(text) from public, anon;
grant execute on function public.leave_carry_review(text) to authenticated;

-- ═══════════════════════════════════════════════════════════ adjust

create or replace function public.leave_carry_adjust(_line_id uuid, _days numeric)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org  uuid := public.current_org_id();
  v_line public.leave_carry_lines%rowtype;
begin
  if v_org is null or not public.is_module_admin('leave') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_line from public.leave_carry_lines
   where id = _line_id and organization_id = v_org;
  if v_line.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if _days is not null then
    if _days < 0 then
      raise exception 'NEGATIVE_DAYS' using errcode = 'P0001';
    end if;
    if _days * 2 <> floor(_days * 2) then
      raise exception 'NOT_A_HALF_DAY' using errcode = 'P0001';
    end if;
    if _days > greatest(v_line.available_days, 0) then
      raise exception 'MORE_THAN_LEFT' using errcode = 'P0001';
    end if;
  end if;
  -- Null puts the rule's number back. The trigger refuses a locked review.
  update public.leave_carry_lines set adjusted_days = _days where id = v_line.id;
end $$;

revoke all on function public.leave_carry_adjust(uuid, numeric) from public, anon;
grant execute on function public.leave_carry_adjust(uuid, numeric) to authenticated;

-- ═══════════════════════════════════════════════════════════ lock

create or replace function public.leave_carry_lock(_review_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org    uuid := public.current_org_id();
  v_review public.leave_carry_reviews%rowtype;
  v_line   record;
  v_n      integer := 0;
begin
  if v_org is null or not public.is_module_admin('leave') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_review from public.leave_carry_reviews
   where id = _review_id and organization_id = v_org
   for update;
  if v_review.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_review.status = 'locked' then
    raise exception 'REVIEW_LOCKED' using errcode = 'P0001';
  end if;
  if not public.leave_year_open(v_org, public.financial_year_start(v_org, v_review.to_fy)) then
    raise exception 'NEXT_YEAR_NOT_OPEN_YET' using errcode = 'P0001';
  end if;

  -- What is applied is what was on the screen: a balance that moved since
  -- the review was prepared makes the whole review stale.
  if exists (
    select 1 from public.leave_carry_lines l
      left join public.leave_balances b
        on b.organization_id = v_org and b.employee_id = l.employee_id
       and b.leave_type_id = l.leave_type_id and b.fy_label = v_review.from_fy
       and b.deleted_at is null
     where l.review_id = v_review.id
       and b.available_days is distinct from l.available_days) then
    raise exception 'REVIEW_STALE' using errcode = 'P0001';
  end if;

  for v_line in
    select l.*, coalesce(l.adjusted_days, l.proposed_days) as days
      from public.leave_carry_lines l where l.review_id = v_review.id
  loop
    perform public.ensure_balance(v_line.employee_id, v_line.leave_type_id, v_review.to_fy);
    begin
      update public.leave_balances
         set carryforward_days = v_line.days
       where organization_id = v_org and employee_id = v_line.employee_id
         and leave_type_id = v_line.leave_type_id and fy_label = v_review.to_fy;
    exception when check_violation then
      -- They already booked next year's leave against more carried-over days
      -- than this line gives (an opening balance set by hand). Nothing is
      -- applied; the Admin changes the line.
      raise exception 'CARRY_WOULD_OVERDRAW' using errcode = 'P0001';
    end;
    v_n := v_n + 1;
  end loop;

  update public.leave_carry_reviews
     set status = 'locked', locked_at = now(), locked_by = (select auth.uid())
   where id = v_review.id;
  return v_n;
end $$;

comment on function public.leave_carry_lock is
  'D91 — applies a carry-forward review to next year''s balances, all at once, and closes it. Refused before next year opens, or if any balance moved since it was prepared.';

revoke all on function public.leave_carry_lock(uuid) from public, anon;
grant execute on function public.leave_carry_lock(uuid) to authenticated;

/** The two years a review is useful for: the one just ended, and this one. */
create or replace function public.leave_carry_years()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  v_fy  text;
begin
  if v_org is null or not public.is_module_admin('leave') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_fy := public.get_financial_year(v_org, public.org_today(v_org));
  return jsonb_build_object(
    'current', v_fy,
    'previous', public.get_financial_year(v_org, public.financial_year_start(v_org, v_fy) - 1));
end $$;

revoke all on function public.leave_carry_years() from public, anon;
grant execute on function public.leave_carry_years() to authenticated;
