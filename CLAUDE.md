# Neuvto WOS — working agreement

Short on purpose. It carries the things that have actually gone wrong, and points at
the documents that carry the rest. If something here disagrees with a doc, this file
is newer; fix the doc.

## Read before changing anything

- `docs/agents/AGENT_PROTOCOL.md` — tiers, verification, escalation
- `docs/product/NEUVTO_MVP_BUILD_SPEC.md` — the D-numbered decisions (D1–D53)
- `docs/standards/NEUVTO_CODING_STANDARDS.md`

## UI work goes through `screen-prover`. By default.

Standing instruction from Sada, 3 Aug 2026. **Any change to a component, route, form
or on-screen string is routed through the `screen-prover` agent before it is reported
as done.** Not on request.

Because four green checks are not evidence that a screen works. Three bugs reached
Sada in one week with lint, typecheck, 123 tests and the SQL harness all passing — a
`<select>` misreporting every reporting line, a refusal outliving the request it
described, and a search box that never rendered. All three were uncatchable: every
test in the project was a pure function.

Render tests: `*.test.tsx`, `// @vitest-environment happy-dom`, and **watched failing
before they are trusted**. Report the failure output, not the words "sabotage-tested".
Worked example: `src/routes/app/members.test.tsx`.

This is not a coverage target, and it does not apply to pure-function changes with no
screen in them.

## Verification

```bash
bun run lint
bun run typecheck
bun run test
bun run harness     # mandatory for database, handler or platform-service changes
```

`scripts/harness.sh` **truncates**. It refuses a non-local target holding real rows,
and that guard is not to be worked around. Never point it at production.

## Standing constraints

- **Nothing is paid for until the MVP ships.** Say the cost before proposing anything.
- **Sada provisions every customer and names their first administrator.** No
  self-serve signup (D39). Staff never read tenant data (D42).
- **Phone is India-only** by decision, 3 Aug 2026 — the rule lives in `PhoneInput` in
  `src/platform/auth/contracts.ts` and deliberately not in a check constraint, so
  going global later is one edit rather than a migration.
- **Lovable writes to this repo.** Its changes are gated — see
  `docs/operations/REVIEWING_LOVABLE_CHANGES.md` and `scripts/lovable-gate.mjs`.
- **A migration is a file in git**, so a secret never goes in one. Vault secrets are
  per-environment and manual (D43).

## Two things that have bitten more than once

**More than one Claude session runs on this repo.** One has merged a PR, moved the
checkout, and run `db reset` mid-verification. Run `git log --oneline -1` and
`git status` before assuming the tree is where you left it.

**`scripts/autosave.sh` has committed under its own message and reset a branch to
`origin/main`.** Check `ps aux | grep autosave` before a long uncommitted stretch.
