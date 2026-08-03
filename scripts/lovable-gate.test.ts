/**
 * The gate, tested in both directions.
 *
 * A check that cannot fire is the failure mode this project keeps producing —
 * three times in one day: a guard that could never fail, an assertion that
 * swallowed its own exception, a validation that rejected the only correct
 * input. So every rule here is asserted to fire AND asserted not to fire on the
 * cases it must leave alone.
 */

import { describe, expect, it } from "vitest";
// @ts-expect-error — plain ESM module, no types, deliberately runnable by node in CI
import { evaluate, forbiddenRuntimeDeps, LOVABLE_AUTHOR_PATTERN } from "./lovable-gate.mjs";

const LOVABLE = [
  "gpt-engineer-app[bot] <159125892+gpt-engineer-app[bot]@users.noreply.github.com>",
];
const HUMAN = ["sadakc <30974385+sadakc@users.noreply.github.com>"];

describe("recognising Lovable", () => {
  it("matches the bot's commit author", () => {
    expect(LOVABLE_AUTHOR_PATTERN.test(LOVABLE[0])).toBe(true);
  });

  it("does not match a person", () => {
    expect(LOVABLE_AUTHOR_PATTERN.test(HUMAN[0])).toBe(false);
  });

  it("matches even if the [bot] suffix is absent", () => {
    // Authorship is reported differently by different git plumbing; the gate
    // must not fall open because one of them omits the suffix.
    expect(LOVABLE_AUTHOR_PATTERN.test("gpt-engineer-app")).toBe(true);
  });
});

describe("pull requests that are not Lovable's", () => {
  it("passes, and says the gate did not apply rather than reporting a clean bill", () => {
    const r = evaluate({ authors: HUMAN, changedFiles: ["supabase/migrations/001_x.sql"] });
    expect(r.verdict).toBe("pass");
    expect(r.isLovable).toBe(false);
    expect(r.reasons[0]).toMatch(/does not apply/);
  });

  it("passes even doing everything a Lovable PR would be blocked for", () => {
    const r = evaluate({
      authors: HUMAN,
      changedFiles: [".github/workflows/ci.yml", "AGENTS.md", "scripts/harness.sh"],
      addedRuntimeDeps: ["@lovable.dev/email-js"],
    });
    expect(r.verdict).toBe("pass");
  });

  it("treats a PR with both a human and a Lovable commit as Lovable's", () => {
    // The strict reading. A change is Lovable's if Lovable touched it at all —
    // otherwise adding one human commit lifts the gate.
    const r = evaluate({
      authors: [...HUMAN, ...LOVABLE],
      changedFiles: ["src/components/ui/button.tsx"],
    });
    expect(r.isLovable).toBe(true);
    expect(r.verdict).toBe("needs-approval");
  });
});

describe("what Lovable may never do", () => {
  it.each([
    ["a migration", "supabase/migrations/20260731000000_x.sql", /migration/],
    ["the CI workflow", ".github/workflows/ci.yml", /CI workflow/],
    ["a guardrail script", "scripts/harness.sh", /guardrail/],
    ["its own instructions", "AGENTS.md", /own instructions/],
    ["the standards", "docs/standards/NEUVTO_CODING_STANDARDS.md", /standards/],
    // Production is a project Lovable does not own. `.env` is the only thing
    // that decides which database the published app reaches, so regenerating it
    // — which Lovable has every reason to do — would repoint the live site.
    ["the app's database target", ".env", /database the published app/],
    ["a per-environment env file", ".env.production", /database the published app/],
    // Offered for real on 2 Aug 2026: Lovable read the schema off pre-production,
    // found types.ts "missing" invitations and approval_queue, and proposed
    // regenerating it — which would have deleted them.
    [
      "generated database types",
      "src/integrations/supabase/types.ts",
      /deletes types rather than adding/,
    ],
    // Added when screen-prover and CLAUDE.md became the rules that decide whether
    // a screen has been proved. A change to the reviewing apparatus, arriving
    // inside the change it would review, is the one edit nobody is positioned to
    // judge — the same reason the CI workflow and the guardrail scripts are here.
    ["the working agreement", "CLAUDE.md", /must not be editable by what they judge/],
    [
      "an agent definition",
      ".claude/agents/screen-prover.md",
      /must not be editable by what they judge/,
    ],
  ])("blocks %s", (_label, file, expected) => {
    const r = evaluate({ authors: LOVABLE, changedFiles: [file] });
    expect(r.verdict).toBe("blocked");
    expect(r.reasons.join(" ")).toMatch(expected);
  });

  it("blocks a Lovable runtime dependency — the §9 lock-in", () => {
    const r = evaluate({
      authors: LOVABLE,
      changedFiles: ["package.json"],
      addedRuntimeDeps: ["@lovable.dev/email-js"],
    });
    expect(r.verdict).toBe("blocked");
    expect(r.reasons.join(" ")).toMatch(/portability/);
  });

  it("stays blocked even with an approving review", () => {
    // Approval is for judgement calls. These are not judgement calls.
    const r = evaluate({
      authors: LOVABLE,
      changedFiles: ["supabase/migrations/001_x.sql"],
      hasOwnerApproval: true,
    });
    expect(r.verdict).toBe("blocked");
  });

  it("reports every reason, not just the first", () => {
    const r = evaluate({
      authors: LOVABLE,
      changedFiles: ["AGENTS.md", ".github/workflows/ci.yml"],
      addedRuntimeDeps: ["@lovable.dev/email-js"],
    });
    expect(r.reasons).toHaveLength(3);
  });
});

describe("what is allowed through, with review", () => {
  it("asks for approval on an ordinary UI change", () => {
    const r = evaluate({
      authors: LOVABLE,
      changedFiles: ["src/components/ui/button.tsx", "src/routes/index.tsx"],
    });
    expect(r.verdict).toBe("needs-approval");
  });

  it("passes once approved", () => {
    const r = evaluate({
      authors: LOVABLE,
      changedFiles: ["src/components/ui/button.tsx"],
      hasOwnerApproval: true,
    });
    expect(r.verdict).toBe("pass");
  });

  it("allows a Lovable devDependency — their build plugin ships to nobody", () => {
    // addedRuntimeDeps carries only `dependencies`; a devDependency never
    // reaches it. Asserted so nobody later "tightens" this by passing both.
    const r = evaluate({
      authors: LOVABLE,
      changedFiles: ["package.json"],
      addedRuntimeDeps: [],
      hasOwnerApproval: true,
    });
    expect(r.verdict).toBe("pass");
  });

  it("allows an ordinary third-party dependency, with review", () => {
    const r = evaluate({
      authors: LOVABLE,
      changedFiles: ["package.json"],
      addedRuntimeDeps: ["date-fns"],
    });
    expect(r.verdict).toBe("needs-approval");
  });
});

describe("forbiddenRuntimeDeps", () => {
  it("picks out only the Lovable ones", () => {
    expect(forbiddenRuntimeDeps(["date-fns", "@lovable.dev/email-js", "zod"])).toEqual([
      "@lovable.dev/email-js",
    ]);
  });

  it("is empty when there are none", () => {
    expect(forbiddenRuntimeDeps(["date-fns"])).toEqual([]);
  });

  it("does not match a package that merely mentions lovable", () => {
    expect(forbiddenRuntimeDeps(["lovable-ui", "not-lovable.dev"])).toEqual([]);
  });
});

describe("the incident this exists to prevent", () => {
  it("blocks exactly what landed on 30 Jul 2026", () => {
    const r = evaluate({
      authors: LOVABLE,
      changedFiles: [
        "src/lib/email-templates/send-email.ts",
        "src/lib/email-templates/registry.ts",
        "src/routes/lovable/email/transactional/preview.ts",
        "package.json",
      ],
      addedRuntimeDeps: [
        "@lovable.dev/email-js",
        "@lovable.dev/webhooks-js",
        "@react-email/render",
      ],
      hasOwnerApproval: false,
    });
    expect(r.verdict).toBe("blocked");
    expect(r.reasons.join(" ")).toMatch(/portability/);
  });
});
