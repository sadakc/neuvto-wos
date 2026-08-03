# Neuvto WOS — Agent Protocol

Binding on every agent in `.claude/agents/`. Read this before acting.

Neuvto WOS is a multi-tenant SaaS holding **other companies' employee data**. The person
you report to is not an engineer. Both facts shape everything below.

---

## 1. The tier model

Repair authority is decided by **which files a fix touches** — never by your own assessment
of how risky something feels. Path rules are objective and auditable; judgment drifts under
pressure to be helpful.

### Tier 3 — ESCALATE. Diagnose fully; never edit.

Any fix touching these paths, whatever the symptom:

```
supabase/migrations/**
**/*rls*.sql  ·  any CREATE POLICY / ALTER POLICY / ENABLE ROW LEVEL SECURITY
src/platform/rbac/**
src/platform/auth/**
src/platform/audit/**
src/modules/leave/handlers/balance*
```

Also Tier 3 regardless of path: anything that changes who can read whose data, anything
that changes how leave days are counted, and anything that runs against production data.

**Why this line exists.** The most natural fix for "this query returns no rows" is to
loosen the policy that blocked it. On this product those policies are the wall between one
customer's HR data and another's. A loosened policy produces **no error, no crash, and no
visible symptom** — the app looks perfectly healthy while leaking. Balance arithmetic fails
the same way: adjust a formula to make a test pass and leave records silently corrupt for
every employee.

These are the bugs that do not announce themselves. That is exactly why they are the ones
you must not fix unsupervised.

### Tier 2 — PROPOSE. Diagnose, write the fix, wait for approval.

Business logic and behaviour: module handlers, platform services other than those above,
UI behaviour, notification content, reports, admin screens.

Run the full check suite, then present the summary in §3 and stop. Do not commit or push.

### Tier 1 — AUTO. Fix, verify, report.

Build failures, TypeScript errors, lint violations, broken or missing imports, missing
loading/empty/error states, design-token violations (raw hex, arbitrary Tailwind values),
dark-mode gaps, responsive breakage.

Safe because correctness is machine-verifiable: it compiles and passes, or it does not.
Tier 3 is unsafe for the mirror-image reason — a wrong fix there still compiles and still
passes.

**When a fix spans tiers, the highest tier wins.** A UI bug whose real cause is an RLS
policy is Tier 3, not Tier 1.

**When you are unsure of the tier, treat it as the higher one** and say so.

---

## 2. Method

1. **Reproduce before diagnosing.** Never propose a fix for something you have not seen
   fail. If you cannot reproduce it, say so and report what you tried.
2. **Find the cause, not the symptom.** A blank page is a symptom. Suppressing the error
   that produced it is not a fix. If you find yourself adding a null check, a try/catch, or
   a default value to make a symptom disappear, stop — you are treating the symptom.
3. **Smallest change that fixes the cause.** No refactoring, no tidying, no unrelated
   improvements. A large diff is unreviewable by a non-engineer.
4. **Verify before reporting.** Run the checks in §4. "Should work" is not verification.
5. **Never weaken a test, policy, or constraint to make something pass.** If a test blocks
   your fix, the test is probably right and the fix is probably wrong.

---

## 3. Reporting

Written for a business reader. No stack traces in the summary, no jargon without a plain
gloss. Lead with impact.

**Tier 1 (after fixing):**

```
FIXED · <one line, plain English>
What was wrong:  <what the user would have seen>
What I changed:  <file, one sentence>
Verified:        <which checks ran and passed>
```

**Tier 2 (proposing):**

```
NEEDS YOUR APPROVAL · <one line>
What's wrong:    <what a user experiences>
Why it happens:  <root cause, plainly>
My fix:          <what changes, and what it will do>
Risk if wrong:   <what would break>
Verified:        <checks run against the proposed fix>
```

**Tier 3 (escalating):** written for a technical contractor with **no project context** —
they cannot ask follow-up questions.

```
ESCALATION · <severity> · <one line>

For Sada:        <plain English: what this means, who is affected,
                  and what to do right now — including whether to
                  take something offline>

For an engineer:
  Reproduction:  <exact steps or query>
  Root cause:    <precise, with file and line>
  Blast radius:  <which customers, which data, since when>
  Proposed fix:  <specific, with the reasoning>
  Do NOT:        <the tempting wrong fixes, and why they are wrong>
```

If a Tier 3 finding involves data from one customer being reachable by another, say so in
the first line. Do not soften it.

---

## 4. Verification commands

```bash
bun run lint          # style and import rules
bun run typecheck     # TypeScript
bun run test          # vitest
bun run harness       # seed + verify_rls.sql + verify_invariants.sql
```

`bun run harness` is mandatory after any change touching the database, handlers, or
platform services. Both SQL scripts raise on the first violation — silence is a pass.

Never run the seed against production. It truncates.

### UI work goes through `screen-prover`. Always.

**Standing instruction from Sada, 3 Aug 2026.** Any change to a component, route,
form, or on-screen string is routed through the `screen-prover` agent before it is
reported as done. Not on request — by default.

Four green checks are not evidence that a screen works. In one week three bugs
reached Sada's hands with lint, typecheck, 123 tests and the full SQL harness all
passing:

- a `<select>` rendering "Nobody" for every reporting line, because a search box had
  narrowed the list its options were built from;
- an overlap refusal still on screen under a corrected set of dates;
- a search box hidden below nine people, in a workspace of eight.

All three were invisible to every check in this file, because until `screen-prover`
existed every test in the project was a pure function and the entire class lived
above them.

The rule is therefore about *evidence*, not ceremony:

- Render tests live in `*.test.tsx` with `// @vitest-environment happy-dom`.
- Every one must be **watched failing** before it is trusted — reintroduce the bug,
  read the failure, restore. A test that has never failed is not evidence.
- Report the **failure output**, not the phrase "sabotage-tested".
- State what was not covered. Anything needing a real browser — downloads, date
  pickers, focus traps — is named as a gap rather than approximated.

`src/routes/app/members.test.tsx` is the worked example.

Two things this does not mean. It is not a request for a coverage number: six tests
that each pin a real promise beat sixty asserting the DOM exists. And it does not
apply to a pure-function change with no screen in it — `screen-prover` writes render
tests, and inventing one to satisfy a rule is the failure this is meant to prevent.

---

## 5. Architecture rules you must not break

Full detail in `docs/standards/NEUVTO_CODING_STANDARDS.md`. The ones that get violated during
a hurried fix:

- `src/platform/**` must never import from `src/modules/**`
- `src/modules/a/**` must never import from `src/modules/b/**`
- Business logic lives in handlers, never in components, routes, or server functions
- Every table carries `organization_id`; every policy filters on it first
- RLS policies use `(select auth.uid())`, never bare `auth.uid()`
- **Soft delete is filtered in the RLS policy, never in application queries** (D17). If you
  find yourself adding `where deleted_at is null` to a query, the policy is wrong — fix the
  policy, because the next query will forget
- **Audit fields are set by trigger, never by application code** (D16). Code that writes
  `created_by` or `updated_at` is a defect even when the value is correct
- Overlapping leave is prevented by the `no_overlapping_leave` exclusion constraint (D18).
  If it fires, catch it and return `OVERLAPPING_REQUEST` — **never drop the constraint to
  let a request through**
- Roles live in `user_roles`, never on `profiles`
- Nothing a customer might configure is hardcoded — financial year, weekend days,
  approval thresholds, notice periods are all rows
- No raw colour values in UI code; semantic tokens only
- Lovable APIs are importable only from `src/integrations/lovable/`

Decisions D1–D15 in `docs/product/NEUVTO_MVP_BUILD_SPEC.md` record where the build deliberately departs
from the product specs. **Before "correcting" something that looks wrong, check whether it
is a recorded decision.** D2, D9, D10 and D13 in particular look like bugs and are not.

---

## 6. Escalate immediately, whatever you were doing

Stop and report at Tier 3 the moment you see any of these:

- A query returning rows belonging to another organisation
- An RLS policy that is missing, disabled, or permissive
- `available_days` negative, or not matching entitled + carryforward − used − reserved − pending
- An approval completed without every required level approving
- Anyone approving their own request
- An audit log row that was updated or deleted
- Credentials, tokens, or keys in source, logs, or error messages
- A soft-deleted row appearing in a normal read, a report, or a balance calculation
- The `no_overlapping_leave` constraint missing, dropped, or disabled
- A session still working after the user was deactivated or their role changed

These are not bugs to work through. They are stop-work conditions.
