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

|                             | Sign-in codes (OTP)                   | Notifications                                              |
| --------------------------- | ------------------------------------- | ---------------------------------------------------------- |
| Sent by                     | **Supabase's built-in email service** | **Resend** (step 5)                                        |
| Configured in               | Supabase dashboard → Auth → Templates | `notification_templates`, API key in Edge Function secrets |
| Needs `neuvto.com` verified | no                                    | yes                                                        |
| Working today               | yes, on `neuvto.lovable.app`          | not yet built                                              |

Sign-in already works for any email address, today, without Resend. Resend is
only for the notifications the platform itself sends.

**Supabase's built-in sender is rate-limited to a handful of messages per hour
and is explicitly not intended for production.** It is fine for the demo and for
the first customer's pilot; before real volume, auth email moves to custom SMTP
on `neuvto.com` too. Check the current limit in the Supabase dashboard rather
than trusting a number written here.

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

### Where this stands

Signing in works by the intended route: a six-digit code arrives and the form
takes it. What remains is **fault 1** — it arrives from `auth.lovable.cloud`, so
the first email a customer ever gets from this product carries another company's
domain. That is a launch blocker, not a bug: custom SMTP on the table above.
