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

# THE SECOND THING A SCHEDULE CANNOT RUN WITHOUT: a usable PATH.
#
# launchd does NOT give a job your shell's environment. It runs with a minimal
# PATH that excludes both Homebrew and /usr/local/bin, so the tools the backup
# needs are simply not found and it exits before doing anything useful.
#
# This is not hypothetical. Installing this schedule on 20 Aug 2026 failed twice
# in a row, one layer at a time:
#
#   1. "supabase CLI not found"    — /opt/homebrew/bin was missing
#   2. "failed to run docker"      — /usr/local/bin was missing, where Docker
#                                    Desktop symlinks its CLI. `supabase db dump`
#                                    shells out to a container.
#
# Both would have failed silently every night at 03:00. They were caught in
# minutes only because the alarm was installed alongside the backup, which is
# the entire argument for the alarm.
#
# So every tool is RESOLVED here, from the shell that demonstrably works, and
# the directories are baked into the plists. Resolved rather than hardcoded:
# /opt/homebrew is an Apple-silicon default and /usr/local/bin is where Docker
# happens to land, neither of which is a guarantee on another machine.
REQUIRED_TOOLS=(supabase docker)      # backup-prod.sh needs both: supabase db dump uses a container
OPTIONAL_TOOLS=(psql)                 # backup-prod.sh has its own libpq fallback

AGENT_PATH=""
MISSING=()

add_dir() {
  local dir="$1"
  [[ -z "$dir" ]] && return
  case ":$AGENT_PATH:" in *":$dir:"*) return ;; esac      # no duplicates
  AGENT_PATH="${AGENT_PATH:+$AGENT_PATH:}$dir"
}

for tool in "${REQUIRED_TOOLS[@]}"; do
  bin="$(command -v "$tool" || true)"
  if [[ -z "$bin" ]]; then MISSING+=("$tool"); else add_dir "$(dirname "$bin")"; fi
done

if (( ${#MISSING[@]} )); then
  cat >&2 <<MSG
REFUSED — not on PATH: ${MISSING[*]}

backup-prod.sh needs all of these, and a scheduled job that cannot find one
fails every night. Install them, confirm each runs in this shell, and run this
script again.
MSG
  exit 1
fi

for tool in "${OPTIONAL_TOOLS[@]}"; do
  bin="$(command -v "$tool" || true)"
  [[ -n "$bin" ]] && add_dir "$(dirname "$bin")"
done
[[ -x /opt/homebrew/opt/libpq/bin/psql ]] && add_dir /opt/homebrew/opt/libpq/bin

for d in /usr/bin /bin /usr/sbin /sbin; do add_dir "$d"; done

# Docker being INSTALLED is not the same as Docker RUNNING, and 03:00 is exactly
# when it might not be. This cannot be fixed from here — it is a real fragility
# of backing up through a CLI that shells out to a container. Say so now rather
# than let it be discovered from an empty backup directory.
if ! docker info >/dev/null 2>&1; then
  echo "  WARNING: the Docker daemon is not running. It must be running at 03:00" >&2
  echo "           or the backup will fail. The alarm will tell you if it does." >&2
fi

mkdir -p "$AGENTS" "$LOG_DIR"

cat > "$AGENTS/$BACKUP_LABEL.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$BACKUP_LABEL</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>$AGENT_PATH</string>
  </dict>
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
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>$AGENT_PATH</string>
  </dict>
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

Two things worth doing once, now:

  1. Run the backup THROUGH launchd, which is the only way to find out whether
     the scheduled path works rather than the script:
         launchctl kickstart -k gui/$UID/com.neuvto.backup
         tail -f ~/neuvto-backups/backup.log
     A Keychain prompt may appear the first time — click Always Allow. This is
     the step that catches an environment the agent does not have; running the
     script by hand proves nothing about 03:00.

  2. Watch the alarm fire, so you know what it looks like before it matters:
         bash scripts/backup-staleness-check.sh --max-age 0
     That should raise a modal dialog. If it does not, the exit code and
     ~/neuvto-backups/backup-check.log still carry the message, but you would
     have to go and look — which is the thing this was built to avoid.
MSG
