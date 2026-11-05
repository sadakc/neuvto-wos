-- NEUVTO WOS — the Employee Card's documents (D95)
--
-- Raises on the first violation. Silence means pass. Rolled back.
--
-- PHASE-AWARE: exits quietly if employee_documents does not exist yet.
--
-- The person and the Employee Admin upload, list and open; nobody else, not
-- the manager, not another company; a file is filed only from its own
-- record's folder and only once uploaded; the same document again replaces,
-- never overwrites; only the Employee Admin verifies, never their own, and
-- removes, with a reason; every open is logged, and storage gives nothing to
-- somebody who has not logged opening it.

begin;

create or replace function pg_temp.dc_as(_uid uuid) returns void as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', _uid::text, 'role', 'authenticated')::text, true);
end $$ language plpgsql;

create or replace function pg_temp.dc_root() returns void as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$ language plpgsql;

create or replace function pg_temp.dc_ok(_label text) returns void as $$
begin raise notice 'ok: %', _label; end $$ language plpgsql;

create or replace function pg_temp.dc_refused(_label text, _uid uuid, _sql text, _needle text)
returns void as $$
declare v_msg text;
begin
  perform pg_temp.dc_as(_uid);
  begin
    execute _sql;
  exception when others then
    v_msg := sqlerrm;
  end;
  perform pg_temp.dc_root();
  if v_msg is null then
    raise exception 'DOCUMENTS FAIL: % — it was allowed', _label;
  end if;
  if v_msg not ilike '%' || _needle || '%' then
    raise exception 'DOCUMENTS FAIL: % — refused for the wrong reason: %', _label, v_msg;
  end if;
  perform pg_temp.dc_ok(_label);
end $$ language plpgsql;

create or replace function pg_temp.dc_val(_uid uuid, _sql text) returns text as $$
declare v text;
begin
  perform pg_temp.dc_as(_uid);
  execute _sql into v;
  perform pg_temp.dc_root();
  return v;
exception when others then
  perform pg_temp.dc_root();
  raise exception 'DOCUMENTS FAIL: refused: % — %', _sql, sqlerrm;
end $$ language plpgsql;

/** Upload a file as somebody, then file it on the record. */
create or replace function pg_temp.dc_file(_uid uuid, _emp uuid, _type text, _title text, _name text, _expires date default null)
returns uuid as $$
declare
  v_path text := '00000000-0000-0000-0000-0000000000a0/' || _emp::text || '/' || gen_random_uuid()::text || '-' || _name;
  v uuid;
begin
  perform pg_temp.dc_as(_uid);
  insert into storage.objects (bucket_id, name, owner) values ('employee-documents', v_path, _uid);
  v := public.employee_document_add(_emp, _type, _title, v_path, _name, 'application/pdf', 2048, _expires);
  perform pg_temp.dc_root();
  return v;
exception when others then
  perform pg_temp.dc_root();
  raise exception 'DOCUMENTS FAIL: filing refused: %', sqlerrm;
end $$ language plpgsql;

do $$
declare
  acme  uuid := '00000000-0000-0000-0000-0000000000a0';
  dan   uuid := '00000000-0000-0000-0000-00000000a003';  -- Employee Admin
  mark  uuid := '00000000-0000-0000-0000-00000000a004';  -- Ravi's manager, not an admin
  ravi  uuid := '00000000-0000-0000-0000-00000000a005';
  priya uuid := '00000000-0000-0000-0000-00000000a006';
  bob   uuid := '00000000-0000-0000-0000-00000000b001';  -- another company's admin
  e_ravi uuid;
  e_dan  uuid;
  d1 uuid; d2 uuid; d3 uuid; d4 uuid;
  path text;
  n integer;
  rec record;
begin
  if to_regclass('public.employee_documents') is null then
    raise notice 'skip: documents do not exist yet';
    return;
  end if;
  insert into public.organization_modules (organization_id, module_key, enabled, enabled_at)
  values (acme, 'employee', true, now())
  on conflict (organization_id, module_key) do update set enabled = true, deleted_at = null;
  delete from public.module_admins;
  insert into public.module_admins (organization_id, user_id, module_key) values (acme, dan, 'employee');
  select id into e_ravi from public.employees where profile_id = ravi;
  select id into e_dan from public.employees where profile_id = dan;

  -- ── 1 · the person and the Employee Admin; nobody else
  d1 := pg_temp.dc_file(ravi, e_ravi, 'aadhaar', null, 'aadhaar.pdf');
  d2 := pg_temp.dc_file(dan, e_ravi, 'police_verification', null, 'police.pdf', current_date + 365);
  if pg_temp.dc_val(ravi, format('select count(*) from public.employee_documents_list(%L)', e_ravi)) <> '2'
     or pg_temp.dc_val(dan, format('select count(*) from public.employee_documents_list(%L)', e_ravi)) <> '2' then
    raise exception 'DOCUMENTS FAIL: the person or the Employee Admin does not see both documents';
  end if;
  perform pg_temp.dc_refused('a colleague cannot list them', priya,
    format('select * from public.employee_documents_list(%L)', e_ravi), 'NOT_FOUND');
  perform pg_temp.dc_refused('nor the manager', mark,
    format('select * from public.employee_documents_list(%L)', e_ravi), 'NOT_FOUND');
  perform pg_temp.dc_refused('nor another company''s admin', bob,
    format('select * from public.employee_documents_list(%L)', e_ravi), 'NOT_FOUND');
  perform pg_temp.dc_refused('a colleague cannot upload into somebody''s folder', priya,
    format($q$insert into storage.objects (bucket_id, name) values ('employee-documents', %L)$q$, acme::text || '/' || e_ravi::text || '/x.pdf'),
    'row-level security');
  perform pg_temp.dc_refused('nor file a document on them', priya,
    format($q$select public.employee_document_add(%L, 'pan', null, %L, 'x.pdf', 'application/pdf', 10)$q$, e_ravi, acme::text || '/' || e_ravi::text || '/x.pdf'),
    'NOT_FOUND');
  perform pg_temp.dc_ok('the person and the Employee Admin upload and list; a colleague, the manager and another company do not');

  -- ── 2 · a file is filed only from its own folder, and only once uploaded
  perform pg_temp.dc_refused('a file from another record''s folder', ravi,
    format($q$select public.employee_document_add(%L, 'pan', null, %L, 'x.pdf', 'application/pdf', 10)$q$, e_ravi, acme::text || '/' || e_dan::text || '/x.pdf'),
    'FILE_NOT_IN_RECORD');
  perform pg_temp.dc_refused('a file never uploaded', ravi,
    format($q$select public.employee_document_add(%L, 'pan', null, %L, 'x.pdf', 'application/pdf', 10)$q$, e_ravi, acme::text || '/' || e_ravi::text || '/never.pdf'),
    'FILE_NOT_UPLOADED');
  path := acme::text || '/' || e_ravi::text || '/' || gen_random_uuid()::text || '-r.pdf';
  insert into storage.objects (bucket_id, name, owner) values ('employee-documents', path, ravi);
  perform pg_temp.dc_refused('a relieving letter says whose', ravi,
    format($q$select public.employee_document_add(%L, 'relieving_letter', ' ', %L, 'r.pdf', 'application/pdf', 10)$q$, e_ravi, path),
    'TITLE_REQUIRED');
  perform pg_temp.dc_refused('a document already expired', ravi,
    format($q$select public.employee_document_add(%L, 'passport', null, %L, 'r.pdf', 'application/pdf', 10, %L)$q$, e_ravi, path, current_date - 1),
    'ALREADY_EXPIRED');
  perform pg_temp.dc_refused('only PDFs and photos', ravi,
    format($q$select public.employee_document_add(%L, 'passport', null, %L, 'r.exe', 'application/x-msdownload', 10)$q$, e_ravi, path),
    'INVALID_DOCUMENT');
  perform pg_temp.dc_ok('a file is filed only from its own record''s folder, once uploaded, named where it must be');

  -- ── 3 · the same document again replaces; different employers do not
  d3 := pg_temp.dc_file(ravi, e_ravi, 'aadhaar', null, 'aadhaar-2.pdf');
  if (select replaced_at from public.employee_documents where id = d1) is null then
    raise exception 'DOCUMENTS FAIL: a second Aadhaar did not close the first';
  end if;
  perform pg_temp.dc_file(ravi, e_ravi, 'relieving_letter', 'Tessellate', 'tess.pdf');
  perform pg_temp.dc_file(ravi, e_ravi, 'relieving_letter', 'Mysore Tooling', 'myt.pdf');
  if pg_temp.dc_val(ravi, format('select count(*) from public.employee_documents_list(%L) where doc_type = ''relieving_letter''', e_ravi)) <> '2' then
    raise exception 'DOCUMENTS FAIL: two employers'' relieving letters did not both stay';
  end if;
  if not exists (select 1 from public.employee_documents where id = d1) then
    raise exception 'DOCUMENTS FAIL: the replaced document was deleted';
  end if;
  perform pg_temp.dc_ok('the same document again replaces and keeps the old; each employer''s letter stands');

  -- ── 4 · verifying and removing are the Employee Admin's
  perform pg_temp.dc_refused('the person cannot verify their own', ravi,
    format('select public.employee_document_verify(%L)', d3), 'NOT_FOUND');
  d4 := pg_temp.dc_file(dan, e_dan, 'pan', null, 'pan.pdf');
  perform pg_temp.dc_refused('nor the Employee Admin their own', dan,
    format('select public.employee_document_verify(%L)', d4), 'NOT_YOUR_OWN');
  perform pg_temp.dc_val(dan, format('select public.employee_document_verify(%L)::text', d3));
  if pg_temp.dc_val(ravi, format('select status from public.employee_documents_list(%L) where id = %L', e_ravi, d3)) <> 'verified' then
    raise exception 'DOCUMENTS FAIL: a verified document does not say so';
  end if;
  update public.employee_documents set expires_on = current_date - 1 where id = d2;
  if pg_temp.dc_val(ravi, format('select status from public.employee_documents_list(%L) where id = %L', e_ravi, d2)) <> 'expired' then
    raise exception 'DOCUMENTS FAIL: an expired document does not say so';
  end if;
  perform pg_temp.dc_refused('the person cannot remove one', ravi,
    format('select public.employee_document_remove(%L, ''wrong file'')', d3), 'NOT_FOUND');
  perform pg_temp.dc_refused('removing says why', dan,
    format('select public.employee_document_remove(%L, '' '')', d3), 'REASON_REQUIRED');
  perform pg_temp.dc_val(dan, format('select public.employee_document_remove(%L, ''Uploaded the wrong scan'')::text', d3));
  if pg_temp.dc_val(ravi, format('select count(*) from public.employee_documents_list(%L) where doc_type = ''aadhaar''', e_ravi)) <> '0'
     or not exists (select 1 from public.employee_documents where id = d3 and removed_reason = 'Uploaded the wrong scan') then
    raise exception 'DOCUMENTS FAIL: a removed document is still listed, or was deleted';
  end if;
  perform pg_temp.dc_ok('only the Employee Admin verifies (never their own) and removes, with a reason, keeping the row');

  -- ── 5 · every open is logged, and storage gives nothing unlogged
  path := (select file_path from public.employee_documents where id = d2);
  perform pg_temp.dc_as(dan);
  select count(*) into n from storage.objects where bucket_id = 'employee-documents' and name = path;
  perform pg_temp.dc_root();
  if n <> 0 then raise exception 'DOCUMENTS FAIL: storage shows a file nobody logged opening'; end if;
  if pg_temp.dc_val(dan, format('select public.employee_document_open(%L)', d2)) <> path then
    raise exception 'DOCUMENTS FAIL: opening did not return the file';
  end if;
  perform pg_temp.dc_as(dan);
  select count(*) into n from storage.objects where bucket_id = 'employee-documents' and name = path;
  perform pg_temp.dc_root();
  if n <> 1 then raise exception 'DOCUMENTS FAIL: storage refused a file just opened'; end if;
  perform pg_temp.dc_as(ravi);
  select count(*) into n from storage.objects where bucket_id = 'employee-documents' and name = path;
  perform pg_temp.dc_root();
  if n <> 0 then raise exception 'DOCUMENTS FAIL: one person''s open let somebody else read the file'; end if;
  update public.employee_document_views set viewed_at = now() - interval '6 minutes' where viewer_id = dan;
  perform pg_temp.dc_as(dan);
  select count(*) into n from storage.objects where bucket_id = 'employee-documents' and name = path;
  perform pg_temp.dc_root();
  if n <> 0 then raise exception 'DOCUMENTS FAIL: an old open still opens the file'; end if;
  perform pg_temp.dc_refused('a colleague cannot open one', priya,
    format('select public.employee_document_open(%L)', d2), 'NOT_FOUND');
  if not exists (select 1 from public.employee_document_views where document_id = d2 and viewer_id = dan) then
    raise exception 'DOCUMENTS FAIL: the open was not logged';
  end if;
  if pg_temp.dc_val(dan, format('select count(*) from public.employee_document_views_list(%L)', e_ravi)) = '0' then
    raise exception 'DOCUMENTS FAIL: the Employee Admin cannot see who opened what';
  end if;
  perform pg_temp.dc_refused('the person cannot read the opening log', ravi,
    format('select * from public.employee_document_views_list(%L)', e_ravi), 'NOT_FOUND');
  perform pg_temp.dc_refused('and nobody signed in reads the tables', dan,
    'select count(*) from public.employee_documents', 'permission denied');
  perform pg_temp.dc_ok('every open is logged; storage opens a file only for whoever logged opening it, for five minutes');
end $$;

rollback;
