#!/usr/bin/env bash
#
# Neuvto WOS — bring a Supabase project up to this repo's schema
#
#   bash scripts/prod-cutover.sh              push migrations, deploy functions
#   bash scripts/prod-cutover.sh --check      connect and report, change nothing
#   bash scripts/prod-cutover.sh --harness    also run the harness (EMPTY targets only)
#
# WHY THIS SCRIPT EXISTS
#
# Three separate things made the by-hand version fail, and each produced an error
# that pointed somewhere other than its cause.
#
# 1. zsh ate the password before Supabase ever saw it.
#
#    A password containing `*` — or `?`, or `[` — is a glob pattern to zsh. Typed
#    unquoted it never reaches the command:
#
#        $ supabase db push --db-url postgresql://...:Secret*Pass@...
#        zsh: no matches found: postgresql://...
#
#    The command did not run. Nothing connected. Nothing was wrong with the
#    password. This script reads it with `read -rs`, so it is never a shell word,
#    never in argv, never in `ps`, and never in ~/.zsh_history.
#
# 2. The direct database host is IPv6-only.
#
#        db.<ref>.supabase.co  →  AAAA only, no A record
#
#    Reachable from a Mac with IPv6 egress, and not reachable from anything
#    routing over IPv4 — Docker, some corporate and hotel networks. The symptom
#    is a bare "failed to connect" that reads like bad credentials. --pooler
#    switches to the IPv4 pooler.
#
# 3. `supabase db push --linked` 403s on "Initialising login role".
#
#    SUPABASE_DB_PASSWORD in the environment bypasses that path entirely, which
#    is what this script sets.
#
# THE PASSWORD IS NEVER PRINTED, NEVER LOGGED, AND NEVER PASSED AS AN ARGUMENT.
# Do not add `set -x` to this file.

set -euo pipefail

cd "$(dirname "$0")/.." || exit 1

MODE="deploy"
POOLER=false
for arg in "$@"; do
  case "$arg" in
    --check)   MODE="check" ;;
    --harness) MODE="harness" ;;
    --pooler)  POOLER=true ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

# ------------------------------------------------------------------ the target
#
# Read from .temp/project-ref, which is what `supabase link` wrote and what
# `--linked` obeys. NOT from config.toml, whose project_id still names the
# Lovable Cloud project — a difference that would otherwise be discovered by
# pushing 33 migrations into the wrong database.
REF_FILE="supabase/.temp/project-ref"
if [[ ! -f "$REF_FILE" ]]; then
  echo "Not linked to any project. Run: supabase link --project-ref <ref>" >&2
  exit 1
fi
REF="$(tr -d '[:space:]' < "$REF_FILE")"

# `supabase projects list --output json` returns a bare array; without the flag
# it returns {"projects": [...]}. Handle both — and do NOT wrap this in a
# try/except that prints "unknown project", which is how the first version of
# this script hid a real parsing bug from itself for three runs.
project_field() {
  supabase projects list --output json 2>/dev/null | python3 -c "
import sys, json
ref, field = sys.argv[1], sys.argv[2]
d = json.load(sys.stdin)
rows = d['projects'] if isinstance(d, dict) else d
for p in rows:
    if p.get('ref') == ref or p.get('id') == ref:
        print(p.get(field, '')); break
" "$REF" "$1"
}

NAME="$(project_field name) · $(project_field region) · $(project_field status)"
[[ "$NAME" == " ·  · " ]] && NAME="not visible to this CLI login"

echo
echo "  target      $REF"
echo "  project     $NAME"
echo "  migrations  $(ls supabase/migrations/*.sql 2>/dev/null | wc -l | tr -d ' ') in this repo"
echo "  mode        $MODE"
echo

# ------------------------------------------------------------------- the secret
#
# `read -rs` keeps this out of argv, out of `ps`, and out of shell history. -r
# stops backslashes being treated as escapes, which matters for a generated
# password.
printf '  Database password for %s (input hidden): ' "$REF"
read -rs SUPABASE_DB_PASSWORD
printf '\n\n'
if [[ -z "$SUPABASE_DB_PASSWORD" ]]; then
  echo "No password entered." >&2
  exit 1
fi
export SUPABASE_DB_PASSWORD

# URL-encoding, for the paths that need a connection string rather than the env
# var. `*`, `@`, `#`, `/` and `?` all change a URL's meaning if passed raw, which
# turns a correct password into a malformed host or a truncated one.
ENC="$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.stdin.readline().rstrip("\n"), safe=""))' <<<"$SUPABASE_DB_PASSWORD")"

if [[ "$POOLER" == true ]]; then
  # The pooler has IPv4. Session mode (5432) — the transaction pooler on 6543
  # does not support the statements migrations run.
  REGION="$(project_field region)"
  if [[ -z "$REGION" ]]; then
    echo "  Could not determine the project's region, which the pooler host needs." >&2
    echo "  Is this CLI logged in to the right account? Try: supabase login" >&2
    exit 1
  fi
  DB_URL="postgresql://postgres.${REF}:${ENC}@aws-0-${REGION}.pooler.supabase.com:5432/postgres"
  HOST="aws-0-${REGION}.pooler.supabase.com (IPv4 pooler)"
else
  DB_URL="postgresql://postgres:${ENC}@db.${REF}.supabase.co:5432/postgres"
  HOST="db.${REF}.supabase.co (direct, IPv6-only)"
fi

PSQL="$(command -v psql || echo /opt/homebrew/opt/libpq/bin/psql)"
[[ -x "$PSQL" ]] || { echo "psql not found. brew install libpq" >&2; exit 1; }

# ------------------------------------------------------- connect before acting
#
# One cheap query first, so a network or credential problem is reported as
# itself rather than as a migration failing halfway through.
echo "  connecting via $HOST …"
if ! OUT="$("$PSQL" "$DB_URL" -tAc 'select current_database()' 2>&1)"; then
  echo
  echo "  $(echo "$OUT" | head -1)"
  echo
  # Distinguish the two, because they need opposite responses and the raw text
  # is easy to skim past. "password authentication failed" means the network
  # path is FINE — TCP, TLS and the handshake all completed — and suggesting the
  # pooler there sends somebody to reconfigure a connection that already works.
  if [[ "$OUT" == *"password authentication failed"* ]]; then
    echo "  The password was rejected. The connection itself is fine — it got far"
    echo "  enough to be told no."
    echo
    echo "  If you rotated it recently, the old one stopped working immediately."
    echo "  Dashboard → Project Settings → Database → Reset database password."
  elif [[ "$OUT" == *"tenant"* || "$OUT" == *"Tenant"* ]]; then
    # Reached the pooler and was refused by it — a different thing from not
    # reaching it. Usually means this project has no pooler tenant provisioned,
    # in which case the direct host is the only route and there is no point
    # retrying here.
    echo "  The pooler answered but does not know this project. It is reachable;"
    echo "  it simply has no tenant for '$REF'."
    echo
    echo "  Use the direct host instead — drop --pooler. It is IPv6-only, which"
    echo "  works from this Mac (verified) but not from IPv4-only networks."
  elif [[ "$POOLER" != true ]]; then
    echo "  Could not reach the host at all. db.${REF}.supabase.co is IPv6-only —"
    echo "  it has no A record. If this machine or network is IPv4, use the pooler:"
    echo
    echo "      bash scripts/prod-cutover.sh --pooler${*:+ $*}"
  else
    echo "  Could not reach the pooler either. Check network access to"
    echo "  *.pooler.supabase.com:5432, then whether the project is paused."
  fi
  echo
  exit 1
fi
echo "  connected to '$OUT'"

TABLES="$("$PSQL" "$DB_URL" -tAc \
  "select count(*) from information_schema.tables where table_schema='public'")"
APPLIED="$("$PSQL" "$DB_URL" -tAc \
  "select count(*) from supabase_migrations.schema_migrations" 2>/dev/null || echo 0)"
echo "  public tables: $TABLES · migrations recorded: $APPLIED"
echo

if [[ "$MODE" == "check" ]]; then
  echo "  --check: nothing was changed."
  exit 0
fi

# ------------------------------------------------------------------- migrations
echo "── pushing migrations"
supabase db push --linked
echo

# ---------------------------------------------------------------- edge function
echo "── deploying notification-dispatch"
supabase functions deploy notification-dispatch --project-ref "$REF"

# THE ARGUMENT ORDER IS THE WHOLE WARNING.
#
# An earlier version of this message read:
#
#     select vault.create_secret('<key>', 'resend_api_key');
#
# It was wrong twice over, and Sada ran it against production on 2 Aug 2026.
# `resend_api_key` is not a Vault secret at all — it is an EDGE FUNCTION secret,
# set with `supabase secrets set`, a different mechanism entirely. And the
# signature is create_secret(VALUE, NAME), which reads backwards to anybody who
# has ever used a key-value store, so the arguments went in reversed and a live
# `sb_secret_…` key was written into vault.secrets.NAME — a column that is not
# encrypted. The value is encrypted; the name is not. That key had to be rotated.
#
# Hence: both names spelled out, the order labelled, and no placeholder that
# could be mistaken for the other field.
cat <<'VAULT'
  ── one thing left, and email is silent until it is done

  The dispatcher reads two secrets from Vault. They are NOT in this repo and
  never will be — a migration is a file in git. Without them every notification
  queues and none is delivered.

  In the SQL editor of THIS project. Note the order: value first, name second.

    select vault.create_secret(
      'https://<project-ref>.supabase.co/functions/v1/notification-dispatch',
      'notification_dispatch_url', 'set at cutover');

    select vault.create_secret(
      '<service role key>',
      'notification_dispatch_key', 'set at cutover');

  vault.secrets.name is NOT encrypted. Putting a key in the second argument
  stores it in the clear — check with:

    select name from vault.secrets;

  Both names should appear there and nothing else. If a key does, rotate it.

  RESEND_API_KEY is a different mechanism — an edge function secret:
    supabase secrets set RESEND_API_KEY=re_... --project-ref <ref>

  See docs/operations/DEPLOYMENT.md.
VAULT
echo

# --------------------------------------------------------------------- harness
if [[ "$MODE" == "harness" ]]; then
  echo "── harness"
  ROWS="$("$PSQL" "$DB_URL" -tAc \
    "select coalesce((select count(*) from public.profiles),0)
          + coalesce((select count(*) from public.organizations),0)" 2>/dev/null || echo 0)"
  if [[ "${ROWS//[[:space:]]/}" != "0" ]]; then
    echo
    echo "  REFUSING. This database holds $ROWS profile/organisation rows."
    echo "  The harness seed truncates every table it owns. Run it only against"
    echo "  an empty environment."
    echo
    exit 1
  fi
  echo "  target is empty ($ROWS rows) — safe to seed"
  DATABASE_URL="$DB_URL" bash scripts/harness.sh --allow-remote
  echo
  echo "  The harness leaves its seed data behind. Clear it before any customer"
  echo "  is provisioned:"
  echo "      bash scripts/prod-cutover.sh --check   # confirm the target first"
  echo "  then truncate, or reset the project."
fi

unset SUPABASE_DB_PASSWORD
echo "── done"
