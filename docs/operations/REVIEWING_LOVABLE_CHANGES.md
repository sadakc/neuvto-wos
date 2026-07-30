# Reviewing Lovable's changes

Lovable writes to this repository. Its changes are reviewed before they land,
and the review is enforced rather than remembered.

|               |                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------- |
| Enforced by   | the `lovable-gate` job in [`ci.yml`](../../.github/workflows/ci.yml)                              |
| Decided by    | [`scripts/lovable-gate.mjs`](../../scripts/lovable-gate.mjs) — a pure function with its own tests |
| Reviewed with | [`scripts/review-lovable-change.sh`](../../scripts/review-lovable-change.sh)                      |
| Identified by | commit author `gpt-engineer-app[bot]`                                                             |

## Why this exists

On **30 July 2026** Lovable pushed four commits straight to `main` scaffolding a
**second email system**: `@lovable.dev/email-js`, a `LOVABLE_API_KEY`, four new
dependencies, and `notify.neuvto.com` delegated to Lovable's nameservers.

It duplicated the Notification Engine finished hours earlier, and it would have
made leaving Lovable mean rebuilding email **and** moving DNS — exactly what
`CODING_STANDARDS §9`, the portability contract, exists to prevent.

It was noticed only because it left `main` failing lint. Nothing else would have
caught it.

**`AGENTS.md` already said _"a module must never … send its own email."_** Lovable
built it at `lib/` level, outside the wording. That is the lesson: an instruction
is a request, and this needed a gate.

Reverted in #14.

## What Lovable may never do

A Lovable-authored pull request touching any of these **cannot go green**, so it
cannot merge — not in a hurry, not by accident, and not with an approving review,
because these are not judgement calls.

| Area                                      | Why                                                                                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/migrations/`                    | `AGENTS.md` forbids it. Asked once to _apply_ a migration, Lovable authored a second file with identical DDL and broke `supabase db reset`. |
| `.github/workflows/`                      | The checks must not be editable by the thing they check.                                                                                    |
| `scripts/`                                | Same, for the guardrail scripts.                                                                                                            |
| `AGENTS.md`                               | Its own instructions.                                                                                                                       |
| `docs/standards/`                         | The rules it is meant to follow.                                                                                                            |
| A `@lovable.dev/*` **runtime** dependency | Vendor lock-in — §9. `devDependencies` is allowed: their build plugin lives there and ships to nobody.                                      |

**Lifting one is a separate pull request that edits the list**, which makes the
exception visible instead of silent.

## Everything else needs an approving review

Any other Lovable pull request fails CI until it carries an approving review.
That review **is** the go-ahead — expressed in GitHub, where it cannot be
forgotten, rather than in a message.

## Why not CODEOWNERS

The obvious mechanism, and it does not work here. **GitHub forbids a pull request
author approving their own.** Sada is the only owner and our own PRs are pushed
under his account, so a path rule on `supabase/` would make every migration PR
require his approval _and_ be unapprovable by him — permanently unmergeable, with
no admin bypass now that `enforce_admins` is on.

Keying on authorship gets the same protection with none of the deadlock, and
leaves non-Lovable work alone.

`.github/CODEOWNERS` exists anyway, as documentation of who owns what and to make
GitHub suggest a reviewer. It is deliberately **not** wired to
`require_code_owner_reviews`.

## The review

```bash
bash scripts/review-lovable-change.sh <pr-number>
```

It reports, every time, in the same order:

- **who wrote it** — commits and authors
- **what it touches** — grouped by area, database and CI first
- **dependencies** — with `@lovable.dev/*` called out as lock-in
- **whether it reimplements a platform service** — email, approvals, audit,
  working days. This is the shape of the 30 July incident: code outside
  `src/platform/` that no import rule forbade because it was not in a module.
  Verified against the actual file that caused it.
- **secrets, environment, DNS**
- **the gate's verdict**

Then the change is built and tested **against the merge result**, not the branch
alone — a branch that passes on its own can still break `main`.

The report is a set of facts. The verdict written for Sada names what was
checked and what was found: never "looks fine".

## If Lovable cannot push at all

Branch protection blocks Lovable from `main`. Whether its GitHub sync still works
on a branch is **not yet established** — the next edit made in Lovable will show.

If it cannot push, its changes are still reachable: read the diff through the
Lovable API (`get_diff`), land it on a branch, and review it identically. Only
the plumbing differs.

## Running the gate by hand

```bash
GATE_AUTHORS="gpt-engineer-app[bot]" \
GATE_FILES="supabase/migrations/x.sql" \
bun scripts/lovable-gate-ci.mjs
```

Run with **bun**, not node — there is no node on PATH here.
