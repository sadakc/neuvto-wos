#!/usr/bin/env bash
#
# Neuvto WOS — take a backup of production, and prove it is one
#
#   bash scripts/backup-prod.sh                  back up production
#   bash scripts/backup-prod.sh --check          connect and report, write nothing
#   bash scripts/backup-prod.sh --local          back up the LOCAL stack instead
#   bash scripts/backup-prod.sh --restore-test   restore the newest backup locally
#
#   --pooler        route over IPv4 (see prod-cutover.sh for why this exists)
#   --keep N        how many runs to retain (default 14)
#   --keychain      read the password from the macOS Keychain, for unattended runs
#   --yes           do not prompt (required by --restore-test when unattended)
#
# WHY THIS EXISTS
#
# Supabase's Free plan has no automatic backups. Not short retention — none.
# Daily backups begin on Pro. Until Neuvto is on a paid plan, the only backups
# that exist are the ones this script writes.
#
# WHAT A BACKUP HERE IS, AND IS NOT
#
# Three files, which together are a restorable database:
#
#   roles.sql    cluster roles and their settings
#   schema.sql   tables, functions, policies, triggers, types
#   data.sql     every row — public, AND auth.users, AND storage.objects
#
# `schema.sql` is the least important of the three. The schema already has a
# backup: it is the migrations in git, and those are what a real restore should
# replay, because they are reviewed and this file is not. It is captured anyway
# so that a restore can be checked against what production actually had, which
# is the question you want answered at the moment you discover drift.
#
# `data.sql` is the irreplaceable one. Nothing else in the world holds those
# rows. It is also why this file is written OUTSIDE the repo — see DEST below.
#
# THREE THINGS ARE NOT IN HERE, AND SILENCE ABOUT THEM WOULD BE THE BUG:
#
#   1. Storage FILE CONTENTS. `storage.objects` is metadata — name, size, owner.
#      The bytes of every org logo live in S3, not in Postgres. Restoring this
#      backup gives you rows pointing at objects that are not there. Sada's own
#      logo upload on 4 Aug 2026 would come back as a broken image.
#      `supabase storage cp` is the free tool for those; see BACKUPS.md.
#
#   2. Vault secrets. The `vault` schema is on the CLI's exclude list, so
#      `notification_dispatch_url` and `notification_dispatch_key` are not here.
#      That is correct — a backup file that carries live credentials is a
#      liability, and this one already carries enough. It does mean a restored
#      database sends no email until those are set again. prod-cutover.sh prints
#      the two statements.
#
#   3. Anything created after the run. This is a snapshot, not replication.
#      Daily means "up to a day of leave requests", stated plainly rather than
#      discovered during a recovery.
#
# WHY THE VERIFY STEP IS NOT OPTIONAL
#
# The failure this guards against is not "pg_dump errored". It is pg_dump
# exiting 0 and leaving a file that is empty, truncated, or missing a table it
# could not read — which looks exactly like success, for months, until the day
# it matters. So every run compares the dump against a live census of the
# database and refuses to keep a backup that does not account for every
# non-empty table.
#
# That check is still weaker than a restore. Only --restore-test settles it, by
# replaying the dump into the local stack and counting the rows that arrive. Run
# it after the first backup, and after any migration that changes table shape.
#
# THE PASSWORD IS NEVER PRINTED, NEVER LOGGED, AND NEVER PASSED AS AN ARGUMENT.
# Do not add `set -x` to this file. The one exception is --pooler, which has to
# hand a connection string to the CLI; that path says so where it happens.

set -euo pipefail

# Every file this script writes contains real people's names, email addresses
# and leave records. 077 before anything is created, not chmod afterwards —
# afterwards is a window, and the window is the whole problem.
umask 077

cd "$(dirname "$0")/.." || exit 1

# The production project. Also named in guard-dev-target.sh; if it ever changes,
# both are wrong until both are changed.
PRODUCTION_REF="udrzhfgwqgolvyimbwto"

# Where backups live. Outside the repo on purpose: `data.sql` is customer
# personal data, git is permanent and pushed, and a .gitignore entry is one
# `git add -f` away from being no protection at all. Overridable for testing.
DEST_ROOT="${NEUVTO_BACKUP_DIR:-$HOME/neuvto-backups}"

LOCAL_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
KEYCHAIN_SERVICE="neuvto-prod-db"

# `--check` and `--local` are orthogonal to what the script is doing, not modes
# of their own. Folding them into MODE made `--restore-test --local`
# unexpressible — which meant the only way to exercise this script was to point
# it at production, i.e. the one thing a backup script must never require.
MODE="backup"
CHECK_ONLY=false
SUB="prod"
POOLER=false
KEYCHAIN=false
ASSUME_YES=false
KEEP=14

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check)        CHECK_ONLY=true ;;
    --local)        SUB="local" ;;
    --restore-test) MODE="restore-test" ;;
    --pooler)       POOLER=true ;;
    --keychain)     KEYCHAIN=true ;;
    --yes|-y)       ASSUME_YES=true ;;
    --keep)         KEEP="${2:-}"; shift ;;
    --keep=*)       KEEP="${1#--keep=}" ;;
    -h|--help)      grep -m1 -n '^set -euo' "$0" | cut -d: -f1 | xargs -I{} sed -n "2,{}p" "$0" | sed 's/^#\{0,1\} \{0,1\}//' | sed '$d'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

[[ "$KEEP" =~ ^[0-9]+$ ]] || { echo "--keep needs a number, got: $KEEP" >&2; exit 2; }
(( KEEP >= 1 )) || { echo "--keep must be at least 1 — 0 would delete the backup it just took." >&2; exit 2; }

PSQL="$(command -v psql || echo /opt/homebrew/opt/libpq/bin/psql)"
[[ -x "$PSQL" ]] || { echo "psql not found. brew install libpq" >&2; exit 1; }
command -v supabase >/dev/null || { echo "supabase CLI not found." >&2; exit 1; }

# `date -u` is fine here; the stamp is only ever a name and a sort key. UTC so
# that runs sort correctly regardless of where the laptop is, and so a backup
# taken at 05:30 IST does not sort under the previous day.
STAMP="$(date -u +%Y-%m-%dT%H%M%SZ)"

# Scratch, for handing row counts to python without putting them on stdin —
# stdin is where the python script itself arrives.
SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

# ─────────────────────────────────────────────────────────────── the census
#
# Exact counts for every base table in the three schemas that hold anything we
# could not rebuild. Deliberately NOT a hardcoded table list: the point of the
# check is to notice a table nobody remembered, and a list written today cannot
# do that. query_to_xml runs count(*) per table without needing a second round
# trip or dynamic SQL privileges.
CENSUS_SQL="
select table_schema || '.' || table_name || ' ' ||
       (xpath('/row/c/text()',
              query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name),
                           false, true, '')))[1]::text
  from information_schema.tables
 where table_schema in ('public','auth','storage')
   and table_type = 'BASE TABLE'
   and table_name not in ('schema_migrations','migrations')
 order by 1;
"

census() { "$PSQL" -tAc "$CENSUS_SQL"; }

# ───────────────────────────────────────────────────────── connection setup
#
# libpq environment variables rather than a connection string, so the password
# never appears in argv and never reaches `ps` or the shell history. psql needs
# no URL at all once these are exported.
connect_local() {
  export PGHOST=127.0.0.1 PGPORT=54322 PGUSER=postgres PGPASSWORD=postgres \
         PGDATABASE=postgres PGSSLMODE=prefer
  TARGET_LABEL="local Docker stack (127.0.0.1:54322)"
  REF="local"
}

project_field() {
  supabase projects list --output json 2>/dev/null | python3 -c "
import sys, json
ref, field = sys.argv[1], sys.argv[2]
d = json.load(sys.stdin)
rows = d['projects'] if isinstance(d, dict) else d
for p in rows:
    if p.get('ref') == ref or p.get('id') == ref:
        print(p.get(field, '')); break
" "$REF" "$1"
}

connect_production() {
  local ref_file="supabase/.temp/project-ref"
  [[ -f "$ref_file" ]] || { echo "Not linked to any project. Run: supabase link --project-ref $PRODUCTION_REF" >&2; exit 1; }
  REF="$(tr -d '[:space:]' < "$ref_file")"

  # Back up whatever is linked, but never let it be mistaken for production.
  # The failure worth preventing is a fortnight of green runs that were quietly
  # backing up pre-production while production had nothing.
  if [[ "$REF" != "$PRODUCTION_REF" ]]; then
    echo >&2
    echo "  The linked project is $REF, which is NOT production ($PRODUCTION_REF)." >&2
    echo "  Backing this up would leave production with no backup at all while the" >&2
    echo "  folder filled with files that look like one." >&2
    echo >&2
    echo "      supabase link --project-ref $PRODUCTION_REF" >&2
    echo >&2
    exit 1
  fi

  if [[ "$KEYCHAIN" == true ]]; then
    # Unattended runs have no terminal to type into. The Keychain is the free,
    # encrypted-at-rest option already on this Mac. See BACKUPS.md for the one
    # command that stores it.
    if ! SUPABASE_DB_PASSWORD="$(security find-generic-password -s "$KEYCHAIN_SERVICE" -w 2>/dev/null)"; then
      echo "No Keychain item '$KEYCHAIN_SERVICE'. See docs/operations/BACKUPS.md." >&2
      exit 1
    fi
  else
    printf '  Database password for %s (input hidden): ' "$REF"
    read -rs SUPABASE_DB_PASSWORD
    printf '\n'
  fi
  [[ -n "$SUPABASE_DB_PASSWORD" ]] || { echo "No password." >&2; exit 1; }
  export SUPABASE_DB_PASSWORD

  if [[ "$POOLER" == true ]]; then
    local region; region="$(project_field region)"
    [[ -n "$region" ]] || { echo "Could not determine the project region. Try: supabase login" >&2; exit 1; }
    export PGHOST="aws-0-${region}.pooler.supabase.com" PGPORT=5432 PGUSER="postgres.${REF}"
    TARGET_LABEL="$PGHOST (IPv4 pooler)"
  else
    # The direct host is IPv6-only — no A record. It works from this Mac and
    # not from an IPv4-only network. --pooler is the way out.
    export PGHOST="db.${REF}.supabase.co" PGPORT=5432 PGUSER=postgres
    TARGET_LABEL="$PGHOST (direct, IPv6-only)"
  fi
  export PGPASSWORD="$SUPABASE_DB_PASSWORD" PGDATABASE=postgres PGSSLMODE=require
}

# ─────────────────────────────────────────────────────────────── restore test
#
# The only check that actually settles the question. Everything above proves the
# file is plausible; this proves rows come back.
if [[ "$MODE" == "restore-test" ]]; then
  RUN_DIR="$(ls -d "$DEST_ROOT/$SUB"/*/ 2>/dev/null | grep -v '\.partial/$' | sort | tail -1 || true)"
  [[ -n "$RUN_DIR" && -f "${RUN_DIR}MANIFEST.txt" ]] || {
    echo "No completed backup under $DEST_ROOT/$SUB. Take one first." >&2; exit 1; }
  RUN_DIR="${RUN_DIR%/}"

  echo
  echo "  restore test"
  echo "  backup      $RUN_DIR"
  echo "  into        the LOCAL stack — supabase db reset, then replay data.sql"
  echo
  echo "  This DESTROYS whatever is in your local database right now."
  echo

  if [[ "$ASSUME_YES" != true ]]; then
    printf '  Type "restore" to continue: '
    read -r reply
    [[ "$reply" == "restore" ]] || { echo "  Nothing was changed."; exit 1; }
  fi

  connect_local
  "$PSQL" -tAc 'select 1' >/dev/null 2>&1 || {
    echo "  Local stack is not up. Run: supabase start" >&2; exit 1; }

  echo "── resetting local (schema comes from the migrations in git)"
  # Very chatty, and every line of it is about Docker rather than this backup.
  # Kept, not discarded — a reset that fails must be readable afterwards.
  if ! supabase db reset > "$SCRATCH/reset.log" 2>&1; then
    echo "  supabase db reset failed:" >&2
    tail -20 "$SCRATCH/reset.log" >&2
    exit 1
  fi

  # Wipe whatever the reset seeded, so the counts afterwards are the backup's
  # doing and not the seed's. An earlier version skipped this and read seed rows
  # as a successful restore.
  #
  # Per-table exception handling, not one big truncate: `storage.buckets_vectors`
  # refuses even the local `postgres` role, and an unhandled failure there aborts
  # the whole block — leaving earlier tables truncated, later ones seeded, and a
  # comparison at the end that means nothing. A table that cannot be truncated is
  # also one this backup never wrote to, so skipping it is correct and not a
  # compromise.
  echo "── clearing seed rows"
  "$PSQL" -q -v ON_ERROR_STOP=1 <<'SQL' >/dev/null 2>&1
set session_replication_role = replica;
do $$
declare t record;
begin
  for t in select table_schema, table_name
             from information_schema.tables
            where table_schema in ('public','storage')
              and table_type = 'BASE TABLE'
              and table_name not in ('schema_migrations','migrations')
  loop
    begin
      execute format('truncate table %I.%I cascade', t.table_schema, t.table_name);
    exception when insufficient_privilege or undefined_table then
      null;
    end;
  end loop;
end $$;
delete from auth.users;
SQL

  echo "── replaying data.sql"
  # ON_ERROR_STOP with pipefail: a failed INSERT halfway through must fail the
  # test, not leave a half-restored database that then gets counted.
  if ! gunzip -c "$RUN_DIR/data.sql.gz" | "$PSQL" -q -v ON_ERROR_STOP=1 > "$SCRATCH/replay.log" 2>&1; then
    echo "  FAILED: the dump would not replay." >&2
    grep -a 'ERROR' "$SCRATCH/replay.log" | head -10 >&2
    exit 1
  fi

  echo "── counting"
  census > "$SCRATCH/restored.txt"

  python3 - "$RUN_DIR/MANIFEST.txt" "$SCRATCH/restored.txt" <<'PY' || exit 1
import sys, re
manifest = open(sys.argv[1]).read()
backed = {}
for line in re.search(r'CENSUS AT DUMP TIME\n-+\n(.*?)\n\n', manifest, re.S).group(1).splitlines():
    if not line.strip(): continue
    name, n = line.split()
    backed[name] = int(n)
restored = {}
for line in open(sys.argv[2]).read().splitlines():
    if not line.strip(): continue
    name, n = line.split()
    restored[name] = int(n)

missing, extra, ok = [], [], 0
for name, n in sorted(backed.items()):
    if n == 0: continue
    got = restored.get(name, 0)
    if got < n: missing.append((name, n, got))
    else:
        ok += 1
        if got > n: extra.append((name, n, got))

for name, want, got in missing:
    print(f"  MISSING  {name}: backup had {want}, restore produced {got}")
for name, want, got in extra:
    print(f"  note     {name}: backup had {want}, restore produced {got} (platform default rows)")
print()
if missing:
    print(f"  RESTORE TEST FAILED — {len(missing)} table(s) came back short.")
    print("  This backup would not bring production back. Do not trust it.")
    sys.exit(1)
print(f"  RESTORE TEST PASSED — {ok} non-empty table(s) came back whole.")
PY

  # Stops the nag at the end of every backup. Written only on a pass, and named
  # for what it records rather than for the nag it silences.
  date -u +"%Y-%m-%dT%H%M%SZ $RUN_DIR" > "$DEST_ROOT/.restore-tested"

  echo
  echo "  Local now holds a copy of production. Re-seed before developing:"
  echo "      supabase db reset"
  echo
  exit 0
fi

# ────────────────────────────────────────────────────────────────── connect
if [[ "$SUB" == "local" ]]; then
  connect_local
else
  connect_production
fi


echo
echo "  target      $TARGET_LABEL"
echo "  destination $DEST_ROOT/$SUB/"
echo "  retention   last $KEEP run(s)"
echo

echo "  connecting …"
if ! OUT="$("$PSQL" -tAc 'select current_database() || $$ · $$ || substring(version() from $$PostgreSQL [0-9.]+$$)' 2>&1)"; then
  echo
  echo "  ${OUT%%$'\n'*}"
  echo
  if [[ "$OUT" == *"password authentication failed"* ]]; then
    echo "  The password was rejected. The connection itself is fine — it got far"
    echo "  enough to be told no. If it was rotated, the old one stopped working"
    echo "  immediately: Project Settings → Database → Reset database password."
  elif [[ "$POOLER" != true && "$SUB" != "local" ]]; then
    echo "  Could not reach the host. db.${REF}.supabase.co is IPv6-only. From an"
    echo "  IPv4 network, use the pooler:"
    echo
    echo "      bash scripts/backup-prod.sh --pooler"
  elif [[ "$SUB" == "local" ]]; then
    echo "  Local stack is not up. Run: supabase start"
  fi
  echo
  exit 1
fi
echo "  connected   $OUT"

CENSUS="$(census)"
TOTAL_ROWS="$(awk '{s+=$2} END {print s+0}' <<<"$CENSUS")"
NONEMPTY="$(awk '$2>0' <<<"$CENSUS" | wc -l | tr -d ' ')"
echo "  contents    $TOTAL_ROWS rows across $NONEMPTY non-empty table(s)"
echo

if [[ "$CHECK_ONLY" == true ]]; then
  echo "$CENSUS" | awk '$2>0 {printf "    %-40s %s\n", $1, $2}'
  echo
  echo "  --check: nothing was written."
  exit 0
fi

# ─────────────────────────────────────────────────────────────── destination
#
# A backup written inside the repository is a backup one `git add -f` away from
# being published, and this one is full of customer personal data. Refuse rather
# than trust a .gitignore.
#
# Test the nearest EXISTING ancestor, not $DEST_ROOT itself. `git -C` on a
# directory that does not exist yet cannot answer, fails, and reads as "not in a
# repo" — so the very first run created the folder inside the repo and wrote a
# full dump of production into it, exit 0, no warning. The second run then
# refused, the directory now existing. Caught by sabotage on 4 Aug 2026; the
# guard had been passing for exactly the run where it mattered.
PROBE="$DEST_ROOT"
while [[ ! -d "$PROBE" && "$PROBE" != "/" && "$PROBE" != "." ]]; do
  PROBE="$(dirname "$PROBE")"
done
if git -C "$PROBE" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "  REFUSING: $DEST_ROOT is inside the git work tree at $PROBE." >&2
  echo "  These files hold customer personal data and git is permanent." >&2
  echo "  Set NEUVTO_BACKUP_DIR to somewhere outside the repository." >&2
  exit 1
fi

mkdir -p "$DEST_ROOT/$SUB"
chmod 700 "$DEST_ROOT" "$DEST_ROOT/$SUB" 2>/dev/null || true

# Build in `.partial` and rename only once everything is verified, so an
# interrupted run cannot leave something that looks like a usable backup — and
# so retention never counts one.
WORK="$DEST_ROOT/$SUB/${STAMP}.partial"
FINAL="$DEST_ROOT/$SUB/${STAMP}"
rm -rf "$WORK"; mkdir -p "$WORK"

# `--linked` is the path that keeps the password out of argv: the CLI reads
# SUPABASE_DB_PASSWORD from the environment and exports it as PGPASSWORD itself.
# `--pooler` cannot use it — the CLI resolves the direct host on its own — so
# that route falls back to a connection string, and the password IS visible in
# `ps` for the seconds the dump runs. Single-user Mac, deliberate trade, said out
# loud rather than left for someone to find.
dump() {
  local what="$1" out="$2"; shift 2
  if [[ "$SUB" == "local" ]]; then
    supabase db dump --db-url "$LOCAL_URL" "$@" -f "$out" >/dev/null
  elif [[ "$POOLER" == true ]]; then
    local enc; enc="$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.stdin.readline().rstrip("\n"), safe=""))' <<<"$PGPASSWORD")"
    supabase db dump --db-url "postgresql://${PGUSER}:${enc}@${PGHOST}:${PGPORT}/postgres" "$@" -f "$out" >/dev/null
  else
    supabase db dump --linked "$@" -f "$out" >/dev/null
  fi
  [[ -s "$out" ]] || { echo "  FAILED: $what produced an empty file." >&2; exit 1; }
  printf '  %-10s %8s KB\n' "$what" "$(( ($(wc -c < "$out") + 1023) / 1024 ))"
}

echo "── dumping"
dump roles    "$WORK/roles.sql"  --role-only
dump schema   "$WORK/schema.sql"
dump data     "$WORK/data.sql"   --data-only
echo

# ────────────────────────────────────────────────────────────────── verify
echo "── verifying"

# 1. Truncation. pg_dump 18 brackets its output with \restrict/\unrestrict
#    carrying the same token; the CLI comments them out but leaves them in
#    place. A closing token that matches the opening one means the dump ran to
#    completion rather than dying partway with a zero exit somewhere in a pipe.
#    Only the data dump carries them, which is the one that matters.
OPEN="$(grep -aoE '\\restrict [A-Za-z0-9]+' "$WORK/data.sql" | head -1 | awk '{print $2}' || true)"
CLOSE="$(grep -aoE '\\unrestrict [A-Za-z0-9]+' "$WORK/data.sql" | tail -1 | awk '{print $2}' || true)"
if [[ -n "$OPEN" && "$OPEN" != "$CLOSE" ]]; then
  echo "  FAILED: data.sql is truncated — it opens with a restrict token and never closes it." >&2
  exit 1
fi
echo "  complete   data.sql opens and closes cleanly"

# 2. Coverage. Every table the live database says has rows must appear in the
#    dump. This is what catches the dangerous failure: a table pg_dump could not
#    read, skipped, and exited 0 over.
#
#    It asserts presence, not counts. Counting rows out of multi-row INSERT
#    statements is guesswork, and --restore-test answers the same question
#    properly by replaying the file. Said here so nobody reads this as more
#    than it is.
printf '%s\n' "$CENSUS" > "$SCRATCH/census.txt"
MISSING="$(python3 - "$WORK/data.sql" "$SCRATCH/census.txt" <<'PY'
import sys, re
dump = open(sys.argv[1], encoding='utf-8', errors='replace').read()
present = set()
for schema, table in re.findall(r'INSERT INTO\s+"([^"]+)"\."([^"]+)"', dump):
    present.add(f"{schema}.{table}")
missing = []
for line in open(sys.argv[2]).read().splitlines():
    if not line.strip(): continue
    name, n = line.split()
    if int(n) > 0 and name not in present:
        missing.append(f"{name} ({n} rows)")
print("\n".join(missing))
PY
)"
if [[ -n "$MISSING" ]]; then
  echo "  FAILED: tables with rows in the database that are absent from data.sql:" >&2
  sed 's/^/    /' <<<"$MISSING" >&2
  echo >&2
  echo "  Keeping this would be keeping a backup that silently loses those tables." >&2
  exit 1
fi
echo "  coverage   all $NONEMPTY non-empty table(s) appear in data.sql"

# ─────────────────────────────────────────────────────────────────── manifest
{
  echo "Neuvto WOS backup"
  echo "taken            $STAMP"
  echo "project          $REF${TARGET_LABEL:+  ($TARGET_LABEL)}"
  echo "server           $OUT"
  echo "pg_dump          $("${PSQL%psql}pg_dump" --version 2>/dev/null | awk '{print $NF}')"
  echo "supabase cli     $(supabase --version 2>/dev/null)"
  echo "rows             $TOTAL_ROWS across $NONEMPTY non-empty table(s)"
  echo
  echo "NOT IN THIS BACKUP"
  echo "  storage file contents (metadata only — the bytes are in S3)"
  echo "  vault secrets (excluded by the CLI, and deliberately)"
  echo "  anything written after the timestamp above"
  echo
  echo "CENSUS AT DUMP TIME"
  echo "-------------------"
  echo "$CENSUS"
  echo
  echo "FILES"
  echo "-----"
} > "$WORK/MANIFEST.txt"

echo "── compressing"
gzip -9 "$WORK/roles.sql" "$WORK/schema.sql" "$WORK/data.sql"
for f in roles schema data; do
  printf '%s  %s\n' "$(shasum -a 256 "$WORK/$f.sql.gz" | awk '{print $1}')" "$f.sql.gz" >> "$WORK/MANIFEST.txt"
done
{
  echo
  echo "RESTORE"
  echo "-------"
  echo "  Schema comes from the migrations in git — replay those first, not"
  echo "  schema.sql, because those are the reviewed ones."
  echo "    supabase link --project-ref <new-ref>"
  echo "    bash scripts/prod-cutover.sh"
  echo "  Then the data, which exists nowhere else:"
  echo "    gunzip -c data.sql.gz | psql \"\$DB_URL\""
  echo "  Then the Vault secrets (prod-cutover.sh prints both statements), and"
  echo "  re-upload org logos — see docs/operations/BACKUPS.md."
  echo
  echo "  Verify a backup before you need it:  bash scripts/backup-prod.sh --restore-test"
} >> "$WORK/MANIFEST.txt"

mv "$WORK" "$FINAL"
chmod -R go-rwx "$FINAL" 2>/dev/null || true

echo
echo "  ✓ $FINAL"
echo "    $(du -sh "$FINAL" | awk '{print $1}') · $TOTAL_ROWS rows"
echo

# ─────────────────────────────────────────────────────────────── retention
#
# Only complete runs count. A `.partial` left by an interrupted run is never
# pruned and never counted, so it stays visible until somebody looks at it.
#
# A while-read loop rather than mapfile: macOS ships bash 3.2, where mapfile
# does not exist and the array comes out empty — which fails silently as
# "nothing to prune" and lets the folder grow forever.
RUNS=()
while IFS= read -r line; do RUNS+=("$line"); done < <(
  ls -d "$DEST_ROOT/$SUB"/*/ 2>/dev/null | grep -v '\.partial/$' | sort
)
if (( ${#RUNS[@]} > KEEP )); then
  echo "── retention: keeping the newest $KEEP of ${#RUNS[@]}"
  for old in "${RUNS[@]:0:$(( ${#RUNS[@]} - KEEP ))}"; do
    echo "  removing $(basename "$old")"
    rm -rf "$old"
  done
  echo
fi

# One nag, once, until it has been proved. A file nobody has restored is a
# hope, and the difference is only discovered on the worst possible day.
if [[ ! -f "$DEST_ROOT/.restore-tested" ]]; then
  cat <<'NAG'
  This backup has never been restored, so nothing yet proves it can be.

      bash scripts/backup-prod.sh --restore-test

  It replays the newest backup into your local stack and counts what arrives.
  Takes a minute, and it destroys local data only.

NAG
fi

unset SUPABASE_DB_PASSWORD PGPASSWORD
