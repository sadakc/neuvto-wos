import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Tests get their own config rather than inheriting vite.config.ts.
 *
 * Two reasons, both discovered the hard way:
 *
 * 1. vite.config.ts loads the TanStack/Lovable plugin, which regenerates the
 *    MCP route files on every config load — so simply running `vitest` used to
 *    rewrite four source files and leave the working tree dirty.
 *
 * 2. Without explicit conditions, Vite's SSR resolver picked zod's CommonJS
 *    build, whose named exports do not survive interop: `import { z } from
 *    "zod"` arrived as undefined and every schema file failed to load.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  ssr: {
    resolve: {
      conditions: ["import", "module", "node", "default"],
    },
  },
  test: {
    // Node by default; a component test opts into a DOM with
    // `// @vitest-environment happy-dom` at the top of the file.
    //
    // Per-file rather than global so the 120-odd pure-function tests keep
    // running in node — they are the fast majority, and paying for a DOM to
    // assert that a CSV quotes a comma is waste that compounds.
    environment: "node",
    setupFiles: ["./src/test/setup.ts"],
    // `scripts/` is included deliberately. The guardrail scripts that decide
    // what may merge need tests more than most application code does, and an
    // src-only pattern silently skipped them — a suite of tests that never runs
    // is worse than none, because it reads as coverage.
    include: ["src/**/*.{test,spec}.{ts,tsx}", "scripts/**/*.{test,spec}.{ts,tsx}"],
    server: {
      deps: {
        // Force zod through Vite's transform so the ESM build is used.
        inline: ["zod"],
      },
    },
  },
});
