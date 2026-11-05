-- Sada, 3 Nov 2026 (D117): one person, one record.
--
--   1 · A nominee is a family member. A nominee is linked to the person in
--       Family (`nominees.family_member_id`): chosen from the list, matched by
--       relation for a father or mother, or added to Family when new. Saving a
--       nomination writes the nominee's name and date of birth back to Family;
--       saving Family re-issues the current nomination when a nominee's details
--       changed (a new version from today, the old kept; the same day it is a
--       correction, as before). Sada: "I cannot have two different fathers."
--   2 · One father and one mother. Family refuses a second of either.
--   3 · Reports to is optional by default: the CEO reports to nobody.
--   4 · A driving licence starts with a real state or union territory code,
--       any of them: Maharashtra's MH as much as Karnataka's KA.

-- ═══════════════════════════════════════════════════════ 1 · the link

-- No foreign key, deliberately: nominees are append-only (a nomination is a
-- declaration), and ON DELETE SET NULL is an update the history trigger
-- refuses. A link to a family member since removed is simply not followed.
alter table public.nominees add column if not exists family_member_id uuid;

comment on column public.nominees.family_member_id is
  'D117: the family member this nominee is. Not a foreign key: nominees are append-only.';

-- ═══════════════════════════════════════════════════════ 2 · one father, one mother

do $$
declare
  v_def text := pg_get_functiondef('public.employee_save_family(uuid,jsonb)'::regprocedure);
  v_anchor text := $q$  select organization_id into v_org from public.employees where id = _employee_id;
  begin$q$;
begin
  if position(v_anchor in v_def) = 0 then
    raise exception 'employee_save_family no longer reads its organisation as expected; restate it here';
  end if;
  execute replace(v_def, v_anchor, $q$  select organization_id into v_org from public.employees where id = _employee_id;
  -- D117. One father and one mother: a second of either is a mistake.
  select x.rel into t
    from (select e ->> 'relation' as rel from jsonb_array_elements(_rows) e) x
   where x.rel in ('father', 'mother')
   group by x.rel having count(*) > 1 limit 1;
  if t is not null then
    raise exception 'ONE_PARENT_EACH' using errcode = 'P0001', detail = t;
  end if;
  begin$q$);
end $$;

-- ═══════════════════════════════════════════════════════ 3 · the nomination, written

-- What employee_save_nomination did, with the nominee's link kept, and no
-- writer check of its own: its callers check (the person's save), or are the
-- sync from Family (whose save was checked).
do $$
declare
  v_def text := pg_get_functiondef('public.employee_save_nomination(uuid,jsonb)'::regprocedure);
  v_new text;
begin
  v_new := replace(v_def, 'FUNCTION public.employee_save_nomination(', 'FUNCTION public.employee_write_nomination(');
  v_new := replace(v_new, $q$  perform public.employee_require_writer(_employee_id, array['nomineeName']);
$q$, '');
  v_new := replace(v_new,
    $q$insert into public.nominees (organization_id, version_id, name, relation, date_of_birth, share_percent)
    select v_org, v_id, btrim(r ->> 'name'), r ->> 'relation', (r ->> 'dateOfBirth')::date,
           (r ->> 'sharePercent')::numeric$q$,
    $q$insert into public.nominees (organization_id, version_id, name, relation, date_of_birth, share_percent, family_member_id)
    select v_org, v_id, btrim(r ->> 'name'), r ->> 'relation', (r ->> 'dateOfBirth')::date,
           (r ->> 'sharePercent')::numeric, nullif(r ->> 'familyMemberId', '')::uuid$q$);
  if position('employee_write_nomination' in v_new) = 0
     or position('employee_require_writer' in v_new) > 0
     or position('family_member_id' in v_new) = 0 then
    raise exception 'employee_save_nomination no longer reads as expected; restate it here';
  end if;
  execute v_new;
end $$;

revoke all on function public.employee_write_nomination(uuid, jsonb) from public, anon, authenticated;

/**
 * The person's own save, or an Admin's. Each nominee is linked to a family
 * member: the one named, else the father or mother of that relation, else
 * the one of that relation and name, else a new member added to Family. A nominee's name or date of birth left empty is
 * Family's; one typed is written back to Family. Where the person may not
 * change Family (the company keeps it, D107), Family wins: a linked nominee
 * takes Family's details, and somebody new is nominated without being added.
 */
create or replace function public.employee_save_nomination(_employee_id uuid, _values jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_rows    jsonb := _values -> 'nominees';
  v_family  jsonb;
  v_linked  jsonb := '[]'::jsonb;
  v_out     jsonb := '[]'::jsonb;
  n         jsonb;
  v_link    uuid;
  v_changed boolean := false;
  v_result  uuid;
  v_member  jsonb;
begin
  perform public.employee_require_writer(_employee_id, array['nomineeName']);
  if v_rows is null or jsonb_typeof(v_rows) <> 'array' or jsonb_array_length(v_rows) = 0 then
    raise exception 'NOMINEES_REQUIRED' using errcode = 'P0001';
  end if;

  -- Family as it is, in its own order, as employee_save_family takes it.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', f.id, 'relation', f.relation, 'name', f.name,
           'dateOfBirth', f.date_of_birth, 'isDependent', f.is_dependent) order by f.sort_order), '[]'::jsonb)
    into v_family
    from public.family_members f where f.employee_id = _employee_id;

  for n in select * from jsonb_array_elements(v_rows) loop
    v_link := nullif(n ->> 'familyMemberId', '')::uuid;
    if v_link is not null and not exists (
         select 1 from public.family_members f where f.id = v_link and f.employee_id = _employee_id) then
      v_link := null;
    end if;
    if v_link is null and n ->> 'relation' in ('father', 'mother') then
      select f.id into v_link from public.family_members f
       where f.employee_id = _employee_id and f.relation = n ->> 'relation' limit 1;
    end if;
    -- Somebody already in Family under the same relation and name is that
    -- person, not a second one (a spreadsheet lists them in both, CI 3 Nov 2026).
    if v_link is null then
      select f.id into v_link from public.family_members f
       where f.employee_id = _employee_id and f.relation = n ->> 'relation'
         and lower(regexp_replace(btrim(f.name), '\s+', ' ', 'g'))
             = lower(regexp_replace(btrim(coalesce(n ->> 'name', '')), '\s+', ' ', 'g'))
       limit 1;
    end if;

    if v_link is not null then
      -- What is left empty here is Family's.
      select f into v_member from jsonb_array_elements(v_family) f where (f ->> 'id')::uuid = v_link;
      if nullif(btrim(coalesce(n ->> 'name', '')), '') is null then
        n := n || jsonb_build_object('name', v_member ->> 'name');
      end if;
      if nullif(n ->> 'dateOfBirth', '') is null then
        n := n || jsonb_build_object('dateOfBirth', v_member ->> 'dateOfBirth');
      end if;
      -- Family takes what was typed here, when it differs.
      if v_member ->> 'name' is distinct from btrim(n ->> 'name')
         or v_member ->> 'relation' is distinct from n ->> 'relation'
         or nullif(v_member ->> 'dateOfBirth', '') is distinct from nullif(n ->> 'dateOfBirth', '') then
        select coalesce(jsonb_agg(case when (f ->> 'id')::uuid = v_link
                 then f || jsonb_build_object('name', btrim(n ->> 'name'), 'relation', n ->> 'relation',
                                              'dateOfBirth', nullif(n ->> 'dateOfBirth', ''))
                 else f end), '[]'::jsonb)
          into v_family from jsonb_array_elements(v_family) f;
        v_changed := true;
      end if;
    else
      -- Somebody new: into Family too.
      v_family := v_family || jsonb_build_array(jsonb_build_object(
        'relation', n ->> 'relation', 'name', btrim(n ->> 'name'),
        'dateOfBirth', nullif(n ->> 'dateOfBirth', ''), 'isDependent', true));
      v_changed := true;
    end if;
    v_linked := v_linked || jsonb_build_array(n || jsonb_build_object('familyMemberId', v_link));
  end loop;

  if v_changed then
    perform set_config('neuvto.syncing', 'nomination', true);
    begin
      perform public.employee_save_family(_employee_id, v_family);
    exception when insufficient_privilege then
      -- Family is not theirs to change: Family wins. Linked nominees take
      -- Family's details; somebody new stays a nominee only.
      select coalesce(jsonb_agg(case
               when f.id is not null then x.n || jsonb_build_object(
                 'name', f.name, 'relation', f.relation, 'dateOfBirth', f.date_of_birth)
               else x.n end), '[]'::jsonb)
        into v_linked
        from jsonb_array_elements(v_linked) x(n)
        left join public.family_members f
          on f.id = nullif(x.n ->> 'familyMemberId', '')::uuid and f.employee_id = _employee_id;
    end;
    perform set_config('neuvto.syncing', '', true);
  end if;

  -- The new members' ids, now that Family has them.
  for n in select * from jsonb_array_elements(v_linked) loop
    if nullif(n ->> 'familyMemberId', '') is null then
      select f.id into v_link from public.family_members f
       where f.employee_id = _employee_id and f.relation = n ->> 'relation'
         and lower(f.name) = lower(btrim(n ->> 'name'))
       order by f.created_at desc limit 1;
      n := n || jsonb_build_object('familyMemberId', v_link);
    end if;
    v_out := v_out || jsonb_build_array(n);
  end loop;

  v_result := public.employee_write_nomination(_employee_id, jsonb_set(_values, '{nominees}', v_out));
  return v_result;
end $$;

revoke all on function public.employee_save_nomination(uuid, jsonb) from public, anon;
grant execute on function public.employee_save_nomination(uuid, jsonb) to authenticated;

-- ═══════════════════════════════════════════════════════ 4 · Family, followed by the nomination

/**
 * After Family is saved: when a nominee of the current nomination is a family
 * member whose name, relation or date of birth now differ, the nomination is
 * re-issued from today with them (the old version kept). Not when the save
 * came from the nomination itself.
 */
create or replace function public.employee_resync_nomination(_employee_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_open public.nomination_versions%rowtype;
  v_rows jsonb;
begin
  if coalesce(current_setting('neuvto.syncing', true), '') = 'nomination' then
    return;
  end if;
  select * into v_open from public.nomination_versions
   where employee_id = _employee_id and effective_to is null limit 1;
  if not found then
    return;
  end if;
  if not exists (
    select 1 from public.nominees n join public.family_members f on f.id = n.family_member_id
     where n.version_id = v_open.id
       and (f.name is distinct from n.name or f.relation is distinct from n.relation
         or f.date_of_birth is distinct from n.date_of_birth)) then
    return;
  end if;
  select jsonb_agg(jsonb_build_object(
           'name', coalesce(f.name, n.name), 'relation', coalesce(f.relation, n.relation),
           'dateOfBirth', case when f.id is not null then f.date_of_birth else n.date_of_birth end,
           'sharePercent', n.share_percent, 'familyMemberId', n.family_member_id))
    into v_rows
    from public.nominees n left join public.family_members f on f.id = n.family_member_id
   where n.version_id = v_open.id;
  perform public.employee_write_nomination(_employee_id, jsonb_build_object(
    'effectiveFrom', greatest(public.org_today(public.current_org_id()), v_open.effective_from),
    'nominees', v_rows));
end $$;

revoke all on function public.employee_resync_nomination(uuid) from public, anon, authenticated;

do $$
declare
  v_def text := pg_get_functiondef('public.employee_save_family(uuid,jsonb)'::regprocedure);
  v_anchor text := $q$  delete from public.family_members where employee_id = _employee_id and id <> all (v_keep);
$q$;
begin
  if position(v_anchor in v_def) = 0 then
    raise exception 'employee_save_family no longer ends as expected; restate it here';
  end if;
  execute replace(v_def, v_anchor, v_anchor || $q$  -- D117. The current nomination follows its nominees' family details.
  perform public.employee_resync_nomination(_employee_id);
$q$);
end $$;

-- The card says which family member each nominee is.
do $$
declare
  v_def text := pg_get_functiondef('public.employee_card(uuid)'::regprocedure);
  v_old text := $q$'dateOfBirth', n.date_of_birth, 'sharePercent', n.share_percent)$q$;
begin
  if position(v_old in v_def) = 0 then
    raise exception 'employee_card no longer builds nominees as expected; restate it here';
  end if;
  execute replace(v_def, v_old,
    $q$'dateOfBirth', n.date_of_birth, 'sharePercent', n.share_percent, 'familyMemberId', n.family_member_id)$q$);
end $$;

-- ═══════════════════════════════════════════════════════ 5 · Reports to, optional

do $$
declare
  v_def text := pg_get_functiondef('public.employee_field_defaults()'::regprocedure);
  v_old text := $q$('reportsTo',              'Reports to',               array['managerId'],            28, true,$q$;
begin
  if position(v_old in v_def) = 0 then
    raise exception 'employee_field_defaults no longer lists Reports to as expected; restate it here';
  end if;
  execute replace(v_def, v_old,
    $q$('reportsTo',              'Reports to',               array['managerId'],            28, false,$q$);
end $$;

-- ═══════════════════════════════════════════════════════ 6 · a licence from any state

/** The two-letter codes a driving licence can start with: every state and union territory, old codes too. */
create or replace function public.indian_licence_state(_code text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select upper(coalesce(_code, '')) = any (array[
    'AN','AP','AR','AS','BR','CG','CH','DD','DL','DN','GA','GJ','HP','HR','JH','JK','KA','KL',
    'LA','LD','MH','ML','MN','MP','MZ','NL','OD','OR','PB','PY','RJ','SK','TG','TN','TR','TS',
    'UA','UK','UP','WB'])
$$;

do $$
declare
  v_def text := pg_get_functiondef('public.employee_set_statutory(uuid,jsonb)'::regprocedure);
  v_old text := $q$if v is not null and v !~ '^[A-Z]{2}[0-9A-Z]{8,16}$' then$q$;
begin
  if position(v_old in v_def) = 0 then
    raise exception 'employee_set_statutory no longer checks the licence as expected; restate it here';
  end if;
  execute replace(v_def, v_old,
    $q$if v is not null and (v !~ '^[A-Z]{2}[0-9A-Z]{8,16}$' or not public.indian_licence_state(left(v, 2))) then$q$);
end $$;
