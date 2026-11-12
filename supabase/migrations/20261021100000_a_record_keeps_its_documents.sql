-- ============================================================================
-- NEUVTO WOS — the Employee Card's Documents tab (D95)
-- ============================================================================
--
-- The card's last missing tab (NEUVTO_EMPLOYEE_MASTER §6: "twelve document
-- types, uploaded, expiry, status"), the prototype's list:
--
--   onboarding   offer letter · appointment letter
--   statutory    Aadhaar card · PAN card · Form 2 (PF nomination)
--   payroll      bank passbook first page or cancelled cheque
--   education    degree or qualification certificate
--   background   relieving letter (one per earlier employer) · police verification report
--   travel       passport
--   benefits     medical insurance nomination
--   other        anything else, named
--
-- WHO. The person and the Employee Admin (D85) see the tab and upload. Only
-- the Employee Admin verifies or removes. Nobody else: a document holds the
-- full Aadhaar or account number the card masks.
--
-- EVERY OPEN IS LOGGED, AND CANNOT BE SKIPPED. employee_document_open() checks
-- who is asking, writes the view, and returns the file's path. Storage hands
-- out a link only to somebody with a logged view of that file in the last five
-- minutes, so going to storage directly opens nothing unlogged.
--
-- NOTHING IS OVERWRITTEN (rule 2). A new file for the same document closes the
-- old one (replaced_at); a wrong upload is removed with a reason, never
-- deleted; both stay in the record.
--
-- A file: PDF or a photo, up to 10 MB, in a private bucket, one folder per
-- company and record.
-- ============================================================================

create table if not exists public.employee_documents (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id     uuid not null references public.employees(id) on delete cascade,
  doc_type        text not null check (doc_type in (
                    'offer_letter', 'appointment_letter', 'aadhaar', 'pan', 'pf_nomination',
                    'bank_proof', 'education', 'relieving_letter', 'police_verification',
                    'passport', 'insurance_nomination', 'other')),
  -- Which one: the employer a relieving letter is from, what an "other" is.
  title           text check (title is null or length(btrim(title)) between 1 and 120),
  file_path       text not null,
  file_name       text not null,
  mime_type       text not null check (mime_type in ('application/pdf', 'image/png', 'image/jpeg', 'image/webp')),
  size_bytes      integer not null check (size_bytes > 0 and size_bytes <= 10 * 1024 * 1024),
  expires_on      date,
  uploaded_at     timestamptz not null default now(),
  uploaded_by     uuid references public.profiles(id) on delete set null,
  verified_at     timestamptz,
  verified_by     uuid references public.profiles(id) on delete set null,
  replaced_at     timestamptz,
  removed_at      timestamptz,
  removed_by      uuid references public.profiles(id) on delete set null,
  removed_reason  text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint document_needs_a_name check (doc_type not in ('relieving_letter', 'other') or title is not null),
  constraint document_removed_says_why check ((removed_at is null) = (removed_reason is null)),
  unique (file_path)
);

create index if not exists idx_employee_documents_live
  on public.employee_documents (employee_id, doc_type)
  where replaced_at is null and removed_at is null;

create table if not exists public.employee_document_views (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.employee_documents(id) on delete cascade,
  file_path   text not null,
  viewer_id   uuid not null references public.profiles(id) on delete cascade,
  viewed_at   timestamptz not null default now()
);

create index if not exists idx_document_views_recent
  on public.employee_document_views (viewer_id, file_path, viewed_at desc);

create trigger set_audit_fields before insert or update on public.employee_documents
  for each row execute function public.set_audit_fields();
create trigger write_audit_log after insert or update or delete on public.employee_documents
  for each row execute function public.write_audit_log();

alter table public.employee_documents enable row level security;
alter table public.employee_document_views enable row level security;
revoke all on public.employee_documents, public.employee_document_views from anon, authenticated;

comment on table public.employee_documents is
  'D95 — the documents on a person''s record. Replaced or removed, never deleted. Read, written and opened only through the employee_document_* functions.';
comment on table public.employee_document_views is
  'D95 — every opening of a document, by whom and when. Storage hands out a link only against a view logged in the last five minutes.';

-- ═══════════════════════════════════════════════════════════ who

/** The caller may see and add documents on this record: the person, or the Employee Admin. */
create or replace function public.employee_documents_allowed(_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.employees e
     where e.id = _employee_id
       and e.organization_id = public.current_org_id()
       and e.deleted_at is null
       and public.module_enabled_for(e.organization_id, 'employee')
       and (e.profile_id = (select auth.uid()) or public.is_module_admin('employee')))
$$;

revoke all on function public.employee_documents_allowed(uuid) from public, anon;
grant execute on function public.employee_documents_allowed(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════ read

create or replace function public.employee_documents_list(_employee_id uuid)
returns table (
  id            uuid,
  doc_type      text,
  title         text,
  file_name     text,
  size_bytes    integer,
  uploaded_at   timestamptz,
  uploaded_by   text,
  expires_on    date,
  verified_at   timestamptz,
  verified_by   text,
  status        text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today date;
begin
  if not public.employee_documents_allowed(_employee_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  v_today := public.org_today(public.current_org_id());
  return query
    select d.id, d.doc_type, d.title, d.file_name, d.size_bytes, d.uploaded_at,
           (select coalesce(up.full_name, 'Somebody') from public.profiles up where up.id = d.uploaded_by)::text,
           d.expires_on, d.verified_at,
           (select vp.full_name from public.profiles vp where vp.id = d.verified_by)::text,
           (case when d.expires_on is not null and d.expires_on < v_today then 'expired'
                 when d.verified_at is not null then 'verified'
                 else 'uploaded' end)::text
      from public.employee_documents d
     where d.employee_id = _employee_id
       and d.replaced_at is null and d.removed_at is null
     order by d.doc_type, d.title nulls first, d.uploaded_at;
end $$;

comment on function public.employee_documents_list is
  'D95 — the documents on file for a record, one live file each: uploaded, verified or expired. The person and the Employee Admin only.';

revoke all on function public.employee_documents_list(uuid) from public, anon;
grant execute on function public.employee_documents_list(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════ add

create or replace function public.employee_document_add(
  _employee_id uuid,
  _doc_type    text,
  _title       text,
  _file_path   text,
  _file_name   text,
  _mime_type   text,
  _size_bytes  integer,
  _expires_on  date default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  v_id  uuid;
  v_title text := nullif(btrim(coalesce(_title, '')), '');
begin
  if not public.employee_documents_allowed(_employee_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  -- The file must be the one just uploaded into this record's own folder.
  if _file_path is null or _file_path not like v_org::text || '/' || _employee_id::text || '/%' then
    raise exception 'FILE_NOT_IN_RECORD' using errcode = 'P0001';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'employee-documents' and o.name = _file_path) then
    raise exception 'FILE_NOT_UPLOADED' using errcode = 'P0001';
  end if;
  if _doc_type in ('relieving_letter', 'other') and v_title is null then
    raise exception 'TITLE_REQUIRED' using errcode = 'P0001';
  end if;
  if _expires_on is not null and _expires_on < public.org_today(v_org) then
    raise exception 'ALREADY_EXPIRED' using errcode = 'P0001';
  end if;

  -- The same document again closes the one before it. A relieving letter or an
  -- "other" is the same document only under the same name.
  update public.employee_documents
     set replaced_at = now()
   where employee_id = _employee_id and doc_type = _doc_type
     and replaced_at is null and removed_at is null
     and (_doc_type not in ('relieving_letter', 'other') or lower(title) = lower(v_title));

  begin
    insert into public.employee_documents
      (organization_id, employee_id, doc_type, title, file_path, file_name, mime_type, size_bytes,
       expires_on, uploaded_by)
    values
      (v_org, _employee_id, _doc_type,
       case when _doc_type in ('relieving_letter', 'other') then v_title end,
       _file_path, left(coalesce(nullif(btrim(_file_name), ''), 'document'), 200), _mime_type, _size_bytes,
       _expires_on, (select auth.uid()))
    returning id into v_id;
  exception when check_violation then
    raise exception 'INVALID_DOCUMENT' using errcode = 'P0001';
  when unique_violation then
    raise exception 'FILE_ALREADY_FILED' using errcode = 'P0001';
  end;
  return v_id;
end $$;

comment on function public.employee_document_add is
  'D95 — files an uploaded document on a record, closing the one it replaces. The person or the Employee Admin.';

revoke all on function public.employee_document_add(uuid, text, text, text, text, text, integer, date) from public, anon;
grant execute on function public.employee_document_add(uuid, text, text, text, text, text, integer, date) to authenticated;

-- ═══════════════════════════════════════════════════════════ verify, remove

create or replace function public.employee_document_verify(_document_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_d public.employee_documents%rowtype;
begin
  select * into v_d from public.employee_documents
   where id = _document_id and organization_id = public.current_org_id()
     and replaced_at is null and removed_at is null;
  if v_d.id is null or not public.is_module_admin('employee') then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  -- Nobody vouches for their own papers.
  if exists (select 1 from public.employees where id = v_d.employee_id and profile_id = (select auth.uid())) then
    raise exception 'NOT_YOUR_OWN' using errcode = 'P0001';
  end if;
  update public.employee_documents
     set verified_at = now(), verified_by = (select auth.uid())
   where id = v_d.id;
end $$;

revoke all on function public.employee_document_verify(uuid) from public, anon;
grant execute on function public.employee_document_verify(uuid) to authenticated;

create or replace function public.employee_document_remove(_document_id uuid, _reason text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_d public.employee_documents%rowtype;
begin
  select * into v_d from public.employee_documents
   where id = _document_id and organization_id = public.current_org_id()
     and replaced_at is null and removed_at is null;
  if v_d.id is null or not public.is_module_admin('employee') then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if length(btrim(coalesce(_reason, ''))) < 3 then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  update public.employee_documents
     set removed_at = now(), removed_by = (select auth.uid()), removed_reason = btrim(_reason)
   where id = v_d.id;
end $$;

revoke all on function public.employee_document_remove(uuid, text) from public, anon;
grant execute on function public.employee_document_remove(uuid, text) to authenticated;

-- ═══════════════════════════════════════════════════════════ open, logged

create or replace function public.employee_document_open(_document_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_d public.employee_documents%rowtype;
begin
  select * into v_d from public.employee_documents
   where id = _document_id and organization_id = public.current_org_id()
     and removed_at is null;
  if v_d.id is null or not public.employee_documents_allowed(v_d.employee_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  insert into public.employee_document_views (document_id, file_path, viewer_id)
  values (v_d.id, v_d.file_path, (select auth.uid()));
  return v_d.file_path;
end $$;

comment on function public.employee_document_open is
  'D95 — logs that the caller is opening a document and returns its path; storage signs a link only against such a log in the last five minutes.';

revoke all on function public.employee_document_open(uuid) from public, anon;
grant execute on function public.employee_document_open(uuid) to authenticated;

/** Who has opened a record's documents: the Employee Admin's to read. */
create or replace function public.employee_document_views_list(_employee_id uuid)
returns table (document_id uuid, doc_type text, title text, viewer_name text, viewed_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_module_admin('employee') or not public.employee_documents_allowed(_employee_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  return query
    select v.document_id, d.doc_type, d.title, coalesce(p.full_name, p.email)::text, v.viewed_at
      from public.employee_document_views v
      join public.employee_documents d on d.id = v.document_id
      join public.profiles p on p.id = v.viewer_id
     where d.employee_id = _employee_id
     order by v.viewed_at desc
     limit 200;
end $$;

revoke all on function public.employee_document_views_list(uuid) from public, anon;
grant execute on function public.employee_document_views_list(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════ the bucket

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('employee-documents', 'employee-documents', false, 10 * 1024 * 1024,
        array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

/** Storage asks: may the caller upload into this record's folder? */
create or replace function public.employee_document_may_upload(_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (storage.foldername(_name))[1] = public.current_org_id()::text
     and public.employee_documents_allowed(nullif((storage.foldername(_name))[2], '')::uuid)
$$;

/** Storage asks: has the caller logged opening this file in the last five minutes? */
create or replace function public.employee_document_may_read(_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.employee_document_views v
     where v.viewer_id = (select auth.uid())
       and v.file_path = _name
       and v.viewed_at > now() - interval '5 minutes')
$$;

revoke all on function public.employee_document_may_upload(text) from public, anon;
revoke all on function public.employee_document_may_read(text) from public, anon;
grant execute on function public.employee_document_may_upload(text) to authenticated;
grant execute on function public.employee_document_may_read(text) to authenticated;

drop policy if exists "upload employee documents" on storage.objects;
drop policy if exists "read opened employee documents" on storage.objects;

create policy "upload employee documents" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'employee-documents' and public.employee_document_may_upload(name));

create policy "read opened employee documents" on storage.objects
  for select to authenticated
  using (bucket_id = 'employee-documents' and public.employee_document_may_read(name));
