/**
 * Platform · Design · Which theme a surface renders in
 *
 * Nocturne is the employee app's default and the console is always light. That
 * is one decision with two halves, and each half has its own reason.
 *
 * ── the employee app is dark by default
 *
 * Because of when it is used. Leave gets checked late at night, in bed, on a
 * phone — a white screen at that moment is unpleasant in a way no amount of
 * good layout fixes. Defaulting to dark rather than following the OS is a
 * deliberate override: plenty of people never change the system setting they
 * were shipped, and the default is the design.
 *
 * It is a DEFAULT, not a lock. `setPreference` writes an explicit choice that
 * wins from then on. Dark mode is harder to read for people with astigmatism —
 * imposing it would trade one group's comfort for another's, which is not a
 * trade worth making when a toggle costs a button.
 *
 * ── the console is light, and not overridable
 *
 * This one is not aesthetic. A platform admin (D42) provisions workspaces and
 * must never read tenant data; the console and a tenant workspace are different
 * places with different rules, and the cheapest way to never confuse them is
 * for them not to look alike. Making the console's light theme a preference
 * would let someone switch off the signal that tells them which system they are
 * in, so it is not a preference.
 */

import type { ThemeName } from "./tokens";

export type ThemePreference = ThemeName | "system";

/** Where an explicit choice is remembered. */
export const THEME_STORAGE_KEY = "neuvto.theme";

/**
 * The theme actually applied, given where the person is and what they have
 * asked for.
 *
 * **This function is stringified and inlined into `<head>`** so the first paint
 * is already correct — resolving in a React effect instead gives dark-mode
 * users a white flash on every single navigation. That imposes two constraints
 * a normal function does not have:
 *
 *   · It must be entirely self-contained. No imports, no module-scope
 *     constants, nothing from a closure — the bundler will not follow it into
 *     a string, and a reference it cannot resolve is a runtime crash in
 *     `<head>` that blanks the page.
 *   · Hence `consolePath` and `storageKey` as parameters rather than imports.
 *     They are interpolated at the call site, so the path still lives in
 *     exactly one file.
 *
 * Kept pure and exported so it can be tested directly, which is the whole
 * reason it is not simply written twice.
 */
export function resolveTheme(
  pathname: string,
  stored: string | null,
  prefersDark: boolean,
  consolePath: string,
): ThemeName {
  // The console. Checked first and answered unconditionally — a stored
  // preference does not reach this branch.
  if (pathname === consolePath || pathname.startsWith(consolePath + "/")) return "light";

  if (stored === "light" || stored === "dark") return stored;

  // Nocturne. The app defaults to dark whatever the OS says.
  if (pathname === "/app" || pathname.startsWith("/app/")) return "dark";

  // Everything else — the landing page, sign-in, invitation acceptance. These
  // are the first thing a stranger sees, and a stranger's OS preference is the
  // only signal available about what they want.
  return prefersDark ? "dark" : "light";
}

/** True where a person may change the theme. False in the console, by design. */
export function themeIsChangeable(pathname: string, consolePath: string): boolean {
  return !(pathname === consolePath || pathname.startsWith(consolePath + "/"));
}

/** Reads the remembered choice. Absent means "no choice made". */
export function readPreference(): ThemePreference {
  if (typeof localStorage === "undefined") return "system";
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

/**
 * Records a choice and applies it immediately.
 *
 * Applying here rather than waiting for a re-render is deliberate: the class
 * lives on `<html>`, which is outside React's tree, so nothing would re-render
 * to pick it up.
 */
export function setPreference(theme: ThemeName): void {
  if (typeof localStorage !== "undefined") localStorage.setItem(THEME_STORAGE_KEY, theme);
  applyTheme(theme);
}

export function applyTheme(theme: ThemeName): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
  // Tells the browser to render form controls, scrollbars and the address bar
  // in the matching theme. Without it a dark page keeps white scrollbars and a
  // white autofill dropdown, which is the detail that makes a dark theme look
  // half-finished.
  document.documentElement.style.colorScheme = theme;
}
