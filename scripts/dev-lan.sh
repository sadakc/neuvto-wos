#!/usr/bin/env bash
# Run the app so a phone on the same Wi-Fi can reach it.
#
#   bun run dev:lan
#
# The part that is easy to get wrong: the app must be told to reach Supabase at
# this Mac's LAN address. Left as 127.0.0.1 it works perfectly on the Mac and
# fails on the phone, because 127.0.0.1 there means the PHONE — where nothing is
# listening. The failure looks like a broken app rather than a misconfiguration.
#
# The address changes when the network does, so this recomputes it every run
# rather than trusting whatever .env.local last said.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)
if [ -z "$IP" ]; then
  echo "Not on a network — connect to Wi-Fi and try again." >&2
  exit 1
fi

if ! supabase status >/dev/null 2>&1; then
  echo "Supabase is not running. Start it first:" >&2
  echo "  supabase start" >&2
  exit 1
fi

KEY=$(supabase status -o json 2>/dev/null \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['PUBLISHABLE_KEY'])")

[ -f .env.local ] && [ ! -f .env.local.localhost-backup ] && cp .env.local .env.local.localhost-backup

cat > .env.local <<EOF
# Written by scripts/dev-lan.sh so a phone can reach this Mac.
# 127.0.0.1 here would mean the phone's own localhost, where nothing listens.
# Back to Mac-only: cp .env.local.localhost-backup .env.local
VITE_SUPABASE_URL="http://${IP}:54321"
VITE_SUPABASE_PUBLISHABLE_KEY="${KEY}"
VITE_SUPABASE_PROJECT_ID="local-dev"
SUPABASE_URL="http://${IP}:54321"
SUPABASE_PUBLISHABLE_KEY="${KEY}"
EOF

cat <<EOF

  ─────────────────────────────────────────────
   On your phone, same Wi-Fi as this Mac:

     App      http://${IP}:8080/app
     Sign in  any seeded employee, e.g.
              ravi.emp@acme.test
     Code     http://${IP}:54324   (Mailpit)
  ─────────────────────────────────────────────

  This is the LOCAL database. Data here is throwaway and
  disappears on the next \`supabase db reset\`.

  First run may raise a macOS firewall prompt — allow it.
  Guest Wi-Fi with client isolation will not work.

EOF

exec bun run dev --host 0.0.0.0
