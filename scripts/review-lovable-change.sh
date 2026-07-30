#!/usr/bin/env bash
# Gathers the same facts about a Lovable pull request every time, so the review
# does not depend on what anybody happens to remember on the day.
#
#   bash scripts/review-lovable-change.sh 42
#
# It reports. It does not decide and it does not merge — the go-ahead is a human
# act. The mechanical limits are enforced separately by the lovable-gate job.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1
PR="${1:-}"

if [ -z "$PR" ]; then
  echo "usage: bash scripts/review-lovable-change.sh <pr-number>" >&2
  exit 2
fi

BASE=$(gh pr view "$PR" --json baseRefName -q .baseRefName 2>/dev/null || echo main)
HEAD=$(gh pr view "$PR" --json headRefName -q .headRefName 2>/dev/null || echo "")

if [ -z "$HEAD" ]; then
  echo "Could not read PR #$PR." >&2
  exit 1
fi

git fetch -q origin "$BASE" "$HEAD" 2>/dev/null || git fetch -q origin

RANGE="origin/$BASE...origin/$HEAD"
FILES=$(git diff --name-only "$RANGE")

section() { printf '\n## %s\n\n' "$1"; }

printf '# Review of PR #%s\n' "$PR"
gh pr view "$PR" --json title,author -q '"\(.title)  —  by \(.author.login)"' 2>/dev/null

section "Who wrote it"
git log "origin/$BASE..origin/$HEAD" --format='  %h  %an  %s' | head -20

section "What it touches"
for area in \
  "supabase/:DATABASE — Lovable may not author migrations" \
  ".github/:CI — the checks themselves" \
  "scripts/:GUARDRAILS — the checks themselves" \
  "docs/standards/:STANDARDS — the rules themselves" \
  "src/platform/:PLATFORM — shared services every module depends on" \
  "src/modules/:MODULE code" \
  "src/components/shared/:SHARED components" \
  "src/components/ui/:UI primitives — normally fine" \
  "src/routes/:ROUTES"
do
  prefix="${area%%:*}"; label="${area#*:}"
  hits=$(echo "$FILES" | grep "^$prefix" || true)
  [ -n "$hits" ] && { printf '  %s\n' "$label"; echo "$hits" | sed 's/^/    /'; }
done

other=$(echo "$FILES" | grep -vE '^(supabase|\.github|scripts|docs|src)/' || true)
[ -n "$other" ] && { printf '  ROOT / OTHER\n'; echo "$other" | sed 's/^/    /'; }

section "Dependencies"
if echo "$FILES" | grep -q '^package.json$'; then
  git diff "$RANGE" -- package.json | grep -E '^[+-]\s+"' | sed 's/^/  /' || echo "  (no dependency lines changed)"
  lock=$(git diff "$RANGE" -- package.json | grep -E '^\+' | grep -oE '"@lovable\.dev/[^"]+"' || true)
  [ -n "$lock" ] && printf '\n  ⚠ VENDOR LOCK-IN — CODING_STANDARDS §9:\n%s\n' "$(echo "$lock" | sed 's/^/    /')"
else
  echo "  unchanged"
fi

section "Does it reimplement a platform service?"
# The shape of the 30 Jul incident: a second email system built outside
# src/platform/, which no import rule forbade because it was not in a module.
found=""
while IFS= read -r f; do
  case "$f" in
    src/platform/*|*.test.ts|*.test.tsx|docs/*) continue ;;
  esac
  [ -f "$f" ] || continue
  hit=$(grep -lniE 'resend|sendmail|send_email|sendEmail|smtp|nodemailer|@react-email|approval_chain|audit_log|working_days' "$f" 2>/dev/null || true)
  [ -n "$hit" ] && found="$found  $f\n"
done <<< "$FILES"

if [ -n "$found" ]; then
  printf '  ⚠ These touch concepts the platform already owns. Check they CALL the\n'
  printf '    platform service rather than reimplementing it:\n'
  printf "$found"
else
  echo "  nothing outside src/platform/ mentions email, approvals, audit or working days"
fi

section "Secrets, environment, DNS"
risky=$(echo "$FILES" | grep -E '(^\.env|secret|credential|\.pem$|nameserver|dns)' -i || true)
[ -n "$risky" ] && echo "$risky" | sed 's/^/  ⚠ /' || echo "  nothing"
keys=$(git diff "$RANGE" | grep -E '^\+' | grep -oE '(API_KEY|SECRET|TOKEN|PRIVATE_KEY)[A-Z_]*' | sort -u || true)
[ -n "$keys" ] && printf '  ⚠ new key references: %s\n' "$(echo "$keys" | tr '\n' ' ')"

section "The gate's verdict"
GATE_BASE="origin/$BASE" GATE_HEAD="origin/$HEAD" bun scripts/lovable-gate-ci.mjs 2>&1 | sed 's/^/  /'

section "Does it still build?"
echo "  Run against the merge result, not the branch alone:"
echo "    git checkout -B review/pr-$PR origin/$HEAD && git merge origin/$BASE --no-edit"
echo "    bun install && bun run lint && bun run typecheck && bun run test && bun run harness"

printf '\n---\nReport only. The go-ahead is a human act.\n'
