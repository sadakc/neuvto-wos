# Backups

**Version:** 1.0 · **Status:** Active · **Updated:** 8 Aug 2026

**Supabase's Free plan has no automatic backups.** Not short retention — none at
all. Daily backups with 7-day retention begin on Pro (~$25/month). Until Neuvto
is on a paid plan, the only backups that exist are the ones `scripts/backup-prod.sh`
writes, and they only exist on the machine that ran it.

That is a deliberate trade, not an oversight: nothing is paid for until the MVP
ships. It is survivable **only** while the script actually runs.

---

## The one thing that matters

**Backups must be running before the first real customer's data exists, not
after.** Today production holds one auth user and one `platform_admins` row —
losing it costs an afternoon. The moment Extreme's staff start entering leave,
the same loss is unrecoverable: there is no other copy of a leave balance
anywhere in the world.

So: **taking the first backup is a step in provisioning, not a follow-up task.**
It is listed in `FIRST_CUSTOMER_RUNBOOK.md` for that reason.

---

## Taking a backup

```bash
bash scripts/backup-prod.sh
```

It asks for the production database password (hidden — never in argv, `ps`, or
shell history), dumps, verifies, compresses, and prunes to the last 14 runs.

```
bash scripts/backup-prod.sh --check     connect and report, write nothing
bash scripts/backup-prod.sh --pooler    route over IPv4 (see below)
bash scripts/backup-prod.sh --keep 30   retain more runs
bash scripts/backup-prod.sh --local     back up the local stack instead
```

Backups land in `~/neuvto-backups/prod/<UTC timestamp>/`, mode 700/600:

| file            | what it is                                                          |
| --------------- | ------------------------------------------------------------------- |
| `roles.sql.gz`  | cluster roles and their settings                                    |
| `schema.sql.gz` | tables, functions, policies, triggers, types                        |
| `data.sql.gz`   | **every row** — `public`, plus `auth.users`, plus `storage.objects` |
| `MANIFEST.txt`  | row census, checksums, versions, restore steps                      |

`data.sql.gz` is the irreplaceable one. `schema.sql.gz` is a cross-check; the
real schema backup is the migrations in git, and those are what a restore should
replay because those are the reviewed ones.

### If it cannot connect

`db.<ref>.supabase.co` is **IPv6-only** — it has no A record. It works from
Sada's Mac and not from an IPv4-only network (some hotel and office Wi-Fi,
Docker). Use `--pooler`, which routes over IPv4. Same reason as
`prod-cutover.sh`, same fix.

`password authentication failed` is a different thing: the network path is
_fine_, it got far enough to be told no. Reset it at Project Settings →
Database, and remember that resetting invalidates the old one immediately.

---

## What is NOT in a backup

Three gaps. None is a bug; all three would be a nasty surprise mid-recovery.

**1. Storage file contents.** `storage.objects` holds _metadata_ — name, size,
owner. The bytes of every org logo live in S3. A restored database has rows
pointing at objects that are not there, and every customer logo renders broken.
Back those up separately, free:

```bash
supabase storage cp -r ss:///org-logos ~/neuvto-backups/storage/org-logos --linked --experimental
```

`--experimental` is not optional — the CLI refuses every `storage` subcommand
without it (`LegacyExperimentalRequiredError`), and being an experimental
command is itself a reason not to build the scheduled job around it. Drop
`--linked` and add `--local` to work against the local stack.

At one logo per customer this is small and rarely changes — run it when a
customer uploads or changes a logo, not daily. It is deliberately **not** part
of `backup-prod.sh`: the database dump must not fail because an experimental
storage command changed its flags.

**2. Vault secrets.** The `vault` schema is on the CLI's exclusion list, so
`notification_dispatch_url` and `notification_dispatch_key` are not captured.
That is correct — a backup file carrying live credentials is a liability, and
this one already carries enough. It does mean **a restored database sends no
email until those are set again**. `prod-cutover.sh` prints both statements, in
the right argument order.

**3. Anything written after the run.** This is a snapshot, not replication.
Daily backups mean "up to a day of leave requests", stated here rather than
discovered during a recovery.

---

## Proving a backup

A file nobody has restored is a hope. The difference between a backup and a hope
is only ever discovered on the worst possible day.

```bash
bash scripts/backup-prod.sh --restore-test
```

This replays the newest backup into the **local** stack — `supabase db reset`,
clear the seed, replay `data.sql`, count what arrives — and fails loudly if any
table comes back short. It destroys local data only; production is never touched
and is never even connected to.

Run it:

- after the very first production backup;
- after any migration that changes table shape;
- if you have not run it in a couple of months.

Afterwards, `supabase db reset` to get your dev seed back.

Every ordinary run also verifies itself, but more weakly:

- **completeness** — `data.sql` opens and closes with matching pg_dump tokens,
  so a dump killed halfway cannot be kept;
- **coverage** — every table the live database says has rows appears in the
  dump, which is what catches a table pg_dump could not read and skipped while
  exiting 0.

Coverage asserts _presence_, not counts. Counting rows out of multi-row `INSERT`
statements is guesswork. `--restore-test` answers the same question properly.

A run that fails verification leaves a `.partial` directory and no backup — never
something that looks usable.

---

## Restoring

Order matters.

```bash
# 1. Schema, from the reviewed source — the migrations in git, not schema.sql
supabase link --project-ref <new-ref>
bash scripts/prod-cutover.sh

# 2. Data, which exists nowhere else
gunzip -c ~/neuvto-backups/prod/<stamp>/data.sql.gz | psql "$DB_URL"

# 3. Vault secrets — prod-cutover.sh prints both statements
# 4. Storage files
supabase storage cp -r ~/neuvto-backups/storage/org-logos ss:///org-logos --linked --experimental
```

Then verify against the `CENSUS AT DUMP TIME` block in `MANIFEST.txt`, and check
the two Vault rows resolve with the query `prod-cutover.sh` prints.

---

## Running it unattended

Interactive password entry is right for a human-initiated backup and useless for
a scheduled one. For unattended runs, store the password in the macOS Keychain —
free, encrypted at rest, unlocked with the login session:

```bash
security add-generic-password -a "$USER" -s neuvto-prod-db -w
```

Then `bash scripts/backup-prod.sh --keychain` needs no terminal.

A daily `launchd` agent at `~/Library/LaunchAgents/com.neuvto.backup.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.neuvto.backup</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>/Users/sada/Neuvto/neuvto-wos/scripts/backup-prod.sh</string>
    <string>--keychain</string>
  </array>
  <key>StartCalendarInterval</key><dict>
    <key>Hour</key><integer>3</integer><key>Minute</key><integer>0</integer>
  </dict>
  <key>RunAtLoad</key><false/>
  <key>StandardOutPath</key><string>/Users/sada/neuvto-backups/backup.log</string>
  <key>StandardErrorPath</key><string>/Users/sada/neuvto-backups/backup.log</string>
</dict></plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.neuvto.backup.plist
```

Three honest caveats:

- **The laptop has to be awake at 03:00.** `launchd` runs a missed
  `StartCalendarInterval` job once on wake, so a closed lid means a late backup
  rather than no backup — but a laptop that is off all week produces nothing.
- **The first Keychain read may prompt.** Click _Always Allow_ once; after that
  it is silent while the login keychain is unlocked.
- **Nothing tells you when it stops working.** Read `backup.log`, or check that
  `~/neuvto-backups/prod/` has a directory from today. A scheduled backup that
  quietly stopped is worse than no scheduled backup, because you believe in it.

This is why a laptop cron job is a stopgap, not the answer. The answer is Pro's
daily backups, on the day Neuvto has revenue to pay for them.

---

## When to move to Pro

Move when any of these is true — not on a date:

- more than one paying customer's data is in production;
- losing a day of leave requests would mean phoning customers to apologise;
- nobody has looked at `backup.log` in a fortnight.

Pro adds daily automatic backups with 7-day retention and point-in-time recovery
as a paid add-on. Until then, this script and the discipline around it are the
entire disaster recovery plan, and everyone involved should know that.
