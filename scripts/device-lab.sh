#!/usr/bin/env bash
# The device lab: a SECOND local stack, used only by the phone, Android and iOS
# tests, so they can re-seed and change data without touching the local stack
# Sada tests on by hand.
#
#   bash scripts/device-lab.sh up       start it (first run builds it), re-seed it
#   bash scripts/device-lab.sh seed     re-seed it
#   bash scripts/device-lab.sh dev      the app against it, on this Mac's Wi-Fi address, port 8090
#   bash scripts/device-lab.sh env      print the variables the tests read
#   bash scripts/device-lab.sh down     stop it
#
# Why the Wi-Fi address and not localhost: a browser treats localhost as a
# secure page and anything else on plain http as not secure, and some browser
# features exist only on secure pages. A phone always reaches the dev server by
# Wi-Fi address, so tests on localhost passed while uploads failed on the phone
# (D118). The lab is reached the way the phone reaches it.
#
# Ports: the usual stack uses 543xx; the lab uses 553xx, its own Docker
# containers (project "neuvto-device-lab") and its own volumes. Nothing it does
# can reach the usual stack's data.
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1

LAB=.device-lab
PSQL=${PSQL:-/opt/homebrew/opt/libpq/bin/psql}
DB_URL=postgresql://postgres:postgres@127.0.0.1:55322/postgres
APP_PORT=8090

lan_ip() {
  ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true
}

# Rebuilt every time from supabase/, so the lab can never drift from the real
# config: same migrations, functions and templates, different name and ports.
build() {
  local ip=$1
  rm -rf "$LAB/supabase"
  mkdir -p "$LAB/supabase"
  cp -R supabase/migrations supabase/functions supabase/templates "$LAB/supabase/"
  python3 - "$ip" "$APP_PORT" <<'PY'
import re, sys
ip, app = sys.argv[1], sys.argv[2]
text = open("supabase/config.toml").read()
text = re.sub(r'^project_id = ".*"$', 'project_id = "neuvto-device-lab"', text, flags=re.M)
text = text.replace("port = 54324", "port = 55324").replace("smtp_port = 54325", "smtp_port = 55325")
site = f"http://{ip}:{app}"
text = re.sub(r'^site_url = ".*"$', f'site_url = "{site}"', text, flags=re.M)
text = re.sub(r'^additional_redirect_urls = .*$',
              f'additional_redirect_urls = ["{site}", "http://localhost:{app}"]', text, flags=re.M)
# Passkeys are bound to a host name; the lab is reached by address.
text = re.sub(r'^rp_id = ".*"$', f'rp_id = "{ip}"', text, flags=re.M)
text += f"""
# ── Device lab ports (scripts/device-lab.sh) ──
[api]
port = 55321

[db]
port = 55322
shadow_port = 55320

[studio]
enabled = false

[analytics]
enabled = false

[edge_runtime]
inspector_port = 8183
"""
for header in ("[api]", "[db]", "[studio]", "[analytics]", "[edge_runtime]"):
    assert text.count("\n" + header + "\n") == 1, f"{header} is now in supabase/config.toml; merge the lab's ports into it"
open(".device-lab/supabase/config.toml", "w").write(text)
PY
}

key() {
  supabase status --workdir "$LAB" -o json 2>/dev/null |
    python3 -c "import sys,json;print(json.load(sys.stdin)['PUBLISHABLE_KEY'])"
}

seed() {
  "$PSQL" "$DB_URL" -q -v ON_ERROR_STOP=1 -f neuvto-harness/seed/seed_test_data.sql
  # As global-setup grants it, and as Neuvto grants it to a customer.
  "$PSQL" "$DB_URL" -q -v ON_ERROR_STOP=1 -c "
    insert into public.organization_modules (organization_id, module_key, enabled, enabled_at)
    values ('00000000-0000-0000-0000-0000000000a0', 'employee', true, now())
    on conflict (organization_id, module_key) do update set enabled = true, deleted_at = null"
  echo "Device lab seeded."
}

case "${1:-}" in
  up)
    IP=$(lan_ip)
    [ -n "$IP" ] || { echo "Not on a network — connect to Wi-Fi first." >&2; exit 1; }
    supabase stop --workdir "$LAB" >/dev/null 2>&1 || true
    build "$IP"
    supabase start --workdir "$LAB" -x studio,logflare,vector,imgproxy,supavisor,postgres-meta
    seed
    ;;
  seed) seed ;;
  env)
    IP=$(lan_ip)
    cat <<EOF
export DEVICE_LAB=1
export DEVICE_LAB_IP=$IP
export E2E_BASE_URL=http://$IP:$APP_PORT
export E2E_DB_URL=$DB_URL
export E2E_MAIL_URL=http://127.0.0.1:55324
export VITE_SUPABASE_URL=http://$IP:55321
export VITE_SUPABASE_PUBLISHABLE_KEY=$(key)
EOF
    ;;
  dev)
    IP=$(lan_ip)
    KEY=$(key)
    [ -n "$KEY" ] || { echo "The device lab is not running: bash scripts/device-lab.sh up" >&2; exit 1; }
    echo "App on http://$IP:$APP_PORT (device lab database, port 55321)"
    # Variables in the environment beat .env.local, which stays untouched.
    VITE_SUPABASE_URL=http://$IP:55321 SUPABASE_URL=http://$IP:55321 \
      VITE_SUPABASE_PUBLISHABLE_KEY=$KEY SUPABASE_PUBLISHABLE_KEY=$KEY \
      VITE_SUPABASE_PROJECT_ID=device-lab \
      exec bunx vite dev --host 0.0.0.0 --port $APP_PORT --strictPort
    ;;
  down) supabase stop --workdir "$LAB" ;;
  *)
    sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
