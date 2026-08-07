# Email and domains

Two different things get called "email domain" and confusing them wastes days.
They are unrelated, and only one of them constrains anybody.

|                   | **Sign-in address**                 | **Sending domain**                       |
| ----------------- | ----------------------------------- | ---------------------------------------- |
| Whose address     | the customer's employee             | Neuvto's own                             |
| Example           | `priya@gmail.com`, `raj@acme.co.in` | `notifications@neuvto.com`               |
| Restricted?       | **No. Any domain, always.**         | Yes — must be a domain we own and verify |
| Needs DNS records | no                                  | yes (DKIM, SPF, DMARC)                   |
| Set up by         | nobody — it just works              | Sada, once, at the registrar             |

---

## Employees can sign in with any email address

Gmail, Yahoo, Hotmail, Outlook, a company domain, anything. There is no
allowlist, there never was one, and nothing needs to be added to make it so.

The platform stores whatever address the user signs up with and emails a 6-digit
code to it (D8 — no passwords anywhere). A customer whose staff use personal
Gmail addresses works exactly as well as one on a corporate domain. This matters
commercially: small Indian firms frequently have no company email at all.

Down the line an organisation may optionally restrict its own sign-ups to its
own domain. That is a per-organisation setting to be built when someone asks for
it — **not** a platform-wide requirement, and not in the MVP.

---

## Neuvto sends from `neuvto.com`

Outgoing transactional email — "your leave request needs approval", "your
request was approved" — must come from a domain that Neuvto controls, because
verifying it means adding DNS records that only the domain owner can add.

This is why the answer to "can we add Gmail and Yahoo as verified domains" is
no, and it is not a policy choice: Google and Yahoo own those domains. Nobody
except Google can prove ownership of `gmail.com`. Sending mail claiming to be
from `@gmail.com` is precisely what SPF and DKIM exist to stop, and mail
providers will bin it.

**Registered domain: `neuvto.com`** (confirmed 30 Jul 2026, registered in
Sada's name).

**Default sender: `Neuvto <notifications@neuvto.com>`.**

Deliberately not `noreply@`. Customers reply to notification emails to ask
questions, and a reply that vanishes is a poor first impression. Until someone
monitors the mailbox, forward it to Sada.

---

## ⚠️ Sending and receiving are separate. `neuvto.com` only sends.

Checked on 2 Aug 2026 against both Google's and Cloudflare's resolvers:
**`neuvto.com` has no MX record at all.** Mail addressed to the domain is
rejected — there is nowhere for it to go.

Everything above still works. Resend needs DKIM, SPF and DMARC, all of which are
present and correct, and **MX has no bearing on outbound delivery**. What breaks
is everything inbound, and the product depends on inbound in two places it does
not look like it does:

| Address                    | Who writes to it                                            | Today   |
| -------------------------- | ----------------------------------------------------------- | ------- |
| `hello@neuvto.com`         | Anyone signing in with no workspace — `src/routes/auth.tsx` | bounces |
| `notifications@neuvto.com` | Any customer replying to a notification                     | bounces |

The first is the worse one. That screen is shown to a prospective customer, or to
an employee whose invitation went astray — people with **no other route to us** —
and it tells them, in as many words, to get in touch at an address that cannot
receive their message. We never learn they tried.

The second is the one this document already promised: `noreply@` was rejected on
purpose, precisely so replies would reach a person. Without MX they never did.

### The fix is DNS, and it is not in this repo

**Nothing here costs money.** GoDaddy runs the zone
(`ns65/ns66.domaincontrol.com`), but its own email forwarding is bundled with a
paid Email plan — rejected on 2 Aug 2026, because nothing is paid for before the
MVP ships. Records go into GoDaddy's DNS panel; the mailbox lives elsewhere.

| Option                      | Cost | Receives | Sends as `hello@` | Nameserver move |
| --------------------------- | ---- | -------- | ----------------- | --------------- |
| **Zoho Mail free tier**     | free | yes      | **yes**           | no              |
| ImprovMX / forwardemail.net | free | yes      | no                | no              |
| Cloudflare Email Routing    | free | yes      | no                | **yes**         |
| GoDaddy Email               | paid | yes      | yes               | no              |

Zoho is the one to take: a real mailbox, replies leaving from the domain rather
than a personal Gmail, and DNS stays where it is. Cloudflare's is excellent and
free but means moving nameservers off GoDaddy, which puts the Resend records at
risk for an address that has no mail in it yet.

**Use the records the provider's own wizard shows you.** Zoho runs regional data
centres with different hostnames — an Indian signup lands on `zoho.in`
(`mx.zoho.in`, `mx2.zoho.in`, `mx3.zoho.in`), not the `zoho.com` set that most
blog posts and most of this industry's documentation assume. Copying the wrong
region's MX produces a domain that verifies and never delivers.

**Do not touch `resend._domainkey`, `send`, or `_dmarc`.** They are what make
outbound work, and MX at the root does not collide with any of them.

**If you also want to send as `hello@`**, two more records and one interaction:

- **SPF at the root**, which does not exist today — add the provider's include at
  `@`. It does not disturb Resend, whose return-path is `send.neuvto.com` with
  its own SPF.
- **The provider's DKIM.** Required, not optional, because `_dmarc` is
  `p=quarantine`: mail from `hello@` passing neither SPF nor DKIM alignment is
  quarantined. Half-configured sending is worse than forwarding, because it
  silently lands in spam instead of visibly bouncing.

Pure forwarding needs neither — it changes nothing about who may send.

Verify from anywhere, no credentials and no account needed:

```bash
dig +short MX neuvto.com
```

---

## Two email systems, doing different jobs

|                             | Sign-in codes (OTP)                            | Notifications                                        |
| --------------------------- | ---------------------------------------------- | ---------------------------------------------------- |
| Sent by                     | **Resend, over SMTP**, driven by Supabase Auth | **Resend, over the HTTP API**, from an edge function |
| Credential                  | `smtp_pass` in the Supabase auth config        | `RESEND_API_KEY`, an edge function secret            |
| Configured in               | Supabase dashboard → Auth → Emails             | `notification_templates`, plus that secret           |
| Needs `neuvto.com` verified | yes                                            | yes                                                  |
| Working today               | yes, on `neuvto.com`                           | yes                                                  |

Both go through Resend, and that is exactly why they are easy to confuse — but
they are **two separate credentials**, and one can be valid while the other is
not. On 6 Aug 2026 both were broken at once, for unrelated reasons, and fixing
the first did nothing for the second. Rotating a Resend key means updating both;
see "When an email does not arrive — start here" at the end of this document.

The table above said something quite different until 6 Aug 2026 — that sign-in
used "Supabase's built-in email service" and that notifications were "not yet
built". Both stopped being true when custom SMTP went on (3 Aug) and when the
notification engine shipped. A stale row here is not harmless: it sends whoever
is debugging an outage to the wrong system.

**The built-in sender is no longer in the path.** It was rate-limited to two
emails an hour and could not set the sign-in template at all on a free project,
which is what forced custom SMTP. `rate_limit_email_sent` is now 100/hour —
check the dashboard rather than trusting a number written here.

---

## Setting up Resend — one time

1. Create the account at [resend.com](https://resend.com). The free tier is 100
   emails/day, 3,000/month — ample for the MVP.
2. Domains → Add Domain → `neuvto.com`.
3. Resend shows three or four DNS records (a DKIM `CNAME`, an SPF `TXT`, usually
   a DMARC `TXT`). Add them wherever `neuvto.com`'s DNS is managed.
4. Wait for verification — typically 5–30 minutes.
5. API Keys → Create API Key, scoped to **sending access on `neuvto.com` only**,
   not full account access.

### Where the key goes, and where it must never go

The key is stored as a **Supabase Edge Function secret**. It is never committed,
never placed in `.env`, and never exposed to the browser — anything prefixed
`VITE_` is compiled into the client bundle and is effectively public.

```bash
# production
supabase secrets set RESEND_API_KEY=re_... --project-ref udrzhfgwqgolvyimbwto
```

Pre-production (`vkyvzhgigncranprhidn`) is Lovable-owned and invisible to the
CLI — set its secret through Lovable → project → Cloud/Backend → secrets instead.
Each environment needs its own; a key set on one does nothing for the other.

If the key is ever pasted into a chat, a commit, or a support ticket, revoke it
in Resend and issue a new one. Revocation is instant and free; a leaked sending
key is used to send phishing mail from your domain, which destroys the domain's
reputation permanently.

---

## How a notification actually gets sent

Everything interesting happens in Postgres before anything is delivered:

1. A module calls `emit_platform_event('approval.submitted', {facts})`. It names
   an event, never a person (D26).
2. `resolve_notification_recipients()` decides who hears about it.
3. `notify()` picks the template — the organisation's own if it has one,
   otherwise the system default — renders it with values HTML-escaped (D27), and
   inserts a `pending` row in `notifications`.
4. The `notification-dispatch` edge function claims the batch, posts each one to
   Resend, and marks it `sent` or `failed` with a reason.

The dispatcher is deliberately dumb. It turns a row into an HTTP call and
records what happened; every decision was already made.

**A row is rendered when it is enqueued, not when it is sent.** So the subject
and body a customer received are a matter of record even if the template is
edited afterwards — which is exactly the question asked when somebody disputes
what they were told.

**Claiming uses `FOR UPDATE SKIP LOCKED`**, so two dispatchers running at once
never send the same email twice. Verified: a second dispatch immediately after
the first claims nothing.

### Running it

```bash
# production — or just run scripts/prod-cutover.sh, which does this
supabase functions deploy notification-dispatch --project-ref udrzhfgwqgolvyimbwto
```

It requires `Authorization: Bearer <service role key>` — without that the queue
is drainable by anyone who finds the URL. Schedule it with `pg_cron` or an
external scheduler; it is safe to call as often as you like.

If `RESEND_API_KEY` is unset it returns **503 rather than doing nothing**. A
silent no-op looks exactly like an empty queue, which is the hardest possible
failure to notice.

### Verifying without sending real mail

`neuvto-harness/tools/resend-stub.ts` answers `/emails` the way Resend does and
keeps what it was sent, so the whole loop can be driven locally and asserted on:

```bash
bun neuvto-harness/tools/resend-stub.ts &
supabase functions serve notification-dispatch --env-file <(echo "
RESEND_API_BASE=http://host.docker.internal:8787
RESEND_API_KEY=re_stub_key_for_local_verification")
curl -s http://127.0.0.1:8787/__captured    # exactly what would have gone out
```

Asserting only that the row flipped to `sent` would pass just as happily while
mailing gibberish, which is why the stub captures the payload.

**What this does not prove** is that Resend accepts the message — that needs the
live key and a verified domain. Run one real send before the first customer.

## ⚠️ Sign-in email is not yet fit to show anyone

Confirmed on the live site, 31 Jul 2026, by signing up as a real person. Three
faults, all configuration on the Lovable Cloud project, none fixable from this
repository.

**Status, end of 31 Jul 2026:** faults 2 and 3 are fixed. Fault 1 — the sender —
is still open, and it is the one a customer sees first.

A fourth turned up while fixing the others, and it is the more useful lesson:
after `{{ .Token }}` was added to both templates the code arrived as **eight
digits**, against a form that accepts six. `supabase/config.toml` says
`otp_length = 6` and is read only by `supabase start` — the hosted project keeps
its own value, and nothing reconciles the two. Set in the backend's auth
settings, it began issuing six.

The general shape, worth remembering because it will recur: **anything in
`config.toml` configures local development and nothing else.** Auth settings,
OTP length and expiry, email templates and SMTP all live in the hosted project's
own configuration. A local file agreeing with the code proves nothing about
production.

### 1 · It comes from Lovable, not from Neuvto

> **Neuvto-WOS** `<no-reply@auth.lovable.cloud>`

That is the first email a customer ever receives from this product, and it
carries another company's domain. Documented here previously as "sign-in already
works" — which was true and beside the point. Working and presentable are
different tests, and only the second one matters to somebody deciding whether to
trust a payroll-adjacent system with their staff data.

**Fix:** custom SMTP on the Lovable Cloud project, pointed at Resend.
`neuvto.com` is already verified for sending, so this is configuration rather
than new infrastructure.

| Setting      | Value                      |
| ------------ | -------------------------- |
| Host         | `smtp.resend.com`          |
| Port         | `465`                      |
| Username     | `resend`                   |
| Password     | the Resend API key         |
| Sender email | `notifications@neuvto.com` |
| Sender name  | `Neuvto`                   |

### 2 · It sends a link, not the six-digit code the screen asks for — **fixed**

The interface asks for a code. The email contains a **Verify Email** button.
Somebody who follows the screen has nothing to type.

Supabase's stock templates carry only `{{ .ConfirmationURL }}`. The code lives in
`{{ .Token }}`, which has to be added by hand. Fixed locally in
`supabase/templates/`; the hosted templates are dashboard settings and this
repository cannot reach them.

**Both templates need it**, which is the part that was missed:

- **Magic Link** — sent to somebody who already exists
- **Confirm signup** — sent to somebody new

### 3 · A new signup gets the wrong template entirely — **fixed**

`signInWithOtp()` against an address that has never been seen creates the user
and sends **Confirm signup**, not Magic Link. So the first person ever to use the
product gets the one template nobody thought to check.

Either add `{{ .Token }}` to both, or turn off email confirmation so the OTP
template is always the one used. Adding it to both is the smaller change and
keeps confirmation available.

### Where this stands — re-checked against the live config, 3 Aug 2026

Everything above describes the **Lovable Cloud** project, and it is still true of
that one. It is no longer the whole picture, because there are now two backends
and they are in different states. Both were read from the Management API rather
than assumed.

**There are two projects, and the app you can reach is not the one this repo
points at.**

|                                   | `neuvto-wos-prod`                                              | the Lovable Cloud project                                |
| --------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------- |
| ref                               | `udrzhfgwqgolvyimbwto`                                         | `vkyvzhgigncranprhidn`                                   |
| who owns it                       | Sada's own Supabase org                                        | Lovable; a Supabase token for our org gets **403** on it |
| what the repo says                | `.env`, and the CLI link, name this one                        | named nowhere in this repository                         |
| what `neuvto.com` actually serves | **not this** — the deployed bundle contains no reference to it | **this one**, in the JS bundle served today              |
| business data                     | all migrations, **zero rows** in every table                   | whatever is live                                         |

PR #32 ("the published app talks to the database we own") changed `.env`, and its
premise — "`.env` is the only thing that decides which database the app reaches"
— did not hold for the **published** artifact: Lovable built the site and supplied
its own backend variables, so the bundle at `neuvto.com` resolved to
`vkyvzhgigncranprhidn` while the repoint sat merged and inert. It happened on
3 Aug and again on 6 Aug 2026.

**Resolved 7 Aug 2026.** The site is now built by GitHub Actions with variables
we supply and served by Netlify; Lovable no longer publishes production. Verified
by a real sign-in code sent from `neuvto.com` through the production project, and
guarded on every deploy by `scripts/verify-deploy.sh`. See
[PRODUCTION_HOSTING.md](PRODUCTION_HOSTING.md).

**Fixed on `neuvto-wos-prod` today**, all three verified by reading the config
back:

| Setting             | Was                     | Now                                                                          |
| ------------------- | ----------------------- | ---------------------------------------------------------------------------- |
| `mailer_otp_length` | **8**                   | 6                                                                            |
| `site_url`          | `http://localhost:3000` | `https://neuvto.com`                                                         |
| `uri_allow_list`    | _(empty)_               | `https://neuvto.com`, `https://neuvto-wos.netlify.app`, and `/**` under each |

The OTP length was the one nobody had written down. The form validates
`/^\d{6}$/` and the input caps at six characters, so an eight-digit code could
not have been entered even once the template started sending one — the sign-in
screen would have been uncompletable for a second, independent reason.

**Still broken there, and it is not a dashboard setting.** The magic-link
template on `neuvto-wos-prod` carries no `{{ .Token }}`, and it cannot be given
one. The Management API refuses:

```
Email template modification is not available for free tier projects
using the default email provider.
```

So the note that has been carried in the handover for days — "dashboard-only,
Sada's action" — is wrong about the mechanism. There is no toggle to find. The
template is locked until one of two things happens:

1. **Custom SMTP on Resend** — the free path, and the one to take. It also closes
   **fault 1** in the same move, because the sign-in email then comes from
   `neuvto.com` instead of `auth.lovable.cloud`. The domain is already verified
   and the API key already exists for notifications.
2. Upgrading the plan — ruled out by the standing constraint that nothing is paid
   for until the MVP ships.

**This one is Sada's, and genuinely so:** switching on custom SMTP means entering
the Resend API key as the SMTP password in the Supabase dashboard. That is a
credential going into a form, which is not something to hand to an assistant or
paste into a chat. Once SMTP is set, the template push stops returning 400 and
can be applied from this repository — `supabase/templates/magic_link.html` is
already correct and already carries `{{ .Token }}`.

---

## Turning on custom SMTP

**Nothing here costs anything.** Checked against both providers' own pages on
3 Aug 2026, because "free tier" is a claim that ages:

|                      | Free?                 | What you get                                                           |
| -------------------- | --------------------- | ---------------------------------------------------------------------- |
| Supabase custom SMTP | yes, on the Free plan | it is the alternative the API's own error offers, instead of upgrading |
| Resend SMTP relay    | yes, on the Free plan | "All plans include: RESTful API, **SMTP relay**, official SDKs"        |
| Resend Free volume   | —                     | **3,000/month, 100/day, 1 domain**                                     |

The 100/day is the number to watch, and it is **shared**: sign-in codes and
notification emails both leave through Resend on the same key. A pilot workspace
of forty people invited on a Monday spends forty of them before anyone has
requested leave.

### 1 · A key for this, separate from the notifications one

`RESEND_API_KEY` already exists as an Edge Function secret on
`neuvto-wos-prod` (set 2 Aug 2026) and the notification dispatcher uses it. Make
a **second** key for auth email rather than reusing that one — Resend → API Keys
→ Create, sending access on `neuvto.com` only, named for the purpose.

The reason is revocation. One key doing two jobs cannot be rolled without
stopping both, so the day the auth key needs replacing is the day notifications
stop as well.

### 2 · The SMTP settings

Dashboard → Authentication → **Emails** → SMTP Settings → Enable custom SMTP:

| Field        | Value                                             |
| ------------ | ------------------------------------------------- |
| Host         | `smtp.resend.com`                                 |
| Port         | `465`                                             |
| Username     | `resend` — the literal word, not an email address |
| Password     | the API key from step 1 (`re_…`)                  |
| Sender email | `notifications@neuvto.com`                        |
| Sender name  | `Neuvto`                                          |

Port 465 is implicit TLS. Resend also accepts 25, 587, 2465 and 2587; 587 is
STARTTLS and is the one to try if a network blocks 465.

The sender **must** be on a domain verified in Resend. `neuvto.com` is verified —
DKIM, SPF and DMARC are all present and correct — so this address works today.
Note that replies to it still bounce, because the domain has no MX record; that
is the separate gap above, and it does not block sign-in.

### 3 · Everything else, in one command

```bash
bash scripts/apply-auth-email-config.sh
```

It pushes **both** sign-in templates, sets their subjects, raises the hourly
limit, and then reads all of it back rather than trusting the `200`. It refuses
to run at all until SMTP is set, so it cannot leave you with half of it applied.

**Both, because the second one is the one that actually fires.** `signInWithOtp()`
against an address GoTrue has never seen creates the user and sends **Confirm
signup**, not Magic Link — fault 3 above, which this document has recorded since
31 July. On a project with no profiles in it yet, that is _every_ person, not an
edge case.

The first version of this script pushed only Magic Link. It printed
`ok template carries {{ .Token }}` and a first-time signup still received a bare
link, because the template it checked was not the template being sent. A
verification that reads back the wrong field is worse than none: it converts an
open question into a settled one. Both are now pushed, and both are checked
separately.

> **Open, and a decision rather than a defect:** `mailer_autoconfirm` is `false`
> on `neuvto-wos-prod`, so the Confirm-signup path stays live. `config.toml`
> declares `enable_confirmations = false`, which is why the local stack only ever
> uses Magic Link — the two environments take different routes to the same
> screen. Both templates now carry the code, so either route works and nothing is
> broken. Aligning them is worth doing deliberately, not as a side effect of an
> email fix.

**The rate limit is the trap.** Supabase's built-in sender caps auth email at
**2 per hour** and does not let you change it — which is what
`neuvto-wos-prod` sits at today. Custom SMTP raises the default to 30, still low
for onboarding a company; the script sets 100. Miss this and sign-in works
perfectly for two people and then stops, with no error that names the cause.

### 4 · Prove it, do not assume it

Request a code on the sign-in screen and read the email. Three things have to be
true at once, and only the last is visible from the config:

- it arrives **from `neuvto.com`**, not `auth.lovable.cloud`
- it contains a **six-digit code**, not only a link
- the code is **accepted** by the form

Test with an address **that has never signed in before**, and then with one that
has. They take different routes — Confirm signup and Magic Link — and for months
only one of them was ever checked.

Since 7 Aug 2026 this proves both: `neuvto.com` is built by GitHub Actions
against `neuvto-wos-prod` and a real sign-in code has been delivered end to end.
Before that date the same test proved only that the project was configured
correctly, because the published bundle was wired to a different database.

### Applied to `neuvto-wos-prod`, 3 Aug 2026

SMTP on, and the script run against it. Read back from the API afterwards rather
than taken from the script's own output:

|                                         |                                                         |
| --------------------------------------- | ------------------------------------------------------- |
| `smtp_host` / `smtp_port` / `smtp_user` | `smtp.resend.com` / `465` / `resend`                    |
| sender                                  | `Neuvto <notifications@neuvto.com>`                     |
| `mailer_subjects_magic_link`            | `Your Neuvto sign-in code`                              |
| `mailer_subjects_confirmation`          | `Your Neuvto sign-in code`                              |
| Magic Link template                     | carries `{{ .Token }}` **and** `{{ .ConfirmationURL }}` |
| Confirm signup template                 | carries `{{ .Token }}` **and** `{{ .ConfirmationURL }}` |
| `rate_limit_email_sent`                 | 100/hour                                                |
| `mailer_otp_length` / `mailer_otp_exp`  | 6 / 3600s                                               |

What this does **not** prove: that the SMTP password is right. Nothing readable
from the config can — a wrong key produces a configuration that looks exactly
like this one and an inbox that stays empty. Only a real send settles it.

---

## When an email does not arrive — start here

Both failures below happened on **6 Aug 2026**, within an hour of each other,
and they looked identical from a user's seat: an email that never came. They
had nothing to do with each other, and neither one's fix touches the other.

**Establish which system is involved before doing anything else.** The two are
described in "Two email systems, doing different jobs" above, and they share
no code, no credential and no failure mode:

| Symptom                                                 | System               | Go to |
| ------------------------------------------------------- | -------------------- | ----- |
| "Email me a code" fails, or the code never arrives      | Supabase Auth → SMTP | **A** |
| An invitation, approval or decision email never arrives | Notification engine  | **B** |

---

### A · Sign-in codes — read the auth log first, not the inbox

The screen says only _"Something went wrong on our end"_, because `toAppError`
deliberately refuses to pass a raw provider error through to a user. The real
message is one call away:

```bash
supabase logs auth --project-ref udrzhfgwqgolvyimbwto
```

Or reproduce it directly, which is faster and needs no dashboard. The URL and
publishable key are public — they ship in the client bundle:

```bash
curl -sS -w "\nHTTP %{http_code}\n" -X POST "https://udrzhfgwqgolvyimbwto.supabase.co/auth/v1/otp" -H "apikey: <publishable key>" -H "Content-Type: application/json" -d '{"email":"you@example.com","create_user":true}'
```

`{}` and HTTP 200 means it sent. Anything else names the fault.

| What the log says                          | What it means                                 |
| ------------------------------------------ | --------------------------------------------- |
| `535 "Authentication credentials invalid"` | The SMTP password is not a valid Resend key   |
| `Error sending magic link email` + 500     | Same thing, seen from the client side         |
| HTTP 429                                   | Rate limit — `RATE_LIMITED`, not a broken key |

**The 535 is the one that happened.** The Resend API key held as Supabase's
`smtp_pass` stopped being valid; why was never established. Sign-in was dead
for **every address, at every entry point, for roughly 13 hours** before anyone
noticed.

Fixing it is three steps, and **step 3 is the one that gets forgotten**:

1. Resend → API Keys → create a key with sending access on `neuvto.com`. Copy
   it on the creation screen; Resend shows it once.
2. Supabase → Authentication → Emails → SMTP Settings → Password.
3. Supabase → Edge Functions → Secrets → `RESEND_API_KEY`, the **same key**.
   This is a separate credential for a separate system. Doing 1 and 2 alone
   restores sign-in and leaves every notification broken.

#### Do not diagnose this from `smtp_pass`

The Management API returns it as a 64-character digest, not the stored value.
It will never begin with `re_`, and that says nothing about whether the key is
right. **The only evidence is a send.**

---

### B · Notifications — the database already knows why

Ask the notification row, not the mail provider. It records the reason at the
moment it fails:

```sql
select event_key, status, attempts, failed_reason, last_error, created_at
from public.notifications order by created_at desc limit 20;
```

`attempts: 0` is the single most useful thing on that row. **Zero attempts
means it never reached Resend at all**, so no amount of key rotation will help.

| `failed_reason`          | Meaning                                 | Fix                                            |
| ------------------------ | --------------------------------------- | ---------------------------------------------- |
| `NO_TEMPLATE`            | No active template for that event       | See below                                      |
| anything, `attempts` > 0 | It reached Resend and Resend refused it | Read `last_error`; check the key (A·3)         |
| status `pending`, old    | The dispatcher is not running           | Check the `neuvto-dispatch-notifications` cron |

#### `NO_TEMPLATE`

`notification_templates` was **empty in production** on 6 Aug 2026. All four
system defaults were gone, so _every_ notification the product sends was dead —
`approval.submitted`, `approval.decided`, `approval.completed`, `member.invited`.
Found by a real customer's first invitation not arriving. What emptied it was
never established.

`notify_address` treats a missing template as a **recorded failure, never a
raise** (D28) — the invitation must not roll back because an email could not be
rendered. That is correct, and it is also why this is silent: the invitation
looks fine, the row says failed, and nothing shouts.

Repair is idempotent and safe to run anywhere:

```sql
select public.ensure_system_notification_templates();
```

Then **re-send through the UI** — revoke the invitation and issue it again. Do
not retry the failed row: it stored `(no template)` as its subject and body, so
retrying it emails exactly that.

To check without fixing:

```sql
select public.missing_system_notification_templates();
```

An empty array is healthy. `prod-cutover.sh` runs this after every push and
refuses to finish if anything is missing; `verify_invariants.sql` asserts the
same thing from the harness. Neither existed when this broke.

---

### C · A scheduled report that did not arrive

Scheduled reports go through the same queue as everything else, so section B
above applies unchanged — look at `notifications` first. What is different is
that a schedule can fail **before** it ever produces a row, which section B
cannot see because there is nothing to see.

Work down this list; each step rules out one silence.

```sql
-- 1. Is the job installed and running at all?
select jobname, schedule, active from cron.job
 where jobname = 'neuvto-leave-report-schedules';
select status, return_message, start_time from cron.job_run_details
 where jobid = (select jobid from cron.job where jobname = 'neuvto-leave-report-schedules')
 order by start_time desc limit 5;

-- 2. What does the workspace think it asked for, and when did it last go out?
--    last_run_on is the ORGANISATION's date, not the server's.
select organization_id, report_key, cadence, day_of_week, day_of_month,
       recipients, is_active, last_run_on
  from public.report_schedules where deleted_at is null;

-- 3. Does the database agree today is the day? Ask about any date, not just today.
select public.report_schedule_fires_on('monthly', null, 31, date '2026-02-28');  -- t
```

| What you find                              | What it means                                                                                                                                                          |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No `cron.job` row                          | The migration has not been applied to this environment. Code deploys and schema does not — see [DEPLOYMENT.md](DEPLOYMENT.md)                                          |
| `last_run_on` is today, no notification    | It ran and the module was **switched off** for that workspace (D44). It is deliberately not marked as run, so switching Leave back on resumes at the next occurrence   |
| `last_run_on` is a day off what you expect | Not a bug. The day is judged in the **organisation's own timezone**, so an Indian workspace's Monday starts 5½ hours before the server's                               |
| A monthly schedule set to 31               | Fires on the **last day of whatever month it is** — 28 February, 30 April. `= day_of_month` would skip five months a year in silence, which is why the clamp is tested |
| `failed_reason: NO_TEMPLATE`               | `leave_summary.weekly` / `leave_summary.monthly` are seeded by `20260820110000`. Same repair as above                                                                  |

**The runner is system-context only.** `report_schedules_due`,
`report_schedule_mark_run` and `leave_report_schedule_run` cross every
organisation, because cron has no organisation of its own. All three refuse a
caller with an `auth.uid()` **and** are revoked from `authenticated` — two locks,
because a grant is one careless migration away from returning.
`verify_invariants.sql` asserts both, and fails loudly if any of them is renamed
rather than passing by absence.

---

### What made both of these invisible

Worth stating plainly, because it is the same lesson twice.

**Sign-in errors reached no monitor — fixed 6 Aug 2026.** `record_client_error`
is granted to `authenticated` only, and somebody requesting a sign-in code is
anonymous, so the 535 produced no `client_errors` row for 13 hours. It was a
known limitation, written down in
`20260812100000_errors_in_production_are_visible.sql` when the store was built.

Closed by `20260815100000` and the `client-error` edge function, which accepts
unauthenticated POSTs and calls `record_public_client_error` with the service
key. `anon` still executes nothing — the posture from the 2 Aug open relay is
unchanged.

Two things about it are worth knowing when reading the console:

- Anonymous reports carry **no `organization_id`** and are marked
  `source = 'public'`. There is no session to derive an organisation from, and
  letting a caller name one would let it pin errors on somebody else's customer.
- They spend a **separate daily ceiling** — 100 distinct fingerprints, against
  the signed-in channel's 500. That split is not tidiness. The ceiling is silent
  by design, so a shared counter would let anyone post junk until the budget was
  gone and then watch real customer errors disappear, with nothing announcing
  it. `verify_error_reporting.sql` asserts the two cannot starve each other.

**Notification failures reach a monitor nobody was looking at.**
`platform_mail_health()` would have reported `NO_TEMPLATE` as its last failure
reason and returned `healthy: false` — but only once something tried to send,
and only to somebody who opened the console. On a workspace with no members
yet, nothing tried until a customer was waiting.
