# Statutory and bank data: the encryption key, and going live

**Version:** 1.0 · **Status:** Active · **Applies to:** every environment's Vault, before any Aadhaar, PAN or bank account is entered there

D80. Neuvto stores Aadhaar, PAN, UAN, EPF and ESIC numbers, the bank account, and
religion, caste category and disability status. Every one of those values is
encrypted in the database with `pgcrypto` (AES-256) under one key per environment, held
in Supabase Vault. The design is in `product/NEUVTO_EMPLOYEE_MASTER.md`, under
"Restricted data"; this file is what an operator does.

**Cost: nothing.** Vault and `pgcrypto` are part of every Supabase plan, Free included.

---

## What protects what

| Layer                | What it does                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Encryption at rest   | The tables hold ciphertext and a last four. A database dump, a backup or a stray `select` shows no number.               |
| Keyed index          | Aadhaar and PAN are unique per company through an HMAC under the same key, so a number cannot be looked up by hash.      |
| No table access      | RLS on, no policy, no grant. Only the functions below reach these tables.                                                |
| Role-shaped card     | `employee_card()` sends each role exactly what §5 of the Employee Master allows. Admin never receives the bank block.    |
| Reveal               | `employee_reveal_restricted()` needs the right role and a stated reason, and writes `restricted_reads` before answering. |
| Audit without values | Writes to these tables are audited by which fields changed, never the value. Admins read `audit_logs`; it holds none.    |
| The browser          | A revealed value lives in one component's state, never a cache, URL or log, and is dropped after two minutes.            |

Who may reveal: Aadhaar and PAN, the Statutory role; the bank account, the Payroll role;
religion, caste and disability, the Statutory role or the person themselves. Who has
looked is shown to the person, a Super Admin and the Statutory role.

All of this is proved by `neuvto-harness/tests/verify_statutory.sql` (44 cases, ten
guards sabotaged) and the render tests in `src/modules/employee/components/`.

---

## Setting the key in an environment

**Local and the harness:** automatic. `neuvto-harness/seed/seed_test_data.sql` makes a
random key the first time and keeps it, labelled as a test key.

**Production, and any hosted QA or UAT project: by hand, once, before anybody enters a
number.** A key in a migration would be a key in git, so no migration creates it.

1. Generate 32 random bytes as hex, on your own machine:

   ```bash
   openssl rand -hex 32
   ```

2. Supabase dashboard → the project → **SQL Editor**, and run, pasting the value:

   ```sql
   select vault.create_secret('<the 64 hex characters>', 'statutory_encryption_key',
                              'D80 statutory encryption key. Never rotate without re-encrypting.');
   ```

3. Store the same value in the password manager, under "Neuvto statutory key, <environment>".
   **This is the only copy outside the database.** Supabase backups include Vault, but a
   lost key means every encrypted number in that environment is unreadable for good.

4. Check it took, without printing it:

   ```sql
   select name, length(decrypted_secret) from vault.decrypted_secrets
    where name = 'statutory_encryption_key';
   ```

   Expect `64`.

Until the key is set, every write and every reveal refuses with _"Statutory data can't
be stored yet: this environment's encryption key isn't set."_ Nothing is ever stored in
clear as a fallback.

> **Never change or delete the key once numbers are stored.** Every row was encrypted
> under it. Rotation means decrypting and re-encrypting every row in one transaction;
> that procedure is not built yet and is listed in the build spec's known gaps.

---

## Before any real number goes into production

D80 says this data does not reach production until all of these hold. Tick each one:

- [ ] The key is set in production (above), and its copy is in the password manager.
- [ ] `bun run harness` passes locally on the commit being deployed, including
      "verifying statutory and bank data".
- [ ] The migrations are applied to production by hand, in order, after Sada's go-ahead.
- [ ] The people who will hold the Statutory and Payroll roles are named, and granted by a
      Super Admin, not by default.
- [ ] The purge order in `TEST_DATA_PURGE.md` includes the restricted tables (it does,
      from version 1.3).
- [ ] The legal position on collecting Aadhaar (D59's original concern) is settled. The
      software is ready; whether to collect is not a software question.
