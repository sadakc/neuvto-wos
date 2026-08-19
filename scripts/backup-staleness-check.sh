#!/usr/bin/env bash
#
# Neuvto WOS — shout when there is no recent backup
#
#   bash scripts/backup-staleness-check.sh                 alert if the newest backup is over 2 days old
#   bash scripts/backup-staleness-check.sh --max-age 7     a different threshold
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
QUIET=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --max-age)   MAX_AGE_DAYS="${2:-}"; shift ;;
    --max-age=*) MAX_AGE_DAYS="${1#--max-age=}" ;;
    --quiet)     QUIET=true ;;
    -h|--help)   sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)           echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

[[ "$MAX_AGE_DAYS" =~ ^[0-9]+$ ]] || { echo "--max-age needs a number, got: $MAX_AGE_DAYS" >&2; exit 2; }

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

echo "backup-staleness-check: ok — newest $STAMP, ${AGE_HOURS}h old, threshold ${MAX_AGE_DAYS}d"
