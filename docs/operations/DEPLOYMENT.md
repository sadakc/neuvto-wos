# Deployment — how code and schema actually reach each environment

**The single most important fact:** merging to `main` deploys **code** and not
**schema**. Nothing about a green CI run or a successful Lovable sync tells you
the hosted database has your migration. Applying it is a separate, manual,
deliberate step, and forgetting it is the failure mode that produces a working
build against a broken database.

---

## The three environments

| Environment        | Project ref            | Reached by                                                                   | Contains                       |
| ------------------ | ---------------------- | ---------------------------------------------------------------------------- | ------------------------------ |
| **Local**          | —                      | `supabase start` · `.env.local` · `bun run harness`                          | Whatever your migrations build |
| **Pre-production** | `vkyvzhgigncranprhidn` | Lovable's own database tool · Lovable previews                               | Lovable Cloud — Sada's testing |
| **Production**     | `udrzhfgwqgolvyimbwto` | `bash scripts/prod-cutover.sh` · `psql` · the harness · `neuvto.lovable.app` | Real customer data             |

**Hosting and database are separate choices**, and this is the fact the whole
arrangement rests on. Lovable builds and publishes `neuvto.lovable.app`, but the
app is plain `supabase-js` reading `VITE_SUPABASE_URL` — `src/integrations/lovable/index.ts`
is auto-generated and imported by nothing. So the published site talks to
whichever database `.env` names, and that is a project Sada owns.

> ## Why production is not Lovable Cloud
>
> The Supabase CLI **cannot see `vkyvzhgigncranprhidn` at all** — it belongs to
> Lovable's organisation, so `supabase projects list` does not include it and no
> password for it is obtainable. A production database on the far side of that
> boundary would mean:
>
> - every migration hand-pasted into Lovable's SQL tool and manually recorded in
>   `schema_migrations`, forever
> - the harness **never** able to run against production
> - no psql, no MCP, no automated verification of the one environment that matters
> - Lovable's own agent holding schema write access to production
>
> So production moved to `udrzhfgwqgolvyimbwto`, where `db push` works, the
> harness runs, and backups are Sada's.

> ## ⚠️ A credential from the wrong project looks exactly like a broken one
>
> Two projects, two sets of keys, and the failure mode is identical either way.
> This already cost an afternoon: a service role key from one project used
> against a function deployed on the other returned `unauthorized`, which looked
> precisely like a broken function.
>
> | You want                    | Take it from                      |
> | --------------------------- | --------------------------------- |
> | Anything for **production** | Sada's Supabase dashboard         |
> | Anything for pre-production | Lovable → project → Cloud/Backend |
>
> If something returns 401, check which project the credential came from before
> changing any code.

> ## ⚠️ `.env` decides which database the published app talks to
>
> It is committed, and it is the **only** thing that decides. `scripts/lovable-gate.mjs`
> therefore blocks any Lovable pull request touching it — a regenerated `.env`
> would silently repoint the live site, and every symptom of that is a data
> problem rather than a config one.
>
> **`SUPABASE_PROJECT_ID` must not be set in `.env`.** The unprefixed variable is
> read by nothing in the app, but the Supabase CLI honours it and it **silently
> overrides `project_id` in `supabase/config.toml`**, which is what names local
> Docker containers. It is why the local stack ran as
> `supabase_db_vkyvzhgigncranprhidn` long after `config.toml` said otherwise, and
> why the repo appeared to be pointed at the Lovable project. The app uses the
> `VITE_`-prefixed one; keep that, drop the other.

See [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md) for the `.env` / `.env.local`
trap — the default `.env` points at **production**, and `bun run dev` refuses to
start against it unless `.env.local` says otherwise.

---

## Why `supabase db push` does not work **for pre-production**

The Lovable Cloud project is not in Sada's own Supabase organisation. The CLI
cannot authenticate against it, so `supabase link` + `supabase db push` — the
normal path, and the one assumed by every Supabase tutorial — is unavailable.

Migrations reach Lovable Cloud one way only: **executing the SQL through
Lovable's own database tool**, then recording that it happened.

**This limitation is about pre-production alone.** Production _is_ in Sada's
organisation, the CLI authenticates against it, and `db push` is the correct way
to reach it — see "Cutting over to production" below. Reading this section as
"the CLI never works here" is what left the cutover parked for a week, and it is
the reason production is not the environment behind this boundary.

---

## Applying a migration to pre-production (Lovable Cloud)

Do this only after the migration is merged to `main` and CI is green. CI applies
every migration to a clean database from scratch, which is the real proof it
works.

**1 · Execute the DDL, in batches.** Split a large migration into several calls
rather than one. Large single statements intermittently return
`499 request_cancelled` — see the warning below.

**2 · Verify the objects exist.** Never assume success from the absence of an
error, or failure from its presence:

```sql
select table_name from information_schema.tables
where table_schema = 'public' order by table_name;

select routine_name from information_schema.routines
where routine_schema = 'public' order by routine_name;
```

**3 · Record the migration** so Lovable's agent does not later regenerate it:

```sql
insert into supabase_migrations.schema_migrations (version, name)
values ('20260729100425', '20260729100425_approval_engine')
on conflict (version) do nothing;
```

The `version` is the filename's timestamp prefix; `name` is the filename without
`.sql`. `statements` is left null for migrations applied this way — rows written
by Lovable's own agent populate it, ours do not, and the difference is harmless.
It is the `version` that prevents re-application.

**4 · Confirm the published site still loads.** `neuvto.lovable.app` — the
landing page uses `demo_requests`, which no platform migration touches, so a
broken landing page means something unexpected happened.

---

## Cutting over to production

One command, because doing it by hand failed three times for three unrelated
reasons and each error pointed away from its own cause:

```bash
bash scripts/prod-cutover.sh --check
```

`--check` connects, names the project it is pointed at, reports table and
migration counts, and changes nothing. Run it first, every time. Then:

```bash
bash scripts/prod-cutover.sh
```

which pushes migrations and deploys `notification-dispatch`. Add `--harness` to
seed and verify afterwards — that flag refuses on any database holding data.

### The three things that went wrong by hand

**1 · zsh eats a password containing `*`.** `*`, `?` and `[` are glob patterns.
Typed unquoted, the shell tries to expand them, finds no matching file, and
**refuses to run the command at all**:

```
zsh: no matches found: postgresql://postgres:Secret*Pass@db...
```

Nothing connected. Nothing was wrong with the password. Single-quoting fixes it;
the script avoids the question entirely by reading the password with `read -rs`,
so it is never a shell word, never in `argv`, never in `ps`, and never in
`~/.zsh_history`.

**2 · The direct database host is IPv6-only.** `db.<ref>.supabase.co` has an
AAAA record and **no A record**. It resolves and connects from a Mac with IPv6
egress — verified — and is unreachable from anything routing over IPv4, which
includes Docker containers and many corporate and hotel networks. The symptom is
a bare "failed to connect" that reads exactly like a wrong password. Use
`--pooler` for an IPv4 route; note that `neuvto-wos-prod` currently has **no
pooler tenant provisioned**, so the direct host is the only route today.

**3 · `supabase db push --linked` 403s on "Initialising login role".**
`SUPABASE_DB_PASSWORD` in the environment bypasses that path, which is what the
script sets.

### Telling the three apart

The script distinguishes them, because they need opposite responses:

| psql says                        | Means                                                     | Do                            |
| -------------------------------- | --------------------------------------------------------- | ----------------------------- |
| `password authentication failed` | The network is **fine** — it got far enough to be told no | Check the password is current |
| `Connection refused` / timeout   | Never reached the host                                    | IPv4? try `--pooler`          |
| `tenant/user ... not found`      | Reached the pooler; it has no tenant here                 | Drop `--pooler`               |

Repeated failed attempts make the direct host start refusing connections
outright for a while. If a wrong password suddenly becomes `Connection refused`,
that is throttling, not a network change — wait rather than reconfigure.

### Rotate first

> The database password was pasted into a chat transcript on 2 Aug 2026 and must
> be treated as compromised. Rotate it before the cutover:
> **Dashboard → Project Settings → Database → Reset database password.**
> The old one stops working immediately, which is the point.

**The two credentials rotate differently, and only one has a button.**

| Credential            | How to rotate                                                                    |
| --------------------- | -------------------------------------------------------------------------------- |
| Database password     | Project Settings → Database → **Reset database password** — one action, in place |
| `sb_secret_…` API key | Project Settings → API Keys → **create a new one, then delete the old one**      |

There is no rotate action on an API key; the UI offers only create and delete.
Create the replacement first when anything is using the old key, so there is no
window where nothing works. At cutover nothing is using it yet, so the order does
not matter and deleting first is less confusing.

### The harness against prod

`scripts/harness.sh` seeds by **truncating every table it owns**. Two guards
stand in front of that, and the second exists because the first is one flag away
from being defeated:

1. A non-local target refuses without `--allow-remote`.
2. A non-local target that **holds any profile or organisation rows** refuses
   **even with** `--allow-remote`. Emptiness is a fact the database can be asked
   for; no flag can talk it out of the answer.

Run it against production once, while production is empty, to prove the schema
behaves in the environment customers will use. Then clear the seed data before
provisioning anybody — the harness leaves it behind deliberately, so a failure
can be inspected. Acme and Vertex are not customers.

### Two auth settings, or sign-in looks broken

Neither is a migration, and both fail in a way that points at the application:

- **The email template must contain `{{ .Token }}`.** Supabase's default carries
  only a magic link, so the 6-digit code screen can never be completed — the user
  waits for a code that was never sent. Dashboard → Authentication → Email
  Templates.
- **Site URL and the redirect allow-list must include `https://neuvto.lovable.app`.**
  Otherwise every link in every email lands somewhere useless.

### Last: repoint the app

`.env` is what makes production real. Until this changes, migrations are in
production and the published site is still talking to pre-production:

```
VITE_SUPABASE_URL="https://udrzhfgwqgolvyimbwto.supabase.co"
VITE_SUPABASE_PUBLISHABLE_KEY="<from Sada's own dashboard>"
SUPABASE_URL="https://udrzhfgwqgolvyimbwto.supabase.co"
SUPABASE_PUBLISHABLE_KEY="<the same>"
VITE_SUPABASE_PROJECT_ID="udrzhfgwqgolvyimbwto"
```

Do **not** add `SUPABASE_PROJECT_ID` — see the warning above about it hijacking
local container naming.

Before doing it, confirm nothing on `neuvto.lovable.app` matters: repointing
means the accounts and data there stop being visible to the live site.
Provisioning is invitation-only and Sada names every administrator, so this
should be his own testing — but check rather than assume.

Afterwards, **watch that Lovable does not put it back.** `.env` carries no
"auto-generated" marker, but Lovable writes to this repo, and the gate blocks it
in a pull request rather than in a direct push.

---

## Per-environment setup that no migration can do — Vault

**Applying every migration is not enough to make a new environment work.** Two
values are needed that must never appear in a migration, because a migration is a
file in git:

| Vault secret                | Value                                           |
| --------------------------- | ----------------------------------------------- |
| `notification_dispatch_url` | the `notification-dispatch` edge function's URL |
| `notification_dispatch_key` | that project's **service role key**             |

`20260801100000_scheduled_work.sql` ships the `pg_cron` job that drains the
notification queue every minute, and the job runs whether or not these exist.
Without them **every email queues and none is delivered** — which is exactly the
fault this whole mechanism was built to fix, so the dispatcher is deliberately
loud about it: with mail waiting and no secrets, it raises a `WARNING` naming
both keys into the Postgres log every minute.

Set them once per environment, in the SQL editor:

```sql
select vault.create_secret(
  'https://<project-ref>.supabase.co/functions/v1/notification-dispatch',
  'notification_dispatch_url', 'set at cutover');
select vault.create_secret(
  '<service role key>', 'notification_dispatch_key', 'set at cutover');
```

**Never paste the service role key into a chat, a PR, or a file.** Read it from
the project's API settings and paste it into the SQL editor directly.

**A `db reset` clears Vault**, so a local machine needs them again afterwards —
`scripts/dev-mail.sh` does that for you, along with starting the dispatcher and
relaying into Mailpit.

**How to tell it worked:** provision a customer and touch nothing. The invitation
should arrive within about a minute. `neuvto-harness/tests/verify_scheduled_work.sh`
asserts exactly this and can be pointed at any environment.

---

## ⚠️ `499 request_cancelled` does not mean the SQL failed

This has now happened twice, and both times **the DDL had executed** despite the
error. The tool call timed out; Postgres did not.

**Never retry a `499` blindly.** A blind retry re-runs DDL that already
succeeded — at best noisy errors, at worst duplicate or partially-applied
objects. Always `SELECT` against `information_schema` first and retry only the
part that is genuinely missing.

---

## ⚠️ Lovable's agent must never author migrations

Asked once to "apply" an existing migration, Lovable's agent wrote a **new
migration file with the same content** instead — which then broke
`supabase db reset` locally, because the schema was created twice.

`AGENTS.md` at the repo root now forbids this explicitly. That file is the
instruction set Lovable's agent reads, and it is the only lever available for
constraining it. Keeping `supabase_migrations.schema_migrations` in sync (step 3
above) is the second line of defence: an already-recorded migration is one the
agent has no reason to recreate.

---

## Branch protection

`main` requires all three CI checks, **and this is enforced for administrators
too** (`enforce_admins`, enabled 30 Jul 2026). Nothing reaches `main` except
through a pull request with green checks — including Lovable, including the
repository owner. Verified by attempting a direct push:

```
remote: error: GH006: Protected branch update failed for refs/heads/main.
remote: - 3 of 3 required status checks are expected.
 ! [remote rejected] main -> main (protected branch hook declined)
```

### Why it was closed

It was an accepted risk until it cost something. On 30 Jul 2026 Lovable pushed
four commits straight to `main` scaffolding a **second email system** —
`src/lib/email-templates/` calling `@lovable.dev/email-js` with a
`LOVABLE_API_KEY`, four new dependencies, and `notify.neuvto.com` delegated to
Lovable's nameservers.

It duplicated the Notification Engine finished hours earlier, and it violated
§9 of the coding standards, the portability contract: leaving Lovable would have
meant rebuilding email _and_ moving DNS. It also left `main` failing lint, which
is how it was noticed — nothing else would have caught it.

Reverted in #14; the Notification Engine stays. Lovable's changes are now gated
on authorship before they can merge — see
[REVIEWING_LOVABLE_CHANGES.md](REVIEWING_LOVABLE_CHANGES.md).

### What this costs

Lovable pushes as the repository owner, so it can no longer write to `main`
either. **Whether its GitHub sync still works on a branch is not yet known** —
it will become apparent at the next edit made in Lovable. If the integration
breaks outright, reversing is one call:

```bash
gh api -X DELETE repos/sadakc/neuvto-wos/branches/main/protection/enforce_admins
```

That is a real trade and it was made deliberately: a scaffolded vendor
integration landing unreviewed on `main` is worse than losing one-click sync.

---

## Release checklist

Run before merging any step:

```bash
bun run lint && bun run typecheck && bun run test && bun run harness
```

Then, after the merge:

- [ ] CI green on `main`
- [ ] Migration applied to Lovable Cloud and verified by `SELECT`
- [ ] Row present in `supabase_migrations.schema_migrations`
- [ ] `neuvto.lovable.app` loads
- [ ] **Both Vault secrets set in that environment** — see above. A migration
      cannot do this, and without it every email queues silently
- [ ] **`select * from cron.job`** returns the jobs the migrations declare, and
      `cron.job_run_details` shows them running
- [ ] Build-sequence table in
      [../product/NEUVTO_MVP_BUILD_SPEC.md](../product/NEUVTO_MVP_BUILD_SPEC.md)
      marked `**done**`
