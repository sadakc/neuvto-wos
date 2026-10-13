-- NEUVTO WOS — Sada's second round (D104): experience before joining, and Indian by default
--
-- Raises on the first violation. Silence means pass. Rolled back.
--
-- PHASE-AWARE: exits quietly if employees.prior_experience_months does not exist yet.
--
--   the value     an Admin sets experience before joining in months, through
--                 the card's writer; a negative or over-sixty-years value, or
--                 text, is refused and named; nobody else can set it;
--   the total     when set it stands in for the previous organisations' sum,
--                 service here is still added, and clearing it brings the
--                 previous organisations back;
--   the card      the Admin and the person see it; a colleague does not;
--   nationality   a new record starts as Indian; an existing one is untouched.

begin;

create or replace function pg_temp.sr_as(_uid uuid) returns void as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', _uid::text, 'role', 'authenticated')::text, true);
end $$ language plpgsql;

create or replace function pg_temp.sr_root() returns void as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$ language plpgsql;

/** Refused, and for the named reason: the message, its detail or the rule it broke. */
create or replace function pg_temp.sr_refused(_label text, _uid uuid, _sql text, _needle text)
returns void as $$
declare v_msg text; v_detail text; v_rule text;
begin
  if _uid is null then perform pg_temp.sr_root(); else perform pg_temp.sr_as(_uid); end if;
  begin
    execute _sql;
  exception when others then
    get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail, v_rule = constraint_name;
  end;
  perform pg_temp.sr_root();
  if v_msg is null then
    raise exception 'ROUND2 FAIL: % — it was allowed', _label;
  end if;
  if concat_ws(' ', v_msg, v_detail, v_rule) not ilike '%' || _needle || '%' then
    raise exception 'ROUND2 FAIL: % — refused for the wrong reason: % / % / %', _label, v_msg, v_detail, v_rule;
  end if;
  raise notice 'ok: %', _label;
end $$ language plpgsql;

create or replace function pg_temp.sr_do(_uid uuid, _sql text) returns void as $$
begin
  perform pg_temp.sr_as(_uid);
  execute _sql;
  perform pg_temp.sr_root();
exception when others then
  perform pg_temp.sr_root();
  raise exception 'ROUND2 FAIL: refused: % — %', _sql, sqlerrm;
end $$ language plpgsql;

create or replace function pg_temp.sr_val(_uid uuid, _sql text) returns text as $$
declare v text;
begin
  perform pg_temp.sr_as(_uid);
  execute _sql into v;
  perform pg_temp.sr_root();
  return v;
exception when others then
  perform pg_temp.sr_root();
  raise exception 'ROUND2 FAIL: refused: % — %', _sql, sqlerrm;
end $$ language plpgsql;

do $$
declare
  acme    uuid := '00000000-0000-0000-0000-0000000000a0';
  hema    uuid := '00000000-0000-0000-0000-00000000a002';
  ravi    uuid := '00000000-0000-0000-0000-00000000a005';
  priya   uuid := '00000000-0000-0000-0000-00000000a006';
  e_priya uuid; e_draft uuid;
  service int; total int; seen text;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'employees'
                    and column_name = 'prior_experience_months') then
    raise notice 'skip: experience before joining does not exist yet';
    return;
  end if;

  insert into public.organization_modules (organization_id, module_key, enabled, enabled_at)
  values (acme, 'employee', true, now())
  on conflict (organization_id, module_key) do update set enabled = true, deleted_at = null;
  select id into e_priya from public.employees where profile_id = priya;

  -- Two years at a previous employer, so the sum it stands in for is known.
  delete from public.previous_organisations where employee_id = e_priya;
  insert into public.previous_organisations (organization_id, employee_id, organisation_name, from_date, to_date)
  values (acme, e_priya, 'G4S', date '2020-01-01', date '2022-01-01');
  update public.employees set prior_experience_months = null where id = e_priya;
  -- Service here, worked out apart from the function under test.
  select (extract(year from age(public.org_today(acme), coalesce(e.re_joining_date, p.joined_date))) * 12
          + extract(month from age(public.org_today(acme), coalesce(e.re_joining_date, p.joined_date))))::int
    into service
    from public.employees e join public.profiles p on p.id = e.profile_id
   where e.id = e_priya;
  if service is null or service < 1 then
    raise exception 'ROUND2 FAIL: the seed gives Priya % months of service; the test needs some', service;
  end if;
  if public.employee_experience_months(e_priya) <> 24 + service then
    raise exception 'ROUND2 FAIL: without it the total is %, not 24 before plus % here',
      public.employee_experience_months(e_priya), service;
  end if;
  raise notice 'ok: without it, the total is the previous organisations plus service here';

  -- ── 1 · the value, through the card's writer
  perform pg_temp.sr_do(hema, format($q$select public.employee_update(%L, '{"priorExperienceMonths":"30"}')$q$, e_priya));
  if (select prior_experience_months from public.employees where id = e_priya) is distinct from 30 then
    raise exception 'ROUND2 FAIL: thirty months were not stored';
  end if;
  raise notice 'ok: an Admin sets experience before joining, in months';

  perform pg_temp.sr_refused('more than sixty years is refused, and the rule named', hema,
    format($q$select public.employee_update(%L, '{"priorExperienceMonths":"721"}')$q$, e_priya),
    'employees_prior_experience_months_check');
  perform pg_temp.sr_refused('a negative experience is refused, and the rule named', hema,
    format($q$select public.employee_update(%L, '{"priorExperienceMonths":"-1"}')$q$, e_priya),
    'employees_prior_experience_months_check');
  perform pg_temp.sr_refused('text for a number of months is refused', hema,
    format($q$select public.employee_update(%L, '{"priorExperienceMonths":"two years"}')$q$, e_priya),
    'INVALID_VALUE');
  perform pg_temp.sr_refused('a colleague cannot set it', ravi,
    format($q$select public.employee_update(%L, '{"priorExperienceMonths":"5"}')$q$, e_priya),
    'FORBIDDEN');
  perform pg_temp.sr_refused('the person cannot set their own', priya,
    format($q$select public.employee_update(%L, '{"priorExperienceMonths":"500"}')$q$, e_priya),
    'FORBIDDEN');
  perform pg_temp.sr_refused('a write straight to the table is held to the range too', null,
    format('update public.employees set prior_experience_months = 1000 where id = %L', e_priya),
    'employees_prior_experience_months_check');
  if (select prior_experience_months from public.employees where id = e_priya) is distinct from 30 then
    raise exception 'ROUND2 FAIL: a refused write changed the value';
  end if;

  -- ── 2 · the total
  total := public.employee_experience_months(e_priya);
  if total <> 30 + service then
    raise exception 'ROUND2 FAIL: the total is % — expected 30 before joining plus % here', total, service;
  end if;
  raise notice 'ok: set, it stands in for the previous organisations, and service here is still added';

  perform pg_temp.sr_do(hema, format($q$select public.employee_update(%L, '{"priorExperienceMonths":null}')$q$, e_priya));
  if public.employee_experience_months(e_priya) <> 24 + service then
    raise exception 'ROUND2 FAIL: clearing it did not bring the previous organisations back';
  end if;
  raise notice 'ok: cleared, the previous organisations count again';

  -- ── 3 · the card
  perform pg_temp.sr_do(hema, format($q$select public.employee_update(%L, '{"priorExperienceMonths":"14"}')$q$, e_priya));
  seen := pg_temp.sr_val(hema, format($q$select public.employee_card(%L) ->> 'priorExperienceMonths'$q$, e_priya));
  if seen is distinct from '14' then
    raise exception 'ROUND2 FAIL: the Admin''s card says % for experience before joining', seen;
  end if;
  seen := pg_temp.sr_val(priya, format($q$select public.employee_card(%L) ->> 'priorExperienceMonths'$q$, e_priya));
  if seen is distinct from '14' then
    raise exception 'ROUND2 FAIL: the person''s own card says % for experience before joining', seen;
  end if;
  seen := pg_temp.sr_val(ravi, format($q$select (public.employee_card(%L) ? 'priorExperienceMonths')::text$q$, e_priya));
  if seen is distinct from 'false' then
    raise exception 'ROUND2 FAIL: a colleague''s card carries experience before joining';
  end if;
  raise notice 'ok: the Admin and the person see it; a colleague does not';

  -- ── 4 · nationality starts as Indian, for a new record only
  e_draft := pg_temp.sr_val(hema, $q$select public.employee_create_draft('{"fullName":"Deepak Dummy"}')::text$q$)::uuid;
  if (select nationality from public.employees where id = e_draft) is distinct from 'Indian' then
    raise exception 'ROUND2 FAIL: a new record starts as %, not Indian',
      (select nationality from public.employees where id = e_draft);
  end if;
  update public.employees set nationality = null where id = e_priya;
  perform pg_temp.sr_do(hema, format($q$select public.employee_update(%L, '{"bloodGroup":"O+"}')$q$, e_priya));
  if (select nationality from public.employees where id = e_priya) is not null then
    raise exception 'ROUND2 FAIL: saving another field filled in a nationality nobody chose';
  end if;
  raise notice 'ok: a new record starts as Indian; an existing empty one stays empty until saved';
end $$;

rollback;
