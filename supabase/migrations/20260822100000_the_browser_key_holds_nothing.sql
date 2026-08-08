-- ============================================================================
-- NEUVTO WOS — The browser key holds nothing
--
-- `anon` is the role the PUBLISHABLE KEY resolves to, and that key ships inside
-- the JavaScript bundle. Anyone who opens the site has it.
--
-- On 9 Aug 2026 `anon` held SELECT, INSERT, UPDATE, DELETE, TRUNCATE,
-- REFERENCES and TRIGGER on 24 of the 27 tables in `public`. Not through any
-- decision recorded anywhere — through Supabase's stock default privileges,
-- which grant everything on every new table to anon, authenticated and
-- service_role.
--
-- Nothing was exposed. Row-level security refused every one of those reads, and
-- the harness proves it does. That is exactly the problem: RLS was carrying the
-- whole weight on its own, and a single policy written with `using (true)` — or
-- one table that someone forgets to enable RLS on — would have been the entire
-- distance between a stranger and every customer's employee records.
--
-- GRANT and RLS are two different questions. RLS answers "which rows"; GRANT
-- answers "may you touch this table at all". The second question had been
-- answered "yes" for a role that should never have been able to ask it.
--
-- This migration is the same decision as 20260808100000 `anon executes nothing`,
-- applied to tables instead of functions.
-- ============================================================================

-- ═════════════════════════════════════════════════ 1 · anon holds nothing
--
-- Verified before writing this, rather than assumed: NOTHING in the product
-- reaches a table without a session.
--
--   • the landing page's demo form   → the `demo-request` edge function, which
--                                      holds the service key
--   • the crash reporter             → the `client-error` edge function, same
--   • sign-in                        → GoTrue, which lives in `auth`, not here
--   • accepting an invitation        → `invitation_accept`, granted to
--                                      `authenticated`, and the person has
--                                      already proved the address by then
--   • every app route                → `ssr: false`, so all loading is
--                                      client-side and carries the user's JWT
--
-- The server-side client uses the SERVICE ROLE key and bypasses RLS entirely,
-- so it is unaffected. `auth-attacher` puts the signed-in user's access token on
-- server-rendered requests, so those run as `authenticated` too — there is no
-- path where the app is legitimately `anon` against a table.
revoke all on all tables in schema public from anon;

-- ═════════════════════════════════════ 2 · authenticated keeps only its DML
--
-- SELECT, INSERT, UPDATE and DELETE STAY. They are load-bearing: the browser
-- talks to PostgREST as `authenticated`, and RLS restricts what it may reach
-- rather than the grant. Revoking them would not harden anything — it would
-- take the application offline.
--
-- The other four go, and none of them has ever been used by anything:
--
--   TRUNCATE   empties a table, ignores RLS, and cannot be rolled back into
--              existence. This is the one that matters. On 8 Aug 2026
--              db-guardian emptied `demo_requests` — every prospect who had
--              ever filled in the form — while signed in as an ORDINARY
--              EMPLOYEE of a customer organisation.
--   REFERENCES lets a role point a foreign key at the table.
--   TRIGGER    lets a role attach a trigger to it.
--   MAINTAIN   PostgreSQL 17's VACUUM/ANALYZE/REINDEX privilege.
revoke truncate, references, trigger, maintain
  on all tables in schema public from authenticated;

-- ═══════════════════ 2b · the tables that are meant to be unreachable, are
--
-- Three tables have RLS enabled and DELIBERATELY NO POLICY, which is how this
-- schema says "reachable only through a SECURITY DEFINER function". Their own
-- migrations say a grant would defeat it. `platform_admins` puts it plainest:
--
--     "DELIBERATELY EMPTY. No policy, and no grant to `authenticated` either.
--      Both are needed: RLS restricts, GRANT permits, and a table with RLS
--      enabled and no policy still refuses everything — but only because
--      nothing was granted in the first place."
--
-- That was true of the local database and FALSE OF PRODUCTION, where the stock
-- default had quietly granted SELECT on `platform_admins` to both `anon` and
-- `authenticated` — on the table the same file calls "THE MOST DANGEROUS TABLE
-- IN THE SCHEMA", whose membership is god-mode over provisioning.
--
-- Nothing was readable: RLS with no policy denies every non-owner, so the grant
-- was inert. But the sentence above describes two layers, and only one of them
-- was there. This restores the one that had gone missing.
--
-- Named explicitly rather than derived from "has no policy", so that a future
-- table arriving in that state is somebody's decision rather than something
-- this file sweeps up silently. The invariant added alongside catches it.
revoke all on public.platform_admins              from anon, authenticated;
revoke all on public.client_errors                from anon, authenticated;
revoke all on public.platform_test_organizations  from anon, authenticated;

-- ═══════════════════════════════════════ 3 · and new tables start that way
--
-- Migrations run as `postgres`, so this is the default that governs every table
-- this project will create from now on. Without it, the next `create table`
-- silently re-grants TRUNCATE to both roles and the revoke above becomes a
-- one-off tidy rather than a rule.
alter default privileges for role postgres in schema public
  revoke all on tables from anon;

alter default privileges for role postgres in schema public
  revoke truncate, references, trigger, maintain on tables from authenticated;

-- ⚠️ ONE DEFAULT CANNOT BE FIXED FROM HERE, AND IT IS WHY THE INVARIANT EXISTS.
--
-- There are TWO default-ACL entries for schema `public`, not one:
--
--   postgres        anon=Dxtm         authenticated=Dxtm
--   supabase_admin  anon=arwdDxtm     authenticated=arwdDxtm
--
-- The second is the reason the older tables carry full anon DML while
-- `platform_test_organizations` — created by a migration running as postgres —
-- only ever had TRUNCATE, REFERENCES and TRIGGER.
--
-- `alter default privileges for role supabase_admin` fails with "permission
-- denied to change default privileges": `postgres` is not a member of
-- `supabase_admin` and cannot speak for it. Attempted, not guessed.
--
-- In practice nothing this project runs creates tables as `supabase_admin`, so
-- the exposure is theoretical — but "theoretical" is what the stock default was
-- yesterday. `verify_invariants.sql` therefore asserts the property itself
-- rather than trusting the mechanism, so a table that arrives by any route at
-- all fails the harness instead of sitting there quietly.

-- ═══════════════════════════════════════════════════════ what is NOT touched
--
-- `service_role` keeps everything, deliberately. It is the key held by the edge
-- functions and by migrations, it already bypasses RLS by design, and it never
-- reaches a browser. Revoking from it would break the notification dispatcher
-- and the demo form and harden nothing.
--
-- Sequences and identity columns: there are none in `public` — every primary key
-- is a uuid with `gen_random_uuid()`. Checked rather than assumed, which is why
-- this migration says nothing about sequence grants.
