-- ============================================================================
-- NEUVTO WOS — statutory numbers, bank and restricted data, encrypted (E6, D80)
-- ============================================================================
--
-- D80 reverses D59: Aadhaar, PAN and the bank account are stored, because the
-- statutory returns this product exists to produce ask for them. This file is
-- the whole of how.
--
--   employee_statutory   UAN, EPF, ESIC (current and old), Aadhaar, PAN,
--                        verification. Every NUMBER is encrypted; `*_last4`
--                        sits beside each.
--   employee_bank        bank, branch, IFSC, holder, penny drop; the ACCOUNT is
--                        encrypted with `account_last4` beside it.
--   employee_restricted  religion, caste category, disability: one encrypted
--                        blob, no last-four, nothing in clear.
--   restricted_reads     one row per reveal: who, whose, which fields, why,
--                        when. Append-only.
--
-- THE KEY lives in Vault as `statutory_encryption_key`, set by hand per
-- environment (D43's reason: a key in a migration is a key in git). Nothing
-- here creates it. Without it every write and every decrypt refuses with
-- STATUTORY_KEY_NOT_SET, so a missing key fails loudly rather than storing
-- plaintext. Setting it: docs/operations/STATUTORY_DATA.md.
--
-- WHY A SECOND AUDIT TRIGGER. write_audit_log copies whole rows into
-- audit_logs, which every admin can read. For these three tables that would
-- hand an admin the ciphertext (harmless) and, for bank, the plaintext IFSC
-- and holder of an account §5 hides from them. So these tables audit through
-- tf_restricted_audit, which records WHICH fields changed and never a value.
--
-- WHO SEES WHAT is §5 of NEUVTO_EMPLOYEE_MASTER, written as code in
-- employee_card() below. Full values reach a browser only from
-- employee_reveal_restricted(), which writes its restricted_reads row in the
-- same transaction, or, for UAN, EPF and ESIC, on the card of somebody with the
-- Payroll or Statutory role, which §5 grants in full without a reveal.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════ the key

create or replace function public.statutory_key()
returns text
language plpgsql
stable
security definer
set search_path = public, vault
as $$
declare v_key text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets
   where name = 'statutory_encryption_key' limit 1;
  if v_key is null or length(v_key) < 32 then
    raise exception 'STATUTORY_KEY_NOT_SET' using errcode = 'P0001',
      hint = 'Set the statutory_encryption_key Vault secret. See docs/operations/STATUTORY_DATA.md.';
  end if;
  return v_key;
end $$;

create or replace function public.restricted_encrypt(_value text)
returns bytea
language sql
stable
security definer
set search_path = public, extensions
as $$
  select case when _value is null then null
              else extensions.pgp_sym_encrypt(_value, public.statutory_key(), 'cipher-algo=aes256') end
$$;

create or replace function public.restricted_decrypt(_cipher bytea)
returns text
language sql
stable
security definer
set search_path = public, extensions
as $$
  select case when _cipher is null then null
              else extensions.pgp_sym_decrypt(_cipher, public.statutory_key()) end
$$;

/**
 * A keyed hash, so the same Aadhaar or PAN cannot be recorded for two people
 * in one company without anybody being able to look a number up. Keyed, not a
 * bare hash: a 12-digit space is small enough to hash exhaustively.
 */
create or replace function public.restricted_index(_value text)
returns bytea
language sql
stable
security definer
set search_path = public, extensions
as $$
  select case when _value is null then null
              else extensions.hmac(_value, public.statutory_key() || ':index', 'sha256') end
$$;

revoke all on function public.statutory_key() from public, anon, authenticated;
revoke all on function public.restricted_encrypt(text) from public, anon, authenticated;
revoke all on function public.restricted_decrypt(bytea) from public, anon, authenticated;
revoke all on function public.restricted_index(text) from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════ validation

/** Aadhaar: 12 digits, not starting 0 or 1, Verhoeff check digit. */
create or replace function public.aadhaar_is_valid(_n text)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  d int[] := array[
    0,1,2,3,4,5,6,7,8,9, 1,2,3,4,0,6,7,8,9,5, 2,3,4,0,1,7,8,9,5,6, 3,4,0,1,2,8,9,5,6,7,
    4,0,1,2,3,9,5,6,7,8, 5,9,8,7,6,0,4,3,2,1, 6,5,9,8,7,1,0,4,3,2, 7,6,5,9,8,2,1,0,4,3,
    8,7,6,5,9,3,2,1,0,4, 9,8,7,6,5,4,3,2,1,0];
  p int[] := array[
    0,1,2,3,4,5,6,7,8,9, 1,5,7,6,2,8,3,0,9,4, 5,8,0,3,7,9,6,1,4,2, 8,9,1,6,0,4,3,5,2,7,
    9,4,5,3,1,2,6,8,7,0, 4,2,8,6,5,7,3,9,0,1, 2,7,9,3,8,0,6,4,1,5, 7,0,4,6,9,1,3,2,5,8];
  c int := 0;
  i int;
  digit int;
begin
  if _n is null or _n !~ '^[2-9][0-9]{11}$' then return false; end if;
  for i in 0 .. 11 loop
    digit := substr(_n, 12 - i, 1)::int;
    c := d[c * 10 + p[(i % 8) * 10 + digit + 1] + 1];
  end loop;
  return c = 0;
end $$;

/** Digits and letters only, upper case. What people type includes spaces and slashes. */
create or replace function public.statutory_normalise(_v text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(upper(regexp_replace(coalesce(_v, ''), '[^0-9A-Za-z]', '', 'g')), '')
$$;

-- ═══════════════════════════════════════════════════════════ the tables

create table public.employee_statutory (
  employee_id     uuid primary key references public.employees(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete restrict,

  uan_cipher      bytea, uan_last4      text check (uan_last4 ~ '^[0-9]{4}$'),
  epf_cipher      bytea, epf_last4      text check (epf_last4 ~ '^[0-9A-Z]{4}$'),
  esic_cipher     bytea, esic_last4     text check (esic_last4 ~ '^[0-9]{4}$'),
  old_uan_cipher  bytea, old_uan_last4  text check (old_uan_last4 ~ '^[0-9]{4}$'),
  old_esic_cipher bytea, old_esic_last4 text check (old_esic_last4 ~ '^[0-9]{4}$'),

  identity_document_type text check (identity_document_type in
                           ('aadhaar', 'pan', 'passport', 'voter_id', 'driving_licence')),
  aadhaar_cipher  bytea, aadhaar_last4  text check (aadhaar_last4 ~ '^[0-9]{4}$'),
  aadhaar_index   bytea,
  pan_cipher      bytea, pan_last4      text check (pan_last4 ~ '^[0-9A-Z]{4}$'),
  pan_index       bytea,
  verified_on     date,

  police_verification     text not null default 'not_started'
                          check (police_verification in ('not_started','pending','verified','failed')),
  police_verified_on      date,
  previous_employer_check text not null default 'not_started'
                          check (previous_employer_check in ('not_started','pending','verified','failed','not_applicable')),
  education_check         text not null default 'not_started'
                          check (education_check in ('not_started','pending','verified','failed')),
  reverification_due      date,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,

  -- A number and its last four arrive and leave together.
  constraint employee_statutory_aadhaar_whole check ((aadhaar_cipher is null) = (aadhaar_last4 is null) and (aadhaar_cipher is null) = (aadhaar_index is null)),
  constraint employee_statutory_pan_whole     check ((pan_cipher is null) = (pan_last4 is null) and (pan_cipher is null) = (pan_index is null)),
  constraint employee_statutory_uan_whole     check ((uan_cipher is null) = (uan_last4 is null)),
  constraint employee_statutory_epf_whole     check ((epf_cipher is null) = (epf_last4 is null)),
  constraint employee_statutory_esic_whole    check ((esic_cipher is null) = (esic_last4 is null)),
  constraint employee_statutory_old_uan_whole check ((old_uan_cipher is null) = (old_uan_last4 is null)),
  constraint employee_statutory_old_esic_whole check ((old_esic_cipher is null) = (old_esic_last4 is null))
);

-- One person per Aadhaar, and per PAN, within a company.
create unique index uq_employee_statutory_aadhaar on public.employee_statutory (organization_id, aadhaar_index);
create unique index uq_employee_statutory_pan     on public.employee_statutory (organization_id, pan_index);
create index idx_employee_statutory_org on public.employee_statutory (organization_id);

create table public.employee_bank (
  employee_id     uuid primary key references public.employees(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  bank_name       text,
  branch          text,
  account_cipher  bytea,
  account_last4   text check (account_last4 ~ '^[0-9]{4}$'),
  ifsc            text check (ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  account_holder  text,
  penny_drop_status text not null default 'not_checked'
                  check (penny_drop_status in ('not_checked', 'verified', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint employee_bank_account_whole check ((account_cipher is null) = (account_last4 is null))
);
create index idx_employee_bank_org on public.employee_bank (organization_id);

create table public.employee_restricted (
  employee_id     uuid primary key references public.employees(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  -- {"religion", "casteCategory", "disabilityStatus", "disabilityPercent"}, encrypted whole.
  values_cipher   bytea not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null
);
create index idx_employee_restricted_org on public.employee_restricted (organization_id);

create table public.restricted_reads (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  -- Not foreign keys, deliberately. A reveal record must outlive the reader's
  -- account and survive a person's record being purged around it; a foreign
  -- key with ON DELETE SET NULL would be an UPDATE, which this table refuses.
  reader_id       uuid not null,
  reader_name     text,
  employee_id     uuid not null,
  fields          text[] not null check (cardinality(fields) > 0),
  reason          text not null check (length(btrim(reason)) >= 3),
  read_at         timestamptz not null default now()
);
create index idx_restricted_reads_employee on public.restricted_reads (employee_id, read_at desc);
create index idx_restricted_reads_org      on public.restricted_reads (organization_id, read_at desc);

comment on table public.restricted_reads is
  'D80 — every reveal of Aadhaar, PAN, a bank account or restricted data. Append-only. Kept three years: the pruning job is listed in the build spec''s known gaps.';

-- ═══════════════════════════════════════════════════════════ triggers

create or replace function public.tf_restricted_same_org()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.employees
                  where id = new.employee_id and organization_id = new.organization_id) then
    raise exception 'CROSS_ORGANISATION_ROW' using errcode = 'P0001';
  end if;
  return new;
end $$;

/**
 * The audit row for a restricted table: who changed WHICH fields of whose
 * record. Never a value, ciphertext included, because admins read audit_logs.
 */
create or replace function public.tf_restricted_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_changed text[];
  v_skip text[] := array['created_at','updated_at','created_by','updated_by'];
begin
  select coalesce(array_agg(distinct regexp_replace(k, '_(cipher|last4|index)$', '') order by
                            regexp_replace(k, '_(cipher|last4|index)$', '')), '{}')
    into v_changed
    from jsonb_object_keys(coalesce(v_new, v_old)) k
   where k <> all (v_skip)
     and (v_old -> k) is distinct from (v_new -> k);
  if tg_op = 'UPDATE' and cardinality(v_changed) = 0 then
    return new;
  end if;
  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, before, after)
  values ((coalesce(v_new, v_old) ->> 'organization_id')::uuid, (select auth.uid()), tg_table_name || '.' || lower(tg_op),
          tg_table_name, (coalesce(v_new, v_old) ->> 'employee_id')::uuid,
          null, jsonb_build_object('fieldsChanged', to_jsonb(v_changed)));
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create or replace function public.tf_restricted_reads_are_append_only()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('neuvto.purge', true) = 'on' then
    return coalesce(new, old);
  end if;
  raise exception 'REVEAL_LOG_IS_APPEND_ONLY' using errcode = 'P0001';
end $$;

revoke all on function public.tf_restricted_same_org() from public, anon, authenticated;
revoke all on function public.tf_restricted_audit() from public, anon, authenticated;
revoke all on function public.tf_restricted_reads_are_append_only() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['employee_statutory','employee_bank','employee_restricted'] loop
    execute format('create trigger set_audit_fields before insert or update on public.%I
                    for each row execute function public.set_audit_fields()', t);
    execute format('create trigger restricted_audit after insert or update or delete on public.%I
                    for each row execute function public.tf_restricted_audit()', t);
    execute format('create trigger same_organisation before insert or update on public.%I
                    for each row execute function public.tf_restricted_same_org()', t);
  end loop;
end $$;

create trigger restricted_reads_are_append_only
  before update or delete on public.restricted_reads
  for each row execute function public.tf_restricted_reads_are_append_only();

-- ═══════════════════════════════════════════════════════════ access

-- Written out, not looped: CI's guardrail reads each migration for a literal
-- `alter table <t> enable row level security` beside every `create table`.
alter table public.employee_statutory enable row level security;
alter table public.employee_bank enable row level security;
alter table public.employee_restricted enable row level security;
alter table public.restricted_reads enable row level security;

-- RLS on, no policy, no grant: reachable only through the functions below.
do $$
declare t text;
begin
  foreach t in array array['employee_statutory','employee_bank','employee_restricted','restricted_reads'] loop
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════ writers

/** Who may reach this person's record at all, and as what. Shared by the writers. */
create or replace function public.restricted_target(_employee_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  v_rel text[];
begin
  if (select auth.uid()) is null or v_org is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;
  if not public.module_enabled_for(v_org, 'employee') then
    raise exception 'MODULE_NOT_ENABLED' using errcode = 'P0001';
  end if;
  v_rel := public.employee_relationship(_employee_id);
  if v_rel is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  return v_rel;
end $$;

revoke all on function public.restricted_target(uuid) from public, anon, authenticated;

/** Refuses a key the writer does not know, so a typo is never a silent no-op. */
create or replace function public.restricted_known_keys(_values jsonb, _known text[])
returns void
language plpgsql
immutable
set search_path = public
as $$
declare k text;
begin
  if _values is null or jsonb_typeof(_values) <> 'object' then
    raise exception 'UNKNOWN_FIELD' using errcode = 'P0001';
  end if;
  for k in select jsonb_object_keys(_values) loop
    if not (k = any (_known)) then
      raise exception 'UNKNOWN_FIELD' using errcode = 'P0001', detail = k;
    end if;
  end loop;
end $$;

/**
 * Statutory numbers and verification. A key that is present sets the field
 * (null clears it); a key that is absent leaves it alone.
 *
 * Numbers: an Admin or the Statutory role (§5: Admin enters them at
 * onboarding and then sees the last four, like everybody but Statutory).
 * Verification: an Admin.
 */
create or replace function public.employee_set_statutory(_employee_id uuid, _values jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_rel    text[] := public.restricted_target(_employee_id);
  v_admin  boolean := 'admin' = any (v_rel);
  v_stat   boolean := 'statutory' = any (v_rel);
  v_org    uuid := public.current_org_id();
  v_numbers text[] := array['uan','epfNumber','esicNumber','oldUan','oldEsicNumber',
                            'identityDocumentType','aadhaar','pan','verifiedOn'];
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
end $$;

comment on function public.employee_set_statutory is
  'E6 — statutory numbers (Admin or Statutory) and verification (Admin). Numbers are validated, then encrypted with a last-four beside them; Aadhaar and PAN are unique per company through a keyed index.';

revoke all on function public.employee_set_statutory(uuid, jsonb) from public, anon;
grant execute on function public.employee_set_statutory(uuid, jsonb) to authenticated;

/** Bank details. The Payroll role only: §5 hides the bank block from Admin. */
create or replace function public.employee_set_bank(_employee_id uuid, _values jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_rel text[] := public.restricted_target(_employee_id);
  v_org uuid := public.current_org_id();
  v_row public.employee_bank%rowtype;
  v     text;
begin
  perform public.restricted_known_keys(_values,
    array['bankName','branch','account','ifsc','accountHolder','pennyDropStatus']);
  if not ('payroll' = any (v_rel)) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select * into v_row from public.employee_bank where employee_id = _employee_id;
  if not found then
    v_row.employee_id := _employee_id;
    v_row.organization_id := v_org;
    v_row.penny_drop_status := 'not_checked';
  end if;

  if _values ? 'account' then
    v := public.statutory_normalise(_values ->> 'account');
    if v is not null and v !~ '^[0-9]{9,18}$' then
      raise exception 'INVALID_ACCOUNT' using errcode = 'P0001';
    end if;
    v_row.account_cipher := public.restricted_encrypt(v);
    v_row.account_last4 := right(v, 4);
    -- A new account has not been penny-dropped, whatever the old one was.
    if not (_values ? 'pennyDropStatus') then v_row.penny_drop_status := 'not_checked'; end if;
  end if;
  if _values ? 'ifsc' then
    v := public.statutory_normalise(_values ->> 'ifsc');
    if v is not null and v !~ '^[A-Z]{4}0[A-Z0-9]{6}$' then
      raise exception 'INVALID_IFSC' using errcode = 'P0001';
    end if;
    v_row.ifsc := v;
  end if;
  if _values ? 'bankName' then v_row.bank_name := nullif(btrim(_values ->> 'bankName'), ''); end if;
  if _values ? 'branch' then v_row.branch := nullif(btrim(_values ->> 'branch'), ''); end if;
  if _values ? 'accountHolder' then v_row.account_holder := nullif(btrim(_values ->> 'accountHolder'), ''); end if;
  if _values ? 'pennyDropStatus' then v_row.penny_drop_status := coalesce(_values ->> 'pennyDropStatus', 'not_checked'); end if;

  begin
    insert into public.employee_bank values (v_row.*)
    on conflict (employee_id) do update set
      bank_name = excluded.bank_name, branch = excluded.branch,
      account_cipher = excluded.account_cipher, account_last4 = excluded.account_last4,
      ifsc = excluded.ifsc, account_holder = excluded.account_holder,
      penny_drop_status = excluded.penny_drop_status;
  exception when check_violation then
    raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = sqlerrm;
  end;
end $$;

revoke all on function public.employee_set_bank(uuid, jsonb) from public, anon;
grant execute on function public.employee_set_bank(uuid, jsonb) to authenticated;

/** Religion, caste category, disability. The Statutory role only, never Admin. */
create or replace function public.employee_set_restricted(_employee_id uuid, _values jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_rel  text[] := public.restricted_target(_employee_id);
  v_org  uuid := public.current_org_id();
  v_old  jsonb;
  v_new  jsonb;
  v_pct  numeric;
begin
  perform public.restricted_known_keys(_values,
    array['religion','casteCategory','disabilityStatus','disabilityPercent']);
  if not ('statutory' = any (v_rel)) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if _values ? 'casteCategory' and _values ->> 'casteCategory' is not null
     and _values ->> 'casteCategory' not in ('general','obc','sc','st','ews','not_disclosed') then
    raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'casteCategory';
  end if;
  if _values ? 'disabilityStatus' and _values ->> 'disabilityStatus' is not null
     and _values ->> 'disabilityStatus' not in ('none','disabled','not_disclosed') then
    raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'disabilityStatus';
  end if;
  if _values ? 'disabilityPercent' and _values ->> 'disabilityPercent' is not null then
    begin
      v_pct := (_values ->> 'disabilityPercent')::numeric;
    exception when others then
      raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'disabilityPercent';
    end;
    if v_pct < 0 or v_pct > 100 then
      raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'disabilityPercent';
    end if;
  end if;

  select public.restricted_decrypt(values_cipher)::jsonb into v_old
    from public.employee_restricted where employee_id = _employee_id;
  v_new := coalesce(v_old, '{}'::jsonb) || _values;

  insert into public.employee_restricted (employee_id, organization_id, values_cipher)
  values (_employee_id, v_org, public.restricted_encrypt(v_new::text))
  on conflict (employee_id) do update set values_cipher = excluded.values_cipher;
end $$;

revoke all on function public.employee_set_restricted(uuid, jsonb) from public, anon;
grant execute on function public.employee_set_restricted(uuid, jsonb) to authenticated;

-- ═══════════════════════════════════════════════════════════ the reveal

/**
 * The only way a full Aadhaar, PAN, bank account or restricted value reaches a
 * browser. All or nothing: one field the caller may not see refuses the whole
 * call, so a reveal never half-succeeds with a partial log.
 *
 *   aadhaar, pan                          the Statutory role
 *   bank_account                          the Payroll role
 *   religion, caste_category, disability  the Statutory role, or the person themselves
 *
 * The restricted_reads row is written in this transaction, before the values
 * are returned: if the log cannot be written, nothing is revealed.
 */
create or replace function public.employee_reveal_restricted(
  _employee_id uuid,
  _fields      text[],
  _reason      text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_rel   text[] := public.restricted_target(_employee_id);
  v_uid   uuid := (select auth.uid());
  v_stat  boolean := 'statutory' = any (v_rel);
  v_pay   boolean := 'payroll' = any (v_rel);
  v_self  boolean := 'self' = any (v_rel);
  v_known text[] := array['aadhaar','pan','bank_account','religion','caste_category','disability'];
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
    if (f in ('aadhaar','pan') and not v_stat)
       or (f = 'bank_account' and not v_pay)
       or (f in ('religion','caste_category','disability') and not (v_stat or v_self)) then
      raise exception 'FORBIDDEN' using errcode = '42501', detail = f;
    end if;
  end loop;
  if length(btrim(coalesce(_reason, ''))) < 3 then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001',
      hint = 'Say why you need to see it. The reason is kept with the record of this look.';
  end if;

  insert into public.restricted_reads (organization_id, reader_id, reader_name, employee_id, fields, reason)
  values (public.current_org_id(), v_uid,
          (select coalesce(full_name, email) from public.profiles where id = v_uid),
          _employee_id, (select array_agg(distinct x order by x) from unnest(_fields) x),
          btrim(_reason));

  select * into v_s from public.employee_statutory where employee_id = _employee_id;
  if 'aadhaar' = any (_fields) then v_out := v_out || jsonb_build_object('aadhaar', public.restricted_decrypt(v_s.aadhaar_cipher)); end if;
  if 'pan' = any (_fields) then v_out := v_out || jsonb_build_object('pan', public.restricted_decrypt(v_s.pan_cipher)); end if;
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
end $$;

comment on function public.employee_reveal_restricted is
  'D80 — reveals full restricted values once, after writing the restricted_reads row in the same transaction. All or nothing; a stated reason is required.';

revoke all on function public.employee_reveal_restricted(uuid, text[], text) from public, anon;
grant execute on function public.employee_reveal_restricted(uuid, text[], text) to authenticated;

/** Who has looked at this person's restricted data. Them, a Super Admin, or Statutory. */
create or replace function public.employee_restricted_reads(_employee_id uuid)
returns table (read_at timestamptz, reader_name text, fields text[], reason text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_rel text[] := public.restricted_target(_employee_id);
begin
  if not ('self' = any (v_rel) or 'statutory' = any (v_rel) or public.is_super_admin()) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return query
    select r.read_at, r.reader_name, r.fields, r.reason
      from public.restricted_reads r
     where r.employee_id = _employee_id and r.organization_id = public.current_org_id()
     order by r.read_at desc
     limit 200;
end $$;

revoke all on function public.employee_restricted_reads(uuid) from public, anon;
grant execute on function public.employee_restricted_reads(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════ the card, again
--
-- Reproduced from 20261012110000_the_card_answers_by_role.sql, which it
-- replaces. The diff is the block marked E6 before the capabilities, and the
-- capabilities themselves.

create or replace function public.employee_card(_employee_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_org   uuid := public.current_org_id();
  v_id    uuid := _employee_id;
  v_rel   text[];
  v_e     public.employees%rowtype;
  v_p     public.profiles%rowtype;
  v_inv   public.invitations%rowtype;
  v_card  jsonb;
  v_st    public.employee_statutory%rowtype;
  v_bk    public.employee_bank%rowtype;
  self_   boolean;
  admin_  boolean;
  pay_    boolean;
  stat_   boolean;
  appr_   boolean;
begin
  if v_uid is null or v_org is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;
  if not public.module_enabled_for(v_org, 'employee') then
    raise exception 'MODULE_NOT_ENABLED' using errcode = 'P0001';
  end if;

  if v_id is null then
    select id into v_id from public.employees
     where profile_id = v_uid and organization_id = v_org and deleted_at is null;
  end if;

  v_rel := public.employee_relationship(v_id);
  -- Absent and other-organisation answer identically: NOT_FOUND, never
  -- FORBIDDEN, so the card cannot be used to test whether an id exists
  -- somewhere else (D40's rule, applied to records).
  if v_rel is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  self_  := 'self' = any (v_rel);
  admin_ := 'admin' = any (v_rel);
  pay_   := 'payroll' = any (v_rel);
  stat_  := 'statutory' = any (v_rel);
  appr_  := 'approver' = any (v_rel);

  select * into v_e from public.employees where id = v_id;
  select * into v_p from public.profiles where id = v_e.profile_id;
  select * into v_inv from public.invitations where id = v_e.invitation_id;

  -- ── everybody in the organisation: who they are and where they work
  v_card := jsonb_build_object(
    'id',            v_e.id,
    'employeeCode',  v_e.employee_code,
    'fullName',      coalesce(v_p.full_name, v_inv.full_name),
    'workEmail',     coalesce(v_p.email, v_inv.email),
    'mobile',        coalesce(v_p.phone, v_inv.phone),
    'alternateMobile', v_e.alternate_mobile,
    'status',        v_e.status,
    'isActive',      coalesce(v_p.is_active, false),
    'hasSignedIn',   v_p.id is not null,
    'dateOfJoining', coalesce(v_p.joined_date, v_inv.joined_date),
    'designation',   (select jsonb_build_object('id', d.id, 'name', d.name, 'grade', d.grade)
                        from public.designations d where d.id = v_e.designation_id),
    'department',    (select jsonb_build_object('id', d.id, 'name', d.name)
                        from public.departments d where d.id = v_p.department_id),
    'reportsTo',     (select jsonb_build_object('id', me.id, 'fullName', m.full_name)
                        from public.profiles m
                        left join public.employees me on me.profile_id = m.id
                       where m.id = v_p.manager_id),
    'directReportCount', (select count(*) from public.profiles r
                           where r.manager_id = v_p.id and r.deleted_at is null and r.is_active),
    'currentDeployment', (select jsonb_build_object(
                              'unitId', u.id, 'unitName', u.name, 'unitType', u.unit_type,
                              'effectiveFrom', d.effective_from)
                            from public.employee_deployments d
                            join public.deployment_units u on u.id = d.deployment_unit_id
                           where d.employee_id = v_e.id and d.effective_to is null
                             and d.effective_from <= public.org_today(v_org)
                           order by d.effective_from desc limit 1),
    'relationship',  to_jsonb(v_rel)
  );

  -- ── self, admin, payroll, statutory, and their approver: the work record
  if self_ or admin_ or pay_ or stat_ or appr_ then
    v_card := v_card || jsonb_build_object(
      'totalExperienceMonths', public.employee_experience_months(v_e.id),
      'employmentType',  v_e.employment_type,
      'confirmedOn',     v_e.confirmed_on
    );
  end if;

  -- ── self and admin: identity, employment detail, contact beyond the work one
  if self_ or admin_ then
    v_card := v_card || jsonb_build_object(
      'nameAsPerId',     v_e.name_as_per_id,
      'sex',             v_e.sex,
      'dateOfBirth',     v_e.date_of_birth,
      'age',             public.employee_age(v_e.date_of_birth, v_org),
      'maritalStatus',   v_e.marital_status,
      'nationality',     v_e.nationality,
      'nativeState',     v_e.native_state,
      'bloodGroup',      v_e.blood_group,
      'educationQualification', v_e.education_qualification,
      'personalEmail',   v_e.personal_email,
      'reJoiningDate',   v_e.re_joining_date,
      'terminationDate', v_e.termination_date,
      'terminationReason', v_e.termination_reason,
      'reasonForLeavingLastOrg', v_e.reason_for_leaving_last_org,
      'physical', jsonb_build_object('heightCm', v_e.height_cm, 'chestCm', v_e.chest_cm,
                                     'weightKg', v_e.weight_kg),
      'previousOrganisations', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', po.id, 'organisationName', po.organisation_name,
                 'designation', po.designation, 'fromDate', po.from_date, 'toDate', po.to_date,
                 'reasonForLeaving', po.reason_for_leaving) order by po.from_date desc)
          from public.previous_organisations po where po.employee_id = v_e.id), '[]'::jsonb)
    );
  end if;

  -- ── self, admin and their approver: who to call in an emergency
  if self_ or admin_ or appr_ then
    v_card := v_card || jsonb_build_object(
      'emergencyContact', jsonb_build_object(
        'name', v_e.emergency_contact_name,
        'relation', v_e.emergency_contact_relation,
        'phone', v_e.emergency_contact_phone)
    );
  end if;

  -- ── self, admin, statutory: police station, and every address ever held
  if self_ or admin_ or stat_ then
    v_card := v_card || jsonb_build_object(
      'nearestPoliceStation', v_e.nearest_police_station,
      'addresses', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', a.id, 'addressType', a.address_type, 'line', a.line, 'city', a.city,
                 'district', a.district, 'state', a.state, 'pincode', a.pincode,
                 'nearestPoliceStation', a.nearest_police_station,
                 'effectiveFrom', a.effective_from, 'effectiveTo', a.effective_to,
                 'recordedBy', (select coalesce(full_name, email) from public.profiles where id = a.created_by),
                 'recordedAt', a.created_at)
               -- Open rows first, then newest first (§2).
               order by (a.effective_to is not null), a.effective_from desc)
          from public.employee_addresses a where a.employee_id = v_e.id), '[]'::jsonb)
    );
  end if;

  -- ── self, admin, payroll, statutory: family and nominations
  if self_ or admin_ or pay_ or stat_ then
    v_card := v_card || jsonb_build_object(
      'familyMembers', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', f.id, 'relation', f.relation, 'name', f.name,
                 'dateOfBirth', f.date_of_birth, 'isDependent', f.is_dependent)
               order by f.sort_order, f.created_at)
          from public.family_members f where f.employee_id = v_e.id), '[]'::jsonb),
      'nominations', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', nv.id, 'scheme', nv.scheme,
                 'effectiveFrom', nv.effective_from, 'effectiveTo', nv.effective_to,
                 'nominees', (select coalesce(jsonb_agg(jsonb_build_object(
                                 'id', n.id, 'name', n.name, 'relation', n.relation,
                                 'dateOfBirth', n.date_of_birth, 'sharePercent', n.share_percent)
                               order by n.share_percent desc, n.name), '[]'::jsonb)
                                from public.nominees n where n.version_id = nv.id))
               order by (nv.effective_to is not null), nv.effective_from desc)
          from public.nomination_versions nv where nv.employee_id = v_e.id), '[]'::jsonb)
    );
  end if;

  -- ── deployments: the whole history for these, only the current one above
  --    for an approver and everybody else (§5)
  if self_ or admin_ or pay_ or stat_ then
    v_card := v_card || jsonb_build_object(
      'deployments', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', d.id, 'unitId', u.id, 'unitName', u.name, 'unitType', u.unit_type,
                 'unitRetired', u.status = 'retired',
                 'effectiveFrom', d.effective_from, 'effectiveTo', d.effective_to,
                 'deploymentOrderRef', d.deployment_order_ref,
                 'expectedDuration', d.expected_duration, 'reason', d.reason,
                 'movedBy', (select coalesce(full_name, email) from public.profiles where id = d.created_by))
               order by (d.effective_to is not null), d.effective_from desc)
          from public.employee_deployments d
          join public.deployment_units u on u.id = d.deployment_unit_id
         where d.employee_id = v_e.id), '[]'::jsonb)
    );
  end if;

  -- ── what the screen may offer. The database still refuses every write it
  --    does not allow; this only stops the screen offering a dead control.
  -- ── E6: statutory numbers, verification, bank, restricted (§5, D80).
  --    Last-four for self and Admin; UAN, EPF and ESIC in full for Payroll
  --    and Statutory; Aadhaar, PAN and the account in full only through
  --    employee_reveal_restricted().
  select * into v_st from public.employee_statutory where employee_id = v_e.id;
  if self_ or admin_ or pay_ or stat_ then
    v_card := v_card || jsonb_build_object('statutory', jsonb_build_object(
      'recorded',             v_st.employee_id is not null,
      'identityDocumentType', v_st.identity_document_type,
      'aadhaarLast4',         v_st.aadhaar_last4,
      'panLast4',             v_st.pan_last4,
      'verifiedOn',           v_st.verified_on,
      'uanLast4',             v_st.uan_last4,
      'epfLast4',             v_st.epf_last4,
      'esicLast4',            v_st.esic_last4,
      'oldUanLast4',          v_st.old_uan_last4,
      'oldEsicLast4',         v_st.old_esic_last4
    ) || case when pay_ or stat_ then jsonb_build_object(
      'uan',           public.restricted_decrypt(v_st.uan_cipher),
      'epfNumber',     public.restricted_decrypt(v_st.epf_cipher),
      'esicNumber',    public.restricted_decrypt(v_st.esic_cipher),
      'oldUan',        public.restricted_decrypt(v_st.old_uan_cipher),
      'oldEsicNumber', public.restricted_decrypt(v_st.old_esic_cipher)
    ) else '{}'::jsonb end);
  end if;

  if self_ or admin_ or stat_ then
    v_card := v_card || jsonb_build_object('verification', jsonb_build_object(
      'policeVerification',    coalesce(v_st.police_verification, 'not_started'),
      'policeVerifiedOn',      v_st.police_verified_on,
      'previousEmployerCheck', coalesce(v_st.previous_employer_check, 'not_started'),
      'educationCheck',        coalesce(v_st.education_check, 'not_started'),
      'reverificationDue',     v_st.reverification_due
    ));
  end if;

  -- Bank: the person themselves (last four) and Payroll. Not Admin, not
  -- Statutory (§5: "two rows where Admin sees less than expected").
  if self_ or pay_ then
    select * into v_bk from public.employee_bank where employee_id = v_e.id;
    v_card := v_card || jsonb_build_object('bank', jsonb_build_object(
      'recorded',        v_bk.employee_id is not null,
      'bankName',        v_bk.bank_name,
      'ifsc',            v_bk.ifsc,
      'accountLast4',    v_bk.account_last4,
      'pennyDropStatus', coalesce(v_bk.penny_drop_status, 'not_checked')
    ) || case when pay_ then jsonb_build_object(
      'branch',        v_bk.branch,
      'accountHolder', v_bk.account_holder
    ) else '{}'::jsonb end);
  end if;

  -- Restricted: only whether anything is held. The values come by reveal.
  if self_ or stat_ then
    v_card := v_card || jsonb_build_object('restricted', jsonb_build_object(
      'recorded', exists (select 1 from public.employee_restricted where employee_id = v_e.id)));
  end if;

  v_card := v_card || jsonb_build_object('capabilities', jsonb_build_object(
    'canEdit', admin_,
    'canRequestChange', self_ and not admin_,
    'canSeeHistory', self_ or admin_ or pay_ or stat_,
    'canRevealStatutory', stat_,
    'canRevealBank', pay_,
    'canRevealRestricted', stat_ or self_,
    'canEditStatutory', admin_ or stat_,
    'canEditVerification', admin_,
    'canEditBank', pay_,
    'canEditRestricted', stat_,
    'canSeeReveals', self_ or stat_ or public.is_super_admin()
  ));

  return v_card;
end $$;

comment on function public.employee_card is
  'E5 — one person''s record, shaped by the caller''s relationship to them (NEUVTO_EMPLOYEE_MASTER §5). Blocks a role may not see are absent from the JSON, not nulled. NOT_FOUND for absent and for other organisations alike.';

revoke all on function public.employee_card(uuid) from public, anon;
grant execute on function public.employee_card(uuid) to authenticated;
