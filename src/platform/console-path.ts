/**
 * Where Neuvto's own console lives. **The only place this string is written.**
 *
 * It was `/admin` until 4 Aug 2026, and lived in `src/routes/neuvto-hq/index.tsx`
 * until the theme resolver needed it too — importing it from there would have
 * pulled the entire console component into the root bundle, since
 * `createFileRoute` runs for its side effect and nothing tree-shakes, shipping
 * the console's code to every visitor of every page. A one-line module costs
 * nothing and keeps the path in one place, which is the property that matters.
 * A CI guardrail fails any other file that writes the literal.
 *
 * ── what renaming it buys, and what it does not
 *
 * This is obscurity, not security, and the difference matters enough to write
 * down. A route path ships to the browser: `/admin` was found by grepping the
 * JavaScript served from neuvto.com, and `/neuvto-hq` can be found the same
 * way. Anybody who opens devtools can still read it.
 *
 * What it does buy is real anyway: `/admin` is on every scanner wordlist there
 * is, so it was probed by bots that will never guess this. It removes a class
 * of automated traffic and the "there is a console here" signal from anyone
 * glancing at the site.
 *
 * The actual control is unchanged and lives where it should —
 * `is_platform_admin()` in the database, and a not-found page that discloses
 * nothing to anyone else. Both are asserted in the harness. If this path were
 * published on a billboard tomorrow, nothing would be exposed by it.
 *
 * It also decides a theme: the console always renders light, so that a platform
 * admin never mistakes it for a tenant workspace (see design/theme.ts).
 */
export const CONSOLE_PATH = "/neuvto-hq";
