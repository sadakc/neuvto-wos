-- ============================================================================
-- NEUVTO WOS — the demo form stops needing a service role key
--
-- `submitDemoRequest` was the only caller of `supabaseAdmin` in the entire
-- codebase, and therefore the only reason a service role key had to exist
-- anywhere outside Supabase. A service role key bypasses RLS completely: it
-- reads and writes every customer's data, and it was being carried for a form
-- that collects a name and an email address from strangers.
--
-- On 7 Aug 2026 the site moved to a build pipeline we own, which raised the
-- question of where that key would live — GitHub Actions, Netlify's runtime
-- environment, or nowhere. This makes the answer "nowhere".
--
-- ── what was actually true before this
--
-- Worth writing down, because it is not what the code implied. `demo_requests`
-- already granted `anon` INSERT, under a policy validating the shape:
--
--     Anyone can submit a demo request — INSERT, {anon, authenticated}
--
-- So the browser could always have inserted directly and the admin client was
-- never needed. Nothing was exposed by it: RLS has no SELECT, UPDATE or DELETE
-- policy, so despite blanket table grants, an anonymous caller could add a row
-- and never read one back. Checked before changing anything, rather than
-- assumed from the grants, which look far worse than the behaviour.
--
-- ── why an edge function rather than simply letting the browser insert
--
-- Because a public insert with no ceiling is a free-tier database waiting to be
-- filled by whoever finds the endpoint. The direct path has no rate limiting
-- and no way to add any. The `client-error` function established the shape on
-- 6 Aug and it applies unchanged here: the browser talks to a function we
-- deploy, the function holds the service key, and `anon` executes nothing.
--
-- ── what changes for `anon`
--
-- Its grants on this table are revoked. The policy is left in place and is now
-- inert for `anon` — a policy permits, a grant admits, and removing the grant
-- closes the door whatever the policy says. `authenticated` is deliberately
-- untouched: `src/lib/mcp/tools/submit-demo-request.ts` inserts as the
-- signed-in user, and breaking a working tool was not part of this.
-- ============================================================================

-- ─────────────────────────────────────────────── the write

create or replace function public.record_demo_request(
  p_name      text,
  p_email     text,
  p_company   text default null,
  p_employees text default null,
  p_message   text default null)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $function$
declare
  v_today integer;
begin
  -- Validation restated here rather than trusted from the edge function. The
  -- function is ours, but it is one deploy away from being an older version of
  -- itself, and this is the layer that cannot be skipped by anything reaching
  -- the database. Mirrors the RLS policy the direct path used.
  if p_name is null or btrim(p_name) = '' or char_length(btrim(p_name)) > 200 then
    return;
  end if;
  if p_email is null
     or char_length(p_email) < 3 or char_length(p_email) > 320
     or p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return;
  end if;

  -- A daily ceiling, for the same reason `record_public_client_error` has one:
  -- this endpoint is reachable by anybody, and the cheapest way to hurt a free
  -- tier database is to write to it in a loop. Two hundred genuine demo
  -- requests in one day would be a wonderful problem and is not one this
  -- product has; if it ever does, the number is one line.
  --
  -- Silent, like the others. A throttled prober should not learn its budget.
  select count(*) into v_today
    from public.demo_requests
   where created_at >= (now() at time zone 'utc')::date;

  if v_today >= 200 then
    return;
  end if;

  insert into public.demo_requests (name, email, company, employees, message)
  values (
    left(btrim(p_name), 200),
    left(btrim(p_email), 320),
    nullif(left(btrim(coalesce(p_company, '')), 200), ''),
    nullif(left(btrim(coalesce(p_employees, '')), 50), ''),
    nullif(left(btrim(coalesce(p_message, '')), 5000), ''));
end $function$;

comment on function public.record_demo_request is
  'Records a demo request from an anonymous visitor, via the demo-request edge function. Validates name and email, truncates every field, and stops after 200 rows in a UTC day. Never raises — a lead form that throws at a prospect is worse than one that quietly drops a duplicate. service_role only; anon executes nothing (20260808100000).';

revoke all on function public.record_demo_request(text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_demo_request(text, text, text, text, text)
  to service_role;

-- ─────────────────────────────────────────────── close the direct path

-- `anon` no longer needs to reach this table at all: the edge function does,
-- as service_role. The grants being removed are far wider than the policy ever
-- used — the table was created with the full default set — so this is also the
-- first time SELECT, UPDATE and DELETE are actually withdrawn from `anon`
-- rather than merely left unreachable by RLS.
--
-- Defence in depth cuts both ways: RLS without a policy was already denying
-- those, and a grant that is never exercised is still a grant somebody can
-- write a policy against by accident.
revoke all on table public.demo_requests from anon;

comment on table public.demo_requests is
  'Leads from the public demo form. Written only by record_demo_request() through the demo-request edge function, and by the signed-in MCP tool. anon holds no grant — see 20260816100000.';
