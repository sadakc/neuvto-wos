-- ============================================================================
-- NEUVTO WOS — a mail failure says so, instead of waiting to be found
--
-- On 3 Aug 2026 three invitations failed on production over roughly twelve
-- hours and nothing anywhere said a word. They were found only because somebody
-- happened to query `net._http_response` by hand. For a customer the symptom
-- would have been a person saying "I never got it" — days later, if at all.
--
-- ── why this is a screen and not an email
--
-- The obvious alarm is to email somebody. It cannot be: the thing being watched
-- is the ability to send email, so the alarm would travel the exact path it is
-- reporting broken. An alarm that fails silently in the same way as the fault it
-- watches is worse than none, because it also removes the worry.
--
-- So the facts live here, and `/admin` reads them. That is passive — it alarms
-- when somebody looks — and passive is the honest limit of what can be built
-- without a second channel. When one exists (a webhook to Slack or Discord, both
-- free), it posts these same numbers and nothing here changes.
--
-- ── what the harness already covered, and did not
--
-- `verify_scheduled_work.sh` asserts that an environment with NO delivery
-- configured is loud about it. That is a different fault: on 3 Aug delivery was
-- configured, the cron ran every minute, the dispatcher returned 200, and every
-- message was refused by Resend with "API key is invalid". Every check we had
-- was green while nothing could be delivered.
--
-- ── D42, and why the reason is redacted
--
-- A platform admin never reads tenant data. Counts and timings are facts about
-- Neuvto's own infrastructure, not about anybody's employees, so they are fine.
-- The failure REASON is the awkward one: it is what makes the alarm actionable
-- ("API key is invalid" is the whole answer), and a provider can just as easily
-- return "invalid recipient priya@customer.test", which is a tenant's employee.
--
-- The address is therefore stripped before it is returned. Diagnosis survives;
-- the disclosure does not.
-- ============================================================================

create or replace function public.platform_mail_health()
returns table (
  healthy                boolean,
  failed_24h             integer,
  pending_now            integer,
  oldest_pending_minutes integer,
  last_sent_at           timestamptz,
  last_failure_at        timestamptz,
  last_failure_reason    text)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_reason  text;
  v_sent    timestamptz;
  v_failed  timestamptz;
begin
  -- Platform infrastructure, so platform admins only. Raises rather than
  -- returning an empty row, for the same reason the reports do: a health check
  -- that answers "all clear" to somebody who may not ask is the worst possible
  -- failure for a health check.
  if not public.is_platform_admin() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select max(sent_at) into v_sent from public.notifications where status = 'sent';
  select max(updated_at) into v_failed from public.notifications where status = 'failed';

  select left(n.failed_reason, 300) into v_reason
    from public.notifications n
   where n.status = 'failed' and n.failed_reason is not null
   order by n.updated_at desc
   limit 1;

  -- Anything shaped like an address goes, wherever the provider put it. A
  -- deliberately blunt pattern: over-redacting a diagnostic costs a little
  -- clarity, under-redacting discloses a customer's employee.
  v_reason := regexp_replace(coalesce(v_reason, ''),
                             '[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}',
                             '[address removed]', 'g');

  return query
  with f as (
    select count(*)::integer as c
      from public.notifications
     where status = 'failed' and updated_at > now() - interval '24 hours'
  ),
  p as (
    select count(*)::integer as c,
           coalesce(
             extract(epoch from (now() - min(created_at)))::integer / 60, 0
           ) as oldest_min
      from public.notifications
     where status = 'pending' and deleted_at is null
  )
  select
    -- Healthy means mail is flowing NOW — not that nothing has ever gone wrong.
    --
    -- The first version asked only "did anything fail in 24 hours", and the
    -- first thing it did on production was show red over a resolved incident:
    -- two failures from the previous day, both since superseded by a successful
    -- send. An alarm that cries wolf after recovery is the one somebody learns
    -- to ignore, which costs more than having no alarm at all.
    --
    -- So a failure counts against health only until mail flows again. The count
    -- is still REPORTED, because two messages that never arrived remain worth
    -- knowing about — the caller decides whether that is red or a footnote.
    (p.oldest_min < 10
     and (v_failed is null or (v_sent is not null and v_sent > v_failed))),
    f.c,
    p.c,
    p.oldest_min,
    v_sent,
    v_failed,
    nullif(v_reason, '')
  from f, p;
end $function$;

revoke all on function public.platform_mail_health() from public, anon;
grant execute on function public.platform_mail_health() to authenticated;

comment on function public.platform_mail_health() is
  'Platform admins only. Whether mail is being delivered, and why not. Addresses are stripped from the failure reason (D42).';
