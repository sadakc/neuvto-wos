<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

# NEUVTO WOS — build rules

Multi-tenant Workforce Operating System. Leave Management is the first module.
**Platform before features:** shared services are built once and consumed by every module.

## Where everything is written down

All documentation lives in **`docs/`** — start at [`docs/README.md`](docs/README.md).

- [`docs/product/NEUVTO_MVP_BUILD_SPEC.md`](docs/product/NEUVTO_MVP_BUILD_SPEC.md)
  is the source of truth: the platform and its services, the module contract,
  the build sequence, and the **D1–D46** decision table. Check that table before
  "fixing" something that looks wrong — much of it is deliberate.
- [`docs/standards/`](docs/standards/) holds the rules CI enforces.

Anything worth knowing goes in a file under `docs/`, not in a commit message
and not in a chat.

---

## Architecture — the rule that matters most

```
src/platform/    Shared services: auth, organizations, rbac, approvals,
                 notifications, audit, calendar, settings
src/modules/     Business modules: leave (more later)
src/components/  ui/ = shadcn primitives (never hand-edit) · shared/ = composites
src/lib/         Framework helpers, no domain knowledge
src/routes/      Thin — routing and layout only
```

**Never violate these:**
1. `platform/**` must not import from `modules/**`
2. `modules/a/**` must not import from `modules/b/**`
3. Import a module by its root (`modules/leave`), never a deep internal path
4. Approvals, notifications, audit logging, working-day calculation, and org
   settings are **platform services**. Modules call them. A module must never
   implement its own approval table, send its own email, or write its own audit rows.

If Leave needs something Attendance would also need, it belongs in `platform/`.

---

## Business logic

- Lives in `src/modules/*/handlers/` as pure functions `(ctx, input) => output`
- **Never** in components, routes, or server functions — those only validate,
  authenticate, call a handler, and serialise
- `ctx` carries `user_id`, `organization_id`, `roles`. Handlers never read auth state directly
- Throw typed `AppError(code, message, status)` — never a bare `Error`

## Types

- `strict: true`. **No `any`.** Use `unknown` and narrow.
- No non-null assertions (`!`) in business logic
- Derive types from Zod schemas — never hand-write a parallel interface
- Never hand-edit `src/integrations/supabase/types.ts`

## Database

> **Do not author migrations.** Schema changes are written locally, reviewed in a pull
> request, and gated by CI before they reach this branch. If a task appears to need a
> schema change, stop and say so rather than creating one.
>
> If asked to *apply* an existing migration file, apply that file — do not generate a new
> migration containing the same DDL. Doing so produced two files with identical statements
> and broke `supabase db reset` with `type "app_role" already exists` (29 Jul 2026).

- **Tenancy is absolute.** Every table has `organization_id`. Every query filters by it.
- **RLS is enabled in the same migration that creates the table.** Never a follow-up.
- In every policy use `(select auth.uid())`, never bare `auth.uid()` — bare calls are
  re-evaluated per row and will not scale
- Helper functions: `SECURITY DEFINER STABLE`, `set search_path = public`
- Index `organization_id` on every table
- **Roles live in `user_roles`, never on `profiles`** — a role column on a user-editable
  table is a privilege-escalation hole
- Migrations are forward-only. Never edit an applied migration.
- Multi-table writes run in one transaction

## Configuration, not code

Business rules an organization might change are **data**, not constants.
Financial year start, weekend days, holidays, approval thresholds, notice periods,
and leave allowances are all rows a customer can edit. Never hardcode them — including
"April" as a financial year start or "3 days" as an approval threshold.

## API

- Envelope: `{ success, data, error: { code, message, details }, timestamp }`
- JSON fields are `snake_case`
- Cross-tenant access returns **403, never 404**
- Collections paginate: `limit` (default 20, max 100) and `offset`
- Error codes are stable `SCREAMING_SNAKE_CASE`, defined once

## UI

- **No raw values.** No `bg-[#0EA5E9]`, no `p-[13px]`, no inline hex. Semantic
  tokens only: `bg-primary`, `text-muted-foreground`, `rounded-lg`, `p-4`
- Never hand-edit `src/components/ui/*` — extend via the variant API
- **Dark mode in the same change**, never a follow-up
- Every async view ships **loading, empty, and error** states
- Mobile touch targets **≥ 48px** (`size="lg"`); employee views are mobile-first,
  admin views desktop-first
- Numbers that change get `tabular-nums`
- Status colour is always paired with text — never colour alone
- Need a new colour? Add a semantic token, don't inline it

## Portability

Assume we leave Lovable one day.
- Lovable APIs (`@/integrations/lovable`) are importable **only** from inside
  `src/integrations/lovable/`. Everything else goes through our own wrapper in
  `src/platform/auth/`.
- Schema changes always produce a plain SQL file in `supabase/migrations/`
- Standard env vars only

## Comments

Explain **why**, not what. Any deviation from the spec names its decision ID:

```ts
// D3: PRD Rule 1 is unbounded — a 3-year employee would accrue 36 days from a
// 12-day policy. Capped at max_days_per_year.
```

## Definition of done

- [ ] Correct layer; import rules hold
- [ ] Logic in a handler, not a component
- [ ] RLS enabled with the table; policies use `(select auth.uid())`
- [ ] No `any`, no raw colour values
- [ ] Dark mode works
- [ ] Loading, empty, error states present
- [ ] Nothing hardcoded that a customer might configure
