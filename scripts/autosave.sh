#!/usr/bin/env bash
# Commit and push whatever changed, automatically, at the end of every Claude
# Code turn. Wired up as a Stop hook in .claude/settings.json.
#
# The point is that nothing worth keeping should depend on somebody remembering
# to ask for it to be saved.
#
# Rules it will not break:
#   1. Never commits to main. Creates a work branch instead.
#   2. Never commits anything that looks like a live credential.
#   3. Never fails the session. Every exit is 0; problems are reported, not raised.
#
# It pushes to a branch, never to main, so CI and review still gate what lands.
# See docs/operations/AUTOSAVE.md.

set -uo pipefail

cd "$(dirname "$0")/.." || exit 0

say() { printf 'autosave: %s\n' "$*" >&2; }

git rev-parse --git-dir >/dev/null 2>&1 || exit 0

# Mid-rebase, mid-merge, mid-cherry-pick: leave well alone.
gitdir=$(git rev-parse --git-dir)
for marker in MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD rebase-merge rebase-apply; do
  if [ -e "$gitdir/$marker" ]; then
    say "skipped — repository is mid-$marker"
    exit 0
  fi
done

[ -n "$(git status --porcelain)" ] || exit 0

branch=$(git rev-parse --abbrev-ref HEAD)

# Rule 1 — main is not a working branch.
if [ "$branch" = "main" ] || [ "$branch" = "master" ] || [ "$branch" = "HEAD" ]; then
  branch="work/$(date +%Y-%m-%d-%H%M)"
  git checkout -q -b "$branch" || { say "could not create $branch"; exit 0; }
  say "was on main — moved the work to $branch"
fi

git add -A

# Rule 2 — a live credential must never reach a remote. Checked against the
# staged diff, so it applies to what is actually about to be committed.
#
# Deliberately narrow. Broad patterns fire on documentation that merely
# discusses secrets, everybody learns to ignore the warning, and the guard stops
# guarding anything.
secret_re='(re_[A-Za-z0-9]{24,}|sk-[A-Za-z0-9]{32,}|sk_live_[A-Za-z0-9]{16,}|sb_secret_[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|(SERVICE_ROLE_KEY|SECRET_KEY|API_KEY)[[:space:]]*[:=][[:space:]]*["'"'"']?eyJ[A-Za-z0-9._-]{40,})'

if hits=$(git diff --cached -U0 | grep -nE "^\+" | grep -E "$secret_re"); then
  say "REFUSED TO COMMIT — this looks like a live credential:"
  printf '%s\n' "$hits" | sed 's/^/autosave:   /' | cut -c1-160 >&2
  say "nothing was committed. Remove it, or add the file to .gitignore."
  git reset -q
  exit 0
fi

# A message that says what changed, since nobody writes one for a checkpoint.
areas=$(git diff --cached --name-only \
  | sed -E 's#^(docs/[^/]+|src/[^/]+|supabase/[^/]+|neuvto-harness|scripts|\.claude|\.github)/.*#\1#; s#^([^/]+)$#\1#' \
  | sort -u | head -4 | paste -sd', ' -)
count=$(git diff --cached --name-only | wc -l | tr -d ' ')
[ -n "$areas" ] || areas="working tree"

git commit -q -m "chore(autosave): $areas ($count file(s))" \
  -m "Checkpoint written by scripts/autosave.sh at the end of a Claude Code turn.
Squashed away when the branch merges — see docs/operations/AUTOSAVE.md." \
  -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" \
  || { say "commit failed"; exit 0; }

if git push -q -u origin "$branch" 2>/dev/null; then
  say "committed and pushed to $branch"
else
  say "committed to $branch — push failed, it will go with the next one"
fi

exit 0
