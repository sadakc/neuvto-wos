-- NEUVTO WOS — Sada's fourth round (D106): designations in the company's order
--
-- Raises on the first violation. Silence means pass. Rolled back.
--
-- PHASE-AWARE: exits quietly if designations.rank does not exist yet.
--
--   ordering   an Admin puts the whole list in order; a partial list, one
--              named twice, or another company's designation is refused, and
--              so is anybody who is not an Admin;
--   new ones   join at the bottom.

begin;

create or replace function pg_temp.fr_as(_uid uuid) returns void as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', _uid::text, 'role', 'authenticated')::text, true);
end $$ language plpgsql;

create or replace function pg_temp.fr_root() returns void as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$ language plpgsql;

/** Refused, and for the named reason: the message, its detail or the rule it broke. */
create or replace function pg_temp.fr_refused(_label text, _uid uuid, _sql text, _needle text)
returns void as $$
declare v_msg text; v_detail text; v_rule text;
begin
  if _uid is null then perform pg_temp.fr_root(); else perform pg_temp.fr_as(_uid); end if;
  begin
    execute _sql;
  exception when others then
    get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail, v_rule = constraint_name;
  end;
  perform pg_temp.fr_root();
  if v_msg is null then
    raise exception 'ROUND4 FAIL: % — it was allowed', _label;
  end if;
  if concat_ws(' ', v_msg, v_detail, v_rule) not ilike '%' || _needle || '%' then
    raise exception 'ROUND4 FAIL: % — refused for the wrong reason: % / % / %', _label, v_msg, v_detail, v_rule;
  end if;
  raise notice 'ok: %', _label;
end $$ language plpgsql;

create or replace function pg_temp.fr_do(_uid uuid, _sql text) returns void as $$
begin
  perform pg_temp.fr_as(_uid);
  execute _sql;
  perform pg_temp.fr_root();
exception when others then
  perform pg_temp.fr_root();
  raise exception 'ROUND4 FAIL: refused: % — %', _sql, sqlerrm;
end $$ language plpgsql;

create or replace function pg_temp.fr_val(_uid uuid, _sql text) returns text as $$
declare v text;
begin
  perform pg_temp.fr_as(_uid);
  execute _sql into v;
  perform pg_temp.fr_root();
  return v;
exception when others then
  perform pg_temp.fr_root();
  raise exception 'ROUND4 FAIL: refused: % — %', _sql, sqlerrm;
end $$ language plpgsql;

do $$
declare
  acme  uuid := '00000000-0000-0000-0000-0000000000a0';
  vertex uuid := '00000000-0000-0000-0000-0000000000b0';
  hema  uuid := '00000000-0000-0000-0000-00000000a002';
  ravi  uuid := '00000000-0000-0000-0000-00000000a005';
  ids uuid[]; rev uuid[]; foreign_id uuid; new_id uuid; seen text;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'designations' and column_name = 'rank') then
    raise notice 'skip: designations have no rank yet';
    return;
  end if;

  insert into public.organization_modules (organization_id, module_key, enabled, enabled_at)
  values (acme, 'employee', true, now())
  on conflict (organization_id, module_key) do update set enabled = true, deleted_at = null;

  -- Three of its own, whatever the seed holds; the trigger ranks them in turn.
  insert into public.designations (organization_id, name)
  values (acme, 'R4 Manager'), (acme, 'R4 Supervisor'), (acme, 'R4 Guard');
  select array_agg(id order by rank) into ids from public.designations
   where organization_id = acme and deleted_at is null;
  if coalesce(cardinality(ids), 0) < 3 then raise exception 'ROUND4 FAIL: no designations to order'; end if;
  if (select count(distinct rank) from public.designations where organization_id = acme) <> cardinality(ids) then
    raise exception 'ROUND4 FAIL: existing designations do not each have their own rank';
  end if;
  select array_agg(x order by o desc) into rev from unnest(ids) with ordinality t(x, o);
  select id into foreign_id from public.designations where organization_id = vertex limit 1;
  if foreign_id is null then
    insert into public.designations (organization_id, name) values (vertex, 'R4 Vertex Guard') returning id into foreign_id;
  end if;

  perform pg_temp.fr_refused('somebody who is not an Admin cannot reorder', ravi,
    format('select public.employee_rank_designations(%L::uuid[])', rev), 'FORBIDDEN');
  perform pg_temp.fr_refused('a list missing one is refused', hema,
    format('select public.employee_rank_designations(%L::uuid[])', rev[1:cardinality(rev) - 1]), 'ORDER_INCOMPLETE');
  perform pg_temp.fr_refused('a list naming one twice is refused', hema,
    format('select public.employee_rank_designations(%L::uuid[])', rev[1:cardinality(rev) - 1] || rev[1]), 'ORDER_INCOMPLETE');
  perform pg_temp.fr_refused('the whole list with one named twice is refused', hema,
    format('select public.employee_rank_designations(%L::uuid[])', rev || rev[1]), 'ORDER_INCOMPLETE');
  perform pg_temp.fr_refused('another company''s designation is refused', hema,
    format('select public.employee_rank_designations(%L::uuid[])', rev[1:cardinality(rev) - 1] || foreign_id), 'ORDER_INCOMPLETE');
  if (select array_agg(id order by rank) from public.designations where organization_id = acme and deleted_at is null) <> ids then
    raise exception 'ROUND4 FAIL: a refused reorder changed the order';
  end if;

  perform pg_temp.fr_do(hema, format('select public.employee_rank_designations(%L::uuid[])', rev));
  if (select array_agg(id order by rank) from public.designations where organization_id = acme and deleted_at is null) <> rev then
    raise exception 'ROUND4 FAIL: the new order was not kept';
  end if;
  if (select min(rank) from public.designations where organization_id = acme) <> 1 then
    raise exception 'ROUND4 FAIL: the top is not rank 1';
  end if;
  raise notice 'ok: an Admin puts the whole list in order, and only the whole list';

  new_id := pg_temp.fr_val(hema, $q$select public.employee_save_designation(null, '{"name":"R4 Trainee"}')::text$q$)::uuid;
  if (select rank from public.designations where id = new_id)
     <> (select max(rank) from public.designations where organization_id = acme) then
    raise exception 'ROUND4 FAIL: a new designation did not join at the bottom';
  end if;
  if (select rank from public.designations where id = foreign_id) is null then
    raise exception 'ROUND4 FAIL: another company''s designation has no rank';
  end if;
  raise notice 'ok: a new designation joins at the bottom';
end $$;

rollback;
