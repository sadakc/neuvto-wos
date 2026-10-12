-- ============================================================================
-- NEUVTO WOS — rotating the statutory key, and keeping reveals three years (D80)
-- ============================================================================
--
-- Two gaps E6 left in the build spec, closed before any real number is stored.
--
-- ROTATION. statutory_rotate_key() re-encrypts every restricted value and
-- recomputes every keyed index under a new key, in ONE transaction, then
-- swaps the Vault names so the new key is the one in use and the old one is
-- kept, renamed, for the backups that still need it. An operator runs it as
-- the database owner; nobody signed in can. Steps:
-- docs/operations/STATUTORY_DATA.md, "Rotating the key".
--
-- RETENTION. D80 keeps the reveal log three years. A daily job deletes rows
-- older than that. The append-only trigger gains exactly one escape for it:
-- a row older than three years, in a transaction that declared retention.
-- A younger row is refused even then, so the escape cannot be used to erase
-- a recent look.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════ retention

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
  if tg_op = 'DELETE'
     and current_setting('neuvto.retention', true) = 'on'
     and old.read_at < now() - interval '3 years' then
    return old;
  end if;
  raise exception 'REVEAL_LOG_IS_APPEND_ONLY' using errcode = 'P0001';
end $$;

create or replace function public.restricted_reads_prune()
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare n integer;
begin
  perform set_config('neuvto.retention', 'on', true);
  delete from public.restricted_reads where read_at < now() - interval '3 years';
  get diagnostics n = row_count;
  perform set_config('neuvto.retention', '', true);
  return n;
end $$;

comment on function public.restricted_reads_prune is
  'D80 — deletes reveal-log rows older than three years. Scheduled daily; never callable by a signed-in user.';

revoke all on function public.restricted_reads_prune() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule('neuvto-employee-reveal-retention')
    where exists (select 1 from cron.job where jobname = 'neuvto-employee-reveal-retention');
  -- 19:00 UTC, after the leave jobs. The rule is about age, so the hour only
  -- decides when, never what.
  perform cron.schedule(
    'neuvto-employee-reveal-retention',
    '0 19 * * *',
    $job$select public.restricted_reads_prune()$job$
  );
end $$;

-- ═══════════════════════════════════════════════════════════ rotation

-- The restricted tables audit which fields changed. A rotation changes every
-- cipher of every row without changing any value, so it would write one
-- meaningless audit row per person. It writes one summary row instead.
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
  if current_setting('neuvto.rotation', true) = 'on' then
    return coalesce(new, old);
  end if;
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

create or replace function public.statutory_rotate_key()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions, vault
as $$
declare
  v_old  text := public.statutory_key();
  v_new  text;
  v_old_id uuid;
  v_new_id uuid;
  n_st   integer;
  n_bank integer;
  n_res  integer;
  v_stamp text := to_char(now() at time zone 'utc', 'YYYYMMDD"T"HH24MISS');
begin
  select id, decrypted_secret into v_new_id, v_new from vault.decrypted_secrets
   where name = 'statutory_encryption_key_next' limit 1;
  if v_new is null or length(v_new) < 32 then
    raise exception 'NEXT_KEY_NOT_SET' using errcode = 'P0001',
      hint = 'Create the statutory_encryption_key_next Vault secret first. See docs/operations/STATUTORY_DATA.md.';
  end if;
  if v_new = v_old then
    raise exception 'NEXT_KEY_IS_THE_SAME' using errcode = 'P0001';
  end if;
  select id into v_old_id from vault.secrets where name = 'statutory_encryption_key';

  perform set_config('neuvto.rotation', 'on', true);

  update public.employee_statutory set
    uan_cipher      = case when uan_cipher is null then null else pgp_sym_encrypt(pgp_sym_decrypt(uan_cipher, v_old), v_new, 'cipher-algo=aes256') end,
    epf_cipher      = case when epf_cipher is null then null else pgp_sym_encrypt(pgp_sym_decrypt(epf_cipher, v_old), v_new, 'cipher-algo=aes256') end,
    esic_cipher     = case when esic_cipher is null then null else pgp_sym_encrypt(pgp_sym_decrypt(esic_cipher, v_old), v_new, 'cipher-algo=aes256') end,
    old_uan_cipher  = case when old_uan_cipher is null then null else pgp_sym_encrypt(pgp_sym_decrypt(old_uan_cipher, v_old), v_new, 'cipher-algo=aes256') end,
    old_esic_cipher = case when old_esic_cipher is null then null else pgp_sym_encrypt(pgp_sym_decrypt(old_esic_cipher, v_old), v_new, 'cipher-algo=aes256') end,
    aadhaar_cipher  = case when aadhaar_cipher is null then null else pgp_sym_encrypt(pgp_sym_decrypt(aadhaar_cipher, v_old), v_new, 'cipher-algo=aes256') end,
    aadhaar_index   = case when aadhaar_cipher is null then null else hmac(pgp_sym_decrypt(aadhaar_cipher, v_old), v_new || ':index', 'sha256') end,
    pan_cipher      = case when pan_cipher is null then null else pgp_sym_encrypt(pgp_sym_decrypt(pan_cipher, v_old), v_new, 'cipher-algo=aes256') end,
    pan_index       = case when pan_cipher is null then null else hmac(pgp_sym_decrypt(pan_cipher, v_old), v_new || ':index', 'sha256') end;
  get diagnostics n_st = row_count;

  update public.employee_bank set
    account_cipher = case when account_cipher is null then null else pgp_sym_encrypt(pgp_sym_decrypt(account_cipher, v_old), v_new, 'cipher-algo=aes256') end;
  get diagnostics n_bank = row_count;

  update public.employee_restricted set
    values_cipher = pgp_sym_encrypt(pgp_sym_decrypt(values_cipher, v_old), v_new, 'cipher-algo=aes256');
  get diagnostics n_res = row_count;

  -- The new key becomes the one in use; the old one is kept, renamed, because
  -- a backup taken before today is encrypted under it.
  perform vault.update_secret(v_old_id, null, 'statutory_encryption_key_retired_' || v_stamp,
                              'Retired by statutory_rotate_key. Needed only to read backups from before ' || v_stamp);
  perform vault.update_secret(v_new_id, null, 'statutory_encryption_key',
                              'D80 statutory encryption key, in use since ' || v_stamp);

  perform set_config('neuvto.rotation', '', true);

  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, before, after)
  select o.id, null, 'statutory_key.rotate', 'statutory_key', null, null,
         jsonb_build_object('rotatedAt', v_stamp)
    from public.organizations o
   where exists (select 1 from public.employee_statutory s where s.organization_id = o.id)
      or exists (select 1 from public.employee_bank b where b.organization_id = o.id)
      or exists (select 1 from public.employee_restricted r where r.organization_id = o.id);

  return jsonb_build_object('statutoryRows', n_st, 'bankRows', n_bank, 'restrictedRows', n_res,
                            'retiredKeyName', 'statutory_encryption_key_retired_' || v_stamp);
end $$;

comment on function public.statutory_rotate_key is
  'D80 — re-encrypts every restricted value and keyed index under statutory_encryption_key_next, in one transaction, then makes it the key in use and keeps the old one renamed. Operator only.';

revoke all on function public.statutory_rotate_key() from public, anon, authenticated;
