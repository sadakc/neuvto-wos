/**
 * Whether a pull request authored by Lovable may merge.
 *
 * On 30 Jul 2026 Lovable pushed four commits straight to `main` scaffolding a
 * second email system — @lovable.dev/email-js, a LOVABLE_API_KEY, four
 * dependencies, and a DNS delegation. It duplicated the Notification Engine
 * finished hours earlier and would have made leaving Lovable mean rebuilding
 * email and moving DNS.
 *
 * AGENTS.md already said "a module must never send its own email". Lovable
 * built it at lib/ level, outside the wording. Instructions did not hold, so
 * this is mechanical.
 *
 * `evaluate` is a pure function on purpose. CI gathers the facts — authors from
 * git, files from the diff, dependencies from package.json, review state from
 * the API — and this decides. Keeping the decision separate from the plumbing is
 * what makes it testable without fabricating bot commits, and in this project
 * the checker has been the broken thing more often than the code.
 *
 * Applies ONLY to Lovable-authored pull requests. Everything else is untouched.
 */

/** Lovable commits as this GitHub app. The `[bot]` suffix is part of the name. */
export const LOVABLE_AUTHOR_PATTERN = /gpt-engineer-app(\[bot\])?/i;

/**
 * Areas a Lovable pull request may never touch, each with the reason, because a
 * rule whose reason is lost gets deleted by whoever finds it inconvenient.
 *
 * Lifting one is a separate pull request editing this list — which makes the
 * exception visible instead of silent.
 */
export const FORBIDDEN_PATHS = [
  {
    test: (f) => f.startsWith("supabase/migrations/"),
    reason:
      "authored a database migration — AGENTS.md forbids this, and it once produced two files with identical DDL that broke `supabase db reset`",
  },
  {
    test: (f) => f.startsWith(".github/workflows/"),
    reason: "changed the CI workflow — the checks must not be editable by what they check",
  },
  {
    test: (f) => f.startsWith("scripts/"),
    reason: "changed a guardrail script — same reason as the workflow",
  },
  {
    test: (f) => f === "AGENTS.md",
    reason: "rewrote its own instructions",
  },
  {
    test: (f) => f.startsWith("docs/standards/"),
    reason: "changed the standards it is meant to follow",
  },
];

/**
 * A runtime dependency on Lovable is the lock-in that CODING_STANDARDS §9 —
 * the portability contract — exists to prevent. devDependencies are fine:
 * their build plugin lives there legitimately and ships to nobody.
 */
export function forbiddenRuntimeDeps(addedRuntimeDeps = []) {
  return addedRuntimeDeps.filter((d) => d.startsWith("@lovable.dev/"));
}

/**
 * @param {object} input
 * @param {string[]} input.authors          commit authors on this PR (name or email)
 * @param {string[]} input.changedFiles     repo-relative paths
 * @param {string[]} input.addedRuntimeDeps package names added to `dependencies`
 * @param {boolean}  input.hasOwnerApproval an approving review from the repo owner
 * @returns {{verdict: "pass"|"needs-approval"|"blocked", reasons: string[], isLovable: boolean}}
 */
export function evaluate({
  authors = [],
  changedFiles = [],
  addedRuntimeDeps = [],
  hasOwnerApproval = false,
} = {}) {
  const isLovable = authors.some((a) => LOVABLE_AUTHOR_PATTERN.test(String(a)));

  // Not Lovable's: this gate has no opinion. Reported explicitly rather than
  // returning a bare pass, so a run that checked nothing cannot be mistaken for
  // a run that found nothing wrong.
  if (!isLovable) {
    return {
      verdict: "pass",
      isLovable: false,
      reasons: ["No Lovable-authored commits on this pull request — gate does not apply."],
    };
  }

  const reasons = [];

  for (const rule of FORBIDDEN_PATHS) {
    const hits = changedFiles.filter(rule.test);
    if (hits.length > 0) {
      reasons.push(
        `${rule.reason} (${hits.slice(0, 5).join(", ")}${hits.length > 5 ? ", …" : ""})`,
      );
    }
  }

  const deps = forbiddenRuntimeDeps(addedRuntimeDeps);
  if (deps.length > 0) {
    reasons.push(
      `added a Lovable runtime dependency (${deps.join(", ")}) — CODING_STANDARDS §9, the portability contract`,
    );
  }

  if (reasons.length > 0) {
    return { verdict: "blocked", isLovable: true, reasons };
  }

  if (!hasOwnerApproval) {
    return {
      verdict: "needs-approval",
      isLovable: true,
      reasons: [
        "A Lovable change needs an approving review before it can merge. Review it, then approve on GitHub.",
      ],
    };
  }

  return {
    verdict: "pass",
    isLovable: true,
    reasons: ["Reviewed and approved."],
  };
}

/** Renders a verdict for a CI log. */
export function format(result) {
  const head =
    result.verdict === "pass"
      ? "lovable-gate: pass"
      : result.verdict === "needs-approval"
        ? "lovable-gate: awaiting review"
        : "lovable-gate: blocked";
  return [head, ...result.reasons.map((r) => `  - ${r}`)].join("\n");
}
