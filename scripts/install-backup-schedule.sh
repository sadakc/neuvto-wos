#!/usr/bin/env bash
#
# Neuvto WOS — install the daily backup and the alarm that watches it
#
#   bash scripts/install-backup-schedule.sh            install and start both agents
#   bash scripts/install-backup-schedule.sh --status   what is installed and when it last ran
#   bash scripts/install-backup-schedule.sh --remove   unload and delete both agents
#
# WHY TWO AGENTS AND NOT ONE
#
# The first takes the backup. The second checks that a backup exists, and it
# exists because the first one cannot be trusted to report its own failure.
#
# A launchd job that fails every night fails silently: nothing mails you, the
# exit code goes to a log nobody opens, and the observable state is identical to
# a job that is working. BACKUPS.md names this as the worst weakness of a laptop
# schedule — "a scheduled backup that quietly stopped is worse than no scheduled
# backup, because you believe in it."
#
# So the alarm never asks the backup job how it went. It looks in the directory.
# That is deliberate: on 17 Aug 2026 `backup-prod.sh --check` was reported as a
# successful backup. It exits 0 having written nothing on purpose, and the belief
# survived until somebody listed the directory and found the newest file was
# thirteen days old with zero organizations in it.
#
# WHAT THIS DOES NOT FIX
#
# A laptop that is off all week produces no backups, and the alarm can only fire
# once it is on again. This is a stopgap with a known ceiling, not a backup
# service. The answer is Supabase Pro's daily backups on the day there is revenue
# to pay for them — BACKUPS.md § When to move to Pro.
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGENTS="$HOME/Library/LaunchAgents"
LOG_DIR="${NEUVTO_BACKUP_DIR:-$HOME/neuvto-backups}"
BACKUP_LABEL="com.neuvto.backup"
CHECK_LABEL="com.neuvto.backup-check"
KEYCHAIN_SERVICE="neuvto-prod-db"

MODE="install"
[[ "${1:-}" == "--status" ]] && MODE="status"
[[ "${1:-}" == "--remove" ]] && MODE="remove"

# `load`/`unload` are deprecated; bootstrap/bootout is the supported pair. Fall
# back quietly, because the deprecated form still works and a hard failure here
# would be worse than a warning.
boot_out() { launchctl bootout "gui/$UID/$1" 2>/dev/null || launchctl unload "$AGENTS/$1.plist" 2>/dev/null || true; }
boot_in()  { launchctl bootstrap "gui/$UID" "$AGENTS/$1.plist" 2>/dev/null || launchctl load "$AGENTS/$1.plist" 2>/dev/null || return 1; }

if [[ "$MODE" == "status" ]]; then
  for label in "$BACKUP_LABEL" "$CHECK_LABEL"; do
    if [[ -f "$AGENTS/$label.plist" ]]; then
      state=$(launchctl list 2>/dev/null | awk -v l="$label" '$3==l {print "loaded (last exit " $2 ")"}')
      echo "  $label — installed, ${state:-NOT loaded}"
    else
      echo "  $label — not installed"
    fi
  done
  echo
  bash "$REPO/scripts/backup-staleness-check.sh" --quiet || true
  exit 0
fi

if [[ "$MODE" == "remove" ]]; then
  for label in "$BACKUP_LABEL" "$CHECK_LABEL"; do
    boot_out "$label"
    rm -f "$AGENTS/$label.plist"
    echo "  removed $label"
  done
  echo
  echo "Backups are no longer scheduled. Nothing will tell you that."
  exit 0
fi

# ── install

# The password is Sada's and never passes through this script, a file, or a
# chat. All this does is refuse to install a schedule that cannot possibly run.
if ! security find-generic-password -s "$KEYCHAIN_SERVICE" >/dev/null 2>&1; then
  cat >&2 <<MSG
REFUSED — no Keychain item '$KEYCHAIN_SERVICE'.

The unattended backup reads the production database password from the macOS
Keychain. Without it every scheduled run would fail, and the alarm would tell
you so every day. Create it first — this prompts for the password and stores it
encrypted at rest:

    security add-generic-password -a "\$USER" -s $KEYCHAIN_SERVICE -w

Then run this script again.
MSG
  exit 1
fi

mkdir -p "$AGENTS" "$LOG_DIR"

cat > "$AGENTS/$BACKUP_LABEL.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$BACKUP_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$REPO/scripts/backup-prod.sh</string>
    <string>--keychain</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>StartCalendarInterval</key><dict>
    <key>Hour</key><integer>3</integer><key>Minute</key><integer>0</integer>
  </dict>
  <key>RunAtLoad</key><false/>
  <key>StandardOutPath</key><string>$LOG_DIR/backup.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/backup.log</string>
</dict></plist>
PLIST

# 10:00, not 03:05. The alarm is useless at an hour nobody is awake for: a modal
# dialog raised at three in the morning is dismissed on autopilot at nine. It
# also gives a missed 03:00 run the whole morning to fire on wake first.
cat > "$AGENTS/$CHECK_LABEL.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$CHECK_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$REPO/scripts/backup-staleness-check.sh</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>StartCalendarInterval</key><dict>
    <key>Hour</key><integer>10</integer><key>Minute</key><integer>0</integer>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$LOG_DIR/backup-check.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/backup-check.log</string>
</dict></plist>
PLIST

for label in "$BACKUP_LABEL" "$CHECK_LABEL"; do
  boot_out "$label"
  boot_in "$label" || { echo "Could not load $label — check $AGENTS/$label.plist" >&2; exit 1; }
  echo "  installed and loaded  $label"
done

cat <<MSG

  backup   $BACKUP_LABEL     daily 03:00   -> $LOG_DIR/backup.log
  alarm    $CHECK_LABEL   daily 10:00   -> $LOG_DIR/backup-check.log

The alarm ran once just now (RunAtLoad). Current state:
MSG
bash "$REPO/scripts/backup-staleness-check.sh" --quiet || true

cat <<'MSG'

Two things worth doing once, today:

  1. Watch the alarm fire, so you know what it looks like before it matters:
         bash scripts/backup-staleness-check.sh --max-age 0
     That should raise a modal dialog. If it does not, the exit code and
     ~/neuvto-backups/backup-check.log still carry the message, but you will
     have to go and look — which is the thing this was built to avoid.

  2. Take a backup by hand tonight and check backup.log tomorrow. A schedule
     nobody has seen produce a file is a belief, not a backup.
MSG
