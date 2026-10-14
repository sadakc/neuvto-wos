-- NEUVTO WOS — the rest of the Employee Card (D97, D98, D99, D100)
--
-- Raises on the first violation. Silence means pass. Rolled back.
--
-- PHASE-AWARE: exits quietly if employee_card_views does not exist yet.
--
--   D100 every look at somebody else's record is logged before it is shown;
--        ten minutes is one look; your own is not logged; only the person and
--        a Super Admin read the log; nobody rewrites it.
--   D97  "This year" for the person, the Employee Admin and the manager only;
--        the same balances the person's Leave screen shows; reading creates
--        nothing; no Leave, no leave block.
--   D98  a proof is attached to one address by the person or the Employee
--        Admin; it replaces the one before; the address row is untouched; the
--        card carries it only to those two.
--   D99  one email per company and kind, to the right people, on the cadence,
--        never for nobody, never for a deactivated record.

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

create or replace function pg_temp.cr_ok(_label text) returns void as $$
begin raise notice 'ok: %', _label; end $$ language plpgsql;

create or replace function pg_temp.cr_refused(_label text, _uid uuid, _sql text, _needle text)
returns void as $$
declare v_msg text;
begin
  if _uid is null then perform pg_temp.cr_root(); else perform pg_temp.cr_as(_uid); end if;
  begin
    execute _sql;
  exception when others then
    v_msg := sqlerrm;
  end;
  perform pg_temp.cr_root();
  if v_msg is null then
    raise exception 'CARD FAIL: % — it was allowed', _label;
  end if;
  if v_msg not ilike '%' || _needle || '%' then
    raise exception 'CARD FAIL: % — refused for the wrong reason: %', _label, v_msg;
  end if;
  perform pg_temp.cr_ok(_label);
end $$ language plpgsql;

create or replace function pg_temp.cr_val(_uid uuid, _sql text) returns text as $$
declare v text;
begin
  perform pg_temp.cr_as(_uid);
  execute _sql into v;
  perform pg_temp.cr_root();
  return v;
exception when others then
  perform pg_temp.cr_root();
  raise exception 'CARD FAIL: refused: % — %', _sql, sqlerrm;
end $$ language plpgsql;

create or replace function pg_temp.cr_check(_label text, _got text, _want text) returns void as $$
begin
  if _got is distinct from _want then
    raise exception 'CARD FAIL: % — got %, wanted %', _label, _got, _want;
  end if;
  perform pg_temp.cr_ok(_label);
end $$ language plpgsql;

/** A person's name now: other suites rename people, so names are looked up, never typed. */
create or replace function pg_temp.cr_name(_id uuid) returns text as $$
  select full_name from public.profiles where id = _id
$$ language sql;

/** Who received an event in a company, as a sorted list of names. */
create or replace function pg_temp.cr_told(_event text, _org uuid) returns text as $$
  select string_agg(p.full_name, ',' order by p.full_name)
    from public.notifications x join public.profiles p on p.id = x.recipient_id
   where x.event_key = _event and x.organization_id = _org
$$ language sql;

/** Put a file in a record's folder as somebody; returns its path. */
create or replace function pg_temp.cr_upload(_uid uuid, _emp uuid, _name text) returns text as $$
declare v_path text := '00000000-0000-0000-0000-0000000000a0/' || _emp::text || '/' || gen_random_uuid()::text || '-' || _name;
begin
  perform pg_temp.cr_as(_uid);
  insert into storage.objects (bucket_id, name, owner) values ('employee-documents', v_path, _uid);
  perform pg_temp.cr_root();
  return v_path;
end $$ language plpgsql;

do $$
declare
  acme   uuid := '00000000-0000-0000-0000-0000000000a0';
  vertex uuid := '00000000-0000-0000-0000-0000000000b0';
  alice  uuid := '00000000-0000-0000-0000-00000000a001';  -- org_admin, made Super Admin here
  hema   uuid := '00000000-0000-0000-0000-00000000a002';  -- hr_admin
  dan    uuid := '00000000-0000-0000-0000-00000000a003';  -- Employee Admin (module admin)
  mark   uuid := '00000000-0000-0000-0000-00000000a004';  -- Ravi's manager
  ravi   uuid := '00000000-0000-0000-0000-00000000a005';
  priya  uuid := '00000000-0000-0000-0000-00000000a006';
  newj   uuid := '00000000-0000-0000-0000-00000000a007';
  bob    uuid := '00000000-0000-0000-0000-00000000b001';
  sara   uuid := '00000000-0000-0000-0000-00000000b002';
  e_ravi uuid; e_priya uuid; e_newj uuid; e_sara uuid; e_draft uuid;
  j jsonb; k jsonb;
  a_present uuid; a_perm uuid; a_old uuid;
  p1 uuid; p2 uuid; p3 uuid;
  path text;
  n integer; m integer;
  t record;
  v_unpaid uuid;
begin
  if to_regclass('public.employee_card_views') is null then
    raise notice 'skip: the card''s view log does not exist yet';
    return;
  end if;

  insert into public.organization_modules (organization_id, module_key, enabled, enabled_at)
  values (acme, 'employee', true, now()), (vertex, 'employee', true, now())
  on conflict (organization_id, module_key) do update set enabled = true, deleted_at = null;
  delete from public.module_admins;
  insert into public.module_admins (organization_id, user_id, module_key) values (acme, dan, 'employee');
  -- Mark administers Leave, not Employees: an Employee reminder is not his.
  insert into public.module_admins (organization_id, user_id, module_key) values (acme, mark, 'leave');
  insert into public.user_roles (user_id, organization_id, role) values (alice, acme, 'super_admin')
  on conflict do nothing;
  -- Hema is a company-wide Admin and not a Super Admin: an escalation is not hers.
  insert into public.user_roles (user_id, organization_id, role) values (hema, acme, 'org_admin')
  on conflict do nothing;
  select id into e_ravi from public.employees where profile_id = ravi;
  select id into e_priya from public.employees where profile_id = priya;
  select id into e_newj from public.employees where profile_id = newj;
  select id into e_sara from public.employees where profile_id = sara;
  if e_ravi is null or e_priya is null or e_newj is null or e_sara is null then
    raise exception 'CARD FAIL: fixture — the seeded people have no employee records';
  end if;
  perform set_config('neuvto.purge', 'on', true);
  delete from public.employee_card_views;
  perform set_config('neuvto.purge', '', true);

  -- ════════════════════════════════════════════ D100 every look is logged

  -- A STABLE card could be run in a read-only transaction, where the log
  -- cannot be written.
  select provolatile::text into path from pg_proc where oid = 'public.employee_card(uuid)'::regprocedure;
  perform pg_temp.cr_check('the card is volatile, so it may write its log', path, 'v');

  perform pg_temp.cr_val(dan, format('select public.employee_card(%L)::text', e_ravi));
  select count(*) into n from public.employee_card_views where viewer_id = dan and employee_id = e_ravi;
  perform pg_temp.cr_check('the Employee Admin''s look at Ravi is logged', n::text, '1');

  perform pg_temp.cr_val(dan, format('select public.employee_card(%L)::text', e_ravi));
  select count(*) into n from public.employee_card_views where viewer_id = dan and employee_id = e_ravi;
  perform pg_temp.cr_check('a second look within ten minutes is the same look', n::text, '1');

  perform set_config('neuvto.purge', 'on', true);
  update public.employee_card_views set viewed_at = now() - interval '11 minutes'
   where viewer_id = dan and employee_id = e_ravi;
  perform set_config('neuvto.purge', '', true);
  perform pg_temp.cr_val(dan, format('select public.employee_card(%L)::text', e_ravi));
  select count(*) into n from public.employee_card_views where viewer_id = dan and employee_id = e_ravi;
  perform pg_temp.cr_check('a look eleven minutes later is a new one', n::text, '2');

  perform pg_temp.cr_val(priya, format('select public.employee_card(%L)::text', e_ravi));
  select count(*) into n from public.employee_card_views where viewer_id = priya and employee_id = e_ravi;
  perform pg_temp.cr_check('a colleague''s look is logged too', n::text, '1');

  -- Ten minutes is per viewer AND per record: Dan looking at Priya is new.
  perform pg_temp.cr_val(dan, format('select public.employee_card(%L)::text', e_priya));
  select count(*) into n from public.employee_card_views where viewer_id = dan and employee_id = e_priya;
  perform pg_temp.cr_check('a look at another record is its own row', n::text, '1');

  perform pg_temp.cr_val(ravi, 'select public.employee_card()::text');
  perform pg_temp.cr_val(ravi, format('select public.employee_card(%L)::text', e_ravi));
  select count(*) into n from public.employee_card_views where viewer_id = ravi;
  perform pg_temp.cr_check('looking at your own record is not logged', n::text, '0');

  -- A draft answers NOT_FOUND to a non-admin, and nothing was seen to log.
  perform pg_temp.cr_as(dan);
  e_draft := public.employee_create_draft(jsonb_build_object('fullName', 'Draft Person'));
  perform pg_temp.cr_root();
  perform pg_temp.cr_refused('a colleague cannot open a draft', priya,
    format('select public.employee_card(%L)', e_draft), 'NOT_FOUND');
  select count(*) into n from public.employee_card_views where employee_id = e_draft;
  perform pg_temp.cr_check('a refused look writes nothing', n::text, '0');
  perform pg_temp.cr_refused('another company cannot open the card', bob,
    format('select public.employee_card(%L)', e_ravi), 'NOT_FOUND');
  select count(*) into n from public.employee_card_views where viewer_id = bob;
  perform pg_temp.cr_check('another company''s refused look writes nothing', n::text, '0');

  -- Who reads the log.
  perform pg_temp.cr_check('Ravi sees who looked at him',
    pg_temp.cr_val(ravi, format('select string_agg(distinct viewer_name, '','' order by viewer_name) from public.employee_card_views_list(%L)', e_ravi)),
    (select string_agg(nm, ',' order by nm) from unnest(array[pg_temp.cr_name(dan), pg_temp.cr_name(priya)]) nm));
  perform pg_temp.cr_check('a Super Admin sees it',
    pg_temp.cr_val(alice, format('select count(*) from public.employee_card_views_list(%L)', e_ravi)), '3');
  perform pg_temp.cr_refused('the Employee Admin does not', dan,
    format('select * from public.employee_card_views_list(%L)', e_ravi), 'NOT_FOUND');
  perform pg_temp.cr_refused('nor an hr_admin', hema,
    format('select * from public.employee_card_views_list(%L)', e_ravi), 'NOT_FOUND');
  perform pg_temp.cr_refused('nor the manager', mark,
    format('select * from public.employee_card_views_list(%L)', e_ravi), 'NOT_FOUND');
  perform pg_temp.cr_refused('nor a colleague', priya,
    format('select * from public.employee_card_views_list(%L)', e_ravi), 'NOT_FOUND');
  perform pg_temp.cr_refused('nor another company''s admin', bob,
    format('select * from public.employee_card_views_list(%L)', e_ravi), 'NOT_FOUND');
  perform pg_temp.cr_refused('the table cannot be read directly', ravi,
    'select * from public.employee_card_views', 'permission denied');

  perform pg_temp.cr_check('the card offers the log to the person',
    pg_temp.cr_val(ravi, 'select public.employee_card() -> ''capabilities'' ->> ''canSeeViews'''), 'true');
  perform pg_temp.cr_check('and to a Super Admin',
    pg_temp.cr_val(alice, format('select public.employee_card(%L) -> ''capabilities'' ->> ''canSeeViews''', e_ravi)), 'true');
  perform pg_temp.cr_check('not to the Employee Admin',
    pg_temp.cr_val(dan, format('select public.employee_card(%L) -> ''capabilities'' ->> ''canSeeViews''', e_ravi)), 'false');

  -- Nobody rewrites it.
  perform pg_temp.cr_refused('the log cannot be edited', null,
    'update public.employee_card_views set viewed_at = now()', 'VIEW_LOG_IS_APPEND_ONLY');
  perform pg_temp.cr_refused('nor deleted', null,
    'delete from public.employee_card_views', 'VIEW_LOG_IS_APPEND_ONLY');
  -- Alice's look just now (her card) is logged too: count, don't assume.
  select count(*) into m from public.employee_card_views;
  perform set_config('neuvto.purge', 'on', true);
  update public.employee_card_views set viewed_at = now() - interval '3 years 1 day'
   where viewer_id = priya;
  update public.employee_card_views set viewed_at = now() - interval '3 years' + interval '1 day'
   where viewer_id = alice;
  perform set_config('neuvto.purge', '', true);
  n := public.employee_card_views_prune();
  perform pg_temp.cr_check('three years on, the old look is pruned and nothing younger',
    n || '/' || (select count(*) from public.employee_card_views) || '/'
      || (select count(*) from public.employee_card_views where viewer_id = alice),
    '1/' || (m - 1) || '/1');
  perform pg_temp.cr_refused('a signed-in user cannot prune', ravi,
    'select public.employee_card_views_prune()', 'permission denied');
  perform pg_temp.cr_check('the retention job is scheduled',
    (select count(*)::text from cron.job where jobname = 'neuvto-employee-view-retention'), '1');

  -- ════════════════════════════════════════════ D97 this year

  -- Ravi has a pending leave request and a pending comp-off claim, a
  -- cancelled one that no longer counts, and one open record correction.
  -- Priya's pending request is not his.
  insert into public.approval_requests (organization_id, entity_type, entity_id, requester_id, status, current_level, required_levels)
  values (acme, 'leave_request', gen_random_uuid(), ravi, 'pending', 1, 1),
         (acme, 'leave_request', gen_random_uuid(), ravi, 'pending', 1, 1),
         (acme, 'comp_off_claim', gen_random_uuid(), ravi, 'pending', 1, 1),
         (acme, 'leave_request', gen_random_uuid(), priya, 'pending', 1, 1);
  insert into public.approval_requests (organization_id, entity_type, entity_id, requester_id, status, current_level, required_levels, completed_at)
  values (acme, 'leave_request', gen_random_uuid(), ravi, 'cancelled', 1, 1, now());
  insert into public.employee_change_requests (organization_id, employee_id, requested_by, section, details)
  values (acme, e_ravi, ravi, 'contact', 'My mobile changed');
  insert into public.employee_change_requests (organization_id, employee_id, requested_by, section, details, status, resolved_at, resolution_note)
  values (acme, e_ravi, ravi, 'contact', 'An old one, declined', 'declined', now(), 'Not needed');

  -- An unpaid type, which has no balance and must not be listed.
  select id into v_unpaid from public.leave_types where organization_id = acme and kind = 'unpaid' and deleted_at is null limit 1;
  if v_unpaid is null then
    insert into public.leave_types (organization_id, name, kind, max_days_per_year)
    values (acme, 'Leave without pay', 'unpaid', 0) returning id into v_unpaid;
  end if;

  select count(*) into n from public.leave_balances where employee_id = newj;
  perform pg_temp.cr_val(dan, format('select public.employee_this_year(%L)::text', e_newj));
  select count(*) into m from public.leave_balances where employee_id = newj;
  perform pg_temp.cr_check('reading somebody''s year creates no balance', m::text, n::text);

  -- The person's own Leave screen makes their rows; the card must agree with it.
  perform pg_temp.cr_val(ravi, 'select count(*) from public.leave_my_balances()');
  -- Some of it carried over from last year, so "entitled" has to include it.
  update public.leave_balances set carryforward_days = 3
   where employee_id = ravi and leave_type_id = (
     select b.leave_type_id from public.leave_balances b join public.leave_types lt on lt.id = b.leave_type_id
      where b.employee_id = ravi and lt.kind = 'paid' and b.deleted_at is null limit 1);
  j := pg_temp.cr_val(ravi, format('select public.employee_this_year(%L)::text', e_ravi))::jsonb;
  for t in
    select b.leave_type_id, b.available_days, b.entitled_days + b.carryforward_days as ent, lt.kind
      from public.leave_balances b join public.leave_types lt on lt.id = b.leave_type_id
     where b.employee_id = ravi and b.fy_label = j ->> 'leaveYear' and b.deleted_at is null
       and lt.status = 'active' and lt.deleted_at is null and lt.kind <> 'unpaid'
  loop
    select x into k from jsonb_array_elements(j -> 'leave') x where x ->> 'leaveTypeId' = t.leave_type_id::text;
    if k is null or (k ->> 'available')::numeric <> t.available_days or (k ->> 'entitled')::numeric <> t.ent then
      raise exception 'CARD FAIL: this year disagrees with My Leave for type % — %', t.leave_type_id, k;
    end if;
  end loop;
  if (select count(*) from jsonb_array_elements(j -> 'leave')) = 0 then
    raise exception 'CARD FAIL: fixture — Ravi has no leave types, so the comparison proved nothing';
  end if;
  perform pg_temp.cr_ok('this year shows the balances My Leave shows');
  perform pg_temp.cr_check('an unpaid type is not listed',
    (select count(*)::text from jsonb_array_elements(j -> 'leave') x where x ->> 'kind' = 'unpaid'), '0');
  perform pg_temp.cr_check('open requests by kind, his and pending only',
    (select string_agg((x ->> 'label') || '=' || (x ->> 'count'), ',' order by x ->> 'label')
       from jsonb_array_elements(j -> 'openRequests') x),
    public.approval_entity_label('comp_off_claim') || '=1,' || public.approval_entity_label('leave_request') || '=2');
  perform pg_temp.cr_check('and his open correction', j ->> 'openCorrections', '1');

  perform pg_temp.cr_val(mark, format('select public.employee_this_year(%L)::text', e_ravi));
  perform pg_temp.cr_ok('his manager sees it');
  perform pg_temp.cr_val(dan, format('select public.employee_this_year(%L)::text', e_ravi));
  perform pg_temp.cr_ok('the Employee Admin sees it');
  perform pg_temp.cr_refused('a colleague does not', priya,
    format('select public.employee_this_year(%L)', e_ravi), 'NOT_FOUND');
  insert into public.user_roles (user_id, organization_id, role) values (priya, acme, 'payroll_officer');
  perform pg_temp.cr_refused('nor Payroll', priya,
    format('select public.employee_this_year(%L)', e_ravi), 'NOT_FOUND');
  delete from public.user_roles where user_id = priya and role = 'payroll_officer';
  perform pg_temp.cr_refused('nor another company''s admin', bob,
    format('select public.employee_this_year(%L)', e_ravi), 'NOT_FOUND');
  perform pg_temp.cr_refused('nor Ravi for another company''s record', ravi,
    format('select public.employee_this_year(%L)', e_sara), 'NOT_FOUND');
  perform pg_temp.cr_check('the card offers it to the manager',
    pg_temp.cr_val(mark, format('select public.employee_card(%L) -> ''capabilities'' ->> ''canSeeThisYear''', e_ravi)), 'true');
  perform pg_temp.cr_check('not to a colleague',
    pg_temp.cr_val(priya, format('select public.employee_card(%L) -> ''capabilities'' ->> ''canSeeThisYear''', e_ravi)), 'false');

  j := pg_temp.cr_val(dan, format('select public.employee_this_year(%L)::text', e_draft))::jsonb;
  perform pg_temp.cr_check('a draft has no leave and asks for nothing',
    coalesce(j ->> 'leave', 'null') || '/' || (j -> 'openRequests')::text, 'null/[]');

  update public.organization_modules set enabled = false where organization_id = acme and module_key = 'leave';
  j := pg_temp.cr_val(ravi, format('select public.employee_this_year(%L)::text', e_ravi))::jsonb;
  perform pg_temp.cr_check('without Leave there is no leave block', coalesce(j ->> 'leave', 'null'), 'null');
  perform pg_temp.cr_check('but what he waits on is still there',
    (select count(*)::text from jsonb_array_elements(j -> 'openRequests')), '2');
  update public.organization_modules set enabled = true where organization_id = acme and module_key = 'leave';

  -- ════════════════════════════════════════════ D98 proof on an address

  perform pg_temp.cr_as(dan);
  j := public.employee_add_address(e_ravi, jsonb_build_object(
         'addressType', 'present', 'effectiveFrom', '2025-01-01', 'line', '1 Old Road',
         'city', 'Hosur', 'state', 'Tamil Nadu', 'pincode', '635109'));
  a_old := (j ->> 'id')::uuid;
  j := public.employee_add_address(e_ravi, jsonb_build_object(
         'addressType', 'present', 'effectiveFrom', '2026-06-01', 'line', '2 New Street',
         'city', 'Hosur', 'state', 'Tamil Nadu', 'pincode', '635109', 'alsoPermanent', true));
  perform pg_temp.cr_root();
  select (x ->> 'id')::uuid into a_present from jsonb_array_elements(j -> 'added') x where x ->> 'addressType' = 'present';
  select (x ->> 'id')::uuid into a_perm from jsonb_array_elements(j -> 'added') x where x ->> 'addressType' = 'permanent';
  if a_present is null or a_perm is null or a_present = a_perm then
    raise exception 'CARD FAIL: adding an address does not name both rows it added — %', j;
  end if;
  perform pg_temp.cr_ok('adding an address names every row it added');

  path := pg_temp.cr_upload(dan, e_ravi, 'rent.pdf');
  perform pg_temp.cr_as(dan);
  p1 := public.employee_address_attach_proof(a_present, path, 'rent.pdf', 'application/pdf', 4096);
  perform pg_temp.cr_root();
  perform pg_temp.cr_ok('the Employee Admin attaches a proof');

  -- Rule 2: the address row is not touched.
  select count(*) into n from public.employee_addresses where id = a_present and updated_at > created_at;
  perform pg_temp.cr_check('attaching changes nothing on the address row', n::text, '0');

  j := pg_temp.cr_val(ravi, 'select public.employee_card()::text')::jsonb;
  select x into k from jsonb_array_elements(j -> 'addresses') x where x ->> 'id' = a_present::text;
  perform pg_temp.cr_check('Ravi''s card shows the proof on that address', k -> 'proof' ->> 'documentId', p1::text);
  select x into k from jsonb_array_elements(j -> 'addresses') x where x ->> 'id' = a_perm::text;
  perform pg_temp.cr_check('and none on the other', coalesce(k ->> 'proof', 'null'), 'null');

  insert into public.user_roles (user_id, organization_id, role) values (priya, acme, 'statutory_officer');
  j := pg_temp.cr_val(priya, format('select public.employee_card(%L)::text', e_ravi))::jsonb;
  delete from public.user_roles where user_id = priya and role = 'statutory_officer';
  if jsonb_array_length(j -> 'addresses') = 0 then
    raise exception 'CARD FAIL: fixture — the Statutory role sees no addresses, so the absence proves nothing';
  end if;
  perform pg_temp.cr_check('the Statutory role sees the addresses but not that a proof exists',
    (select count(*)::text from jsonb_array_elements(j -> 'addresses') x where x ? 'proof'), '0');

  -- Ravi replaces it himself, and proves his archived address too.
  path := pg_temp.cr_upload(ravi, e_ravi, 'aadhaar-address.pdf');
  perform pg_temp.cr_as(ravi);
  p2 := public.employee_address_attach_proof(a_present, path, 'aadhaar-address.pdf', 'application/pdf', 4096);
  perform pg_temp.cr_root();
  path := pg_temp.cr_upload(ravi, e_ravi, 'old-bill.pdf');
  perform pg_temp.cr_as(ravi);
  p3 := public.employee_address_attach_proof(a_old, path, 'old-bill.pdf', 'application/pdf', 4096);
  perform pg_temp.cr_root();
  perform pg_temp.cr_check('the earlier proof is replaced, not overwritten',
    (select (replaced_at is not null)::text || '/' || file_name from public.employee_documents where id = p1), 'true/rent.pdf');
  perform pg_temp.cr_check('and the new one is the live one',
    (select count(*)::text from public.employee_documents
      where address_id = a_present and replaced_at is null and removed_at is null), '1');
  perform pg_temp.cr_check('an archived address takes a proof too',
    (select address_id::text from public.employee_documents where id = p3), a_old::text);

  path := pg_temp.cr_upload(dan, e_ravi, 'x.pdf');
  perform pg_temp.cr_refused('the manager cannot attach one', mark,
    format('select public.employee_address_attach_proof(%L, %L, %L, %L, 10)', a_present, path, 'x.pdf', 'application/pdf'), 'NOT_FOUND');
  perform pg_temp.cr_refused('nor a colleague', priya,
    format('select public.employee_address_attach_proof(%L, %L, %L, %L, 10)', a_present, path, 'x.pdf', 'application/pdf'), 'NOT_FOUND');
  perform pg_temp.cr_refused('nor another company''s admin', bob,
    format('select public.employee_address_attach_proof(%L, %L, %L, %L, 10)', a_present, path, 'x.pdf', 'application/pdf'), 'NOT_FOUND');
  perform pg_temp.cr_refused('a file from another record''s folder is refused', dan,
    format('select public.employee_address_attach_proof(%L, %L, %L, %L, 10)', a_present,
           acme::text || '/' || e_priya::text || '/y.pdf', 'y.pdf', 'application/pdf'), 'FILE_NOT_IN_RECORD');
  perform pg_temp.cr_refused('a file never uploaded is refused', dan,
    format('select public.employee_address_attach_proof(%L, %L, %L, %L, 10)', a_present,
           acme::text || '/' || e_ravi::text || '/never.pdf', 'never.pdf', 'application/pdf'), 'FILE_NOT_UPLOADED');
  perform pg_temp.cr_refused('a file of the wrong kind is refused', dan,
    format('select public.employee_address_attach_proof(%L, %L, %L, %L, 10)', a_present, path, 'x.exe', 'application/x-msdownload'), 'INVALID_DOCUMENT');

  -- Not through the Documents tab's door: an address proof must name its address.
  perform pg_temp.cr_refused('an address proof without an address is refused', dan,
    format('select public.employee_document_add(%L, %L, null, %L, %L, %L, 10)', e_ravi, 'address_proof', path, 'x.pdf', 'application/pdf'),
    'INVALID_DOCUMENT');
  perform pg_temp.cr_check('and the refusal replaced nothing',
    (select count(*)::text from public.employee_documents
      where address_id = a_present and replaced_at is null and removed_at is null), '1');
  perform pg_temp.cr_refused('only an address proof names an address', null,
    format('insert into public.employee_documents (organization_id, employee_id, doc_type, address_id, file_path, file_name, mime_type, size_bytes) values (%L, %L, %L, %L, %L, %L, %L, 10)',
           acme, e_ravi, 'aadhaar', a_present, 'z/z.pdf', 'z.pdf', 'application/pdf'), 'address_proof_names_its_address');

  -- Opened like any document: logged, and only by the two.
  perform pg_temp.cr_val(ravi, format('select public.employee_document_open(%L)', p2));
  perform pg_temp.cr_check('opening the proof is logged',
    (select count(*)::text from public.employee_document_views where document_id = p2 and viewer_id = ravi), '1');
  perform pg_temp.cr_refused('the manager cannot open it', mark,
    format('select public.employee_document_open(%L)', p2), 'NOT_FOUND');

  -- ════════════════════════════════════════════ D99 onboarding reminders

  delete from public.employee_onboarding_settings;
  delete from public.employee_onboarding_reminders;
  delete from public.notifications where event_key like 'employee.onboarding_%';

  j := pg_temp.cr_val(hema, 'select public.employee_onboarding_settings()::text')::jsonb;
  perform pg_temp.cr_check('the defaults: every 3 days, Super Admins after 7',
    (j ->> 'remindEveryDays') || '/' || (j ->> 'escalateAfterDays'), '3/7');
  perform pg_temp.cr_val(dan, 'select public.employee_save_onboarding_settings(5, 10)::text');
  j := pg_temp.cr_val(hema, 'select public.employee_onboarding_settings()::text')::jsonb;
  perform pg_temp.cr_check('the Employee Admin sets them',
    (j ->> 'remindEveryDays') || '/' || (j ->> 'escalateAfterDays'), '5/10');
  perform pg_temp.cr_refused('more than 30 days is refused', dan,
    'select public.employee_save_onboarding_settings(31, 10)', 'INVALID_VALUE');
  perform pg_temp.cr_refused('a negative window is refused', dan,
    'select public.employee_save_onboarding_settings(3, -1)', 'INVALID_VALUE');
  perform pg_temp.cr_refused('an employee cannot set them', ravi,
    'select public.employee_save_onboarding_settings(1, 1)', 'FORBIDDEN');
  perform pg_temp.cr_refused('nor read them', ravi,
    'select public.employee_onboarding_settings()', 'FORBIDDEN');
  perform pg_temp.cr_val(bob, 'select public.employee_save_onboarding_settings(0, 0)::text');
  perform pg_temp.cr_check('another company''s settings are its own',
    (select remind_every_days::text from public.employee_onboarding_settings where organization_id = acme), '5');

  perform pg_temp.cr_check('a gap says when it fell due',
    (select (public.employee_onboarding_gaps(e_newj) -> 0 ->> 'dueOn') is not null)::text, 'true');

  -- A mandatory item due a year after joining is not yet due for New Joiner.
  insert into public.employee_onboarding_items (organization_id, item_key, due_within_days, mandatory)
  values (acme, 'police_verification', 365, true)
  on conflict (organization_id, item_key) do update set due_within_days = 365, mandatory = true;
  perform pg_temp.cr_check('an item not yet due is not overdue',
    (select ('Police verification done' = any (items))::text from public.employee_onboarding_overdue(acme) where employee_id = e_newj), 'false');

  -- Fixtures: New Joiner (joined 1 Oct 2026) is only days past due; Ravi
  -- (joined 2024) is years past due. Priya is deactivated and is not chased.
  update public.profiles set is_active = false where id = priya;
  select count(*) into n from public.employee_onboarding_overdue(acme) where employee_id = e_newj and days_overdue between 1 and 60;
  select count(*) into m from public.employee_onboarding_overdue(acme) where employee_id = e_ravi and days_overdue > 90;
  if n <> 1 or m <> 1 then
    raise exception 'CARD FAIL: fixture — New Joiner should be a little overdue and Ravi a lot (% / %)', n, m;
  end if;
  perform pg_temp.cr_check('a deactivated record is not chased',
    (select count(*)::text from public.employee_onboarding_overdue(acme) where employee_id = e_priya), '0');
  perform pg_temp.cr_check('nor another company''s',
    (select count(*)::text from public.employee_onboarding_overdue(acme) where employee_id = e_sara), '0');

  update public.employee_onboarding_settings set remind_every_days = 3, escalate_after_days = 90 where organization_id = acme;
  update public.employee_onboarding_settings set remind_every_days = 3, escalate_after_days = 7 where organization_id = vertex;
  n := public.employee_onboarding_remind_due();
  perform pg_temp.cr_check('one reminder and one escalation for each company', n::text, '4');

  perform pg_temp.cr_check('Acme''s reminder reached its admins and its Employee Admin, nobody else',
    pg_temp.cr_told('employee.onboarding_overdue', acme),
    (select string_agg(nm, ',' order by nm)
       from unnest(array[pg_temp.cr_name(alice), pg_temp.cr_name(dan), pg_temp.cr_name(hema)]) nm));
  perform pg_temp.cr_check('Acme''s escalation reached its Super Admin only',
    pg_temp.cr_told('employee.onboarding_escalated', acme), pg_temp.cr_name(alice));
  perform pg_temp.cr_check('Vertex''s escalation reached its Super Admin, Bob',
    pg_temp.cr_told('employee.onboarding_escalated', vertex), pg_temp.cr_name(bob));
  perform pg_temp.cr_check('Vertex''s reminder reached Bob only',
    pg_temp.cr_told('employee.onboarding_overdue', vertex), pg_temp.cr_name(bob));

  select body into path from public.notifications
   where event_key = 'employee.onboarding_overdue' and recipient_id = hema;
  if path not like '%' || pg_temp.cr_name(ravi) || ' (%' or path not like '%' || pg_temp.cr_name(newj) || ' (%'
     or path like '%' || pg_temp.cr_name(priya) || '%' or path like '%' || pg_temp.cr_name(sara) || '%' then
    raise exception 'CARD FAIL: the reminder names the wrong people: %', path;
  end if;
  perform pg_temp.cr_ok('the reminder names the overdue records, and only Acme''s live ones');
  select body into path from public.notifications
   where event_key = 'employee.onboarding_escalated' and recipient_id = alice;
  if path not like '%' || pg_temp.cr_name(ravi) || ' (%' or path like '%' || pg_temp.cr_name(newj) || '%'
     or path not like '%90 or more days%' then
    raise exception 'CARD FAIL: the escalation names the wrong people: %', path;
  end if;
  perform pg_temp.cr_ok('the escalation names only those past the window');
  perform pg_temp.cr_check('no placeholder left in either',
    (select count(*)::text from public.notifications
      where event_key like 'employee.onboarding_%' and (subject like '%{{%' or body like '%{{%')), '0');
  perform pg_temp.cr_check('and what was sent is recorded',
    (select string_agg(kind || '=' || people, ',' order by kind) from public.employee_onboarding_reminders where organization_id = acme),
    'escalation=' || (select count(*) from public.employee_onboarding_overdue(acme) where days_overdue >= 90)
    || ',reminder=' || (select count(*) from public.employee_onboarding_overdue(acme)));

  n := public.employee_onboarding_remind_due();
  perform pg_temp.cr_check('run again the same day, nothing is sent', n::text, '0');

  update public.employee_onboarding_reminders set sent_at = now() - interval '2 days' where organization_id = acme;
  n := public.employee_onboarding_remind_due();
  perform pg_temp.cr_check('two days into a three-day cadence, still nothing', n::text, '0');
  update public.employee_onboarding_reminders set sent_at = now() - interval '3 days' + interval '30 minutes' where organization_id = acme;
  n := public.employee_onboarding_remind_due();
  perform pg_temp.cr_check('a job running half an hour early still sends on the third day', n::text, '2');

  -- Off is off.
  delete from public.employee_onboarding_reminders;
  update public.employee_onboarding_settings set escalate_after_days = 0 where organization_id = acme;
  update public.employee_onboarding_settings set remind_every_days = 0 where organization_id = vertex;
  n := public.employee_onboarding_remind_due();
  perform pg_temp.cr_check('escalation off: only Acme''s reminder; reminders off: nothing for Vertex',
    (select string_agg(organization_id::text || ':' || kind, ',') from public.employee_onboarding_reminders),
    acme::text || ':reminder');

  -- Nothing overdue, nothing sent and nothing recorded.
  delete from public.employee_onboarding_reminders;
  insert into public.employee_onboarding_items (organization_id, item_key, due_within_days, mandatory)
  select acme, d.item_key, d.due_within_days, false from public.employee_onboarding_defaults() d
  on conflict (organization_id, item_key) do update set mandatory = false;
  n := public.employee_onboarding_remind_due();
  perform pg_temp.cr_check('with nothing overdue, nothing is sent or recorded',
    n || '/' || (select count(*) from public.employee_onboarding_reminders), '0/0');

  perform pg_temp.cr_refused('a signed-in user cannot run the job', hema,
    'select public.employee_onboarding_remind_due()', 'permission denied');
  perform pg_temp.cr_refused('nor read who is overdue directly', hema,
    format('select * from public.employee_onboarding_overdue(%L)', acme), 'permission denied');
  perform pg_temp.cr_check('the reminder job is scheduled',
    (select count(*)::text from cron.job where jobname = 'neuvto-employee-onboarding-reminders'), '1');

  raise notice 'the rest of the card: all checks passed';
end $$;

rollback;
