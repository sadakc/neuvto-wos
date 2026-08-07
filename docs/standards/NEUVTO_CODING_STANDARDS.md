# NEUVTO WOS — Coding Standards

**Version:** 1.1 · **Status:** Active · **Applies to:** all code, whether written by a person or an AI agent · **Updated:** 8 Aug 2026

Two goals: consistency across every module, and **portability out of Lovable at any time**. §9 is the portability contract — treat it as non-negotiable.

---

## 1. Directory structure

The filesystem mirrors the architecture. If you can't tell whether code is platform or module by its path, the path is wrong.

```
src/
├── platform/                    Shared services — built once, never duplicated
│   ├── auth/
│   ├── organizations/
│   ├── rbac/
│   ├── approvals/               Approval Engine
│   ├── notifications/           Notification Engine
│   ├── audit/
│   ├── calendar/                Working days, holidays, financial year
│   └── settings/
│
├── modules/                     Business modules — consume platform, never each other
│   └── leave/
│       ├── contracts/           Zod schemas + derived types
│       ├── handlers/            Pure business logic
│       ├── server.ts            Server function wrappers
│       ├── components/          Module-specific UI
│       └── index.ts             Public surface — the ONLY import path for other code
│
├── components/
│   ├── ui/                      shadcn primitives — do not hand-edit
│   └── shared/                  Cross-module composites built from ui/
│
├── integrations/
│   ├── supabase/
│   └── lovable/                 QUARANTINED — see §9
│
├── lib/                         Framework-agnostic helpers, no domain knowledge
└── routes/                      Thin. Routing and layout only.
```

### Import rules — enforced, not advisory

1. `platform/**` **must not** import from `modules/**`. Ever. The platform predates every module.
2. `modules/a/**` **must not** import from `modules/b/**`. Cross-module data goes through a published interface, per `03` §Cross-Module Data.
3. Anything importing a module does so via `modules/leave` — never a deep path like `modules/leave/handlers/submit`.
4. `lib/**` contains no domain concepts. A function that knows what a leave balance is does not belong there.

Rule 1 is the one that decays first. When Attendance arrives and the Approval Engine "just needs one leave-specific thing," that is the moment the platform stops being a platform.

---

## 2. Naming

| Thing                   | Convention                     | Example                       |
| ----------------------- | ------------------------------ | ----------------------------- |
| Files — components      | `PascalCase.tsx`               | `LeaveBalanceCard.tsx`        |
| Files — everything else | `kebab-case.ts`                | `calculate-working-days.ts`   |
| Server-only modules     | `*.server.ts`                  | `leave.server.ts`             |
| React components        | `PascalCase`                   | `ApprovalQueue`               |
| Functions, variables    | `camelCase`                    | `calculateEntitlement`        |
| Types, interfaces       | `PascalCase`, no `I` prefix    | `LeaveRequest`                |
| Constants               | `SCREAMING_SNAKE_CASE`         | `MAX_PAGE_SIZE`               |
| DB tables, columns      | `snake_case`, tables plural    | `leave_requests.working_days` |
| DB functions            | `snake_case`, verb-first       | `calculate_working_days()`    |
| Enum values             | `snake_case`                   | `pending_approval`            |
| Booleans                | `is_` / `has_` / `can_` prefix | `is_active`, `has_manager`    |
| Event keys              | `dot.separated`                | `approval.completed`          |

**Say what it is, not what it's like.** `LeaveRequestCard`, not `Card2` or `LeaveRequestWrapper`.

---

## 3. TypeScript

`strict: true`. Additionally required:

```jsonc
"noUncheckedIndexedAccess": true,
"noImplicitOverride": true,
"noFallthroughCasesInSwitch": true
```

- **`any` is forbidden.** Use `unknown` and narrow. If a third-party type forces it, isolate it in one adapter file with a comment explaining why.
- **No non-null assertions (`!`)** in business logic. If it can't be null, prove it with a guard or fix the type.
- **Derive types from Zod**, never hand-write a parallel interface:
  ```ts
  export const LeaveRequestInput = z.object({
    /* ... */
  });
  export type LeaveRequestInput = z.infer<typeof LeaveRequestInput>;
  ```
  Two declarations of the same shape will drift. One always wins.
- **Discriminated unions over optional soup.** Model states as `{ status: 'approved', approved_at: string } | { status: 'pending' }`, not one object where half the fields are optional.
- Database types come from `supabase gen types`. Never hand-edit `src/integrations/supabase/types.ts`.

### ESLint

Current config sets `@typescript-eslint/no-unused-vars: "off"`. **Turn it on** as `warn` with an `^_` ignore pattern — unused variables are how dead code accumulates invisibly.

Add:

```js
"no-restricted-imports": ["error", { patterns: [
  { group: ["**/modules/*/handlers/*", "**/modules/*/contracts/*"],
    message: "Import from the module root (modules/leave), not its internals." },
  { group: ["@/integrations/lovable/*"],
    message: "Lovable APIs are quarantined. See NEUVTO_CODING_STANDARDS.md §9." }
]}]
```

---

## 4. Handlers

Every handler is a pure function of context and input.

```ts
export async function submitLeaveRequest(
  ctx: RequestContext, // user_id, organization_id, roles, db
  input: SubmitLeaveRequestInput,
): Promise<LeaveRequestSummary> {}
```

- Never reads global auth state, `window`, or environment directly
- Never formats a user-facing string beyond an error `message`
- Never calls another module's handler — only platform services
- Throws typed `AppError`, never a bare `Error` or a string

Handlers are the only place business rules live. A rule implemented in a component is a rule that will be missing from the REST API.

---

## 5. Errors

```ts
export class AppError extends Error {
  constructor(
    public code: ErrorCode, // from API_STANDARDS §6
    message: string, // user-facing
    public status: number,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}
```

- Every thrown error carries a code from the published taxonomy
- **Never swallow an error to return a default.** A balance query that fails must not return zero — that silently corrupts a decision.
- One boundary handler converts `AppError` to the response envelope. Handlers don't format responses.
- Log the internal cause; return only the sanitised message.

---

## 6. Database and migrations

- **Migrations are forward-only.** Never edit one that has been applied anywhere. Fix with a new migration.
- One logical change per migration. Filename says what it does: `20260728_add_leave_balances.sql`.
- Every migration is reversible in principle — if it drops or alters a column, the comment states the rollback.
- **RLS is enabled in the same migration that creates the table.** Never a follow-up. A table without RLS is public.
- Required in every policy, per the scaling notes in the build spec:
  - `(select auth.uid())` — never bare `auth.uid()`
  - Helper functions declared `SECURITY DEFINER STABLE` with `set search_path = public`
  - `organization_id` indexed on every table
- Business rules that must hold regardless of application code go in **database constraints**, not just validation. `available_days` is a generated column for exactly this reason.

---

## 7. React and UI

- Function components only. No class components.
- **Data fetching lives in route loaders or TanStack Query** — never a bare `useEffect` fetch.
- A component either renders or orchestrates, not both. If a component has more than one `useEffect` doing coordination, extract a hook.
- **No business logic in components.** Computing whether a leave request is valid belongs in a handler; the component displays the answer.
- Props are explicit. No `{...rest}` spreading into a DOM element except in `components/ui/` primitives.
- Every list has a stable `key`. Never the array index where the list can reorder.
- Loading, empty, and error states are **required** for every async view. An empty table with no explanation is a bug.

---

## 8. Testing

Coverage targets are not the goal — the following must be tested regardless:

1. Every handler's business rules, including each failure path
2. `calculate_working_days` against the PRD's weekend and holiday cases
3. `calculate_entitlement` for mid-year joiners and non-April financial years
4. Balance transitions across submit → approve → cancel
5. Approval chain resolution when the manager is missing, is the requester, or is inactive

The SQL harness in `neuvto-harness/` is part of the test suite, not a separate activity. It runs after every build step.

---

## 9. Portability — the extraction contract

**Assume you will leave Lovable.** These rules make that a weekend, not a rewrite.

### Quarantine

Lovable-specific APIs (`@/integrations/lovable`) may only be imported by files inside `src/integrations/lovable/`. Everything else uses a thin wrapper we own:

```ts
// src/platform/auth/oauth.ts — our interface
export async function signInWithGoogle(returnUrl: string): Promise<AuthResult>;
```

Today it delegates to `lovable.auth.signInWithOAuth`. Off Lovable, one file changes.

Currently `src/routes/auth.tsx` imports `lovable` directly. **This must be refactored before Phase 3.**

### Portable by construction

- **Database:** plain SQL in `supabase/migrations/`. Runs on any Postgres with Supabase extensions. Never use a Lovable UI action that mutates schema without producing a migration file.
- **Config:** standard env vars (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`). No Lovable-proprietary config in business logic.
- **Framework:** TanStack Start is open source and self-hostable — Vercel, Railway, Fly, a container. No lock-in at the framework layer.
- **Dependencies:** everything from public npm. No private Lovable packages in `package.json`.

### The extraction test

Run quarterly. **Clone the repo, `bun install`, point at a fresh Supabase, run migrations, `bun run dev`.** If the app works, you are portable. If it doesn't, whatever broke is the lock-in — fix it that week.

---

## 10. Comments and commits

**Comments explain _why_.** The code states what. A comment restating the line below is noise; a comment explaining that a formula is capped because the PRD's version was unbounded is essential.

Every deviation from a spec carries a comment naming the decision ID:

```ts
// D3: PRD Rule 1 is unbounded — a 3-year employee would accrue 36 days
// from a 12-day policy. Capped at max_days_per_year.
```

**Commits:** `type(scope): summary` — `feat(leave): add balance reservation on submit`.
Types: `feat` · `fix` · `refactor` · `docs` · `test` · `chore`.
Scope is the platform service or module. One logical change per commit.

Never force-push or rebase pushed commits — it corrupts Lovable's history (`AGENTS.md`).

---

## 10a. Documents carry a version, and it moves when they do

**Standing instruction from Sada, 8 Aug 2026.** When a fix or an enhancement merges,
the documents describing that behaviour are updated **with it** — not at the end of a
batch — and their version is bumped.

Every file under `docs/` carries this on line 3:

```
**Version:** 1.1 · **Status:** Active · **Updated:** 8 Aug 2026
```

- **Bump the minor version** when the behaviour a document describes changes.
- **Bump the major version** when its advice is reversed rather than extended — the
  Netlify hosting runbook becoming a Cloudflare one is a 2.0, not a 1.1.
- **`Updated:` is the date of the change**, not the date somebody re-read it.

**Why a version and not just a git log.** A document with no version cannot be told
apart from the one somebody read last week, so a stale paragraph and a current one look
identical on the page. This is not hypothetical here: `DEPLOYMENT.md` claimed "the
published site talks to whichever database `.env` names" through **two outages**, sat
merged and inert, and was read by the person acting on it both times. Nothing about the
file said it had gone out of date.

**It costs nothing to do.** `deploy.yml` ignores `docs/**` and `**/*.md`, so a
documentation commit triggers no deploy and spends no hosting credit. There is no
budget argument for leaving it until later.

Only 6 of 20 documents carried a version before this rule; the rest start at 1.0 as of
8 Aug 2026, which is the first version anybody has named rather than a claim about
their history.

---

## 11. Review checklist

- [ ] Correct directory; import rules (§1) hold
- [ ] No `any`, no `!` in business logic
- [ ] Types derived from Zod, not duplicated
- [ ] Business logic in a handler, not a component or route
- [ ] Typed `AppError` with a published code
- [ ] Migration creates RLS in the same file; policies use `(select auth.uid())`
- [ ] Loading, empty, and error states present
- [ ] No Lovable import outside the quarantine
- [ ] Deviations from spec carry a decision-ID comment
- [ ] Harness passes
- [ ] Every document the change affects is updated, and its `**Version:**` bumped (§10a)
- [ ] A change to a screen went through `screen-prover`; a change to a guard, policy,
      migration or validation rule went through `refusal-prover`
