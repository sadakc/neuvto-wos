-- ============================================================================
-- NEUVTO WOS — Supervisor and Coordinator
--
-- Sada, 7 Aug 2026: "Add Supervisor, Coordinator, Officer... Right now, add
-- only these three." Then, once told an enum value can be added but never
-- removed: "Officer is not required right now, You can keep it out."
--
-- So two values, not three. That asymmetry is deliberate and worth stating,
-- because the cost is asymmetric: adding Officer later is this file again with
-- one more line, while removing it needs a new type, a rewrite of every column
-- and function that mentions app_role, and a lock on `user_roles` while it
-- happens. A one-way door is only worth walking through when you want what is
-- on the other side.
--
-- ── WHY THIS FILE CONTAINS NOTHING ELSE
--
-- `ALTER TYPE ... ADD VALUE` may run inside a transaction from Postgres 12, but
-- the new value cannot be USED until that transaction commits. The Supabase CLI
-- runs each migration file as one transaction, so anything referring to
-- 'supervisor' — a CHECK constraint, a SQL function body validated at creation,
-- a seeded row — belongs in the NEXT file, not this one.
--
-- That is why this migration is three statements and a long comment. It is not
-- an oversight; splitting it is the whole point. Everything that uses the new
-- values is in 20260818110000_an_employee_cannot_approve.sql.
--
-- ── WHAT THE NEW ROLES MEAN
--
-- Approvers, not administrators. `canApprove` gains them; `is_admin` does NOT.
-- A Supervisor signs off leave for the people who report to them and cannot see
-- Settings, People, or any report covering the whole workspace — those stay
-- org_admin and hr_admin, which is what `is_admin()` has always meant and what
-- every RLS policy in the product is written against.
-- ============================================================================

alter type public.app_role add value if not exists 'supervisor';
alter type public.app_role add value if not exists 'coordinator';

comment on type public.app_role is
  'D4 — roles live in user_roles, never on profiles. org_admin and hr_admin administer (is_admin); manager, supervisor and coordinator approve (D57); employee does neither.';
