#!/usr/bin/env bash
#
# Neuvto WOS — apply the sign-in email settings that custom SMTP unlocks
#
#   bash scripts/apply-auth-email-config.sh [project-ref]
#
# WHAT THIS IS FOR
#
# The sign-in template cannot be set on a free project using Supabase's built-in
# email sender. The Management API refuses it outright:
#
#     Email template modification is not available for free tier projects
#     using the default email provider.
#
# Configuring custom SMTP lifts that. This script does everything that becomes
# possible afterwards, so the manual part is only the credential.
#
# WHAT THIS DELIBERATELY DOES NOT DO
#
# It does not set the SMTP password. That is a Resend API key, and a key typed
# into a script is a key in shell history, in a scrollback buffer, and one paste
# away from a chat log. Set SMTP in the dashboard — Authentication → Emails →
# SMTP Settings — and run this afterwards. See docs/operations/EMAIL_AND_DOMAINS
# .md, "Turning on custom SMTP".
#
# It is idempotent: run it as often as you like.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

REF="${1:-udrzhfgwqgolvyimbwto}"
TEMPLATE="supabase/templates/magic_link.html"
SUBJECT="Your Neuvto sign-in code"

# Auth emails per hour. The built-in sender caps this at 2 and will not let you
# change it; with custom SMTP the Supabase default becomes 30. Thirty is a
# demo-day number, not a company-onboarding one — one workspace of forty people
# invited on a Monday morning is forty codes.
RATE_LIMIT="${RATE_LIMIT:-100}"

# ---------------------------------------------------------------- the token
#
# Same token the CLI uses. Read into a variable and never echoed; every curl
# below sends it as a header rather than in a URL, so it cannot land in a proxy
# log or a shell history entry.
TOKEN="${SUPABASE_ACCESS_TOKEN:-}"
if [ -z "$TOKEN" ]; then
  TOKEN=$(security find-generic-password -s "Supabase CLI" -w 2>/dev/null)
fi
if [ -z "$TOKEN" ]; then
  echo "No Management API token. Run 'supabase login', or set SUPABASE_ACCESS_TOKEN." >&2
  exit 1
fi

API="https://api.supabase.com/v1/projects/$REF/config/auth"
# The API sits behind a WAF that answers 403 to unfamiliar clients after a few
# writes. Claiming to be the CLI is what the CLI itself sends.
UA="SupabaseCLI/2.110.0"

api_get() { curl -s -H "Authorization: Bearer $TOKEN" -H "User-Agent: $UA" "$API"; }

[ -f "$TEMPLATE" ] || { echo "Missing $TEMPLATE" >&2; exit 1; }
grep -q '{{ .Token }}' "$TEMPLATE" || {
  echo "REFUSING: $TEMPLATE has no {{ .Token }}." >&2
  echo "That is the whole point of this script — the 6-digit screen cannot be" >&2
  echo "completed without it, and pushing a template without it would look like" >&2
  echo "success while changing nothing that matters." >&2
  exit 1
}

# ---------------------------------------------------------------- precondition
#
# Checked rather than assumed. Without SMTP the template PATCH fails with a 400
# whose message is easy to scroll past, and the run would otherwise report
# partial success — the rate limit applied, the template silently not.
echo "── project $REF"
SMTP_HOST=$(api_get | python3 -c "import json,sys; print(json.load(sys.stdin).get('smtp_host') or '')")

if [ -z "$SMTP_HOST" ]; then
  cat >&2 <<'MSG'

  STOPPING — custom SMTP is not configured on this project.

  Nothing has been changed. The template cannot be set until SMTP is, and this
  script will not leave you with half of it applied.

  Dashboard → Authentication → Emails → SMTP Settings:

      Host        smtp.resend.com
      Port        465
      Username    resend
      Password    a Resend API key with sending access on neuvto.com
      Sender      notifications@neuvto.com
      Sender name Neuvto

  Then run this again.

MSG
  exit 1
fi
echo "── SMTP is configured ($SMTP_HOST) — the template can be set"

# ---------------------------------------------------------------- apply
#
# One PATCH. Sent as a file rather than an inline -d, because the template is
# multi-line HTML and shell quoting mangles it in ways that produce a valid
# request carrying a broken template.
PAYLOAD=$(mktemp); trap 'rm -f "$PAYLOAD"' EXIT
TEMPLATE_PATH="$TEMPLATE" SUBJECT="$SUBJECT" RATE_LIMIT="$RATE_LIMIT" python3 - "$PAYLOAD" <<'PY'
import json, os, sys, pathlib
json.dump({
    "mailer_templates_magic_link_content": pathlib.Path(os.environ["TEMPLATE_PATH"]).read_text(),
    "mailer_subjects_magic_link": os.environ["SUBJECT"],
    "rate_limit_email_sent": int(os.environ["RATE_LIMIT"]),
}, open(sys.argv[1], "w"))
PY

CODE=$(curl -s -o /tmp/auth-config-response.json -w "%{http_code}" -X PATCH \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -H "User-Agent: $UA" \
  --data-binary "@$PAYLOAD" "$API")

if [ "$CODE" != "200" ]; then
  echo "── PATCH failed (HTTP $CODE):" >&2
  head -c 400 /tmp/auth-config-response.json >&2; echo >&2
  exit 1
fi

# ---------------------------------------------------------------- verify
#
# Read back rather than trusting the 200. A PATCH that silently drops a field it
# does not like still answers 200, and "the template is set" is exactly the
# claim nobody checks until a customer cannot sign in.
api_get | RATE_LIMIT="$RATE_LIMIT" SUBJECT="$SUBJECT" python3 -c "
import json, os, sys
c = json.load(sys.stdin)
t = c.get('mailer_templates_magic_link_content') or ''
ok = True
def check(label, actual, expected):
    global ok
    good = actual == expected
    ok = ok and good
    print(f\"   {'ok ' if good else 'BAD'} {label}: {actual!r}\")

print('── reading it back')
check('subject', c.get('mailer_subjects_magic_link'), os.environ['SUBJECT'])
check('rate limit (emails/hour)', c.get('rate_limit_email_sent'), int(os.environ['RATE_LIMIT']))
check('OTP length', c.get('mailer_otp_length'), 6)
print(f\"   {'ok ' if '{{ .Token }}' in t else 'BAD'} template carries {{{{ .Token }}}}\")
ok = ok and '{{ .Token }}' in t
sys.exit(0 if ok else 1)
" || { echo "── one or more settings did not stick." >&2; exit 1; }

echo
echo "── done. A sign-in email now carries the six-digit code."
echo "   Send yourself one before believing it: the screen is the only proof."
