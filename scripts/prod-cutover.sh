#!/usr/bin/env bash
#
# Neuvto WOS — bring a Supabase project up to this repo's schema
#
#   bash scripts/prod-cutover.sh              push migrations, deploy functions
#   bash scripts/prod-cutover.sh --check      connect and report, change nothing
#   bash scripts/prod-cutover.sh --repair     clear ledger rows with no local file, then push
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
REPAIR=false
for arg in "$@"; do
  case "$arg" in
    --check)   MODE="check" ;;
    --harness) MODE="harness" ;;
    --pooler)  POOLER=true ;;
    --repair)  REPAIR=true ;;
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

# ────────────────────────────────────────────────────── the ledger, both ways
#
# `supabase db push` compares local files against the remote ledger and refuses
# when they disagree in BOTH directions. That is the state this project reached
# on 4 Aug 2026 and it is worth understanding rather than working around.
#
# Six migrations had been applied straight to production — by the dashboard, or
# by an MCP tool, both of which stamp their own timestamp — and then committed
# to the repo later under different, later versions. The SQL had run; the ledger
# recorded it under a version git has never heard of. So:
#
#   remote has 6 versions with no local file  ─┐ push cannot tell which side is
#   local has 6 files not in the remote ledger ┘ authoritative, so it stops
#
# The CLI's own remedy is `supabase migration repair`, which is the right idea
# and the wrong ergonomics here: run bare it has no password and fails with
# "Connect to your database by setting the env var correctly:
# SUPABASE_DB_PASSWORD". This script already holds a connection that works, so
# the repair belongs here.
#
# NOTE THE ASYMMETRY, because it is the safety property. Only versions with NO
# LOCAL FILE are ever removed, and nothing is applied or dropped in the schema —
# this edits the ledger alone. A version that HAS a local file is never touched,
# so this can never make `push` skip a migration that has not run.
LOCAL_VERSIONS="$(ls supabase/migrations/*.sql 2>/dev/null | sed 's|.*/||; s|_.*||' | sort -u)"
PHANTOM="$("$PSQL" "$DB_URL" -tAc \
  "select version from supabase_migrations.schema_migrations order by version" 2>/dev/null \
  | tr -d ' ' | grep -v '^$' | grep -Fxv -f <(printf '%s\n' "$LOCAL_VERSIONS") || true)"

if [[ -n "$PHANTOM" ]]; then
  COUNT="$(printf '%s\n' "$PHANTOM" | wc -l | tr -d ' ')"
  echo "  ⚠  LEDGER DIVERGENCE — $COUNT version(s) recorded on the remote with no local file:"
  while IFS= read -r v; do
    NAME="$("$PSQL" "$DB_URL" -tAc \
      "select name from supabase_migrations.schema_migrations where version = '$v'" 2>/dev/null | tr -d ' ')"
    printf "       %s  %s\n" "$v" "${NAME:-(no name recorded)}"
  done <<<"$PHANTOM"
  echo
  echo "     Their SQL has run. Only the version numbers are wrong — they were"
  echo "     applied outside this repo and committed later under other names."
  echo "     \`supabase db push\` will refuse until the ledger agrees with git."
  echo
fi

if [[ "$MODE" == "check" ]]; then
  [[ -n "$PHANTOM" ]] && echo "     Clear them with: bash scripts/prod-cutover.sh --repair" && echo
  echo "  --check: nothing was changed."
  exit 0
fi

if [[ "$REPAIR" == true ]]; then
  if [[ -z "$PHANTOM" ]]; then
    echo "── repair: the ledger already agrees with git. Nothing to do."
    echo
  else
    echo "── repair"
    echo "     This DELETES the $COUNT row(s) above from supabase_migrations.schema_migrations."
    echo "     It runs no DDL: your tables, functions and data are untouched."
    echo "     Afterwards the local files re-apply and re-record under git's versions."
    echo
    printf '     Type "repair" to continue: '
    read -r reply
    if [[ "$reply" != "repair" ]]; then
      echo "     Nothing was changed."
      exit 1
    fi
    while IFS= read -r v; do
      "$PSQL" "$DB_URL" -q -c \
        "delete from supabase_migrations.schema_migrations where version = '$v'" >/dev/null
      echo "     removed $v"
    done <<<"$PHANTOM"
    echo
  fi
elif [[ -n "$PHANTOM" ]]; then
  echo "  REFUSING TO PUSH while the ledger disagrees with git."
  echo "  \`supabase db push\` would fail anyway; this says why first."
  echo
  echo "      bash scripts/prod-cutover.sh --repair"
  echo
  echo "  Read the list above before running it. Every one of those should be a"
  echo "  migration whose content you can find in supabase/migrations under a"
  echo "  different version. If any name is unfamiliar, stop — that is schema on"
  echo "  production that exists nowhere in git, and deleting its ledger row"
  echo "  would hide it rather than fix it."
  echo
  exit 1
fi

# ─────────────────────────────────────────── functions a replay cannot replace
#
# The second thing that stopped the 4 Aug cutover, after the ledger.
#
# `create or replace function` is idempotent re-run against the SAME state. It is
# NOT idempotent when the current state is a LATER version with a different
# signature — Postgres refuses to change a function's return type, and says so
# in a way the CLI reports only as "Failed to execute statement".
#
# That is exactly what a repaired replay produces. Production held
# `leave_taken_report` with 13 columns, from the decision-note migration.
# Replaying the migrations in order starts with the 12-column version that
# preceded it, which is a downgrade, and the push died on statement 4.
#
# The end state was never in doubt: replaying both migrations lands on the same
# 13 columns production already had. Only the intermediate step is impossible.
# Dropping first makes the sequence replayable — the very next statements
# recreate it, and the migrations that follow bring it to its final shape.
#
# Checked before it was trusted: every one of these functions had zero dependent
# objects, so nothing cascades, and production held no customer data at the time.
# If either stops being true, read this again before running it.
if [[ "$REPAIR" == true ]]; then
  PENDING_FNS="$(
    for f in supabase/migrations/*.sql; do
      v="$(basename "$f" | cut -d_ -f1)"
      "$PSQL" "$DB_URL" -tAc \
        "select 1 from supabase_migrations.schema_migrations where version='$v'" 2>/dev/null \
        | grep -q 1 && continue
      grep -oE 'create or replace function public\.[a-z_]+' "$f" | sed 's/.*public\.//'
    done | sort -u
  )"

  DROPPABLE=""
  while IFS= read -r fn; do
    [[ -z "$fn" ]] && continue
    SIGS="$("$PSQL" "$DB_URL" -tAc "
      select 'public.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = '$fn'" 2>/dev/null | sed '/^$/d')"
    [[ -n "$SIGS" ]] && DROPPABLE="${DROPPABLE}${SIGS}"$'\n'
  done <<<"$PENDING_FNS"
  DROPPABLE="$(printf '%s' "$DROPPABLE" | sed '/^$/d')"

  if [[ -n "$DROPPABLE" ]]; then
    echo "── functions the replay will recreate"
    echo "     These already exist, and the migrations about to run redefine them."
    echo "     Any whose signature the replay would SHRINK will refuse to replace,"
    echo "     so they are dropped and immediately recreated by the push:"
    echo
    printf '       %s\n' $(printf '%s\n' "$DROPPABLE")
    echo
    DEPS="$("$PSQL" "$DB_URL" -tAc "
      select count(*) from pg_depend d
        join pg_proc p on p.oid = d.refobjid
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname='public' and d.deptype='n'
         and p.proname = any(string_to_array('$(printf '%s' "$PENDING_FNS" | tr '\n' ',' | sed 's/,$//')', ','))" 2>/dev/null || echo 0)"
    echo "     dependent objects: ${DEPS:-0}  (anything above 0 would cascade — stop and look)"
    echo
    if [[ "${DEPS:-0}" != "0" ]]; then
      echo "  REFUSING: something depends on these. Dropping would take it with them." >&2
      exit 1
    fi
    printf '     Type "drop" to continue: '
    read -r reply
    [[ "$reply" == "drop" ]] || { echo "     Nothing was changed."; exit 1; }
    while IFS= read -r sig; do
      [[ -z "$sig" ]] && continue
      "$PSQL" "$DB_URL" -q -c "drop function if exists $sig" >/dev/null
      echo "     dropped $sig"
    done <<<"$DROPPABLE"
    echo
  fi
fi

# ------------------------------------------------------------------- migrations
echo "── pushing migrations"
supabase db push --linked
echo

# --------------------------------------------------------- notification templates
#
# Asked HERE, against production, and not left to the harness.
#
# On 6 Aug 2026 `notification_templates` was empty in production. Every
# notification the product sends — approval.submitted, approval.decided,
# approval.completed, member.invited — failed with NO_TEMPLATE and zero
# delivery attempts. It was found by a customer's first invitation not
# arriving, roughly a week after it broke.
#
# The harness could never have caught it. The harness runs against a local
# database it seeds itself, where the templates are restored by the seed on
# every run. Only production was missing them, and only production is asked.
#
# The question is the migration's own function, so this cannot drift from
# what verify_invariants.sql asserts.
echo "── verifying notification templates"
if MISSING="$("$PSQL" "$DB_URL" -tAc \
      "select array_to_string(public.missing_system_notification_templates(), ', ')" 2>/dev/null)"; then
  MISSING="${MISSING//[[:space:]]/}"
  if [[ -n "$MISSING" ]]; then
    echo
    echo "  FAILED: no active system template for: $MISSING" >&2
    echo "  Every notification for these events will fail with NO_TEMPLATE and" >&2
    echo "  send nothing, without raising anything anywhere. Repair with:" >&2
    echo >&2
    echo "      select public.ensure_system_notification_templates();" >&2
    echo >&2
    exit 1
  fi
  echo "  all four system templates present"
else
  # Pre-20260814100000 database, or the push did not land. Say which rather
  # than reporting a pass for a question that was never answered.
  echo "  CANNOT CHECK: missing_system_notification_templates() is not installed." >&2
  echo "  That function ships in 20260814100000 — if the push above succeeded," >&2
  echo "  this is a real failure and not an old database." >&2
  exit 1
fi
echo

# ---------------------------------------------------------------- edge functions
echo "── deploying notification-dispatch"
supabase functions deploy notification-dispatch --project-ref "$REF"

# The public error channel. `verify_jwt = false` comes from config.toml, which
# `functions deploy` reads — do NOT pass --no-verify-jwt here instead, or the
# setting lives in two places and the file stops being the truth.
#
# It must be public: every caller it exists for is somebody who cannot sign in.
# Deployed with the default verify_jwt it returns 401 to all of them and records
# nothing, which is indistinguishable from the blind spot it closes. See the
# header of supabase/functions/client-error/index.ts.
echo "── deploying client-error"
supabase functions deploy client-error --project-ref "$REF"

# The public demo form. Also verify_jwt = false, from config.toml — see the
# comment on client-error above, which applies unchanged.
echo "── deploying demo-request"
supabase functions deploy demo-request --project-ref "$REF"

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
# ANGLE BRACKETS GET PASTED. Twice now.
#
# The first version of this message used '<service role key>'. Sada replaced the
# words and kept the brackets, storing `<sb_secret_…>` — 43 characters where 41
# were wanted. It resolves, it looks set, and every delivery would have sent a
# malformed Authorization header and 401'd silently.
#
# So: the URL is printed fully resolved, because this script knows the ref and a
# placeholder it can fill in itself is a placeholder it should not print. The key
# cannot be filled in — nothing here should ever hold it — so its marker is a
# bare word with no punctuation to leave behind, and the message ends with the
# check that catches a bad paste rather than trusting the paste.
cat <<VAULT
  ── one thing left, and email is silent until it is done

  The dispatcher reads two secrets from Vault. They are NOT in this repo and
  never will be — a migration is a file in git. Without them every notification
  queues and none is delivered.

  In the SQL editor of THIS project. The order is value first, name second —
  which reads backwards, and vault.secrets.name is NOT encrypted, so getting it
  the wrong way round writes your key into a plaintext column.

    select vault.create_secret(
      'https://${REF}.supabase.co/functions/v1/notification-dispatch',
      'notification_dispatch_url', 'set at cutover');

    select vault.create_secret(
      PASTE_KEY_HERE,
      'notification_dispatch_key', 'set at cutover');

  Replace PASTE_KEY_HERE with the key in single quotes and nothing else:
  no angle brackets, no spaces. It is 41 characters and starts sb_secret_.

  ── then verify, because every way of getting this wrong still looks set

    select name,
           public.platform_secret(name) is not null as resolves,
           case name
             when 'notification_dispatch_key'
               then public.platform_secret(name) like 'sb_secret_%'
             when 'notification_dispatch_url'
               then public.platform_secret(name)
                    = 'https://${REF}.supabase.co/functions/v1/notification-dispatch'
           end as correct
      from vault.secrets order by name;

  Two rows, both true, and no third row. A key listed under 'name' is a key in
  the clear — issue a replacement, delete the exposed one, and set it again.
  There is no rotate button on an sb_secret_… key: Project Settings → API Keys
  only creates and deletes, and doing both IS the rotation.

  RESEND_API_KEY is a different mechanism — an edge function secret:
    supabase secrets set RESEND_API_KEY=re_... --project-ref ${REF}

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
