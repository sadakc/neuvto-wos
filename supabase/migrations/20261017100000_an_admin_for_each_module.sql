-- ============================================================================
-- NEUVTO WOS — an administrator for each module (D84)
-- ============================================================================
--
-- Sada, 12 Oct 2026: a Super Admin makes somebody, say, Employee Admin or Leave
-- Admin. A person can hold several, a module can have several, and the
-- company-wide Admin (org_admin, hr_admin) stays an admin of every module.
--
-- WHY A TABLE AND NOT MORE ROLES. app_role is an enum and a value can never be
-- removed. A role per module would add a value every time a module ships and
-- leave one behind every time one is retired. A row naming the module is
-- added and removed like data, and modules(key) already says which exist.
--
-- What this does:
--
--   1. module_admins: who administers which module in which company. Read by
--      the person themselves and by an Admin; written by nobody signed in, only
--      through member_set_module_admins().
--   2. is_module_admin(module): is_admin(), or a row for that module. Every
--      check a module makes for "may administer this module" asks this.
--   3. member_set_module_admins(user, modules): a Super Admin sets the whole
--      set, the same shape and rules as member_set_roles (D78): Super Admin
--      only, never your own, every module real and switched on.
--   4. session_policy: a module admin gets the administrator's short idle
--      timeout. An Employee Admin can see an Aadhaar number (D85).
--
-- Which functions ask is_module_admin('leave') and which ask
-- is_module_admin('employee') is the next two migrations.
-- ============================================================================

create table public.module_admins (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  module_key      text not null references public.modules(key) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  deleted_at timestamptz,
  unique (organization_id, user_id, module_key)
);
create index idx_module_admins_module
  on public.module_admins (organization_id, module_key) where deleted_at is null;

create trigger set_audit_fields before insert or update on public.module_admins
  for each row execute function public.set_audit_fields();
create trigger write_audit_log after insert or update or delete on public.module_admins
  for each row execute function public.write_audit_log();

alter table public.module_admins enable row level security;
revoke all on public.module_admins from anon, authenticated;
grant select on public.module_admins to authenticated;

create policy "read module admins in scope" on public.module_admins
  for select to authenticated
  using (organization_id = public.current_org_id()
         and deleted_at is null
         and (user_id = (select auth.uid()) or public.is_admin()));

comment on table public.module_admins is
  'D84 — who administers which module. A company-wide Admin administers every module without a row. Written only by member_set_module_admins().';

-- ═══════════════════════════════════════════════════════════ the question

create or replace function public.is_module_admin(_module text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin()
      or exists (select 1 from public.module_admins
                  where user_id = (select auth.uid())
                    and organization_id = public.current_org_id()
                    and module_key = _module
                    and deleted_at is null)
$$;

comment on function public.is_module_admin is
  'D84 — the caller administers this module: a company-wide Admin, or a module_admins row. current_org_id() is null for a deactivated person, so they administer nothing.';

revoke all on function public.is_module_admin(text) from public, anon;
grant execute on function public.is_module_admin(text) to authenticated;

-- ═══════════════════════════════════════════════════════════ the writer

create or replace function public.member_set_module_admins(_user_id uuid, _modules text[])
returns text[]
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org   uuid := public.current_org_id();
  v_actor uuid := (select auth.uid());
  v_want  text[];
  m       text;
begin
  if v_actor is null or v_org is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;
  if not public.is_super_admin() then
    raise exception 'ROLE_NOT_YOURS_TO_GRANT' using errcode = '42501';
  end if;
  if _user_id = v_actor then
    raise exception 'CANNOT_CHANGE_OWN_ROLES' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.profiles
                  where id = _user_id and organization_id = v_org and deleted_at is null) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  select coalesce(array_agg(distinct x order by x), '{}')
    into v_want
    from unnest(coalesce(_modules, '{}')) x;

  -- A module the company has not got cannot be administered. Checked only
  -- for additions: a module switched off later keeps its admins, who simply
  -- reach nothing until it is switched back on.
  foreach m in array v_want loop
    if not exists (select 1 from public.module_admins
                    where organization_id = v_org and user_id = _user_id
                      and module_key = m and deleted_at is null)
       and not public.module_enabled_for(v_org, m) then
      raise exception 'UNKNOWN_MODULE' using errcode = 'P0001', detail = m;
    end if;
  end loop;

  update public.module_admins
     set deleted_at = now()
   where organization_id = v_org and user_id = _user_id and deleted_at is null
     and module_key <> all (v_want);

  insert into public.module_admins (organization_id, user_id, module_key)
  select v_org, _user_id, x from unnest(v_want) x
  on conflict (organization_id, user_id, module_key)
  do update set deleted_at = null where public.module_admins.deleted_at is not null;

  return v_want;
end $$;

comment on function public.member_set_module_admins is
  'D84 — a Super Admin sets which modules somebody administers. The whole set; never your own; a module must be switched on to be added.';

revoke all on function public.member_set_module_admins(uuid, text[]) from public, anon;
grant execute on function public.member_set_module_admins(uuid, text[]) to authenticated;

-- ═══════════════════════════════════════════ shorter sessions for the sensitive

-- Reproduced from 20261011110000_a_company_runs_its_own_access.sql. The diff:
-- a module admin gets the organisation's (short) idle setting.
create or replace function public.session_policy()
returns table (idle_minutes integer, absolute_hours integer)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;

  if public.is_platform_admin() then
    return query select 30, 8;
    return;
  end if;

  v_org := public.current_org_id();
  if v_org is null then
    return query select 30, 8;
    return;
  end if;

  return query
  select
    case
      when exists (
        select 1 from public.user_roles ur
         where ur.user_id = v_uid
           and ur.organization_id = v_org
           and ur.deleted_at is null
           and ur.role in ('super_admin', 'org_admin', 'hr_admin', 'manager',
                           'payroll_officer', 'statutory_officer')
      ) or exists (
        select 1 from public.module_admins ma
         where ma.user_id = v_uid
           and ma.organization_id = v_org
           and ma.deleted_at is null
      ) then s.session_idle_minutes
      else greatest(s.session_idle_minutes, 480)
    end,
    s.session_absolute_hours
  from public.organization_settings s
  where s.organization_id = v_org;

  if not found then
    return query select 30, 24;
  end if;
end $function$;
