#!/usr/bin/env bash
#
# Neuvto WOS — shout when there is no recent backup
#
#   bash scripts/backup-staleness-check.sh                 alert if the newest backup is over 2 days old
#   bash scripts/backup-staleness-check.sh --max-age 7     a different threshold
#   bash scripts/backup-staleness-check.sh --max-partials 5  tolerate more failed runs before alarming
#   bash scripts/backup-staleness-check.sh --partial-window 14  count failures over a longer window
#   bash scripts/backup-staleness-check.sh --quiet         no GUI alert, exit code and stdout only
#
# WHY THIS EXISTS
#
# BACKUPS.md names the worst weakness of a laptop backup schedule, and it is not
# the laptop:
#
#   "Nothing tells you when it stops working. A scheduled backup that quietly
#    stopped is worse than no scheduled backup, because you believe in it."
#
# A launchd agent that fails every night fails silently. The machine sleeps
# through its window, the Keychain locks, the password is rotated, the disk
# fills, the script is renamed by a refactor — every one of those ends with the
# same observable state, which is nothing at all happening.
#
# WHAT THIS CHECKS, AND WHY IT IS NOT THE BACKUP JOB'S EXIT CODE
#
# It checks the ARTEFACT, never the process. It does not ask whether the backup
# job ran, or what it returned. It asks whether a restorable backup exists and
# how old it is.
#
# That distinction is the whole point, and it is not hypothetical here. On
# 17 Aug 2026 `backup-prod.sh --check` was run and reported success. It exits 0
# having DELIBERATELY written nothing — that is what --check means. The backup
# was believed to have been taken for as long as it took somebody to look in the
# directory and find the newest file was thirteen days old and contained zero
# organizations. An exit code would have confirmed the belief. A file listing
# destroyed it.
#
# So this script only ever looks at the directory.
#
# TWO THINGS THAT LOOK LIKE BACKUPS AND ARE NOT
#
#   1. A `.partial` directory. `backup-prod.sh` leaves one when verification
#      fails, precisely so a half-written dump is never mistaken for a backup.
#      Counting it here would undo that.
#
#   2. A directory with no `data.sql.gz`. `data.sql.gz` is the irreplaceable
#      file — schema is in git, roles are re-creatable, rows are not. A run that
#      produced a directory and a MANIFEST but no data is a failure that left
#      tidy wreckage.
#
# The age comes from the directory NAME, which is the backup's own UTC stamp,
# not from mtime. Anything that touches a directory — a copy, a backup of the
# backups, a stray `find -exec` — would otherwise make a stale backup look fresh.
#
set -euo pipefail

MAX_AGE_DAYS=2
MAX_PARTIALS=3
# Partials older than this stop counting as evidence of a CURRENT problem.
# They stay on disk — see the block above the count for why this window exists.
PARTIAL_WINDOW_DAYS=7
QUIET=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --max-age)       MAX_AGE_DAYS="${2:-}"; shift ;;
    --max-age=*)     MAX_AGE_DAYS="${1#--max-age=}" ;;
    --max-partials)  MAX_PARTIALS="${2:-}"; shift ;;
    --max-partials=*) MAX_PARTIALS="${1#--max-partials=}" ;;
    --partial-window) PARTIAL_WINDOW_DAYS="${2:-}"; shift ;;
    --partial-window=*) PARTIAL_WINDOW_DAYS="${1#--partial-window=}" ;;
    --quiet)     QUIET=true ;;
    -h|--help)   sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)           echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

[[ "$MAX_AGE_DAYS" =~ ^[0-9]+$ ]] || { echo "--max-age needs a number, got: $MAX_AGE_DAYS" >&2; exit 2; }
[[ "$MAX_PARTIALS" =~ ^[0-9]+$ ]] || { echo "--max-partials needs a number, got: $MAX_PARTIALS" >&2; exit 2; }
[[ "$PARTIAL_WINDOW_DAYS" =~ ^[0-9]+$ ]] || { echo "--partial-window needs a number of days, got: $PARTIAL_WINDOW_DAYS" >&2; exit 2; }

DEST_ROOT="${NEUVTO_BACKUP_DIR:-$HOME/neuvto-backups}"
PROD_DIR="$DEST_ROOT/prod"

# Raise the alarm where a person will actually meet it. A `display alert` is
# modal on purpose: this fires at most once a day and only when something is
# already wrong, so being ignorable is the failure mode to avoid. It is best
# effort — under launchd with no GUI session osascript simply fails, and the
# exit code and the log still carry the message.
alarm() {
  local title="$1" detail="$2"
  echo "BACKUP ALARM: $title" >&2
  echo "  $detail" >&2
  if [[ "$QUIET" == false ]] && command -v osascript >/dev/null 2>&1; then
    osascript -e "display alert \"$title\" message \"$detail\" as critical" >/dev/null 2>&1 || true
  fi
}

if [[ ! -d "$PROD_DIR" ]]; then
  alarm "No production backups at all" \
        "$PROD_DIR does not exist. Nothing has ever been backed up. See docs/operations/BACKUPS.md."
  exit 1
fi

# Newest first. `.partial` is excluded by the glob's shape: complete runs are
# named with a bare UTC stamp and nothing else.
NEWEST=""
while IFS= read -r dir; do
  [[ -f "$dir/data.sql.gz" ]] || continue     # a directory is not a backup
  NEWEST="$dir"
  break
done < <(find "$PROD_DIR" -mindepth 1 -maxdepth 1 -type d -name '*Z' ! -name '*.partial' | sort -r)

if [[ -z "$NEWEST" ]]; then
  PARTIALS=$(find "$PROD_DIR" -mindepth 1 -maxdepth 1 -type d -name '*.partial' | wc -l | tr -d ' ')
  detail="No complete backup in $PROD_DIR."
  (( PARTIALS > 0 )) && detail="$detail There are $PARTIALS .partial director(ies) — a run started and failed verification."
  alarm "No usable production backup" "$detail See docs/operations/BACKUPS.md."
  exit 1
fi

STAMP="$(basename "$NEWEST")"                              # 2026-08-17T053744Z
if ! THEN=$(TZ=UTC date -j -f "%Y-%m-%dT%H%M%SZ" "$STAMP" +%s 2>/dev/null); then
  alarm "Cannot read the newest backup's date" \
        "Directory '$STAMP' is not the expected UTC stamp. Check $PROD_DIR by hand."
  exit 1
fi

NOW=$(date +%s)
AGE_DAYS=$(( (NOW - THEN) / 86400 ))
AGE_HOURS=$(( (NOW - THEN) / 3600 ))

if (( AGE_DAYS > MAX_AGE_DAYS )); then
  alarm "Production backup is $AGE_DAYS days old" \
        "Newest: $STAMP (${AGE_HOURS}h ago), threshold ${MAX_AGE_DAYS}d. The scheduled backup has stopped working. Run: bash scripts/backup-prod.sh"
  exit 1
fi

# A FRESH BACKUP IS NOT THE SAME AS A HEALTHY SCHEDULE.
#
# backup-prod.sh leaves a .partial directory on every failed run, and retention
# deliberately never prunes them — deleting the evidence of a failure would be
# the wrong instinct. So they accumulate, one per failure, and nothing surfaces
# the pile.
#
# That matters because of a specific failure this schedule is exposed to:
# `supabase db dump` shells out to a container, so the backup needs the Docker
# daemon RUNNING at 03:00. A week where Docker is up on Sunday and down the
# other six nights produces one good backup and six partials — and the age check
# alone reports that as healthy, because the newest backup really is fresh.
#
# Counting partials is what tells those two situations apart.
#
# ── WHY THE COUNT HAS A WINDOW, AND DID NOT USE TO
#
# It counted every .partial in the directory, for all time. Retention never
# prunes them, on purpose. Put those two together and the alarm is a LATCH:
# after the third failure it ever has, it fires every single morning, forever,
# no matter how healthy the schedule becomes afterwards. Deleting the
# directories by hand was the only way to silence it.
#
# An alarm that always fires is not a strict improvement on no alarm. It is the
# mirror of the failure this file was written against — a backup nobody checks
# because they believe in it, versus an alarm nobody reads because it always
# shouts. Both end with somebody discovering the truth on the worst day.
#
# So: old failures stay on disk as evidence, and stop being counted as evidence
# of a problem happening NOW. The window comes from each directory's own UTC
# stamp, not its mtime, for the same reason the age check does.
PARTIALS_ALL=$(find "$PROD_DIR" -mindepth 1 -maxdepth 1 -type d -name '*.partial' 2>/dev/null | wc -l | tr -d ' ')
CUTOFF=$(( NOW - PARTIAL_WINDOW_DAYS * 86400 ))
PARTIALS=0
while IFS= read -r d; do
  [[ -n "$d" ]] || continue
  pstamp="$(basename "$d" .partial)"
  # A directory whose name is not a stamp cannot be dated. Count it rather than
  # skip it: an uncountable failure is the thing this alarm exists to notice.
  if pthen=$(TZ=UTC date -j -f "%Y-%m-%dT%H%M%SZ" "$pstamp" +%s 2>/dev/null); then
    (( pthen >= CUTOFF )) && PARTIALS=$(( PARTIALS + 1 ))
  else
    PARTIALS=$(( PARTIALS + 1 ))
  fi
done < <(find "$PROD_DIR" -mindepth 1 -maxdepth 1 -type d -name '*.partial' 2>/dev/null)

OLDER=$(( PARTIALS_ALL - PARTIALS ))

if (( PARTIALS >= MAX_PARTIALS )); then
  detail="Newest is only ${AGE_HOURS}h old, but $PARTIALS run(s) failed in the last ${PARTIAL_WINDOW_DAYS} days (.partial in $PROD_DIR). Something fails most nights — check $DEST_ROOT/backup.log. Docker must be running at 03:00, and the network must be up."
  (( OLDER > 0 )) && detail="$detail ($OLDER older failure(s) on disk are not counted.)"
  alarm "Backups are mostly failing" "$detail"
  exit 1
fi

if (( PARTIALS_ALL > 0 )); then
  echo "backup-staleness-check: ok — newest $STAMP, ${AGE_HOURS}h old, threshold ${MAX_AGE_DAYS}d"
  echo "  note: $PARTIALS failed run(s) in the last ${PARTIAL_WINDOW_DAYS}d — alarm at $MAX_PARTIALS ($PARTIALS_ALL on disk in total)"
  exit 0
fi

echo "backup-staleness-check: ok — newest $STAMP, ${AGE_HOURS}h old, threshold ${MAX_AGE_DAYS}d"
