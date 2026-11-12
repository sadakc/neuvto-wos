-- ============================================================================
-- NEUVTO WOS — Super Admin, Payroll and Statutory become roles (D78, D80)
-- ============================================================================
--
-- Three values, and nothing that uses them. A Postgres enum value cannot be
-- used in the same transaction that adds it ("unsafe use of new value"), and
-- the CLI applies each migration file as one transaction, so the functions,
-- policies and backfill that use these live in the next file.
--
--   super_admin        Granted by Neuvto's provisioning, then by another Super
--                      Admin. The only role that grants administrator roles.
--   payroll_officer    Reads bank details and salary, nothing more. Separate
--                      from Admin because the HR administrator should not be
--                      able to read everybody's account number by default.
--   statutory_officer  Reveals Aadhaar, PAN and the restricted block, every
--                      reveal logged (D80). The narrowest and most sensitive
--                      grant in the product.
--
-- A Postgres enum value can be added and never removed. These three were
-- asked for on 11 Oct 2026 with the screens that need them in hand, which is
-- the bar `Officer` did not meet on 18 Aug.
-- ============================================================================

alter type public.app_role add value if not exists 'super_admin';
alter type public.app_role add value if not exists 'payroll_officer';
alter type public.app_role add value if not exists 'statutory_officer';

comment on type public.app_role is
  'D4 — roles live in user_roles, never on profiles. super_admin, org_admin and hr_admin administer (is_admin); only super_admin grants the administrator roles (D78). manager, supervisor and coordinator approve (D57). payroll_officer and statutory_officer are narrow data grants, separate from Admin (D80). employee does none of these.';
