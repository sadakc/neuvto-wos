-- NEUVTO WOS — one person, one record (D117)
--
-- Raises on the first violation. Silence means pass. Rolled back.
--
-- PHASE-AWARE: exits quietly if employee_write_nomination does not exist yet.
--
--   family     one father and one mother, never a second;
--   nominees   a nominee is a family member: picked by id, matched by relation
--              for a parent, or added to Family when new; what is typed for a
--              nominee is written back to Family;
--   follows    a change in Family re-issues the current nomination from today,
--              the old version kept as it was declared;
--   defaults   Reports to is optional (the CEO reports to nobody);
--   licence    any state's code, never letters that are no state.

begin;

create or replace function pg_temp.op_as(_uid uuid) returns void as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', _uid::text, 'role', 'authenticated')::text, true);
end $$ language plpgsql;

create or replace function pg_temp.op_root() returns void as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$ language plpgsql;

/** Refused, and for the named reason: the message or its detail. */
create or replace function pg_temp.op_refused(_label text, _uid uuid, _sql text, _needle text)
returns void as $$
declare v_msg text; v_detail text;
begin
  if _uid is null then perform pg_temp.op_root(); else perform pg_temp.op_as(_uid); end if;
  begin
    execute _sql;
  exception when others then
    get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
  end;
  perform pg_temp.op_root();
  if v_msg is null then
    raise exception 'ONE-PERSON FAIL: % — it was allowed', _label;
  end if;
  if concat_ws(' ', v_msg, v_detail) not ilike '%' || _needle || '%' then
    raise exception 'ONE-PERSON FAIL: % — refused for the wrong reason: % / %', _label, v_msg, v_detail;
  end if;
  raise notice 'ok: %', _label;
end $$ language plpgsql;

create or replace function pg_temp.op_do(_label text, _uid uuid, _sql text) returns void as $$
begin
  perform pg_temp.op_as(_uid);
  execute _sql;
  perform pg_temp.op_root();
  raise notice 'ok: %', _label;
exception when others then
  perform pg_temp.op_root();
  raise exception 'ONE-PERSON FAIL: % — refused: %', _label, sqlerrm;
end $$ language plpgsql;

create or replace function pg_temp.op_val(_uid uuid, _sql text) returns text as $$
declare v text;
begin
  perform pg_temp.op_as(_uid);
  execute _sql into v;
  perform pg_temp.op_root();
  return v;
exception when others then
  perform pg_temp.op_root();
  raise exception 'ONE-PERSON FAIL: refused: % — %', _sql, sqlerrm;
end $$ language plpgsql;

create or replace function pg_temp.op_check(_label text, _got text, _want text) returns void as $$
begin
  if _got is distinct from _want then
    raise exception 'ONE-PERSON FAIL: % — got %, wanted %', _label, _got, _want;
  end if;
  raise notice 'ok: %', _label;
end $$ language plpgsql;


do $$
declare
  acme    uuid := '00000000-0000-0000-0000-0000000000a0';
  hema    uuid := '00000000-0000-0000-0000-00000000a002';  -- Employee Admin
  priya   uuid := '00000000-0000-0000-0000-00000000a006';
  e_priya uuid;
  v_father uuid;
  v_old   uuid;
  v_new   uuid;
  n       integer;
  v_rows  jsonb;
begin
  if to_regprocedure('public.employee_write_nomination(uuid,jsonb)') is null then
    raise notice 'skip: no family and nominee link yet';
    return;
  end if;

  insert into public.organization_modules (organization_id, module_key, enabled, enabled_at)
  values (acme, 'employee', true, now())
  on conflict (organization_id, module_key) do update set enabled = true, deleted_at = null;
  delete from public.employee_field_settings where organization_id = acme;
  select id into e_priya from public.employees where profile_id = priya;
  perform set_config('neuvto.purge', 'on', true);
  delete from public.nominees where version_id in (select id from public.nomination_versions where employee_id = e_priya);
  delete from public.nomination_versions where employee_id = e_priya;
  delete from public.family_members where employee_id = e_priya;
  perform set_config('neuvto.purge', '', true);

  -- ── family: one father, one mother
  perform pg_temp.op_do('a father and a mother are saved', hema, format($q$select public.employee_save_family(%L,
    '[{"relation":"father","name":"Ramesh","dateOfBirth":"1960-05-01"},{"relation":"mother","name":"Sita","dateOfBirth":"1963-02-10"}]')$q$, e_priya));
  perform pg_temp.op_refused('a second father is refused, and named', hema, format($q$select public.employee_save_family(%L,
    '[{"relation":"father","name":"Ramesh"},{"relation":"father","name":"Suresh"}]')$q$, e_priya), 'ONE_PARENT_EACH');
  perform pg_temp.op_refused('and a second mother', hema, format($q$select public.employee_save_family(%L,
    '[{"relation":"mother","name":"Sita"},{"relation":"mother","name":"Gita"}]')$q$, e_priya), 'mother');
  -- What the screen would send, read as the owner: the person cannot read the table directly.
  select jsonb_agg(jsonb_build_object('id', id, 'relation', relation, 'name', name, 'dateOfBirth', date_of_birth))
    into v_rows from public.family_members where employee_id = e_priya;
  perform pg_temp.op_do('two sons are fine', hema, format($q$select public.employee_save_family(%L, %L)$q$,
    e_priya, v_rows || '[{"relation":"son","name":"Arjun"},{"relation":"son","name":"Karan"}]'::jsonb));
  select id into v_father from public.family_members where employee_id = e_priya and relation = 'father';

  -- ── a nominee is a family member
  perform pg_temp.op_do('a father nominated with another date of birth', hema, format($q$select public.employee_save_nomination(%L,
    '{"nominees":[{"name":"Ramesh","relation":"father","dateOfBirth":"1960-06-15","sharePercent":100}]}')$q$, e_priya));
  perform pg_temp.op_check('the nominee is the family''s father, matched by relation',
    (select family_member_id::text from public.nominees n join public.nomination_versions v on v.id = n.version_id
      where v.employee_id = e_priya and v.effective_to is null), v_father::text);
  perform pg_temp.op_check('and Family took the date typed for the nominee: one father, one date',
    (select date_of_birth::text from public.family_members where id = v_father), '1960-06-15');
  perform pg_temp.op_check('still one father',
    (select count(*)::text from public.family_members where employee_id = e_priya and relation = 'father'), '1');

  perform pg_temp.op_do('a brother nominated, not yet in Family', hema, format($q$select public.employee_save_nomination(%L,
    '{"nominees":[{"name":"Ramesh","relation":"father","dateOfBirth":"1960-06-15","sharePercent":60},
                  {"name":"Vikram","relation":"brother","dateOfBirth":"1990-01-01","sharePercent":40}]}')$q$, e_priya));
  perform pg_temp.op_check('the brother is added to Family',
    (select count(*)::text from public.family_members where employee_id = e_priya and relation = 'brother' and name = 'Vikram'), '1');
  perform pg_temp.op_check('and the nominee is linked to him',
    (select (n.family_member_id = f.id)::text from public.nominees n
       join public.nomination_versions v on v.id = n.version_id
       join public.family_members f on f.employee_id = e_priya and f.relation = 'brother'
      where v.employee_id = e_priya and v.effective_to is null and n.relation = 'brother'), 'true');
  perform pg_temp.op_check('saved the same day, it was a correction: one nomination still',
    (select count(*)::text from public.nomination_versions where employee_id = e_priya), '1');

  perform pg_temp.op_do('a son picked from Family by id', hema, format($q$select public.employee_save_nomination(%L, %L)$q$,
    e_priya, jsonb_build_object('nominees', jsonb_build_array(jsonb_build_object('name', 'Arjun', 'relation', 'son',
      'familyMemberId', (select id from public.family_members where employee_id = e_priya and name = 'Arjun'), 'sharePercent', 100)))));
  perform pg_temp.op_check('is linked to that son, not to Karan',
    (select f.name from public.nominees n join public.nomination_versions v on v.id = n.version_id
       join public.family_members f on f.id = n.family_member_id
      where v.employee_id = e_priya and v.effective_to is null), 'Arjun');
  perform pg_temp.op_check('and Family still has him once',
    (select count(*)::text from public.family_members where employee_id = e_priya and name = 'Arjun'), '1');

  -- ── a change in Family re-issues the nomination, the old one kept
  -- An older nomination, made ten days ago, of the father. The shares check is
  -- left immediate by the saves above; the clean-up is one change, checked at the end.
  set constraints nominee_shares_add_up deferred;
  perform set_config('neuvto.purge', 'on', true);
  delete from public.nominees where version_id in (select id from public.nomination_versions where employee_id = e_priya);
  delete from public.nomination_versions where employee_id = e_priya;
  perform set_config('neuvto.purge', '', true);
  perform public.employee_write_nomination(e_priya, jsonb_build_object(
    'effectiveFrom', current_date - 10,
    'nominees', jsonb_build_array(jsonb_build_object('name', 'Ramesh', 'relation', 'father',
      'dateOfBirth', '1960-06-15', 'sharePercent', 100, 'familyMemberId', v_father))));
  select id into v_old from public.nomination_versions where employee_id = e_priya and effective_to is null;
  select jsonb_agg(case when relation = 'father' then jsonb_build_object('id', id, 'relation', relation, 'name', name, 'dateOfBirth', '1960-07-20')
                        else jsonb_build_object('id', id, 'relation', relation, 'name', name, 'dateOfBirth', date_of_birth) end)
    into v_rows from public.family_members where employee_id = e_priya;
  perform pg_temp.op_do('the father''s date of birth corrected in Family', hema,
    format($q$select public.employee_save_family(%L, %L)$q$, e_priya, v_rows));
  select id into v_new from public.nomination_versions where employee_id = e_priya and effective_to is null;
  perform pg_temp.op_check('a new nomination stands, with the corrected date',
    (select date_of_birth::text from public.nominees where version_id = v_new), '1960-07-20');
  perform pg_temp.op_check('the old one is closed, not edited, as it was declared',
    (select (v_new <> v_old)::text || '/' || (select effective_to is not null from public.nomination_versions where id = v_old)::text
       || '/' || (select date_of_birth::text from public.nominees where version_id = v_old)), 'true/true/1960-06-15');
  select count(*) into n from public.nomination_versions where employee_id = e_priya;
  v_old := v_new;
  select jsonb_agg(jsonb_build_object('id', id, 'relation', relation, 'name', name, 'dateOfBirth', date_of_birth))
    into v_rows from public.family_members where employee_id = e_priya;
  perform pg_temp.op_do('a Family save that changes no nominee', hema,
    format($q$select public.employee_save_family(%L, %L)$q$, e_priya, v_rows));
  perform pg_temp.op_check('issues no new nomination',
    (select count(*)::text from public.nomination_versions where employee_id = e_priya), n::text);
  perform pg_temp.op_check('and leaves the one in force as it was',
    (select id::text from public.nomination_versions where employee_id = e_priya and effective_to is null), v_old::text);

  -- ── Reports to is optional
  perform pg_temp.op_check('Reports to is not required by default',
    (select required::text from public.employee_field_defaults() where field_key = 'reportsTo'), 'false');

  -- ── a licence from any state
  perform pg_temp.op_do('a Maharashtra licence is accepted', hema, format($q$select public.employee_set_statutory(%L, '{"drivingLicence":"MH12 20110012345"}')$q$, e_priya));
  perform pg_temp.op_do('and a Rajasthan one', hema, format($q$select public.employee_set_statutory(%L, '{"drivingLicence":"RJ14 20150067890"}')$q$, e_priya));
  perform pg_temp.op_refused('letters that are no state are refused', hema,
    format($q$select public.employee_set_statutory(%L, '{"drivingLicence":"XX12 20110012345"}')$q$, e_priya), 'INVALID_LICENCE');

  raise notice 'one person, one record: all checks passed';
end $$;

rollback;
