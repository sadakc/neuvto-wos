#!/usr/bin/env bash
#
# Neuvto WOS — make product email work on this machine
#
#   bash scripts/dev-mail.sh            start it
#   bash scripts/dev-mail.sh --stop     stop it
#
# WHY THIS IS NEEDED
#
# There are two delivery paths and, until this existed, only one visible outcome.
#
#   sign-in codes   Supabase Auth → SMTP → Mailpit         visible
#   product email   Postgres → edge function → Resend HTTP  invisible locally
#
# So provisioning a customer locally produced an invitation that was rendered
# perfectly, queued correctly, and could never be read — and looking in the one
# inbox on the machine showed only sign-in codes. That is exactly how the
# missing scheduler stayed hidden for four build steps.
#
# This starts the real dispatcher (the same code that runs in production) and
# the Resend stub, which relays into Mailpit. Everything then arrives in one
# inbox: http://127.0.0.1:54324
#
# The pg_cron job in 20260801100000_scheduled_work.sql drives it, so mail simply
# turns up within a minute. Nothing here is production code — the dispatcher
# carries no branch for local development.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

SCRATCH="${TMPDIR:-/tmp}/neuvto-dev-mail"
mkdir -p "$SCRATCH"

stop() {
  # The edge runtime keeps serving after its parent goes, so name it explicitly.
  pkill -f "resend-stub.ts"                   2>/dev/null
  pkill -f "functions serve"                  2>/dev/null
  echo "local mail stopped"
}

if [ "${1:-}" = "--stop" ]; then stop; exit 0; fi

if ! supabase status >/dev/null 2>&1; then
  echo "Supabase is not running. Start it first:  supabase start" >&2
  exit 1
fi

stop >/dev/null 2>&1
sleep 1

# ---------------------------------------------------------------- the stub
# MAILPIT_SMTP_HOST switches on the relay. Without it the stub only captures,
# which is what the harness wants.
MAILPIT_SMTP_HOST=127.0.0.1 MAILPIT_SMTP_PORT=54325 \
  bun neuvto-harness/tools/resend-stub.ts > "$SCRATCH/stub.log" 2>&1 &

# ---------------------------------------------------------------- the dispatcher
#
# host.docker.internal, not 127.0.0.1: the edge runtime is a container, and its
# own localhost is not this machine's. Getting this wrong produces a connection
# refused that looks exactly like the stub being down.
cat > "$SCRATCH/functions.env" <<'ENV'
RESEND_API_KEY=re_local_stub_key_not_a_real_credential
RESEND_API_BASE=http://host.docker.internal:8787
NOTIFICATION_FROM=Neuvto <notifications@neuvto.test>
ENV

supabase functions serve notification-dispatch --no-verify-jwt \
  --env-file "$SCRATCH/functions.env" > "$SCRATCH/functions.log" 2>&1 &

echo "waiting for the dispatcher…"
for _ in $(seq 1 60); do
  curl -s -o /dev/null http://127.0.0.1:54321/functions/v1/notification-dispatch && break
  sleep 2
done

# ---------------------------------------------------------------- point cron at it
#
# Both values live in Vault rather than in the migration, because a migration is
# a file in git. These are the local throwaway equivalents.
PSQL="${PSQL:-$(command -v psql || echo /opt/homebrew/opt/libpq/bin/psql)}"
DB="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
SRK=$(supabase status -o json | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('SERVICE_ROLE_KEY') or d['SECRET_KEY'])")

"$PSQL" "$DB" -q >/dev/null 2>&1 <<SQL
delete from vault.secrets where name in ('notification_dispatch_url','notification_dispatch_key');
select vault.create_secret('http://host.docker.internal:54321/functions/v1/notification-dispatch','notification_dispatch_url','local development');
select vault.create_secret('$SRK','notification_dispatch_key','local development');
SQL

cat <<EOF

  ─────────────────────────────────────────────
   Product email now works locally.

     Inbox      http://127.0.0.1:54324
     Stub       http://127.0.0.1:8787/__captured
     Logs       $SCRATCH/

   pg_cron drains the queue every minute, so an
   invitation arrives on its own within ~60s.

   Force it now:
     psql "$DB" -c "select public.dispatch_notifications()"
  ─────────────────────────────────────────────

EOF
