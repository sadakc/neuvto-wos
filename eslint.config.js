import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", ".output", ".vinxi"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
          patterns: [
            {
              // NEUVTO_CODING_STANDARDS.md §1 — modules are imported by their root,
              // never by reaching into their internals.
              group: ["**/modules/*/handlers/*", "**/modules/*/contracts/*"],
              message: "Import a module by its root (e.g. @/modules/leave), not its internals.",
            },
            {
              // NEUVTO_CODING_STANDARDS.md §9 — the portability contract. Lovable's
              // proprietary APIs stay reachable from one directory only.
              group: ["**/integrations/lovable", "**/integrations/lovable/*"],
              message:
                "Lovable APIs are quarantined. Go through the wrapper in src/platform/auth/ — see NEUVTO_CODING_STANDARDS.md §9.",
            },
          ],
        },
      ],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      // Standards §3 — unused code accumulates invisibly when this is off.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      // Standards §3 — `any` defeats the type system it is embedded in.
      "@typescript-eslint/no-explicit-any": "error",
    },
  },

  // The quarantine itself, and generated files, are exempt from their own rules.
  {
    files: ["src/integrations/lovable/**", "src/integrations/supabase/types.ts"],
    rules: { "no-restricted-imports": "off", "@typescript-eslint/no-explicit-any": "off" },
  },

  eslintPluginPrettier,
);
