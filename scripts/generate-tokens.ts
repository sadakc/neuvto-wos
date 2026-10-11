/**
 * Writes the token block of `src/styles.css` from `src/platform/design/tokens.ts`.
 *
 *     bun run tokens          regenerate
 *     bun run tokens --check  fail if the file is stale (what CI runs)
 *
 * Only the region between the GENERATED markers is touched; the Tailwind
 * imports and `@layer base` above and below are hand-written and stay that way.
 *
 * The output is COMMITTED. Generating at build time would mean the stylesheet
 * could not be read without running a tool, and would put a codegen step
 * between a fresh clone and a working `bun dev`. Committing it plus a CI
 * staleness check gets the same guarantee without the moving part.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { oklchToCss } from "../src/platform/design/color";
import {
  RADIUS_BASE,
  SEMANTIC,
  SHADOW,
  TYPE,
  type SemanticToken,
} from "../src/platform/design/tokens";

const CSS_PATH = new URL("../src/styles.css", import.meta.url).pathname;
const START = "/* GENERATED:TOKENS:START";
const END = "/* GENERATED:TOKENS:END */";

/** `primaryForeground` → `primary-foreground` */
const cssName = (token: string) => token.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

function block(): string {
  const tokens = Object.keys(SEMANTIC.light) as SemanticToken[];

  const themeInline = tokens
    .map((t) => `  --color-${cssName(t)}: var(--${cssName(t)});`)
    .join("\n");

  const vars = (theme: "light" | "dark") =>
    tokens.map((t) => `  --${cssName(t)}: ${oklchToCss(SEMANTIC[theme][t])};`).join("\n");

  return `${START} — do not edit by hand.

   Generated from src/platform/design/tokens.ts by scripts/generate-tokens.ts.
   Change a colour THERE and run \`bun run tokens\`; CI fails if this is stale.
   Editing below is wasted work — the next regeneration silently reverts it. */

@theme inline {
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
  --radius-2xl: calc(var(--radius) + 8px);
  /* Core HR (D76) is one family. --font-display is kept, pointing at the same
     face, so headings written against it before D76 still resolve. */
  --font-display: "${TYPE.fontSans}", ui-sans-serif, system-ui, sans-serif;
  --font-sans: "${TYPE.fontSans}", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: "${TYPE.fontMono}", ui-monospace, "SF Mono", Menlo, monospace;
  --shadow-card: var(--shadow-card-value);
  --shadow-overlay: var(--shadow-overlay-value);
  /* Below \`text-xs\`, for the one place a label has to sit inside a tab. Named
     rather than written as text-[0.65rem] at the call site — an arbitrary
     value in a component is the thing the design system exists to prevent. */
  --text-2xs: 0.6875rem;
  --text-2xs--line-height: 1rem;
  --color-ring-offset-background: var(--background);
${themeInline}
}

:root {
  --radius: ${RADIUS_BASE / 16}rem;
  --shadow-card-value: ${SHADOW.light.card};
  --shadow-overlay-value: ${SHADOW.light.overlay};
${vars("light")}
}

.dark {
  --shadow-card-value: ${SHADOW.dark.card};
  --shadow-overlay-value: ${SHADOW.dark.overlay};
${vars("dark")}
}

${END}`;
}

const current = readFileSync(CSS_PATH, "utf8");
const startAt = current.indexOf(START);
const endAt = current.indexOf(END);
if (startAt === -1 || endAt === -1) {
  console.error(`src/styles.css is missing the ${START} / ${END} markers.`);
  process.exit(1);
}

const next = current.slice(0, startAt) + block() + current.slice(endAt + END.length);

if (process.argv.includes("--check")) {
  if (next !== current) {
    console.error(
      "src/styles.css is out of date with src/platform/design/tokens.ts.\n" +
        "Run `bun run tokens` and commit the result.",
    );
    process.exit(1);
  }
  console.log("src/styles.css is in sync with the tokens.");
} else {
  writeFileSync(CSS_PATH, next);
  console.log(`Wrote ${Object.keys(SEMANTIC.light).length} tokens × 2 themes to src/styles.css`);
}
