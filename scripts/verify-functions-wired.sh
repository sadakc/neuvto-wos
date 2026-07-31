#!/usr/bin/env bash
#
# Neuvto WOS — every function we define is actually called
#
#   bash scripts/verify-functions-wired.sh
#
# WHY THIS EXISTS
#
# Three times in two build steps, a capability was written, documented, granted,
# and then called by nothing:
#
#   ensure_balance      D12 said "created lazily on first read". Nothing read.
#                       Employees saw "no leave balance yet" on a configured
#                       workspace. (D36)
#   approval_required   Shipped in the leave_types schema in step 6 and read by
#                       no code at all, so a one-person workspace could not book
#                       a single day. (D38)
#   module_enabled      The multi-tenant module boundary. Test scenario 12 says
#                       "routes AND functions refuse"; only the routes did.
#
# Plus two whose caller was supposed to be a scheduler that did not exist:
# notification-dispatch and leave_mature_balances. Nobody noticed, because a
# queue nobody drains looks exactly like a queue that is working.
#
# The common shape: the code is right, the wiring is absent, and every test
# passes because tests call the function directly. That is what this catches.
#
# SCOPED TO OUR OWN MIGRATIONS, deliberately. Asked of the database instead, it
# returns about 180 false positives from btree_gist alone — gbt_bit_penalty and
# friends are called by index operator classes, not by name. A check that cries
# wolf 180 times is a check nobody reads.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

MIGRATIONS="supabase/migrations"
FAILED=0

# ---------------------------------------------------------------- allowances
#
# A function may legitimately have no caller in this repository. Each entry says
# WHY, and an entry with no reason is not an allowance — it is a defect somebody
# has grown used to.
is_allowed() {
  case "$1" in
    # Called by CREATE TRIGGER, which names the function without parentheses in
    # a form the reference scan below already counts — listed for clarity only.
    set_audit_fields|write_audit_log) return 0 ;;

    *) return 1 ;;
  esac
}

# ---------------------------------------------------------------- the scan

# Every function our migrations create.
ALL_DEFINED=$(grep -rhoE 'create (or replace )?function public\.[a-z_]+' "$MIGRATIONS" \
              | sed -E 's/.*public\.//' | sort -u)

# ...minus the ones a LATER migration drops.
#
# Migrations are a timeline, not a snapshot. module_enabled was created in
# phase 0 and dropped in 20260801110000 once module_enabled_for replaced it,
# and this check went on demanding a caller for a function that no longer
# exists. Comparing filenames works because they are timestamp-prefixed and
# applied in exactly that order.
DEFINED=""
for fn in $ALL_DEFINED; do
  last_create=$(grep -rlE "create (or replace )?function public\.${fn}\b" "$MIGRATIONS" | sort | tail -1)
  last_drop=$(grep -rlE "drop function( if exists)? public\.${fn}\b" "$MIGRATIONS" | sort | tail -1)
  if [ -n "$last_drop" ] && [[ "$last_drop" > "$last_create" ]]; then
    continue      # dropped after its last definition — correctly gone
  fi
  DEFINED="$DEFINED $fn"
done

echo "Checking $(wc -w <<<"$DEFINED" | tr -d ' ') live functions defined in $MIGRATIONS"
echo

for fn in $DEFINED; do
  # References anywhere that is NOT this function's own definition, comment,
  # grant or drop. A function that only ever appears in its own paperwork is
  # not wired to anything.
  #
  # COMMENT LINES DO NOT COUNT. Writing "-- module_enabled: see the next
  # migration" in a header was enough to make this check declare the function
  # wired, which it emphatically was not — and it was the very function the
  # check had been written to catch. Prose about a function is not a call to it.
  #
  # Lines whose FIRST non-whitespace is a comment marker are dropped; a real
  # call carrying a trailing comment still counts, which is the behaviour we
  # want.
  # NOR DOES ASKING WHETHER IT EXISTS.
  #
  # The phase-aware harness guards its blocks with
  # `to_regprocedure('public.foo(...)') is not null`, and that probe was enough
  # to make this check call foo wired. Found by unwiring module_enabled_for
  # completely and watching the check stay green — which is the exact failure
  # this whole script exists to prevent, committed by the script itself.
  refs=$(grep -rn "\b${fn}\b" "$MIGRATIONS" src neuvto-harness supabase/functions scripts 2>/dev/null \
         | grep -v "src/integrations/supabase/types.ts" \
         | grep -vE "^[^:]+:[0-9]+:[[:space:]]*(--|//|\*|#)" \
         | grep -vE "to_regproc(edure)?\s*\(" \
         | grep -vE "(create (or replace )?function public\.${fn}\b|comment on function public\.${fn}\b|grant [^;]*public\.${fn}\b|revoke [^;]*public\.${fn}\b|drop function[^;]*public\.${fn}\b|scripts/verify-functions-wired\.sh)" \
         | wc -l | tr -d ' ')

  if [ "$refs" -eq 0 ]; then
    if is_allowed "$fn"; then
      echo "  allowed  $fn"
    else
      echo "  DEAD     $fn — defined, granted, and called by nothing"
      FAILED=1
    fi
  fi
done

echo
if [ "$FAILED" -ne 0 ]; then
  cat <<'MSG'
✖ At least one function is defined and never called.

  Either wire it up, or delete it. If it is genuinely called from outside this
  repository — a scheduler, an external job — add it to is_allowed() above WITH
  THE REASON, and add an assertion somewhere that the outside caller exists.
  "It is called by a cron job" is worth nothing if nothing checks the cron job.
MSG
  exit 1
fi

echo "✔ every function our migrations define is called by something"
