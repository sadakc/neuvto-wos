# Four stacks, and why hosting is moving to get them

**Version:** 1.5 · **Status:** In progress · **Updated:** 19 Aug 2026

Sada's instruction, 8 Aug 2026:

> I would like to have a couple of stacks: dev stack, QA stack, pre-production,
> and production... We can just add the stack/environment that would help me
> test the scenarios across every other stack or environment and give me more
> accurate results in production. I can prevent the defect well in advance
> rather than later. Precaution is better than cure.

"Pre-production" was already taken — see below — so the fourth stack is named
**UAT**. This records what exists, what each stack is for, and the migration
this triggered.

---

## The five environments, not four

| Environment        | Reached by                       | Backing database                           | Status                                     |
| ------------------ | -------------------------------- | ------------------------------------------ | ------------------------------------------ |
| **Local**          | `supabase start` on your machine | local Docker Postgres                      | already exists, unchanged                  |
| **QA**             | `qa` branch → `qa.neuvto.com`    | new Supabase project, org **Neuvto QA**    | branch pushed; project pending             |
| **UAT**            | `uat` branch → `uat.neuvto.com`  | new Supabase project, org **Neuvto QA**    | branch pushed; project pending             |
| **Pre-production** | Lovable's own preview            | Lovable Cloud (`vkyvzhgigncranprhidn`)     | already exists, **unchanged by this plan** |
| **Production**     | `main` branch → `neuvto.com`     | `neuvto-wos-prod` (`udrzhfgwqgolvyimbwto`) | already exists, unchanged                  |

**Do not call the UAT stack "pre-production."** That name is already
[DEPLOYMENT.md](DEPLOYMENT.md)'s term for Lovable Cloud — the database Lovable's
own preview builds are wired to. Reusing it for the new customer-demo stack
would make every future reference to "pre-production" ambiguous. UAT is where a
prospect asking for a demo gets provisioned — same [[D42]] rule as production:
Sada names the demo org's admin, no self-serve signup, staff don't read tenant
data. It being a demo stack doesn't relax that.

---

## Supabase: a second free organization

The free plan caps an organization at **2 active projects**; production already
uses one of `Neuvto`'s two. Rather than pay for Pro (~$25/project/month, against
the standing rule that nothing is paid before the MVP ships) or merge QA and UAT
scratch/demo data into one project, QA and UAT get their own projects inside a
**second free organization, "Neuvto QA."** Net new cost: **$0**. Trade-off: two
Supabase dashboards to check instead of one.

**Pending — only Sada can do this, no API creates a Supabase organization:**
create it at the Supabase dashboard, free plan, then hand the org ID over so the
two projects can be created in it.

---

## Hosting: executing D61 now instead of later

The build spec already recorded this move as **D61** — Netlify's free plan
metering deploys (300 credits/month, 15/production deploy, ~20 publishes total)
was going to force a move to Cloudflare Workers eventually. Standing up QA and
UAT on Netlify would draw auto-deploys from that **same shared team-wide
budget** that protects `neuvto.com` — exhausting it doesn't just stop a QA
deploy, it takes production dark. Rather than build two new stacks on the
platform already flagged for replacement, D61 is being executed now.

**The apex-domain constraint:** `neuvto.com` has no A record split by
subdomain — Cloudflare requires the _entire_ DNS zone on its nameservers to
issue certificates for any custom domain under it, including `qa.` and `uat.`.
There is no way to put only the new subdomains on Cloudflare while leaving
production's DNS on GoDaddy. The nameserver move touches the live site's `A`
record and every Resend email record in the same motion.

### Pre-migration DNS baseline — captured 8 Aug 2026, before any change

Captured so a bad import into Cloudflare has something exact to be checked
against, and so a rollback has a source of truth:

```
neuvto.com.               A      75.2.60.5                  (Netlify)
www.neuvto.com.           CNAME  neuvto-wos.netlify.app.
send.neuvto.com.          MX     10 feedback-smtp.ap-northeast-1.amazonses.com.
send.neuvto.com.          TXT    "v=spf1 include:amazonses.com ~all"
resend._domainkey.        TXT    "p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCySvipdOBpJkdX2n0EZp58vN7kF5ZdAFIa8Kw2yyU9I1N5JSLT0uAJiJpWtnAC0j1Q+3hpd6tfINFsK5qAjWn6UV39J89HClBtyY0K51yhxx/DyL1Gy1uwDWocXFN6Lr5YY4nD37SQ4/FYQKycRnHJHmeBia0Gx5fcIag7LkgluwIDAQAB"
_dmarc.neuvto.com.        TXT    "v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc_rua@onsecureserver.net;"
NS (current, GoDaddy)     ns65.domaincontrol.com. / ns66.domaincontrol.com.
```

No MX or TXT at the bare apex — only under `send.` — and no MX at all besides
Resend's.

### Migration sequence

| Phase | Action                                                                                         | Who                                                                                                                                   |
| ----- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Create free Cloudflare account                                                                 | **Sada** — account creation is not something this session performs                                                                    |
| 2     | Add `neuvto.com` as a site in Cloudflare; let it auto-scan DNS                                 | Sada                                                                                                                                  |
| 3     | Check the auto-scanned records against the baseline above, especially the three Resend records | either, before cutover                                                                                                                |
| 4     | Point GoDaddy's nameservers at the two Cloudflare gives you                                    | **Sada** — no GoDaddy connector available here                                                                                        |
| 5     | Verify `neuvto.com` still resolves and mail records still match, post-propagation              | either                                                                                                                                |
| 6     | Stand up Cloudflare Pages/Workers projects for production, QA, UAT; repoint `deploy.yml`       | once a scoped Cloudflare API token exists (as a local env var, not pasted into chat — same handling as the Supabase service role key) |

Nothing in phases 1, 2, or 4 can be done from here — no Cloudflare connector is
available this session, and account creation is out of scope regardless of
connector access. This document gets updated as each phase lands.

---

## Status as of 19 Aug 2026

- [x] `qa` and `uat` branches pushed, both currently identical to `main`
- [x] Netlify site shells created (`neuvto-wos-qa`, `neuvto-wos-uat`) and later
      deleted — see below. QA and UAT will be Cloudflare, not Netlify.
- [x] DNS baseline captured (above) — **and it was incomplete.** See below.
- [x] **Zone moved to Cloudflare, 17 Aug 2026.** `edna`/`woz.ns.cloudflare.com`.
      All records carried over DNS-only (grey cloud) so the site kept serving
      from Netlify unchanged. DKIM verified intact at 218 characters, and a real
      demo-request email landed in the inbox rather than spam afterwards — the
      only check that actually proves the mail path.
- [x] **Worker proven on `wos.neuvto.com`, 18 Aug 2026.** Sign-in, `/app` and
      `/neuvto-hq` all exercised against real Supabase. Roughly 2–3× faster than
      Netlify on first-byte.
- [x] **`deploy.yml` publishes to Cloudflare Workers.**
- [x] **Cutover done, 18 Aug 2026, 13:58 UTC.** `neuvto.com` is served by the
      Worker. Apex now answers `104.21.22.34` / `172.67.202.58`, certificate
      `CN=neuvto.com` (Google Trust Services, to 21 Oct 2026), `server:
cloudflare` with no `x-nf-request-id`. It cost about ten minutes of
      downtime — see below.
- [x] `DEPLOY_URL` repository variable deleted, so `deploy.yml` now verifies
      `neuvto.com` itself rather than the hostname it was standing in for.
- [x] **`www` moved off Netlify, 18 Aug 2026.** A Cloudflare Redirect Rule now
      301s it to the apex at the edge; Netlify is no longer in the path at all.
      See "The www redirect" below for the rule, which lives in the dashboard
      and not in this repository.
- [x] **All three Netlify sites deleted, 19 Aug 2026** — `neuvto-wos`,
      `neuvto-wos-qa`, `neuvto-wos-uat`. Earlier than planned, and it broke
      `http://www`; see "Deleting Netlify" below. **Netlify is no longer part of
      this system in any form.**
- [ ] Second Supabase organization ("Neuvto QA") — waiting on Sada
- [ ] QA and UAT Supabase projects — waiting on the organization

### What the 8 Aug baseline missed

It recorded six records. The zone had ten. `_lovable` (a verification TXT plus a
literal `"(value from Lovable dialog)"` paste), `notify` delegated to
`ns3/ns4.lovable.cloud`, and `_domainconnect` were all absent from it — so the
pre-cutover check compared against an incomplete list and reported a clean match.

`notify.neuvto.com` served **Mailgun MX and SPF records** for the second email
system Lovable scaffolded on 30 Jul 2026 and which was reverted in #14. The
revert cleaned the repository; nothing cleaned GoDaddy, so the DNS half outlived
the code by eighteen days. None of the three were carried into Cloudflare, which
retired them.

The lesson is about the check, not the records: Cloudflare's scan guesses common
names and a hand-written baseline records what somebody thought to look for.
Neither enumerates a zone. The registrar's own record list is the only complete
source, and reading it is what found these.

### What the cutover actually cost, 18 Aug 2026

Ten minutes of downtime on the apex. The plan predicted one to three.

Cloudflare will not attach a Custom Domain to a hostname that already has a
hand-made DNS record:

```
Hostname 'neuvto.com' already has externally managed DNS records
(A, CNAME, etc). Delete them first or try a different hostname.  [code: 100117]
```

That is by design — a Custom Domain _creates_ the record and issues the
certificate, so it refuses to fight an existing one. There is no atomic swap and
no override, in the dashboard or the API. **The hostname must be empty first**,
which means every apex cutover to a Worker has a gap in it. Plan for the gap;
it cannot be engineered away.

The gap was ten minutes rather than one because of how the domain was created,
not because of the rule. The dashboard's **Add Domain** field takes the
subdomain _label_ and appends the zone, so typing `neuvto.com` produced
`neuvto.com.neuvto.com` — a live Custom Domain and DNS record under a nonsense
hostname, while the apex had nothing at all. Finding and undoing that is where
the time went.

`wrangler` has no such ambiguity: `CUSTOM_DOMAINS` in
`scripts/cloudflare-worker-config.mjs` is an exact hostname list, and the deploy
that used it succeeded first time and took 1m37s end to end.

**So the order for any future apex cutover is:** declare the hostname in
`CUSTOM_DOMAINS` and merge it; delete the existing record; trigger the deploy
immediately. Never type a hostname into the dashboard — the one screen where a
typo becomes a live DNS record is the worst place to be improvising.

Two things kept the blast radius small, and both were deliberate:
`wos.neuvto.com` stayed up throughout on the same Worker and was a working URL
to hand anyone, and the Netlify site was never torn down, so a rollback was
always two screens away. Neither was needed, but the cutover was only
comfortable because they existed.

### The www redirect

`www.neuvto.com` is not a Custom Domain and never will be. Custom Domains match
the hostname exactly, so a Worker attached to `neuvto.com` never sees `www` —
Cloudflare's documented answer is a Redirect Rule, and that is what is in place.

The rule is **zone configuration in the Cloudflare dashboard**, not code. Nothing
in this repository would tell you it exists, and it disappears silently if
somebody deletes it, so it is written down here:

|              |                                                          |
| ------------ | -------------------------------------------------------- |
| Where        | neuvto.com → Rules → Redirect Rules                      |
| Name         | `www to Apex`                                            |
| Match        | Wildcard pattern, request URL `https://www.neuvto.com/*` |
| Target       | `https://neuvto.com/${1}`                                |
| Status       | 301                                                      |
| Query string | preserved                                                |

The `www` DNS record is a **proxied `A` record to `192.0.2.0`** — Cloudflare's
reserved placeholder for an originless setup. Because the record is proxied the
request never travels to that address; Cloudflare intercepts it and applies the
rule. There is no origin behind `www` and there is not meant to be one.

**The rule matches `https://` only, so `Always Use HTTPS` is load-bearing.**
SSL/TLS → Edge Certificates → Always Use HTTPS is on, which 301s HTTP to HTTPS at
the edge before any origin is consulted; the rule then takes it the rest of the
way. Turn that off and every plain-HTTP request to `www` falls through to a
placeholder address that answers nothing. The two settings are a pair and neither
is safe to change alone.

Verified 19 Aug 2026, all four combinations:

| request                  | result                                 |
| ------------------------ | -------------------------------------- |
| `http://neuvto.com`      | 301 → `https://neuvto.com` → 200       |
| `https://neuvto.com`     | 200                                    |
| `http://www.neuvto.com`  | 301 → `https://www` → 301 → apex → 200 |
| `https://www.neuvto.com` | 301 → apex → 200                       |

Paths and query strings survive: `/pricing?utm_source=test&a=b` arrives intact.
Certificate `CN=www.neuvto.com`, Google Trust Services, to 21 Oct 2026.

### Deleting Netlify

All three sites were deleted on 19 Aug 2026, a day after the cutover rather than
the week that was planned. Two things are worth recording from that.

**It broke `http://www`, and not for the obvious reason.** The redirect rule
matches `https://` only. Plain-HTTP requests had never matched it — they fell
through to Netlify, which force-redirected to HTTPS, and the rule caught them on
the way back. That fallthrough was doing real work while looking like a safety
net nobody needed. With the site gone, HTTP requests reached a dead origin and
Cloudflare returned **404**. HTTPS, and the apex on both schemes, were unaffected
throughout. `Always Use HTTPS` is the fix and is now the thing keeping it working.

**A deleted Netlify site frees its `*.netlify.app` name for anyone to claim.**
For as long as `www` still CNAMEd to `neuvto-wos.netlify.app`, any request that
missed the rule would have been proxied to whoever registered that name — a
dangling-CNAME takeover. Removing the CNAME closed it. The general rule: **delete
the DNS record before the thing it points at, never after.** The `notify` →
`ns3.lovable.cloud` delegation that outlived its code by eighteen days is the
same mistake in a slower form.

**The rollback that was lost was worth less than it looked.** Reverting to
Netlify would have meant repointing DNS — but DNS is on Cloudflare's nameservers,
so any failure large enough to need it would have taken DNS with it. It only ever
covered app-level faults on the Worker, and Workers → Deployments already rolls
those back in one click without touching DNS. Recreating the site was considered
and rejected.

### The service role key

**It is not on the Worker, and that is deliberate.** `SUPABASE_SERVICE_ROLE_KEY`
bypasses Row Level Security — it reads and writes every tenant's data with no
policy in the way. The Worker runs at the edge in hundreds of locations. Those
two facts should not meet without a reason, and there is currently no reason.

Checked rather than assumed, 19 Aug 2026:

| module                                                     | reads                                      | imported by                   |
| ---------------------------------------------------------- | ------------------------------------------ | ----------------------------- |
| `client.server.ts` — exports `supabaseAdmin`, bypasses RLS | `SUPABASE_SERVICE_ROLE_KEY`                | **nothing**                   |
| `auth-middleware.ts` — `requireSupabaseAuth`               | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | **nothing**                   |
| `auth-attacher.ts` — the only middleware in `src/start.ts` | **no environment at all**                  | `src/start.ts`                |
| `client.ts`                                                | `import.meta.env.VITE_*`, inlined at build | the app                       |
| `submit-demo-request.ts`                                   | `process.env`                              | `/mcp`, which answers **401** |

Both files that want the key are **generated by Lovable** and are dead. The
landing page's demo form goes through `lib/demo-request.ts`, a different path.

#### The trap, and why there is a lint rule

Importing `supabaseAdmin` without the key throws at runtime:

> `Missing Supabase environment variable(s): SUPABASE_SERVICE_ROLE_KEY. Connect Supabase in Lovable Cloud.`

**That message asks the reader to put a key that reads every tenant's data onto
an edge worker**, and it arrives at the exact moment somebody is debugging under
pressure. It is Lovable's message, written for Lovable's architecture, and it is
wrong here.

So `no-restricted-imports` in `eslint.config.js` fires first — at the import,
with the argument, before anyone meets the runtime error. Standards §1 rule 5.

It is ESLint and not a grep in the guardrails job on purpose. That job's own
comments record the previous attempt: a grep could not see an `eslint-disable`
exemption, the two checks disagreed, and the grep was removed rather than taught
to parse comments. A grep would also flag `client.server.ts`'s own documentation,
which names the module in a comment — the same way the `auth.uid()` check flagged
itself twice.

**What the rule does not do.** It stops an import. It cannot stop someone copying
the sixty lines of `client.server.ts` inline and reading the environment variable
directly. It catches the accident and the generated code, not a determined
workaround, and should not be read as more than that.

The patterns cover `@/`-aliased, parent-relative and **sibling-relative** forms.
The last was found by writing a probe inside `src/integrations/supabase/` and
watching it pass the first version of the rule — which is the directory Lovable
generates into, so it was the hole that mattered.

#### If privileged access is genuinely needed

In order, best first:

1. **A `SECURITY DEFINER` RPC that checks `is_platform_admin()`.** Already the
   pattern — seven migrations use it, and the whole `/neuvto-hq` console does
   privileged cross-tenant work with **no service key at all**. This covers
   almost every case anyone would reach for the key to solve.
2. **A Supabase Edge Function** holding the key in Supabase's own environment,
   invoked from the Worker. The key never touches Cloudflare.
3. **A Worker secret**, last resort — `wrangler secret put
SUPABASE_SERVICE_ROLE_KEY`, run by Sada, never pasted into a chat or a file.
   `wrangler secret delete` undoes it.

The key already exists and Sada holds it (see CONTINUITY.md §4.2), so none of
this has a lead time. The open question is only ever _where it lives_, and today
the answer is _nowhere near the edge_.
