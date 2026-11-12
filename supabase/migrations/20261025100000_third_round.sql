-- Sada's third round (D105). What the database holds or refuses that it did not:
--
--   1. A posting added by mistake can be removed, with a reason. It is not
--      lost: the row is kept in record_withdrawals, with who removed it, when
--      and why, and the posting it interrupted carries on as though the move
--      had not happened. Only the latest posting can be removed, so history
--      never has a hole in its middle.
--   2. A move can end the current posting on one day and start the next on a
--      later one (currentEndsOn); without it, as before, the old one ends the
--      day before the new one begins.
--   3. "Current" means the posting that covers today. A move dated ahead left
--      the old posting closed in the future and the new one not begun, so the
--      card and the directory showed no unit at all.
--   4. One nomination covers every scheme. Saving again on the day one was
--      made corrects it (the first is kept in record_withdrawals) instead of
--      clashing with it.
--   5. A driving licence number, encrypted like PAN, and an old UAN or ESIC
--      number that is the current one is refused.
--   6. The module is called the Employee Card.

update public.modules set name = 'Employee Card' where key = 'employee';

-- ═══════════════════════════════════════════════════════ 1 · withdrawals

create table public.record_withdrawals (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id     uuid not null references public.employees(id) on delete cascade,
  kind            text not null check (kind in ('deployment', 'nomination')),
  record          jsonb not null,
  reason          text not null check (length(btrim(reason)) >= 3),
  withdrawn_by    uuid references auth.users(id) on delete set null,
  withdrawn_at    timestamptz not null default now()
);

comment on table public.record_withdrawals is
  'D105: history rows taken back (a posting added by mistake, a nomination corrected the same day), kept whole with who, when and why. Written only by the functions that withdraw; read through employee_card.';

alter table public.record_withdrawals enable row level security;
revoke all on public.record_withdrawals from anon, authenticated;
create index record_withdrawals_employee on public.record_withdrawals (employee_id, withdrawn_at desc);

-- The append-only rules let exactly one row through: the one a withdrawing
-- function names in neuvto.withdrawing for the rest of its transaction.
create or replace function public.tf_history_is_append_only()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ignored text[] := array['effective_to', 'validity', 'updated_at', 'updated_by'];
begin
  if current_setting('neuvto.purge', true) = 'on' then
    return coalesce(new, old);
  end if;
  if coalesce(current_setting('neuvto.withdrawing', true), '') = old.id::text then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    raise exception 'HISTORY_IS_NEVER_DELETED' using errcode = 'P0001',
      hint = 'Close the row with an end date and add its successor.';
  end if;

  if old.effective_to is not null then
    raise exception 'ARCHIVED_IMMUTABLE' using errcode = 'P0001',
      hint = 'A closed row is part of the record. Attach a correction instead.';
  end if;

  if (to_jsonb(new) - v_ignored) is distinct from (to_jsonb(old) - v_ignored) then
    raise exception 'USE_A_NEW_ROW' using errcode = 'P0001',
      hint = 'Only effective_to may change on an open row. Add a successor for anything else.';
  end if;
  return new;
end $$;

create or replace function public.tf_nominees_are_append_only()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('neuvto.purge', true) = 'on' then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' and coalesce(current_setting('neuvto.withdrawing', true), '') = old.version_id::text then
    return old;
  end if;
  raise exception 'NOMINATION_IS_VERSIONED' using errcode = 'P0001',
    hint = 'Supersede the nomination with a new version instead.';
end $$;

create or replace function public.employee_withdraw_posting(_deployment_id uuid, _reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_d    public.employee_deployments%rowtype;
  v_prev public.employee_deployments%rowtype;
  v_unit text;
  v_resumed text;
begin
  select * into v_d from public.employee_deployments where id = _deployment_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  -- Another company's posting answers as the admin check does for its person.
  perform public.employee_require_admin(v_d.employee_id);
  if length(btrim(coalesce(_reason, ''))) < 3 then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.employee_deployments
              where employee_id = v_d.employee_id and effective_from > v_d.effective_from) then
    raise exception 'NOT_THE_LATEST' using errcode = 'P0001',
      hint = 'Only the latest posting can be removed. Remove the ones after it first.';
  end if;

  select name into v_unit from public.deployment_units where id = v_d.deployment_unit_id;
  insert into public.record_withdrawals (organization_id, employee_id, kind, record, reason, withdrawn_by)
  values (v_d.organization_id, v_d.employee_id, 'deployment',
          (to_jsonb(v_d) - 'validity') || jsonb_build_object('unitName', v_unit),
          btrim(_reason), (select auth.uid()));

  perform set_config('neuvto.withdrawing', v_d.id::text, true);
  delete from public.employee_deployments where id = v_d.id;

  -- The posting this one cut short carries on, to where this one would have ended.
  select * into v_prev from public.employee_deployments
   where employee_id = v_d.employee_id and effective_to = v_d.effective_from;
  if found then
    perform set_config('neuvto.withdrawing', v_prev.id::text, true);
    update public.employee_deployments set effective_to = v_d.effective_to where id = v_prev.id;
    select name into v_resumed from public.deployment_units where id = v_prev.deployment_unit_id;
  end if;
  perform set_config('neuvto.withdrawing', '', true);

  return jsonb_build_object('unitName', v_unit, 'resumed', v_resumed);
end $$;

revoke all on function public.employee_withdraw_posting(uuid, text) from public, anon;
grant execute on function public.employee_withdraw_posting(uuid, text) to authenticated;

-- ═══════════════════════════════════════════════════════ 2 · moves

create or replace function public.employee_move_unit(_employee_id uuid, _values jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path = public
as $function$
declare
  v_from   date;
  v_ends   date;
  v_unit   public.deployment_units%rowtype;
  v_open   public.employee_deployments%rowtype;
  v_closed jsonb := null;
  v_shift  public.employee_shift_overrides%rowtype;
  v_shift_closed boolean := false;
  v_id     uuid;
  t        text;
begin
  perform public.employee_require_admin(_employee_id);
  perform public.restricted_known_keys(_values,
    array['unitId','effectiveFrom','orderRef','expectedDuration','reason','keepOwnShift','currentEndsOn']);
  begin
    v_from := (_values ->> 'effectiveFrom')::date;
    v_ends := nullif(btrim(coalesce(_values ->> 'currentEndsOn', '')), '')::date;
    select * into v_unit from public.deployment_units
     where id = (_values ->> 'unitId')::uuid and organization_id = public.current_org_id()
       and deleted_at is null;
  exception when others then
    raise exception 'INVALID_VALUE' using errcode = 'P0001';
  end;
  if v_from is null then
    raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'effectiveFrom';
  end if;
  -- Not found and another company's unit answer alike.
  if v_unit.id is null then
    raise exception 'UNIT_NOT_AVAILABLE' using errcode = 'P0001';
  end if;
  if v_unit.status <> 'active' then
    raise exception 'UNIT_NOT_AVAILABLE' using errcode = 'P0001', detail = 'retired';
  end if;
  if btrim(coalesce(_values ->> 'orderRef', '')) = '' then
    raise exception 'ORDER_REF_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_open from public.employee_deployments
   where employee_id = _employee_id and effective_to is null;
  if found then
    if v_open.deployment_unit_id = v_unit.id then
      raise exception 'ALREADY_DEPLOYED_THERE' using errcode = 'P0001';
    end if;
    if v_from <= v_open.effective_from then
      raise exception 'EFFECTIVE_DATE_CLASH' using errcode = 'P0001',
        detail = to_char(v_open.effective_from, 'YYYY-MM-DD');
    end if;
    -- D105: the current posting can end on its own day, and the next start
    -- later. Without an end date it ends the day before the next begins.
    if v_ends is not null then
      if v_ends < v_open.effective_from then
        raise exception 'ENDS_BEFORE_IT_BEGAN' using errcode = 'P0001',
          detail = to_char(v_open.effective_from, 'YYYY-MM-DD');
      end if;
      if v_from <= v_ends then
        raise exception 'STARTS_BEFORE_THE_LAST_ENDS' using errcode = 'P0001',
          detail = to_char(v_ends, 'YYYY-MM-DD');
      end if;
      update public.employee_deployments set effective_to = v_ends + 1 where id = v_open.id;
      v_closed := jsonb_build_object('id', v_open.id, 'lastDay', v_ends);
    else
      update public.employee_deployments set effective_to = v_from where id = v_open.id;
      v_closed := jsonb_build_object('id', v_open.id, 'lastDay', v_from - 1);
    end if;
  end if;

  begin
    insert into public.employee_deployments
      (organization_id, employee_id, deployment_unit_id, effective_from, deployment_order_ref,
       expected_duration, reason)
    select e.organization_id, e.id, v_unit.id, v_from, btrim(_values ->> 'orderRef'),
           nullif(btrim(_values ->> 'expectedDuration'), ''), nullif(btrim(_values ->> 'reason'), '')
      from public.employees e where e.id = _employee_id
    returning id into v_id;
  exception
    when exclusion_violation then
      raise exception 'EFFECTIVE_DATE_CLASH' using errcode = 'P0001';
  end;

  -- D102: a person's own shift ends where the new posting begins, unless the
  -- Admin keeps it. One set for a later date is a deliberate choice and stays.
  if not coalesce((_values ->> 'keepOwnShift')::boolean, false) then
    select * into v_shift from public.employee_shift_overrides
     where employee_id = _employee_id and effective_to is null;
    if v_shift.id is not null and v_shift.effective_from < v_from then
      update public.employee_shift_overrides set effective_to = v_from where id = v_shift.id;
      v_shift_closed := true;
    end if;
  end if;

  return jsonb_build_object('id', v_id, 'closed', v_closed, 'ownShiftEnded', v_shift_closed);
end $function$;

-- ═══════════════════════════════════════════════════════ 4 · nominations

alter table public.nomination_versions drop constraint nomination_versions_scheme_check;
alter table public.nomination_versions add constraint nomination_versions_scheme_check
  check (scheme = any (array['all', 'pf_and_gratuity', 'esic', 'insurance']));
alter table public.nomination_versions alter column scheme set default 'all';
comment on column public.nomination_versions.scheme is
  'D105: ''all'' for every nomination made since; the per-scheme values remain on older rows.';

create or replace function public.employee_save_nomination(_employee_id uuid, _values jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from   date;
  v_rows   jsonb := _values -> 'nominees';
  v_open   public.nomination_versions%rowtype;
  v_id     uuid;
  v_org    uuid;
  t        text;
begin
  perform public.employee_require_admin(_employee_id);
  -- 'scheme' is still accepted, from older callers, and means nothing now.
  perform public.restricted_known_keys(_values, array['scheme','effectiveFrom','nominees']);
  begin
    v_from := coalesce((_values ->> 'effectiveFrom')::date, public.org_today(public.current_org_id()));
  exception when others then
    raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'effectiveFrom';
  end;
  if v_rows is null or jsonb_typeof(v_rows) <> 'array' or jsonb_array_length(v_rows) = 0 then
    raise exception 'NOMINEES_REQUIRED' using errcode = 'P0001';
  end if;

  select organization_id into v_org from public.employees where id = _employee_id;
  for v_open in select * from public.nomination_versions
                 where employee_id = _employee_id and effective_to is null loop
    if v_from < v_open.effective_from then
      raise exception 'EFFECTIVE_DATE_CLASH' using errcode = 'P0001',
        detail = to_char(v_open.effective_from, 'YYYY-MM-DD');
    elsif v_from = v_open.effective_from then
      -- Made the same day: a correction. The first is kept, then replaced.
      insert into public.record_withdrawals (organization_id, employee_id, kind, record, reason, withdrawn_by)
      values (v_org, _employee_id, 'nomination',
              (to_jsonb(v_open) - 'validity') || jsonb_build_object('nominees',
                (select coalesce(jsonb_agg(to_jsonb(n)), '[]'::jsonb) from public.nominees n where n.version_id = v_open.id)),
              'Corrected the same day', (select auth.uid()));
      -- Checked once the replacement is in, not between the two deletes.
      set constraints nominee_shares_add_up deferred;
      perform set_config('neuvto.withdrawing', v_open.id::text, true);
      delete from public.nominees where version_id = v_open.id;
      delete from public.nomination_versions where id = v_open.id;
      perform set_config('neuvto.withdrawing', '', true);
    else
      update public.nomination_versions set effective_to = v_from where id = v_open.id;
    end if;
  end loop;

  begin
    insert into public.nomination_versions (organization_id, employee_id, scheme, effective_from)
    values (v_org, _employee_id, 'all', v_from) returning id into v_id;
    insert into public.nominees (organization_id, version_id, name, relation, date_of_birth, share_percent)
    select v_org, v_id, btrim(r ->> 'name'), r ->> 'relation', (r ->> 'dateOfBirth')::date,
           (r ->> 'sharePercent')::numeric
      from jsonb_array_elements(v_rows) r;
    -- The total is the E4 constraint trigger's to enforce (one rule, one
    -- place); made immediate so it refuses here, with the version and its
    -- nominees rolled back together, rather than at commit.
    set constraints nominee_shares_add_up immediate;
  exception
    when check_violation or not_null_violation or invalid_text_representation or invalid_datetime_format then
      get stacked diagnostics t = constraint_name;
      raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = coalesce(nullif(t, ''), sqlerrm);
    when exclusion_violation then
      raise exception 'EFFECTIVE_DATE_CLASH' using errcode = 'P0001';
  end;
  return v_id;
end $$;

-- The import gives one nomination per person now, whatever its Scheme column says.
do $$
declare
  v_def text := pg_get_functiondef('public.employee_import_master(jsonb,boolean,boolean)'::regprocedure);
  v_a1 text := $q$select distinct coalesce(nullif(btrim(n ->> 'scheme'), ''), 'pf_and_gratuity')$q$;
  v_a2 text := $q$and coalesce(nullif(btrim(n ->> 'scheme'), ''), 'pf_and_gratuity') = t;$q$;
begin
  if position(v_a1 in v_def) = 0 or position(v_a2 in v_def) = 0 then
    raise exception 'employee_import_master no longer groups nominees by scheme as expected; restate it here';
  end if;
  execute replace(replace(v_def, v_a1, $q$select distinct 'all'::text$q$), v_a2, $q$and t = 'all';$q$);
end $$;

-- ═══════════════════════════════════════════════════════ 5 · statutory

alter table public.employee_statutory
  add column licence_cipher bytea,
  add column licence_last4 text constraint employee_statutory_licence_last4_check check (licence_last4 ~ '^[0-9A-Z]{4}$'),
  add constraint employee_statutory_licence_whole check ((licence_cipher is null) = (licence_last4 is null));

create or replace function public.employee_set_statutory(_employee_id uuid, _values jsonb)
 returns void
 language plpgsql
 security definer
 set search_path = public
as $function$
declare
  v_rel    text[] := public.restricted_target(_employee_id);
  v_admin  boolean := 'admin' = any (v_rel);
  v_stat   boolean := 'statutory' = any (v_rel);
  v_org    uuid := public.current_org_id();
  v_numbers text[] := array['uan','epfNumber','esicNumber','oldUan','oldEsicNumber',
                            'identityDocumentType','aadhaar','pan','verifiedOn','drivingLicence'];
  v_checks  text[] := array['policeVerification','policeVerifiedOn','previousEmployerCheck',
                            'educationCheck','reverificationDue'];
  v_row    public.employee_statutory%rowtype;
  v        text;
  k        text;
begin
  perform public.restricted_known_keys(_values, v_numbers || v_checks);
  for k in select jsonb_object_keys(_values) loop
    if k = any (v_numbers) and not (v_admin or v_stat) then
      raise exception 'FORBIDDEN' using errcode = '42501', detail = k;
    end if;
    if k = any (v_checks) and not v_admin then
      raise exception 'FORBIDDEN' using errcode = '42501', detail = k;
    end if;
  end loop;

  select * into v_row from public.employee_statutory where employee_id = _employee_id;
  if not found then
    v_row.employee_id := _employee_id;
    v_row.organization_id := v_org;
    v_row.police_verification := 'not_started';
    v_row.previous_employer_check := 'not_started';
    v_row.education_check := 'not_started';
  end if;

  if _values ? 'aadhaar' then
    v := public.statutory_normalise(_values ->> 'aadhaar');
    if v is not null and not public.aadhaar_is_valid(v) then
      raise exception 'INVALID_AADHAAR' using errcode = 'P0001';
    end if;
    v_row.aadhaar_cipher := public.restricted_encrypt(v);
    v_row.aadhaar_last4  := right(v, 4);
    v_row.aadhaar_index  := public.restricted_index(v);
  end if;
  if _values ? 'pan' then
    v := public.statutory_normalise(_values ->> 'pan');
    if v is not null and v !~ '^[A-Z]{5}[0-9]{4}[A-Z]$' then
      raise exception 'INVALID_PAN' using errcode = 'P0001';
    end if;
    v_row.pan_cipher := public.restricted_encrypt(v);
    v_row.pan_last4  := right(v, 4);
    v_row.pan_index  := public.restricted_index(v);
  end if;
  if _values ? 'uan' then
    v := public.statutory_normalise(_values ->> 'uan');
    if v is not null and v !~ '^[0-9]{12}$' then raise exception 'INVALID_UAN' using errcode = 'P0001'; end if;
    v_row.uan_cipher := public.restricted_encrypt(v); v_row.uan_last4 := right(v, 4);
  end if;
  if _values ? 'oldUan' then
    v := public.statutory_normalise(_values ->> 'oldUan');
    if v is not null and v !~ '^[0-9]{12}$' then raise exception 'INVALID_UAN' using errcode = 'P0001'; end if;
    v_row.old_uan_cipher := public.restricted_encrypt(v); v_row.old_uan_last4 := right(v, 4);
  end if;
  if _values ? 'esicNumber' then
    v := public.statutory_normalise(_values ->> 'esicNumber');
    if v is not null and v !~ '^([0-9]{10}|[0-9]{17})$' then raise exception 'INVALID_ESIC' using errcode = 'P0001'; end if;
    v_row.esic_cipher := public.restricted_encrypt(v); v_row.esic_last4 := right(v, 4);
  end if;
  if _values ? 'oldEsicNumber' then
    v := public.statutory_normalise(_values ->> 'oldEsicNumber');
    if v is not null and v !~ '^([0-9]{10}|[0-9]{17})$' then raise exception 'INVALID_ESIC' using errcode = 'P0001'; end if;
    v_row.old_esic_cipher := public.restricted_encrypt(v); v_row.old_esic_last4 := right(v, 4);
  end if;
  if _values ? 'epfNumber' then
    -- Region, office, establishment, extension, member: 5 letters then digits,
    -- typed with or without slashes. Loose on purpose; the format has varied.
    v := public.statutory_normalise(_values ->> 'epfNumber');
    if v is not null and v !~ '^[A-Z]{5}[0-9A-Z]{5,17}$' then raise exception 'INVALID_EPF' using errcode = 'P0001'; end if;
    v_row.epf_cipher := public.restricted_encrypt(v); v_row.epf_last4 := right(v, 4);
  end if;
  if _values ? 'drivingLicence' then
    -- D105: two letters for the state, then the RTO, year and number; typed
    -- with or without spaces and dashes. Loose on purpose, as EPF is.
    v := public.statutory_normalise(_values ->> 'drivingLicence');
    if v is not null and v !~ '^[A-Z]{2}[0-9A-Z]{8,16}$' then raise exception 'INVALID_LICENCE' using errcode = 'P0001'; end if;
    v_row.licence_cipher := public.restricted_encrypt(v); v_row.licence_last4 := right(v, 4);
  end if;
  -- D105: an old number is somebody's previous account. The same number in
  -- both is a typing slip, and it would make a transfer look done when it is not.
  if v_row.uan_cipher is not null and v_row.old_uan_cipher is not null
     and public.restricted_decrypt(v_row.uan_cipher) = public.restricted_decrypt(v_row.old_uan_cipher) then
    raise exception 'OLD_UAN_IS_CURRENT' using errcode = 'P0001';
  end if;
  if v_row.esic_cipher is not null and v_row.old_esic_cipher is not null
     and public.restricted_decrypt(v_row.esic_cipher) = public.restricted_decrypt(v_row.old_esic_cipher) then
    raise exception 'OLD_ESIC_IS_CURRENT' using errcode = 'P0001';
  end if;
  if _values ? 'identityDocumentType' then v_row.identity_document_type := _values ->> 'identityDocumentType'; end if;
  if _values ? 'verifiedOn' then v_row.verified_on := (_values ->> 'verifiedOn')::date; end if;
  if _values ? 'policeVerification' then v_row.police_verification := coalesce(_values ->> 'policeVerification', 'not_started'); end if;
  if _values ? 'policeVerifiedOn' then v_row.police_verified_on := (_values ->> 'policeVerifiedOn')::date; end if;
  if _values ? 'previousEmployerCheck' then v_row.previous_employer_check := coalesce(_values ->> 'previousEmployerCheck', 'not_started'); end if;
  if _values ? 'educationCheck' then v_row.education_check := coalesce(_values ->> 'educationCheck', 'not_started'); end if;
  if _values ? 'reverificationDue' then v_row.reverification_due := (_values ->> 'reverificationDue')::date; end if;

  begin
    insert into public.employee_statutory values (v_row.*)
    on conflict (employee_id) do update set
      uan_cipher = excluded.uan_cipher, uan_last4 = excluded.uan_last4,
      epf_cipher = excluded.epf_cipher, epf_last4 = excluded.epf_last4,
      esic_cipher = excluded.esic_cipher, esic_last4 = excluded.esic_last4,
      old_uan_cipher = excluded.old_uan_cipher, old_uan_last4 = excluded.old_uan_last4,
      old_esic_cipher = excluded.old_esic_cipher, old_esic_last4 = excluded.old_esic_last4,
      identity_document_type = excluded.identity_document_type,
      aadhaar_cipher = excluded.aadhaar_cipher, aadhaar_last4 = excluded.aadhaar_last4,
      aadhaar_index = excluded.aadhaar_index,
      pan_cipher = excluded.pan_cipher, pan_last4 = excluded.pan_last4, pan_index = excluded.pan_index,
      licence_cipher = excluded.licence_cipher, licence_last4 = excluded.licence_last4,
      verified_on = excluded.verified_on,
      police_verification = excluded.police_verification,
      police_verified_on = excluded.police_verified_on,
      previous_employer_check = excluded.previous_employer_check,
      education_check = excluded.education_check,
      reverification_due = excluded.reverification_due;
  exception
    when unique_violation then
      if sqlerrm like '%aadhaar%' then
        raise exception 'AADHAAR_ALREADY_RECORDED' using errcode = 'P0001',
          hint = 'Another person in this company already has this Aadhaar number.';
      end if;
      raise exception 'PAN_ALREADY_RECORDED' using errcode = 'P0001',
        hint = 'Another person in this company already has this PAN.';
    when check_violation or invalid_text_representation or invalid_datetime_format then
      raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = sqlerrm;
  end;
end $function$;

create or replace function public.employee_reveal_restricted(_employee_id uuid, _fields text[], _reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_rel   text[] := public.restricted_target(_employee_id);
  v_uid   uuid := (select auth.uid());
  v_admin boolean := 'admin' = any (v_rel);
  v_stat  boolean := 'statutory' = any (v_rel);
  v_pay   boolean := 'payroll' = any (v_rel);
  v_nums  text[] := array['uan','epf_number','esic_number','old_uan','old_esic_number','aadhaar','pan',
                          'driving_licence'];
  v_known text[] := v_nums || array['bank_account','religion','caste_category','disability'];
  v_out   jsonb := '{}'::jsonb;
  v_r     jsonb;
  f       text;
  v_s     public.employee_statutory%rowtype;
begin
  if _fields is null or cardinality(_fields) = 0 then
    raise exception 'UNKNOWN_FIELD' using errcode = 'P0001';
  end if;
  foreach f in array _fields loop
    if not (f = any (v_known)) then
      raise exception 'UNKNOWN_FIELD' using errcode = 'P0001', detail = f;
    end if;
    if (f = any (v_nums) and not (v_admin or v_stat))
       or (f = 'bank_account' and not (v_admin or v_pay))
       or (f in ('religion','caste_category','disability') and not (v_admin or v_stat)) then
      raise exception 'FORBIDDEN' using errcode = '42501', detail = f;
    end if;
  end loop;

  insert into public.restricted_reads (organization_id, reader_id, reader_name, employee_id, fields, reason)
  values (public.current_org_id(), v_uid,
          (select coalesce(full_name, email) from public.profiles where id = v_uid),
          _employee_id, (select array_agg(distinct x order by x) from unnest(_fields) x),
          nullif(btrim(coalesce(_reason, '')), ''));

  select * into v_s from public.employee_statutory where employee_id = _employee_id;
  if 'uan' = any (_fields) then v_out := v_out || jsonb_build_object('uan', public.restricted_decrypt(v_s.uan_cipher)); end if;
  if 'epf_number' = any (_fields) then v_out := v_out || jsonb_build_object('epfNumber', public.restricted_decrypt(v_s.epf_cipher)); end if;
  if 'esic_number' = any (_fields) then v_out := v_out || jsonb_build_object('esicNumber', public.restricted_decrypt(v_s.esic_cipher)); end if;
  if 'old_uan' = any (_fields) then v_out := v_out || jsonb_build_object('oldUan', public.restricted_decrypt(v_s.old_uan_cipher)); end if;
  if 'old_esic_number' = any (_fields) then v_out := v_out || jsonb_build_object('oldEsicNumber', public.restricted_decrypt(v_s.old_esic_cipher)); end if;
  if 'aadhaar' = any (_fields) then v_out := v_out || jsonb_build_object('aadhaar', public.restricted_decrypt(v_s.aadhaar_cipher)); end if;
  if 'pan' = any (_fields) then v_out := v_out || jsonb_build_object('pan', public.restricted_decrypt(v_s.pan_cipher)); end if;
  if 'driving_licence' = any (_fields) then v_out := v_out || jsonb_build_object('drivingLicence', public.restricted_decrypt(v_s.licence_cipher)); end if;
  if 'bank_account' = any (_fields) then
    v_out := v_out || jsonb_build_object('bankAccount',
      (select public.restricted_decrypt(account_cipher) from public.employee_bank where employee_id = _employee_id));
  end if;
  if _fields && array['religion','caste_category','disability'] then
    select public.restricted_decrypt(values_cipher)::jsonb into v_r
      from public.employee_restricted where employee_id = _employee_id;
    if 'religion' = any (_fields) then v_out := v_out || jsonb_build_object('religion', v_r -> 'religion'); end if;
    if 'caste_category' = any (_fields) then v_out := v_out || jsonb_build_object('casteCategory', v_r -> 'casteCategory'); end if;
    if 'disability' = any (_fields) then
      v_out := v_out || jsonb_build_object('disabilityStatus', v_r -> 'disabilityStatus',
                                           'disabilityPercent', v_r -> 'disabilityPercent');
    end if;
  end if;
  return v_out;
end $function$;

-- ═══════════════════════════════════════════════════════ 3 · the card and directory

do $$
declare
  v_def text := pg_get_functiondef('public.employee_card(uuid)'::regprocedure);
  v_cover text := 'd.effective_from <= public.org_today(v_org) and (d.effective_to is null or d.effective_to > public.org_today(v_org))';
  v_new text;
  v_anchor text := '  -- ── what the screen may offer.';
  v_pan text := $q$'panLast4',             v_st.pan_last4,$q$;
begin
  v_new := regexp_replace(v_def,
    'd\.effective_to is null\s+and d\.effective_from <= public\.org_today\(v_org\)', v_cover);
  if v_new = v_def then
    raise exception 'employee_card no longer picks the current posting as expected; restate it here';
  end if;
  if position(v_anchor in v_new) = 0 or position(v_pan in v_new) = 0 then
    raise exception 'employee_card has moved its anchors; restate it here';
  end if;
  v_new := replace(v_new, v_pan, v_pan || $q$
      'licenceLast4',         v_st.licence_last4,$q$);
  v_new := replace(v_new, v_anchor, $q$  -- ── D105: the posting that starts after today, and postings taken back.
  if self_ or admin_ or pay_ or stat_ then
    v_card := v_card || jsonb_build_object('nextDeployment', (
      select jsonb_build_object('unitName', u.name, 'effectiveFrom', d.effective_from)
        from public.employee_deployments d
        join public.deployment_units u on u.id = d.deployment_unit_id
       where d.employee_id = v_e.id and d.effective_from > public.org_today(v_org)
       order by d.effective_from limit 1));
  end if;
  if admin_ then
    v_card := v_card || jsonb_build_object('withdrawnPostings', coalesce((
      select jsonb_agg(jsonb_build_object(
               'unitName', w.record ->> 'unitName',
               'effectiveFrom', w.record ->> 'effective_from',
               'reason', w.reason,
               'withdrawnBy', (select coalesce(full_name, email) from public.profiles where id = w.withdrawn_by),
               'withdrawnAt', w.withdrawn_at) order by w.withdrawn_at desc)
        from public.record_withdrawals w
       where w.employee_id = v_e.id and w.kind = 'deployment'), '[]'::jsonb));
  end if;

$q$ || v_anchor);
  execute v_new;

  v_def := pg_get_functiondef('public.employee_directory(text)'::regprocedure);
  v_new := regexp_replace(v_def,
    'd\.effective_to is null\s+and d\.effective_from <= public\.org_today\(v_org\)', v_cover);
  if v_new = v_def then
    raise exception 'employee_directory no longer picks the current posting as expected; restate it here';
  end if;
  execute v_new;
end $$;
