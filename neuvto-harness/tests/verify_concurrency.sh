#!/usr/bin/env bash
# D10 — two submissions racing for a balance that covers exactly one.
#
# Separate from the SQL suite because it needs two real connections. A single
# session cannot race itself, and the build spec is explicit that this "cannot
# be verified by hand".
#
# The two date ranges are deliberately NON-overlapping. If they overlapped, the
# D18 exclusion constraint would reject the loser and this would pass whether or
# not the balance was ever protected — green, and proving nothing.
#
# Three independent mechanisms defend the invariant, which was discovered by
# sabotage rather than by design:
#
#   1. leave_submit locks the balance FOR UPDATE before validating (D10)
#   2. ensure_balance's INSERT ... ON CONFLICT blocks on a concurrently updated
#      row — accidental, and it was silently doing the work
#   3. the balance_not_overdrawn CHECK makes the bad state unrepresentable (D31)
#
# Removing any one leaves the invariant holding. Removing all three produced a
# real overdraw: two accepted requests, reserved 6 against entitled 3,
# available_days at -3. That is what makes this test non-vacuous.
set -uo pipefail

PSQL="${PSQL:-psql}"
DB_URL="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"

PRIYA=00000000-0000-0000-0000-00000000a006
CASUAL=00000000-0000-0000-0000-0000000000c1
ACME=00000000-0000-0000-0000-0000000000a0

if ! "$PSQL" "$DB_URL" -tAc "select to_regprocedure('public.leave_submit(uuid,date,date,text)')" \
     2>/dev/null | grep -q leave_submit; then
  echo "    skipped — the leave module is not built in this database"
  exit 0
fi

# The two windows are CHOSEN, not hardcoded.
#
# They used to be a fixed +60 and +90. Both assumptions in that were wrong on
# some days of the year and correct on most, which is the worst way for a test
# to be wrong:
#
#   * +60 has to contain a working day at all. Run on 3 Aug 2026 it lands on
#     2 Oct — Gandhi Jayanti in the seed — followed by a Saturday and a Sunday,
#     so the window held nothing and the whole harness failed on a date.
#   * the two windows have to contain the SAME number of working days. The
#     balance is set from the first and both requests are meant to be exactly
#     affordable alone; if the second window were shorter it would fit in what
#     the first left behind, and the race would pass without ever being run.
#
# So: the first pair of non-overlapping three-day windows, at least ten days
# apart, with equal and non-zero working days. Nothing about the race depends on
# which pair — only that both are affordable alone and not together.
read -r OFF_A OFF_B W <<<"$("$PSQL" "$DB_URL" -tAF' ' -c "
  with w as (
    select g as off,
           public.calculate_working_days('$ACME',
             public.org_today('$ACME') + g, public.org_today('$ACME') + g + 2) as d
      from generate_series(60, 240) g
  )
  select a.off, b.off, a.d
    from w a join w b on b.off >= a.off + 10 and b.d = a.d
   where a.d > 0
   order by a.off, b.off
   limit 1;")"

if [[ -z "${W:-}" || "$W" == "0" ]]; then
  echo "    FAILED — no two comparable windows with working days, so the race would be untestable"
  exit 1
fi

# A balance that covers exactly one of the two requests.
"$PSQL" "$DB_URL" -q -c "
  delete from leave_requests where employee_id = '$PRIYA';
  update leave_balances
     set entitled_days = $W, carryforward_days = 0, used_days = 0,
         reserved_days = 0, pending_days = 0
   where employee_id = '$PRIYA' and leave_type_id = '$CASUAL';" >/dev/null

submit() {  # $1 = day offset, $2 = seconds to hold the transaction open
  "$PSQL" "$DB_URL" -q -tA <<SQL >/dev/null 2>&1
select set_config('role','authenticated',false);
select set_config('request.jwt.claims', json_build_object('sub','$PRIYA','role','authenticated')::text, false);
begin;
select public.leave_submit('$CASUAL', public.org_today('$ACME') + $1, public.org_today('$ACME') + $(($1 + 2)), 'race');
select pg_sleep($2);
commit;
SQL
}

# A holds the row open; B arrives while it is still uncommitted.
submit "$OFF_A" 3 &
sleep 1
submit "$OFF_B" 0 &
wait

ACCEPTED=$("$PSQL" "$DB_URL" -tAc \
  "select count(*) from leave_requests where employee_id = '$PRIYA';" | tr -d '[:space:]')
AVAILABLE=$("$PSQL" "$DB_URL" -tAc \
  "select available_days from leave_balances
    where employee_id = '$PRIYA' and leave_type_id = '$CASUAL';" | tr -d '[:space:]')

"$PSQL" "$DB_URL" -q -c "delete from leave_requests where employee_id = '$PRIYA';" >/dev/null

if [[ "$ACCEPTED" == "1" ]]; then
  echo "    ok: exactly one of two racing submissions won (available_days = $AVAILABLE)"
else
  echo "    D10 FAIL: $ACCEPTED submissions were accepted against a balance for one."
  echo "              available_days = $AVAILABLE. The balance was overdrawn."
  exit 1
fi
