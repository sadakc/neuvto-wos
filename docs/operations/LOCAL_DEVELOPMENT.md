# Local development

**Version:** 1.0 · **Status:** Active · **Updated:** 8 Aug 2026

## The one thing that will catch you

**`.env` points at PRODUCTION, not your machine.**

`.env` is committed and names the **production** database. It used to name Lovable
Cloud — shared, but not production — and a stray signup there cost nothing worse
than deleting an account. Since the cutover it names real customer data, so
`bun run dev` runs `scripts/guard-dev-target.sh` first and **refuses to start**
when nothing overrides `.env`:

```
REFUSING TO START.
.env points the dev server at PRODUCTION
```

The override, if you genuinely mean it — reproducing something that only happens
there, with nobody else on it — is `I_MEAN_PRODUCTION=1 bun run dev`. It prints a
warning and proceeds.

For ordinary work, create a `.env.local` (gitignored via `*.local`, and read by
Vite in preference to `.env`):

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

**Do not put `SUPABASE_PROJECT_ID` in there — or in `.env`.** The Supabase CLI
reads `.env` files from the working directory, and the unprefixed variable
**silently overrides `project_id` in `supabase/config.toml`**, which is what
names the local Docker containers. `supabase stop` then filters on one name while
the running containers hold another, so nothing stops and the old stack keeps
port 54322.

This warning existed here for `.env.local` while the committed `.env` was doing
exactly what it warns against: it carried `SUPABASE_PROJECT_ID="vkyvzhgigncranprhidn"`,
so the local stack ran as `supabase_db_vkyvzhgigncranprhidn` no matter what
`config.toml` said — and the repo looked, convincingly, like it was pointed at
the Lovable-owned project. Nothing in the application reads the unprefixed
variable; `src/lib/mcp/index.ts` uses the `VITE_`-prefixed one.

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

### Driving the app from an automated browser

`limit=1` on the Mailpit API is **not** newest-first. Search by recipient
instead, or you will keep reading somebody else's code from an hour ago:

```bash
curl -s "http://127.0.0.1:54324/api/v1/search?query=to%3Aalice.admin%40acme.test&limit=1"
```

**Click the field before typing into it.** Setting a text input's `value`
programmatically — which is what most automation helpers do — updates the DOM and
never fires React's `onChange`, so the component's state stays empty. The form
then submits nothing, shows no error, and looks broken for reasons that are
nowhere in the application.

This cost step 11 its by-hand verification, and the PR shipped with three screens
unexercised. The symptom is exact and worth recognising: text is visibly in the
field, the submit button is enabled, and **no network request is made at all**.

Select elements do not have the problem — setting `value` on a `<select>` does
notify React. It is text inputs specifically.

**Click the submit button too.** Pressing Enter in the field, or ending a `type`
with a newline, does not submit through this tooling. The form simply sits there
and it reads as a broken screen.

**File inputs have no upload tool in the in-app browser.** Hand the input a
constructed `File` instead — this fires a real `change` event, so React sees it:

```js
const dt = new DataTransfer();
dt.items.add(new File([csv], "staff.csv", { type: "text/csv" }));
input.files = dt.files;
input.dispatchEvent(new Event("change", { bubbles: true }));
```

**The mobile navigation bar overlays the bottom of the viewport.** A button whose
coordinates fall in the last ~55px is behind it, and the click lands on a nav
link instead — the page navigates away and the action never happens. Scroll the
control clear of the bar before clicking rather than trusting the coordinates a
`getBoundingClientRect()` returns.

**Screenshot pixels are not CSS pixels.** The screenshot comes back at 2× the
viewport, and `computer` clicks in screenshot space. Coordinates read from the
DOM must be doubled, and a click by a `ref` captured before the last re-render
lands wherever that element used to be — which once cost an accidental approval.
Re-read the page after anything that re-renders.

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

|                   | Used by                                                         | Contains                         |
| ----------------- | --------------------------------------------------------------- | -------------------------------- |
| Local Supabase    | `bun run dev` (with `.env.local`), `bun run harness`            | Whatever your migrations create  |
| Lovable Cloud     | Lovable's preview only — no longer the published site           | Pre-production — treat as shared |
| `neuvto-wos-prod` | **`neuvto.com`**, built by GitHub Actions and served by Netlify | Real customer data, Mumbai       |

Migrations do **not** reach Lovable Cloud by merging to `main` — that syncs code
only. Applying them there is a deliberate, separate step.
