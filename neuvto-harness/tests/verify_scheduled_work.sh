#!/usr/bin/env bash
# D43 — the work that is supposed to happen on its own actually happens.
#
# Sada provisioned a customer and waited for the administrator's invitation.
# It never came. The email had been rendered perfectly and was sitting in
# `notifications` with status = 'pending', where it would have stayed forever,
# because nothing in the entire repository ran on a schedule. The dispatcher's
# own comment said "Invoked on a schedule" and that comment was the only
# occurrence of the word.
#
# It survived four build steps and a green harness. That is the part worth
# staring at: every existing assertion invoked the dispatcher by hand first, so
# every one of them passed. A queue nobody drains is indistinguishable from a
# queue with nothing in it — unless you refuse to invoke anything and watch.
#
# So this file invokes nothing. It queues work and waits, which is the only
# arrangement in which "nothing is running" can be told apart from "everything
# is fine".
#
# Bash rather than SQL for the same reason as verify_concurrency.sh: the thing
# under test happens in another session, on a clock, and a single transaction
# cannot watch a clock it is holding still.
set -uo pipefail

PSQL="${PSQL:-psql}"
DB_URL="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
MIGRATIONS="${MIGRATIONS:-supabase/migrations}"

# How long to wait for a job scheduled '* * * * *' to fire on its own. pg_cron
# fires on the minute boundary, so the worst case is a full minute from a
# standing start plus the time it takes to run.
WAIT_FOR_TICK="${WAIT_FOR_TICK:-80}"
# And for a queued notification to be picked up, posted to the dispatcher, and
# written back. Only used where delivery is actually configured.
WAIT_FOR_DRAIN="${WAIT_FOR_DRAIN:-100}"

q() { "$PSQL" "$DB_URL" -tAc "$1" 2>/dev/null | tr -d '[:space:]'; }

fail() { echo "    SCHEDULED WORK FAIL: $*"; exit 1; }

# ------------------------------------------------------------------ preflight
if [[ "$(q "select count(*) from pg_extension where extname = 'pg_cron'")" != "1" ]]; then
  echo "    skipped — pg_cron is not installed in this database"
  exit 0
fi

# ═════════════════════════════════════════ 1 · every schedule we declare is live
#
# Read the expected jobs out of the migrations rather than hardcoding them, so
# adding a schedule adds an assertion. A name that is scheduled and then
# unscheduled by a later statement is NOT expected — both migrations unschedule
# before scheduling to stay idempotent, and one of them clears out a job that
# was renamed. Comparing positions rather than mere presence is what tells those
# apart; verify-functions-wired.sh had this exact bug and reported a dropped
# function as an unwired one for a while.
ACTIONS=$(for f in $(ls "$MIGRATIONS"/*.sql 2>/dev/null | sort); do
  tr '\n' ' ' < "$f" | grep -oE "cron\.(un)?schedule\([[:space:]]*'[^']+'"
done | sed -E "s/cron\.(un)?schedule\([[:space:]]*'([^']+)'/\1|\2/")

if [[ -z "$ACTIONS" ]]; then
  fail "no cron.schedule() call exists in $MIGRATIONS.
              This is the original defect verbatim: work meant to run on a
              schedule, with no schedule anywhere in the repository."
fi

EXPECTED=""
for name in $(printf '%s\n' "$ACTIONS" | cut -d'|' -f2 | sort -u); do
  # Empty first field = schedule, "un" = unschedule. Last one wins.
  if [[ -z "$(printf '%s\n' "$ACTIONS" | grep -- "|${name}\$" | tail -1 | cut -d'|' -f1)" ]]; then
    EXPECTED="$EXPECTED $name"
  fi
done

for name in $EXPECTED; do
  case "$(q "select active from cron.job where jobname = '$name'")" in
    t) : ;;
    f) fail "the job '$name' is registered but INACTIVE. It will never fire." ;;
    *) fail "the migrations schedule '$name' and no such job exists.
              Every email this product sends depends on a job being registered." ;;
  esac
done
echo "    ok: every schedule the migrations declare is registered and active ($(echo $EXPECTED | wc -w | tr -d ' ') jobs)"

# ═══════════════════════════════════════════ 2 · what they run still resolves
#
# A job whose function has been renamed or dropped stays happily registered and
# fails once a minute where nobody is looking. EXPLAIN resolves the call without
# executing it — running these for real would mature leave balances underneath
# the invariant checks, and a test that quietly mutates the data it shares is
# worse than no test.
while IFS='|' read -r jobname command; do
  [[ -z "$jobname" ]] && continue
  case "$command" in
    select*|SELECT*) ;;
    *) echo "    note: '$jobname' does not run a select; its command is not resolved here"; continue ;;
  esac
  if ! err=$("$PSQL" "$DB_URL" -tAc "explain (costs off) $command" 2>&1 >/dev/null); then
    fail "the job '$jobname' runs SQL that no longer resolves:
              $command
              $(printf '%s' "$err" | head -3)"
  fi
done < <("$PSQL" "$DB_URL" -tAc \
  "select jobname || '|' || command from cron.job where jobname like 'neuvto-%'" 2>/dev/null)
echo "    ok: every scheduled command still resolves against the schema"

# ═════════════════════════════════════════════ 3 · the scheduler is genuinely running
#
# Registered, active, valid — and still never executed, if the cron background
# worker is not attached to this database. That is a configuration living
# outside every file in this repository, which makes it exactly the sort of
# thing to assert rather than assume.
#
# Nothing below invokes anything. It watches.
TICKER=$(q "select jobname from cron.job where active and schedule = '* * * * *' order by jobid limit 1")
[[ -z "$TICKER" ]] && fail "no job runs every minute, so nothing here can be observed running unattended."

if [[ "$(q "select count(*) from cron.job_run_details")" == "0" ]] \
   && [[ "$(q "select setting from pg_settings where name = 'cron.log_run'")" == "off" ]]; then
  echo "    note: cron.log_run is off, so unattended execution cannot be observed here"
else
  waited=0
  # A run inside the last 75 seconds already proves it — a job on '* * * * *'
  # cannot have one otherwise, and nothing in this harness invokes it. Warm
  # databases skip the wait; a database that came up seconds ago does not.
  recent="select count(*) from cron.job_run_details d join cron.job j on j.jobid = d.jobid
           where j.jobname = '$TICKER' and d.start_time > now() - interval '75 seconds'"
  while [[ "$(q "$recent")" == "0" ]]; do
    if (( waited >= WAIT_FOR_TICK )); then
      fail "'$TICKER' is scheduled every minute and has not run in ${WAIT_FOR_TICK}s.
              The schedule exists; the scheduler is not executing it. Check that
              cron.database_name names this database and that the worker started."
    fi
    [[ $waited -eq 0 ]] && printf '    waiting up to %ss for the scheduler to fire on its own' "$WAIT_FOR_TICK"
    printf '.'
    sleep 5
    waited=$((waited + 5))
  done
  [[ $waited -gt 0 ]] && printf '\n'

  failures=$(q "select count(*) from cron.job_run_details d join cron.job j on j.jobid = d.jobid
                 where j.jobname like 'neuvto-%' and d.status = 'failed'
                   and d.start_time > now() - interval '1 hour'")
  [[ "${failures:-0}" != "0" ]] && fail "$failures scheduled run(s) failed in the last hour:
              $(q "select string_agg(distinct d.return_message, ' / ')
                     from cron.job_run_details d join cron.job j on j.jobid = d.jobid
                    where j.jobname like 'neuvto-%' and d.status = 'failed'
                      and d.start_time > now() - interval '1 hour'")"

  echo "    ok: '$TICKER' ran unattended — nothing in this file invoked it"
fi

# ═══════════════════════════════════════ 4 · mail in the queue is not ignored
#
# The end of the story rather than the middle. Everything above proves a job
# fires; this proves the fired job does something about mail that is waiting.
#
# Two honest outcomes, because delivery is configured per environment and CI has
# no Vault secrets by design:
#
#   configured    the row is picked up and processed, with nobody watching
#   unconfigured  the run says so, loudly, every time it has mail it cannot send
#
# The second is not a consolation prize. Silence is precisely what hid the
# original defect for four build steps, so "unconfigured is loud" is a property
# worth a test of its own.
ORG=$(q "select id from public.organizations where deleted_at is null order by created_at limit 1")
if [[ -z "$ORG" ]]; then
  echo "    note: no organisation exists in this database, so the queue cannot be tested"
  exit 0
fi

cleanup() {
  "$PSQL" "$DB_URL" -q -c \
    "delete from public.notifications where event_key = 'harness.scheduled_work';" >/dev/null 2>&1
}
trap cleanup EXIT

cleanup
"$PSQL" "$DB_URL" -q -c "
  insert into public.notifications
    (organization_id, recipient_email, recipient_name, event_key, channel,
     payload, subject, body)
  values
    ('$ORG', 'harness@neuvto.test', 'Harness', 'harness.scheduled_work', 'email',
     '{}'::jsonb, 'harness — scheduled work', 'queued by verify_scheduled_work.sh');
" >/dev/null || fail "could not queue a notification to watch"

CONFIGURED=$(q "select count(*) from vault.secrets
                 where name in ('notification_dispatch_url', 'notification_dispatch_key')")

if [[ "${CONFIGURED:-0}" == "2" ]]; then
  waited=0
  # Not "status = sent" — an undeliverable address is a legitimate outcome and
  # not what is under test. What is under test is that *something processed the
  # row*, which a queue nobody drains can never do.
  touched="select count(*) from public.notifications
            where event_key = 'harness.scheduled_work'
              and (status <> 'pending' or attempts > 0)"
  printf '    waiting up to %ss for the queue to drain with nobody watching' "$WAIT_FOR_DRAIN"
  while [[ "$(q "$touched")" == "0" ]]; do
    if (( waited >= WAIT_FOR_DRAIN )); then
      printf '\n'
      fail "a notification sat pending for ${WAIT_FOR_DRAIN}s with delivery configured.
              This is the original defect: mail rendered, queued, and never sent."
    fi
    printf '.'
    sleep 5
    waited=$((waited + 5))
  done
  printf '\n    ok: a queued notification was picked up unattended in ~%ss\n' "$waited"
else
  # Deliberately invoked by hand — the assertion is about what it SAYS, and
  # waiting for the scheduler to say it would mean scraping the server log.
  out=$("$PSQL" "$DB_URL" -c "select public.dispatch_notifications();" 2>&1)
  if ! printf '%s' "$out" | grep -q "notification(s) waiting but Vault has no"; then
    fail "delivery is unconfigured and mail is waiting, and the dispatcher said nothing.
              An unconfigured environment must be loud: silent success is
              indistinguishable from the fault this file exists to catch.
              got: $(printf '%s' "$out" | head -2)"
  fi
  echo "    ok: unconfigured delivery complains about waiting mail instead of returning quietly"
fi
