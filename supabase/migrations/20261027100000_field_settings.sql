-- Sada's fifth round (D107): the company decides which fields are required,
-- and which the person may change on their own card.
--
-- Fields and visibility listed every field with a fixed Required and
-- Employee can edit. Both are now the company's to set, and only its Super
-- Admin may set them (D78: the tier above the administrators). Neither is a
-- label: the database refuses what they refuse.
--
--   Required = Yes             a save that leaves the field empty is refused,
--                              on the screen and here. FIELD_REQUIRED names it.
--   Employees can update = Yes the person changes it on their own card and it
--                              is saved straight away, no approval (Sada,
--                              13 Oct 2026). Every change is in the audit log,
--                              as every change already is. Anything left at No
--                              is still theirs to ask for with Request a change.
--
-- Some answers are fixed and say why: a worked-out value is never typed; the
-- company's own facts (designation, unit, reporting line) are not the
-- person's to change; statutory, bank and restricted numbers are set by the
-- roles responsible for them. Who SEES a field is still not a setting (§5).
--
--   employee_field_defaults()                    the 57 fields, Neuvto's answers
--   employee_field_settings()                    the company's answers, for anyone in it
--   employee_save_field_setting(key, which, yes) Super Admin only

-- ═══════════════════════════════════════════════════════ 1 · the fields

/**
 * One row per Fields and visibility row, in its order. `payload` is the keys
 * the record's save functions take for it; a field the person adds as a whole
 * record (an address, a relative, a nomination) has none and is checked by
 * that record's own function. A lock says why the answer is fixed, as one of
 * the reasons the screen words (fieldSettings.ts):
 *
 *   derived   worked out by Neuvto, never typed
 *   company   the company's own fact, not the person's
 *   always    every record has one
 *   record    a whole record, not one box; the onboarding checklist asks for it
 *   numbers   set by the Statutory, Payroll and Employee Admin roles
 *   apart     kept apart from the person's own card
 *   invite    set when the person is invited
 *   some      not everybody has one
 *   together  changed with the nomination, as a whole
 *
 * `follows` names the field whose Employees can update this one shares.
 */
create or replace function public.employee_field_defaults()
returns table (field_key text, label text, payload text[], sort smallint,
               required boolean, required_lock text,
               employee_can_update boolean, update_lock text, follows text)
language sql
immutable
set search_path = public
as $$
  with f(field_key, label, payload, sort, required, rl, can, ul, follows) as (values
    ('employeeCode',           'Employee ID',              array['employeeCode'],         1,  true,  null,      false, 'company', null),
    ('fullName',               'Employee name',            array['fullName'],             2,  true,  'always',  false, null,      null),
    ('nameAsPerId',            'Name as printed on ID',    array['nameAsPerId'],          3,  true,  null,      false, null,      null),
    ('sex',                    'Sex',                      array['sex'],                  4,  true,  null,      false, null,      null),
    ('dateOfBirth',            'Date of birth',            array['dateOfBirth'],          5,  true,  null,      false, null,      null),
    ('age',                    'Age',                      '{}'::text[],                  6,  false, 'derived', false, 'derived', null),
    ('maritalStatus',          'Marital status',           array['maritalStatus'],        7,  true,  null,      false, null,      null),
    ('nationality',            'Nationality',              array['nationality'],          8,  true,  null,      false, null,      null),
    ('nativeState',            'Native state',             array['nativeState'],          9,  false, null,      true,  null,      null),
    ('bloodGroup',             'Blood group',              array['bloodGroup'],           10, false, null,      true,  null,      null),
    ('educationQualification', 'Education qualification',  array['educationQualification'], 11, true, null,    false, null,      null),
    ('mobile',                 'Mobile number',            array['mobile'],               12, true,  null,      true,  null,      null),
    ('alternateMobile',        'Alternate mobile number',  array['alternateMobile'],      13, false, null,      true,  null,      null),
    ('workEmail',              'Work email',               '{}'::text[],                  14, true,  'invite',  false, 'invite',  null),
    ('personalEmail',          'Personal email',           array['personalEmail'],        15, false, null,      true,  null,      null),
    ('emergencyContact',       'Emergency contact',
       array['emergencyContactName','emergencyContactRelation','emergencyContactPhone'],   16, true,  null,      true,  null,      null),
    ('nearestPoliceStation',   'Nearest police station',   array['nearestPoliceStation'], 17, false, null,      true,  null,      null),
    ('presentAddress',         'Present address',          '{}'::text[],                  18, true,  'record',  true,  null,      null),
    ('permanentAddress',       'Permanent address',        '{}'::text[],                  19, true,  'record',  true,  null,      null),
    ('addressHistory',         'Address history',          '{}'::text[],                  20, false, 'derived', false, 'derived', null),
    ('designation',            'Designation',              array['designationId'],        21, true,  null,      false, 'company', null),
    ('dateOfJoining',          'Date of joining',          '{}'::text[],                  22, true,  'always',  false, 'company', null),
    ('reJoiningDate',          'Re-joining date',          array['reJoiningDate'],        23, false, null,      false, 'company', null),
    ('status',                 'Status',                   array['status'],               24, true,  'always',  false, 'company', null),
    ('termination',            'Employment termination',
       array['terminationDate','terminationReason'],                                      25, false, 'some',    false, 'company', null),
    ('totalExperience',        'Total experience',         array['priorExperienceMonths'], 26, false, 'derived', false, 'derived', null),
    ('reasonForLeavingLastOrg','Reason for leaving last org', array['reasonForLeavingLastOrg'], 27, false, null, false, null,     null),
    ('reportsTo',              'Reports to',               array['managerId'],            28, true,  null,      false, 'company', null),
    ('deployedUnit',           'Deployed unit',            '{}'::text[],                  29, true,  'record',  false, 'company', null),
    ('deploymentHistory',      'Deployment history',       '{}'::text[],                  30, false, 'derived', false, 'derived', null),
    ('father',                 'Father name and DOB',      '{}'::text[],                  31, false, 'some',    true,  null,      null),
    ('mother',                 'Mother name and DOB',      '{}'::text[],                  32, false, 'some',    true,  null,      null),
    ('husband',                'Husband name and DOB',     '{}'::text[],                  33, false, 'some',    true,  null,      null),
    ('wife',                   'Wife name and DOB',        '{}'::text[],                  34, false, 'some',    true,  null,      null),
    ('sons',                   'Sons',                     '{}'::text[],                  35, false, 'some',    true,  null,      null),
    ('daughters',              'Daughters',                '{}'::text[],                  36, false, 'some',    true,  null,      null),
    ('otherRelatives',         'Other relatives',          '{}'::text[],                  37, false, 'some',    true,  null,      null),
    ('nomineeName',            'Nominee name and relation', '{}'::text[],                 38, true,  'always',  true,  null,      null),
    ('nomineeDob',             'Nominee date of birth',    '{}'::text[],                  39, false, null,      true,  'together', 'nomineeName'),
    ('nomineeShare',           'Nominee share percentage', '{}'::text[],                  40, true,  'always',  true,  'together', 'nomineeName'),
    ('uan',                    'UAN',                      array['uan'],                  41, true,  null,      false, 'numbers', null),
    ('epfNumber',              'EPF number',               array['epfNumber'],            42, true,  null,      false, 'numbers', null),
    ('esicNumber',             'ESIC number',              array['esicNumber'],           43, true,  null,      false, 'numbers', null),
    ('oldUan',                 'Old EPF UAN',              array['oldUan'],               44, false, null,      false, 'numbers', null),
    ('oldEsicNumber',          'Old ESIC number',          array['oldEsicNumber'],        45, false, null,      false, 'numbers', null),
    ('drivingLicence',         'Driving licence number',   array['drivingLicence'], 46, false, null, false, 'numbers', null),
    ('aadhaar',                'Aadhaar number',           array['aadhaar'],              47, true,  null,      false, 'numbers', null),
    ('pan',                    'PAN',                      array['pan'],                  48, false, null,      false, 'numbers', null),
    ('bankAccount',            'Bank account number',      array['account'], 49, true, null,    false, 'numbers', null),
    ('ifsc',                   'IFSC code',                array['ifsc'],                 50, true,  null,      false, 'numbers', null),
    ('bankName',               'Bank name',                array['bankName'],             51, false, 'derived', false, 'derived', null),
    ('branch',                 'Branch name',              array['branch'],               52, false, 'derived', false, 'derived', null),
    ('physical',               'Height, chest, weight',    array['heightCm','chestCm','weightKg'], 53, false, null, false, null, null),
    ('religion',               'Religion',                 array['religion'],             54, false, null,      false, 'apart',   null),
    ('casteCategory',          'Caste category',           array['casteCategory'],        55, false, null,      false, 'apart',   null),
    ('disability',             'Physically handicapped',   array['disabilityStatus','disabilityPercent'], 56, false, null, false, 'apart', null),
    ('previousOrganisations',  'Previous organisations',   '{}'::text[],                  57, false, 'some',    false, null,      null)
  )
  select f.field_key, f.label, f.payload, f.sort::smallint, f.required, f.rl, f.can, f.ul, f.follows
    from f
$$;

grant execute on function public.employee_field_defaults() to authenticated;

-- ═══════════════════════════════════════════════════════ 2 · the company's answers

create table public.employee_field_settings (
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  field_key           text not null,
  required            boolean,
  employee_can_update boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  primary key (organization_id, field_key)
);

comment on table public.employee_field_settings is
  'D107: a company''s own Required and Employees can update, per field of employee_field_defaults(). Null keeps Neuvto''s answer. Written only by employee_save_field_setting(), by a Super Admin.';

create trigger set_audit_fields before insert or update on public.employee_field_settings
  for each row execute function public.set_audit_fields();
create trigger write_audit_log after insert or update or delete on public.employee_field_settings
  for each row execute function public.write_audit_log();
alter table public.employee_field_settings enable row level security;
revoke all on public.employee_field_settings from anon, authenticated;

/** The answers in force for a company: its own where it has one, else Neuvto's. Locked answers never move. */
create or replace function public.employee_field_rules(_org uuid)
returns table (field_key text, label text, payload text[], sort smallint,
               required boolean, required_lock text,
               employee_can_update boolean, update_lock text, customised boolean)
language sql
stable
security definer
set search_path = public
as $$
  with mine as (
    select d.*, s.required as s_req, s.employee_can_update as s_can, s.organization_id is not null as has
      from public.employee_field_defaults() d
      left join public.employee_field_settings s
        on s.organization_id = _org and s.field_key = d.field_key
  )
  select m.field_key, m.label, m.payload, m.sort,
         case when m.required_lock is null then coalesce(m.s_req, m.required) else m.required end,
         m.required_lock,
         case when m.follows is not null then
                (select case when l.update_lock is null then coalesce(l.s_can, l.employee_can_update)
                             else l.employee_can_update end
                   from mine l where l.field_key = m.follows)
              when m.update_lock is null then coalesce(m.s_can, m.employee_can_update)
              else m.employee_can_update end,
         m.update_lock,
         m.has
    from mine m
$$;

revoke all on function public.employee_field_rules(uuid) from public, anon, authenticated;

/**
 * Everybody in the company may read the answers: the person's card needs them
 * to offer Edit, and they are the company's rules, not anybody's record.
 * `can_change` is whether the caller may change them: a Super Admin.
 */
create or replace function public.employee_field_settings()
returns table (field_key text, label text, required boolean, required_lock text,
               employee_can_update boolean, update_lock text, customised boolean,
               can_change boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_org uuid := public.current_org_id();
begin
  if (select auth.uid()) is null or v_org is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;
  if not public.module_enabled_for(v_org, 'employee') then
    raise exception 'MODULE_NOT_ENABLED' using errcode = 'P0001';
  end if;
  return query
    select r.field_key, r.label, r.required, r.required_lock, r.employee_can_update,
           r.update_lock, r.customised, public.is_super_admin()
      from public.employee_field_rules(v_org) r
     order by r.sort;
end $$;

revoke all on function public.employee_field_settings() from public, anon;
grant execute on function public.employee_field_settings() to authenticated;

create or replace function public.employee_save_field_setting(_field_key text, _setting text, _value boolean)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  v_d   record;
begin
  if (select auth.uid()) is null or v_org is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;
  if not public.module_enabled_for(v_org, 'employee') then
    raise exception 'MODULE_NOT_ENABLED' using errcode = 'P0001';
  end if;
  if not public.is_super_admin() then
    raise exception 'SUPER_ADMIN_ONLY' using errcode = '42501';
  end if;
  select * into v_d from public.employee_field_defaults() d where d.field_key = _field_key;
  if not found then
    raise exception 'UNKNOWN_FIELD' using errcode = 'P0001', detail = _field_key;
  end if;
  if _value is null or _setting is null or _setting not in ('required', 'employeeCanUpdate') then
    raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'setting';
  end if;
  if (_setting = 'required' and v_d.required_lock is not null)
     or (_setting = 'employeeCanUpdate' and v_d.update_lock is not null) then
    raise exception 'FIELD_LOCKED' using errcode = 'P0001', detail = v_d.label;
  end if;

  insert into public.employee_field_settings (organization_id, field_key, required, employee_can_update)
  values (v_org, _field_key,
          case when _setting = 'required' then _value end,
          case when _setting = 'employeeCanUpdate' then _value end)
  on conflict (organization_id, field_key) do update set
    required = case when _setting = 'required' then _value else employee_field_settings.required end,
    employee_can_update = case when _setting = 'employeeCanUpdate' then _value
                               else employee_field_settings.employee_can_update end;
end $$;

revoke all on function public.employee_save_field_setting(text, text, boolean) from public, anon;
grant execute on function public.employee_save_field_setting(text, text, boolean) to authenticated;

-- ═══════════════════════════════════════════════════════ 3 · the checks

/** The field each key of a save belongs to; null for a key no person may set. */
create or replace function public.employee_field_keys(_values jsonb)
returns text[]
language sql
immutable
set search_path = public
as $$
  select coalesce(array_agg((select d.field_key from public.employee_field_defaults() d
                              where k = any (d.payload))), '{}')
    from jsonb_object_keys(coalesce(_values, '{}'::jsonb)) k
$$;

revoke all on function public.employee_field_keys(jsonb) from public, anon, authenticated;

/**
 * Who may write these fields of this record: the Employee Admin, any of them;
 * the person, only those their company lets them update. Anybody else, as
 * before, FORBIDDEN.
 */
create or replace function public.employee_require_writer(_employee_id uuid, _fields text[])
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rel text[] := public.restricted_target(_employee_id);
  v_no  text;
begin
  if 'admin' = any (v_rel) then
    return;
  end if;
  if not ('self' = any (v_rel)) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select coalesce(r.label, 'That') into v_no
    from unnest(coalesce(_fields, '{}')) f
    left join public.employee_field_rules(public.current_org_id()) r on r.field_key = f
   where r.employee_can_update is not true
   limit 1;
  if found then
    raise exception 'NOT_YOURS_TO_CHANGE' using errcode = '42501', detail = v_no;
  end if;
end $$;

revoke all on function public.employee_require_writer(uuid, text[]) from public, anon, authenticated;

/** A save may not empty a field the company requires. Names the field. */
create or replace function public.employee_require_filled(_employee_id uuid, _values jsonb)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_label text;
begin
  select r.label into v_label
    from jsonb_each(coalesce(_values, '{}'::jsonb)) kv
    join public.employee_field_rules(
           (select organization_id from public.employees where id = _employee_id)) r
      on kv.key = any (r.payload)
   where r.required
     and (jsonb_typeof(kv.value) = 'null' or btrim(kv.value #>> '{}') = '')
   order by r.sort
   limit 1;
  if v_label is not null then
    raise exception 'FIELD_REQUIRED' using errcode = 'P0001', detail = v_label;
  end if;
end $$;

revoke all on function public.employee_require_filled(uuid, jsonb) from public, anon, authenticated;

/** Whether the company requires a field, for checks made row by row. */
create or replace function public.employee_field_required(_employee_id uuid, _field_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select r.required from public.employee_field_rules(
                     (select organization_id from public.employees where id = _employee_id)) r
                    where r.field_key = _field_key), false)
$$;

revoke all on function public.employee_field_required(uuid, text) from public, anon, authenticated;

/** A relation's field: father, mother, husband, wife, sons, daughters, or the rest. */
create or replace function public.employee_relation_field(_relation text)
returns text
language sql
immutable
set search_path = public
as $$
  select case _relation
           when 'father' then 'father' when 'mother' then 'mother'
           when 'husband' then 'husband' when 'wife' then 'wife'
           when 'son' then 'sons' when 'daughter' then 'daughters'
           else 'otherRelatives' end
$$;

revoke all on function public.employee_relation_field(text) from public, anon, authenticated;

/**
 * The relatives a family save changes: each one added, removed or edited, by
 * its relation before and after. Rows sent back as they are change nothing,
 * so a person allowed only their children may still save the list with their
 * parents in it, untouched.
 */
create or replace function public.employee_family_fields_touched(_employee_id uuid, _rows jsonb)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  with incoming as (
    select nullif(r ->> 'id', '') as id, r ->> 'relation' as relation, btrim(coalesce(r ->> 'name', '')) as name,
           nullif(r ->> 'dateOfBirth', '') as dob, coalesce((r ->> 'isDependent'), 'true') as dep
      from jsonb_array_elements(case when jsonb_typeof(_rows) = 'array' then _rows else '[]'::jsonb end) r
  ), existing as (
    select f.id::text as id, f.relation, f.name, f.date_of_birth::text as dob, f.is_dependent::text as dep
      from public.family_members f where f.employee_id = _employee_id
  )
  select coalesce(array_agg(distinct public.employee_relation_field(x.relation)), '{}')
    from (
      select i.relation from incoming i where i.id is null
      union all
      select e.relation from existing e where e.id not in (select id from incoming where id is not null)
      union all
      select unnest(array[e.relation, i.relation])
        from incoming i join existing e on e.id = i.id
       where (e.relation, e.name, coalesce(e.dob, ''), e.dep)
             is distinct from (i.relation, i.name, coalesce(i.dob, ''), i.dep)
    ) x
$$;

revoke all on function public.employee_family_fields_touched(uuid, jsonb) from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════ 4 · the save functions

do $$
declare
  v_def  text;
  v_new  text;
  v_admin text := 'perform public.employee_require_admin(_employee_id);';
begin
  -- The record's own fields: the person may write those switched on for them.
  v_def := pg_get_functiondef('public.employee_update(uuid,jsonb)'::regprocedure);
  if position(v_admin in v_def) = 0
     or position('perform public.restricted_known_keys(_values, v_known);' in v_def) = 0 then
    raise exception 'employee_update no longer checks as expected; restate it here';
  end if;
  v_new := replace(v_def, v_admin,
    'perform public.employee_require_writer(_employee_id, public.employee_field_keys(_values));');
  v_new := replace(v_new, 'perform public.restricted_known_keys(_values, v_known);',
    'perform public.restricted_known_keys(_values, v_known);
  perform public.employee_require_filled(_employee_id, _values);');
  execute v_new;

  -- An address, by its type: present, permanent, or both at once.
  v_def := pg_get_functiondef('public.employee_add_address(uuid,jsonb)'::regprocedure);
  if position(v_admin in v_def) = 0 then
    raise exception 'employee_add_address no longer checks as expected; restate it here';
  end if;
  execute replace(v_def, v_admin, $q$perform public.employee_require_writer(_employee_id,
    array[case _values ->> 'addressType' when 'present' then 'presentAddress'
                                         when 'permanent' then 'permanentAddress' end]
    || case when _values ->> 'alsoPermanent' = 'true' then array['permanentAddress'] else '{}'::text[] end);$q$);

  -- Family, by the relatives the save changes.
  v_def := pg_get_functiondef('public.employee_save_family(uuid,jsonb)'::regprocedure);
  if position(v_admin in v_def) = 0 then
    raise exception 'employee_save_family no longer checks as expected; restate it here';
  end if;
  execute replace(v_def, v_admin,
    'perform public.employee_require_writer(_employee_id, public.employee_family_fields_touched(_employee_id, _rows));');

  -- A nomination, as a whole; and each nominee's date of birth, if required.
  v_def := pg_get_functiondef('public.employee_save_nomination(uuid,jsonb)'::regprocedure);
  if position(v_admin in v_def) = 0 then
    raise exception 'employee_save_nomination no longer checks as expected; restate it here';
  end if;
  execute replace(v_def, v_admin, $q$perform public.employee_require_writer(_employee_id, array['nomineeName']);
  if public.employee_field_required(_employee_id, 'nomineeDob') and exists (
       select 1 from jsonb_array_elements(case when jsonb_typeof(_values -> 'nominees') = 'array'
                                               then _values -> 'nominees' else '[]'::jsonb end) n
        where nullif(btrim(coalesce(n ->> 'dateOfBirth', '')), '') is null) then
    raise exception 'FIELD_REQUIRED' using errcode = 'P0001', detail = 'Nominee date of birth';
  end if;$q$);

  v_def := pg_get_functiondef('public.employee_save_previous_orgs(uuid,jsonb)'::regprocedure);
  if position(v_admin in v_def) = 0 then
    raise exception 'employee_save_previous_orgs no longer checks as expected; restate it here';
  end if;
  execute replace(v_def, v_admin,
    $q$perform public.employee_require_writer(_employee_id, array['previousOrganisations']);$q$);

  -- The numbers keep their own roles. Required now applies to them too.
  v_def := pg_get_functiondef('public.employee_set_statutory(uuid,jsonb)'::regprocedure);
  v_new := regexp_replace(v_def, '(perform public\.restricted_known_keys\(_values, v_numbers \|\| v_checks\);)',
    E'\\1\n  perform public.employee_require_filled(_employee_id, _values);');
  if v_new = v_def then
    raise exception 'employee_set_statutory no longer checks its keys as expected; restate it here';
  end if;
  execute v_new;

  v_def := pg_get_functiondef('public.employee_set_bank(uuid,jsonb)'::regprocedure);
  v_new := regexp_replace(v_def, '(array\[''bankName'',''branch'',''account'',''ifsc'',''accountHolder'',''pennyDropStatus''\]\);)',
    E'\\1\n  perform public.employee_require_filled(_employee_id, _values);');
  if v_new = v_def then
    raise exception 'employee_set_bank no longer checks its keys as expected; restate it here';
  end if;
  execute v_new;

  v_def := pg_get_functiondef('public.employee_set_restricted(uuid,jsonb)'::regprocedure);
  v_new := regexp_replace(v_def, '(array\[''religion'',''casteCategory'',''disabilityStatus'',''disabilityPercent''\]\);)',
    E'\\1\n  perform public.employee_require_filled(_employee_id, _values);');
  if v_new = v_def then
    raise exception 'employee_set_restricted no longer checks its keys as expected; restate it here';
  end if;
  execute v_new;

  -- The card tells the screen which fields are required, and which the
  -- person may change themselves: by field and by the keys a save takes.
  v_def := pg_get_functiondef('public.employee_card(uuid)'::regprocedure);
  if position($q$'canEdit', admin_,$q$ in v_def) = 0 then
    raise exception 'employee_card has moved its capabilities; restate it here';
  end if;
  execute replace(v_def, $q$'canEdit', admin_,$q$, $q$'canEdit', admin_,
    'requiredFields', case when self_ or admin_ or pay_ or stat_ then coalesce((
       select jsonb_agg(distinct k) from public.employee_field_rules(v_org) r,
              unnest(array[r.field_key] || r.payload) k
        where r.required), '[]'::jsonb) else '[]'::jsonb end,
    'ownFields', case when self_ and not admin_ then coalesce((
       select jsonb_agg(distinct k) from public.employee_field_rules(v_org) r,
              unnest(array[r.field_key] || r.payload) k
        where r.employee_can_update), '[]'::jsonb) else '[]'::jsonb end,$q$);
end $$;
