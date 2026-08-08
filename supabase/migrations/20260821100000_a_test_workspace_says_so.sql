-- ============================================================================
-- NEUVTO WOS — A test workspace says so
--
-- Neuvto is being tested in production, on purpose. Sada, 8 Aug 2026:
--
--   "Any data that I'd add now might be a hard delete later. I might ask you to
--    do a hard delete later, once all my testing is done."
--
-- Nothing in the schema could answer "which of these is a rehearsal". That cost
-- nothing while production held exactly one organisation — "delete the test
-- data" and "delete everything" were the same sentence. It stops being free at
-- the second organisation, and from then on every week of testing adds rows
-- that only somebody's memory can classify.
--
-- So the marker lands BEFORE the second organisation, not before the purge.
-- That ordering is the entire point of this migration; it has no user-visible
-- effect today.
--
-- WHAT THIS DOES NOT DO: delete anything. The purge function is deliberately
-- not written here — see docs/operations/TEST_DATA_PURGE.md. A registry with no
-- purge is inert and safe; a purge with no registry is the accident.
-- ============================================================================

-- ═══════════════════════════════════════════════ which workspaces are ours

-- A SEPARATE TABLE, NOT `organizations.is_test`.
--
-- A flag on the customer table is one `if` away from a second code path —
-- `if is_test then skip the email` — and a test workspace that behaves
-- differently from a real one has stopped testing the real one. Nothing in the
-- product may read this table, and keeping it out of `organizations` is what
-- makes that easy to hold: no product query joins here by accident.
--
-- It is platform metadata ABOUT a tenant, not tenant data (D42), which is also
-- why it lives behind is_platform_admin() rather than an RLS policy.
create table public.platform_test_organizations (
  organization_id uuid primary key
                  references public.organizations(id) on delete cascade,
  -- Required, and required to say something. In two months the question will
  -- not be "is this a test" but "what was I testing" — and an empty string is
  -- the answer nobody can act on.
  --
  -- `[[:alnum:]]` — at least one letter or digit — and NOT the obvious
  -- `char_length(btrim(reason)) > 0`, which this shipped with for an afternoon.
  -- `btrim()` strips ASCII space (chr 32) and nothing else, so a reason of one
  -- TAB satisfied it, satisfied the REASON_REQUIRED guard below, and rendered as
  -- an empty tooltip in the console: a real customer on the purge allow-list
  -- with no readable justification. Measured against every blank form, not
  -- assumed:
  --
  --   btrim(x) > 0     accepts tab, LF, CR, NBSP, every Unicode space, and the
  --                    zero-width family. Rejects only a plain space.
  --   x ~ '[^[:space:]]'  still accepts U+200B ZWSP, ZWNJ, ZWJ, U+2060 and the
  --                    BOM — the characters a paste from a web page carries.
  --   x ~ '[[:alnum:]]'   rejects all of them, and accepts Devanagari, digits
  --                    and ordinary English. Also rejects '---', which is as
  --                    useless an answer as a blank one.
  reason          text not null,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id) on delete set null,
  constraint platform_test_organizations_reason_not_blank
    check (reason ~ '[[:alnum:]]')
);

comment on table public.platform_test_organizations is
  'Workspaces Neuvto created to test itself. Platform-only (D42); no product code may read it. The allow-list a future purge must check before deleting anything.';

alter table public.platform_test_organizations enable row level security;

-- DELIBERATELY NO POLICY AND NO GRANT — the same shape as `platform_admins`,
-- and for a related reason.
--
-- RLS restricts, GRANT permits, and a table with RLS enabled and no policy
-- still refuses everything only because nothing was granted in the first place.
-- Reaching this table means going through a SECURITY DEFINER function that
-- checks is_platform_admin(), and there is no other path.
--
-- Note the direction of the danger here is the opposite of most tables. The
-- harm is not disclosure — it is a row appearing next to a real customer, which
-- is what would later license deleting them.

-- AND THE STOCK DEFAULT IS NOT "NOTHING GRANTED".
--
-- Supabase ships `alter default privileges ... grant all on tables to anon,
-- authenticated`, so a table created with no grant statement at all still
-- arrives with TRUNCATE, TRIGGER and REFERENCES held by every signed-in user of
-- every customer — verified on this table before this line was added. It is why
-- 25 of the 26 existing public tables can be emptied by any authenticated
-- session, a Tier-3 finding db-guardian raised on 8 Aug 2026 that is still open
-- and wants its own migration.
--
-- Revoked explicitly here so this table does not become the 26th. Fixing the
-- other 25 is a separate change with a separate blast radius.
--
-- The harm on THIS table would be denial rather than deletion — emptying the
-- registry makes a future purge refuse every workspace, because the allow-list
-- is what it checks. Fail-safe, and still not something to leave granted.
revoke all on public.platform_test_organizations from anon, authenticated;

-- `service_role` is NOT revoked, and keeps TRUNCATE, REFERENCES and TRIGGER.
-- Left deliberately: it is the role migrations and the edge functions run as,
-- it cannot read the table either way, and truncating the registry makes a
-- future purge refuse every workspace rather than delete one. The failure
-- direction is safe.
--
-- `created_by` is set on first marking and NOT refreshed when a marking is
-- replaced, so a re-marked row attributes the newer reason to whoever marked it
-- first. One platform admin exists, so this is a note rather than a defect;
-- revisit if Neuvto ever has two.

-- ═══════════════════════════════════════════════════════════ marking

create or replace function public.platform_mark_test_organization(
  _org    uuid,
  _reason text
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  -- Same rule as the CHECK, and stated the same way on purpose: if these two
  -- ever disagree, one of them produces a raw constraint-violation string where
  -- a named refusal was intended. `coalesce` because `null ~ anything` is NULL,
  -- not false, so a null reason would fall through the `if` and be caught by
  -- the NOT NULL as a 23502 instead of REASON_REQUIRED.
  if not (coalesce(_reason, '') ~ '[[:alnum:]]') then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;

  -- Not `on conflict do nothing`: re-marking should refresh the reason, because
  -- the second reason is the more recent truth about what this workspace is for.
  insert into public.platform_test_organizations (organization_id, reason, created_by)
  values (_org, btrim(_reason), (select auth.uid()))
  on conflict (organization_id) do update
    set reason = excluded.reason;
end $$;

comment on function public.platform_mark_test_organization is
  'Records a workspace as Neuvto''s own test data. Platform admins only. Deleting nothing — it only makes a later purge able to tell rehearsal from customer.';

-- ⚠️ EVERY `create function` IN THIS FILE NEEDS THE REVOKE BESIDE IT.
--
-- Postgres grants EXECUTE to PUBLIC on every newly created function, and `anon`
-- inherits PUBLIC. `20260808100000_anon_executes_nothing.sql` fixed the default
-- privileges and revoked from PUBLIC on the 48 functions that existed then — it
-- cannot reach one created afterwards.
--
-- This file shipped without these four lines and turned `verify_invariants.sql`
-- red: "4 SECURITY DEFINER function(s) are executable by anon — they bypass RLS
-- by definition". Worse for `provision_organization` and
-- `platform_list_organizations`, which HAD the PUBLIC grant revoked and got it
-- back, because `drop function` takes the revoke with it and `create` re-grants.
--
-- Nothing was exploitable — is_platform_admin() refuses an anonymous caller, and
-- all four answered a real unauthenticated HTTP request with 401/FORBIDDEN — but
-- that is one layer doing the work of two.
grant execute on function public.platform_mark_test_organization(uuid, text) to authenticated;
revoke execute on function public.platform_mark_test_organization(uuid, text) from public, anon;

create or replace function public.platform_unmark_test_organization(_org uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  delete from public.platform_test_organizations where organization_id = _org;
end $$;

comment on function public.platform_unmark_test_organization is
  'Withdraws the test marking — for a workspace that started as a rehearsal and became real. Platform admins only.';

grant execute on function public.platform_unmark_test_organization(uuid) to authenticated;
revoke execute on function public.platform_unmark_test_organization(uuid) from public, anon;

-- ═══════════════════════════════════════════ provisioning states the intent

-- The flag is set where the decision is actually made. Marking afterwards works
-- and is what `platform_mark_test_organization` is for, but it depends on
-- somebody remembering — which is the failure this whole migration exists to
-- avoid, so it must not be the primary path.
--
-- DROP AND RECREATE, NOT `create or replace`.
--
-- A new argument list makes a NEW function; `create or replace` would leave the
-- five-argument version in place beside it, and PostgREST would then have two
-- candidates for the same name. That trap cost a round of debugging on
-- `report_schedule_save` in #68 — recorded here so the next person adding a
-- parameter does not rediscover it.
drop function if exists public.provision_organization(text, text, text, text, text);

create or replace function public.provision_organization(
  _name        text,
  _slug        text,
  _admin_email text,
  _admin_phone text default null,
  _admin_name  text default null,
  _is_test     boolean default false
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org   uuid;
  v_slug  text := lower(btrim(_slug));
  v_email text := lower(btrim(_admin_email));
  v_inv   public.invitations%rowtype;
begin
  if not public.is_platform_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if btrim(coalesce(_name, '')) = '' then
    raise exception 'ORGANIZATION_NAME_REQUIRED' using errcode = 'P0001';
  end if;
  if v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'INVALID_EMAIL' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.organizations where slug = v_slug and deleted_at is null) then
    raise exception 'SLUG_TAKEN' using errcode = 'P0001';
  end if;

  insert into public.organizations (name, slug)
  values (btrim(_name), v_slug)
  returning id into v_org;

  insert into public.organization_settings (organization_id) values (v_org);

  -- Leave is the only module today. Enabled so the customer lands on something
  -- usable; the module registry screen turns others on as they arrive.
  insert into public.organization_modules (organization_id, module_key, enabled, enabled_at)
  values (v_org, 'leave', true, now());

  -- D37.
  perform public.install_default_approval_chain(v_org);

  -- Marked in the same transaction that creates it, so there is no window in
  -- which a test workspace exists unmarked. `_is_test` is a boolean here and a
  -- sentence in the registry, because "true" tells a reader nothing in October.
  if coalesce(_is_test, false) then
    insert into public.platform_test_organizations (organization_id, reason, created_by)
    values (v_org, 'Created as an internal test workspace from the console',
            (select auth.uid()));
  end if;

  -- The org_admin invitation. Written directly rather than through
  -- invitation_create, which resolves the organisation from current_org_id() —
  -- and a platform admin deliberately has no organisation of their own to
  -- resolve. The duplicate checks it performs are meaningless here anyway: the
  -- organisation was created a moment ago and has no members.
  insert into public.invitations (organization_id, email, phone, role, full_name)
  values (v_org, v_email, nullif(btrim(_admin_phone), ''), 'org_admin',
          nullif(btrim(_admin_name), ''))
  returning * into v_inv;

  perform public.emit_platform_event('member.invited', jsonb_build_object(
    'organization_id',   v_org,
    'organization_name', btrim(_name),
    'inviter_name',      'Neuvto',
    'email',             v_email,
    'full_name',         v_inv.full_name,
    'role',              'org_admin',
    'invite_url',        public.app_base_url() || '/auth?invite=' || v_inv.token,
    'expires_on',        to_char(v_inv.expires_at, 'DD Mon YYYY')
  ));

  -- `is_test` is DELIBERATELY NOT RECORDED HERE, though it was at first.
  --
  -- `analytics_events` is readable by the customer's own administrators —
  -- the policy is `organization_id = current_org_id() and is_admin()` — so
  -- putting the classification in `properties` handed every org_admin and
  -- hr_admin a `properties->>'is_test'` they could read on their own workspace.
  -- The registry is unreachable from any session; this row would not have been.
  --
  -- Which meant a customer wrongly marked could read Neuvto's opinion of them,
  -- and there is nothing to say back to that. The registry is the record; an
  -- analytics duplicate of it buys nothing and leaks across the tenant boundary
  -- the rest of this migration is careful about.
  insert into public.analytics_events (organization_id, user_id, event, properties)
  values (v_org, (select auth.uid()), 'organization.created',
          jsonb_build_object('slug', v_slug, 'provisioned', true));

  return v_org;
end $$;

comment on function public.provision_organization is
  'D39/D42/D64 — creates a customer workspace and invites its first administrator. Platform admins only. Creates no profile: the admin accepts an invitation like anyone else. `_is_test` records the workspace as Neuvto''s own rehearsal in the same transaction.';

grant execute on function public.provision_organization(text, text, text, text, text, boolean) to authenticated;
-- The drop above took the old signature's revoke with it. Without this line the
-- PUBLIC grant that 20260808100000 removed is silently back.
revoke execute on function public.provision_organization(text, text, text, text, text, boolean) from public, anon;

-- ═══════════════════════════════════════════════ the console can see it

-- DROP AND RECREATE, because the return type changes and `create or replace`
-- cannot alter one.
--
-- The column is added to the ONE function that is already the console's entire
-- read surface, rather than exposing the table — so the rule that this table is
-- unreachable from a session survives the feature that reads it.
drop function if exists public.platform_list_organizations();

create or replace function public.platform_list_organizations()
returns table (
  id              uuid,
  name            text,
  slug            text,
  created_at      timestamptz,
  member_count    bigint,
  admin_email     text,
  admin_accepted  boolean,
  admin_invite_url text,
  is_test         boolean,
  test_reason     text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  return query
    select o.id,
           o.name,
           o.slug,
           o.created_at,
           (select count(*) from public.profiles p
             where p.organization_id = o.id and p.deleted_at is null),
           i.email,
           (i.accepted_at is not null),
           -- The link, for the case the invitation email does not arrive and
           -- somebody has to be let in by hand. Sada provisioned this workspace
           -- and can revoke and reissue the invitation at will, so showing it
           -- grants nothing he did not already have. It disappears the moment
           -- the invitation is accepted.
           case when i.accepted_at is null and i.token is not null
                then public.app_base_url() || '/auth?invite=' || i.token
           end,
           (t.organization_id is not null),
           t.reason
      from public.organizations o
      left join lateral (
        select * from public.invitations inv
         where inv.organization_id = o.id
           and inv.role = 'org_admin'
           and inv.deleted_at is null
           and inv.revoked_at is null
         order by inv.created_at desc
         limit 1
      ) i on true
      left join public.platform_test_organizations t on t.organization_id = o.id
     where o.deleted_at is null
     order by o.created_at desc;
end $$;

comment on function public.platform_list_organizations is
  'D42 — every customer workspace, by name and count, and whether it is one of Neuvto''s own test workspaces. Discloses nothing about any employee, and no leave, balance or approval data.';

grant execute on function public.platform_list_organizations() to authenticated;
-- Same as provision_organization: dropped and recreated, so the revoke has to
-- be reapplied or `anon` holds EXECUTE on the console's entire read surface.
revoke execute on function public.platform_list_organizations() from public, anon;

-- ═══════════════════════════════════════════════════════ no backfill here
--
-- Production holds one organisation as of 8 Aug 2026 and it is a test one, so
-- an `insert ... select` over every existing row would be correct today and
-- catastrophic if it were wrong: a real customer provisioned between the
-- authoring of this file and its application would be silently enrolled in the
-- allow-list that a future purge deletes from.
--
-- A migration cannot check which of those two worlds it woke up in. A person
-- can. Marking the existing workspace is therefore one deliberate call to
-- platform_mark_test_organization, made after looking at the list, and it is
-- written down as a step in docs/operations/TEST_DATA_PURGE.md rather than
-- performed here.
