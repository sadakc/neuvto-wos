# Publishing neuvto.com ourselves

**Version:** 2.0 · **Status:** Active · **Updated:** 20 Aug 2026

Written for somebody who is not a developer. Every step says where to click and
what to copy. If a step does not match what you see, stop and ask — a screen
that looks different usually means the tool changed its wording, not that you
are in the wrong place, but guessing at a security setting is how two of the
incidents in this document happened.

> **This replaced a Netlify runbook.** `neuvto.com` moved to Cloudflare Workers
> on 18 Aug 2026 and the Netlify sites were deleted on 19 Aug. Nothing in the
> old version applies any more, which is why this is a 2.0 rather than an edit.

---

## Why we build the site ourselves at all

Lovable builds the published website. When it does, it supplies its own database
address and overwrites whatever the repository says. That is not a setting
anyone chose — it is how the Lovable Cloud integration works.

The result, twice: `neuvto.com` was served to the world wired to the
**pre-production** database instead of the real one.

On 6 Aug 2026 that meant sign-in appeared to work and sent nothing. The screen
said _"Sent to anshvilla@gmail.com. It expires shortly."_ It was signing in to
the wrong database, one with no email configured. Nothing broke loudly. It just
quietly did not work.

**Changing `.env` cannot fix it.** The override happens after that file is read,
which is also why the file keeps reverting to the Cloud values on its own.

So we build the site ourselves, where we control which database it points at.
Lovable keeps doing what it is good at — editing and preview — against
pre-production, which is where a preview should point anyway.

---

## What this costs

**Nothing.** Cloudflare's free plan covers this, and no card is asked for. If
you are ever asked for payment details, stop — you are on the wrong plan or the
wrong page.

Worth knowing what "free" means here, because the previous host's free tier is
what forced this move: **Cloudflare meters no deploys at any tier.** Netlify
charged 15 credits per publish against 300 a month — twenty publishes, after
which the site served _Site not available_. There is no such clock now.

The limits that do exist are 100,000 requests a day and a 3 MB compressed
Worker. The site is around 0.7 MB. Neither is close, and both should be checked
before they are assumed.

---

## The one thing to get right

There are two kinds of value in this document and confusing them is the only
way to cause real harm.

|                    | **Publishable / URL**                                          | **Service role**                                                     |
| ------------------ | -------------------------------------------------------------- | -------------------------------------------------------------------- |
| Looks like         | `https://udrzhfgwqgolvyimbwto.supabase.co`, `sb_publishable_…` | `sb_secret_…`, or labelled `service_role`                            |
| Who may see it     | anybody — it is already inside the website's code              | nobody outside Supabase                                              |
| Safe to paste into | GitHub, chat, a document                                       | **nowhere in these steps**                                           |
| If it leaks        | nothing happens                                                | **every customer's data is readable and writable by whoever has it** |

**A service role key must never be given a name starting with `VITE_`.** Anything
named `VITE_…` is copied into the website's code and downloaded by every visitor.
That single rule prevents the worst outcome available here.

**And you do not need the service role key for any step below.** The old version
of this document told you to add it for the demo form. That is no longer true and
was made false deliberately — see [The demo-request form](#the-demo-request-form)
at the end. Adding it now would be a step backwards, and a lint rule blocks the
code change that would make it necessary.

---

## Step 1 — Copy two public values from Supabase

1. Go to <https://supabase.com/dashboard> and sign in.
2. Open the project named **`neuvto-wos-prod`**. Check the name carefully —
   `neuvto-wos-preprod` is the wrong one and is exactly the mix-up we are here
   to fix.
3. Left sidebar → **Project Settings** (the cog, bottom left).
4. Click **API Keys**.
5. Copy these two into a scratch note:
   - **Project URL** — it will read `https://udrzhfgwqgolvyimbwto.supabase.co`.
     If it says anything else, you are in the wrong project.
   - The **publishable** key — it begins `sb_publishable_`.

**Do not copy** anything labelled `service_role` or `secret`. It is not needed
for any step in this document.

---

## Step 2 — Create a Cloudflare account

1. Go to <https://dash.cloudflare.com/sign-up> and sign up. The free plan is the
   default; do not choose a paid one.
2. Once inside, you need the **Account ID**. It is on the right-hand side of the
   account home page, under **Account details** — a long string of letters and
   numbers. Copy it into your scratch note.

You do **not** need to add `neuvto.com` as a site here to get a deploy working.
That is Step 7, and doing it early is how a live domain gets broken before
anything has been proved.

---

## Step 3 — Create a Cloudflare API token

This is the one value in these steps that is genuinely secret. It lets a machine
publish the website; it does not touch the database.

1. Top right avatar → **My Profile** → **API Tokens**.
2. **Create Token** → scroll to the bottom → **Create Custom Token** →
   **Get started**.
3. Name it `github-actions-deploy`.
4. Add these permissions, exactly. Each row is a dropdown triple:

| Group       | Permission       | Level    |
| ----------- | ---------------- | -------- |
| **Account** | Workers Scripts  | **Edit** |
| **Account** | Account Settings | **Read** |
| **User**    | User Details     | **Read** |
| **Zone**    | Workers Routes   | **Edit** |

The Zone row is only needed once `neuvto.com` is served from the Worker
(Step 7). Adding it now saves creating a second token later.

Cloudflare also offers a ready-made token under **Create new token**, but its
preset grants **Workers KV Storage (edit)**, **Workers R2 Storage (edit)** and
**Memberships (read)** as well. None of those is used here. A token that can do
less is a token that can go wrong in fewer ways, so build the custom one.

5. **Continue to summary** → **Create Token**.
6. **Copy it now.** Cloudflare shows it exactly once.

---

## Step 4 — Put four values into GitHub

These are "secrets" in GitHub's wording, which is why publishable values live
there too — the box is simply where the build reads its settings from.

1. Go to <https://github.com/sadakc/neuvto-wos>.
2. **Settings** (the top bar of the repository, not your account settings).
3. Left sidebar → **Secrets and variables** → **Actions**.
4. **New repository secret**, four times. Name and value must be exact — a typo
   in a name produces a build that succeeds and points nowhere.

| Name                            | Value                                  |
| ------------------------------- | -------------------------------------- |
| `VITE_SUPABASE_URL`             | the Project URL from Step 1            |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | the `sb_publishable_…` key from Step 1 |
| `CLOUDFLARE_API_TOKEN`          | the token from Step 3                  |
| `CLOUDFLARE_ACCOUNT_ID`         | the Account ID from Step 2             |

Once saved, GitHub will never show these again. That is expected.

**These are GitHub secrets, not Worker secrets, and the difference matters.**
GitHub secrets tell the build machine who it is and what to build with. Worker
secrets would be values the running website reads. **The Worker has none, and
should keep having none** — see the end of this document.

---

## Step 5 — The deploy runs

This part is code, not clicking. `.github/workflows/deploy.yml` builds the site
with the values above, then — before publishing anything — runs
`scripts/verify-deploy.sh` against the result and **refuses to publish a build
that points at any database other than `udrzhfgwqgolvyimbwto`**.

That check exists because the failure it prevents has already happened twice and
both times looked like a successful deploy.

The order is deliberate and worth not rearranging:

```
build  →  verify the artefact  →  publish  →  verify the live site
```

A fifth step patches the Worker's configuration before publishing
(`scripts/cloudflare-worker-config.mjs`). It refuses a build whose compatibility
date is in the future — which sounds impossible and is not: the date comes from
the build machine's local clock and Cloudflare checks it against UTC, so every
build run between 00:00 and 05:30 India time was rejected until it was pinned.

---

## Step 6 — Check it before switching anything

The Worker also answers on `https://wos.neuvto.com`, which is deliberately kept
so there is always somewhere to test that is not the live domain.

1. Open it, go to **Sign in**, enter your email.
2. A six-digit code should arrive within a minute.

If it does, the new site is talking to the real database — nothing else can send
that email. If it does not, stop and say so; do not proceed to Step 7.

---

## Step 7 — Point neuvto.com at it, last

Only after Step 6 passes. **Read this whole section before doing any of it**,
because the middle of it is the only moment in this document where the live site
is down.

### The hostnames live in the repository, not the dashboard

Which domains the Worker answers on is a list in
`scripts/cloudflare-worker-config.mjs`:

```js
const CUSTOM_DOMAINS = ["neuvto.com", "wos.neuvto.com"];
```

Adding a hostname there and merging it is how a domain is connected. That is on
purpose: it is a reviewed change with a history, rather than a click nobody can
see afterwards.

**Do not add a domain through the Cloudflare dashboard instead.** Its **Add
Domain** field takes the _subdomain part_ and appends the zone itself, so typing
`neuvto.com` creates `neuvto.com.neuvto.com` — a live DNS record under a
nonsense hostname. That happened on 20 Aug 2026, while the real domain was down.

### There is an unavoidable gap, and you should plan for it

Cloudflare will not attach a domain to a hostname that already has a DNS record:

> `Hostname 'neuvto.com' already has externally managed DNS records (A, CNAME, etc). Delete them first.` `[code: 100117]`

That is by design — connecting a domain _creates_ the record and the certificate,
so it refuses to fight an existing one. There is no atomic swap and no override.
**The old record must be deleted before the new one can be made**, which means
the domain does not resolve for a minute or two in between.

So the order is:

1. Merge the hostname into `CUSTOM_DOMAINS`. Nothing changes yet.
2. Cloudflare → **DNS** → **Records** → delete the existing record for the
   hostname. **Do not touch `resend._domainkey`, `send`, or `_dmarc`** — those
   are what make email work, and breaking them is a worse day than this one.
3. Immediately trigger the deploy. Do not pause to check anything in between;
   checking is what the step after is for.
4. Verify: the site loads, the certificate is Cloudflare's, and `www` still
   redirects.

Have the site open on a phone using mobile data. A laptop that has already
looked up the old address will keep showing you a comforting lie for several
minutes.

### `www` is a redirect, not a second domain

A Worker attached to `neuvto.com` never sees `www.neuvto.com` — connected domains
match the hostname exactly. `www` is handled by a **Redirect Rule** under
**Rules → Redirect Rules**, and the `www` DNS record is a proxied `A` record
pointing at `192.0.2.0`, a reserved placeholder that nothing ever reaches.

That rule matches `https://` only, so **Always Use HTTPS** (SSL/TLS → Edge
Certificates) is load-bearing rather than cosmetic. Turning it off breaks plain
`http://www.neuvto.com`. The two settings are a pair. Both are recorded in
[ENVIRONMENTS.md](ENVIRONMENTS.md), because neither lives in the repository and
nothing else would tell you they exist.

---

## The demo-request form

**It needs nothing.** This section exists because the previous version of this
document told you to add a service role key for it, and somebody following that
advice today would be making the system less safe for no benefit.

The form used to be a server function that reached for the admin client — the
only caller of it in the whole codebase, and therefore the only reason a
service role key had to exist outside Supabase at all. A key that bypasses row
level security on every table, carried for a form that collects a name and an
email address from strangers.

It now posts to the `demo-request` **edge function**, which holds that key inside
Supabase and is the only thing that reaches the database. So:

- the Worker holds no secrets, and
- a lint rule (`no-restricted-imports`) blocks the import that would make one
  necessary again, with the reasoning attached.

If you ever see the error _"Missing Supabase environment variable(s):
SUPABASE_SERVICE_ROLE_KEY. Connect Supabase in Lovable Cloud"_ — **do not add
the key.** That message comes from generated code written for a different
architecture. Ask instead; the answer is almost always a `SECURITY DEFINER`
database function, which is how the whole `/neuvto-hq` console already does
privileged work without a service key.

---

## What to do when something looks wrong

Run this and read the last line:

```bash
bash scripts/verify-deploy.sh
```

It fetches the live site, follows every piece of code it loads, and tells you
which database that code talks to. It fails loudly if the answer is wrong, and
also if it cannot find an answer at all — because "found nothing" is what a
broken check looks like, and that mistake is why this file exists.

### Undoing a bad release

**Cloudflare dashboard → Workers & Pages → `sadakc-neuvto-wos` → Deployments.**
Previous versions are listed; rolling back is one click and touches no DNS.

That is the rollback for anything wrong with the site itself. There is no longer
a second host to switch to, and that is not the loss it sounds like: DNS is
answered by Cloudflare now, so any failure big enough to need a different host
would have taken DNS with it anyway.
