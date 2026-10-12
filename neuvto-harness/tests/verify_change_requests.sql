-- NEUVTO WOS — "Request a change" (E7)
--
-- Raises on the first violation. Silence means pass. Rolled back.
--
-- PHASE-AWARE: exits quietly if employee_request_change does not exist yet.

begin;

create or replace function pg_temp.cr_as(_uid uuid) returns void as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', _uid::text, 'role', 'authenticated')::text, true);
end $$ language plpgsql;

create or replace function pg_temp.cr_root() returns void as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$ language plpgsql;

create or replace function pg_temp.cr_refused(_label text, _uid uuid, _sql text, _needle text)
returns void as $$
declare v_msg text;
begin
  perform pg_temp.cr_as(_uid);
  begin
    execute _sql;
  exception when others then
    v_msg := sqlerrm;
  end;
  perform pg_temp.cr_root();
  if v_msg is null then
    raise exception 'CHANGE-REQUESTS FAIL: % — it was allowed', _label;
  end if;
  if v_msg not ilike '%' || _needle || '%' then
    raise exception 'CHANGE-REQUESTS FAIL: % — refused for the wrong reason: %', _label, v_msg;
  end if;
  raise notice 'ok: %', _label;
end $$ language plpgsql;

create or replace function pg_temp.cr_count(_uid uuid) returns integer as $$
declare n integer;
begin
  perform pg_temp.cr_as(_uid);
  select count(*) into n from public.employee_change_requests(null);
  perform pg_temp.cr_root();
  return n;
end $$ language plpgsql;

do $$
declare
  acme   uuid := '00000000-0000-0000-0000-0000000000a0';
  vertex uuid := '00000000-0000-0000-0000-0000000000b0';
  alice  uuid := '00000000-0000-0000-0000-00000000a001';
  hema   uuid := '00000000-0000-0000-0000-00000000a002';
  ravi   uuid := '00000000-0000-0000-0000-00000000a005';
  priya  uuid := '00000000-0000-0000-0000-00000000a006';
  bob    uuid := '00000000-0000-0000-0000-00000000b001';
  e      uuid;
  req    uuid;
  n      integer;
  i      integer;
begin
  if to_regprocedure('public.employee_request_change(uuid,text,text)') is null then
    raise notice 'skip: change requests do not exist yet';
    return;
  end if;

  insert into public.organization_modules (organization_id, module_key, enabled, enabled_at)
  values (acme, 'employee', true, now()), (vertex, 'employee', true, now())
  on conflict (organization_id, module_key) do update set enabled = true, deleted_at = null;
  select id into e from public.employees where profile_id = priya;
  delete from public.notifications;

  -- ── 1 · only the person asks, about themselves
  perform pg_temp.cr_refused('a colleague cannot ask on somebody''s behalf', ravi,
    format($q$select public.employee_request_change(%L, 'address', 'She moved')$q$, e), 'FORBIDDEN');
  perform pg_temp.cr_refused('nor can an Admin, who edits directly', hema,
    format($q$select public.employee_request_change(%L, 'address', 'She moved')$q$, e), 'FORBIDDEN');
  perform pg_temp.cr_refused('a blank request is refused', priya,
    format($q$select public.employee_request_change(%L, 'address', '  ')$q$, e), 'DETAILS_REQUIRED');
  perform pg_temp.cr_refused('a section off the list is refused', priya,
    format($q$select public.employee_request_change(%L, 'salary', 'More please')$q$, e), 'INVALID_VALUE');

  perform pg_temp.cr_as(priya);
  req := public.employee_request_change(e, 'address',
    'I moved to 9 Lake View, Hosur 635109 on 1 June.');
  perform pg_temp.cr_root();
  raise notice 'ok: the person asks for a change to their own record';

  -- ── 2 · every active admin of the company hears, and nobody else
  select count(*) into n from public.notifications
   where event_key = 'employee.change_requested' and status <> 'failed';
  if n <> (select count(distinct ur.user_id) from public.user_roles ur
            where ur.organization_id = acme and ur.deleted_at is null
              and ur.role in ('super_admin','org_admin','hr_admin')) then
    raise exception 'CHANGE-REQUESTS FAIL: % admins were told', n;
  end if;
  select count(*) into n from public.notifications
   where event_key = 'employee.change_requested'
     and (recipient_id = bob or recipient_id = ravi or status = 'failed');
  if n <> 0 then raise exception 'CHANGE-REQUESTS FAIL: the wrong people were told, or it failed'; end if;
  raise notice 'ok: the company''s admins are told, and nobody else';

  -- ── 3 · who sees which requests
  if pg_temp.cr_count(priya) <> 1 or pg_temp.cr_count(ravi) <> 0 or pg_temp.cr_count(hema) <> 1
     or pg_temp.cr_count(bob) <> 0 then
    raise exception 'CHANGE-REQUESTS FAIL: visibility is wrong (priya %, ravi %, hema %, bob %)',
      pg_temp.cr_count(priya), pg_temp.cr_count(ravi), pg_temp.cr_count(hema), pg_temp.cr_count(bob);
  end if;
  raise notice 'ok: the person sees theirs, an Admin sees the company''s, nobody else sees any';

  -- ── 4 · an Admin closes it, and the person is told
  perform pg_temp.cr_refused('a colleague cannot close it', ravi,
    format($q$select public.employee_resolve_change(%L, 'done')$q$, req), 'FORBIDDEN');
  perform pg_temp.cr_refused('another company cannot see it', bob,
    format($q$select public.employee_resolve_change(%L, 'done')$q$, req), 'NOT_FOUND');
  perform pg_temp.cr_refused('declining needs a reason', hema,
    format($q$select public.employee_resolve_change(%L, 'declined', '')$q$, req), 'REASON_REQUIRED');
  perform pg_temp.cr_as(hema);
  perform public.employee_resolve_change(req, 'done', 'Added from 1 June.');
  perform pg_temp.cr_root();
  select count(*) into n from public.notifications
   where event_key = 'employee.change_resolved' and recipient_id = priya and status <> 'failed';
  if n <> 1 then raise exception 'CHANGE-REQUESTS FAIL: the person was told % times', n; end if;
  perform pg_temp.cr_refused('it cannot be closed twice', alice,
    format($q$select public.employee_resolve_change(%L, 'declined', 'Changed my mind')$q$, req), 'ALREADY_RESOLVED');
  raise notice 'ok: an Admin closes it once, and the person is told';

  -- ── 5 · a stuck button cannot flood the admins
  perform pg_temp.cr_as(priya);
  for i in 1 .. 10 loop
    perform public.employee_request_change(e, 'other', 'Request number ' || i);
  end loop;
  perform pg_temp.cr_root();
  perform pg_temp.cr_refused('an eleventh open request is refused', priya,
    format($q$select public.employee_request_change(%L, 'other', 'One more')$q$, e), 'TOO_MANY_OPEN_REQUESTS');
end $$;

rollback;
