# Autosave — work reaches git without anybody asking

**Version:** 1.0 · **Status:** Active · **Updated:** 8 Aug 2026

Nothing worth keeping should depend on somebody remembering to ask for it to be
saved. At the end of every Claude Code turn, whatever changed is committed and
pushed to a branch automatically.

|                 |                                                                         |
| --------------- | ----------------------------------------------------------------------- |
| What runs it    | a `Stop` hook in [`.claude/settings.json`](../../.claude/settings.json) |
| What it runs    | [`scripts/autosave.sh`](../../scripts/autosave.sh)                      |
| When            | end of every turn in which a file changed                               |
| Where it pushes | a branch — **never `main`**                                             |

## Why a hook and not an agent

An agent has to be invoked by somebody. That is the problem being solved, so an
agent would reproduce it. A hook fires on its own whether or not anybody
remembers it exists, which is the only property that matters here.

## The three rules it will not break

**1 · It never commits to `main`.** On `main` it creates `work/<date>-<time>`,
moves the changes there, and commits on that. Everything still reaches `main`
the normal way — pull request, three CI checks, review. Autosave removes the
manual saving, not the gate.

**2 · It never commits a live credential.** The staged diff is matched against a
deliberately narrow set of real credential shapes — Resend `re_…`, OpenAI
`sk-…`, Supabase `sb_secret_…`, AWS `AKIA…`, GitHub `ghp_…` and
`github_pat_…`, PEM private keys, and a JWT assigned to a `*_KEY` variable. On a
match nothing is committed, the staging area is reset, and the offending line is
printed.

Narrow is deliberate. A broad pattern fires on documentation that merely
_discusses_ secrets, everyone learns to ignore the warning, and the guard stops
guarding anything. `docs/operations/EMAIL_AND_DOMAINS.md` contains the literal
line `RESEND_API_KEY=re_...` and correctly does not trip it.

**3 · It never fails the session.** Every path exits 0. A broken autosave that
blocks work would get switched off within a day, and then nothing is saved at
all.

It also stands down mid-merge, mid-rebase and mid-cherry-pick, where an
automatic `git add -A` would be destructive.

## Verified, in both directions

A guard nobody has watched fail is not a guard. Run before trusting it:

| Test                                     | Result                               |
| ---------------------------------------- | ------------------------------------ |
| Ordinary file while on `main`            | moved to `work/…`, committed, pushed |
| `re_8Kd2mQxV7nBpLwZaTcR4yHjF`            | **refused**, staging reset           |
| `AKIA…`, `ghp_…`, PEM key, `sb_secret_…` | **refused**                          |
| Every tracked file in the repository     | zero false positives                 |
| Docs containing `RESEND_API_KEY=re_...`  | correctly ignored                    |

Re-run these after any edit to the pattern. Both halves matter: a guard that
cannot fire is useless, and one that fires constantly gets ignored.

## What the history looks like

One checkpoint commit per turn, so a branch accumulates several:

```
chore(autosave): docs/operations, src/platform (3 file(s))
```

They are noise, and they are meant to be — squash-merging the pull request
collapses them into the single reviewed commit that lands on `main`. The
checkpoints exist so work survives a crash, not to be read.

## Turning it off

Delete the `Stop` block from `.claude/settings.json`, or the file. Nothing else
depends on it.

## What it does not do

- **Does not open pull requests.** Landing work stays a deliberate act.
- **Does not run lint, tests or the harness.** Too slow for every turn; CI runs
  them on push.
- **Does not touch anything already ignored** — `.env.local` and everything else
  in `.gitignore` stays out, as it should.
