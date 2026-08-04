/**
 * The theme rules, stated as tests.
 *
 * `resolveTheme` is inlined into `<head>` as a string, which means a mistake
 * here is a white flash or a wrong-coloured console rather than a stack trace —
 * the kind of bug that gets noticed by a customer and not by a build.
 */

import { describe, expect, it } from "vitest";
import { resolveTheme, themeIsChangeable } from "./theme";

const CONSOLE = "/neuvto-hq";
const resolve = (path: string, stored: string | null = null, prefersDark = false) =>
  resolveTheme(path, stored, prefersDark, CONSOLE);

describe("the console is always light", () => {
  it.each([CONSOLE, `${CONSOLE}/`, `${CONSOLE}/customers`])("%s renders light", (path) => {
    expect(resolve(path)).toBe("light");
  });

  it("ignores a stored preference for dark", () => {
    // Not a bug. A platform admin must never mistake the console for a tenant
    // workspace, and letting them theme it identically removes the only signal
    // that tells the two apart.
    expect(resolve(CONSOLE, "dark")).toBe("light");
  });

  it("ignores the OS preference", () => {
    expect(resolve(CONSOLE, null, true)).toBe("light");
  });

  it("does not capture a path that merely starts with the same letters", () => {
    // `/neuvto-hq-staging` is not the console. Naive `startsWith` says it is.
    expect(resolve(`${CONSOLE}-staging`, null, true)).toBe("dark");
  });

  it("says the theme cannot be changed there", () => {
    expect(themeIsChangeable(CONSOLE, CONSOLE)).toBe(false);
    expect(themeIsChangeable(`${CONSOLE}/customers`, CONSOLE)).toBe(false);
    expect(themeIsChangeable("/app", CONSOLE)).toBe(true);
  });
});

describe("the employee app is Nocturne by default", () => {
  it.each(["/app", "/app/", "/app/reports", "/app/members"])("%s is dark", (path) => {
    expect(resolve(path)).toBe("dark");
  });

  it("is dark even when the OS asks for light", () => {
    // The whole point of a default: most people never change the system
    // setting they were shipped.
    expect(resolve("/app", null, false)).toBe("dark");
  });

  it("yields to an explicit choice", () => {
    expect(resolve("/app", "light", false)).toBe("light");
    expect(resolve("/app", "dark", true)).toBe("dark");
  });

  it("ignores a stored value that is neither theme", () => {
    // localStorage is user-writable and survives a rename of the values.
    expect(resolve("/app", "midnight")).toBe("dark");
    expect(resolve("/app", "")).toBe("dark");
  });

  it("does not capture a path that merely starts with /app", () => {
    expect(resolve("/apply", null, false)).toBe("light");
  });
});

describe("everywhere else follows the operating system", () => {
  it.each(["/", "/auth", "/invite/abc"])("%s follows a dark OS", (path) => {
    expect(resolve(path, null, true)).toBe("dark");
  });

  it.each(["/", "/auth", "/invite/abc"])("%s follows a light OS", (path) => {
    expect(resolve(path, null, false)).toBe("light");
  });

  it("still yields to an explicit choice", () => {
    expect(resolve("/", "dark", false)).toBe("dark");
  });
});

describe("the inlined copy stays honest", () => {
  it("references nothing it cannot carry into a <script> tag", () => {
    // resolveTheme is stringified into <head>. A reference to an import or a
    // module-scope constant survives typechecking and lint, then throws in the
    // browser before React loads — a blank page with one console error.
    //
    // Reading its own source is the only check that catches this, because the
    // failure is in what the string does NOT bring with it.
    const source = resolveTheme.toString();
    for (const forbidden of ["CONSOLE_PATH", "THEME_STORAGE_KEY", "import", "require"]) {
      expect(source, `resolveTheme refers to ${forbidden}`).not.toContain(forbidden);
    }
  });
});
