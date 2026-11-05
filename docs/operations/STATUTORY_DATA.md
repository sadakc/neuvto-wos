# Statutory and bank data: the encryption key, and going live

**Version:** 1.2 · **Status:** Active · **Applies to:** every environment's Vault, before any Aadhaar, PAN or bank account is entered there

D80. Neuvto stores Aadhaar, PAN, UAN, EPF and ESIC numbers, the bank account, and
religion, caste category and disability status. Every one of those values is
encrypted in the database with `pgcrypto` (AES-256) under one key per environment, held
in Supabase Vault. The design is in `product/NEUVTO_EMPLOYEE_MASTER.md`, under
"Restricted data"; this file is what an operator does.

**Cost: nothing.** Vault and `pgcrypto` are part of every Supabase plan, Free included.

---

## What protects what

| Layer                | What it does                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Encryption at rest   | The tables hold ciphertext and a last four. A database dump, a backup or a stray `select` shows no number.                |
| Keyed index          | Aadhaar and PAN are unique per company through an HMAC under the same key, so a number cannot be looked up by hash.       |
| No table access      | RLS on, no policy, no grant. Only the functions below reach these tables.                                                 |
| Role-shaped card     | `employee_card()` sends each role exactly what §5 of the Employee Master allows. The person never gets a full value.      |
| Reveal               | `employee_reveal_restricted()` needs the right role (no reason since D85) and writes `restricted_reads` before answering. |
| Audit without values | Writes to these tables are audited by which fields changed, never the value. Admins read `audit_logs`; it holds none.     |
| The browser          | A revealed value lives in one component's state, never a cache, URL or log, and is dropped after two minutes.             |

Who may reveal (D85, 12 Oct 2026): the Employee Admin, everything; the Statutory role,
every number and the restricted data; the Payroll role, the bank account. The person
themselves sees last four digits and reveals nothing. On screen it is an eye beside each
locked number, with no reason asked. Who has looked is shown to the person, a Super Admin
and the Statutory role.

All of this is proved by `neuvto-harness/tests/verify_statutory.sql` (now including the Employee Admin's eye; every
guard sabotaged) and the render tests in `src/modules/employee/components/`.

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

> **Never change or delete the key by hand once numbers are stored.** Every row was
> encrypted under it. Use the rotation below, which re-encrypts everything first.

---

## Rotating the key

`statutory_rotate_key()` re-encrypts every Aadhaar, PAN, UAN, EPF, ESIC, bank account and
restricted value, and recomputes every keyed index, under a new key, **in one transaction**.
If anything fails, nothing changes. It then makes the new key the one in use and keeps the
old one in Vault, renamed `statutory_encryption_key_retired_<when>`, because backups taken
before today are encrypted under it. Nobody signed in can run it; it writes one audit row per
company rather than one per person. Proved in `verify_statutory.sql`, section 6.

1. Generate a new key on your own machine: `openssl rand -hex 32`. Put it in the password
   manager first.
2. SQL Editor, as the project owner:

   ```sql
   select vault.create_secret('<the new 64 hex characters>', 'statutory_encryption_key_next');
   select public.statutory_rotate_key();
   ```

   It returns how many rows it re-encrypted and the retired key's new name.

3. Keep the retired key in the password manager until every backup older than today has
   expired (see `BACKUPS.md`), then delete it from Vault.

## Rotate when somebody who could read Vault leaves, or if the key may have been seen.

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
- [ ] The reveal log's three-year retention job is registered. This returns `true`:
      `select active from cron.job where jobname = 'neuvto-employee-reveal-retention'`
- [ ] The legal position on collecting Aadhaar (D59's original concern) is settled. The
      software is ready; whether to collect is not a software question.
