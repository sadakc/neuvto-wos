# Four stacks, and why hosting is moving to get them

**Version:** 1.0 · **Status:** In progress · **Updated:** 8 Aug 2026

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

## Status as of 8 Aug 2026

- [x] `qa` and `uat` branches pushed, both currently identical to `main`
- [x] Netlify site shells created (`neuvto-wos-qa`, `neuvto-wos-uat`) — empty,
      nothing linked, zero deploy credits spent. On hold pending the Cloudflare
      decision; likely unused once Cloudflare is live.
- [x] DNS baseline captured (above)
- [ ] Second Supabase organization ("Neuvto QA") — waiting on Sada
- [ ] QA and UAT Supabase projects — waiting on the organization
- [ ] Cloudflare account and zone migration — waiting on Sada
- [ ] Cloudflare Pages/Workers projects and `deploy.yml` update — waiting on a
      Cloudflare API token
