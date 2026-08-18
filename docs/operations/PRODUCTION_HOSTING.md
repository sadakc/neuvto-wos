# Publishing neuvto.com ourselves

**Version:** 1.2 · **Status:** Historical · **Updated:** 18 Aug 2026

> **`neuvto.com` is served by Cloudflare Workers as of 18 Aug 2026, 13:58 UTC.**
> Netlify no longer serves the site. This document describes the Netlify setup
> it replaced.
>
> It is kept, rather than deleted, for two reasons: the Netlify site is still
> deployed and is the rollback until this has held for a week, and `www` still
> CNAMEs to it. Steps 1 and 5 (the Supabase keys, and what is safe to paste
> where) are hosting-agnostic and still correct.
>
> For how the site is published today, see [ENVIRONMENTS.md](ENVIRONMENTS.md)
> and `scripts/cloudflare-worker-config.mjs`. **This file needs rewriting for
> Cloudflare** — a walkthrough for a non-developer, which is what made this one
> worth having, and which nothing currently replaces.

Written for somebody who is not a developer. Every step says where to click and
what to copy. If a step does not match what you see, stop and ask — a screen
that looks different usually means the tool changed its wording, not that you
are in the wrong place, but guessing at a security setting is how the thing
below happened twice.

---

## Why we are doing this at all

Lovable builds the published website. When it does, it supplies its own database
address and overwrites whatever the repository says. That is not a setting
anyone chose — it is how the Lovable Cloud integration works.

The result, twice: `neuvto.com` was served to the world wired to the
**pre-production** database instead of the real one.

On 6 Aug 2026 that meant sign-in appeared to work and sent nothing. The screen
said _"Sent to anshvilla@gmail.com. It expires shortly."_ It was signing in to
the wrong database, one with no email configured. Nothing was broken loudly.
It just quietly did not work.

**Changing `.env` cannot fix it.** The override happens after that file is read,
which is also why the file keeps reverting to the Cloud values on its own.

So we build the site ourselves, where we control which database it points at.
Lovable keeps doing what it is good at — editing and preview — against
pre-production, which is where a preview should point anyway.

---

## What this costs

**Nothing.** Netlify's free tier covers this comfortably, and no card is asked
for. If you are ever asked for payment details, stop — you are on the wrong
plan or the wrong page.

---

## The one thing to get right

There are two kinds of value in this document and confusing them is the only
way to cause real harm.

|                    | **Publishable / URL**                                          | **Service role**                                                     |
| ------------------ | -------------------------------------------------------------- | -------------------------------------------------------------------- |
| Looks like         | `https://udrzhfgwqgolvyimbwto.supabase.co`, `sb_publishable_…` | `sb_secret_…`, or labelled `service_role`                            |
| Who may see it     | anybody — it is already inside the website's code              | nobody outside the server                                            |
| Safe to paste into | GitHub, Netlify, chat, a document                              | Netlify's environment settings, once                                 |
| If it leaks        | nothing happens                                                | **every customer's data is readable and writable by whoever has it** |

**A service role key must never be given a name starting with `VITE_`.** Anything
named `VITE_…` is copied into the website's code and downloaded by every visitor.
That single rule prevents the worst outcome available here.

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
for these steps.

---

## Step 2 — Create a Netlify account and an empty site

1. Go to <https://www.netlify.com> → **Sign up** → **Sign up with GitHub**.
   Using GitHub means one less password, and it does not give Netlify any
   access to the code by itself.
2. Once inside, create a site. Netlify pushes you towards "import from Git" —
   **do not choose that.** Their build environment is the same trap we are
   escaping. Look for **Add new site → Deploy manually**, and if it asks for a
   folder to drag in, drop a **genuinely empty** folder. Whatever you drop
   becomes the site's contents until the first real deploy replaces it, so do
   not reach for a random folder off the desktop.
3. Open the new site → **Site configuration** → **General** → **Site details**.
4. Copy the **Site ID** into your note. It looks like
   `1a2b3c4d-5e6f-7890-abcd-ef1234567890`.
5. While you are on that screen, find **Project visibility**. On the current
   free plan a project can be **Public**, **Password**, or **Private**.

**Leave it private while testing if you prefer — but it must be Public before
step 7.** Two things do not work otherwise: `verify-deploy.sh` fetches the site
with no credentials and will report a failure, and once DNS moves, a private
project means the live site is dark to everyone except you.

---

## Step 3 — Create a Netlify access token

This is the one value in these steps that is genuinely secret. It lets a
machine deploy to your site; it does not touch the database.

1. Top right avatar → **User settings**.
2. **Applications** → **Personal access tokens** → **New access token**.
3. Name it `github-actions-deploy`. Expiry: one year is sensible.
4. **Copy it now.** Netlify shows it exactly once.

---

## Step 4 — Put four values into GitHub

These are "secrets" in GitHub's wording, which is why publishable values live
there too — the box is simply where the build reads its settings from.

1. Go to <https://github.com/sadakc/neuvto-wos>.
2. **Settings** (top bar of the repository, not your account settings).
3. Left sidebar → **Secrets and variables** → **Actions**.
4. **New repository secret**, four times. Name and value must be exact —
   a typo in a name produces a build that succeeds and points nowhere.

| Name                            | Value                                  |
| ------------------------------- | -------------------------------------- |
| `VITE_SUPABASE_URL`             | the Project URL from step 1            |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | the `sb_publishable_…` key from step 1 |
| `NETLIFY_AUTH_TOKEN`            | the token from step 3                  |
| `NETLIFY_SITE_ID`               | the Site ID from step 2                |

Once saved, GitHub will never show these again. That is expected.

---

## Step 5 — The deploy runs

This part is code, not clicking. The workflow builds the site with the values
above, then runs `scripts/verify-deploy.sh` against the result and **refuses to
publish a build that points at any database other than
`udrzhfgwqgolvyimbwto`**.

That check exists because the failure it prevents has already happened twice
and both times looked like a successful deploy.

The site appears at a Netlify address like `https://neuvto-wos.netlify.app`.
`neuvto.com` is untouched at this stage — the old site keeps serving.

---

## Step 6 — Check it before switching anything

On the Netlify address:

1. Open it, go to **Sign in**, enter your email.
2. A six-digit code should arrive within a minute.

If it does, the new site is talking to the real database — nothing else can
send that email. If it does not, stop and say so; do not proceed to step 7.

---

## Step 7 — Point neuvto.com at it, last

Only after step 6 passes.

**First, set Project visibility to Public** (Site configuration → General). A
private project serves the site to you alone, so leaving it private here takes
`neuvto.com` dark for every visitor the moment DNS resolves to it.

Netlify will show the exact records under **Domain management → Add a custom
domain**. Use the values it gives you rather than any written here — they
change, and a wrong DNS record takes hours to undo.

In GoDaddy: **My Products → neuvto.com → DNS → Manage Zones**.

**Do not touch these records.** They are what makes email work, and breaking
them is a worse day than the one this document is about:

- `resend._domainkey`
- `send` (both its MX and TXT records)
- `_dmarc`

You are only changing where the **website** points — the `A` record at `@`, and
`www` if present.

---

## The demo-request form (optional, later)

The "Request a demo" form on the landing page is the only part of the site that
needs the **service role** key, and it is the only part that will not work after
step 5.

Two ways to deal with it, and there is no rush:

1. **Add the key to Netlify** — Site configuration → Environment variables → Add
   a variable named exactly `SUPABASE_SERVICE_ROLE_KEY`. **Not** `VITE_…`. It
   stays on Netlify's server and never reaches a browser.
2. **Move the form to an edge function**, the way `client-error` already works.
   Then no service role key exists outside Supabase at all, which is the better
   end state and is a small piece of work.

Option 2 is worth doing. Option 1 is a reasonable stop-gap if a prospect is
about to visit the site.

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
