# Local development

## The one thing that will catch you

**`.env` points at the hosted Lovable Cloud database, not your machine.**

Lovable commits `.env` with the hosted project's URL and publishable key. So a
plain `bun run dev` talks to the **shared** database that also serves
`neuvto.lovable.app`. Signing up there creates real auth users and triggers real
OTP emails — I did exactly this once and had to delete a stray account.

Create a `.env.local` (gitignored via `*.local`, and read by Vite in preference
to `.env`):

```bash
supabase start                    # prints PUBLISHABLE_KEY

cat > .env.local <<'EOF'
VITE_SUPABASE_URL="http://127.0.0.1:54321"
VITE_SUPABASE_PUBLISHABLE_KEY="<PUBLISHABLE_KEY from supabase start>"
VITE_SUPABASE_PROJECT_ID="local-dev"
SUPABASE_URL="http://127.0.0.1:54321"
SUPABASE_PUBLISHABLE_KEY="<same key>"
EOF
```

**Do not put `SUPABASE_PROJECT_ID` in there.** The Supabase CLI reads `.env`
files from the working directory, so it changes which local project `supabase
start` and `supabase stop` operate on — leaving orphaned containers holding
port 54322.

## Getting started

```bash
bun install
supabase start          # needs Docker running
supabase db reset       # applies every migration to a clean database
bun run dev             # http://localhost:8080
```

## Checks

```bash
bun run lint            # style, module boundaries, Lovable quarantine
bun run typecheck
bun run test            # vitest — unit tests
bun run harness         # seed + tenant isolation + data integrity
bun run format          # prettier
```

`bun run harness` refuses any non-local database, because the seed truncates.

Tests use their own `vitest.config.ts` rather than `vite.config.ts`. That is
deliberate: `vite.config.ts` loads the TanStack plugin, which regenerates the
MCP route files every time it loads — so running tests under it left four source
files modified on every run.

## Signing in locally

There is no password anywhere (D8). Sign-in is a 6-digit emailed code.

Local mail is caught by **Mailpit at http://127.0.0.1:54324** — nothing leaves
your machine. Open it after requesting a code, or fetch it directly:

```bash
ID=$(curl -s "http://127.0.0.1:54324/api/v1/messages?limit=1" \
     | python3 -c "import sys,json;print(json.load(sys.stdin)['messages'][0]['ID'])")
curl -s "http://127.0.0.1:54324/api/v1/message/$ID" \
     | python3 -c "import sys,json,re;b=json.load(sys.stdin);print(re.findall(r'\b\d{6}\b',(b.get('Text') or ''))[0])"
```

> **Supabase's default email template contains only a magic link — no code.** A
> UI asking for a 6-digit code can therefore never be completed, because the code
> is never sent. `supabase/templates/magic_link.html` fixes that locally.
>
> **The hosted database still uses its own template**, configured in the Supabase
> dashboard rather than from `config.toml`. Until it includes `{{ .Token }}`, the
> hosted app can only be signed into via the magic link. Recorded as a launch
> blocker in `docs/product/NEUVTO_MVP_BUILD_SPEC.md`.

## Testing on a real phone

```bash
bun run dev:lan
```

Prints the address to open on a phone on the same Wi-Fi, and rewrites
`.env.local` to point at this Mac's LAN address first.

**That rewrite is the whole point.** Left at `127.0.0.1`, the app works
perfectly on the Mac and fails on the phone — because `127.0.0.1` there means
the _phone_, where nothing is listening. It looks like a broken app rather than
a misconfiguration.

The address changes with the network, so the script recomputes it every run
rather than trusting what `.env.local` last said. `.env.local.localhost-backup`
holds the Mac-only version.

Sign-in codes arrive in Mailpit, also on the LAN address, port 54324.

**Limits worth knowing.** This is the local database, so the data is throwaway
and vanishes on the next `supabase db reset`. It is HTTP, not HTTPS, so anything
needing a secure context — installing to the home screen, notifications — will
not work. And it is a development build, so it is slower than the real thing.

For a realistic assessment, or to hand to somebody else, use the deployed site
instead.

## Two databases, and which is which

|                   | Used by                                                        | Contains                        |
| ----------------- | -------------------------------------------------------------- | ------------------------------- |
| Local Supabase    | `bun run dev` (with `.env.local`), `bun run harness`           | Whatever your migrations create |
| Lovable Cloud     | the published site, and `bun run dev` **without** `.env.local` | Real data — treat as shared     |
| `neuvto-wos-prod` | nothing yet                                                    | Cutover target, Mumbai          |

Migrations do **not** reach Lovable Cloud by merging to `main` — that syncs code
only. Applying them there is a deliberate, separate step.
