-- ============================================================================
-- NEUVTO WOS — Notification retry
--
-- Step 5 shipped with a comment claiming a network failure was "left retryable
-- rather than marked failed". That was false: the code marked it failed and
-- nothing ever looked at a failed row again. A momentary blip between Supabase
-- and Resend therefore lost an approval email permanently, and the manager
-- waiting on it simply never found out.
--
-- D29 — a notification that failed for a reason that might not recur is retried
-- with exponential backoff, up to a cap, and only then declared dead. A reason
-- that certainly will recur — a malformed address, a rejected sender — is
-- terminal immediately. Retrying that only burns quota and delays the moment
-- somebody notices.
-- ============================================================================

alter table public.notifications
  add column next_attempt_at timestamptz not null default now(),
  -- Distinct from failed_reason on purpose. failed_reason means "this is dead
  -- and here is why". last_error means "the most recent try did not work and it
  -- is going to try again" — a pending row needs to carry that without
  -- claiming to be failed.
  add column last_error text;

comment on column public.notifications.next_attempt_at is
  'Not claimable before this. Set by notification_mark_retry with exponential backoff (D29).';
comment on column public.notifications.last_error is
  'Most recent transient failure on a row that is still pending. Terminal failures use failed_reason.';

-- The old constraint forbade any error text on a pending row, which is exactly
-- what a row awaiting retry needs to carry.
alter table public.notifications drop constraint notification_status_evidence;

alter table public.notifications add constraint notification_status_evidence check (
  (status = 'pending' and sent_at is null and failed_reason is null)
  or (status = 'sent'   and sent_at is not null)
  or (status = 'failed' and failed_reason is not null)
);

-- The queue index has to agree with how the queue is now read, or every claim
-- degrades to a sequential scan once the table has any history in it.
drop index if exists idx_notifications_queue;
create index idx_notifications_queue on public.notifications (next_attempt_at)
  where status = 'pending' and deleted_at is null;

-- ═══════════════════════════════════════════════════════════ claiming

-- Five attempts over roughly half an hour. Enough to ride out a provider blip
-- or a brief network partition; not so many that a genuinely broken
-- notification takes a day to surface.
create or replace function public.notification_max_attempts()
returns smallint language sql immutable as $$ select 5::smallint $$;

create or replace function public.notification_claim_batch(_limit integer default 20)
returns table (
  id              uuid,
  organization_id uuid,
  recipient_email text,
  recipient_name  text,
  event_key       text,
  subject         text,
  body            text
)
language sql
volatile
security definer
set search_path = public
as $$
  with claimed as (
    update public.notifications n
       set attempts = n.attempts + 1,
           updated_at = now()
     where n.id in (
       select id from public.notifications
        where status = 'pending'
          and deleted_at is null
          and next_attempt_at <= now()      -- respect the backoff
        order by created_at
        limit greatest(_limit, 0)
        for update skip locked
     )
    returning n.*
  )
  select c.id, c.organization_id, p.email, p.full_name, c.event_key, c.subject, c.body
    from claimed c
    join public.profiles p on p.id = c.recipient_id
   where p.deleted_at is null;
$$;

-- ═══════════════════════════════════════════════════════════ outcomes

-- Transient. Back off and try again, unless we are out of attempts — at which
-- point it becomes terminal, because a queue that retries forever is a queue
-- nobody ever looks at.
create or replace function public.notification_mark_retry(_id uuid, _reason text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_attempts smallint;
begin
  select attempts into v_attempts from public.notifications where id = _id;
  if v_attempts is null then return; end if;

  if v_attempts >= public.notification_max_attempts() then
    update public.notifications
       set status = 'failed',
           failed_reason = 'GAVE_UP after ' || v_attempts || ' attempts — '
                           || coalesce(nullif(btrim(_reason), ''), 'UNKNOWN'),
           last_error = null
     where id = _id and status <> 'sent';
    return;
  end if;

  -- 2, 4, 8, 16 minutes. Doubling rather than a fixed delay so a provider
  -- outage is not hammered by every queued notification at the same interval.
  update public.notifications
     set next_attempt_at = now() + (interval '1 minute' * power(2, v_attempts)),
         last_error = left(coalesce(nullif(btrim(_reason), ''), 'UNKNOWN'), 500)
   where id = _id and status <> 'sent';
end $$;

comment on function public.notification_mark_retry is
  'Backs a transient failure off for another try, or declares it dead once attempts run out (D29).';

-- Success clears the retry state as well as the failure state, or a row that
-- succeeded on its third attempt would keep the error from its second.
create or replace function public.notification_mark_sent(_id uuid)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  update public.notifications
     set status = 'sent', sent_at = now(), failed_reason = null, last_error = null
   where id = _id and status <> 'sent';
$$;

create or replace function public.notification_mark_failed(_id uuid, _reason text)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  update public.notifications
     set status = 'failed',
         failed_reason = coalesce(nullif(btrim(_reason), ''), 'UNKNOWN'),
         last_error = null
   where id = _id and status <> 'sent';
$$;

-- Same posture as the other delivery functions: the dispatcher may call this,
-- a signed-in user may not.
revoke execute on function public.notification_mark_retry(uuid, text) from public, authenticated;
grant  execute on function public.notification_mark_retry(uuid, text) to service_role;
grant  execute on function public.notification_max_attempts()         to service_role, authenticated;
