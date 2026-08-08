# Leaving Supabase, if it comes to that

**Version:** 1.0 · **Status:** Active · **Updated:** 8 Aug 2026

Sada's instruction, 8 Aug 2026:

> All the data that you have across Supabase or anywhere else might be a case
> that I might move over to AWS once I have multiple customers. The customer
> would look for something concrete in terms of either AWS or Supabase. Be
> prepared and make sure you have everything aligned so that migration can be an
> easy/seamless task rather than a mess.

Nothing here proposes moving. It records what the move would cost today, so the
number is known rather than feared, and names the handful of rules that keep it
from growing.

---

## The short answer

**A move to AWS is a re-host, not a rewrite** — provided the rules in the last
section hold.

Supabase is not a proprietary platform with a Postgres attachment. It is four
open-source pieces assembled for you:

| Supabase gives you | What it actually is | On AWS                                  |
| ------------------ | ------------------- | --------------------------------------- |
| the database       | PostgreSQL          | RDS or Aurora PostgreSQL                |
| the data API       | PostgREST           | PostgREST in a container on ECS/Fargate |
| sign-in            | GoTrue              | GoTrue in a container, **or** Cognito   |
| edge functions     | Deno Deploy         | Lambda, or a container                  |

Every one of those runs on AWS. The expensive migration is the one that swaps the
_design_ — moving business logic out of SQL and into application services. The
cheap one keeps the design and changes the operator.

This matters because of where Neuvto's logic lives. **51 migrations, 94 database
functions, and every authorisation rule are plain PostgreSQL** — `SECURITY
DEFINER` RPCs and row-level security. That is the product's brain, and it is
already portable. It restores into RDS from a `pg_dump` with the caveats below.

---

## What is already contained

Two seams were built for this and are holding:

**The generated Supabase types reach four files**, all inside
`src/integrations/supabase/`. No component, route, or handler imports
`Database` or `Tables<>`. Swapping the client does not ripple into the UI.

**The Lovable APIs are quarantined by ESLint** (`NEUVTO_CODING_STANDARDS.md` §9)
— a `no-restricted-imports` pattern that fails the build rather than relying on
anyone remembering. That mechanism is the model for the gap below.

---

## What is coupled, and by how much

Measured 8 Aug 2026. These are the real numbers, not estimates.

### 1. Identity — the expensive one

| Coupling                              | Count  |
| ------------------------------------- | ------ |
| Foreign keys pointing at `auth.users` | **49** |
| Migrations calling `auth.uid()`       | 29     |
| Migrations referencing `auth.users`   | 13     |

`auth.uid()` itself is trivial — it reads a JWT claim, and is three lines to
reimplement. The 49 foreign keys are the real weight: every user id in the system
is a GoTrue user id.

- **Keeping GoTrue** (self-hosted on ECS): ids are preserved, foreign keys are
  untouched, migration is a data copy. Strongly the cheaper path.
- **Moving to Cognito**: every user gets a new id, and 49 foreign keys have to be
  remapped in one transaction. Doable, and not something to do casually.

**The decision to defer, not make now.** Nothing in the app should acquire new
knowledge of GoTrue specifics in the meantime.

### 2. The data API — 87 call sites

87 `.from()` / `.rpc()` calls across 21 files speak PostgREST's protocol.

**Running PostgREST on AWS keeps all 87 working unchanged**, because PostgREST is
what they are talking to — Supabase is just hosting it. Replacing it with a
hand-written API means rewriting all 87 and re-implementing the authorisation
that RLS does for free. Do not do that as part of a hosting move.

Of the 87, **78 sit correctly** in `src/platform/*/index.ts` and
`src/modules/leave/handlers.ts`. **Nine do not** — see the gap below.

### 3. Postgres extensions

| Used           | Where                       | On RDS PostgreSQL        |
| -------------- | --------------------------- | ------------------------ |
| `pg_cron`      | 3 scheduled jobs            | ✅ supported             |
| `pg_net`       | notification dispatch       | ❌ **not available**     |
| Supabase Vault | 1 call, `platform_secret()` | ❌ → AWS Secrets Manager |

**`pg_net` is the only genuine dead end.** The notification engine posts from
Postgres to an edge function over HTTP, and RDS has no equivalent. It becomes a
polling worker or an EventBridge schedule — a contained change, in one migration
and one small service, but it will not lift and shift.

### 4. Edge functions

Three Deno functions (`client-error`, `demo-request`, `notification-dispatch`).
They use the standard `Deno.serve` / `fetch` surface, so they port to Lambda or a
container with modest edits. Small.

### 5. Storage and realtime

One migration mentions `storage.`; nothing uses realtime. Effectively nil.

---

## The one structural gap

**Nine queries live in components and routes instead of a data module:**

| File                                               | Calls |
| -------------------------------------------------- | ----- |
| `src/platform/modules/OrgModules.tsx`              | 2     |
| `src/modules/leave/components/TeamCalendar.tsx`    | 2     |
| `src/modules/leave/components/LeaveCalendar.tsx`   | 2     |
| `src/modules/leave/components/OpeningBalances.tsx` | 2     |
| `src/platform/reports/ScheduledReports.tsx`        | 1     |
| `src/routes/app/setup.tsx`                         | 1     |
| `src/routes/app/import.tsx`                        | 1     |

They are the exceptions, not the pattern — which is what makes them worth fixing
now rather than arguing about later. Each one is a place where a data-layer change
becomes UI surgery, and each already violates `NEUVTO_CODING_STANDARDS.md` §11
("business logic in a handler, not a component or route").

**The fix is the Lovable quarantine, applied to the client**: move the nine calls
into their neighbouring `index.ts` / `handlers.ts`, then add a
`no-restricted-imports` rule making `@/integrations/supabase/client` unreachable
outside `src/platform/*/`, `src/modules/*/`, `src/integrations/`, and `src/lib/`.
After that the boundary is enforced by CI rather than by memory — the same
reasoning as putting the soft-delete filter in the RLS policy
(`NEUVTO_DATA_STANDARDS.md` §2): enforce it where forgetting is impossible.

**Not yet done.** Proposed, awaiting a go-ahead.

---

## Rules that keep the cost flat

1. **Business logic goes in SQL, not in an edge function.** SQL ports; Deno is
   rewritten. This is already the house pattern — it is written down here because
   it is also the portability argument.
2. **No Supabase import outside `src/integrations/supabase/`,** except the client
   itself, and that only from a data module.
3. **No new `pg_net` calls.** One dependency on it is a contained problem; five is
   an architecture.
4. **New tables keep `organization_id` and RLS** (`NEUVTO_DATA_STANDARDS.md` §5).
   Tenant isolation that lives in the database moves with the database.
5. **Nothing new may learn GoTrue's internals.** Identity stays behind
   `src/platform/auth/`.

---

## Cost, stated plainly

Per the standing rule that nothing is paid before the MVP ships:

| Option                   | Monthly         |
| ------------------------ | --------------- |
| Supabase Free (today)    | **₹0**          |
| Supabase Pro             | ~$25            |
| AWS: RDS + Fargate + ALB | ~$70–120, floor |

AWS is **not** the cheaper option at one customer, or at ten. It is the option
that answers a procurement questionnaire. The trigger for moving should be a
customer who requires it in writing — not a milestone, and not a preference.

`docs/operations/PRODUCTION_HOSTING.md` covers where the _site_ is served, which
is a separate question and currently mid-move to Cloudflare.
