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
supabase secrets set RESEND_API_KEY=re_... --project-ref vkyvzhgigncranprhidn
```

If the key is ever pasted into a chat, a commit, or a support ticket, revoke it
in Resend and issue a new one. Revocation is instant and free; a leaked sending
key is used to send phishing mail from your domain, which destroys the domain's
reputation permanently.

---

## Open item

The hosted Supabase magic-link template still lacks `{{ .Token }}`, so the
6-digit code the UI asks for is never actually sent on `neuvto.lovable.app` —
only the magic link works. Fixed locally in `supabase/templates/`; the hosted
one is dashboard configuration and must be edited there. Tracked as a launch
blocker in
[../product/NEUVTO_MVP_BUILD_SPEC.md](../product/NEUVTO_MVP_BUILD_SPEC.md).
