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
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    server: {
      deps: {
        // Force zod through Vite's transform so the ESM build is used.
        inline: ["zod"],
      },
    },
  },
});
