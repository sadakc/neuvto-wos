#!/usr/bin/env bash
#
# Neuvto WOS — refuse to start the dev server against production
#
# Runs before `vite dev`. Reads nothing but the env files already in the repo.
#
# WHY
#
# `.env` is committed and is what the published app uses. It used to name the
# Lovable Cloud project — shared, but not production — so a `bun run dev` with
# no `.env.local` was untidy rather than dangerous.
#
# Production is now a database Sada owns, and `.env` names it. The same command,
# unchanged, would hand a developer a hot-reloading dev server wired to real
# customers' leave records. Nothing about the screen would say so: the app looks
# identical against every environment, which is the entire problem.
#
# `.env.local` is gitignored and points at local Docker, and is what everybody
# already uses. This guard exists for the case where it is missing — a fresh
# clone, a machine that has not run dev-lan.sh, or a `.env.local` deleted while
# chasing something else.
#
# Deliberately NOT a check inside the application. A guard that lives in the code
# it guards ships to production with it.

set -euo pipefail
cd "$(dirname "$0")/.." || exit 1

# The production project. When this changes, change it here — it is the one
# place, and being wrong means the guard silently stops guarding.
PRODUCTION_REF="udrzhfgwqgolvyimbwto"

# Resolve the URL the way Vite does: `.env.local` wins over `.env`. Read only
# the last assignment of the variable in each file, which is also Vite's rule.
read_url() {
  [[ -f "$1" ]] || return 0
  grep -E '^\s*VITE_SUPABASE_URL=' "$1" 2>/dev/null | tail -1 \
    | sed -E 's/^[^=]*=//; s/^["'"'"']//; s/["'"'"']\s*$//'
}

URL="$(read_url .env.local)"
SOURCE=".env.local"
if [[ -z "$URL" ]]; then
  URL="$(read_url .env)"
  SOURCE=".env"
fi

# No env files at all is somebody's first run, not a production risk. Let vite
# fail with its own message, which is clearer than anything invented here.
[[ -z "$URL" ]] && exit 0

if [[ "$URL" == *"$PRODUCTION_REF"* ]]; then
  if [[ "${I_MEAN_PRODUCTION:-}" == "1" ]]; then
    echo
    echo "  ⚠  Dev server against PRODUCTION, by explicit request."
    echo "     $URL"
    echo "     Every write goes to real customer data. Nothing here is a sandbox."
    echo
    exit 0
  fi
  cat >&2 <<MSG

  REFUSING TO START.

  $SOURCE points the dev server at PRODUCTION:

      $URL

  Hot reload, seed scripts and half-finished code would all be running against
  real customers' data, and the app looks exactly the same as it does locally.

  For ordinary work, point at your local stack:

      supabase start
      cp .env.local.localhost-backup .env.local     # or: bun run dev:lan

  If you genuinely mean to run against production — reproducing something that
  only happens there, with nobody else on it:

      I_MEAN_PRODUCTION=1 bun run dev

MSG
  exit 1
fi

exit 0
