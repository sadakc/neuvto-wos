-- Sada, 14 Oct 2026 (D108): the directory of everybody is the admins'.
--
-- It moves to Organisation, where only those who administer the Employee
-- module see it: the Employee Admin, a company-wide Admin, a Super Admin.
-- Hiding the tab is not enough, so the function says the same. Everybody
-- still sees the company org chart (employee_org_chart, unchanged) and any
-- card their relationship allows (employee_card, unchanged).

do $$
declare
  v_def text := pg_get_functiondef('public.employee_directory(text)'::regprocedure);
  v_anchor text := $q$    raise exception 'MODULE_NOT_ENABLED' using errcode = 'P0001';
  end if;
$q$;
begin
  if position(v_anchor in v_def) = 0 then
    raise exception 'employee_directory no longer checks the module as expected; restate it here';
  end if;
  execute replace(v_def, v_anchor, v_anchor || $q$  if not public.is_module_admin('employee') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
$q$);
end $$;
