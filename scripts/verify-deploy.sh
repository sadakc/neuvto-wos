#!/usr/bin/env bash
#
# Neuvto WOS — ask the DEPLOYED bundle which database it talks to
#
#   bash scripts/verify-deploy.sh                 # check https://neuvto.com
#   bash scripts/verify-deploy.sh --url https://neuvto.lovable.app
#   bash scripts/verify-deploy.sh --expect-string 'Your session has ended'
#
# WHY THIS EXISTS
#
# On 3 Aug 2026 `neuvto.com` served a bundle wired to the PRE-PROD project while
# a correct `.env` sat merged and inert in git: Lovable builds the site and
# supplies its own backend variables, so nothing in the repository decides the
# published artifact. That is recorded in NEUVTO_MVP_BUILD_SPEC.md, along with
# the instruction to re-check from the bundle after every deploy.
#
# On 6 Aug 2026 it happened again, and the check was not run. The deploy was
# verified by grepping for two feature strings — both present, both correct —
# and reported live. The bundle was pointing at pre-prod the whole time. Sign-in
# returned HTTP 200 and sent nothing, because it was signing in to the wrong
# database.
#
# A paragraph in a document is not a check. This is the check.
#
# WHAT IT DOES THAT GREPPING THE ENTRY CHUNK DOES NOT
#
# The project ref is not in the entry chunk. It is in whichever vendor chunk the
# Supabase client landed in, and DIFFERENT ROUTES LOAD DIFFERENT CHUNKS — on
# 6 Aug the landing page and the sign-in page were briefly served by two
# different builds pointing at two different databases. So this walks the whole
# import graph from several routes rather than trusting one file.
#
# It also FAILS when it finds no project reference at all. That is not a pass:
# it means the search missed the chunk that has it, which is exactly the mistake
# that let the regression through. A check that cannot find what it is looking
# for must say so rather than stay quiet.

set -uo pipefail

SITE="https://neuvto.com"
# The only project the published site may talk to. Production, ap-south-1.
EXPECT_REF="${EXPECT_REF:-udrzhfgwqgolvyimbwto}"
# Named so the failure message can say which environment it actually hit.
PREPROD_REF="vkyvzhgigncranprhidn"
EXPECT_STRING=""
# Local build directories to scan INSTEAD of fetching a site. The point of this
# mode is that CI can refuse to publish a wrong build rather than discovering it
# afterwards — by which time the wrong thing is already what the world sees.
SCAN_DIRS=""

while [ $# -gt 0 ]; do
  case "$1" in
    --url)           SITE="$2"; shift 2 ;;
    --dir)           SCAN_DIRS="$SCAN_DIRS $2"; shift 2 ;;
    --expect-ref)    EXPECT_REF="$2"; shift 2 ;;
    --expect-string) EXPECT_STRING="$2"; shift 2 ;;
    -h|--help)       sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/chunks"

# ─────────────────────────────────────────── local mode: check before publishing
if [ -n "$SCAN_DIRS" ]; then
  echo "── build output:$SCAN_DIRS"
  # EACH directory is checked SEPARATELY, and each must contain the reference.
  #
  # The first real run of this pipeline (7 Aug 2026) passed while shipping a
  # site that could not reach any database at all. The two halves read
  # DIFFERENT variables — the browser bundle uses VITE_SUPABASE_URL, the server
  # bundle uses SUPABASE_URL — and the original version pooled both directories
  # into one list. The server half held a valid value, the browser half held
  # junk, the union looked clean, and the deployed page threw
  # "Invalid supabaseUrl" on load.
  #
  # Pooling them asks "does this project appear anywhere", which is not the
  # question. The question is whether EVERY shipped half talks to it.
  BAD=0
  for d in $SCAN_DIRS; do
    if [ ! -d "$d" ]; then
      echo "  FAILED: $d does not exist — nothing was built, or it built elsewhere." >&2
      exit 1
    fi
    find "$d" -type f \( -name '*.js' -o -name '*.mjs' -o -name '*.html' \) > "$TMP/files"
    COUNT="$(grep -c . "$TMP/files" 2>/dev/null || echo 0)"
    if [ "$COUNT" -eq 0 ]; then
      echo "  FAILED: no JavaScript or HTML in ${d}. Nothing was verified." >&2
      exit 1
    fi

    REFS="$(xargs grep -aho 'https://[a-z0-9]\{20\}\.supabase\.co' < "$TMP/files" 2>/dev/null \
            | sed 's|https://||; s|\.supabase\.co||' | sort -u)"

    if [ -z "$REFS" ]; then
      echo "  BAD ${d} — ${COUNT} file(s), NO project reference" >&2
      echo "      This half of the build reaches no database. If it is the" >&2
      echo "      browser bundle, every page throws on load; if it is the" >&2
      echo "      server bundle, every server route fails." >&2
      echo "      Usual cause: the variable it reads is unset or malformed." >&2
      echo "      Browser reads VITE_SUPABASE_URL; server reads SUPABASE_URL." >&2
      BAD=1
      continue
    fi
    for ref in $REFS; do
      if [ "$ref" = "$EXPECT_REF" ]; then
        echo "  ok  ${d} — ${ref} (expected), ${COUNT} file(s)"
      elif [ "$ref" = "$PREPROD_REF" ]; then
        echo "  BAD ${d} — ${ref} ** PRE-PROD **" >&2; BAD=1
      else
        echo "  BAD ${d} — ${ref} ** UNKNOWN PROJECT **" >&2; BAD=1
      fi
    done
  done

  echo
  if [ "$BAD" -ne 0 ]; then
    echo "  FAILED. This build must not be published." >&2
    exit 1
  fi
  echo "── PASSED — every half of the build talks only to ${EXPECT_REF}"
  exit 0
fi

# Routes worth asking. `/auth` is the one that matters most — it is where a
# wrong backend does its damage — but it is `ssr: false` and its HTML has
# carried no asset references at times, so it cannot be the only source.
ROUTES="/ /app /neuvto-hq /auth"

echo "── ${SITE}"

# ------------------------------------------------------------------ discovery
: > "$TMP/queue"
ENTRIES=""
for route in $ROUTES; do
  # Cache-busted and no-cache, because a CDN answering from cache would have us
  # verifying the build we are trying to replace.
  BUST="$(date +%s)$RANDOM"
  if ! curl -fsS -o "$TMP/page.html" \
        -H 'Cache-Control: no-cache' -H 'Pragma: no-cache' \
        "${SITE}${route}?_cb=${BUST}" 2>/dev/null; then
    echo "   .. ${route} — could not fetch, skipping"
    continue
  fi
  # -a: a served page is not always valid UTF-8, and grep silently reports
  # "binary file matches" and zero results otherwise. That cost an hour once.
  FOUND="$(grep -ao '/assets/[A-Za-z0-9_.-]*\.js' "$TMP/page.html" | sort -u)"
  N="$(printf '%s\n' "$FOUND" | grep -c . )"
  ENTRY="$(printf '%s\n' "$FOUND" | grep -a 'index-' | head -1)"
  [ -n "$ENTRY" ] && ENTRIES="$ENTRIES $ENTRY"
  echo "   .. ${route} — ${N} chunk(s)${ENTRY:+, entry ${ENTRY##*/}}"
  printf '%s\n' "$FOUND" >> "$TMP/queue"
done

sort -u "$TMP/queue" | grep -a . > "$TMP/todo" || true
if [ ! -s "$TMP/todo" ]; then
  echo
  echo "  FAILED: no JavaScript chunks found on any route." >&2
  echo "  Nothing was verified. Do not read this as a pass." >&2
  exit 1
fi

# Different builds on different routes is its own bug, and a subtle one — it is
# how the sign-in page talked to pre-prod while the landing page talked to
# production for part of 6 Aug 2026.
UNIQUE_ENTRIES="$(printf '%s\n' $ENTRIES | sort -u | grep -c .)"
if [ "$UNIQUE_ENTRIES" -gt 1 ]; then
  echo
  echo "  FAILED: routes are being served by DIFFERENT builds:" >&2
  printf '%s\n' $ENTRIES | sort -u | sed 's/^/      /' >&2
  echo "  A deploy is mid-rollout, or two builds are live at once." >&2
  exit 1
fi

# ------------------------------------------------ walk the whole import graph
#
# A chunk names its own imports. Following them is what reaches the vendor chunk
# holding the Supabase client, which no route's HTML mentions directly.
: > "$TMP/seen"
PASS=0
while [ -s "$TMP/todo" ] && [ "$PASS" -lt 6 ]; do
  PASS=$((PASS + 1))
  : > "$TMP/next"
  while read -r path; do
    [ -z "$path" ] && continue
    name="$(basename "$path")"
    grep -qxF "$name" "$TMP/seen" 2>/dev/null && continue
    echo "$name" >> "$TMP/seen"
    curl -fsS -o "$TMP/chunks/$name" "${SITE}${path}" 2>/dev/null || continue
    grep -ao '[A-Za-z0-9_.-]*\.js' "$TMP/chunks/$name" \
      | grep -a '^[A-Za-z0-9_-]*-[A-Za-z0-9_-]*\.js$' \
      | sed 's|^|/assets/|' | sort -u >> "$TMP/next"
  done < "$TMP/todo"
  sort -u "$TMP/next" > "$TMP/todo"
done

TOTAL="$(grep -c . "$TMP/seen" 2>/dev/null || echo 0)"
echo "   .. walked ${TOTAL} chunk(s) across ${PASS} pass(es)"

# ------------------------------------------------------------------ the check
REFS="$(grep -aho 'https://[a-z0-9]\{20\}\.supabase\.co' "$TMP/chunks"/* 2>/dev/null \
        | sed 's|https://||; s|\.supabase\.co||' | sort -u)"

echo
if [ -z "$REFS" ]; then
  # The failure mode this script was written for. Silence is not success.
  echo "  FAILED: no Supabase project reference found in ${TOTAL} chunks." >&2
  echo "  This does NOT mean the deploy is clean — it means the ref was not" >&2
  echo "  located, so nothing was verified. The bundling may have changed" >&2
  echo "  shape. Fix this script before trusting a deploy again." >&2
  exit 1
fi

BAD=0
for ref in $REFS; do
  WHERE="$(grep -al "$ref" "$TMP/chunks"/* 2>/dev/null | head -1)"
  if [ "$ref" = "$EXPECT_REF" ]; then
    # "expected", not "production". The label follows --expect-ref, and calling
    # whatever was asked for "production" is how a check reassures somebody
    # about the wrong environment in the exact moment they are relying on it.
    echo "  ok  ${ref}  (expected) — ${WHERE##*/}"
  elif [ "$ref" = "$PREPROD_REF" ]; then
    echo "  BAD ${ref}  ** PRE-PROD ** — ${WHERE##*/}" >&2
    BAD=1
  else
    echo "  BAD ${ref}  ** UNKNOWN PROJECT ** — ${WHERE##*/}" >&2
    BAD=1
  fi
done

if [ "$BAD" -ne 0 ]; then
  cat >&2 <<MSG

  FAILED. The published site is talking to the wrong database.

  Changing .env will not fix this and has not before: Lovable builds the site
  and supplies its own backend variables, so a correct repository sits merged
  and inert. See NEUVTO_MVP_BUILD_SPEC.md, "The published site still uses
  Lovable's backend".

  Ask Lovable to publish \`main\` and to confirm the published artifact
  resolves to ${EXPECT_REF}. Then run this again.

  Until it passes, do not sign in: anything entered goes to the other project.
MSG
  exit 1
fi

# ------------------------------------------------------- optional: a feature
#
# Secondary on purpose. A feature string proves a build shipped; it says
# nothing about which database it points at, and confusing the two is how the
# 6 Aug regression was reported as a successful deploy.
if [ -n "$EXPECT_STRING" ]; then
  if grep -aqF "$EXPECT_STRING" "$TMP/chunks"/* 2>/dev/null; then
    echo "  ok  string present: ${EXPECT_STRING}"
  else
    echo "  BAD string NOT found: ${EXPECT_STRING}" >&2
    echo "  The build is pointed at the right database but does not contain" >&2
    echo "  this change. It is probably a commit behind." >&2
    exit 1
  fi
fi

echo
echo "── PASSED — the deployed bundle talks only to ${EXPECT_REF}"
