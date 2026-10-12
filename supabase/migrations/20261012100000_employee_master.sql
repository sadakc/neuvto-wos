-- ============================================================================
-- NEUVTO WOS — the Employee Master: the record of a person (D80, D81, D82)
-- ============================================================================
--
-- Stage E4 of docs/product/NEUVTO_EMPLOYEE_MASTER.md. The tables, the three
-- record rules as constraints, and the backfill. No screen reads these yet;
-- the role-shaped read functions are E5 and the writes are E7.
--
-- The three rules (§2), each enforced HERE rather than remembered elsewhere:
--
--   1. Repeating things repeat without a limit. Family, nominees and previous
--      organisations are rows. No unique on (employee, relation): two sons is
--      normal, five is normal.
--   2. History is closed, never overwritten. Addresses, deployments and
--      nominations carry effective_from / effective_to. An exclusion constraint
--      makes two overlapping rows impossible; a trigger refuses any change to a
--      closed row and any change but closing to an open one; nothing is
--      deleted.
--   3. Anything a report groups by is a managed list. Designations and
--      deployment units are rows with ids; a unit anybody was ever posted to
--      can be retired, never deleted.
--
-- And one access rule that shapes every policy below: these tables have RLS on
-- and NO policy that lets a signed-in person read them directly. The card and
-- the directory are SECURITY DEFINER functions that return what the caller's
-- role may see and omit the rest (§5). Row-level security answers "which
-- rows"; the design asks "which FIELDS, for which role", and only a function
-- can answer that. A field a role may not see is therefore absent from the
-- response by construction, never masked in the browser.
-- ============================================================================

create extension if not exists btree_gist with schema extensions;

-- The module, granted per customer by Neuvto and switched on by them (D44).
insert into public.modules (key, name, status)
values ('employee', 'Employee Master', 'available')
on conflict (key) do update set name = excluded.name, status = excluded.status;

-- ═══════════════════════════════════════════════════ managed lists (rule 3)

create table public.designations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null check (btrim(name) <> ''),
  grade           text,
  status          text not null default 'active' check (status in ('active', 'retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  deleted_at timestamptz
);
create unique index designations_name_per_org on public.designations
  (organization_id, lower(btrim(name))) where deleted_at is null;

create table public.deployment_units (
  id                           uuid primary key default gen_random_uuid(),
  organization_id              uuid not null references public.organizations(id) on delete cascade,
  name                         text not null check (btrim(name) <> ''),
  unit_type                    text not null check (unit_type in ('own_establishment', 'client_site')),
  client_name                  text,
  location                     text,
  state                        text,
  attendance_capture_mode      text,
  requires_police_verification boolean not null default false,
  is_billable                  boolean not null default false,
  status                       text not null default 'active' check (status in ('active', 'retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  deleted_at timestamptz,
  -- A client site belongs to a client; an own establishment does not.
  constraint deployment_units_client_matches_type
    check ((unit_type = 'client_site') = (client_name is not null and btrim(client_name) <> ''))
);
create unique index deployment_units_name_per_org on public.deployment_units
  (organization_id, lower(btrim(name))) where deleted_at is null;

-- ═══════════════════════════════════════════════════════════ the record

create table public.employees (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations(id) on delete restrict,
  -- NULL until the invitation is accepted; then the person's sign-in. D82.
  -- set null, not restrict: an account can be erased (D23) and the record of
  -- the person's employment must outlive it, unlinked.
  profile_id            uuid unique references public.profiles(id) on delete set null,
  invitation_id         uuid references public.invitations(id) on delete set null,
  employee_code         text,

  name_as_per_id        text,
  sex                   text check (sex in ('male', 'female', 'other', 'undisclosed')),
  date_of_birth         date check (date_of_birth > date '1900-01-01'),
  marital_status        text check (marital_status in ('single', 'married', 'widowed', 'divorced', 'separated')),
  nationality           text,
  native_state          text,
  blood_group           text check (blood_group in ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  education_qualification text,
  alternate_mobile      text,
  personal_email        text check (personal_email is null or personal_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),

  designation_id        uuid references public.designations(id) on delete restrict,
  employment_type       text check (employment_type in ('full_time','contract','apprentice','part_time','intern','consultant')),
  re_joining_date       date,
  confirmed_on          date,
  status                text not null default 'working'
                        check (status in ('working', 'probation', 'notice', 'suspended', 'left')),
  termination_date      date,
  termination_reason    text,
  reason_for_leaving_last_org text,

  height_cm             smallint check (height_cm between 50 and 260),
  chest_cm              smallint check (chest_cm between 30 and 200),
  weight_kg             smallint check (weight_kg between 10 and 400),
  nearest_police_station text,

  emergency_contact_name     text,
  emergency_contact_relation text,
  emergency_contact_phone    text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  deleted_at timestamptz,

  constraint employees_termination_has_a_date
    check (status <> 'left' or termination_date is not null)
);
create unique index employees_code_per_org on public.employees (organization_id, employee_code)
  where employee_code is not null and deleted_at is null;
create index employees_org on public.employees (organization_id) where deleted_at is null;

comment on table public.employees is
  'D82 — the master record, from the moment an admin starts it. Name, email, phone, joined date, manager, department and active live on profiles (or the invitation, before acceptance) and are NOT copied here. age and total experience are derived, never stored.';

-- ═══════════════════════════════════════════════════ history (rule 2)

create table public.employee_addresses (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  employee_id     uuid not null references public.employees(id) on delete restrict,
  address_type    text not null check (address_type in ('present', 'permanent', 'while_deployed', 'emergency')),
  line            text not null check (btrim(line) <> ''),
  city            text not null,
  district        text,
  state           text not null,
  pincode         text not null check (pincode ~ '^[1-9][0-9]{5}$'),
  nearest_police_station text,
  effective_from  date not null,
  effective_to    date,
  validity        daterange generated always as (daterange(effective_from, effective_to, '[)')) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  deleted_at timestamptz,
  constraint employee_addresses_ends_after_it_starts
    check (effective_to is null or effective_to > effective_from),
  -- THE line. One address of each type per person at any moment, open or closed.
  constraint employee_addresses_never_overlap
    exclude using gist (employee_id with =, address_type with =, validity with &&)
);
create index employee_addresses_open on public.employee_addresses (employee_id) where effective_to is null;

create table public.employee_deployments (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations(id) on delete restrict,
  employee_id          uuid not null references public.employees(id) on delete restrict,
  deployment_unit_id   uuid not null references public.deployment_units(id) on delete restrict,
  effective_from       date not null,
  effective_to         date,
  deployment_order_ref text not null check (btrim(deployment_order_ref) <> ''),
  expected_duration    text,
  reason               text,
  validity             daterange generated always as (daterange(effective_from, effective_to, '[)')) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  deleted_at timestamptz,
  constraint employee_deployments_ends_after_it_starts
    check (effective_to is null or effective_to > effective_from),
  -- One posting at any moment. Attendance, the muster roll and the client
  -- invoice each resolve the unit AS AT a date, and that only has one answer
  -- if postings never overlap.
  constraint employee_deployments_never_overlap
    exclude using gist (employee_id with =, validity with &&)
);
create index employee_deployments_open on public.employee_deployments (employee_id) where effective_to is null;
create index employee_deployments_unit on public.employee_deployments (deployment_unit_id);

create table public.nomination_versions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  employee_id     uuid not null references public.employees(id) on delete restrict,
  scheme          text not null default 'pf_and_gratuity'
                  check (scheme in ('pf_and_gratuity', 'esic', 'insurance')),
  effective_from  date not null,
  effective_to    date,
  validity        daterange generated always as (daterange(effective_from, effective_to, '[)')) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  deleted_at timestamptz,
  constraint nomination_versions_ends_after_it_starts
    check (effective_to is null or effective_to > effective_from),
  constraint nomination_versions_never_overlap
    exclude using gist (employee_id with =, scheme with =, validity with &&)
);

create table public.nominees (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  version_id      uuid not null references public.nomination_versions(id) on delete cascade,
  name            text not null check (btrim(name) <> ''),
  relation        text not null check (relation in
                    ('father','mother','husband','wife','son','daughter','brother','sister','guardian','other')),
  date_of_birth   date,
  share_percent   numeric(5,2) not null check (share_percent > 0 and share_percent <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null
);
create index nominees_version on public.nominees (version_id);

-- ═══════════════════════════════════════════ repeating, not temporal (rule 1)

create table public.family_members (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  employee_id     uuid not null references public.employees(id) on delete cascade,
  relation        text not null check (relation in
                    ('father','mother','husband','wife','son','daughter','brother','sister','guardian','other')),
  name            text not null check (btrim(name) <> ''),
  date_of_birth   date,
  is_dependent    boolean not null default true,
  sort_order      smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null
);
-- Deliberately NO unique on (employee_id, relation).
create index family_members_employee on public.family_members (employee_id);

create table public.previous_organisations (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete restrict,
  employee_id        uuid not null references public.employees(id) on delete cascade,
  organisation_name  text not null check (btrim(organisation_name) <> ''),
  designation        text,
  from_date          date not null,
  to_date            date not null,
  reason_for_leaving text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint previous_organisations_ends_after_it_starts check (to_date >= from_date)
);
create index previous_organisations_employee on public.previous_organisations (employee_id);

-- ═══════════════════════════════════════ every row in one organisation

-- A child row must be in its employee's organisation, and a deployment in its
-- unit's. Without this a definer function with one wrong join could file
-- somebody's address under another customer and RLS would never notice,
-- because RLS checks the row's own organisation_id, not its parent's.
create or replace function public.tf_employee_child_same_org()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  if tg_table_name = 'nominees' then
    select organization_id into v_org from public.nomination_versions where id = new.version_id;
  else
    select organization_id into v_org from public.employees where id = new.employee_id;
  end if;
  if v_org is distinct from new.organization_id then
    raise exception 'CROSS_ORGANISATION_ROW' using errcode = 'P0001';
  end if;
  -- Nested, not `and`: PL/pgSQL resolves new.deployment_unit_id when it
  -- compiles the condition, so on any other table a single `and` raises
  -- "record new has no field". Found by the harness on its first run.
  if tg_table_name = 'employee_deployments' then
    if not exists (
      select 1 from public.deployment_units
       where id = new.deployment_unit_id and organization_id = new.organization_id
    ) then
      raise exception 'CROSS_ORGANISATION_ROW' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

-- ═══════════════════════════════════════ closed rows are immutable (rule 2)

-- On an OPEN row, the only change allowed is setting effective_to, which is
-- how it is closed when a successor arrives. On a CLOSED row, nothing. And no
-- row is ever deleted, by anybody signed in.
--
-- The one escape is an operator's: `set local neuvto.purge = 'on'` inside the
-- transaction that removes a whole workspace (operations/TEST_DATA_PURGE.md).
-- A guard that refuses a workspace's deletion makes it undeletable, which the
-- last-Super-Admin trigger learned on its first harness run.
create or replace function public.tf_history_is_append_only()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ignored text[] := array['effective_to', 'validity', 'updated_at', 'updated_by'];
begin
  if current_setting('neuvto.purge', true) = 'on' then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    raise exception 'HISTORY_IS_NEVER_DELETED' using errcode = 'P0001',
      hint = 'Close the row with an end date and add its successor.';
  end if;

  if old.effective_to is not null then
    raise exception 'ARCHIVED_IMMUTABLE' using errcode = 'P0001',
      hint = 'A closed row is part of the record. Attach a correction instead.';
  end if;

  if (to_jsonb(new) - v_ignored) is distinct from (to_jsonb(old) - v_ignored) then
    raise exception 'USE_A_NEW_ROW' using errcode = 'P0001',
      hint = 'Only effective_to may change on an open row. Add a successor for anything else.';
  end if;
  return new;
end $$;

-- ═══════════════════════════════════ nominee shares total exactly 100

create or replace function public.tf_nominee_shares_add_up()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version uuid := coalesce(new.version_id, old.version_id);
  v_total numeric;
begin
  -- The version itself was deleted (a purge); its nominees go with it.
  if not exists (select 1 from public.nomination_versions where id = v_version) then
    return null;
  end if;
  select coalesce(sum(share_percent), 0) into v_total from public.nominees where version_id = v_version;
  if v_total <> 100 then
    raise exception 'NOMINEE_SHARES_NOT_100' using errcode = 'P0001',
      detail = format('Shares total %s, must be 100', v_total);
  end if;
  return null;
end $$;

-- A nominee is never edited or removed. Changing anybody supersedes the whole
-- version (E7 closes it and inserts the next), because the superseded Form 2
-- is what a claim is settled against.
create or replace function public.tf_nominees_are_append_only()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('neuvto.purge', true) = 'on' then
    return coalesce(new, old);
  end if;
  raise exception 'NOMINATION_IS_VERSIONED' using errcode = 'P0001',
    hint = 'Supersede the nomination with a new version instead.';
end $$;

revoke all on function public.tf_nominees_are_append_only() from public, anon, authenticated;

create trigger nominees_are_append_only
  before update or delete on public.nominees
  for each row execute function public.tf_nominees_are_append_only();

-- ═══════════════════════════════════════════════ a unit is retired, never deleted

create or replace function public.tf_managed_list_is_never_deleted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('neuvto.purge', true) = 'on' then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' or (old.deleted_at is null and new.deleted_at is not null) then
    raise exception 'RETIRE_DO_NOT_DELETE' using errcode = 'P0001',
      hint = 'Set status to retired. Past rows keep pointing at it.';
  end if;
  return new;
end $$;

-- ═══════════════════════════════════════════════════════════ triggers

do $$
declare t text;
begin
  foreach t in array array['designations','deployment_units','employees','employee_addresses',
    'employee_deployments','nomination_versions','nominees','family_members','previous_organisations']
  loop
    execute format('create trigger set_audit_fields before insert or update on public.%I
                    for each row execute function public.set_audit_fields()', t);
    execute format('create trigger write_audit_log after insert or update or delete on public.%I
                    for each row execute function public.write_audit_log()', t);
  end loop;

  foreach t in array array['employee_addresses','employee_deployments','nomination_versions',
    'nominees','family_members','previous_organisations']
  loop
    execute format('create trigger same_organisation before insert or update on public.%I
                    for each row execute function public.tf_employee_child_same_org()', t);
  end loop;

  foreach t in array array['employee_addresses','employee_deployments','nomination_versions'] loop
    execute format('create trigger history_is_append_only before update or delete on public.%I
                    for each row execute function public.tf_history_is_append_only()', t);
  end loop;

  foreach t in array array['designations','deployment_units'] loop
    execute format('create trigger never_deleted before update or delete on public.%I
                    for each row execute function public.tf_managed_list_is_never_deleted()', t);
  end loop;
end $$;

create constraint trigger nominee_shares_add_up
  after insert or update or delete on public.nominees
  deferrable initially deferred
  for each row execute function public.tf_nominee_shares_add_up();

-- ═══════════════════════════════════════════════════════════ access

-- Managed lists are read by everybody in the organisation (a designation is on
-- every card) and written by nobody directly: the configuration screens (E9)
-- write through functions.
alter table public.designations     enable row level security;
alter table public.deployment_units enable row level security;

create policy "read designations in scope" on public.designations
  for select to authenticated
  using (organization_id = public.current_org_id() and deleted_at is null);
create policy "read deployment units in scope" on public.deployment_units
  for select to authenticated
  using (organization_id = public.current_org_id() and deleted_at is null);

-- Written out, not looped: CI's guardrail reads each migration for a literal
-- `alter table <t> enable row level security` beside every `create table`.
alter table public.employees enable row level security;
alter table public.employee_addresses enable row level security;
alter table public.employee_deployments enable row level security;
alter table public.nomination_versions enable row level security;
alter table public.nominees enable row level security;
alter table public.family_members enable row level security;
alter table public.previous_organisations enable row level security;

-- The record and everything under it: RLS on, NO policy. Reached only through
-- the role-shaped functions (E5). D42 holds as everywhere else: a platform
-- admin has no organisation, so even those functions answer nothing.
do $$
declare t text;
begin
  foreach t in array array['employees','employee_addresses','employee_deployments',
    'nomination_versions','nominees','family_members','previous_organisations']
  loop
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
  foreach t in array array['designations','deployment_units'] loop
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

revoke all on function public.tf_employee_child_same_org() from public, anon, authenticated;
revoke all on function public.tf_history_is_append_only() from public, anon, authenticated;
revoke all on function public.tf_nominee_shares_add_up() from public, anon, authenticated;
revoke all on function public.tf_managed_list_is_never_deleted() from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════ the backfill

-- Everybody who already has a profile gets a record, so nobody's card is
-- missing on the day the module is switched on. No code, no designation, no
-- posting: those are the admin's to fill, and a guessed value would be a
-- wrong value presented as data.
insert into public.employees (organization_id, profile_id)
select p.organization_id, p.id
  from public.profiles p
 where p.deleted_at is null
   and not exists (select 1 from public.employees e where e.profile_id = p.id);

-- And everybody who joins from now on gets one when they accept. A trigger on
-- profiles rather than a change to invitation_accept: one rule, every path,
-- including any way of creating a profile written later.
create or replace function public.tf_profile_has_an_employee_record()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- An admin who started the record before the invitation was accepted (E8)
  -- linked it to that invitation; claim it rather than making a second one.
  update public.employees e
     set profile_id = new.id
    from public.invitations i
   where e.invitation_id = i.id
     and e.profile_id is null
     and e.organization_id = new.organization_id
     and i.organization_id = new.organization_id
     and lower(i.email) = lower(new.email)
     and e.deleted_at is null;
  if not found then
    insert into public.employees (organization_id, profile_id)
    values (new.organization_id, new.id)
    on conflict (profile_id) do nothing;
  end if;
  return new;
end $$;

revoke all on function public.tf_profile_has_an_employee_record() from public, anon, authenticated;

create trigger has_an_employee_record
  after insert on public.profiles
  for each row execute function public.tf_profile_has_an_employee_record();
