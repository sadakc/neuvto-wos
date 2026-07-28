# NEUVTO WOS — Security Policy

**Version:** 1.0 · **Status:** Active

Covers **D20–D22**, plus the encryption and compliance positions. Security decisions that
are cheap now and awkward later — session policy shapes the auth build, and an attachment
bucket built carelessly is a health-data breach.

---

## 1 · Authentication

**Email OTP** as the primary flow (D8). No passwords: nothing to phish, forget, reuse, or
leak in a dump. **Google OAuth** retained for admins, behind our own wrapper in
`src/platform/auth/`.

Phone OTP is deferred — it needs an SMS provider and Indian DLT template registration. The
wrapper is shaped so adding it is one method.

---

## 2 · Multi-factor (D21)

**TOTP required for `org_admin` and `hr_admin`.** Optional for `manager` and `employee`.

The asymmetry is deliberate: an admin can export every employee record in the organisation
and change who approves what. An employee can see their own leave balance. Forcing an
authenticator app on a security guard checking their holiday allowance buys nothing and
costs adoption; not forcing it on the person who can export the whole workforce is
negligent.

Supabase supports TOTP enrolment natively. Enrolment is required at first sign-in for those
roles, and a role promotion to admin triggers enrolment before the role takes effect.

---

## 3 · Sessions (D20)

Configurable per organisation, because a security firm and a software company have
different tolerances:

```
organization_settings.session_idle_minutes     default 60
organization_settings.session_absolute_hours   default 24
```

Idle timeout ends a session after inactivity; absolute timeout ends it regardless of
activity. Both are enforced server-side — a client-side timer is a suggestion, not a control.

### Revocation

Sessions are revoked immediately when:

- A user is deactivated
- A user's role changes (they re-authenticate with the new role)
- An admin explicitly revokes them
- `erase_employee` runs

**Deactivation without revocation is the gap that matters.** D14 guards deactivating a
manager — reassigning their reports and open approvals — but if their existing session
keeps working, they simply keep the tab open and retain access to team leave data after
leaving the company. Revocation is what makes D14 real.

---

## 4 · Authorisation

RBAC through `user_roles`, enforced by RLS in the database (D4). Two independent layers:

1. **Database** — RLS policies are the enforcement. Correct even if the application is wrong.
2. **Application** — handler-level permission checks. Defence in depth and better error
   messages, never a substitute.

Roles never live on `profiles`. A role column on a user-editable table is privilege
escalation waiting to happen.

Cross-tenant access returns **403, never 404** (API standards §5).

---

## 5 · Encryption and secrets

**At rest** — Supabase default AES-256. **In transit** — TLS everywhere, no exceptions.

**Attachments, when they arrive.** Sick notes are health data: special category under GDPR,
sensitive personal data under DPDP. The rules are recorded now so the deferred feature
cannot be built carelessly later:

- Private Supabase Storage bucket. Never public.
- Access only through **short-lived signed URLs**, never a guessable or permanent path
- Storage RLS scoped by `organization_id`, same as every table
- Path contains no personal data — a UUID, not `acme/ravi-sick-note.pdf`
- Deleted with the request they belong to, on the same retention schedule

**Secrets** — environment variables only. Never in source, never in logs, never in an error
message returned to a client. CI greps for committed keys on every push.

---

## 6 · Audit

`audit_logs` is insert-only: RLS grants `INSERT` and nothing else, to every role including
`org_admin`. There is no legitimate reason to edit an audit trail, and the harness asserts
that even an admin cannot.

Written by trigger on every state change, never by application code — the same reasoning as
audit fields. Logged: actor, action, entity, before and after, timestamp, IP, user agent.

Retained 7 years. Never soft-deleted.

---

## 7 · Backup and recovery (D22)

|                                   | Target                                    |
| --------------------------------- | ----------------------------------------- |
| **RPO** — maximum data loss       | ≤ 5 minutes (PITR, requires Supabase Pro) |
| **RTO** — maximum time to restore | 4 hours                                   |
| Backup frequency                  | Continuous (PITR) plus daily snapshot     |
| Retention                         | 30 days                                   |

### The restore drill — quarterly, non-negotiable

1. Restore the most recent backup to a scratch Supabase project
2. Run the full harness against the restored copy
3. Verify row counts against production for the largest tables
4. Record the wall-clock time taken and compare against the 4-hour RTO
5. Delete the scratch project

**An untested backup is not a backup.** This is the step every small company skips, and the
one that decides whether a bad day is an incident or the end of the business. The harness
makes it cheap: a restore that passes tenant isolation and balance reconciliation is
provably usable, not merely present.

PITR requires Pro. Until then the free plan gives daily backups only — RPO is effectively
24 hours, which is acceptable while there is no customer data and unacceptable the moment
there is. This is one of the reasons cutover happens before the first paying customer.

---

## 8 · Compliance

**India DPDP Act 2023** applies — customers and employee data are Indian. **GDPR** applies
if any customer has EU staff, and `03_PLATFORM_ARCHITECTURE.md` §Compliance already claims
compliance.

Obligations, none currently owned:

| Obligation                                              | Status                                                          | Needed by                                    |
| ------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------- |
| Privacy policy and terms                                | Not written                                                     | First customer                               |
| Data Processing Agreement                               | Not written                                                     | First customer — B2B buyers ask at signature |
| Processor inventory (Supabase, Resend, Lovable, Sentry) | Not written                                                     | First customer                               |
| Right to erasure                                        | **Procedure defined** — `erase_employee`, see Data Standards §4 | Built in MVP                                 |
| Data export / portability                               | Not built                                                       | First customer                               |
| Breach notification process                             | Not written                                                     | Before production                            |
| Data residency                                          | **Satisfied** — `ap-south-1`, Mumbai                            | Done                                         |

The first three and the breach process are legal work, not engineering. They are recorded
here so they are visible, not because this document solves them.

---

## 9 · Incident response

Until an engineering escalation path exists (recorded risk in the agent plan), the process is:

1. **Contain** — if customer data is exposed across organisations, take the app offline.
   Downtime is recoverable; a leak is not.
2. **Preserve** — do not delete or edit anything, including logs. `audit_logs` is immutable
   by design precisely for this moment.
3. **Diagnose** — `db-guardian` produces the escalation report, written for a contractor
   with no project context.
4. **Notify** — DPDP requires notifying the Data Protection Board and affected users. Timing
   is a legal question; get advice rather than guessing.
5. **Fix, verify, record** — harness must pass before returning to service.

Step 1 is the one that requires nerve. Taking your own product offline feels drastic; it is
almost always the right call when tenant isolation is in question.
