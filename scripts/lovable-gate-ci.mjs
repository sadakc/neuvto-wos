/**
 * Gathers the facts and applies the gate. The decision itself lives in
 * lovable-gate.mjs, which is a pure function with its own tests — this file is
 * only plumbing, and is kept deliberately thin because it is the part that
 * cannot be unit-tested.
 *
 * Reads from the environment so it can be exercised by hand:
 *
 *   GATE_AUTHORS="gpt-engineer-app[bot]" \
 *   GATE_FILES="supabase/migrations/x.sql" \
 *   bun scripts/lovable-gate-ci.mjs
 *
 * Run with bun, not node: this repository has no node on PATH, and assuming a
 * runtime that is not there is how the module-removal check first failed, with
 * a bare "command not found" that pointed at nothing.
 *
 * Exits non-zero when the verdict is anything but pass.
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { evaluate, format } from "./lovable-gate.mjs";

const BASE = process.env.GATE_BASE ?? "origin/main";
const HEAD = process.env.GATE_HEAD ?? "HEAD";

function sh(cmd, fallback = "") {
  try {
    return execSync(cmd, { encoding: "utf8" }).trim();
  } catch {
    return fallback;
  }
}

function lines(s) {
  return s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Commit authors on this pull request — name and email, both checked. */
function authors() {
  if (process.env.GATE_AUTHORS) return lines(process.env.GATE_AUTHORS);
  return lines(sh(`git log ${BASE}..${HEAD} --format='%an <%ae>'`));
}

function changedFiles() {
  if (process.env.GATE_FILES) return lines(process.env.GATE_FILES);
  return lines(sh(`git diff --name-only ${BASE}...${HEAD}`));
}

/**
 * Packages added to `dependencies` only. A devDependency never reaches the
 * gate — Lovable's build plugin lives there legitimately and ships to nobody.
 */
function addedRuntimeDeps() {
  if (process.env.GATE_DEPS) return lines(process.env.GATE_DEPS);

  const readDeps = (ref) => {
    const raw = sh(`git show ${ref}:package.json`, "");
    if (!raw) return {};
    try {
      return JSON.parse(raw).dependencies ?? {};
    } catch {
      return {};
    }
  };

  let head;
  try {
    head = JSON.parse(readFileSync("package.json", "utf8")).dependencies ?? {};
  } catch {
    head = readDeps(HEAD);
  }
  const base = readDeps(BASE);
  return Object.keys(head).filter((d) => !(d in base));
}

/**
 * An approving review from someone with write access. Supplied by the workflow,
 * which has the token; defaults to false so a missing value fails closed.
 */
function hasOwnerApproval() {
  return process.env.GATE_APPROVED === "true";
}

const result = evaluate({
  authors: authors(),
  changedFiles: changedFiles(),
  addedRuntimeDeps: addedRuntimeDeps(),
  hasOwnerApproval: hasOwnerApproval(),
});

console.log(format(result));

if (result.verdict === "pass") {
  process.exit(0);
}

// ::error:: renders in the GitHub UI where somebody will actually see it.
const summary =
  result.verdict === "blocked"
    ? "This Lovable change touches something it may never touch. See docs/operations/REVIEWING_LOVABLE_CHANGES.md."
    : "This Lovable change needs review. Approve the pull request on GitHub once it has been checked.";
console.log(`::error::${summary}`);
process.exit(1);
