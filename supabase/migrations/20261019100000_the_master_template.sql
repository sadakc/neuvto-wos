-- ============================================================================
-- NEUVTO WOS — the master template: a workforce in from one workbook (D86)
-- ============================================================================
--
-- Sada, 12 Oct 2026: the old master sheet is not imported as it is. It is
-- re-prepared as Neuvto's own template, every field Neuvto keeps for a person,
-- Aadhaar, PAN and bank included, in one Excel workbook:
--
--   People               one row a person: identity, contact, employment,
--                        addresses, posting, physical, statutory, bank, and
--                        religion, caste and disability (optional)
--   Family               one row a member, any number: no "Son 1, Son 2"
--   Nominees             one row a nominee, shares per scheme totalling 100
--   Previous employment  one row an organisation
--
-- Rows are linked by Employee code. The browser reads the workbook and sends
-- it here as JSON with Neuvto's own keys; this function does everything else.
--
-- WHO. The Employee Admin (is_module_admin('employee')), which includes every
-- company-wide Admin. Not only a Super Admin any more: since D85 the Employee
-- Admin enters these numbers by hand, so a file of them is the same grant.
--
-- NEW PEOPLE ONLY. Every row is a new draft. An employee code or email already
-- in the company is a problem on that row, never an update.
--
-- ONE SET OF RULES. Nothing is validated here that a writer already validates.
-- Each person goes through the same functions as the card: create_draft,
-- update, add_address, move_unit, set_statutory, set_bank, set_restricted,
-- save_family, save_nomination, save_previous_orgs. Each section runs in its
-- own subtransaction, so one person can show several problems at once; then
-- the person's writes are rolled back if it is a dry run or anything failed.
-- A rule changed on the card is therefore changed in the import.
--
-- ALL OR NOTHING by default: with _only_clean false, any problem refuses the
-- whole file. With true, clean people are created and the rest skipped.
--
-- Replaces the 17-column import of 20261015110000, which is dropped.
-- ============================================================================

drop function if exists public.employee_import_commit(jsonb, boolean);
drop function if exists public.employee_import_check(jsonb);
drop function if exists public.employee_import_row_problems(uuid, jsonb, text[]);
drop function if exists public.employee_import_columns();

/** The keys each tab may carry. A key outside these refuses the file. */
create or replace function public.employee_import_keys(_tab text)
returns text[]
language sql
immutable
set search_path = public
as $$
  select case _tab
    when 'people' then array[
      'employeeCode','fullName','email','mobile','joinedDate','department','reportsToEmail',
      'designation','employmentType','confirmedOn','reJoiningDate',
      'nameAsPerId','sex','dateOfBirth','maritalStatus','nationality','nativeState','bloodGroup',
      'educationQualification','alternateMobile','personalEmail',
      'emergencyContactName','emergencyContactRelation','emergencyContactPhone',
      'reasonForLeavingLastOrg','heightCm','chestCm','weightKg','nearestPoliceStation',
      'presentLine','presentCity','presentDistrict','presentState','presentPincode','presentFrom',
      'permanentSameAsPresent','permanentLine','permanentCity','permanentDistrict',
      'permanentState','permanentPincode',
      'deployedUnit','deployedFrom','deploymentOrderRef',
      'identityDocumentType','aadhaar','pan','uan','epfNumber','esicNumber','oldUan','oldEsicNumber',
      'bankName','branch','account','ifsc','accountHolder',
      'religion','casteCategory','disabilityStatus','disabilityPercent']
    when 'family' then array['employeeCode','relation','name','dateOfBirth','isDependent']
    when 'nominees' then array['employeeCode','scheme','name','relation','dateOfBirth','sharePercent']
    when 'previous' then array['employeeCode','organisationName','designation','fromDate','toDate','reasonForLeaving']
  end
$$;

grant execute on function public.employee_import_keys(text) to authenticated;

/** Only the keys of _r that are in _keys and not blank, as a writer's values. */
create or replace function public.employee_import_pick(_r jsonb, _map jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select coalesce(jsonb_object_agg(m.value #>> '{}', _r -> m.key), '{}'::jsonb)
    from jsonb_each(_map) m
   where nullif(btrim(coalesce(_r ->> m.key, '')), '') is not null
$$;

revoke all on function public.employee_import_pick(jsonb, jsonb) from public, anon, authenticated;

create or replace function public.employee_import_master(
  _workbook   jsonb,
  _commit     boolean,
  _only_clean boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org      uuid := public.current_org_id();
  v_people   jsonb := coalesce(_workbook -> 'people', '[]'::jsonb);
  v_tabs     text[] := array['family','nominees','previous'];
  v_problems jsonb := '[]'::jsonb;   -- every problem, for the screen
  v_mine     jsonb;                  -- this person's
  v_codes    text[] := '{}';
  v_emails   text[] := '{}';
  v_created  integer := 0;
  v_skipped  integer := 0;
  r          jsonb;
  x          jsonb;
  t          text;
  k          text;
  i          integer;
  j          integer;
  v_code     text;
  v_email    text;
  v_id       uuid;
  v_ref      uuid;
  v_rows     jsonb;
  v_msg      text;
  v_detail   text;
  v_section  text;
begin
  if (select auth.uid()) is null or v_org is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;
  if not public.module_enabled_for(v_org, 'employee') then
    raise exception 'MODULE_NOT_ENABLED' using errcode = 'P0001';
  end if;
  if not public.is_module_admin('employee') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if jsonb_typeof(v_people) <> 'array' or jsonb_array_length(v_people) = 0 then
    raise exception 'NO_ROWS' using errcode = 'P0001';
  end if;
  if jsonb_array_length(v_people) > 1000 then
    raise exception 'TOO_MANY_ROWS' using errcode = 'P0001', hint = 'A thousand people at a time.';
  end if;

  -- ── the shape: known keys only, so a misspelt column is never a silent loss.
  foreach t in array array['people'] || v_tabs loop
    for x in select * from jsonb_array_elements(coalesce(_workbook -> t, '[]'::jsonb)) loop
      for k in select jsonb_object_keys(x) loop
        if not (k = any (public.employee_import_keys(t))) then
          raise exception 'UNKNOWN_COLUMN' using errcode = 'P0001', detail = t || '.' || k;
        end if;
      end loop;
    end loop;
  end loop;

  -- ── rows on the other tabs must name somebody on People.
  select coalesce(array_agg(lower(btrim(p ->> 'employeeCode'))), '{}') into v_codes
    from jsonb_array_elements(v_people) p where nullif(btrim(p ->> 'employeeCode'), '') is not null;
  foreach t in array v_tabs loop
    j := 0;
    for x in select * from jsonb_array_elements(coalesce(_workbook -> t, '[]'::jsonb)) loop
      j := j + 1;
      if not (lower(btrim(coalesce(x ->> 'employeeCode', ''))) = any (v_codes)) then
        v_problems := v_problems || jsonb_build_object('tab', t, 'row', j, 'column', 'employeeCode',
                                                       'code', 'NOT_ON_PEOPLE');
      end if;
    end loop;
  end loop;
  v_codes := '{}';

  -- ── each person, through the card's own writers.
  i := 0;
  for r in select * from jsonb_array_elements(v_people) loop
    i := i + 1;
    v_mine := '[]'::jsonb;
    v_code := nullif(btrim(coalesce(r ->> 'employeeCode', '')), '');
    v_email := nullif(lower(btrim(coalesce(r ->> 'email', ''))), '');

    -- Inside the file. The database catches a clash with the company; only
    -- this catches a clash with an earlier row of a dry run, which is rolled
    -- back before the later one is tried.
    if v_code is null then
      v_mine := v_mine || jsonb_build_object('column', 'employeeCode', 'code', 'REQUIRED');
    elsif lower(v_code) = any (v_codes) then
      v_mine := v_mine || jsonb_build_object('column', 'employeeCode', 'code', 'TWICE_IN_FILE');
    elsif exists (select 1 from public.employees where organization_id = v_org
                   and lower(employee_code) = lower(v_code) and deleted_at is null) then
      v_mine := v_mine || jsonb_build_object('column', 'employeeCode', 'code', 'CODE_TAKEN');
    end if;
    if v_email is not null and v_email = any (v_emails) then
      v_mine := v_mine || jsonb_build_object('column', 'email', 'code', 'TWICE_IN_FILE');
    end if;
    if v_code is not null then v_codes := v_codes || lower(v_code); end if;
    if v_email is not null then v_emails := v_emails || v_email; end if;

    begin  -- the person: everything below is undone unless it is kept
      v_id := null;
      begin
        v_section := 'person';
        if nullif(btrim(r ->> 'department'), '') is not null then
          select id into v_ref from public.departments where organization_id = v_org
             and lower(btrim(name)) = lower(btrim(r ->> 'department')) and deleted_at is null limit 1;
          if v_ref is null then raise exception 'UNKNOWN_DEPARTMENT' using detail = 'department'; end if;
        end if;
        if nullif(btrim(r ->> 'reportsToEmail'), '') is not null
           and not exists (select 1 from public.profiles where organization_id = v_org
                            and lower(email) = lower(btrim(r ->> 'reportsToEmail')) and deleted_at is null) then
          raise exception 'MANAGER_NOT_FOUND' using detail = 'reportsToEmail';
        end if;
        v_id := public.employee_create_draft(jsonb_strip_nulls(jsonb_build_object(
          'fullName', nullif(btrim(coalesce(r ->> 'fullName', '')), ''),
          'email', v_email,
          'phone', nullif(btrim(coalesce(r ->> 'mobile', '')), ''),
          'joinedDate', nullif(btrim(coalesce(r ->> 'joinedDate', '')), ''),
          'departmentId', (select id from public.departments where organization_id = v_org
                            and lower(btrim(name)) = lower(btrim(r ->> 'department')) and deleted_at is null limit 1),
          'managerId', (select id from public.profiles where organization_id = v_org
                         and lower(email) = lower(btrim(r ->> 'reportsToEmail')) and deleted_at is null limit 1))));
      exception when others then
        get stacked diagnostics v_detail = pg_exception_detail;
        v_mine := v_mine || jsonb_build_object('section', v_section, 'column', nullif(v_detail, ''),
                                               'code', split_part(sqlerrm, ':', 1));
      end;

      if v_id is not null then
        -- the record's own fields
        begin
          v_section := 'record';
          if nullif(btrim(r ->> 'designation'), '') is not null then
            select id into v_ref from public.designations where organization_id = v_org
               and lower(btrim(name)) = lower(btrim(r ->> 'designation')) and status = 'active'
               and deleted_at is null limit 1;
            if v_ref is null then raise exception 'UNKNOWN_DESIGNATION' using detail = 'designation'; end if;
          else
            v_ref := null;
          end if;
          x := public.employee_import_pick(r, '{"employeeCode":"employeeCode","nameAsPerId":"nameAsPerId",
                 "sex":"sex","dateOfBirth":"dateOfBirth","maritalStatus":"maritalStatus",
                 "nationality":"nationality","nativeState":"nativeState","bloodGroup":"bloodGroup",
                 "educationQualification":"educationQualification","alternateMobile":"alternateMobile",
                 "personalEmail":"personalEmail","employmentType":"employmentType",
                 "reJoiningDate":"reJoiningDate","confirmedOn":"confirmedOn",
                 "reasonForLeavingLastOrg":"reasonForLeavingLastOrg","heightCm":"heightCm",
                 "chestCm":"chestCm","weightKg":"weightKg","nearestPoliceStation":"nearestPoliceStation",
                 "emergencyContactName":"emergencyContactName",
                 "emergencyContactRelation":"emergencyContactRelation",
                 "emergencyContactPhone":"emergencyContactPhone"}'::jsonb);
          if v_ref is not null then x := x || jsonb_build_object('designationId', v_ref); end if;
          if x <> '{}'::jsonb then perform public.employee_update(v_id, x); end if;
        exception when others then
          get stacked diagnostics v_detail = pg_exception_detail;
          v_mine := v_mine || jsonb_build_object('section', v_section, 'column', nullif(v_detail, ''),
                                                 'code', split_part(sqlerrm, ':', 1));
        end;

        -- addresses: present, and permanent unless it is the same
        foreach t in array array['present', 'permanent'] loop
          begin
            v_section := t || 'Address';
            if t = 'permanent' and lower(coalesce(r ->> 'permanentSameAsPresent', '')) in ('true','yes','y') then
              continue;
            end if;
            if nullif(btrim(coalesce(r ->> (t || 'Line'), '')), '') is not null then
              perform public.employee_add_address(v_id, jsonb_strip_nulls(jsonb_build_object(
                'addressType', t,
                'effectiveFrom', coalesce(nullif(btrim(r ->> 'presentFrom'), ''),
                                          nullif(btrim(r ->> 'joinedDate'), ''),
                                          public.org_today(v_org)::text),
                'line', r ->> (t || 'Line'), 'city', r ->> (t || 'City'),
                'district', r ->> (t || 'District'), 'state', r ->> (t || 'State'),
                'pincode', r ->> (t || 'Pincode'),
                'alsoPermanent', case when t = 'present'
                                      and lower(coalesce(r ->> 'permanentSameAsPresent', '')) in ('true','yes','y')
                                      then true end)));
            end if;
          exception when others then
            get stacked diagnostics v_detail = pg_exception_detail;
            v_mine := v_mine || jsonb_build_object('section', v_section, 'column', nullif(v_detail, ''),
                                                   'code', split_part(sqlerrm, ':', 1));
          end;
        end loop;

        -- the posting
        begin
          v_section := 'posting';
          if nullif(btrim(r ->> 'deployedUnit'), '') is not null then
            select id into v_ref from public.deployment_units where organization_id = v_org
               and lower(btrim(name)) = lower(btrim(r ->> 'deployedUnit')) and status = 'active'
               and deleted_at is null limit 1;
            if v_ref is null then raise exception 'UNKNOWN_UNIT' using detail = 'deployedUnit'; end if;
            perform public.employee_move_unit(v_id, jsonb_build_object(
              'unitId', v_ref,
              'effectiveFrom', coalesce(nullif(btrim(r ->> 'deployedFrom'), ''), nullif(btrim(r ->> 'joinedDate'), '')),
              'orderRef', btrim(coalesce(r ->> 'deploymentOrderRef', ''))));
          end if;
        exception when others then
          get stacked diagnostics v_detail = pg_exception_detail;
          v_mine := v_mine || jsonb_build_object('section', v_section, 'column', nullif(v_detail, ''),
                                                 'code', split_part(sqlerrm, ':', 1));
        end;

        -- statutory numbers, bank, restricted: encrypted by their writers
        begin
          v_section := 'statutory';
          x := public.employee_import_pick(r, '{"identityDocumentType":"identityDocumentType",
                 "aadhaar":"aadhaar","pan":"pan","uan":"uan","epfNumber":"epfNumber",
                 "esicNumber":"esicNumber","oldUan":"oldUan","oldEsicNumber":"oldEsicNumber"}'::jsonb);
          if x <> '{}'::jsonb then perform public.employee_set_statutory(v_id, x); end if;
        exception when others then
          get stacked diagnostics v_detail = pg_exception_detail;
          v_mine := v_mine || jsonb_build_object('section', v_section, 'column', nullif(v_detail, ''),
                                                 'code', split_part(sqlerrm, ':', 1));
        end;
        begin
          v_section := 'bank';
          x := public.employee_import_pick(r, '{"bankName":"bankName","branch":"branch",
                 "account":"account","ifsc":"ifsc","accountHolder":"accountHolder"}'::jsonb);
          if x <> '{}'::jsonb then perform public.employee_set_bank(v_id, x); end if;
        exception when others then
          get stacked diagnostics v_detail = pg_exception_detail;
          v_mine := v_mine || jsonb_build_object('section', v_section, 'column', nullif(v_detail, ''),
                                                 'code', split_part(sqlerrm, ':', 1));
        end;
        begin
          v_section := 'restricted';
          x := public.employee_import_pick(r, '{"religion":"religion","casteCategory":"casteCategory",
                 "disabilityStatus":"disabilityStatus","disabilityPercent":"disabilityPercent"}'::jsonb);
          if x <> '{}'::jsonb then perform public.employee_set_restricted(v_id, x); end if;
        exception when others then
          get stacked diagnostics v_detail = pg_exception_detail;
          v_mine := v_mine || jsonb_build_object('section', v_section, 'column', nullif(v_detail, ''),
                                                 'code', split_part(sqlerrm, ':', 1));
        end;

        -- family: every row naming this person, any number
        begin
          v_section := 'family';
          select coalesce(jsonb_agg(public.employee_import_pick(f,
                   '{"relation":"relation","name":"name","dateOfBirth":"dateOfBirth","isDependent":"isDependent"}'::jsonb)
                   order by ord), '[]'::jsonb)
            into v_rows
            from jsonb_array_elements(coalesce(_workbook -> 'family', '[]'::jsonb)) with ordinality as e(f, ord)
           where lower(btrim(coalesce(f ->> 'employeeCode', ''))) = lower(v_code);
          if jsonb_array_length(v_rows) > 0 then perform public.employee_save_family(v_id, v_rows); end if;
        exception when others then
          get stacked diagnostics v_detail = pg_exception_detail;
          v_mine := v_mine || jsonb_build_object('section', v_section, 'column', nullif(v_detail, ''),
                                                 'code', split_part(sqlerrm, ':', 1));
        end;

        -- nominees: one nomination per scheme
        for t in
          select distinct coalesce(nullif(btrim(n ->> 'scheme'), ''), 'pf_and_gratuity')
            from jsonb_array_elements(coalesce(_workbook -> 'nominees', '[]'::jsonb)) n
           where lower(btrim(coalesce(n ->> 'employeeCode', ''))) = lower(v_code)
        loop
          begin
            v_section := 'nominees';
            select coalesce(jsonb_agg(public.employee_import_pick(n,
                     '{"name":"name","relation":"relation","dateOfBirth":"dateOfBirth","sharePercent":"sharePercent"}'::jsonb)
                     order by ord), '[]'::jsonb)
              into v_rows
              from jsonb_array_elements(coalesce(_workbook -> 'nominees', '[]'::jsonb)) with ordinality as e(n, ord)
             where lower(btrim(coalesce(n ->> 'employeeCode', ''))) = lower(v_code)
               and coalesce(nullif(btrim(n ->> 'scheme'), ''), 'pf_and_gratuity') = t;
            perform public.employee_save_nomination(v_id, jsonb_strip_nulls(jsonb_build_object(
              'scheme', t,
              'effectiveFrom', nullif(btrim(coalesce(r ->> 'joinedDate', '')), ''),
              'nominees', v_rows)));
          exception when others then
            get stacked diagnostics v_detail = pg_exception_detail;
            v_mine := v_mine || jsonb_build_object('section', v_section, 'column', coalesce(nullif(v_detail, ''), t),
                                                   'code', split_part(sqlerrm, ':', 1));
          end;
        end loop;

        -- previous employment
        begin
          v_section := 'previous';
          select coalesce(jsonb_agg(public.employee_import_pick(p,
                   '{"organisationName":"organisationName","designation":"designation","fromDate":"fromDate",
                     "toDate":"toDate","reasonForLeaving":"reasonForLeaving"}'::jsonb)
                   order by ord), '[]'::jsonb)
            into v_rows
            from jsonb_array_elements(coalesce(_workbook -> 'previous', '[]'::jsonb)) with ordinality as e(p, ord)
           where lower(btrim(coalesce(p ->> 'employeeCode', ''))) = lower(v_code);
          if jsonb_array_length(v_rows) > 0 then perform public.employee_save_previous_orgs(v_id, v_rows); end if;
        exception when others then
          get stacked diagnostics v_detail = pg_exception_detail;
          v_mine := v_mine || jsonb_build_object('section', v_section, 'column', nullif(v_detail, ''),
                                                 'code', split_part(sqlerrm, ':', 1));
        end;
      end if;

      -- Variables survive a rollback; writes do not. A dry run, or a person
      -- with any problem, keeps nothing.
      if not _commit or jsonb_array_length(v_mine) > 0 then
        raise exception 'UNDO_PERSON';
      end if;
      v_created := v_created + 1;
    exception when others then
      if sqlerrm <> 'UNDO_PERSON' then
        v_mine := v_mine || jsonb_build_object('section', 'person', 'code', split_part(sqlerrm, ':', 1));
      end if;
    end;

    if jsonb_array_length(v_mine) > 0 then
      v_skipped := v_skipped + 1;
      select v_problems || coalesce(jsonb_agg(p || jsonb_build_object('tab', 'people', 'row', i,
                                                                       'employeeCode', v_code)), '[]'::jsonb)
        into v_problems
        from jsonb_array_elements(v_mine) p;
    end if;
  end loop;

  if _commit and jsonb_array_length(v_problems) > 0 and not _only_clean then
    raise exception 'ROWS_NEED_ATTENTION' using errcode = 'P0001',
      detail = jsonb_array_length(v_problems)::text;
  end if;

  if _commit and v_created > 0 then
    insert into public.analytics_events (organization_id, user_id, event, properties)
    values (v_org, (select auth.uid()), 'employee.imported',
            jsonb_build_object('created', v_created, 'skipped', v_skipped, 'template', 'master'));
  end if;

  return jsonb_build_object(
    'people', jsonb_array_length(v_people),
    'created', case when _commit then v_created else 0 end,
    'ready', case when _commit then 0 else jsonb_array_length(v_people) - v_skipped end,
    'skipped', v_skipped,
    'problems', v_problems);
end $$;

comment on function public.employee_import_master is
  'D86 — brings a workforce in from the master template as drafts, every section through the card''s own writers. _commit false is a dry run that keeps nothing. New people only. Employee Admin.';

revoke all on function public.employee_import_master(jsonb, boolean, boolean) from public, anon;
grant execute on function public.employee_import_master(jsonb, boolean, boolean) to authenticated;
