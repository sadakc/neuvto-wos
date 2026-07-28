# NEUVTO WOS — AI Seams

**Version:** 1.0 · **Status:** Active · Covers **D24**

**No AI infrastructure is built in the MVP.** This document defines where AI would attach so
that nothing forecloses it, and records why building it now would be a mistake.

---

## 1 · Two different things called "agents"

Worth separating, because the words collide:

|                                            | What it is                                             | Status                        |
| ------------------------------------------ | ------------------------------------------------------ | ----------------------------- |
| **Development agents** — `.claude/agents/` | Claude Code subagents that diagnose and fix _our_ code | **Built** (`agents-staging/`) |
| **Product AI** — this document             | Features inside Neuvto that customers use              | **Does not exist**            |

The product currently contains no AI of any kind. When investors or customers ask, that is
the accurate answer.

---

## 2 · Why nothing is being built

The same rule that deferred the Reports, Search, Documents, and Theme services:
**an abstraction with zero consumers is speculative.**

A vector database, an embedding pipeline, and a prompt-management system with no AI feature
attached is exactly the infrastructure-without-a-consumer pattern already rejected twice in
this project. Building it now would be inconsistent, and the shape chosen in the abstract
is usually wrong once a real feature arrives.

Principle 5 — _simplicity before complexity_ — and Principle 6 — _AI should assist, not
replace_ — both point the same way.

---

## 3 · The seams

Defined so that adding AI later is additive rather than structural.

### Location

`src/platform/ai/` is **reserved** and not created. AI is a platform service when it exists
— every module will want it, so it must never live inside `modules/leave/`.

### Provider interface

```ts
export interface AiProvider {
  complete(input: { prompt: string; context?: unknown }): Promise<string>;
  embed(input: { text: string }): Promise<number[]>;
}
```

Two methods, deliberately small. Nothing in the product imports a vendor SDK directly — the
same quarantine reasoning that keeps Lovable extractable. Swapping providers becomes one
file.

### Prompts are files, not strings

```
prompts/
└── <feature>/
    ├── v1.md
    └── v2.md
```

Versioned in the repo, loaded by name and version, never written inline in TypeScript.

A prompt is behaviour. A prompt embedded in a string literal cannot be diffed in review,
cannot be rolled back, and cannot be A/B compared. Treating prompts as code is the single
highest-value decision to make before writing any AI feature — and it costs nothing to
commit to now.

### Retrieval, if it is ever needed (D24)

**`pgvector` in the existing Postgres. Not a separate vector service.**

Pinecone, Weaviate, and friends solve a problem you do not have: billions of vectors and
dedicated scaling. Your corpus would be leave policies and organisation settings —
thousands of rows. A separate vector service would add a processor to the DPDP inventory, a
second store to keep in sync with Postgres, another bill, and another failure mode, in
exchange for nothing.

`pgvector` keeps embeddings in the same database, under the same RLS, inside the same
tenant boundary. That last point matters most: a separate vector store means re-implementing
multi-tenant isolation in a second system, and getting it wrong there leaks exactly as badly
as getting it wrong here.

---

## 4 · Candidate first features — documented, not built

When AI is justified, these fit Principle 6 (assist, never decide):

| Feature                    | What it does                                                                    | Why it fits                                                                |
| -------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **Anomaly flagging**       | Highlights unusual leave patterns for HR to review                              | Suggests; a human decides. Roadmap already lists this                      |
| **Natural-language apply** | _"I need next Monday to Wednesday off"_ → a filled form the employee confirms   | Genuinely faster on mobile, and the employee still submits                 |
| **Manager summary**        | Plain-language digest of pending approvals and team coverage                    | Read-only, no decision made                                                |
| **Policy Q&A**             | Answers _"how many sick days do I have left?"_ from the org's own configuration | Retrieval over existing rows — the only case that might justify `pgvector` |

Explicitly out of bounds, per Principle 6: **auto-approving or auto-rejecting leave**, and
anything that makes a decision affecting someone's employment without a human.

---

## 5 · Gating conditions

No AI feature ships until all of these are true:

1. **DPDP disclosure** — customers are told their employee data is processed by a named
   third-party model provider
2. **A DPA with that provider**, added to the processor inventory
3. **Customer opt-in** at organisation level — AI features are off by default, enabled per
   tenant through the module registry
4. **No training on customer data** — contractually confirmed with the provider
5. **A human decision point** on anything consequential

Condition 1 is the one that bites. Sending an employee's leave reason to an external model
is processing sensitive personal data, and doing it without disclosure is a compliance
breach regardless of how good the feature is.

---

## 6 · What to do now

Nothing in code. Concretely:

- Do not create `src/platform/ai/`
- Do not add an embedding column, a vector extension, or a model dependency
- Do not put an AI provider key in the environment
- **Do** keep the interface above in mind if a module is ever tempted to call a model directly

When a specific feature is chosen, this document becomes the starting point rather than a
blank page — which is the entire value of writing it now.
