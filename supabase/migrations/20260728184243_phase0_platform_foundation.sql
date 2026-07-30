-- ============================================================================
-- NEUVTO WOS — Phase 0: Platform Layer (tenancy, identity, RBAC)
--
-- Build step 1. Creates no business module — only the platform every module
-- will consume. See docs/product/NEUVTO_MVP_BUILD_SPEC.md "PHASE 0".
--
-- Gate for this migration: Org A cannot read one row of Org B through any
-- query, as any role; and an employee cannot insert their own org_admin row.
-- Proven by neuvto-harness/tests/verify_rls.sql, not by reading this file.
-- ============================================================================

create extension if not exists btree_gist;   -- D18, used by the Phase 2 overlap constraint

-- ─────────────────────────────────────────────────────────── enums

create type public.app_role as enum ('org_admin', 'hr_admin', 'manager', 'employee');

-- ─────────────────────────────────────────────────────────── audit trigger (D16)
-- Audit fields are maintained here and never by application code. A value the
-- application can write is a value it can get wrong — and a wrong audit field is
-- worse than none, because it is trusted. created_at/created_by are restored from
-- the previous row on update, so history cannot be rewritten by a crafted request.

create or replace function public.set_audit_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    -- The authenticated user always wins. Falling back to a client-supplied
    -- value would let a caller forge authorship simply by sending created_by in
    -- the payload; the fallback exists only for system contexts (migrations,
    -- seeds, scheduled jobs) where there is no authenticated user at all.
    new.created_by := coalesce((select auth.uid()), new.created_by);
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;
  new.updated_at := now();
  new.updated_by := (select auth.uid());
  return new;
end $$;

comment on function public.set_audit_fields is
  'D16 — maintains created_at/by and updated_at/by. Attached to every business table.';

-- ─────────────────────────────────────────────────────────── organizations

create table public.organizations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text not null unique,
  industry_type text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id) on delete set null,
  updated_by    uuid references auth.users(id) on delete set null,
  deleted_at    timestamptz,
  constraint organizations_name_not_blank check (char_length(btrim(name)) > 0),
  constraint organizations_slug_format     check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$')
);

-- ─────────────────────────────────────────────────────────── organization_settings
-- Everything a customer might configure lives here as data. Nothing in this table
-- may be hardcoded in application code — not the financial year, not the weekend,
-- not a threshold. See docs/product/NEUVTO_MVP_BUILD_SPEC.md "Configuration, not code".

create table public.organization_settings (
  organization_id         uuid primary key references public.organizations(id) on delete cascade,

  timezone                text     not null default 'Asia/Kolkata',   -- D9
  fy_start_month          smallint not null default 4,
  fy_start_day            smallint not null default 1,
  weekend_days            smallint[] not null default '{0,6}',        -- 0 = Sunday
  exclude_weekends        boolean  not null default true,
  exclude_holidays        boolean  not null default true,
  allow_retroactive       boolean  not null default false,
  default_min_notice_days integer  not null default 0,

  session_idle_minutes    integer  not null default 60,               -- D20
  session_absolute_hours  integer  not null default 24,               -- D20

  notify_on_submit        boolean  not null default true,
  notify_on_approve       boolean  not null default true,
  notify_on_reject        boolean  not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  deleted_at timestamptz,

  constraint org_settings_fy_month  check (fy_start_month between 1 and 12),
  constraint org_settings_fy_day    check (fy_start_day   between 1 and 31),
  constraint org_settings_notice    check (default_min_notice_days >= 0),
  constraint org_settings_idle      check (session_idle_minutes   > 0),
  constraint org_settings_absolute  check (session_absolute_hours > 0),
  constraint org_settings_weekend   check (
    weekend_days <@ '{0,1,2,3,4,5,6}'::smallint[] and coalesce(array_length(weekend_days, 1), 0) <= 6
  )
);

-- ─────────────────────────────────────────────────────────── module_settings (D7)
-- Module-specific configuration as key/value, so a new module needs no migration.

create table public.module_settings (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  module_key      text not null,
  setting_key     text not null,
  value           jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  deleted_at timestamptz,
  primary key (organization_id, module_key, setting_key)
);

-- ─────────────────────────────────────────────────────────── departments

create table public.departments (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations(id) on delete restrict,
  name                 text not null,
  parent_department_id uuid references public.departments(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  deleted_at timestamptz,
  constraint departments_name_not_blank   check (char_length(btrim(name)) > 0),
  constraint departments_not_self_parent  check (parent_department_id is distinct from id),
  unique (organization_id, name)
);

-- ─────────────────────────────────────────────────────────── profiles

create table public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  full_name       text,
  email           text not null,
  phone           text,
  joined_date     date not null default current_date,                        -- D3
  manager_id      uuid references public.profiles(id) on delete set null,    -- D14
  department_id   uuid references public.departments(id) on delete set null,
  is_active       boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  deleted_at timestamptz,
  constraint profiles_email_format    check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint profiles_not_own_manager check (manager_id is distinct from id),
  unique (organization_id, email)
);

-- ─────────────────────────────────────────────────────────── user_roles (D4)
-- Deliberately NOT a column on profiles. A role on a user-editable table is a
-- privilege-escalation hole: whoever can update their own row can promote
-- themselves. Only is_admin() may write here, enforced by RLS below.

create table public.user_roles (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  role            public.app_role not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  deleted_at timestamptz,
  unique (user_id, organization_id, role)
);

-- ─────────────────────────────────────────────────────────── module registry

create table public.modules (
  key        text primary key,
  name       text not null,
  status     text not null default 'available'
             check (status in ('available','coming_soon','retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_modules (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  module_key      text not null references public.modules(key) on delete restrict,
  enabled         boolean not null default false,
  enabled_at      timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  deleted_at timestamptz,
  primary key (organization_id, module_key)
);

insert into public.modules (key, name, status) values
  ('leave',      'Leave Management', 'available'),
  ('attendance', 'Attendance',       'coming_soon'),
  ('payroll',    'Payroll',          'coming_soon');

-- ─────────────────────────────────────────────────────────── analytics_events (D25)
-- In-database rather than a third-party SaaS: sending employee behavioural data
-- to another company would add a processor, a DPA and a DPDP disclosure.

create table public.analytics_events (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  user_id         uuid references auth.users(id) on delete set null,
  event           text not null,
  properties      jsonb not null default '{}',
  occurred_at     timestamptz not null default now(),
  constraint analytics_event_name_format check (event ~ '^[a-z_]+\.[a-z_]+$')
);

-- ═══════════════════════════════════════════════════════════ security-definer functions
-- SECURITY DEFINER + STABLE + fixed search_path. Definer is required: these are
-- called from RLS policies on the very tables they read, and an invoker-rights
-- function would recurse infinitely. STABLE lets Postgres cache the result within
-- a statement instead of re-running it per row.

create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id from public.profiles
   where id = (select auth.uid()) and deleted_at is null
$$;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
     where user_id = _user_id and role = _role and deleted_at is null
       and organization_id = public.current_org_id()
  )
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role((select auth.uid()), 'org_admin')
      or public.has_role((select auth.uid()), 'hr_admin')
$$;

create or replace function public.is_manager_of(_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
     where id = _employee_id
       and manager_id = (select auth.uid())
       and organization_id = public.current_org_id()
       and deleted_at is null
  )
$$;

create or replace function public.module_enabled(_module_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select enabled from public.organization_modules
     where organization_id = public.current_org_id()
       and module_key = _module_key and deleted_at is null
  ), false)
$$;

-- ═══════════════════════════════════════════════════════════ audit triggers

create trigger set_audit_fields before insert or update on public.organizations
  for each row execute function public.set_audit_fields();
create trigger set_audit_fields before insert or update on public.organization_settings
  for each row execute function public.set_audit_fields();
create trigger set_audit_fields before insert or update on public.module_settings
  for each row execute function public.set_audit_fields();
create trigger set_audit_fields before insert or update on public.departments
  for each row execute function public.set_audit_fields();
create trigger set_audit_fields before insert or update on public.profiles
  for each row execute function public.set_audit_fields();
create trigger set_audit_fields before insert or update on public.user_roles
  for each row execute function public.set_audit_fields();
create trigger set_audit_fields before insert or update on public.organization_modules
  for each row execute function public.set_audit_fields();

-- ═══════════════════════════════════════════════════════════ indexes
-- organization_id on every table, per the scaling notes. Without these a policy
-- that filters by tenant does a sequential scan on every read.

create index idx_org_settings_org     on public.organization_settings (organization_id);
create index idx_module_settings_org  on public.module_settings (organization_id);
create index idx_departments_org      on public.departments (organization_id) where deleted_at is null;
create index idx_profiles_org         on public.profiles (organization_id) where deleted_at is null;
create index idx_profiles_manager     on public.profiles (manager_id) where deleted_at is null;
create index idx_profiles_org_email   on public.profiles (organization_id, email);
create index idx_user_roles_user      on public.user_roles (user_id) where deleted_at is null;
create index idx_user_roles_org_role  on public.user_roles (organization_id, role) where deleted_at is null;
create index idx_org_modules_org      on public.organization_modules (organization_id);
create index idx_analytics_org_event  on public.analytics_events (organization_id, event, occurred_at desc);
create index idx_analytics_event_time on public.analytics_events (event, occurred_at desc);

-- ═══════════════════════════════════════════════════════════ grants
-- RLS *restricts*; it does not *permit*. Without a table-level GRANT the
-- authenticated role cannot reach a table at all and every policy below is
-- unreachable. Both are required, and they are easy to confuse: a schema with
-- perfect policies and no grants looks secure and is simply broken.
--
-- Grants are deliberately coarse (the widest verb each table ever needs) and the
-- policies below do the real narrowing. DELETE is granted only where a hard
-- delete is genuinely intended — everywhere else removal is a soft delete, which
-- is an UPDATE of deleted_at (D17).
--
-- anon gets nothing. Every table here requires a signed-in user.

grant select, insert, update         on public.organizations         to authenticated;
grant select, insert, update         on public.organization_settings to authenticated;
grant select, insert, update, delete on public.module_settings       to authenticated;
grant select, insert, update         on public.departments           to authenticated;
grant select, insert, update         on public.profiles              to authenticated;
grant select, insert, update, delete on public.user_roles            to authenticated;
grant select                         on public.modules               to authenticated;
grant select, insert, update, delete on public.organization_modules  to authenticated;
grant select, insert                 on public.analytics_events      to authenticated;

grant execute on function public.current_org_id()          to authenticated;
grant execute on function public.has_role(uuid, public.app_role) to authenticated;
grant execute on function public.is_admin()                to authenticated;
grant execute on function public.is_manager_of(uuid)       to authenticated;
grant execute on function public.module_enabled(text)      to authenticated;

-- ═══════════════════════════════════════════════════════════ row-level security
-- Enabled in the same migration that creates each table — never a follow-up.
-- Every policy filters organization_id first, then deleted_at is null (D17),
-- then role/scope. Soft-delete filtering lives here rather than in application
-- queries: one forgotten `where deleted_at is null` otherwise leaks deleted rows
-- into a report or a balance calculation.

alter table public.organizations         enable row level security;
alter table public.organization_settings enable row level security;
alter table public.module_settings       enable row level security;
alter table public.departments           enable row level security;
alter table public.profiles              enable row level security;
alter table public.user_roles            enable row level security;
alter table public.modules               enable row level security;
alter table public.organization_modules  enable row level security;
alter table public.analytics_events      enable row level security;

-- organizations ------------------------------------------------------------
create policy "read own organization" on public.organizations
  for select to authenticated
  using (id = public.current_org_id() and deleted_at is null);

-- Signup creates an organization. The creator becomes its admin in the same
-- transaction (handled by the signup flow in build step 2).
create policy "create an organization" on public.organizations
  for insert to authenticated with check (true);

create policy "admins update own organization" on public.organizations
  for update to authenticated
  using (id = public.current_org_id() and deleted_at is null and public.is_admin())
  with check (id = public.current_org_id());

-- organization_settings ----------------------------------------------------
create policy "read own settings" on public.organization_settings
  for select to authenticated
  using (organization_id = public.current_org_id() and deleted_at is null);

create policy "admins write settings" on public.organization_settings
  for all to authenticated
  using (organization_id = public.current_org_id() and public.is_admin() and deleted_at is null)
  with check (organization_id = public.current_org_id() and public.is_admin());

-- module_settings ----------------------------------------------------------
create policy "read own module settings" on public.module_settings
  for select to authenticated
  using (organization_id = public.current_org_id() and deleted_at is null);

create policy "admins write module settings" on public.module_settings
  for all to authenticated
  using (organization_id = public.current_org_id() and public.is_admin() and deleted_at is null)
  with check (organization_id = public.current_org_id() and public.is_admin());

-- departments --------------------------------------------------------------
create policy "read own departments" on public.departments
  for select to authenticated
  using (organization_id = public.current_org_id() and deleted_at is null);

create policy "admins write departments" on public.departments
  for all to authenticated
  using (organization_id = public.current_org_id() and public.is_admin() and deleted_at is null)
  with check (organization_id = public.current_org_id() and public.is_admin());

-- profiles -----------------------------------------------------------------
-- An employee sees themselves. A manager also sees their direct reports. An
-- admin sees everyone in the organisation. Nobody sees another tenant.
create policy "read profiles in scope" on public.profiles
  for select to authenticated
  using (
    organization_id = public.current_org_id()
    and deleted_at is null
    and (
      id = (select auth.uid())
      or public.is_manager_of(id)
      or public.is_admin()
    )
  );

create policy "update own profile" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()) and deleted_at is null)
  -- organization_id is pinned so a user cannot move themselves between tenants.
  with check (id = (select auth.uid()) and organization_id = public.current_org_id());

create policy "admins write profiles" on public.profiles
  for all to authenticated
  using (organization_id = public.current_org_id() and public.is_admin() and deleted_at is null)
  with check (organization_id = public.current_org_id() and public.is_admin());

-- Signup inserts the first profile, before any role exists to authorise it.
create policy "create own profile" on public.profiles
  for insert to authenticated with check (id = (select auth.uid()));

-- user_roles ---------------------------------------------------------------
-- The privilege-escalation boundary. Users may READ their own roles and never
-- write any. Only an admin grants or revokes.
create policy "read roles in scope" on public.user_roles
  for select to authenticated
  using (
    organization_id = public.current_org_id()
    and deleted_at is null
    and (user_id = (select auth.uid()) or public.is_admin())
  );

create policy "admins grant roles" on public.user_roles
  for insert to authenticated
  with check (organization_id = public.current_org_id() and public.is_admin());

create policy "admins revoke roles" on public.user_roles
  for update to authenticated
  using (organization_id = public.current_org_id() and public.is_admin())
  with check (organization_id = public.current_org_id() and public.is_admin());

create policy "admins delete roles" on public.user_roles
  for delete to authenticated
  using (organization_id = public.current_org_id() and public.is_admin());

-- modules ------------------------------------------------------------------
-- A global registry with no tenant. Readable by all, writable by none.
create policy "anyone may read the module registry" on public.modules
  for select to authenticated using (true);

-- organization_modules -----------------------------------------------------
create policy "read own enabled modules" on public.organization_modules
  for select to authenticated
  using (organization_id = public.current_org_id() and deleted_at is null);

create policy "admins toggle modules" on public.organization_modules
  for all to authenticated
  using (organization_id = public.current_org_id() and public.is_admin() and deleted_at is null)
  with check (organization_id = public.current_org_id() and public.is_admin());

-- analytics_events ---------------------------------------------------------
-- Anyone may emit an event for their own organisation; only admins may read.
-- Events are behavioural data about employees and are not theirs to browse.
create policy "emit events for own org" on public.analytics_events
  for insert to authenticated
  with check (organization_id = public.current_org_id());

create policy "admins read events" on public.analytics_events
  for select to authenticated
  using (organization_id = public.current_org_id() and public.is_admin());

-- ═══════════════════════════════════════════════════════════ comments

comment on table public.organizations    is 'Tenants. Every business table carries organization_id.';
comment on table public.user_roles       is 'D4 — roles live here, never on profiles.';
comment on table public.modules          is 'Global module registry; per-tenant enablement in organization_modules.';
comment on table public.analytics_events is 'D25 — in-database analytics; see docs/standards/NEUVTO_ANALYTICS.md.';
comment on column public.organization_settings.timezone is
  'D9 — all date comparisons resolve here, never against the server clock.';
