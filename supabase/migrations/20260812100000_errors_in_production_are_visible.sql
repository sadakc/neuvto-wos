-- ============================================================================
-- NEUVTO WOS — an error in production says so, instead of nothing at all
--
-- `src/lib/lovable-error-reporting.ts` looks like error reporting. It is not,
-- anywhere a customer will ever be. It forwards to `window.__lovableEvents` and
-- `window.__lovableReportRuntimeError`, both of which exist ONLY inside the
-- Lovable editor preview. Checked against the live site on 4 Aug 2026:
--
--     __lovableEvents:             undefined
--     __lovableReportRuntimeError: undefined
--
-- So the root error boundary catches a crash, renders "This page didn't load",
-- and reports it to nobody. That is worse than having no reporting, because the
-- code reads as coverage and the audit item stayed closed on the strength of it.
--
-- ── why our own table and not Sentry
--
-- Sentry's free tier is genuinely free and genuinely better at this. It is also
-- a third-party data processor, and an error payload is not abstract: it carries
-- routes, ids, and whatever a message interpolated — which in this product means
-- somebody's employee. Terms, Privacy Policy and a DPA do not exist yet, and
-- India's DPDP Act 2023 applies. Naming a processor a privacy policy has not yet
-- disclosed is the wrong order to do this in.
--
-- So: our own database, in the region the rest of the tenant data already lives
-- in, using the write architecture this codebase already has. Sentry becomes the
-- right answer the day the legal groundwork lands, and this RPC stays useful as
-- the sink either way (decision recorded 4 Aug 2026).
--
-- ── ONE ROW PER FINGERPRINT PER DAY, and why that is the whole design
--
-- The obvious table is one row per occurrence. It is also how a free-tier
-- database dies: a React error inside a render loop calls the reporter on every
-- frame, and 500MB of storage is gone in an afternoon by the very mechanism that
-- was supposed to tell you something was wrong.
--
-- `unique (fingerprint, day)` plus an upsert that increments a counter makes
-- that structurally impossible. A crash that fires two hundred thousand times is
-- one row that says 200000. It is also the more useful shape: nobody wants two
-- hundred thousand rows, they want to know it happened a lot.
--
-- ── `authenticated` ONLY, and the blind spot that leaves
--
-- The obvious design grants this to `anon`. Errors on the landing page and the
-- sign-in screen have no session, and they are the ones nothing else can see: a
-- crash on sign-in means nobody gets in, so no authenticated user will ever
-- exist to report it. That is a real and well-known monitoring blind spot, and
-- this migration accepts it anyway.
--
-- `20260808100000_anon_executes_nothing.sql` exists because on 2 Aug 2026 an
-- anonymous caller could reach `notify_address` on production and queue mail to
-- any address, delivered a minute later from a verified sending domain. An open
-- relay. It was unexploitable only because production had no organisations yet.
-- The conclusion drawn there was not "fix those functions" but a posture:
--
--     alter default privileges ... revoke execute on functions from anon, authenticated;
--
-- deny by default, in every environment, "so forgetting to think about grants
-- fails closed". This function would be the first exception to that since it was
-- written, and error reporting is not a good enough reason to be one. The
-- argument for granting `anon` here — "it is bounded, it only writes one table"
-- — is the same shape as the argument that made `notify_address` look fine.
--
-- So: signed-in callers only. What that costs, stated so it is a known gap
-- rather than a surprise:
--
--   · a crash on `/` or `/auth` is not recorded;
--   · a crash during invitation acceptance, before the session exists, is not
--     recorded — and that is the highest-value one lost.
--
-- Closing it properly needs a channel that does not involve granting `anon` a
-- database function: an edge function with its own rate limiting, which can be
-- origin-checked and is not a route into Postgres. That is the right shape and
-- it is not built yet.
--
-- ── bounds that still apply, none of which trust the client
--
--   · every text column is truncated server-side, so a caller cannot post a
--     megabyte of anything;
--   · the fingerprint/day unique constraint means repeats cost no rows;
--   · a hard ceiling of 500 DISTINCT fingerprints per day, after which the
--     function returns without writing. A signed-in caller is identified but not
--     therefore trusted, and a runaway render loop is not malicious — it is the
--     likeliest way this table ever fills up. The ceiling is silent to the
--     caller; a client told it has been throttled is a client that can pace.
--
-- If a real incident ever generates 500 distinct fingerprints in a day, the
-- ceiling will hide some of them. That is the correct trade: 500 distinct
-- crashes is not a triage problem, it is an outage, and it will not be subtle.
--
-- ── D42 — a platform admin never reads tenant data
--
-- An error message is user-supplied text from the platform's point of view, and
-- "Cannot read balance for priya@customer.test" is a customer's employee. The
-- client scrubs before sending (see src/platform/observability/scrub.ts), and
-- this function scrubs again on arrival.
--
-- Twice on purpose. The client-side pass is the one that keeps the address out
-- of the network request at all, which is the version that matters for a
-- processor agreement. The server-side pass is the one that still holds when the
-- client is an old cached bundle, a hand-rolled curl, or a scrubber somebody
-- broke — and the database is the only place a guarantee can actually live.
-- ============================================================================

create table if not exists public.client_errors (
  id              uuid primary key default gen_random_uuid(),

  -- Grouping key, computed by the client from the normalised message plus the
  -- top stack frame. Opaque here on purpose: the database must not care how it
  -- was derived, so improving the grouping never needs a migration.
  fingerprint     text        not null,
  occurred_on     date        not null default (now() at time zone 'utc')::date,

  occurrences     integer     not null default 1,
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),

  message         text        not null,
  stack           text,
  route           text,

  -- How it was caught. Not an enum: a new capture site should not need a
  -- migration, and an unknown value here is a curiosity rather than a fault.
  mechanism       text        not null,
  severity        text        not null default 'error',

  -- Which build. Null until the deploy pipeline supplies one; without it, "is
  -- this still happening after the fix" is unanswerable.
  release         text,
  user_agent      text,

  -- NOT taken from the caller. Derived from the session below, because a client
  -- that can name an organisation can attribute its errors to somebody else's.
  -- Null for anonymous callers, which is most of the interesting ones.
  organization_id uuid references public.organizations(id),

  constraint client_errors_unique_per_day unique (fingerprint, occurred_on)
);

comment on table public.client_errors is
  'Front-end errors from production, aggregated one row per fingerprint per day. Written only by record_client_error(); read only by platform admins.';

create index if not exists idx_client_errors_recent
  on public.client_errors (occurred_on desc, last_seen_at desc);

-- Deny-all: RLS on, zero policies, exactly like platform_admins. Nothing holds a
-- grant on this table, so `authenticated` and `anon` cannot read a single row of
-- it through PostgREST no matter what they ask for. The only ways in are the two
-- SECURITY DEFINER functions below.
alter table public.client_errors enable row level security;

revoke all on table public.client_errors from anon, authenticated;

-- ───────────────────────────────────────────────────────────────── the write

create or replace function public.record_client_error(
  p_fingerprint text,
  p_message     text,
  p_mechanism   text,
  p_stack       text default null,
  p_route       text default null,
  p_severity    text default 'error',
  p_release     text default null,
  p_user_agent  text default null)
returns void
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_org      uuid;
  v_distinct integer;
  v_message  text;
  v_stack    text;
  v_route    text;
begin
  -- A reporter that throws inside an error handler turns one broken page into a
  -- broken page plus an unhandled rejection. Nothing below raises; bad input is
  -- dropped, and the caller is never told the difference.
  if p_fingerprint is null or btrim(p_fingerprint) = ''
     or p_message is null or btrim(p_message) = '' then
    return;
  end if;

  -- The ceiling. Counted before anything is written, and only for today, so
  -- yesterday's incident cannot suppress today's.
  select count(*) into v_distinct
    from public.client_errors
   where occurred_on = (now() at time zone 'utc')::date;

  if v_distinct >= 500 then
    -- Silent. See the header: a throttled prober should not learn its budget.
    return;
  end if;

  -- Second pass at D42. Blunt on purpose — over-redacting a diagnostic costs
  -- some clarity, under-redacting discloses a customer's employee.
  v_message := left(p_message, 500);
  v_stack   := left(p_stack, 4000);
  v_route   := left(p_route, 200);

  v_message := regexp_replace(v_message,
    '[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}', '[address removed]', 'g');
  v_stack := regexp_replace(coalesce(v_stack, ''),
    '[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}', '[address removed]', 'g');
  v_route := regexp_replace(coalesce(v_route, ''),
    '[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}', '[address removed]', 'g');

  -- Phone numbers, in the shape this product actually stores them (D: India-only
  -- for now, but the pattern is deliberately wider than +91 so that going global
  -- does not silently start leaking numbers).
  v_message := regexp_replace(v_message, '\+[0-9]{10,15}', '[number removed]', 'g');
  v_stack   := regexp_replace(v_stack,   '\+[0-9]{10,15}', '[number removed]', 'g');

  -- From the session, never from the caller.
  select p.organization_id into v_org
    from public.profiles p
   where p.id = (select auth.uid())
     and p.deleted_at is null;

  insert into public.client_errors as ce (
    fingerprint, message, stack, route, mechanism, severity,
    release, user_agent, organization_id)
  values (
    left(p_fingerprint, 200), v_message, nullif(v_stack, ''), nullif(v_route, ''),
    left(coalesce(p_mechanism, 'unknown'), 50),
    case when p_severity in ('error', 'warning', 'info') then p_severity else 'error' end,
    left(p_release, 100), left(p_user_agent, 300), v_org)
  on conflict (fingerprint, occurred_on) do update
    set occurrences   = ce.occurrences + 1,
        last_seen_at  = now(),
        -- Keep the newest stack: a recurring error is most useful with the
        -- context of its most recent occurrence, and the first one is often the
        -- least representative (cold cache, first paint).
        stack         = coalesce(excluded.stack, ce.stack),
        release       = coalesce(excluded.release, ce.release),
        -- Only ever fill in an organisation, never overwrite one. The first
        -- report may be anonymous and a later one signed in; the reverse must
        -- not erase what we learned.
        organization_id = coalesce(ce.organization_id, excluded.organization_id);
end $function$;

comment on function public.record_client_error is
  'Records a front-end error from a SIGNED-IN caller. Truncates, scrubs addresses and phone numbers (D42), derives the organisation from the session, aggregates by fingerprint per day, and stops writing after 500 distinct fingerprints in a day. NOT granted to anon — see 20260808100000_anon_executes_nothing.sql. Errors on the landing page and during sign-in are therefore not captured; closing that needs an edge function, not a wider grant.';

-- Explicit revoke before the grant, not just the grant. `revoke ... from public`
-- removes the implicit grant; the explicit per-role ones are what the hosted
-- default privileges add, and the two are removed by different statements. This
-- is the exact asymmetry that made the 2 Aug migrations look correct locally
-- while doing nothing on production.
revoke all on function public.record_client_error(text, text, text, text, text, text, text, text)
  from public, anon;
grant execute on function public.record_client_error(text, text, text, text, text, text, text, text)
  to authenticated;

-- ────────────────────────────────────────────────────────────────── the read

create or replace function public.platform_client_errors(p_days integer default 7)
returns table (
  fingerprint   text,
  message       text,
  route         text,
  mechanism     text,
  severity      text,
  occurrences   bigint,
  days_seen     bigint,
  first_seen_at timestamptz,
  last_seen_at  timestamptz,
  release       text,
  stack         text)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  -- Raises rather than returning nothing, for the same reason platform_mail_health
  -- does: a monitor that answers "all clear" to somebody who is not entitled to
  -- ask is the worst possible failure mode for a monitor.
  if not public.is_platform_admin() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  return query
  select
    ce.fingerprint,
    -- One message per group; they are identical by construction of the
    -- fingerprint, so the newest is as good as any and cheaper than an array.
    (array_agg(ce.message order by ce.last_seen_at desc))[1],
    (array_agg(ce.route order by ce.last_seen_at desc))[1],
    (array_agg(ce.mechanism order by ce.last_seen_at desc))[1],
    (array_agg(ce.severity order by ce.last_seen_at desc))[1],
    sum(ce.occurrences)::bigint,
    count(*)::bigint,
    min(ce.first_seen_at),
    max(ce.last_seen_at),
    (array_agg(ce.release order by ce.last_seen_at desc))[1],
    (array_agg(ce.stack order by ce.last_seen_at desc))[1]
  from public.client_errors ce
  where ce.occurred_on > (now() at time zone 'utc')::date - greatest(coalesce(p_days, 7), 1)
  group by ce.fingerprint
  order by max(ce.last_seen_at) desc
  limit 200;
end $function$;

comment on function public.platform_client_errors is
  'Platform admins only. Front-end error groups over the last N days, newest first. Organisation is deliberately NOT returned — which customer hit a bug is tenant data (D42), and the fault is diagnosable without it.';

revoke all on function public.platform_client_errors(integer) from public, anon;
grant execute on function public.platform_client_errors(integer) to authenticated;
