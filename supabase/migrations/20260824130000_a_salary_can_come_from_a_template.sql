-- ═══════════════════════════════════════════════════════════════════════════
-- A salary can come from a template
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Setting somebody up means typing an amount against every component, and most
-- organisations pay most people one of a small number of shapes. The source
-- spec calls these salary templates: a named set of components and amounts,
-- applied when a structure is created.
--
-- ── A template is a starting point, and stays one ──────────────────────────
--
-- Applying a template COPIES its amounts onto the person and then forgets it.
-- There is no link back, and that is the whole design:
--
--   * The workbook this replaces appears to derive Basic as 50% of gross and
--     HRA as 40% of Basic. Those rules hold for 12 and 20 of its 44 employees.
--     Everyone else has hand-keyed amounts. A template that stayed attached
--     would make three quarters of that workforce unrepresentable.
--   * A live link means editing a template restates the pay of everybody on it,
--     retroactively, from a screen that looks like configuration. That is the
--     freeze-after-association problem again, one table over.
--
-- So `salary_structures` is unchanged and knows nothing about templates. This
-- is a convenience for the person doing data entry, and deliberately nothing
-- more.

create table if not exists public.salary_templates (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  description     text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  deleted_at timestamptz,

  constraint salary_template_name_present check (length(btrim(name)) > 0)
);

create unique index if not exists uq_salary_template_name
  on public.salary_templates (organization_id, lower(name)) where deleted_at is null;
create index if not exists idx_salary_templates_org
  on public.salary_templates (organization_id) where deleted_at is null;

create table if not exists public.salary_template_lines (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  template_id     uuid not null references public.salary_templates(id) on delete cascade,
  component_id    uuid not null references public.salary_components(id) on delete restrict,
  amount          numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  deleted_at timestamptz,

  -- Zero is legitimate: a component this shape of employee does not receive.
  -- Negative is not — a deduction's sign is decided by the component's
  -- category, not by the amount, and a negative here would silently add pay.
  constraint salary_template_line_amount_sane check (amount >= 0)
);

create unique index if not exists uq_salary_template_line
  on public.salary_template_lines (template_id, component_id) where deleted_at is null;
create index if not exists idx_salary_template_lines_org
  on public.salary_template_lines (organization_id) where deleted_at is null;

-- ─────────────────────────────────────────────────────────────────── audit
do $$
begin
  create trigger set_audit_fields before insert or update on public.salary_templates
    for each row execute function public.set_audit_fields();
exception when duplicate_object then null; end $$;

do $$
begin
  create trigger set_audit_fields before insert or update on public.salary_template_lines
    for each row execute function public.set_audit_fields();
exception when duplicate_object then null; end $$;

-- ─────────────────────────────────────────────────────────────────── grants
--
-- No delete. A template is soft-deleted like everything else here, so an
-- application that ran against it last month can still be explained.
grant select, insert, update on public.salary_templates      to authenticated;
grant select, insert, update on public.salary_template_lines to authenticated;

alter table public.salary_templates      enable row level security;
alter table public.salary_template_lines enable row level security;

-- ────────────────────────────────────────────────────────────────── policies
--
-- ADMINISTRATORS ONLY, for reading as well as writing. A template is not one
-- person's salary but it is the SHAPE of a salary, and "the Manager template is
-- ₹85,000" tells an employee what their manager earns to within a rounding.
-- `salary_structures` refuses a colleague for the same reason.
drop policy if exists "admins read salary templates" on public.salary_templates;
create policy "admins read salary templates" on public.salary_templates
  for select to authenticated
  using (organization_id = public.current_org_id() and public.is_admin() and deleted_at is null);

drop policy if exists "admins write salary templates" on public.salary_templates;
create policy "admins write salary templates" on public.salary_templates
  for all to authenticated
  using (organization_id = public.current_org_id() and public.is_admin())
  with check (organization_id = public.current_org_id() and public.is_admin());

drop policy if exists "admins read salary template lines" on public.salary_template_lines;
create policy "admins read salary template lines" on public.salary_template_lines
  for select to authenticated
  using (organization_id = public.current_org_id() and public.is_admin() and deleted_at is null);

drop policy if exists "admins write salary template lines" on public.salary_template_lines;
create policy "admins write salary template lines" on public.salary_template_lines
  for all to authenticated
  using (organization_id = public.current_org_id() and public.is_admin())
  with check (organization_id = public.current_org_id() and public.is_admin());
