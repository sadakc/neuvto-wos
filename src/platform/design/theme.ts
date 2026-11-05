/**
 * Platform · Design · Which theme a surface renders in
 *
 * Two rules (D77, 11 Oct 2026, replacing Nocturne's dark-by-default).
 *
 * ── everywhere a person works follows their device
 *
 * Unless they have chosen. The Core HR design follows `prefers-color-scheme`
 * and puts a toggle in the header; an explicit choice wins from then on, in
 * both directions. Nocturne defaulted the employee app to dark whatever the OS
 * said. That default is gone: the Core HR palette was designed light-first and
 * proven in both themes, and a person whose phone is dark at night already
 * gets dark.
 *
 * ── the console is light, and not overridable
 *
 * This one is not aesthetic and D77 keeps it. A platform admin (D42) provisions
 * workspaces and must never read tenant data; the console and a tenant
 * workspace are different places with different rules, and the cheapest way
 * to never confuse them is for them not to look alike. Making the console's
 * light theme a preference would let someone switch off the signal that tells
 * them which system they are in, so it is not a preference.
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

  // Everywhere else, the app included: the device decides (D77).
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
