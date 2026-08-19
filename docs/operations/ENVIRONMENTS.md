# Four stacks, and why hosting is moving to get them

**Version:** 1.3 · **Status:** In progress · **Updated:** 18 Aug 2026

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

## Status as of 18 Aug 2026

- [x] `qa` and `uat` branches pushed, both currently identical to `main`
- [x] Netlify site shells created (`neuvto-wos-qa`, `neuvto-wos-uat`) — empty,
      nothing linked, zero deploy credits spent. Unused now that Cloudflare is
      live; delete once the cutover has held.
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
- [ ] Delete the unused Netlify QA/UAT shells, and the production site, once
      this has held for a week.
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

The `www` DNS record is **still a CNAME to `neuvto-wos.netlify.app`, proxied
(orange cloud)**. That is deliberate, and it is the reason this change carried no
downtime: proxying means the rule fires at Cloudflare's edge and the origin is
never contacted, and it means a rule that fails to match falls through to
Netlify — which 301s to the apex anyway. The failure mode is the old behaviour,
not an error.

Cloudflare's own documentation recommends replacing the CNAME with a proxied `A`
record to the placeholder `192.0.2.0` for an originless setup. That is the
cleaner end state and it is **not** done yet on purpose: it converts a rule
mismatch from "works via Netlify" into "points at a blackhole". Do it in the same
change that deletes the Netlify site, not before.

Verified end to end: `http://www` → 301 → `https://www` → 301 →
`https://neuvto.com/` → 200, certificate `CN=www.neuvto.com` issued by Google
Trust Services, paths and query strings preserved, and no Netlify header
anywhere in the chain.
