-- ============================================================================
-- NEUVTO WOS — the Scheduled reports panel can read what it lists
--
-- listReportDefinitions and listSchedules are plain selects, and on the local
-- stack both failed with 42501: report_definitions and report_schedules were
-- created after 20260822100000 removed the stock default that hands every new
-- table to `authenticated`, and 20260820100000 never granted SELECT itself.
-- Hosted Supabase may still grant it through supabase_admin's default; this
-- states it rather than relying on that.
--
-- Two policies change with the grant, because neither held on its own:
--
--   report_definitions  called module_enabled_for(), which 20260808100000
--                       deliberately keeps from `authenticated` (it answers for
--                       any organisation given its id). The same question is
--                       asked here through the caller's own organization_modules
--                       rows, which RLS already scopes to their organisation.
--
--   report_schedules    let every member of the organisation read every
--                       schedule, recipients included — addresses outside the
--                       product, the CEO's among them. Narrowed to whoever
--                       administers the report's module (D84), the same test
--                       report_schedule_save and _remove apply to writes.
--
-- SELECT only. Writes stay with the SECURITY DEFINER RPCs.
-- ============================================================================

grant select on public.report_definitions to authenticated;
grant select on public.report_schedules   to authenticated;

drop policy if exists "read report definitions" on public.report_definitions;
create policy "read report definitions"
  on public.report_definitions for select
  to authenticated
  using (exists (
    select 1
      from public.organization_modules om
      join public.modules m on m.key = om.module_key
     where om.organization_id = public.current_org_id()
       and om.module_key = report_definitions.module_key
       and om.enabled
       and om.deleted_at is null
       and m.status <> 'retired'));

-- The join to report_definitions runs under that table's policy, so a schedule
-- for a module switched off disappears with its definition (D44).
drop policy if exists "read own report schedules" on public.report_schedules;
create policy "read own report schedules"
  on public.report_schedules for select
  to authenticated
  using (organization_id = public.current_org_id()
         and deleted_at is null
         and exists (
           select 1 from public.report_definitions d
            where d.report_key = report_schedules.report_key
              and public.is_module_admin(d.module_key)));
