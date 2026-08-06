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

> **Status: decided, NOT BUILT.** There is no MFA code anywhere in `src/` or `supabase/`. Everything below is the decision, in the present tense, describing a system that does not yet enrol anybody. `FIRST_CUSTOMER_RUNBOOK.md` is the only other place that admits this.

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
organization_settings.session_idle_minutes     default 30   (was 60 until 5 Aug 2026)
organization_settings.session_absolute_hours   default 24
```

Idle timeout ends a session after inactivity; absolute timeout ends it regardless of
activity. Both **must be enforced server-side to count as controls** — a client-side timer is
a suggestion, not a control.

That is the requirement, written in the imperative because it is not met. This line read
"Both are enforced server-side" until 6 Aug 2026, which was simply false: the only thing
ending a session is a timer in the browser. Read "Where this stands" below before repeating
any of this to a customer.

**The policy is not one number.** An `org_admin` can export every employee record and change
who approves what; an employee can see their own leave balance. Giving both the same session is
not consistency, it is declining to think about it twice — the same argument §2 makes about
MFA, applied to session length. `session_policy()` answers per caller:

| caller                               | idle                        | absolute    |
| ------------------------------------ | --------------------------- | ----------- |
| platform admin (no organisation row) | 30 min                      | 8 h         |
| `org_admin`, `hr_admin`, `manager`   | `session_idle_minutes` (30) | org setting |
| `employee`                           | `max(setting, 8 h)`         | org setting |

The employee floor is deliberate and is not a compromise. The app is mobile-first, installed as
a PWA, and sign-in is email OTP with no password, no biometric and no "remember this device" —
so a 30-minute idle limit means a guard who backgrounds the app over lunch must leave it, open
their email, find a code and type six digits, several times a day. On the app D1 describes as
"the HRMS your employees actually open", that is an adoption cost with no security gain: the
absolute cap still bounds them, and what they can reach is their own balance.

### Where this stands

> **Status: browser timer BUILT (5 Aug 2026). Server-side enforcement NOT BUILT.**

`src/platform/auth/idle.ts` polls every 15 seconds, shares activity across tabs through
`localStorage`, warns 60 seconds before expiry, and signs out with a reason on the sign-in
screen. The numbers come from `session_policy()`, never a constant.

**What that genuinely does.** It ends the session in that browser after inactivity. For this
product the threat is physical and ordinary — a shared shop-floor terminal, a supervisor's
tablet on a desk, a laptop open in a canteen — and against a walk-up attacker it works.

**What it does not do, at all.** It does not shorten any token's life. The refresh token sits
in `localStorage` with `autoRefreshToken: true`, so anybody who exfiltrates it — XSS, a disk
image, a stolen unlocked laptop — mints access tokens for as long as it lasts, timer or no
timer. It is defeated by closing the tab, disabling JavaScript, or replaying the stored token
with `curl`. It is a rule we ask the attacker to apply to themselves.

So the sentence above is right and stays. This is defence in depth with the server-side half
unbuilt, and describing it to a customer as "we enforce session timeouts" would be untrue.

**What would make it a control:** a short `jwt_expiry` (set on the hosted project, deliberately
not in `config.toml` — see the warning in that file), refresh-token rotation with reuse
detection, and server-side revocation.

| Piece                            | Status on `neuvto-wos-prod`                                         |
| -------------------------------- | ------------------------------------------------------------------- |
| `jwt_exp`                        | **1800s** (30 min), set 6 Aug 2026 — was 3600, the Supabase default |
| `refresh_token_rotation_enabled` | **on**, `security_refresh_token_reuse_interval` 10s                 |
| Server-side revocation           | **not built** — see below                                           |

This table replaces the line that used to sit here, which said "the first is done". It was not
done: `jwt_exp` was still 3600, the value the project ships with, and nobody had changed it.
A status line that claims a security control is in place when it is not is worse than no line
at all, because it is the thing somebody checks instead of checking the setting.

**What the 1800 actually buys**, stated narrowly so it is not oversold: an access token
exfiltrated from a browser is useless after at most 30 minutes instead of 60. It now matches
the idle window `session_policy()` gives an admin, so the two numbers no longer disagree.

**What it does not buy.** Supabase refresh tokens **never expire** — they are single-use and
they rotate, but they do not age out. The refresh token in `localStorage` remains the real
exposure and is untouched by any of this. Rotation with reuse detection is the mitigation
that matters there, and it is on: replaying a consumed refresh token is detectable rather
than free.

#### Why the server-side timeout is not simply switched on

Supabase has exactly the control this section says is missing —
`sessions_inactivity_timeout` and `sessions_timebox`, both currently `0`. They would enforce
server-side what `idle.ts` can only suggest.

**They are Pro Plan and up.** The Supabase docs are explicit ("This feature is only available
on Pro Plans and up"), and the Neuvto organisation is on the free plan. Nothing is paid for
before the MVP ships, so this stays unbuilt by decision rather than oversight.

Worth knowing before it looks like an easy win later: even on Pro, sessions are **not
proactively terminated** when the timeout is reached. The docs say they are "cleaned up
progressively 24 hours after reaching that status". It is a policy the server eventually
enforces, not a switch that kills a session at the thirty-minute mark.

### Revocation

> **Status: decided, NOT BUILT — and less alarming than it sounds.** This section used to say
> sessions "are revoked immediately". Nothing has ever revoked a session. What is true is
> below, and the distinction matters because the original wording overstated a hole that had
> already been closed a different way.

The intent is that a session ends when:

- A user is deactivated
- A user's role changes (they re-authenticate with the new role)
- An admin explicitly revokes them
- `erase_employee` runs

**What actually happens today: the token stays valid, and the data does not follow it.**
`20260805100000_access_follows_active.sql` makes a deactivated person's `current_org_id()`
null, so every tenant policy refuses them. Their JWT is deliberately left alone — deleting from
`auth.sessions` and `auth.refresh_tokens` would couple our migrations to GoTrue's internal
schema, a table we do not own and Supabase may change on any upgrade (D52). Refusing the data
is the boundary that matters; the token buys nothing.

So the remaining gap is narrower than "they keep access": a deactivated person holds a session
that can reach no tenant data. Real revocation would close the last of it, and the idle timeout
does **not** substitute for it — an idle timeout ends inactive sessions, and somebody actively
using a tab is not idle.

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
