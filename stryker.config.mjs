// Mutation testing: Stryker breaks the code on purpose, one small change at a
// time (a `>` flipped to `>=`, a condition forced true, a string emptied), and
// runs the unit tests against each break. A break no test notices "survives",
// and every survivor is a guard, message or branch the tests do not pin.
//
// It is the automated form of "sabotage every guard" for the TypeScript side.
// SQL guards are not covered: those are sabotaged through the harness.
//
// Run one file or folder at a time; the whole app takes hours:
//   bun run mutate src/modules/employee/format.ts
//   bun run mutate 'src/modules/leave/**/*.ts'
// The report opens from reports/mutation/index.html.
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: "vitest",
  vitest: { configFile: "vitest.config.ts" },
  plugins: ["@stryker-mutator/vitest-runner"],
  // Only the tests that run a mutated line are re-run for it.
  coverageAnalysis: "perTest",
  mutate: [
    "src/**/*.{ts,tsx}",
    "!src/**/*.{test,spec}.{ts,tsx}",
    "!src/**/__fixtures__/**",
    "!src/test/**",
    // Generated or Lovable-owned: nothing in them is ours to pin.
    "!src/integrations/supabase/**",
    "!src/routeTree.gen.ts",
    "!src/components/ui/**",
  ],
  // No incremental cache. Tried on 13 Oct 2026: it kept "survived" for
  // mutants in module-level constants (a month name, a plural) after tests
  // that kill them were added, so the report under-stated the tests. A
  // sabotage report that can be stale is worse than a slow one.
  incremental: false,
  reporters: ["clear-text", "progress", "html"],
  htmlReporter: { fileName: "reports/mutation/index.html" },
  tempDirName: ".stryker-tmp",
  concurrency: 4,
  timeoutMS: 20000,
};
