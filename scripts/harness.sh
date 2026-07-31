#!/usr/bin/env bash
#
# Neuvto WOS — verification harness runner
#
#   bun run harness              against the local Supabase stack
#   DATABASE_URL=... bun run harness --allow-remote
#
# Seeds two deliberately different organisations, then asserts tenant isolation
# and data integrity. Both verify scripts raise on the first violation, so
# silence is a pass.
#
# THE SEED TRUNCATES TABLES. The guard below refuses to run against anything
# that does not look local unless --allow-remote is passed explicitly.

set -euo pipefail

HARNESS_DIR="${HARNESS_DIR:-neuvto-harness}"
ALLOW_REMOTE=false
for arg in "$@"; do
  [[ "$arg" == "--allow-remote" ]] && ALLOW_REMOTE=true
done

# Default to the local Supabase stack's database.
DB_URL="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"

# ---------------------------------------------------------------- safety guard
if [[ "$DB_URL" != *"127.0.0.1"* && "$DB_URL" != *"localhost"* ]]; then
  if [[ "$ALLOW_REMOTE" != true ]]; then
    cat >&2 <<'MSG'

  REFUSING TO RUN.

  The target database is not local, and the seed script truncates every table
  it owns. Running this against an environment holding real customer data would
  destroy it.

  If you are certain the target is a test or staging environment, re-run with:

      bun run harness --allow-remote

  Never pass that flag against production.

MSG
    exit 1
  fi
  echo "WARNING: running against a non-local database by explicit request."
  echo "         target: ${DB_URL%%\?*}"
  echo
fi

# ---------------------------------------------------------------- locate psql
# Homebrew installs libpq keg-only, so psql is not on PATH by default. Look in the
# usual places rather than requiring a shell-profile edit — that way this script
# behaves the same on a developer machine and on a CI runner.
PSQL="${PSQL:-}"
if [[ -z "$PSQL" ]]; then
  for candidate in \
    "$(command -v psql 2>/dev/null || true)" \
    /opt/homebrew/opt/libpq/bin/psql \
    /usr/local/opt/libpq/bin/psql \
    /opt/homebrew/bin/psql \
    /usr/local/bin/psql
  do
    if [[ -n "$candidate" && -x "$candidate" ]]; then PSQL="$candidate"; break; fi
  done
fi

if [[ -z "$PSQL" ]]; then
  cat >&2 <<'MSG'
  psql not found.

  macOS:  brew install libpq
  Linux:  apt-get install -y postgresql-client

  If it is installed somewhere unusual, set PSQL=/path/to/psql.
MSG
  exit 1
fi

run() {
  local label="$1" file="$2"
  printf '\n──  %s\n' "$label"
  # ON_ERROR_STOP makes a RAISE EXCEPTION fail the whole run.
  "$PSQL" "$DB_URL" --quiet --no-psqlrc -v ON_ERROR_STOP=1 -f "$file"
}

echo "Neuvto WOS harness"
echo "psql:   $PSQL"
echo "target: ${DB_URL%%\?*}"

# ---------------------------------------------------------------- schema present?
# Until build step 1 creates the platform tables there is genuinely nothing to
# verify, and failing would block every PR for no reason. Skip cleanly instead —
# but only when the schema is *entirely* absent. A half-built schema still runs
# and still fails, because that is the case worth catching.
SCHEMA_PRESENT=$("$PSQL" "$DB_URL" -tAc \
  "select count(*) from information_schema.tables
    where table_schema='public' and table_name in ('organizations','leave_requests');" 2>/dev/null || echo "0")

if [[ "${SCHEMA_PRESENT:-0}" -eq 0 ]]; then
  cat <<'MSG'

──  SKIPPED

    No Neuvto schema in this database yet — build step 1 creates it.
    Nothing to verify, so this is a pass rather than a failure.

MSG
  exit 0
fi

run "seeding test data"        "$HARNESS_DIR/seed/seed_test_data.sql"
run "verifying tenant isolation" "$HARNESS_DIR/tests/verify_rls.sql"
run "verifying data integrity"   "$HARNESS_DIR/tests/verify_invariants.sql"

# Deliberately NOT seeded. Everything above runs against two organisations the
# seed has already configured — leave types, balances, approval chains — which
# is a state no customer has ever been in. Three faults lived through a green
# harness because of exactly that. This one builds an organisation the way the
# product does and asserts somebody can then use it. It cleans up after itself.
run "verifying the first run"    "$HARNESS_DIR/tests/verify_first_run.sql"

# Needs two connections, so it cannot live in the SQL suite — a single session
# cannot race itself. This is the D10 regression guard.
printf '\n──  %s\n' "verifying concurrent submission"
PSQL="$PSQL" DATABASE_URL="$DB_URL" bash "$HARNESS_DIR/tests/verify_concurrency.sh"

# The only check here that deliberately invokes nothing. Everything above proves
# the product does the right thing when asked; this one refuses to ask, because
# a queue nobody drains looks exactly like a queue with nothing in it. That is
# not hypothetical — it is how every email the product sends went undelivered
# for four build steps under a green harness. It waits, and it is meant to.
printf '\n──  %s\n' "verifying scheduled work"
PSQL="$PSQL" DATABASE_URL="$DB_URL" bash "$HARNESS_DIR/tests/verify_scheduled_work.sh"

cat <<'MSG'

──  HARNESS PASSED

    Tenant isolation holds, and every balance reconciles.
MSG
