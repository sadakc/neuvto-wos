-- Sada, 14 Oct 2026 (D110): one way to invite somebody into the company.
--
-- A person is invited from their record (Employee Card, Add Employee:
-- employee_send_invite), so every module sees one person with one record.
-- People's invite form, the setup wizard's and the old spreadsheet import
-- are gone from the screens; this makes the database say the same, so
-- invitation_create cannot be called on its own any more. employee_send_invite
-- marks its own call for the length of that call, the way
-- employee_withdraw_posting marks the row it may delete (D105).

do $$
declare
  v_def text := pg_get_functiondef(
    'public.invitation_create(text,text,app_role,text,date,text,uuid)'::regprocedure);
  v_anchor text := $q$  if not public.is_module_admin('employee') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
$q$;
begin
  if position(v_anchor in v_def) = 0 then
    raise exception 'invitation_create no longer checks the admin as expected; restate it here';
  end if;
  execute replace(v_def, v_anchor, v_anchor || $q$  if current_setting('neuvto.inviting', true) is distinct from 'record' then
    raise exception 'INVITE_FROM_THE_RECORD' using errcode = '42501',
      hint = 'People are invited from their record: Employee Card, Add Employee.';
  end if;
$q$);

  v_def := pg_get_functiondef('public.employee_send_invite(uuid,app_role)'::regprocedure);
  if position('  v_inv := public.invitation_create(' in v_def) = 0
     or position('v_e.draft_department_id);' in v_def) = 0 then
    raise exception 'employee_send_invite no longer invites as expected; restate it here';
  end if;
  v_def := replace(v_def, '  v_inv := public.invitation_create(',
    E'  perform set_config(''neuvto.inviting'', ''record'', true);\n  v_inv := public.invitation_create(');
  v_def := replace(v_def, 'v_e.draft_department_id);',
    E'v_e.draft_department_id);\n  perform set_config(''neuvto.inviting'', '''', true);');
  execute v_def;
end $$;
