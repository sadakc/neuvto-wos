-- ============================================================================
-- NEUVTO WOS — an error before sign-in is recorded too
--
-- 20260812100000 built the error store and closed it to anonymous callers on
-- purpose, naming the cost precisely:
--
--     · a crash on `/` or `/auth` is not recorded;
--     · a crash during invitation acceptance, before the session exists, is not
--       recorded — and that is the highest-value one lost.
--
-- On 6 Aug 2026 that bill came due. Resend rejected Supabase's SMTP login with
-- `535 "Authentication credentials invalid"`. Sign-in was dead for every
-- address, at every entry point, for THIRTEEN HOURS, and `client_errors` stayed
-- empty the whole time — because everybody hitting it was anonymous, which is
-- the definition of somebody who cannot sign in. It was found by a person
-- trying to log in, not by anything built to notice.
--
-- That migration also named the fix, and this is it: "a channel that does not
-- involve granting `anon` a database function: an edge function with its own
-- rate limiting, which can be origin-checked and is not a route into Postgres."
--
-- `supabase/functions/client-error/index.ts` is that channel. `anon` still
-- executes nothing; the posture from 20260808100000 is untouched. The edge
-- function holds the service key and calls the function below, so the only
-- caller reaching Postgres is one we deploy.
--
-- ── the ceiling had to be split, and this is the important part
--
-- The obvious implementation reuses `record_client_error` from the edge
-- function. `service_role` already holds EXECUTE on it, so it would have worked
-- on the first try, and it would have been a hole.
--
-- That function stops writing after 500 DISTINCT fingerprints in a day, and the
-- stop is SILENT by design — a throttled prober should not learn its budget.
-- Put a public endpoint in front of a shared counter and anybody can post 500
-- junk fingerprints, exhaust it, and suppress every genuine error for the rest
-- of the day, including the signed-in reports from paying customers. Nothing
-- would announce it. Monitoring becomes a denial-of-monitoring vector, and the
-- symptom is the error store looking reassuringly quiet.
--
-- So the budgets are separate, counted over separate `source` values. Filling
-- the public one costs the app one nothing. The public ceiling is also lower:
-- 100 rather than 500, because an anonymous reporter covers two screens, and
-- 100 distinct faults on the landing page and the sign-in screen in one day is
-- already far past the point where somebody should have looked.
--
-- ── what is NOT trusted from a public caller
--
-- Everything the existing function already distrusted, plus:
--
--   · `organization_id` stays null. It is derived from `auth.uid()`, and the
--     service role has none. A public caller could not name one even if it
--     tried, which is the same reason the column was never a parameter.
--   · `source` is set here, not passed in. A caller that can claim 'app' can
--     spend the app's budget, which is the whole attack this splits apart.
-- ============================================================================

-- ─────────────────────────────────────────────────────────── source

alter table public.client_errors
  add column if not exists source text not null default 'app';

comment on column public.client_errors.source is
  'Which channel recorded this: ''app'' for a signed-in caller through record_client_error, ''public'' for an anonymous one through the client-error edge function. Set by the function, never by the caller — it selects which daily ceiling is spent.';

-- Rows written before this migration all came through the signed-in path, so
-- the default is correct for them and no backfill is needed. Stated rather than
-- assumed, because "the default happened to be right" is worth one line.

-- The ceiling counts per source per day, and that count runs on every single
-- report. Without this index it is a sequential scan of the table on a code
-- path whose entire job is to be cheap.
create index if not exists idx_client_errors_source_day
  on public.client_errors (occurred_on, source);

-- ─────────────────────────────────────────────────────────── one scrubber

-- Extracted so the two entry points cannot disagree. They previously would have
-- had a copy each, and a copy of a redaction rule is the copy that stops being
-- updated — which for THIS rule means quietly disclosing a customer's employee
-- (D42) rather than merely drifting.
create or replace function public.scrub_client_text(_text text, _limit integer)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(
    regexp_replace(
      regexp_replace(
        left(coalesce(_text, ''), _limit),
        '[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}', '[address removed]', 'g'),
      '\+[0-9]{10,15}', '[number removed]', 'g'),
    '');
$$;

comment on function public.scrub_client_text is
  'Truncates to _limit, then removes anything shaped like an email address or an international phone number (D42). The single server-side definition, shared by record_client_error and record_public_client_error — see src/platform/observability/scrub.ts for the client-side pass that stops it reaching the network at all.';

-- Nobody calls this directly, so nobody is granted it.
--
-- Worth the two lines rather than shrugging. This function is not SECURITY
-- DEFINER, so the harness invariant that catches anon-executable functions
-- steps over it, and a new function is granted to PUBLIC by default — which
-- means without this it would have been anon-executable and no test would have
-- said so. Harmless in itself (it takes text and returns text, touching no
-- data), and left in place it is one more thing that quietly disagrees with
-- "anon executes nothing" (20260808100000). The default privileges alter in
-- that migration revokes from anon and authenticated on new functions; it does
-- not revoke from PUBLIC, which is the gap this closes.
--
-- The SECURITY DEFINER callers run as the owner and are unaffected.
revoke all on function public.scrub_client_text(text, integer)
  from public, anon, authenticated;

-- ─────────────────────────────────────────── the public write

create or replace function public.record_public_client_error(
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
set search_path = 'public'
as $function$
declare
  v_distinct integer;
begin
  -- Never raises, for the same reason its sibling never raises: this runs
  -- inside somebody's error handler, and a reporter that throws turns one
  -- broken page into a broken page plus an unhandled rejection.
  if p_fingerprint is null or btrim(p_fingerprint) = ''
     or p_message is null or btrim(p_message) = '' then
    return;
  end if;

  -- The public ceiling, counted ONLY over public rows. This is the line that
  -- stops a public endpoint from being able to blind the whole store; see the
  -- header. Silent, like the other one.
  select count(*) into v_distinct
    from public.client_errors
   where occurred_on = (now() at time zone 'utc')::date
     and source = 'public';

  if v_distinct >= 100 then
    return;
  end if;

  insert into public.client_errors as ce (
    fingerprint, message, stack, route, mechanism, severity,
    release, user_agent, organization_id, source)
  values (
    left(p_fingerprint, 200),
    public.scrub_client_text(p_message, 500),
    public.scrub_client_text(p_stack, 4000),
    public.scrub_client_text(p_route, 200),
    left(coalesce(p_mechanism, 'unknown'), 50),
    case when p_severity in ('error', 'warning', 'info') then p_severity else 'error' end,
    left(p_release, 100),
    left(p_user_agent, 300),
    -- Always null. There is no session here and there must be no way to claim
    -- one: attributing an anonymous error to somebody else's organisation is
    -- exactly what a caller-supplied org id would allow.
    null,
    'public')
  on conflict (fingerprint, occurred_on) do update
    set occurrences  = ce.occurrences + 1,
        last_seen_at = now(),
        stack        = coalesce(excluded.stack, ce.stack),
        release      = coalesce(excluded.release, ce.release);
    -- Deliberately does NOT touch `source` or `organization_id` on conflict.
    --
    -- A fingerprint can legitimately be seen both anonymously and signed in —
    -- the same crash on /auth and then inside the app. Whoever got there first
    -- owns the row and its budget line. Letting a public report flip an
    -- existing 'app' row to 'public' would let an attacker move rows OUT of
    -- the app budget, which is the split in this migration undone from the
    -- other direction.
end $function$;

comment on function public.record_public_client_error is
  'Records a front-end error from an ANONYMOUS caller, via the client-error edge function. Same truncation and D42 scrubbing as record_client_error, but its own 100-per-day distinct-fingerprint ceiling counted over source=''public'' only, so exhausting it cannot suppress signed-in reports. organization_id is always null. service_role only — anon still executes nothing (20260808100000).';

-- service_role only. Not anon, not authenticated: a signed-in caller has
-- record_client_error, and giving them this one as well would let them spend
-- the public budget or bypass organisation attribution.
revoke all on function public.record_public_client_error(text, text, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_public_client_error(text, text, text, text, text, text, text, text)
  to service_role;

-- ────────────────────────────────── the signed-in write, now sharing the scrubber

-- Same signature, so this is a replace rather than a drop — the trap that
-- killed a cutover on 5 Aug 2026 was replaying an OLDER signature over a newer
-- one, and changing a `returns`/parameter list here would need a drop first.
-- Behaviour is unchanged except that scrubbing now comes from one place and
-- `source` is stated explicitly rather than left to the column default.
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
begin
  if p_fingerprint is null or btrim(p_fingerprint) = ''
     or p_message is null or btrim(p_message) = '' then
    return;
  end if;

  -- Counted over 'app' rows only now. Before this migration every row was an
  -- app row, so this is the same number it always was — but it is now immune
  -- to whatever the public endpoint is doing.
  select count(*) into v_distinct
    from public.client_errors
   where occurred_on = (now() at time zone 'utc')::date
     and source = 'app';

  if v_distinct >= 500 then
    return;
  end if;

  select p.organization_id into v_org
    from public.profiles p
   where p.id = (select auth.uid())
     and p.deleted_at is null;

  insert into public.client_errors as ce (
    fingerprint, message, stack, route, mechanism, severity,
    release, user_agent, organization_id, source)
  values (
    left(p_fingerprint, 200),
    public.scrub_client_text(p_message, 500),
    public.scrub_client_text(p_stack, 4000),
    public.scrub_client_text(p_route, 200),
    left(coalesce(p_mechanism, 'unknown'), 50),
    case when p_severity in ('error', 'warning', 'info') then p_severity else 'error' end,
    left(p_release, 100), left(p_user_agent, 300), v_org, 'app')
  on conflict (fingerprint, occurred_on) do update
    set occurrences   = ce.occurrences + 1,
        last_seen_at  = now(),
        stack         = coalesce(excluded.stack, ce.stack),
        release       = coalesce(excluded.release, ce.release),
        organization_id = coalesce(ce.organization_id, excluded.organization_id),
        -- A signed-in report on a row first seen anonymously PROMOTES it to
        -- 'app'. That direction is safe and useful: it means a real user hit
        -- the same fault, and it moves the row onto the budget that reflects
        -- who is actually affected.
        source        = 'app';
end $function$;

comment on function public.record_client_error is
  'Records a front-end error from a SIGNED-IN caller. Truncates, scrubs addresses and phone numbers (D42) via scrub_client_text, derives the organisation from the session, aggregates by fingerprint per day, and stops after 500 distinct source=''app'' fingerprints in a day. Anonymous callers go through the client-error edge function and record_public_client_error, which has its own separate ceiling. NOT granted to anon — see 20260808100000_anon_executes_nothing.sql.';

revoke all on function public.record_client_error(text, text, text, text, text, text, text, text)
  from public, anon;
grant execute on function public.record_client_error(text, text, text, text, text, text, text, text)
  to authenticated, service_role;
