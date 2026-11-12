-- Sada, 4 Nov 2026 (D121): what is typed once is not typed again.
--
--   1 · An emergency contact may be a family member. Picked from Family
--       (`employees.emergency_contact_family_member_id`), their name and
--       relation are Family's, and follow Family when it is saved; only the
--       phone is typed, Family keeping none. Typing a name or relation of
--       one's own unlinks them. A family member removed leaves the contact as
--       they were last known.
--   2 · A permanent address the same as the present one is not typed again:
--       the screen copies it (no change here; `alsoPermanent` already does the
--       other way round).
--   3 · The nearest police station is the present address's. Physical record
--       still edits it (D113), on that address, corrected in place: the one
--       change an open address row takes without a successor. Before there is
--       a present address it waits on the record, and the first present
--       address takes it.
--   4 · The reason for leaving the last organisation is the reason on the
--       latest row of Previous organisations: typed in either place, both say
--       it.

-- ═══════════════════════════════════════════════════════ 1 · the emergency contact

alter table public.employees
  add column if not exists emergency_contact_family_member_id uuid
    references public.family_members (id) on delete set null;

comment on column public.employees.emergency_contact_family_member_id is
  'D121: the family member who is the emergency contact. Their name and relation are copied from Family and follow it.';

create index if not exists employees_emergency_contact_family_member_idx
  on public.employees (emergency_contact_family_member_id)
  where emergency_contact_family_member_id is not null;

-- The emergency contact field's permission covers the link.
do $$
declare
  v_def text := pg_get_functiondef('public.employee_field_defaults()'::regprocedure);
  v_old text := $q$array['emergencyContactName','emergencyContactRelation','emergencyContactPhone']$q$;
begin
  if position(v_old in v_def) = 0 then
    raise exception 'employee_field_defaults no longer names the emergency contact as expected; restate it here';
  end if;
  execute replace(v_def, v_old,
    $q$array['emergencyContactName','emergencyContactRelation','emergencyContactPhone','emergencyContactFamilyMemberId']$q$);
end $$;

-- The link is a choice, never required: "somebody not in Family" is an
-- answer, so choosing it is not emptying a required field.
do $$
declare
  v_def text := pg_get_functiondef('public.employee_require_filled(uuid,jsonb)'::regprocedure);
  v_anchor text := $q$   where r.required
$q$;
begin
  if position(v_anchor in v_def) = 0 then
    raise exception 'employee_require_filled no longer reads as expected; restate it here';
  end if;
  execute replace(v_def, v_anchor, v_anchor || $q$     and kv.key <> 'emergencyContactFamilyMemberId'
$q$);
end $$;

-- ═══════════════════════════════════════════════════════ 3 · an open address takes a police station

-- What tf_history_is_append_only did, and one exception: while
-- `neuvto.police_station` names the row, its police station may be corrected.
-- Nothing else on the row, and never on a closed row.
do $$
declare
  v_def text := pg_get_functiondef('public.tf_history_is_append_only()'::regprocedure);
  v_anchor text := $q$  if old.effective_to is not null then$q$;
begin
  if position(v_anchor in v_def) = 0 or position('v_ignored' in v_def) = 0 then
    raise exception 'tf_history_is_append_only no longer reads as expected; restate it here';
  end if;
  execute replace(v_def, v_anchor, $q$  -- D121. The present address's police station, corrected in place.
  if coalesce(current_setting('neuvto.police_station', true), '') = old.id::text then
    v_ignored := v_ignored || 'nearest_police_station'::text;
  end if;

  if old.effective_to is not null then$q$);
end $$;

-- ═══════════════════════════════════════════════════════ 1, 3, 4 · the record's own save

do $$
declare
  v_def text := pg_get_functiondef('public.employee_update(uuid,jsonb)'::regprocedure);
  v_new text := v_def;
  v_steps text[][] := array[
    -- the link is a key the save knows
    array[$q$'emergencyContactName','emergencyContactRelation','emergencyContactPhone',$q$,
          $q$'emergencyContactName','emergencyContactRelation','emergencyContactPhone','emergencyContactFamilyMemberId',$q$],
    array[$q$  t      text := '';
begin
  perform public.employee_require_writer(_employee_id, public.employee_field_keys(_values));$q$,
          $q$  t      text := '';
  v_member public.family_members%rowtype;
  v_addr   uuid;
begin
  -- D121. A family member as the emergency contact: their name and relation
  -- are Family's, whatever else was sent.
  if nullif(_values ->> 'emergencyContactFamilyMemberId', '') is not null then
    begin
      select * into v_member from public.family_members
       where id = (_values ->> 'emergencyContactFamilyMemberId')::uuid and employee_id = _employee_id;
    exception when invalid_text_representation then
      v_member := null;
    end;
    if v_member.id is null then
      raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'emergencyContactFamilyMemberId';
    end if;
    _values := _values || jsonb_build_object('emergencyContactName', v_member.name,
                                             'emergencyContactRelation', v_member.relation);
  end if;
  perform public.employee_require_writer(_employee_id, public.employee_field_keys(_values));$q$],
    array[$q$      emergency_contact_phone = case when _values ? 'emergencyContactPhone' then nullif(btrim(_values ->> 'emergencyContactPhone'), '') else emergency_contact_phone end,$q$,
          $q$      emergency_contact_phone = case when _values ? 'emergencyContactPhone' then nullif(btrim(_values ->> 'emergencyContactPhone'), '') else emergency_contact_phone end,
      -- A name or relation typed for the contact is somebody of one's own.
      emergency_contact_family_member_id = case
        when _values ? 'emergencyContactFamilyMemberId' then nullif(_values ->> 'emergencyContactFamilyMemberId', '')::uuid
        when _values ?| array['emergencyContactName', 'emergencyContactRelation'] then null
        else emergency_contact_family_member_id end,$q$],
    array[$q$    where id = _employee_id;

    if _values ?| array['fullName', 'mobile', 'departmentId', 'managerId'] then$q$,
          $q$    where id = _employee_id;

    -- D121. The police station is the present address's, corrected in place;
    -- the record keeps one only until there is a present address.
    if _values ? 'nearestPoliceStation' then
      select a.id into v_addr from public.employee_addresses a
       where a.employee_id = _employee_id and a.address_type = 'present' and a.effective_to is null;
      if v_addr is not null then
        perform set_config('neuvto.police_station', v_addr::text, true);
        update public.employee_addresses
           set nearest_police_station = nullif(btrim(_values ->> 'nearestPoliceStation'), '')
         where id = v_addr;
        perform set_config('neuvto.police_station', '', true);
        update public.employees set nearest_police_station = null where id = _employee_id;
      end if;
    end if;

    -- D121. The reason for leaving the last organisation is the latest one's.
    if _values ? 'reasonForLeavingLastOrg' then
      update public.previous_organisations
         set reason_for_leaving = nullif(btrim(_values ->> 'reasonForLeavingLastOrg'), '')
       where id = public.employee_latest_previous_org(_employee_id);
    end if;

    if _values ?| array['fullName', 'mobile', 'departmentId', 'managerId'] then$q$]
  ];
  i integer;
begin
  for i in 1 .. array_length(v_steps, 1) loop
    if position(v_steps[i][1] in v_new) = 0 then
      raise exception 'employee_update no longer reads as expected at step %; restate it here', i;
    end if;
    v_new := replace(v_new, v_steps[i][1], v_steps[i][2]);
  end loop;
  -- Defined below; plpgsql resolves it when called, not when created.
  execute v_new;
end $$;

-- ═══════════════════════════════════════════════════════ 4 · the latest organisation

/** The last organisation left: the latest end, then the latest start. */
create or replace function public.employee_latest_previous_org(_employee_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select po.id from public.previous_organisations po
   where po.employee_id = _employee_id
   order by po.to_date desc nulls last, po.from_date desc nulls last, po.created_at desc
   limit 1
$$;

revoke all on function public.employee_latest_previous_org(uuid) from public, anon, authenticated;

do $$
declare
  v_def text := pg_get_functiondef('public.employee_save_previous_orgs(uuid,jsonb)'::regprocedure);
  v_anchor text := $q$  delete from public.previous_organisations where employee_id = _employee_id and id <> all (v_keep);$q$;
begin
  if position(v_anchor in v_def) = 0 then
    raise exception 'employee_save_previous_orgs no longer reads as expected; restate it here';
  end if;
  execute replace(v_def, v_anchor, v_anchor || $q$
  -- D121. The reason for leaving the last organisation is the latest one's,
  -- where it gives one; where it gives none, the one on record stands.
  update public.employees e set reason_for_leaving_last_org = po.reason_for_leaving
    from public.previous_organisations po
   where e.id = _employee_id
     and po.id = public.employee_latest_previous_org(_employee_id)
     and po.reason_for_leaving is not null;$q$);
end $$;

-- ═══════════════════════════════════════════════════════ 1 · Family, saved, is followed

do $$
declare
  v_def text := pg_get_functiondef('public.employee_save_family(uuid,jsonb)'::regprocedure);
  v_anchor text := $q$  -- D117. The current nomination follows its nominees' family details.$q$;
begin
  if position(v_anchor in v_def) = 0 then
    raise exception 'employee_save_family no longer reads as expected; restate it here';
  end if;
  execute replace(v_def, v_anchor, $q$  -- D121. An emergency contact from Family follows Family. One removed was
  -- unlinked by the foreign key, and stays as last known.
  update public.employees e
     set emergency_contact_name = f.name, emergency_contact_relation = f.relation
    from public.family_members f
   where e.id = _employee_id and f.id = e.emergency_contact_family_member_id
     and (e.emergency_contact_name is distinct from f.name
          or e.emergency_contact_relation is distinct from f.relation);
$q$ || v_anchor);
end $$;

-- ═══════════════════════════════════════════════════════ 3 · the first present address

do $$
declare
  v_def text := pg_get_functiondef('public.employee_add_address(uuid,jsonb)'::regprocedure);
  v_new text := v_def;
  v_ins text := $q$btrim(_values ->> 'pincode'), nullif(btrim(_values ->> 'nearestPoliceStation'), ''), v_from$q$;
  v_ret text := $q$      v_ids := v_ids || jsonb_build_object('id', v_id, 'addressType', t);$q$;
begin
  if position(v_ins in v_new) = 0 or position(v_ret in v_new) = 0 then
    raise exception 'employee_add_address no longer reads as expected; restate it here';
  end if;
  -- The first present address takes the police station the record held for it.
  v_new := replace(v_new, v_ins,
    $q$btrim(_values ->> 'pincode'),
             coalesce(nullif(btrim(_values ->> 'nearestPoliceStation'), ''),
                      case when t = 'present' and v_open.id is null then e.nearest_police_station end),
             v_from$q$);
  v_new := replace(v_new, v_ret, v_ret || $q$
      -- D121. From here the police station is the present address's.
      if t = 'present' then
        update public.employees set nearest_police_station = null
         where id = _employee_id and nearest_police_station is not null;
      end if;$q$);
  execute v_new;
end $$;

-- ═══════════════════════════════════════════════════════ 1, 3 · the card says so

do $$
declare
  v_def text := pg_get_functiondef('public.employee_card(uuid)'::regprocedure);
  v_new text := v_def;
  v_ec  text := $q$'phone', v_e.emergency_contact_phone)$q$;
  v_ps  text := $q$'nearestPoliceStation', v_e.nearest_police_station,$q$;
begin
  if position(v_ec in v_new) = 0 or position(v_ps in v_new) = 0 then
    raise exception 'employee_card no longer reads as expected; restate it here';
  end if;
  v_new := replace(v_new, v_ec,
    $q$'phone', v_e.emergency_contact_phone,
        'familyMemberId', v_e.emergency_contact_family_member_id)$q$);
  v_new := replace(v_new, v_ps,
    $q$'nearestPoliceStation', coalesce(
        (select a.nearest_police_station from public.employee_addresses a
          where a.employee_id = v_e.id and a.address_type = 'present' and a.effective_to is null),
        v_e.nearest_police_station),$q$);
  execute v_new;
end $$;

-- ═══════════════════════════════════════════════════════ what is on record already

-- 3 · A police station on the record moves to the present address. The record's
-- is the one Physical record has edited since D113, so it is the one kept.
do $$
declare r record;
begin
  for r in
    select e.id as employee_id, e.nearest_police_station as station, a.id as address_id
      from public.employees e
      join public.employee_addresses a
        on a.employee_id = e.id and a.address_type = 'present' and a.effective_to is null
     where e.nearest_police_station is not null
  loop
    perform set_config('neuvto.police_station', r.address_id::text, true);
    update public.employee_addresses set nearest_police_station = r.station where id = r.address_id;
    perform set_config('neuvto.police_station', '', true);
    update public.employees set nearest_police_station = null where id = r.employee_id;
  end loop;
end $$;

-- 4 · Where the latest organisation gives a reason, the record says the same.
update public.employees e set reason_for_leaving_last_org = po.reason_for_leaving
  from public.previous_organisations po
 where po.id = public.employee_latest_previous_org(e.id)
   and po.reason_for_leaving is not null
   and e.reason_for_leaving_last_org is distinct from po.reason_for_leaving;

-- 1 · An emergency contact already in Family by name and relation is that person.
update public.employees e set emergency_contact_family_member_id = f.id
  from public.family_members f
 where f.employee_id = e.id
   and e.emergency_contact_family_member_id is null
   and f.relation = e.emergency_contact_relation
   and lower(btrim(f.name)) = lower(btrim(e.emergency_contact_name))
   and (select count(*) from public.family_members f2
         where f2.employee_id = e.id and f2.relation = f.relation
           and lower(btrim(f2.name)) = lower(btrim(f.name))) = 1;
