-- Sada, 4 Nov 2026 (D123): fields as long as they need to be, and no longer.
--
--   1 · A person's full name, the name on their ID and a bank account's holder
--       up to 50; every other name (family, nominees, emergency contact) and
--       every short field of letters (relation, nationality, native state,
--       city, district) or of letters and digits (police station, bank,
--       branch, previous organisation and designation, department) up to 30;
--       a deployment order reference up to 15. Addresses (300),
--       qualifications (200) and reasons (500) keep their limits; so does a
--       state, which is chosen from a list and has a 40-letter union
--       territory. A value already on record is not refused until it is
--       changed: the checks fire only on what a save changes.
--   2 · Two family members with the same name are one person listed twice;
--       Family refuses it (spaces and case do not make two people).
--   3 · Aadhaar is optional by default. A company can still require it.

-- ═══════════════════════════════════════════════════════ 1 · the lengths

do $$
declare
  v_steps text[][] := array[
    array['public.tf_person_fields_are_valid()',   'public.valid_words(new.full_name, 100)',           'public.valid_words(new.full_name, 50)'],
    array['public.tf_employee_fields_are_valid()', 'public.valid_words(new.draft_full_name, 100)',     'public.valid_words(new.draft_full_name, 50)'],
    array['public.tf_employee_fields_are_valid()', 'public.valid_words(new.name_as_per_id, 100)',      'public.valid_words(new.name_as_per_id, 50)'],
    array['public.tf_employee_fields_are_valid()', 'public.valid_words(new.emergency_contact_name, 100)', 'public.valid_words(new.emergency_contact_name, 30)'],
    array['public.tf_employee_fields_are_valid()', 'public.valid_words(new.emergency_contact_relation, 60)', 'public.valid_words(new.emergency_contact_relation, 30)'],
    array['public.tf_employee_fields_are_valid()', 'public.valid_words(new.nationality, 60)',          'public.valid_words(new.nationality, 30)'],
    array['public.tf_employee_fields_are_valid()', 'public.valid_words(new.native_state, 60)',         'public.valid_words(new.native_state, 30)'],
    array['public.tf_employee_fields_are_valid()', 'public.valid_text(new.nearest_police_station, 100)', 'public.valid_text(new.nearest_police_station, 30)'],
    array['public.tf_relative_fields_are_valid()', 'public.valid_words(new.name, 100)',                'public.valid_words(new.name, 30)'],
    array['public.tf_address_fields_are_valid()',  'public.valid_words(new.city, 60)',                 'public.valid_words(new.city, 30)'],
    array['public.tf_address_fields_are_valid()',  'public.valid_words(new.district, 60)',             'public.valid_words(new.district, 30)'],
    array['public.tf_address_fields_are_valid()',  'public.valid_text(new.nearest_police_station, 100)', 'public.valid_text(new.nearest_police_station, 30)'],
    array['public.tf_bank_fields_are_valid()',     'public.valid_words(new.account_holder, 100)',      'public.valid_words(new.account_holder, 50)'],
    array['public.tf_bank_fields_are_valid()',     'public.valid_text(new.bank_name, 100)',            'public.valid_text(new.bank_name, 30)'],
    array['public.tf_bank_fields_are_valid()',     'public.valid_text(new.branch, 100)',               'public.valid_text(new.branch, 30)'],
    array['public.tf_previous_org_fields_are_valid()', 'public.valid_text(new.organisation_name, 200)', 'public.valid_text(new.organisation_name, 30)'],
    array['public.tf_previous_org_fields_are_valid()', 'public.valid_text(new.designation, 100)',      'public.valid_text(new.designation, 30)'],
    array['public.employee_add_department(text)',  'public.valid_text(v_name, 100)',                   'public.valid_text(v_name, 30)']
  ];
  v_def text;
  i integer;
begin
  for i in 1 .. array_length(v_steps, 1) loop
    v_def := pg_get_functiondef(v_steps[i][1]::regprocedure);
    if position(v_steps[i][2] in v_def) = 0 then
      raise exception '% no longer reads % as expected; restate it here', v_steps[i][1], v_steps[i][2];
    end if;
    execute replace(v_def, v_steps[i][2], v_steps[i][3]);
  end loop;
end $$;

-- A deployment order reference, up to 15.
do $$
declare
  v_def text := pg_get_functiondef('public.employee_move_unit(uuid,jsonb)'::regprocedure);
  v_anchor text := $q$  if btrim(coalesce(_values ->> 'orderRef', '')) = '' then
    raise exception 'ORDER_REF_REQUIRED' using errcode = 'P0001';
  end if;$q$;
begin
  if position(v_anchor in v_def) = 0 then
    raise exception 'employee_move_unit no longer reads as expected; restate it here';
  end if;
  execute replace(v_def, v_anchor, v_anchor || $q$
  -- D123. An order reference is up to 15 characters.
  if char_length(btrim(_values ->> 'orderRef')) > 15 then
    raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'order_ref_length';
  end if;$q$);
end $$;

-- A refused bank field names its rule, as every other field does. The save
-- caught the refusal and passed on only its message, "INVALID_VALUE", so the
-- screen could not say which field or why.
do $$
declare
  v_def text := pg_get_functiondef('public.employee_set_bank(uuid,jsonb)'::regprocedure);
  v_old text := $q$  exception when check_violation then
    raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = sqlerrm;$q$;
begin
  if position(v_old in v_def) = 0 or position($q$  v     text;
begin$q$ in v_def) = 0 then
    raise exception 'employee_set_bank no longer reads as expected; restate it here';
  end if;
  v_def := replace(v_def, $q$  v     text;
begin$q$, $q$  v     text;
  v_rule text;
begin$q$);
  execute replace(v_def, v_old, $q$  exception when check_violation then
    get stacked diagnostics v_rule = pg_exception_detail;
    raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = coalesce(nullif(v_rule, ''), sqlerrm);$q$);
end $$;

-- ═══════════════════════════════════════════════════════ 2 · one name, one person

do $$
declare
  v_def text := pg_get_functiondef('public.employee_save_family(uuid,jsonb)'::regprocedure);
  v_anchor text := $q$  if t is not null then
    raise exception 'ONE_PARENT_EACH' using errcode = 'P0001', detail = t;
  end if;$q$;
begin
  if position(v_anchor in v_def) = 0 then
    raise exception 'employee_save_family no longer reads as expected; restate it here';
  end if;
  execute replace(v_def, v_anchor, v_anchor || $q$
  -- D123. Two family members with the same name are one person listed twice.
  select x.k into t
    from (select lower(regexp_replace(btrim(e ->> 'name'), '\s+', ' ', 'g')) as k
            from jsonb_array_elements(_rows) e) x
   where x.k <> ''
   group by x.k having count(*) > 1 limit 1;
  if t is not null then
    raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'family_name_twice';
  end if;$q$);
end $$;

-- ═══════════════════════════════════════════════════════ 3 · Aadhaar is optional

do $$
declare
  v_def text := pg_get_functiondef('public.employee_field_defaults()'::regprocedure);
  v_old text := $q$('aadhaar',                'Aadhaar number',           array['aadhaar'],              47, true,$q$;
begin
  if position(v_old in v_def) = 0 then
    raise exception 'employee_field_defaults no longer names Aadhaar as expected; restate it here';
  end if;
  execute replace(v_def, v_old,
    $q$('aadhaar',                'Aadhaar number',           array['aadhaar'],              47, false,$q$);
end $$;
